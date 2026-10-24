// Sesión y llamadas a la API.
// La sesión vive en sessionStorage (se borra al cerrar la pestaña): es almacenamiento
// estrictamente necesario para que la app funcione, por eso no requiere consentimiento.
(function () {
  const CLAVE_SESION = "lion.sesion";

  const Sesion = {
    leer() {
      try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION)) || null; } catch { return null; }
    },
    guardar(token, usuario) {
      try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ token, usuario })); } catch { /* modo privado */ }
    },
    actualizarUsuario(usuario) {
      const s = Sesion.leer();
      if (s) Sesion.guardar(s.token, usuario);
    },
    token() { return Sesion.leer()?.token || null; },
    usuario() { return Sesion.leer()?.usuario || null; },
    cerrar() { try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* nada */ } },
  };

  function base() {
    const url = (window.LION_CONFIG?.API_URL || "").trim().replace(/\/+$/, "");
    if (!url || url.includes("PEGA_AQUI")) return null;
    return url;
  }

  // Con CloudFront + control de acceso a la Lambda (OAC), cada POST/PUT debe llevar
  // el hash SHA-256 del cuerpo en el encabezado x-amz-content-sha256.
  async function sha256Hex(texto) {
    if (!window.crypto?.subtle) throw new Error("Abre la página con https:// para poder enviar datos.");
    const huella = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(huella), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const mismoOrigen = (raiz) => raiz.startsWith("/");

  async function llamar(ruta, { metodo = "GET", datos } = {}) {
    const raiz = base();
    const token = Sesion.token();
    let status, cuerpo = {};
    if (!raiz) {
      // Demo sin servidor: la API se simula en este navegador (js/demo-local.js).
      if (!window.DemoLocal) throw new Error("Falta configurar la URL de la API en js/config.js.");
      ({ status, cuerpo } = await window.DemoLocal.llamar(ruta, { metodo, datos, token }));
    } else {
      const headers = {};
      if (token) headers["x-session-token"] = token;
      const cuerpoTexto = datos !== undefined ? JSON.stringify(datos) : undefined;
      if (cuerpoTexto !== undefined) {
        headers["content-type"] = "application/json";
        if (mismoOrigen(raiz)) headers["x-amz-content-sha256"] = await sha256Hex(cuerpoTexto);
      }
      let respuesta;
      try {
        respuesta = await fetch(raiz + ruta, { method: metodo, headers, body: cuerpoTexto });
      } catch {
        throw new Error("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
      }
      status = respuesta.status;
      try { cuerpo = await respuesta.json(); } catch { /* respuesta vacía */ }
    }
    if (status === 401 && token) {
      Sesion.cerrar();
      location.replace("index.html?sesion=expirada");
      throw new Error(cuerpo.error || "Tu sesión expiró.");
    }
    if (status < 200 || status >= 300) {
      const error = new Error(cuerpo.error || `Error ${status}`);
      error.status = status;
      throw error;
    }
    return cuerpo;
  }

  const PAGINA_POR_ROL = { cliente: "app.html", negocio: "negocio.html", admin: "admin.html" };

  // Protege una página: si no hay sesión o el rol no corresponde, redirige.
  function exigir(roles) {
    const usuario = Sesion.usuario();
    if (!usuario) {
      location.replace("index.html");
      return null;
    }
    if (!roles.includes(usuario.rol)) {
      location.replace(PAGINA_POR_ROL[usuario.rol] || "index.html");
      return null;
    }
    return usuario;
  }

  function salir() {
    Sesion.cerrar();
    location.href = "index.html";
  }

  const modoLocal = () => !base() && !!window.DemoLocal;
  const passwordDemo = () => (modoLocal() ? window.DemoLocal.PASSWORD_DEMO : (window.LION_CONFIG?.DEMO_PASSWORD || ""));

  window.API = { llamar, exigir, salir, configurada: () => !!base() || modoLocal(), modoLocal, passwordDemo, PAGINA_POR_ROL };
  window.Sesion = Sesion;
})();
