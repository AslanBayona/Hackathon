"""Conexión con Amazon Bedrock: asistente de soporte y revisión de documentos.

Modelos (se configuran en las variables de entorno de la Lambda):
  MODEL_SOPORTE   modelo principal del asistente (recomendado: Amazon Nova Pro)
  MODEL_VISION    modelo que acepta imágenes para revisar documentos (Nova Lite o Nova Pro)
  MODEL_RESPALDO  modelo que ya sabes que funciona en tu cuenta (Nova Lite)

Si un modelo falla, se intenta el de respaldo; si también falla, se usa una
respuesta predefinida para que la demo nunca se quede sin contestar.
"""
import json
import logging
import os
import re

import boto3
from botocore.config import Config

log = logging.getLogger()

MODEL_SOPORTE = os.environ.get("MODEL_SOPORTE", "amazon.nova-pro-v1:0").strip()
MODEL_VISION = os.environ.get("MODEL_VISION", "amazon.nova-lite-v1:0").strip()
MODEL_RESPALDO = os.environ.get("MODEL_RESPALDO", "amazon.nova-lite-v1:0").strip()

MARCA_PERSONA = "[[PERSONA]]"

_cliente = None


def _bedrock():
    global _cliente
    if _cliente is None:
        _cliente = boto3.client(
            "bedrock-runtime",
            config=Config(connect_timeout=3, read_timeout=13, retries={"max_attempts": 1}),
        )
    return _cliente


def _modelos(principal):
    vistos, orden = set(), []
    for m in (principal, MODEL_RESPALDO):
        if m and m not in vistos:
            vistos.add(m)
            orden.append(m)
    return orden


def _conversar(modelos, sistema, mensajes, max_tokens, temperatura):
    """Llama a Bedrock probando los modelos en orden. Devuelve (texto, modelo)."""
    ultimo_error = None
    for modelo in modelos:
        try:
            r = _bedrock().converse(
                modelId=modelo,
                system=[{"text": sistema}],
                messages=mensajes,
                inferenceConfig={"maxTokens": max_tokens, "temperature": temperatura},
            )
            partes = r["output"]["message"]["content"]
            texto = "".join(p.get("text", "") for p in partes).strip()
            if texto:
                return texto, modelo
        except Exception as e:  # noqa: BLE001 - se registra y se intenta el siguiente
            ultimo_error = e
            log.warning("Bedrock falló con %s: %r", modelo, e)
    raise RuntimeError(f"Ningún modelo respondió: {ultimo_error!r}")


def _texto_plano(texto):
    texto = texto.replace("**", "").replace("__", "")
    texto = re.sub(r"^#{1,6}\s*", "", texto, flags=re.MULTILINE)
    return texto.strip()


# ---------------- Soporte ----------------

SISTEMA_SOPORTE = """Eres Leo, el asistente de soporte de Lion Pick Up, una app para pedir comida y recogerla dentro del campus universitario. Es un proyecto de demostración de un hackathon.
Responde en español, con tono amable y directo, en máximo 90 palabras, en texto plano sin Markdown ni listas con asteriscos.

Cómo funciona Lion Pick Up:
- Negocios fijos (cafeterías y locales): el pago se hace dentro de la app. En esta demo el pago es simulado. Estados del pedido: pagado, preparando, listo, entregado. El cliente puede cancelar solo mientras el pedido está en "pagado" y el reembolso es automático (simulado).
- Vendedores temporales (estudiantes): la app no cobra nada. El pedido es un apartado: se reserva el producto, el cliente elige punto de encuentro, horario y método de pago, y paga en persona. Para liberar el pedido, el cliente le da al vendedor su código de 6 dígitos y el vendedor lo captura en la app.
- Si un apartado no se concreta, vence al terminar la ventana de venta y el producto vuelve a estar disponible. El cliente puede cancelar un apartado antes de recogerlo.
- Cada cliente puede tener hasta 3 apartados activos. Tras 3 códigos incorrectos el pedido se bloquea por seguridad.
- Los negocios se verifican: la IA revisa su documento y una persona del equipo aprueba.
- La comisión la paga el negocio, no el cliente.
- Los encuentros son en puntos dentro del campus. Recomienda lugares concurridos y no compartir datos personales.

Reglas:
- No inventes datos, horarios ni políticas que no estén aquí.
- Nunca pidas contraseñas, datos de tarjeta, documentos ni el código de 6 dígitos.
- No puedes modificar pedidos; explica cómo hacerlo en la app.
- Si hay un problema de pago, de seguridad, un pedido no entregado, un reembolso, o el usuario pide hablar con una persona, explica en una frase qué pasará y termina tu respuesta exactamente con [[PERSONA]].

Pedidos recientes del usuario (pueden estar vacíos):
{contexto}"""

