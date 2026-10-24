"""Acceso a DynamoDB.

Tablas (todas con capacidad bajo demanda):
  LionUsuarios   clave de partición: email (String)
  LionNegocios   clave de partición: id    (String)
  LionProductos  clave de partición: id    (String)
  LionPedidos    clave de partición: id    (String)
  LionTickets    clave de partición: id    (String)

Todos los montos se guardan en CENTAVOS (enteros) para evitar errores de redondeo.
"""
import os
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

PREFIJO = os.environ.get("TABLA_PREFIJO", "Lion")

USUARIOS = "Usuarios"
NEGOCIOS = "Negocios"
PRODUCTOS = "Productos"
PEDIDOS = "Pedidos"
TICKETS = "Tickets"

CLAVES = {USUARIOS: "email", NEGOCIOS: "id", PRODUCTOS: "id", PEDIDOS: "id", TICKETS: "id"}

_recurso = None


def _tabla(nombre):
    global _recurso
    if _recurso is None:
        _recurso = boto3.resource("dynamodb")
    return _recurso.Table(PREFIJO + nombre)


def _condicion_fallida(error):
    return error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def limpiar(valor):
    """Convierte los Decimal que devuelve DynamoDB en int/float de Python."""
    if isinstance(valor, list):
        return [limpiar(v) for v in valor]
    if isinstance(valor, dict):
        return {k: limpiar(v) for k, v in valor.items()}
    if isinstance(valor, Decimal):
        return int(valor) if valor == valor.to_integral_value() else float(valor)
    return valor


def _expresion(campos, prefijo="s"):
    """Arma 'SET #s0 = :s0, ...' usando alias para no chocar con palabras reservadas."""
    nombres, valores, partes = {}, {}, []
    for i, (campo, valor) in enumerate(campos.items()):
        nombres[f"#{prefijo}{i}"] = campo
        valores[f":{prefijo}{i}"] = valor
        partes.append(f"#{prefijo}{i} = :{prefijo}{i}")
    return ", ".join(partes), nombres, valores


# ---------- Operaciones básicas ----------

def obtener(tabla, clave_valor):
    respuesta = _tabla(tabla).get_item(Key={CLAVES[tabla]: clave_valor}, ConsistentRead=True)
    item = respuesta.get("Item")
    return limpiar(item) if item else None


def crear(tabla, item):
    """Crea solo si no existe. Devuelve False si la clave ya estaba ocupada."""
    clave = CLAVES[tabla]
    try:
        _tabla(tabla).put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(#k)",
            ExpressionAttributeNames={"#k": clave},
        )
        return True
    except ClientError as e:
        if _condicion_fallida(e):
            return False
        raise


def guardar(tabla, item):
    """Crea o reemplaza (se usa para los datos de ejemplo)."""
    _tabla(tabla).put_item(Item=item)


def escanear(tabla, filtro=None):
    """Lee toda la tabla y filtra en Python. Suficiente para el volumen de la demo."""
    items, kwargs = [], {}
    while True:
        respuesta = _tabla(tabla).scan(**kwargs)
        items.extend(respuesta.get("Items", []))
        ultimo = respuesta.get("LastEvaluatedKey")
        if not ultimo:
            break
        kwargs["ExclusiveStartKey"] = ultimo
    items = [limpiar(i) for i in items]
    return [i for i in items if filtro(i)] if filtro else items


def actualizar(tabla, clave_valor, campos):
    """SET de varios campos. Devuelve el item actualizado."""
    expr, nombres, valores = _expresion(campos)
    nombres["#k"] = CLAVES[tabla]
    respuesta = _tabla(tabla).update_item(
        Key={CLAVES[tabla]: clave_valor},
        UpdateExpression="SET " + expr,
        ConditionExpression="attribute_exists(#k)",
        ExpressionAttributeNames=nombres,
        ExpressionAttributeValues=valores,
        ReturnValues="ALL_NEW",
    )
    return limpiar(respuesta["Attributes"])


def sumar(tabla, clave_valor, cantidades):
    """ADD atómico de contadores (ventas, comisiones, etc.)."""
    nombres, valores, partes = {}, {}, []
    for i, (campo, cantidad) in enumerate(cantidades.items()):
        nombres[f"#a{i}"] = campo
        valores[f":a{i}"] = cantidad
        partes.append(f"#a{i} :a{i}")
    _tabla(tabla).update_item(
        Key={CLAVES[tabla]: clave_valor},
        UpdateExpression="ADD " + ", ".join(partes),
        ExpressionAttributeNames=nombres,
        ExpressionAttributeValues=valores,
    )


