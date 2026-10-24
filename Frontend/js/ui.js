// Utilidades de interfaz compartidas por todas las páginas.
// Regla de seguridad: todo texto que viene de usuarios se inserta como texto
// (createTextNode / textContent), nunca como HTML. Solo los íconos, que son
// constantes de este archivo, se insertan como SVG.
(function () {
  // ---------- Creación de elementos ----------
  function h(etiqueta, atributos, ...hijos) {
    const el = document.createElement(etiqueta);
    for (const [clave, valor] of Object.entries(atributos || {})) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (clave === "class") el.className = valor;
      else if (clave === "text") el.textContent = valor;
      else if (clave.startsWith("on") && typeof valor === "function") el.addEventListener(clave.slice(2).toLowerCase(), valor);
      else if (clave === "value") el.value = valor;
      else if (clave === "checked") el.checked = !!valor;
      else if (clave === "dataset") Object.assign(el.dataset, valor);
      else if (valor === true) el.setAttribute(clave, "");
      else el.setAttribute(clave, String(valor));
    }
    agregar(el, hijos);
    return el;
  }

  function agregar(el, hijos) {
    for (const hijo of hijos.flat(Infinity)) {
      if (hijo === null || hijo === undefined || hijo === false) continue;
      el.appendChild(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
    }
    return el;
  }

  function limpiar(el, ...hijos) {
    el.replaceChildren();
    return agregar(el, hijos);
  }

  // ---------- Íconos (trazos de 24px) ----------
  const TRAZOS = {
    carrito: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/>',
    explorar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    recibo: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    ayuda: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9.5 9.2a2.5 2.5 0 0 1 4.6 1.3c0 1.5-2.1 1.7-2.1 2.8"/>',
    salir: '<path d="M15 4h4v16h-4"/><path d="M10 16l4-4-4-4M14 12H4"/>',
    reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    mas: '<path d="M12 5v14M5 12h14"/>',
    menos: '<path d="M5 12h14"/>',
    atras: '<path d="M15 5l-7 7 7 7"/>',
    derecha: '<path d="M9 5l7 7-7 7"/>',
    cerrar: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    alerta: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
    escudo: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.8-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
    tienda: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2.5a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 11.5z"/><path d="M5.5 13.5V20h13v-6.5"/>',
    caja: '<path d="M3.5 8 12 4l8.5 4-8.5 4z"/><path d="M3.5 8v8L12 20l8.5-4V8M12 12v8"/>',
    grafica: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.3-4 4.4-6 8-6s6.7 2 8 6"/>',
    enviar: '<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 3-3"/>',
    chispa: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
    documento: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    refrescar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    lapiz: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    persona: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.9-3.4 3.4-5.2 6.5-5.2s5.6 1.8 6.5 5.2"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  };

  function icono(nombre, tamano = 20) {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.display = "inline-flex";
    span.innerHTML = `<svg width="${tamano}" height="${tamano}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TRAZOS[nombre] || ""}</svg>`;
    return span;
  }

  // ---------- Formatos ----------
  const formatoPesos = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
  const pesos = (centavos) => formatoPesos.format((centavos || 0) / 100);

  function fechaCorta(iso) {
    if (!iso) return "";
    const fecha = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return fecha.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  }
  function horaDe(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const aMinutos = (hhmm) => { const [a, b] = hhmm.split(":").map(Number); return a * 60 + b; };
  const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  // Horarios cada 15 minutos entre desde y hasta, sin incluir horas que ya pasaron hoy.
  function horarios(desde, hasta, esHoy = true) {
    const ahora = new Date();
    let inicio = aMinutos(desde);
    if (esHoy) {
      const actual = ahora.getHours() * 60 + ahora.getMinutes() + 10;
      inicio = Math.max(inicio, Math.ceil(actual / 15) * 15);
    }
    const lista = [];
    for (let m = inicio; m <= aMinutos(hasta); m += 15) lista.push(aHora(m));
    return lista;
  }

  // ---------- Etiquetas ----------
  const ESTADOS = {
    pagado: ["Pagado", ""], preparando: ["En preparación", "amarillo"], listo: ["Listo para recoger", "verde"],
    entregado: ["Entregado", "gris"], apartado: ["Apartado", "amarillo"], aceptado: ["Aceptado", ""],
    completado: ["Completado", "verde"], cancelado: ["Cancelado", "gris"], rechazado: ["Rechazado", "rojo"],
    vencido: ["Vencido", "gris"],
    pendiente: ["Pendiente de verificación", "amarillo"], aprobado: ["Aprobado", "verde"],
    abierto: ["Abierto", "amarillo"], resuelto: ["Resuelto", "verde"],
  };
  const METODOS = {
    tarjeta_simulada: "Tarjeta (simulado)", saldo_simulado: "Saldo Lion (simulado)",
    efectivo: "Efectivo", transferencia: "Transferencia", tarjeta_vendedor: "Tarjeta con la terminal del vendedor",
  };
  const PAGOS = {
    pagado_simulado: "Pagado en la app (simulado)", reembolsado_simulado: "Reembolsado (simulado)",
    liquidado_simulado: "Pagado en la app (simulado)", por_acordar: "Se paga en persona",
    pagado_en_persona: "Pagado en persona",
  };

  function chip(estado) {
    const [texto, color] = ESTADOS[estado] || [estado, "gris"];
    return h("span", { class: `chip ${color}`.trim(), text: texto });
  }

  // ---------- Avisos flotantes ----------
  let contenedorAvisos = null;
  function toast(mensaje, tipo = "") {
    if (!contenedorAvisos) {
      contenedorAvisos = h("div", { class: "avisos-flotantes", role: "status", "aria-live": "polite" });
      document.body.appendChild(contenedorAvisos);
    }
    const aviso = h("div", { class: `toast ${tipo}`.trim() },
      icono(tipo === "error" ? "alerta" : tipo === "ok" ? "check" : "info", 18), mensaje);
    contenedorAvisos.appendChild(aviso);
    setTimeout(() => aviso.remove(), tipo === "error" ? 5200 : 3400);
  }

  // ---------- Hojas (modales) ----------
  function hoja({ titulo, contenido, alCerrar }) {
    const anterior = document.activeElement;
    const capa = h("div", { class: "capa", role: "presentation" });
    const panel = h("div", { class: "hoja", role: "dialog", "aria-modal": "true", "aria-label": titulo, tabindex: "-1" });
    const cerrar = () => {
      capa.remove();
      document.removeEventListener("keydown", teclas);
      document.body.style.overflow = "";
      if (anterior && anterior.focus) anterior.focus();
      if (alCerrar) alCerrar();
    };
    const teclas = (e) => { if (e.key === "Escape") cerrar(); };
    agregar(panel, [
      h("div", { class: "hoja-cabeza" },
        h("h2", { text: titulo }),
        h("button", { class: "btn btn-fantasma btn-icono", "aria-label": "Cerrar", onclick: cerrar }, icono("cerrar"))),
      contenido,
    ]);
    capa.appendChild(panel);
    capa.addEventListener("click", (e) => { if (e.target === capa) cerrar(); });
    document.addEventListener("keydown", teclas);
    document.body.appendChild(capa);
    document.body.style.overflow = "hidden";
    panel.focus();
    return { cerrar, panel };
  }

  function confirmar(titulo, texto, { aceptar = "Confirmar", peligro = false } = {}) {
    return new Promise((resolver) => {
      let respondido = false;
      const fin = (valor) => { if (!respondido) { respondido = true; resolver(valor); } ventana.cerrar(); };
      const ventana = hoja({
        titulo,
        alCerrar: () => { if (!respondido) { respondido = true; resolver(false); } },
        contenido: [
          h("p", { class: "suave", text: texto }),
          h("div", { class: "hoja-acciones" },
            h("button", { class: "btn btn-fantasma", onclick: () => fin(false) }, "Volver"),
            h("button", { class: `btn ${peligro ? "btn-peligro" : "btn-primario"}`, onclick: () => fin(true) }, aceptar)),
        ],
      });
    });
  }

  function pedirTexto(titulo, etiqueta, { aceptar = "Guardar", requerido = false, max = 200 } = {}) {
    return new Promise((resolver) => {
      let respondido = false;
      const campo = h("textarea", { maxlength: max, rows: 3 });
      const fin = (valor) => { if (!respondido) { respondido = true; resolver(valor); } ventana.cerrar(); };
      const ventana = hoja({
        titulo,
        alCerrar: () => { if (!respondido) { respondido = true; resolver(null); } },
        contenido: [
          h("label", { class: "campo" }, h("span", { text: etiqueta }), campo),
          h("div", { class: "hoja-acciones" },
            h("button", { class: "btn btn-fantasma", onclick: () => fin(null) }, "Volver"),
            h("button", {
              class: "btn btn-primario",
              onclick: () => {
                if (requerido && !campo.value.trim()) { campo.focus(); return; }
                fin(campo.value.trim());
              },
            }, aceptar)),
        ],
      });
      setTimeout(() => campo.focus(), 50);
    });
  }

  // Botón con estado de carga mientras corre una tarea asíncrona.
  async function conCarga(boton, tarea) {
    const original = [...boton.childNodes];
    boton.disabled = true;
    boton.replaceChildren(h("span", { class: "girando", "aria-hidden": "true" }), "Un momento…");
    try { return await tarea(); } finally {
      boton.disabled = false;
      boton.replaceChildren(...original);
    }
  }

  // ---------- Consentimiento de cookies y almacenamiento ----------
  const CLAVE_CONSENTIMIENTO = "lion.consentimiento";
  function leerConsentimiento() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CONSENTIMIENTO)) || null; } catch { return null; }
  }
  function guardarConsentimiento(preferencias) {
    try {
      localStorage.setItem(CLAVE_CONSENTIMIENTO, JSON.stringify({ necesarias: true, preferencias, fecha: new Date().toISOString(), version: 1 }));
      if (!preferencias) {
        Object.keys(localStorage).filter((k) => k.startsWith("lion.pref.")).forEach((k) => localStorage.removeItem(k));
      }
    } catch { /* almacenamiento bloqueado */ }
  }
  const permitePreferencias = () => !!leerConsentimiento()?.preferencias;

  const preferencias = {
    leer(clave, porDefecto = null) {
      if (!permitePreferencias()) return porDefecto;
      try { const v = localStorage.getItem("lion.pref." + clave); return v === null ? porDefecto : JSON.parse(v); } catch { return porDefecto; }
    },
    guardar(clave, valor) {
      if (!permitePreferencias()) return;
      try { localStorage.setItem("lion.pref." + clave, JSON.stringify(valor)); } catch { /* nada */ }
    },
  };

  function bannerConsentimiento({ forzar = false } = {}) {
    if (!forzar && leerConsentimiento()) return;
    document.querySelector(".consentimiento")?.remove();
    const actual = leerConsentimiento();
    const casilla = h("input", { type: "checkbox", checked: actual ? actual.preferencias : false });
    const banner = h("section", { class: "consentimiento", role: "dialog", "aria-label": "Preferencias de cookies" },
      h("h3", { text: "Tu privacidad en Lion Pick Up" }),
      h("p", { text: "Usamos almacenamiento estrictamente necesario para mantener tu sesión. Con tu permiso, también recordamos tu carrito y tus filtros en este dispositivo. No usamos publicidad ni rastreo." }),
      forzar ? h("label", { class: "casilla" }, casilla, h("span", {}, "Recordar mi carrito y filtros en este dispositivo")) : null,
      h("div", { class: "acciones" },
        forzar
          ? h("button", { class: "btn btn-primario", onclick: () => { guardarConsentimiento(casilla.checked); banner.remove(); toast("Preferencias guardadas.", "ok"); } }, "Guardar preferencias")
          : [
              h("button", { class: "btn btn-primario", onclick: () => { guardarConsentimiento(true); banner.remove(); } }, "Aceptar todas"),
              h("button", { class: "btn btn-secundario", onclick: () => { guardarConsentimiento(false); banner.remove(); } }, "Solo necesarias"),
            ]),
      h("a", { href: "legal.html#cookies", class: "pequeno" }, "Leer el aviso de privacidad"));
    document.body.appendChild(banner);
  }

  function pie() {
    return h("footer", { class: "pie" },
      h("span", { text: "Lion Pick Up, proyecto de demostración" }),
      h("a", { href: "legal.html" }, "Aviso de privacidad y términos"),
      h("button", { type: "button", onclick: () => bannerConsentimiento({ forzar: true }) }, "Preferencias de cookies"));
  }

  // ---------- Actualización periódica ----------
  function cadaTanto(funcion, ms) {
    let activo = true;
    const tic = async () => {
      if (!activo) return;
      if (!document.hidden) { try { await funcion(); } catch { /* se reintenta en el siguiente ciclo */ } }
      if (activo) temporizador = setTimeout(tic, ms);
    };
    let temporizador = setTimeout(tic, ms);
    return () => { activo = false; clearTimeout(temporizador); };
  }

  function esqueleto(cantidad = 3) {
    return h("div", { class: "pila", "aria-busy": "true", "aria-label": "Cargando" },
      Array.from({ length: cantidad }, () => h("div", { class: "esqueleto" })));
  }

  function vacio(emoji, titulo, texto, accion) {
    return h("div", { class: "vacio" },
      h("div", { class: "emoji-sello", text: emoji }),
      h("h3", { text: titulo }),
      texto ? h("p", { class: "suave", text: texto }) : null,
      accion || null);
  }

  function marca() {
    return h("a", { class: "marca", href: "index.html" }, h("span", { class: "marca-sello", "aria-hidden": "true" }), "lion pick up");
  }

  function resultadoIA(v) {
    const recomendacion = {
      aprobar: ["verde", "La IA recomienda aprobar"],
      revisar: ["amarillo", "La IA sugiere revisión humana"],
      rechazar: ["rojo", "La IA sugiere rechazar"],
    }[v.recomendacion] || ["amarillo", "Pendiente de revisión"];
    const marca = (ok, texto) => h("span", { class: `chip sin-punto ${ok ? "verde" : "rojo"}` }, icono(ok ? "check" : "cerrar", 14), texto);
    return h("div", { class: "verificacion" },
      h("div", { class: "checks" },
        h("span", { class: `chip ${recomendacion[0]}`, text: recomendacion[1] }),
        v.analizado ? marca(v.es_documento, "Parece documento") : null,
        v.analizado ? marca(v.legible, "Legible") : null,
        v.analizado ? (v.nombre_coincide === "no_visible"
          ? h("span", { class: "chip sin-punto gris", text: "Nombre no visible" })
          : marca(v.nombre_coincide === "si", "Nombre coincide")) : null),
      h("p", { text: v.resumen }),
      v.alertas && v.alertas.length ? h("ul", { class: "suave pequeno", style: "margin:0;padding-left:1.1rem" }, v.alertas.map((a) => h("li", { text: a }))) : null,
      h("p", { class: "suave pequeno", text: "La IA solo recomienda. La decisión final la toma una persona del equipo de Lion Pick Up." }));
  }

  function barraDemo() {
    const local = window.API?.modoLocal?.();
    const barra = h("div", { class: "modo-demo", role: "note" },
      local ? "Demo sin servidor: pagos simulados y datos guardados solo en este navegador." : "Modo demostración: pagos simulados y documentos ficticios.");
    document.body.prepend(barra);
  }

  document.addEventListener("DOMContentLoaded", () => { barraDemo(); bannerConsentimiento(); });

  window.UI = {
    h, agregar, limpiar, icono, pesos, fechaCorta, horaDe, hoyISO, aMinutos, horarios,
    ESTADOS, METODOS, PAGOS, chip, toast, hoja, confirmar, pedirTexto, conCarga,
    preferencias, bannerConsentimiento, pie, cadaTanto, esqueleto, vacio, marca, resultadoIA,
  };
})();