RESPUESTAS_RESPALDO = [
    (("apartad", "temporal", "código", "codigo", "liberar"),
     "En los vendedores temporales no se cobra en la app: apartas tu pedido, eliges punto de encuentro y pagas en persona. "
     "Al recibirlo, le das tu código de 6 dígitos al vendedor para liberarlo. Si no se concreta, el apartado vence y el producto se libera."),
    (("cancel", "reembols"),
     "Puedes cancelar desde la pestaña Pedidos. En negocios fijos solo mientras el pedido está en 'pagado' (el reembolso simulado es automático); "
     "en apartados, antes de recogerlo."),
    (("pago", "pagar", "tarjeta", "efectivo", "transfer"),
     "En negocios fijos el pago se hace en la app (simulado en esta demo). Con vendedores temporales eliges tu método de pago y lo acuerdan en persona."),
    (("dónde", "donde", "estado", "pedido"),
     "Revisa la pestaña Pedidos: ahí ves el estado en tiempo real, el horario y, si es un apartado, tu punto de encuentro y tu código."),
    (("vender", "negocio", "verific", "document"),
     "Para vender, crea una cuenta de negocio, registra tu negocio y sube tu documento. La IA lo revisa y una persona del equipo lo aprueba."),
]


def _respuesta_respaldo(mensaje):
    texto = mensaje.lower()
    for claves, respuesta in RESPUESTAS_RESPALDO:
        if any(c in texto for c in claves):
            return respuesta
    return ("Ahora mismo no puedo consultar a la IA, pero puedo ayudarte con pedidos, apartados, pagos y cómo vender. "
            "Si es urgente, usa el botón 'Hablar con una persona'.")


def responder_soporte(mensaje, historial, contexto):
    """Devuelve (respuesta, sugerir_persona, modelo_usado)."""
    mensajes = []
    for turno in historial:
        rol = "user" if turno["rol"] == "usuario" else "assistant"
        if mensajes and mensajes[-1]["role"] == rol:
            mensajes[-1]["content"][0]["text"] += "\n" + turno["texto"]
        else:
            mensajes.append({"role": rol, "content": [{"text": turno["texto"]}]})
    while mensajes and mensajes[0]["role"] != "user":
        mensajes.pop(0)
    if mensajes and mensajes[-1]["role"] == "user":
        mensajes[-1]["content"][0]["text"] += "\n" + mensaje
    else:
        mensajes.append({"role": "user", "content": [{"text": mensaje}]})

    sistema = SISTEMA_SOPORTE.format(contexto=contexto or "Sin pedidos recientes.")
    try:
        texto, modelo = _conversar(_modelos(MODEL_SOPORTE), sistema, mensajes, 350, 0.3)
    except RuntimeError:
        return _respuesta_respaldo(mensaje), True, "respaldo"
    sugerir = MARCA_PERSONA in texto
    texto = _texto_plano(texto.replace(MARCA_PERSONA, ""))
    return texto or _respuesta_respaldo(mensaje), sugerir, modelo


