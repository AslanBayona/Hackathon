# Lion Pick Up

Marketplace de comida para recoger dentro del campus. Proyecto de demostración para un hackathon de AWS; no está afiliado a ninguna universidad.

## Demo sin servidor

Si `frontend/js/config.js` no tiene la URL de la API, la app corre completa en el navegador (`js/demo-local.js`): mismas reglas que la Lambda, datos de ejemplo automáticos y botones de entrada rápida. La IA está simulada. Sirve para practicar y como respaldo en la presentación.

- **Locales del campus (fijos):** el cliente paga en la app (simulado). Estados: pagado → preparando → listo → entregado. Comisión: 8% por producto, descontada del pago.
- **Estudiantes que venden (temporales):** no se cobra en la app. El pedido es un apartado: se reserva el stock, el cliente elige punto de encuentro, horario y método de pago, y paga en persona. El vendedor libera el pedido con el código de 6 dígitos del cliente. Comisión: 5% por producto, acumulada como saldo por liquidar.
- **IA (Amazon Bedrock):** revisa el documento del vendedor (recomienda; una persona aprueba) y responde el soporte. Si la IA falla, hay modelo de respaldo y respuestas predefinidas. El asistente se llama Leo.

## Arquitectura

```
Navegador ──HTTPS──► CloudFront (una sola distribución, WAF opcional)
                       ├─ /*      ─► S3 privado con la página (Origin Access Control)
                       └─ /api/*  ─► Lambda Function URL con AWS_IAM (Origin Access Control)
                                       ├─► DynamoDB (5 tablas)
                                       ├─► S3 privado (documentos, cifrado)
                                       └─► Bedrock (soporte y visión)
```

Ni el bucket ni la Function URL se pueden usar directo desde internet: solo CloudFront. La página y la API comparten dominio, así que no hace falta CORS. En `POST`/`PUT` el navegador manda el hash SHA-256 del cuerpo (`x-amz-content-sha256`), como exige Lambda detrás de CloudFront.

Sesión propia en Lambda: contraseñas con PBKDF2-SHA256 y token firmado con HMAC (8 h), enviado en el encabezado `x-session-token`. En producción se cambiaría por Amazon Cognito.

## Estructura

```
backend/
  lambda_function.py   rutas, reglas de negocio, sesión y datos de ejemplo
  db_service.py        DynamoDB (stock atómico, transiciones de estado, límites de uso)
  bedrock_service.py   soporte e IA de documentos, con modelo de respaldo
  validator.py         validación de entradas y errores
frontend/
  index.html  app.html  negocio.html  admin.html  legal.html
  css/styles.css
  js/config.js  (URL de la Function URL y contraseña de demo)
  js/demo-local.js  (simulador para la demo sin servidor)
  js/api.js  js/ui.js  js/inicio.js  js/cliente.js  js/negocio.js  js/admin.js
```

## Variables de entorno de la Lambda

| Variable | Valor |
|---|---|
| `TOKEN_SECRET` | Texto aleatorio de 40+ caracteres (obligatorio) |
| `ADMIN_CODE` | Código para crear la cuenta de administrador |
| `DEMO_PASSWORD` | Contraseña de las cuentas de ejemplo (por defecto `LionDemo2026`; igual que en `config.js`) |
| `BUCKET_DOCS` | Nombre del bucket privado de documentos |
| `MODEL_SOPORTE` | ID del modelo del asistente (recomendado: Amazon Nova Pro) |
| `MODEL_VISION` | ID de un modelo que acepte imágenes (Nova Lite o Nova Pro) |
| `MODEL_RESPALDO` | ID de un modelo que ya funcione en la cuenta (Nova Lite) |
| `COMISION_FIJO_PCT` | `8` |
| `COMISION_TEMPORAL_PCT` | `5` |
| `DOMINIO_INSTITUCIONAL` | Opcional, ej. `anahuac.mx`: exige ese correo a estudiantes que venden |

Configuración: Python 3.12 o más reciente, handler `lambda_function.lambda_handler`, 512 MB, tiempo de espera 30 s.

## Permisos del rol de la Lambda (política en línea)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Tablas",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/Lion*"
    },
    {
      "Sid": "Documentos",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::NOMBRE-DE-TU-BUCKET-DE-DOCUMENTOS/verificaciones/*"
    },
    {
      "Sid": "IA",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "*"
    }
  ]
}
```

## Despliegue

La guía del equipo tiene el paso a paso completo. Resumen:

1. DynamoDB: `LionUsuarios` (clave `email`), `LionNegocios`, `LionProductos`, `LionPedidos`, `LionTickets` (clave `id`), todas String y bajo demanda. Si ya existen con prefijo `Mayab`, variable `TABLA_PREFIJO` = `Mayab`.
2. S3 privado para documentos.
3. Lambda `lion-pick-up-api` con `lion-pick-up-backend.zip`, variables, 512 MB, 30 s y la política de arriba.
4. URL de la función con tipo de autenticación `AWS_IAM` (sin CORS).
5. S3 privado para la página, con el contenido de `frontend/` y `API_URL: "/api"` en `js/config.js`.
6. CloudFront: origen S3 con OAC (raíz `index.html`) y comportamiento `/api/*` hacia la Function URL con OAC tipo Lambda, métodos de lectura y escritura, `CachingDisabled` y `AllViewerExceptHostHeader`.
7. En CloudShell, dar a CloudFront `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction` con el ARN de la distribución.
8. Abrir `https://<distribución>.cloudfront.net/api/salud`, crear la cuenta de administrador y cargar los datos de ejemplo.

Plan B (modo simple): URL de la función con `NONE`, CORS con encabezados `content-type, x-session-token`, y la URL completa en `API_URL`.
