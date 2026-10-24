// Portada: inicio de sesión y registro.
(function () {
  const { icono, conCarga } = UI;

  // Si ya hay sesión, ir directo a su panel.
  const usuario = Sesion.usuario();
  if (usuario) { location.replace(API.PAGINA_POR_ROL[usuario.rol] || "app.html"); return; }

  document.getElementById("i1").appendChild(icono("tienda", 22));
  document.getElementById("i2").appendChild(icono("chispa", 22));
  document.getElementById("i3").appendChild(icono("escudo", 22));
  document.getElementById("pie").replaceWith(UI.pie());

  // Boleto de ejemplo: muestra cómo se ve un apartado con vendedor estudiante.
  const { h } = UI;
  document.querySelector(".portada-arte").appendChild(
    h("div", { class: "boleto", style: "width:min(340px,100%)" },
      h("div", { class: "boleto-banda" }),
      h("div", { class: "boleto-cuerpo" },
        h("span", { class: "pequeno suave", text: "Tu código para liberar el apartado" }),
        h("div", { class: "boleto-codigo" }, h("span", { text: "482" }), h("span", { text: "913" })),
        h("span", { class: "meta" }, icono("pin", 16), "Brownies de Sofi en la Biblioteca"),
        h("span", { class: "meta" }, icono("reloj", 16), "Hoy a las 13:30, pagas en efectivo"))));

  if (!API.configurada()) {
    const aviso = document.getElementById("aviso-config");
    aviso.textContent = "Falta configurar la URL de la API. Edita js/config.js y pega la URL de la función Lambda.";
    aviso.classList.remove("oculto");
  }
  // Entrada rápida a la demo con las cuentas de ejemplo.
  const passwordDemo = API.passwordDemo();
  if (passwordDemo) {
    const opciones = [
      ["usuario", "Soy cliente", "Pedir y apartar comida", "cliente@lionpickup.demo"],
      ["chispa", "Vendo como estudiante", "Brownies de Sofi", "sofi@lionpickup.demo"],
      ["tienda", "Tengo un local", "Cocina Yucateca", "cocina@lionpickup.demo"],
    ];
    if (API.modoLocal()) opciones.push(["escudo", "Administración", "Verificar negocios y ver comisiones", "admin@lionpickup.demo"]);
    const errorRapido = document.getElementById("error-rapido");
    document.getElementById("botones-rapido").append(...opciones.map(([ic, titulo, detalle, email]) => {
      const boton = h("button", { type: "button" },
        h("span", { class: "icono-circulo" }, icono(ic)),
        h("span", {}, h("strong", { text: titulo }), h("span", { class: "suave pequeno", style: "display:block", text: detalle })));
      boton.addEventListener("click", async () => {
        errorRapido.classList.add("oculto");
        try {
          const r = await conCarga(boton, () => API.llamar("/auth/login", { metodo: "POST", datos: { email, password: passwordDemo } }));
          entrarCon(r);
        } catch (e) {
          errorRapido.textContent = API.modoLocal() ? e.message
            : "Esta cuenta aún no existe. Pide al equipo que cargue los datos de ejemplo desde Administración.";
          errorRapido.classList.remove("oculto");
        }
      });
      return boton;
    }));
    document.getElementById("acceso-rapido").classList.remove("oculto");
  }

  if (new URLSearchParams(location.search).get("sesion") === "expirada") {
    document.getElementById("aviso-sesion").classList.remove("oculto");
  }

  const tabEntrar = document.getElementById("tab-entrar");
  const tabCrear = document.getElementById("tab-crear");
  const formEntrar = document.getElementById("form-entrar");
  const formCrear = document.getElementById("form-crear");

  function mostrar(cual) {
    const entrar = cual === "entrar";
    tabEntrar.setAttribute("aria-selected", String(entrar));
    tabCrear.setAttribute("aria-selected", String(!entrar));
    formEntrar.classList.toggle("oculto", !entrar);
    formCrear.classList.toggle("oculto", entrar);
    (entrar ? formEntrar : formCrear).querySelector("input").focus();
  }
  tabEntrar.addEventListener("click", () => mostrar("entrar"));
  tabCrear.addEventListener("click", () => mostrar("crear"));

  function error(form, mensaje) {
    const caja = form.querySelector("[data-error]");
    caja.textContent = mensaje || "";
    caja.classList.toggle("oculto", !mensaje);
  }

  function entrarCon(respuesta) {
    Sesion.guardar(respuesta.token, respuesta.usuario);
    location.href = API.PAGINA_POR_ROL[respuesta.usuario.rol] || "app.html";
  }

  formEntrar.addEventListener("submit", async (e) => {
    e.preventDefault();
    error(formEntrar, "");
    const datos = Object.fromEntries(new FormData(formEntrar));
    if (!datos.email || !datos.password) return error(formEntrar, "Escribe tu correo y tu contraseña.");
    try {
      const r = await conCarga(formEntrar.querySelector("button[type=submit]"),
        () => API.llamar("/auth/login", { metodo: "POST", datos: { email: datos.email.trim(), password: datos.password } }));
      entrarCon(r);
    } catch (err) { error(formEntrar, err.message); }
  });

  formCrear.addEventListener("submit", async (e) => {
    e.preventDefault();
    error(formCrear, "");
    const f = new FormData(formCrear);
    const datos = {
      nombre: (f.get("nombre") || "").trim(),
      email: (f.get("email") || "").trim(),
      password: f.get("password") || "",
      rol: f.get("rol") || "cliente",
      acepta_terminos: f.get("acepta_terminos") === "on",
    };
    const codigo = (f.get("codigo_admin") || "").trim();
    if (codigo) datos.codigo_admin = codigo;
    if (datos.nombre.length < 2) return error(formCrear, "Escribe tu nombre.");
    if (!datos.acepta_terminos) return error(formCrear, "Para crear tu cuenta, acepta el aviso de privacidad y los términos.");
    try {
      const r = await conCarga(formCrear.querySelector("button[type=submit]"),
        () => API.llamar("/auth/registro", { metodo: "POST", datos }));
      entrarCon(r);
    } catch (err) { error(formCrear, err.message); }
  });
})();