# ---------------- Verificación de documentos ----------------

SISTEMA_DOCUMENTO = """Eres un asistente de verificación de vendedores para Lion Pick Up (demo de hackathon).
Tu trabajo es dar una RECOMENDACIÓN a una persona revisora; tú no apruebas a nadie.
No puedes confirmar que un documento sea auténtico: solo evalúa lo que se ve en la imagen.
Nunca transcribas números de identificación, CURP, claves, domicilios ni fechas de nacimiento.
Responde SOLO con un objeto JSON válido, sin texto antes ni después."""

INSTRUCCION_DOCUMENTO = """Revisa la imagen. Datos declarados por el vendedor:
- Nombre del responsable: {nombre}
- Tipo de vendedor: {tipo}

Devuelve exactamente este JSON:
{{
  "es_documento": true o false,          // ¿parece una identificación o credencial?
  "tipo_documento": "texto corto",       // ej. "credencial universitaria", "identificación oficial", "otro"
  "legible": true o false,
  "nombre_coincide": "si" | "no" | "no_visible",
  "alertas": ["máximo 3 alertas cortas, o lista vacía"],
  "recomendacion": "aprobar" | "revisar" | "rechazar",
  "resumen": "máximo 35 palabras para la persona revisora"
}}
Si el documento dice MUESTRA, EJEMPLO o es ficticio, menciónalo en "resumen" y evalúa igual legibilidad y coincidencia."""


def _extraer_json(texto):
    inicio, fin = texto.find("{"), texto.rfind("}")
    if inicio == -1 or fin <= inicio:
        raise ValueError("Sin JSON")
    crudo = re.sub(r"//[^\n]*", "", texto[inicio:fin + 1])
    return json.loads(crudo)


def analizar_documento(imagen_bytes, formato, nombre, tipo):
    """Devuelve un dict seguro para guardar en DynamoDB (sin floats)."""
    mensajes = [{
        "role": "user",
        "content": [
            {"image": {"format": formato, "source": {"bytes": imagen_bytes}}},
            {"text": INSTRUCCION_DOCUMENTO.format(nombre=nombre, tipo=tipo)},
        ],
    }]
    base = {
        "analizado": False,
        "es_documento": False,
        "tipo_documento": "desconocido",
        "legible": False,
        "nombre_coincide": "no_visible",
        "alertas": [],
        "recomendacion": "revisar",
        "resumen": "No se pudo analizar automáticamente; requiere revisión humana.",
        "modelo": "ninguno",
    }
    try:
        texto, modelo = _conversar(_modelos(MODEL_VISION), SISTEMA_DOCUMENTO, mensajes, 400, 0)
        datos = _extraer_json(texto)
    except Exception as e:  # noqa: BLE001
        log.warning("Análisis de documento sin resultado: %r", e)
        return base

    def bool_seguro(valor):
        return valor is True or (isinstance(valor, str) and valor.lower() in ("true", "si", "sí"))

    recomendacion = str(datos.get("recomendacion", "revisar")).lower()
    coincide = str(datos.get("nombre_coincide", "no_visible")).lower().replace("í", "i")
    alertas = datos.get("alertas") if isinstance(datos.get("alertas"), list) else []
    return {
        "analizado": True,
        "es_documento": bool_seguro(datos.get("es_documento")),
        "tipo_documento": str(datos.get("tipo_documento", "desconocido"))[:60],
        "legible": bool_seguro(datos.get("legible")),
        "nombre_coincide": coincide if coincide in ("si", "no", "no_visible") else "no_visible",
        "alertas": [str(a)[:120] for a in alertas[:3]],
        "recomendacion": recomendacion if recomendacion in ("aprobar", "revisar", "rechazar") else "revisar",
        "resumen": _texto_plano(str(datos.get("resumen", "")))[:300] or base["resumen"],
        "modelo": modelo,
    }
