"""Lion Pick Up — API completa en una sola función Lambda (expuesta con Function URL).

Handler: lambda_function.lambda_handler

Rutas principales (ver docs del equipo para el contrato completo):
  Públicas:   GET /salud, GET /config, GET /negocios, GET /negocios/{id}
  Sesión:     POST /auth/registro, POST /auth/login, GET /auth/yo
  Cliente:    POST /pedidos, GET /pedidos/mios, POST /pedidos/{id}/cancelar
  Negocio:    GET/POST /negocio, POST /negocio/documento, POST /negocio/productos,
              PUT /negocio/productos/{id}, GET /negocio/pedidos,
              POST /negocio/pedidos/{id}/accion, POST /negocio/pedidos/{id}/completar
  Admin:      GET /admin/resumen, GET /admin/negocios, GET /admin/negocios/{id}/documento,
              POST /admin/negocios/{id}/decision, POST /admin/negocios/{id}/liquidar,
              GET /admin/tickets, POST /admin/tickets/{id}/resolver, POST /admin/demo
  Soporte:    POST /soporte/chat, POST /soporte/ticket

Puede recibir las rutas con o sin el prefijo /api (CloudFront envía /api/* a esta función).
CORS NO se configura aquí: con CloudFront no hace falta, y sin CloudFront se configura en la Function URL.
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import boto3

import bedrock_service as ia
import db_service as db
import validator as v
from validator import ApiError

log = logging.getLogger()
log.setLevel(logging.INFO)

# ---------------- Configuración ----------------

ZONA = timezone(timedelta(hours=-6))  # Mérida / Ciudad de México (sin horario de verano)
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
ADMIN_CODE = os.environ.get("ADMIN_CODE", "")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "LionDemo2026")
BUCKET_DOCS = os.environ.get("BUCKET_DOCS", "").strip()
DOMINIO = os.environ.get("DOMINIO_INSTITUCIONAL", "").strip().lower().lstrip("@")

COMISION_PCT = {
    "fijo": int(os.environ.get("COMISION_FIJO_PCT", "8")),
    "temporal": int(os.environ.get("COMISION_TEMPORAL_PCT", "5")),
}

SESION_HORAS = 8
PBKDF2_ITER = 120_000
MAX_APARTADOS = 3
MAX_INTENTOS_CODIGO = 3
LIMITE_IA_HORA = 20
LIMITE_DOCUMENTOS = 5
MAX_PRODUCTOS = 30
MINUTOS_GRACIA_APARTADO = 30

PUNTOS_ENCUENTRO = [
    "Entrada principal",
    "Biblioteca",
    "Explanada central",
    "Cafetería central",
    "Estacionamiento de alumnos",
]
CATEGORIAS = ["Comida", "Snacks", "Bebidas", "Postres", "Saludable"]
EMOJIS = ["🌮", "🍔", "🥪", "🍕", "🥗", "🍩", "🧁", "☕", "🥤", "🍪", "🍱", "🌯", "🍫", "🥐", "🍜", "🧃"]
METODOS = {
    "fijo": ["tarjeta_simulada", "saldo_simulado"],
    "temporal": ["efectivo", "transferencia", "tarjeta_vendedor"],
}
ACCIONES = {
    "fijo": {
        "preparar": (["pagado"], "preparando"),
        "listo": (["preparando"], "listo"),
        "entregar": (["listo"], "entregado"),
        "rechazar": (["pagado"], "rechazado"),
    },
    "temporal": {
        "aceptar": (["apartado"], "aceptado"),
        "rechazar": (["apartado", "aceptado"], "rechazado"),
    },
}
ACTIVOS = {"pagado", "preparando", "listo", "apartado", "aceptado"}

_s3 = None


def s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


# ---------------- Utilidades ----------------

def ahora():
    return datetime.now(ZONA)


def ahora_iso():
    return ahora().isoformat(timespec="seconds")


def nuevo_id(prefijo, largo=8):
    return f"{prefijo}{uuid.uuid4().hex[:largo].upper()}"


def minutos(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def comision_unitaria(precio, tipo):
    """Comisión por producto en centavos, redondeada al centavo más cercano."""
    return (precio * COMISION_PCT[tipo] + 50) // 100


def _b64(datos):
    return base64.urlsafe_b64encode(datos).rstrip(b"=").decode()


def _unb64(texto):
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def respuesta(status, cuerpo):
    return {
        "statusCode": status,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
        "body": "" if cuerpo is None else json.dumps(cuerpo, ensure_ascii=False, default=str),
    }


# ---------------- Contraseñas y sesión ----------------

def _hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    derivada = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITER)
    return _b64(salt), _b64(derivada)


def _verificar_password(password, usuario):
    _, calculado = _hash_password(password, _unb64(usuario["salt"]))
    return hmac.compare_digest(calculado, usuario["hash"])


def _secreto():
    if len(TOKEN_SECRET) < 32:
        raise ApiError(500, "Falta configurar TOKEN_SECRET (mínimo 32 caracteres) en la Lambda.")
    return TOKEN_SECRET.encode()


def crear_token(usuario):
    datos = {"e": usuario["email"], "r": usuario["rol"], "x": int(time.time()) + SESION_HORAS * 3600}
    carga = _b64(json.dumps(datos, separators=(",", ":")).encode())
    firma = _b64(hmac.new(_secreto(), carga.encode(), hashlib.sha256).digest())
    return f"{carga}.{firma}"


def leer_token(token):
    try:
        carga, firma = token.split(".")
        esperada = _b64(hmac.new(_secreto(), carga.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(firma, esperada):
            return None
        datos = json.loads(_unb64(carga))
        if datos.get("x", 0) < time.time():
            return None
        return datos
    except (ValueError, json.JSONDecodeError):
        return None


def usuario_publico(u):
    return {"email": u["email"], "nombre": u["nombre"], "rol": u["rol"], "negocio_id": u.get("negocio_id")}


# ---------------- Enrutador ----------------

RUTAS = []


def ruta(metodo, patron, roles=None):
    """roles=None: pública. roles=("cliente", ...): requiere sesión con alguno de esos roles."""
    def decorador(funcion):
        RUTAS.append((metodo, re.compile("^" + patron + "$"), roles, funcion))
        return funcion
    return decorador


class Solicitud:
    def __init__(self, event, params):
        self.params = params
        self.headers = {k.lower(): val for k, val in (event.get("headers") or {}).items()}
        self.query = event.get("queryStringParameters") or {}
        self.usuario = None
        cuerpo = event.get("body")
        if cuerpo and event.get("isBase64Encoded"):
            cuerpo = base64.b64decode(cuerpo).decode("utf-8")
        if isinstance(cuerpo, dict):
            self.body = cuerpo
        elif cuerpo:
            try:
                self.body = json.loads(cuerpo)
            except json.JSONDecodeError:
                raise ApiError(400, "El cuerpo de la solicitud no es JSON válido.")
            if not isinstance(self.body, dict):
                raise ApiError(400, "El cuerpo de la solicitud debe ser un objeto JSON.")
        else:
            self.body = {}


def autenticar(solicitud, roles):
    token = solicitud.headers.get("x-session-token", "")
    datos = leer_token(token) if token else None
    if not datos:
        raise ApiError(401, "Tu sesión expiró o no es válida. Inicia sesión de nuevo.")
    usuario = db.obtener(db.USUARIOS, datos["e"])
    if not usuario:
        raise ApiError(401, "Tu cuenta ya no existe. Inicia sesión de nuevo.")
    if usuario["rol"] not in roles:
        raise ApiError(403, "No tienes permiso para esta acción.")
    return usuario


def lambda_handler(event, context):
    try:
        http = (event.get("requestContext") or {}).get("http") or {}
        metodo = (http.get("method") or event.get("httpMethod") or "GET").upper()
        camino = event.get("rawPath") or event.get("path") or "/"
        if camino == "/api" or camino.startswith("/api/"):
            camino = camino[4:] or "/"  # llamadas que llegan por CloudFront en /api/*
        if len(camino) > 1:
            camino = camino.rstrip("/")
        if metodo == "OPTIONS":
            return respuesta(204, None)
        existe_ruta = False
        for metodo_ruta, patron, roles, funcion in RUTAS:
            coincidencia = patron.match(camino)
            if not coincidencia:
                continue
            existe_ruta = True
            if metodo_ruta != metodo:
                continue
            solicitud = Solicitud(event, coincidencia.groupdict())
            if roles is not None:
                solicitud.usuario = autenticar(solicitud, roles)
            return respuesta(200, funcion(solicitud))
        if existe_ruta:
            raise ApiError(405, "Método no permitido en esta ruta.")
        raise ApiError(404, "Ruta no encontrada.")
    except ApiError as e:
        return respuesta(e.status, {"error": e.mensaje})
    except Exception:  # noqa: BLE001
        log.exception("Error no controlado")
        return respuesta(500, {"error": "Error interno del servidor. Revisa los logs en CloudWatch."})


ID = r"(?P<id>[A-Za-z0-9\-_]{1,64})"
TODOS = ("cliente", "negocio", "admin")
COMPRADORES = ("cliente", "negocio")


# ---------------- Públicas ----------------

@ruta("GET", "/")
@ruta("GET", "/salud")
def salud(req):
    return {"ok": True, "servicio": "Lion Pick Up API", "hora": ahora_iso()}


@ruta("GET", "/config")
def config(req):
    return {
        "puntos_encuentro": PUNTOS_ENCUENTRO,
        "categorias": CATEGORIAS,
        "emojis": EMOJIS,
        "comision_pct": COMISION_PCT,
        "max_apartados": MAX_APARTADOS,
        "dominio_institucional": DOMINIO,
        "hoy": ahora().date().isoformat(),
    }


def negocio_publico(n, conteo_productos=None):
    datos = {
        "id": n["id"],
        "nombre": n["nombre"],
        "descripcion": n.get("descripcion", ""),
        "tipo": n["tipo"],
        "categoria": n.get("categoria", "Comida"),
        "emoji": n.get("emoji", "🍽️"),
        "estado": n.get("estado"),
    }
    if n["tipo"] == "fijo":
        datos.update({"ubicacion": n.get("ubicacion", ""), "apertura": n.get("apertura"), "cierre": n.get("cierre")})
    else:
        datos.update({"ventana": n.get("ventana"), "puntos_encuentro": n.get("puntos_encuentro", [])})
        datos["disponible_hoy"] = estado_ventana(n) == "abierta"
        datos["estado_venta"] = estado_ventana(n)
    if conteo_productos is not None:
        datos["productos_disponibles"] = conteo_productos
    return datos


def estado_ventana(n):
    """'abierta', 'proxima' o 'terminada' para vendedores temporales."""
    ventana = n.get("ventana") or {}
    if not ventana.get("fecha"):
        return "terminada"
    hoy = ahora().date().isoformat()
    if ventana["fecha"] > hoy:
        return "proxima"
    if ventana["fecha"] < hoy:
        return "terminada"
    actual = ahora().hour * 60 + ahora().minute
    return "abierta" if actual <= minutos(ventana["fin"]) + MINUTOS_GRACIA_APARTADO else "terminada"


@ruta("GET", "/negocios")
def listar_negocios(req):
    tipo = req.query.get("tipo")
    negocios = db.escanear(db.NEGOCIOS, lambda n: n.get("estado") == "aprobado")
    if tipo in ("fijo", "temporal"):
        negocios = [n for n in negocios if n["tipo"] == tipo]
    negocios = [n for n in negocios if n["tipo"] == "fijo" or estado_ventana(n) != "terminada"]
    productos = db.escanear(db.PRODUCTOS, lambda p: p.get("activo") and p.get("stock", 0) > 0)
    conteo = {}
    for p in productos:
        conteo[p["negocio_id"]] = conteo.get(p["negocio_id"], 0) + 1
    resultado = [negocio_publico(n, conteo.get(n["id"], 0)) for n in negocios]
    resultado.sort(key=lambda n: (n["tipo"] != "temporal", n["nombre"]))
    return {"negocios": resultado}


def producto_publico(p):
    return {
        "id": p["id"],
        "negocio_id": p["negocio_id"],
        "nombre": p["nombre"],
        "descripcion": p.get("descripcion", ""),
        "precio": p["precio"],
        "stock": max(0, p.get("stock", 0)),
        "emoji": p.get("emoji", "🍽️"),
        "activo": p.get("activo", True),
    }


@ruta("GET", "/negocios/" + ID)
def ver_negocio(req):
    n = db.obtener(db.NEGOCIOS, v.identificador(req.params["id"]))
    if not n or n.get("estado") != "aprobado":
        raise ApiError(404, "Negocio no encontrado.")
    productos = db.escanear(db.PRODUCTOS, lambda p: p["negocio_id"] == n["id"] and p.get("activo"))
    productos.sort(key=lambda p: p["nombre"])
    return {"negocio": negocio_publico(n), "productos": [producto_publico(p) for p in productos]}


# ---------------- Autenticación ----------------

@ruta("POST", "/auth/registro")
def registro(req):
    b = req.body
    nombre = v.texto(b.get("nombre"), "nombre", 2, 60)
    correo = v.email(b.get("email"))
    password = v.password(b.get("password"))
    rol = v.opcion(b.get("rol", "cliente"), "rol", ["cliente", "negocio"])
    if b.get("acepta_terminos") is not True:
        raise ApiError(400, "Debes aceptar el aviso de privacidad y los términos.")
    codigo = b.get("codigo_admin")
    if codigo:
        if not ADMIN_CODE or not hmac.compare_digest(str(codigo), ADMIN_CODE):
            raise ApiError(403, "El código de administrador no es correcto.")
        rol = "admin"
    salt, derivada = _hash_password(password)
    usuario = {
        "email": correo, "nombre": nombre, "rol": rol, "salt": salt, "hash": derivada,
        "creado": ahora_iso(), "acepto_terminos": ahora_iso(), "intentos_fallidos": 0,
    }
    if not db.crear(db.USUARIOS, usuario):
        raise ApiError(409, "Ya existe una cuenta con ese correo.")
    return {"token": crear_token(usuario), "usuario": usuario_publico(usuario)}


@ruta("POST", "/auth/login")
def login(req):
    correo = v.email(req.body.get("email"))
    password = req.body.get("password")
    if not isinstance(password, str) or not password:
        raise ApiError(400, "Escribe tu contraseña.")
    usuario = db.obtener(db.USUARIOS, correo)
    if usuario and usuario.get("bloqueado_hasta", 0) > time.time():
        raise ApiError(429, "Demasiados intentos fallidos. Espera 10 minutos.")
    if not usuario:
        _hash_password(password)  # mismo tiempo de respuesta exista o no el correo
        raise ApiError(400, "Correo o contraseña incorrectos.")
    if not _verificar_password(password[:72], usuario):
        fallidos = usuario.get("intentos_fallidos", 0) + 1
        cambios = {"intentos_fallidos": fallidos}
        if fallidos >= 5:
            cambios = {"intentos_fallidos": 0, "bloqueado_hasta": int(time.time()) + 600}
        db.actualizar(db.USUARIOS, correo, cambios)
        raise ApiError(400, "Correo o contraseña incorrectos.")
    if usuario.get("intentos_fallidos"):
        db.actualizar(db.USUARIOS, correo, {"intentos_fallidos": 0})
    return {"token": crear_token(usuario), "usuario": usuario_publico(usuario)}


@ruta("GET", "/auth/yo", TODOS)
def yo(req):
    return {"usuario": usuario_publico(req.usuario)}


# ---------------- Negocio: perfil y verificación ----------------

def mi_negocio(usuario, obligatorio=True):
    negocio = db.obtener(db.NEGOCIOS, usuario["negocio_id"]) if usuario.get("negocio_id") else None
    if obligatorio and not negocio:
        raise ApiError(404, "Primero registra tu negocio.")
    return negocio


def resumen_negocio(n):
    return {
        "ventas_total": n.get("ventas_total", 0),
        "comision_total": n.get("comision_total", 0),
        "pedidos_completados": n.get("pedidos_completados", 0),
        "neto_a_depositar": n.get("neto_a_depositar", 0),
        "saldo_por_liquidar": n.get("saldo_por_liquidar", 0),
        "comision_pct": COMISION_PCT[n["tipo"]],
    }


@ruta("GET", "/negocio", ("negocio",))
def ver_mi_negocio(req):
    n = mi_negocio(req.usuario, obligatorio=False)
    if not n:
        return {"negocio": None, "productos": [], "comision_pct": COMISION_PCT, "dominio_institucional": DOMINIO}
    productos = db.escanear(db.PRODUCTOS, lambda p: p["negocio_id"] == n["id"])
    productos.sort(key=lambda p: p["nombre"])
    datos = negocio_publico(n)
    datos.update({
        "verificacion": n.get("verificacion"),
        "documento_subido": bool(n.get("doc_key")),
        "revision": n.get("revision"),
        "resumen": resumen_negocio(n),
    })
    return {"negocio": datos, "productos": [producto_publico(p) for p in productos], "comision_pct": COMISION_PCT}


def _datos_negocio(b, tipo, parcial):
    """Valida los campos editables del perfil del negocio."""
    datos = {}
    if not parcial or "nombre" in b:
        datos["nombre"] = v.texto(b.get("nombre"), "nombre del negocio", 3, 50)
    if not parcial or "descripcion" in b:
        datos["descripcion"] = v.texto(b.get("descripcion"), "descripción", 0, 160, requerido=False)
    if not parcial or "categoria" in b:
        datos["categoria"] = v.opcion(b.get("categoria"), "categoría", CATEGORIAS)
    if not parcial or "emoji" in b:
        datos["emoji"] = v.opcion(b.get("emoji"), "emoji", EMOJIS)
    if tipo == "fijo":
        if not parcial or "ubicacion" in b:
            datos["ubicacion"] = v.texto(b.get("ubicacion"), "ubicación", 3, 80)
        if not parcial or "apertura" in b or "cierre" in b:
            apertura = v.hora(b.get("apertura"), "apertura")
            cierre = v.hora(b.get("cierre"), "cierre")
            if minutos(apertura) >= minutos(cierre):
                raise ApiError(400, "La hora de apertura debe ser antes del cierre.")
            datos.update({"apertura": apertura, "cierre": cierre})
    else:
        if not parcial or "ventana" in b:
            ventana = b.get("ventana") if isinstance(b.get("ventana"), dict) else {}
            fecha = v.fecha(ventana.get("fecha"), "fecha de venta")
            inicio = v.hora(ventana.get("inicio"), "inicio")
            fin = v.hora(ventana.get("fin"), "fin")
            hoy = ahora().date()
            if not (hoy.isoformat() <= fecha <= (hoy + timedelta(days=30)).isoformat()):
                raise ApiError(400, "La fecha de venta debe ser entre hoy y los próximos 30 días.")
            if minutos(inicio) >= minutos(fin):
                raise ApiError(400, "La hora de inicio debe ser antes del fin.")
            datos["ventana"] = {"fecha": fecha, "inicio": inicio, "fin": fin}
        if not parcial or "puntos_encuentro" in b:
            puntos = v.lista(b.get("puntos_encuentro"), "puntos de encuentro", 1, 3)
            for p in puntos:
                v.opcion(p, "punto de encuentro", PUNTOS_ENCUENTRO)
            datos["puntos_encuentro"] = list(dict.fromkeys(puntos))
    return datos


@ruta("POST", "/negocio", ("negocio",))
def guardar_negocio(req):
    b = req.body
    actual = mi_negocio(req.usuario, obligatorio=False)
    if actual:
        cambios = _datos_negocio(b, actual["tipo"], parcial=True)
        if not cambios:
            raise ApiError(400, "No hay cambios que guardar.")
        cambios["actualizado"] = ahora_iso()
        db.actualizar(db.NEGOCIOS, actual["id"], cambios)
        return ver_mi_negocio(req)

    tipo = v.opcion(b.get("tipo"), "tipo", ["fijo", "temporal"])
    if tipo == "temporal" and DOMINIO and not req.usuario["email"].endswith("@" + DOMINIO):
        raise ApiError(403, f"Para vender como estudiante necesitas una cuenta con correo @{DOMINIO}.")
    datos = _datos_negocio(b, tipo, parcial=False)
    negocio = {
        "id": nuevo_id("NEG-"), "owner_email": req.usuario["email"], "owner_nombre": req.usuario["nombre"],
        "tipo": tipo, "estado": "pendiente", "creado": ahora_iso(),
        "ventas_total": 0, "comision_total": 0, "pedidos_completados": 0,
        "neto_a_depositar": 0, "saldo_por_liquidar": 0,
    }
    negocio.update(datos)
    db.crear(db.NEGOCIOS, negocio)
    db.actualizar(db.USUARIOS, req.usuario["email"], {"negocio_id": negocio["id"]})
    req.usuario["negocio_id"] = negocio["id"]
    return ver_mi_negocio(req)


@ruta("POST", "/negocio/documento", ("negocio",))
def subir_documento(req):
    n = mi_negocio(req.usuario)
    nombre = v.texto(req.body.get("nombre_responsable"), "nombre del responsable", 3, 80)
    imagen, formato = v.imagen(req.body.get("imagen"))
    if not db.consumir_cuota(db.NEGOCIOS, n["id"], "docs", "total", LIMITE_DOCUMENTOS):
        raise ApiError(429, "Alcanzaste el máximo de documentos. Contacta a soporte.")

    cambios = {"doc_subido": ahora_iso()}
    if BUCKET_DOCS:
        clave = f"verificaciones/{n['id']}/{uuid.uuid4().hex}.{'jpg' if formato == 'jpeg' else 'png'}"
        s3().put_object(
            Bucket=BUCKET_DOCS, Key=clave, Body=imagen,
            ContentType=f"image/{formato}", ServerSideEncryption="AES256",
        )
        cambios["doc_key"] = clave
    else:
        log.warning("BUCKET_DOCS no está configurado: el documento no se guardó.")

    resultado = ia.analizar_documento(imagen, formato, nombre, n["tipo"])
    resultado.update({"fecha": ahora_iso(), "nombre_declarado": nombre})
    cambios["verificacion"] = resultado
    if n.get("estado") != "aprobado":
        cambios["estado"] = "pendiente"
    db.actualizar(db.NEGOCIOS, n["id"], cambios)
    return {"verificacion": resultado, "documento_guardado": bool(BUCKET_DOCS)}


# ---------------- Negocio: productos ----------------

def _producto_propio(usuario, producto_id):
    n = mi_negocio(usuario)
    p = db.obtener(db.PRODUCTOS, v.identificador(producto_id))
    if not p or p["negocio_id"] != n["id"]:
        raise ApiError(404, "Producto no encontrado.")
    return n, p


@ruta("POST", "/negocio/productos", ("negocio",))
def crear_producto(req):
    n = mi_negocio(req.usuario)
    existentes = db.escanear(db.PRODUCTOS, lambda p: p["negocio_id"] == n["id"])
    if len(existentes) >= MAX_PRODUCTOS:
        raise ApiError(400, f"Máximo {MAX_PRODUCTOS} productos por negocio.")
    b = req.body
    producto = {
        "id": nuevo_id("PRD-"), "negocio_id": n["id"],
        "nombre": v.texto(b.get("nombre"), "nombre", 2, 50),
        "descripcion": v.texto(b.get("descripcion"), "descripción", 0, 120, requerido=False),
        "precio": v.precio_a_centavos(b.get("precio")),
        "stock": v.entero(b.get("stock"), "stock", 0, 999),
        "emoji": v.opcion(b.get("emoji", n.get("emoji", "🌮")), "emoji", EMOJIS),
        "activo": True, "creado": ahora_iso(),
    }
    db.crear(db.PRODUCTOS, producto)
    return {"producto": producto_publico(producto)}


@ruta("PUT", "/negocio/productos/" + ID, ("negocio",))
def editar_producto(req):
    _, p = _producto_propio(req.usuario, req.params["id"])
    b, cambios = req.body, {}
    if "nombre" in b:
        cambios["nombre"] = v.texto(b["nombre"], "nombre", 2, 50)
    if "descripcion" in b:
        cambios["descripcion"] = v.texto(b["descripcion"], "descripción", 0, 120, requerido=False)
    if "precio" in b:
        cambios["precio"] = v.precio_a_centavos(b["precio"])
    if "stock" in b:
        cambios["stock"] = v.entero(b["stock"], "stock", 0, 999)
    if "activo" in b:
        if not isinstance(b["activo"], bool):
            raise ApiError(400, "El campo 'activo' debe ser verdadero o falso.")
        cambios["activo"] = b["activo"]
    if "emoji" in b:
        cambios["emoji"] = v.opcion(b["emoji"], "emoji", EMOJIS)
    if not cambios:
        raise ApiError(400, "No hay cambios que guardar.")
    cambios["actualizado"] = ahora_iso()
    return {"producto": producto_publico(db.actualizar(db.PRODUCTOS, p["id"], cambios))}


# ---------------- Pedidos ----------------

def _devolver_stock(pedido):
    for item in pedido["items"]:
        db.devolver_stock(item["producto_id"], item["cantidad"])


def _vencer_si_corresponde(pedido):
    """Vencimiento perezoso: se revisa cada vez que alguien consulta el pedido."""
    if (pedido["tipo"] == "temporal" and pedido["estado"] in ("apartado", "aceptado")
            and pedido.get("reserva_expira", 0) < time.time()):
        vencido = db.cambiar_estado_pedido(pedido["id"], ["apartado", "aceptado"], "vencido", ahora_iso())
        if vencido:
            _devolver_stock(pedido)
            return vencido
        return db.obtener(db.PEDIDOS, pedido["id"]) or pedido
    return pedido


def _registrar_venta(pedido):
    sumas = {
        "ventas_total": pedido["total"],
        "comision_total": pedido["comision_total"],
        "pedidos_completados": 1,
    }
    if pedido["tipo"] == "fijo":
        sumas["neto_a_depositar"] = pedido["total"] - pedido["comision_total"]
    else:
        sumas["saldo_por_liquidar"] = pedido["comision_total"]
    db.sumar(db.NEGOCIOS, pedido["negocio_id"], sumas)


def vista_cliente(p):
    datos = {k: p.get(k) for k in (
        "id", "negocio_id", "negocio_nombre", "negocio_emoji", "tipo", "estado", "pago", "horario",
        "punto_encuentro", "total", "creado", "historial", "codigo_bloqueado")}
    datos["items"] = [{k: i[k] for k in ("nombre", "cantidad", "precio", "subtotal")} for i in p["items"]]
    if p["tipo"] == "temporal" and p["estado"] in ("apartado", "aceptado"):
        datos["codigo"] = p.get("codigo")
    datos["puede_cancelar"] = (p["estado"] == "pagado") if p["tipo"] == "fijo" else (p["estado"] in ("apartado", "aceptado"))
    return datos


def vista_negocio(p):
    datos = {k: p.get(k) for k in (
        "id", "cliente_nombre", "tipo", "estado", "pago", "horario", "punto_encuentro",
        "total", "comision_total", "creado", "historial", "codigo_bloqueado")}
    datos["items"] = p["items"]
    datos["neto"] = p["total"] - p["comision_total"]
    datos["intentos_restantes"] = max(0, MAX_INTENTOS_CODIGO - p.get("intentos_codigo", 0))
    acciones = [a for a, (desde, _) in ACCIONES[p["tipo"]].items() if p["estado"] in desde]
    if p["tipo"] == "temporal" and p["estado"] in ("apartado", "aceptado") and not p.get("codigo_bloqueado"):
        acciones.append("completar")
    datos["acciones"] = acciones
    return datos


def _validar_horario(n, horario):
    if n["tipo"] == "fijo":
        if horario == "asap":
            return horario
        v.hora(horario)
        if not (minutos(n["apertura"]) <= minutos(horario) <= minutos(n["cierre"])):
            raise ApiError(400, f"Elige un horario entre {n['apertura']} y {n['cierre']}.")
        return horario
    ventana = n["ventana"]
    v.hora(horario)
    if not (minutos(ventana["inicio"]) <= minutos(horario) <= minutos(ventana["fin"])):
        raise ApiError(400, f"Elige un horario entre {ventana['inicio']} y {ventana['fin']}.")
    return horario


@ruta("POST", "/pedidos", COMPRADORES)
def crear_pedido(req):
    b, usuario = req.body, req.usuario
    n = db.obtener(db.NEGOCIOS, v.identificador(b.get("negocio_id"), "negocio"))
    if not n or n.get("estado") != "aprobado":
        raise ApiError(404, "Este negocio no está disponible.")
    if n["owner_email"] == usuario["email"]:
        raise ApiError(400, "No puedes pedirle a tu propio negocio.")
    tipo = n["tipo"]
    if tipo == "temporal" and estado_ventana(n) != "abierta":
        raise ApiError(409, "Este vendedor no tiene venta abierta hoy.")

    lineas = v.lista(b.get("items"), "productos", 1, 10)
    cantidades = {}
    for linea in lineas:
        if not isinstance(linea, dict):
            raise ApiError(400, "Formato de productos no válido.")
        pid = v.identificador(linea.get("producto_id"), "producto")
        cantidades[pid] = cantidades.get(pid, 0) + v.entero(linea.get("cantidad"), "cantidad", 1, 10)
    if sum(cantidades.values()) > 20:
        raise ApiError(400, "Máximo 20 piezas por pedido.")

    horario = _validar_horario(n, b.get("horario"))
    metodo = v.opcion(b.get("metodo_pago"), "método de pago", METODOS[tipo])
    punto = None
    if tipo == "temporal":
        punto = v.opcion(b.get("punto_encuentro"), "punto de encuentro", n.get("puntos_encuentro", []))
        activos = db.escanear(db.PEDIDOS, lambda p: p["cliente_email"] == usuario["email"]
                              and p["tipo"] == "temporal" and p["estado"] in ("apartado", "aceptado"))
        activos = [p for p in map(_vencer_si_corresponde, activos) if p["estado"] in ("apartado", "aceptado")]
        if len(activos) >= MAX_APARTADOS:
            raise ApiError(409, f"Ya tienes {MAX_APARTADOS} apartados activos. Recoge o cancela uno antes de apartar otro.")

    items, total, comision_total = [], 0, 0
    for pid, cantidad in cantidades.items():
        p = db.obtener(db.PRODUCTOS, pid)
        if not p or p["negocio_id"] != n["id"] or not p.get("activo"):
            raise ApiError(400, "Uno de los productos ya no está disponible.")
        unitaria = comision_unitaria(p["precio"], tipo)
        items.append({
            "producto_id": pid, "nombre": p["nombre"], "cantidad": cantidad, "precio": p["precio"],
            "subtotal": p["precio"] * cantidad, "comision_unitaria": unitaria, "comision": unitaria * cantidad,
        })
        total += p["precio"] * cantidad
        comision_total += unitaria * cantidad

    reservados = []
    for item in items:
        if not db.reservar_stock(item["producto_id"], item["cantidad"]):
            for r in reservados:
                db.devolver_stock(r["producto_id"], r["cantidad"])
            raise ApiError(409, f"Ya no hay suficiente stock de {item['nombre']}.")
        reservados.append(item)

    momento = ahora_iso()
    pedido = {
        "id": nuevo_id("P"), "tipo": tipo, "negocio_id": n["id"], "negocio_nombre": n["nombre"],
        "negocio_emoji": n.get("emoji", "🍽️"), "cliente_email": usuario["email"],
        "cliente_nombre": usuario["nombre"], "items": items, "total": total,
        "comision_total": comision_total, "horario": horario, "creado": momento, "actualizado": momento,
    }
    if tipo == "fijo":
        pedido.update({"estado": "pagado", "pago": {"modo": "en_app", "metodo": metodo, "estado": "pagado_simulado"}})
    else:
        fin = datetime.fromisoformat(f"{n['ventana']['fecha']}T{n['ventana']['fin']}:00").replace(tzinfo=ZONA)
        pedido.update({
            "estado": "apartado", "punto_encuentro": punto,
            "pago": {"modo": "directo", "metodo": metodo, "estado": "por_acordar"},
            "codigo": f"{secrets.randbelow(10 ** 6):06d}", "intentos_codigo": 0, "codigo_bloqueado": False,
            "reserva_expira": int((fin + timedelta(minutes=MINUTOS_GRACIA_APARTADO)).timestamp()),
        })
    pedido["historial"] = [{"estado": pedido["estado"], "ts": momento}]
    try:
        db.crear(db.PEDIDOS, pedido)
    except Exception:
        for r in reservados:
            db.devolver_stock(r["producto_id"], r["cantidad"])
        raise
    return {"pedido": vista_cliente(pedido)}


@ruta("GET", "/pedidos/mios", TODOS)
def mis_pedidos(req):
    pedidos = db.escanear(db.PEDIDOS, lambda p: p["cliente_email"] == req.usuario["email"])
    pedidos = [_vencer_si_corresponde(p) for p in pedidos]
    pedidos.sort(key=lambda p: p["creado"], reverse=True)
    return {"pedidos": [vista_cliente(p) for p in pedidos[:50]]}


@ruta("POST", "/pedidos/" + ID + "/cancelar", TODOS)
def cancelar_pedido(req):
    p = db.obtener(db.PEDIDOS, v.identificador(req.params["id"]))
    if not p or p["cliente_email"] != req.usuario["email"]:
        raise ApiError(404, "Pedido no encontrado.")
    p = _vencer_si_corresponde(p)
    if p["tipo"] == "fijo":
        pago = dict(p["pago"], estado="reembolsado_simulado")
        nuevo = db.cambiar_estado_pedido(p["id"], ["pagado"], "cancelado", ahora_iso(), {"pago": pago})
    else:
        nuevo = db.cambiar_estado_pedido(p["id"], ["apartado", "aceptado"], "cancelado", ahora_iso())
    if not nuevo:
        raise ApiError(409, "Este pedido ya no se puede cancelar.")
    _devolver_stock(p)
    return {"pedido": vista_cliente(nuevo)}


@ruta("GET", "/negocio/pedidos", ("negocio",))
def pedidos_negocio(req):
    n = mi_negocio(req.usuario)
    pedidos = db.escanear(db.PEDIDOS, lambda p: p["negocio_id"] == n["id"])
    pedidos = [_vencer_si_corresponde(p) for p in pedidos]
    pedidos.sort(key=lambda p: (p["estado"] not in ACTIVOS, p["creado"]), reverse=False)
    activos = [p for p in pedidos if p["estado"] in ACTIVOS]
    cerrados = sorted([p for p in pedidos if p["estado"] not in ACTIVOS], key=lambda p: p["creado"], reverse=True)
    return {
        "activos": [vista_negocio(p) for p in activos],
        "cerrados": [vista_negocio(p) for p in cerrados[:30]],
        "resumen": resumen_negocio(db.obtener(db.NEGOCIOS, n["id"])),
    }


def _pedido_de_mi_negocio(usuario, pedido_id):
    n = mi_negocio(usuario)
    p = db.obtener(db.PEDIDOS, v.identificador(pedido_id))
    if not p or p["negocio_id"] != n["id"]:
        raise ApiError(404, "Pedido no encontrado.")
    return _vencer_si_corresponde(p)


@ruta("POST", "/negocio/pedidos/" + ID + "/accion", ("negocio",))
def accion_pedido(req):
    p = _pedido_de_mi_negocio(req.usuario, req.params["id"])
    accion = v.opcion(req.body.get("accion"), "acción", list(ACCIONES[p["tipo"]].keys()))
    desde, hacia = ACCIONES[p["tipo"]][accion]
    extra = {}
    if accion == "rechazar" and p["tipo"] == "fijo":
        extra["pago"] = dict(p["pago"], estado="reembolsado_simulado")
    if accion == "entregar":
        extra["pago"] = dict(p["pago"], estado="liquidado_simulado")
    nuevo = db.cambiar_estado_pedido(p["id"], desde, hacia, ahora_iso(), extra)
    if not nuevo:
        raise ApiError(409, "El pedido cambió de estado. Actualiza la lista.")
    if accion == "rechazar":
        _devolver_stock(p)
    if accion == "entregar":
        _registrar_venta(nuevo)
    return {"pedido": vista_negocio(nuevo)}


@ruta("POST", "/negocio/pedidos/" + ID + "/completar", ("negocio",))
def completar_apartado(req):
    p = _pedido_de_mi_negocio(req.usuario, req.params["id"])
    if p["tipo"] != "temporal":
        raise ApiError(400, "Solo los apartados se completan con código.")
    if p["estado"] not in ("apartado", "aceptado"):
        raise ApiError(409, "Este apartado ya no está activo.")
    if p.get("codigo_bloqueado"):
        raise ApiError(423, "Pedido bloqueado por demasiados códigos incorrectos. Contacten a soporte.")
    codigo = str(req.body.get("codigo", "")).strip()
    if not re.fullmatch(r"\d{6}", codigo) or not hmac.compare_digest(codigo, p["codigo"]):
        intentos = db.registrar_intento_codigo(p["id"], MAX_INTENTOS_CODIGO)
        restantes = max(0, MAX_INTENTOS_CODIGO - intentos)
        if restantes == 0:
            raise ApiError(423, "Código incorrecto. El pedido se bloqueó por seguridad.")
        raise ApiError(400, f"Código incorrecto. Te quedan {restantes} intentos.")
    pago = dict(p["pago"], estado="pagado_en_persona")
    nuevo = db.cambiar_estado_pedido(p["id"], ["apartado", "aceptado"], "completado", ahora_iso(), {"pago": pago})
    if not nuevo:
        raise ApiError(409, "Este apartado ya no está activo.")
    _registrar_venta(nuevo)
    return {"pedido": vista_negocio(nuevo)}


# ---------------- Soporte ----------------

ETIQUETA_ESTADO = {
    "pagado": "pagado", "preparando": "en preparación", "listo": "listo para recoger", "entregado": "entregado",
    "apartado": "apartado", "aceptado": "aceptado por el vendedor", "completado": "completado",
    "cancelado": "cancelado", "rechazado": "rechazado", "vencido": "vencido",
}


@ruta("POST", "/soporte/chat", TODOS)
def chat_soporte(req):
    mensaje = v.texto(req.body.get("mensaje"), "mensaje", 1, 500, una_linea=False)
    historial = []
    for turno in v.lista(req.body.get("historial"), "historial", 0, 8):
        if isinstance(turno, dict) and turno.get("rol") in ("usuario", "asistente"):
            historial.append({"rol": turno["rol"], "texto": v.texto(turno.get("texto"), "historial", 1, 700, una_linea=False)})
    ventana = int(time.time() // 3600)
    if not db.consumir_cuota(db.USUARIOS, req.usuario["email"], "ia", ventana, LIMITE_IA_HORA):
        raise ApiError(429, "Llegaste al límite de mensajes por hora. Usa 'Hablar con una persona'.")
    pedidos = db.escanear(db.PEDIDOS, lambda p: p["cliente_email"] == req.usuario["email"])
    pedidos.sort(key=lambda p: p["creado"], reverse=True)
    contexto = "\n".join(
        f"- Pedido {p['id']} en {p['negocio_nombre']} ({'apartado con vendedor temporal' if p['tipo'] == 'temporal' else 'negocio fijo'}): "
        f"{ETIQUETA_ESTADO.get(p['estado'], p['estado'])}, horario {p['horario']}, total ${p['total'] / 100:.2f}"
        for p in pedidos[:5]
    )
    texto, sugerir, modelo = ia.responder_soporte(mensaje, historial, contexto)
    log.info("Soporte respondió con modelo %s", modelo)
    return {"respuesta": texto, "sugerir_persona": sugerir}


@ruta("POST", "/soporte/ticket", TODOS)
def crear_ticket(req):
    ticket = {
        "id": nuevo_id("T", 6), "email": req.usuario["email"], "nombre": req.usuario["nombre"],
        "rol": req.usuario["rol"],
        "mensaje": v.texto(req.body.get("mensaje"), "mensaje", 5, 600, una_linea=False),
        "pedido_id": v.texto(req.body.get("pedido_id"), "pedido", 0, 20, requerido=False),
        "estado": "abierto", "creado": ahora_iso(),
    }
    db.crear(db.TICKETS, ticket)
    return {"ticket": {"id": ticket["id"], "estado": ticket["estado"]}}


# ---------------- Administración ----------------

ADMIN = ("admin",)


@ruta("GET", "/admin/resumen", ADMIN)
def resumen_admin(req):
    negocios = db.escanear(db.NEGOCIOS)
    pedidos = db.escanear(db.PEDIDOS)
    tickets = db.escanear(db.TICKETS)
    cerrados_ok = [p for p in pedidos if p["estado"] in ("entregado", "completado")]
    return {
        "negocios": {
            "aprobados": sum(n.get("estado") == "aprobado" for n in negocios),
            "pendientes": sum(n.get("estado") == "pendiente" for n in negocios),
            "fijos": sum(n["tipo"] == "fijo" for n in negocios),
            "temporales": sum(n["tipo"] == "temporal" for n in negocios),
        },
        "pedidos": {
            "total": len(pedidos),
            "activos": sum(p["estado"] in ACTIVOS for p in pedidos),
            "completados": len(cerrados_ok),
            "cancelados": sum(p["estado"] in ("cancelado", "rechazado", "vencido") for p in pedidos),
        },
        "ventas_total": sum(p["total"] for p in cerrados_ok),
        "comision_total": sum(p["comision_total"] for p in cerrados_ok),
        "comision_por_cobrar": sum(n.get("saldo_por_liquidar", 0) for n in negocios),
        "tickets_abiertos": sum(t.get("estado") == "abierto" for t in tickets),
        "comision_pct": COMISION_PCT,
    }


@ruta("GET", "/admin/negocios", ADMIN)
def negocios_admin(req):
    estado = req.query.get("estado")
    negocios = db.escanear(db.NEGOCIOS)
    if estado in ("pendiente", "aprobado", "rechazado"):
        negocios = [n for n in negocios if n.get("estado") == estado]
    negocios.sort(key=lambda n: (n.get("estado") != "pendiente", n.get("creado", "")))
    resultado = []
    for n in negocios:
        datos = negocio_publico(n)
        datos.update({
            "owner_email": n["owner_email"], "owner_nombre": n.get("owner_nombre"),
            "verificacion": n.get("verificacion"), "documento_subido": bool(n.get("doc_key")),
            "revision": n.get("revision"), "resumen": resumen_negocio(n), "creado": n.get("creado"),
        })
        resultado.append(datos)
    return {"negocios": resultado}


@ruta("GET", "/admin/negocios/" + ID + "/documento", ADMIN)
def documento_admin(req):
    n = db.obtener(db.NEGOCIOS, v.identificador(req.params["id"]))
    if not n or not n.get("doc_key") or not BUCKET_DOCS:
        raise ApiError(404, "Este negocio no tiene documento guardado.")
    url = s3().generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET_DOCS, "Key": n["doc_key"]}, ExpiresIn=300)
    return {"url": url, "expira_en_segundos": 300}


@ruta("POST", "/admin/negocios/" + ID + "/decision", ADMIN)
def decidir_negocio(req):
    n = db.obtener(db.NEGOCIOS, v.identificador(req.params["id"]))
    if not n:
        raise ApiError(404, "Negocio no encontrado.")
    decision = v.opcion(req.body.get("decision"), "decisión", ["aprobar", "rechazar"])
    nota = v.texto(req.body.get("nota"), "nota", 0, 200, requerido=False)
    estado = "aprobado" if decision == "aprobar" else "rechazado"
    db.actualizar(db.NEGOCIOS, n["id"], {
        "estado": estado, "revision": {"por": req.usuario["email"], "fecha": ahora_iso(), "nota": nota, "decision": estado},
    })
    return {"ok": True, "estado": estado}


@ruta("POST", "/admin/negocios/" + ID + "/liquidar", ADMIN)
def liquidar_comision(req):
    n = db.obtener(db.NEGOCIOS, v.identificador(req.params["id"]))
    if not n:
        raise ApiError(404, "Negocio no encontrado.")
    monto = n.get("saldo_por_liquidar", 0)
    db.actualizar(db.NEGOCIOS, n["id"], {"saldo_por_liquidar": 0, "ultima_liquidacion": {"monto": monto, "fecha": ahora_iso()}})
    return {"ok": True, "liquidado": monto}


@ruta("GET", "/admin/tickets", ADMIN)
def tickets_admin(req):
    tickets = db.escanear(db.TICKETS)
    tickets.sort(key=lambda t: (t.get("estado") != "abierto", t.get("creado", "")), reverse=False)
    return {"tickets": tickets[:100]}


@ruta("POST", "/admin/tickets/" + ID + "/resolver", ADMIN)
def resolver_ticket(req):
    t = db.obtener(db.TICKETS, v.identificador(req.params["id"]))
    if not t:
        raise ApiError(404, "Ticket no encontrado.")
    db.actualizar(db.TICKETS, t["id"], {"estado": "resuelto", "resuelto": ahora_iso(), "resuelto_por": req.usuario["email"]})
    return {"ok": True}


# ---------------- Datos de ejemplo ----------------

def _usuario_demo(email, nombre, rol, negocio_id=None):
    salt, derivada = _hash_password(DEMO_PASSWORD)
    usuario = {"email": email, "nombre": nombre, "rol": rol, "salt": salt, "hash": derivada,
               "creado": ahora_iso(), "acepto_terminos": ahora_iso(), "intentos_fallidos": 0, "demo": True}
    if negocio_id:
        usuario["negocio_id"] = negocio_id
    db.guardar(db.USUARIOS, usuario)


DEMO_NEGOCIOS = [
    {"id": "NEG-DEMO-CAFE", "nombre": "Café Central", "tipo": "fijo", "categoria": "Bebidas", "emoji": "☕",
     "descripcion": "Café de especialidad y algo rápido entre clases.", "ubicacion": "Cafetería central",
     "apertura": "07:00", "cierre": "21:00", "owner": ("cafe@lionpickup.demo", "Café Central (demo)"),
     "productos": [("Americano", "Grano de Chiapas, 12 oz", 3500, 50, "☕"),
                   ("Latte", "Con leche entera o de avena", 4800, 40, "☕"),
                   ("Chai frío", "Especiado y con hielo", 5500, 25, "🧃"),
                   ("Bagel de queso crema", "Recién horneado", 4500, 15, "🥐")]},
    {"id": "NEG-DEMO-COCINA", "nombre": "Cocina Yucateca", "tipo": "fijo", "categoria": "Comida", "emoji": "🌮",
     "descripcion": "Antojitos yucatecos hechos al momento.", "ubicacion": "Food court, local 3",
     "apertura": "08:00", "cierre": "20:00", "owner": ("cocina@lionpickup.demo", "Cocina Yucateca (demo)"),
     "productos": [("Panuchos (3 pzas)", "De cochinita o pollo", 6500, 30, "🌮"),
                   ("Salbutes (3 pzas)", "Con pavo y cebolla morada", 6000, 30, "🌮"),
                   ("Torta de cochinita", "Con cebolla encurtida", 7000, 25, "🥪"),
                   ("Agua de horchata", "Medio litro", 2500, 40, "🥤")]},
    {"id": "NEG-DEMO-BOWL", "nombre": "Bowl & Go", "tipo": "fijo", "categoria": "Saludable", "emoji": "🥗",
     "descripcion": "Bowls y ensaladas para comer ligero.", "ubicacion": "Pasillo central",
     "apertura": "09:00", "cierre": "19:00", "owner": ("bowl@lionpickup.demo", "Bowl & Go (demo)"),
     "productos": [("Bowl de pollo", "Arroz, pollo, verduras y aderezo de la casa", 9500, 20, "🍱"),
                   ("Ensalada César", "Con pollo a la plancha", 8500, 15, "🥗"),
                   ("Smoothie verde", "Espinaca, piña y plátano", 5500, 20, "🥤")]},
    {"id": "NEG-DEMO-BROWNIES", "nombre": "Brownies de Sofi", "tipo": "temporal", "categoria": "Postres", "emoji": "🧁",
     "descripcion": "Brownies caseros de una estudiante de Diseño.", "puntos": ["Biblioteca", "Explanada central"],
     "owner": ("sofi@lionpickup.demo", "Sofía (vendedora demo)"),
     "productos": [("Brownie clásico", "Chocolate semiamargo", 2500, 24, "🍫"),
                   ("Brownie con nuez", "Con nuez pecana", 3000, 12, "🍫"),
                   ("Galleta de chispas", "Grande y suave", 2000, 20, "🍪")]},
    {"id": "NEG-DEMO-MARQUESITAS", "nombre": "Marquesitas de Dani", "tipo": "temporal", "categoria": "Postres",
     "emoji": "🌯", "descripcion": "Marquesitas recién hechas, como en el centro.",
     "puntos": ["Entrada principal", "Estacionamiento de alumnos"],
     "owner": ("dani@lionpickup.demo", "Daniel (vendedor demo)"),
     "productos": [("Marquesita de queso de bola", "La clásica", 4500, 15, "🌯"),
                   ("Marquesita Nutella y queso", "La favorita", 5500, 15, "🌯"),
                   ("Marquesita de cajeta", "Dulce y crujiente", 5000, 10, "🌯")]},
    {"id": "NEG-DEMO-GALLETAS", "nombre": "Galletas de Mau", "tipo": "temporal", "categoria": "Snacks", "emoji": "🍪",
     "descripcion": "Galletas de avena y crema de cacahuate.", "puntos": ["Biblioteca"],
     "owner": ("mau@lionpickup.demo", "Mauricio (vendedor demo)"), "pendiente": True,
     "productos": [("Galleta de avena", "Con pasas", 1800, 30, "🍪")]},
]


@ruta("POST", "/admin/demo", ADMIN)
def cargar_demo(req):
    hoy = ahora().date()
    _usuario_demo("cliente@lionpickup.demo", "Ana (cliente demo)", "cliente")
    creados = []
    for d in DEMO_NEGOCIOS:
        negocio = {
            "id": d["id"], "nombre": d["nombre"], "tipo": d["tipo"], "categoria": d["categoria"],
            "emoji": d["emoji"], "descripcion": d["descripcion"], "owner_email": d["owner"][0],
            "owner_nombre": d["owner"][1], "estado": "pendiente" if d.get("pendiente") else "aprobado",
            "creado": ahora_iso(), "demo": True, "ventas_total": 0, "comision_total": 0,
            "pedidos_completados": 0, "neto_a_depositar": 0, "saldo_por_liquidar": 0,
        }
        if d["tipo"] == "fijo":
            negocio.update({"ubicacion": d["ubicacion"], "apertura": d["apertura"], "cierre": d["cierre"]})
        else:
            fecha = (hoy + timedelta(days=1) if d.get("pendiente") else hoy).isoformat()
            negocio.update({"ventana": {"fecha": fecha, "inicio": "07:00", "fin": "22:00"},
                            "puntos_encuentro": d["puntos"]})
        if not d.get("pendiente"):
            negocio["revision"] = {"por": "datos de ejemplo", "fecha": ahora_iso(), "nota": "Negocio de demostración", "decision": "aprobado"}
        db.guardar(db.NEGOCIOS, negocio)
        _usuario_demo(d["owner"][0], d["owner"][1], "negocio", d["id"])
        for i, (nombre, desc, precio, stock, emoji) in enumerate(d["productos"], start=1):
            db.guardar(db.PRODUCTOS, {
                "id": f"{d['id']}-P{i}", "negocio_id": d["id"], "nombre": nombre, "descripcion": desc,
                "precio": precio, "stock": stock, "emoji": emoji, "activo": True, "creado": ahora_iso(), "demo": True,
            })
        creados.append(d["nombre"])
    return {
        "ok": True,
        "negocios": creados,
        "cuentas": {
            "cliente": "cliente@lionpickup.demo",
            "negocio_fijo": "cocina@lionpickup.demo",
            "vendedor_temporal": "sofi@lionpickup.demo",
            "pendiente_de_aprobar": "mau@lionpickup.demo",
        },
        "password_demo": DEMO_PASSWORD,
    }
