// Configuración del frontend.
//
// API_URL: dónde está la API.
//   "/api"  → RECOMENDADO. La página y la API pasan por la misma distribución de CloudFront
//             (comportamiento /api/* hacia la Lambda). Más seguro y sin CORS.
//   "https://abc123xyz.lambda-url.us-east-1.on.aws" → modo simple: la página llama directo
//             a la Function URL (tipo de autenticación NONE y CORS configurado en la Lambda).
//   Si lo dejas como está, la app funciona en "demo sin servidor": todo se simula en el
//   navegador, sin AWS. Sirve para practicar o como respaldo si falla internet.
//
// DEMO_PASSWORD: contraseña de las cuentas de ejemplo. Con ella la portada muestra botones
//   de entrada rápida. Debe ser igual a la variable DEMO_PASSWORD de la Lambda.
//   Déjala vacía ("") si no quieres esos botones.
window.LION_CONFIG = {
  API_URL: "PEGA_AQUI_TU_FUNCTION_URL",
  DEMO_PASSWORD: "LionDemo2026",
};
