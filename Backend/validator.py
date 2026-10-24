"""Validación de datos de entrada y errores de la API.

Todo lo que llega del navegador se considera no confiable: aquí se revisa
tipo, formato y longitud de cada campo antes de guardarlo.
"""
import base64
import binascii
import re
from datetime import date
from decimal import Decimal, InvalidOperation


class ApiError(Exception):
    """Error controlado: se responde al navegador con su código y mensaje."""

    def __init__(self, status, mensaje):
        super().__init__(mensaje)
        self.status = status
        self.mensaje = mensaje


EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
HORA_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
FECHA_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID_RE = re.compile(r"^[A-Za-z0-9\-_]{1,64}$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

MAX_IMAGEN_BYTES = 3_500_000  # Bedrock acepta imágenes de hasta ~3.75 MB


def texto(valor, campo, minimo=1, maximo=200, requerido=True, una_linea=True):
    """Texto limpio: sin caracteres de control ni < > (defensa extra contra XSS)."""
    if valor is None or (isinstance(valor, str) and valor.strip() == ""):
        if requerido:
            raise ApiError(400, f"El campo '{campo}' es obligatorio.")
        return ""
    if not isinstance(valor, str):
        raise ApiError(400, f"El campo '{campo}' debe ser texto.")
    limpio = CONTROL_RE.sub("", valor).replace("<", "").replace(">", "")
    if una_linea:
        limpio = re.sub(r"\s+", " ", limpio)
    limpio = limpio.strip()
    if len(limpio) < minimo:
        raise ApiError(400, f"El campo '{campo}' debe tener al menos {minimo} caracteres.")
    if len(limpio) > maximo:
        raise ApiError(400, f"El campo '{campo}' admite máximo {maximo} caracteres.")
    return limpio


def email(valor):
    correo = texto(valor, "correo", 6, 120).lower()
    if not EMAIL_RE.match(correo):
        raise ApiError(400, "El correo no tiene un formato válido.")
    return correo


def password(valor):
    if not isinstance(valor, str) or not (8 <= len(valor) <= 72):
        raise ApiError(400, "La contraseña debe tener entre 8 y 72 caracteres.")
    if not re.search(r"[A-Za-z]", valor) or not re.search(r"\d", valor):
        raise ApiError(400, "La contraseña debe incluir al menos una letra y un número.")
    return valor


def opcion(valor, campo, opciones):
    if valor not in opciones:
        raise ApiError(400, f"Valor no válido para '{campo}'.")
    return valor


def entero(valor, campo, minimo, maximo):
    if isinstance(valor, bool):
        raise ApiError(400, f"El campo '{campo}' debe ser un número entero.")
    try:
        numero = int(valor)
    except (TypeError, ValueError):
        raise ApiError(400, f"El campo '{campo}' debe ser un número entero.")
    if isinstance(valor, float) and valor != numero:
        raise ApiError(400, f"El campo '{campo}' debe ser un número entero.")
    if not (minimo <= numero <= maximo):
        raise ApiError(400, f"El campo '{campo}' debe estar entre {minimo} y {maximo}.")
    return numero


def precio_a_centavos(valor, campo="precio"):
    """Recibe pesos (ej. 45 o "45.50") y devuelve centavos enteros (4550)."""
    if isinstance(valor, bool) or valor is None:
        raise ApiError(400, f"El campo '{campo}' es obligatorio.")
    try:
        pesos = Decimal(str(valor))
    except (InvalidOperation, ValueError):
        raise ApiError(400, f"El campo '{campo}' debe ser un número.")
    if pesos != pesos.quantize(Decimal("0.01")):
        raise ApiError(400, f"El campo '{campo}' admite máximo dos decimales.")
    if not (Decimal("1") <= pesos <= Decimal("5000")):
        raise ApiError(400, f"El campo '{campo}' debe estar entre $1 y $5,000.")
    return int(pesos * 100)


def hora(valor, campo="horario"):
    if not isinstance(valor, str) or not HORA_RE.match(valor):
        raise ApiError(400, f"El campo '{campo}' debe tener formato HH:MM.")
    return valor


def fecha(valor, campo="fecha"):
    if not isinstance(valor, str) or not FECHA_RE.match(valor):
        raise ApiError(400, f"El campo '{campo}' debe tener formato AAAA-MM-DD.")
    try:
        date.fromisoformat(valor)
    except ValueError:
        raise ApiError(400, f"La fecha de '{campo}' no existe.")
    return valor


def identificador(valor, campo="id"):
    if not isinstance(valor, str) or not ID_RE.match(valor):
        raise ApiError(400, f"Identificador no válido en '{campo}'.")
    return valor


def lista(valor, campo, minimo=0, maximo=10):
    if valor is None:
        valor = []
    if not isinstance(valor, list):
        raise ApiError(400, f"El campo '{campo}' debe ser una lista.")
    if not (minimo <= len(valor) <= maximo):
        raise ApiError(400, f"El campo '{campo}' debe tener entre {minimo} y {maximo} elementos.")
    return valor


def imagen(valor):
    """Acepta 'data:image/jpeg;base64,...' o base64 puro. Devuelve (bytes, formato)."""
    if not isinstance(valor, str) or len(valor) < 100:
        raise ApiError(400, "Falta la imagen del documento.")
    if valor.startswith("data:"):
        _, _, valor = valor.partition(",")
    try:
        datos = base64.b64decode(valor, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "La imagen no se pudo leer.")
    if len(datos) > MAX_IMAGEN_BYTES:
        raise ApiError(400, "La imagen pesa demasiado (máximo 3.5 MB).")
    if datos[:3] == b"\xff\xd8\xff":
        return datos, "jpeg"
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return datos, "png"
    raise ApiError(400, "Solo se aceptan imágenes JPG o PNG.")