# ---------- Stock ----------

def reservar_stock(producto_id, cantidad):
    """Resta stock solo si alcanza. Evita vender de más aunque dos personas pidan a la vez."""
    try:
        _tabla(PRODUCTOS).update_item(
            Key={"id": producto_id},
            UpdateExpression="SET #s = #s - :c",
            ConditionExpression="#s >= :c AND #a = :t",
            ExpressionAttributeNames={"#s": "stock", "#a": "activo"},
            ExpressionAttributeValues={":c": cantidad, ":t": True},
        )
        return True
    except ClientError as e:
        if _condicion_fallida(e):
            return False
        raise


def devolver_stock(producto_id, cantidad):
    _tabla(PRODUCTOS).update_item(
        Key={"id": producto_id},
        UpdateExpression="ADD #s :c",
        ExpressionAttributeNames={"#s": "stock"},
        ExpressionAttributeValues={":c": cantidad},
    )


# ---------- Pedidos ----------

def cambiar_estado_pedido(pedido_id, estados_permitidos, nuevo_estado, momento, extra=None):
    """Cambia el estado solo si el pedido está en uno de los estados permitidos.

    La condición garantiza que, aunque lleguen dos clics a la vez, la transición
    (y la devolución de stock o el registro de comisión) ocurra una sola vez.
    Devuelve el pedido actualizado o None si la transición ya no era válida.
    """
    campos = {"estado": nuevo_estado, "actualizado": momento}
    campos.update(extra or {})
    expr, nombres, valores = _expresion(campos)
    nombres["#est"] = "estado"
    nombres["#hist"] = "historial"
    valores[":h"] = [{"estado": nuevo_estado, "ts": momento}]
    valores[":vacio"] = []
    condiciones = []
    for i, estado in enumerate(estados_permitidos):
        valores[f":e{i}"] = estado
        condiciones.append(f":e{i}")
    try:
        respuesta = _tabla(PEDIDOS).update_item(
            Key={"id": pedido_id},
            UpdateExpression=f"SET {expr}, #hist = list_append(if_not_exists(#hist, :vacio), :h)",
            ConditionExpression=f"#est IN ({', '.join(condiciones)})",
            ExpressionAttributeNames=nombres,
            ExpressionAttributeValues=valores,
            ReturnValues="ALL_NEW",
        )
        return limpiar(respuesta["Attributes"])
    except ClientError as e:
        if _condicion_fallida(e):
            return None
        raise


def registrar_intento_codigo(pedido_id, maximo):
    """Suma un intento fallido de código. Devuelve el total de intentos."""
    respuesta = _tabla(PEDIDOS).update_item(
        Key={"id": pedido_id},
        UpdateExpression="ADD #i :uno",
        ExpressionAttributeNames={"#i": "intentos_codigo"},
        ExpressionAttributeValues={":uno": 1},
        ReturnValues="ALL_NEW",
    )
    intentos = int(respuesta["Attributes"].get("intentos_codigo", 0))
    if intentos >= maximo:
        actualizar(PEDIDOS, pedido_id, {"codigo_bloqueado": True})
    return intentos


# ---------- Límites de uso ----------

def consumir_cuota(tabla, clave_valor, campo, ventana, limite):
    """Cuenta usos por ventana de tiempo (ej. mensajes de IA por hora).

    Devuelve True si todavía hay cupo y lo consume; False si ya se alcanzó el límite.
    """
    t = _tabla(tabla)
    clave = {CLAVES[tabla]: clave_valor}
    nombres = {"#c": campo + "_contador", "#v": campo + "_ventana"}
    try:
        t.update_item(
            Key=clave,
            UpdateExpression="ADD #c :uno",
            ConditionExpression="#v = :w AND #c < :lim",
            ExpressionAttributeNames=nombres,
            ExpressionAttributeValues={":uno": 1, ":w": ventana, ":lim": limite},
        )
        return True
    except ClientError as e:
        if not _condicion_fallida(e):
            raise
    try:
        t.update_item(
            Key=clave,
            UpdateExpression="SET #v = :w, #c = :uno",
            ConditionExpression="attribute_not_exists(#v) OR #v <> :w",
            ExpressionAttributeNames=nombres,
            ExpressionAttributeValues={":uno": 1, ":w": ventana},
        )
        return True
    except ClientError as e:
        if _condicion_fallida(e):
            return False
        raise
