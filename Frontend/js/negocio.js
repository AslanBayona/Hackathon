// Panel del negocio: registro, verificación, pedidos, productos, ventas y perfil.
(function () {
  const usuario = API.exigir(["negocio"]);
  if (!usuario) return;
  const { h, limpiar, icono, pesos, chip, toast, hoja, confirmar, conCarga } = UI;

  const raiz = document.getElementById("vista");
  const btnSalir = document.getElementById("btn-salir");
  btnSalir.appendChild(icono("salir", 22));
  btnSalir.addEventListener("click", API.salir);
  document.getElementById("pie").replaceWith(UI.pie());

  let datos = null;   // { negocio, productos, comision_pct }
  let config = null;  // { puntos_encuentro, categorias, emojis, comision_pct, dominio_institucional }
  let detenerSondeo = null;
  let conteoActivos = null;

  const TABS = [["pedidos", "Pedidos", "recibo"], ["productos", "Productos", "caja"], ["ventas", "Ventas", "grafica"], ["perfil", "Perfil", "lapiz"]];

  iniciar();

  async function iniciar() {
    limpiar(raiz, UI.esqueleto(3));
    try {
      [datos, config] = await Promise.all([API.llamar("/negocio"), API.llamar("/config")]);
    } catch (e) {
      limpiar(raiz, UI.vacio("⚠️", "No pudimos cargar tu negocio", e.message, h("button", { class: "btn btn-primario", onclick: iniciar }, "Reintentar")));
      return;
    }
    if (!datos.negocio) onboarding();
    else { window.addEventListener("hashchange", panel); panel(); }
  }

  async function recargar() {
    datos = await API.llamar("/negocio");
  }

  // ---------- Formulario del negocio (registro y perfil) ----------
  function formularioNegocio(tipo, actual) {
    const n = actual || {};
    const nombre = h("input", { type: "text", maxlength: 50, value: n.nombre || "", required: true });
    const descripcion = h("textarea", { maxlength: 160, rows: 2, value: n.descripcion || "", placeholder: "Qué vendes y qué te hace especial" });
    const categoria = h("select", {}, config.categorias.map((c) => h("option", { value: c, selected: c === n.categoria }, c)));
    let emoji = n.emoji || config.emojis[0];
    const selectorEmoji = h("div", { class: "selector-emoji", role: "group", "aria-label": "Ícono del negocio" },
      config.emojis.map((e) => h("button", {
        type: "button", "aria-pressed": String(e === emoji), "aria-label": `Ícono ${e}`, text: e,
        onclick: (ev) => {
          emoji = e;
          selectorEmoji.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
          ev.currentTarget.setAttribute("aria-pressed", "true");
        },
      })));
    const campos = [
      h("label", { class: "campo" }, h("span", { text: "Nombre del negocio" }), nombre),
      h("label", { class: "campo" }, h("span", { text: "Descripción" }), descripcion),
      h("div", { class: "fila-campos" }, h("label", { class: "campo" }, h("span", { text: "Categoría" }), categoria)),
      h("div", { class: "campo" }, h("span", { text: "Ícono" }), selectorEmoji),
    ];
    let leerExtra;
    if (tipo === "fijo") {
      const ubicacion = h("input", { type: "text", maxlength: 80, value: n.ubicacion || "", placeholder: "Ej. Cafetería central, local 2" });
      const apertura = h("input", { type: "time", value: n.apertura || "08:00" });
      const cierre = h("input", { type: "time", value: n.cierre || "18:00" });
      campos.push(
        h("label", { class: "campo" }, h("span", { text: "¿Dónde recogen los clientes?" }), ubicacion),
        h("div", { class: "fila-campos" },
          h("label", { class: "campo" }, h("span", { text: "Abre" }), apertura),
          h("label", { class: "campo" }, h("span", { text: "Cierra" }), cierre)));
      leerExtra = () => ({ ubicacion: ubicacion.value, apertura: apertura.value, cierre: cierre.value });
    } else {
      const v = n.ventana || {};
      const fecha = h("input", { type: "date", value: v.fecha && v.fecha >= UI.hoyISO() ? v.fecha : UI.hoyISO(), min: UI.hoyISO() });
      const inicio = h("input", { type: "time", value: v.inicio || "11:00" });
      const fin = h("input", { type: "time", value: v.fin || "15:00" });
      const elegidos = new Set(n.puntos_encuentro || []);
      const puntos = h("div", { class: "opciones" }, config.puntos_encuentro.map((p) => {
        const casilla = h("input", { type: "checkbox", value: p, checked: elegidos.has(p) });
        casilla.addEventListener("change", () => {
          const marcadas = puntos.querySelectorAll("input:checked").length;
          puntos.querySelectorAll("input:not(:checked)").forEach((c) => { c.disabled = marcadas >= 3; });
        });
        return h("label", { class: "opcion" }, casilla, h("span", { text: p }));
      }));
      campos.push(
        h("div", { class: "fila-campos" },
          h("label", { class: "campo" }, h("span", { text: "Día de venta" }), fecha),
          h("label", { class: "campo" }, h("span", { text: "Desde" }), inicio),
          h("label", { class: "campo" }, h("span", { text: "Hasta" }), fin)),
        h("fieldset", { class: "campo", style: "border:0;padding:0;margin:0" },
          h("legend", { style: "font-weight:700;margin-bottom:.35rem", text: "Puntos de encuentro (hasta 3)" }), puntos,
          h("small", { text: "Elige lugares concurridos dentro del campus." })));
      setTimeout(() => puntos.querySelector("input")?.dispatchEvent(new Event("change")), 0);
      leerExtra = () => ({
        ventana: { fecha: fecha.value, inicio: inicio.value, fin: fin.value },
        puntos_encuentro: [...puntos.querySelectorAll("input:checked")].map((c) => c.value),
      });
    }
    return {
      elemento: h("div", { class: "formulario" }, campos),
      leer: () => ({ nombre: nombre.value, descripcion: descripcion.value, categoria: categoria.value, emoji, ...leerExtra() }),
    };
  }

  // ---------- Registro inicial ----------
  function onboarding() {
    const pct = config.comision_pct;
    const dominio = config.dominio_institucional;
    const contenedorForm = h("div", { class: "seccion" });
    const opcionTipo = (tipo, titulo, puntos) => h("button", {
      type: "button", class: "tipo-opcion", "aria-pressed": "false", "data-tipo": tipo,
      onclick: (e) => {
        document.querySelectorAll(".tipo-opcion").forEach((b) => b.setAttribute("aria-pressed", "false"));
        e.currentTarget.setAttribute("aria-pressed", "true");
        pintarFormulario(tipo);
      },
    },
      h("span", { class: "emoji-sello", style: tipo === "temporal" ? "background:var(--izamal-claro)" : "", text: tipo === "fijo" ? "🏪" : "🎒" }),
      h("h3", { text: titulo }),
      h("ul", {}, puntos.map((p) => h("li", { text: p }))));

    function pintarFormulario(tipo) {
      const form = formularioNegocio(tipo);
      const errorCaja = h("p", { class: "aviso error oculto" });
      const boton = h("button", { class: "btn btn-primario" }, "Registrar negocio");
      const avisoDominio = tipo === "temporal" && dominio && !usuario.email.endsWith("@" + dominio)
        ? h("div", { class: "aviso error" }, icono("alerta"), `Para vender como estudiante necesitas una cuenta con correo @${dominio}. Crea una cuenta nueva con tu correo institucional.`)
        : null;
      boton.addEventListener("click", () => conCarga(boton, async () => {
        errorCaja.classList.add("oculto");
        try {
          datos = await API.llamar("/negocio", { metodo: "POST", datos: { tipo, ...form.leer() } });
          Sesion.actualizarUsuario({ ...usuario, negocio_id: datos.negocio.id });
          toast("Negocio registrado. Ahora verifica tu identidad.", "ok");
          window.addEventListener("hashchange", panel);
          location.hash = "productos";
          panel();
        } catch (e) { errorCaja.textContent = e.message; errorCaja.classList.remove("oculto"); }
      }));
      limpiar(contenedorForm, h("div", { class: "panel" },
        h("h2", { text: tipo === "fijo" ? "Datos del local" : "Datos de tu venta", style: "margin-bottom:1rem" }),
        avisoDominio, form.elemento, errorCaja, h("div", { class: "hoja-acciones" }, boton)));
      contenedorForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    limpiar(raiz,
      h("h1", { text: "Registra tu negocio" }),
      h("p", { class: "suave", style: "margin:.6rem 0 1.5rem;max-width:40rem", text: "Elige cómo vas a vender." }),
      h("div", { class: "tipo-opciones" },
        opcionTipo("fijo", "Tengo un local en el campus", [
          "El cliente paga en la app.",
          `Comisión de ${pct.fijo}% por producto.`,
          "Horario fijo.",
        ]),
        opcionTipo("temporal", "Soy estudiante y vendo", [
          "Sin cobros en la app: te pagan al recoger.",
          `Comisión de ${pct.temporal}% por producto entregado.`,
          "Tú eliges día, hora y punto de entrega.",
          dominio ? `Requiere correo @${dominio}.` : null,
        ].filter(Boolean))),
      contenedorForm);
  }

  // ---------- Panel principal ----------
  function tabActual() {
    const t = location.hash.slice(1);
    return TABS.some(([id]) => id === t) ? t : "pedidos";
  }

  function panel() {
    if (detenerSondeo) { detenerSondeo(); detenerSondeo = null; }
    const n = datos.negocio;
    const temporal = n.tipo === "temporal";
    const v = n.ventana || {};
    const tab = tabActual();
    const contenido = h("div", { class: "seccion" });
    limpiar(raiz,
      h("div", { class: "cabecera-panel" },
        h("span", { class: `emoji-sello grande ${temporal ? "temporal" : ""}`, text: n.emoji }),
        h("div", { class: "cuerpo" },
          h("h1", { text: n.nombre }),
          h("div", { class: "datos-negocio" },
            chip(n.estado),
            h("span", { class: `chip sin-punto ${temporal ? "amarillo" : ""}`, text: temporal ? "Estudiante" : "Local del campus" }),
            temporal
              ? h("span", { class: "meta" }, icono("reloj", 16), `${UI.fechaCorta(v.fecha)}, ${v.inicio} a ${v.fin}`)
              : h("span", { class: "meta" }, icono("reloj", 16), `${n.apertura} a ${n.cierre}`)))),
      n.estado !== "aprobado" ? tarjetaVerificacion(n) : null,
      h("div", { class: "segmentos", role: "tablist", style: "margin-top:1.5rem" },
        TABS.map(([id, texto]) => h("button", {
          role: "tab", "aria-selected": String(id === tab), "aria-pressed": String(id === tab),
          onclick: () => { location.hash = id; },
        }, texto))),
      contenido);
    ({ pedidos: tabPedidos, productos: tabProductos, ventas: tabVentas, perfil: tabPerfil })[tab](contenido);
  }

  // ---------- Verificación ----------
  function comprimir(archivo) {
    return new Promise((resolver, rechazar) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        const ctx = lienzo.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        URL.revokeObjectURL(url);
        let calidad = 0.85;
        let resultado = lienzo.toDataURL("image/jpeg", calidad);
        while (resultado.length > 4_400_000 && calidad > 0.4) { calidad -= 0.15; resultado = lienzo.toDataURL("image/jpeg", calidad); }
        resolver(resultado);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error("No pudimos leer esa imagen. Prueba con otra JPG o PNG.")); };
      img.src = url;
    });
  }

  function tarjetaVerificacion(n) {
    const v = n.verificacion;
    const archivo = h("input", { type: "file", accept: "image/jpeg,image/png", "aria-label": "Imagen del documento" });
    const vistaPrevia = h("img", { class: "vista-previa oculto", alt: "Vista previa del documento" });
    const nombre = h("input", { type: "text", maxlength: 80, value: (v && v.nombre_declarado) || usuario.nombre });
    const errorCaja = h("p", { class: "aviso error oculto" });
    const boton = h("button", { class: "btn btn-primario", disabled: true }, icono("escudo", 18), "Enviar a verificación");
    let imagen = null;

    archivo.addEventListener("change", async () => {
      const f = archivo.files[0];
      imagen = null;
      boton.disabled = true;
      if (!f) return;
      if (!/^image\/(jpeg|png)$/.test(f.type)) { toast("Sube una imagen JPG o PNG.", "error"); return; }
      try {
        imagen = await comprimir(f);
        vistaPrevia.src = imagen;
        vistaPrevia.classList.remove("oculto");
        boton.disabled = false;
      } catch (e) { toast(e.message, "error"); }
    });

    boton.addEventListener("click", () => conCarga(boton, async () => {
      errorCaja.classList.add("oculto");
      try {
        await API.llamar("/negocio/documento", { metodo: "POST", datos: { nombre_responsable: nombre.value, imagen } });
        await recargar();
        toast("Documento enviado. La IA ya lo revisó.", "ok");
        panel();
      } catch (e) { errorCaja.textContent = e.message; errorCaja.classList.remove("oculto"); }
    }));

    const rechazado = n.estado === "rechazado";
    return h("section", { class: "panel pila", "aria-label": "Verificación del negocio" },
      h("div", { class: "seccion-cabeza", style: "margin:0" }, h("h2", { text: "Verificación" }), icono("escudo", 24)),
      rechazado
        ? h("div", { class: "aviso error" }, icono("alerta"), `El equipo no aprobó tu negocio${n.revision?.nota ? `: ${n.revision.nota}` : "."} Puedes enviar otro documento.`)
        : h("div", { class: "aviso" }, icono("info"), v
          ? "Tu documento ya fue analizado. Una persona del equipo aprobará tu negocio pronto; mientras, puedes cargar tus productos."
          : "Tu negocio todavía no aparece para los clientes. Sube una identificación o tu credencial para verificarte."),
      v ? UI.resultadoIA(v) : null,
      h("details", { class: "desplegable", open: !v || rechazado },
        h("summary", { text: v ? "Enviar otro documento" : "Subir documento" }),
        h("div", { class: "formulario" },
          h("div", { class: "aviso info" }, icono("escudo"), "En esta demo usa un documento de muestra, no uno real. La imagen se guarda cifrada y solo la ve el equipo de verificación."),
          h("label", { class: "campo" }, h("span", { text: "Nombre del responsable, como aparece en el documento" }), nombre),
          h("label", { class: "archivo" }, h("span", { class: "pequeno", style: "font-weight:700", text: "Imagen JPG o PNG" }), archivo),
          vistaPrevia, errorCaja, h("div", {}, boton))));
  }

  // ---------- Pedidos ----------
  const ACCIONES = {
    preparar: ["Empezar a preparar", "btn-primario"],
    listo: ["Ya está listo", "btn-primario"],
    entregar: ["Marcar entregado", "btn-primario"],
    aceptar: ["Aceptar", "btn-primario"],
    rechazar: ["Rechazar", "btn-peligro"],
  };

  async function tabPedidos(cont) {
    limpiar(cont, UI.esqueleto(2));
    let firma = "";
    async function cargar() {
      const r = await API.llamar("/negocio/pedidos");
      if (conteoActivos !== null && r.activos.length > conteoActivos) toast("Tienes un pedido nuevo.", "ok");
      conteoActivos = r.activos.length;
      const nueva = JSON.stringify(r);
      if (nueva === firma || !document.body.contains(cont)) return;
      const enfocado = document.activeElement;
      if (cont.contains(enfocado) && enfocado.tagName === "INPUT" && enfocado.value) return; // no borrar un código a medio escribir
      firma = nueva;
      pintar(r);
    }
    function pintar(r) {
      limpiar(cont,
        r.activos.length
          ? h("div", { class: "pila" }, r.activos.map(tarjetaPedido))
          : UI.vacio("🛎️", "Sin pedidos por ahora",
            datos.negocio.estado === "aprobado" ? "Cuando alguien pida, aparecerá aquí al momento." : "Tu negocio aparecerá para los clientes cuando el equipo lo apruebe."),
        r.cerrados.length ? h("section", { class: "seccion pila" }, h("h2", { text: "Pedidos cerrados" }),
          h("div", { class: "lista" }, r.cerrados.map((p) => h("div", { class: "fila" },
            h("span", { class: "cuerpo" }, h("strong", { text: `Pedido ${p.id}` }),
              h("span", { class: "suave pequeno", text: `${p.cliente_nombre}, ${UI.fechaCorta(p.creado)} ${UI.horaDe(p.creado)}` })),
            h("span", { class: "derecha" }, chip(p.estado), h("span", { class: "precio pequeno", text: pesos(p.total) })))))) : null);
    }
    try { await cargar(); } catch (e) {
      limpiar(cont, UI.vacio("⚠️", "No pudimos cargar los pedidos", e.message, h("button", { class: "btn btn-primario", onclick: () => tabPedidos(cont) }, "Reintentar")));
      return;
    }
    if (document.body.contains(cont)) detenerSondeo = UI.cadaTanto(cargar, 5000);
  }

  function tarjetaPedido(p) {
    const temporal = p.tipo === "temporal";
    const pct = config.comision_pct[p.tipo];
    const acciones = p.acciones.filter((a) => a !== "completar").map((a) => h("button", {
      class: `btn btn-chico ${ACCIONES[a][1]}`,
      onclick: (e) => ejecutar(p, a, e.currentTarget),
    }, ACCIONES[a][0]));
    let liberar = null;
    if (p.acciones.includes("completar")) {
      const codigo = h("input", { type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "000000", "aria-label": "Código del cliente" });
      const boton = h("button", { class: "btn btn-acento btn-chico" }, icono("check", 16), "Confirmar entrega");
      const enviar = () => conCarga(boton, async () => {
        const valor = codigo.value.replace(/\D/g, "");
        if (valor.length !== 6) { toast("El código tiene 6 dígitos.", "error"); return; }
        try {
          await API.llamar(`/negocio/pedidos/${encodeURIComponent(p.id)}/completar`, { metodo: "POST", datos: { codigo: valor } });
          toast("Entrega confirmada. Venta registrada.", "ok");
          codigo.value = "";
          await recargar();
          panel();
        } catch (e) { toast(e.message, "error"); codigo.select(); }
      });
      boton.addEventListener("click", enviar);
      codigo.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
      liberar = h("div", { class: "pila", style: "gap:.5rem" },
        h("span", { class: "pequeno", style: "font-weight:700", text: "Al entregar, escribe el código del cliente:" }),
        h("div", { class: "codigo-entrada" }, codigo, boton),
        p.intentos_restantes < 3 ? h("span", { class: "quedan", text: `Te quedan ${p.intentos_restantes} intentos.` }) : null);
    }
    return h("article", { class: "pedido" },
      h("div", { class: "pedido-cabeza" },
        h("div", { class: "cuerpo" }, h("h3", { text: `Pedido ${p.id}` }), h("span", { class: "suave pequeno", text: `${p.cliente_nombre}, pidió a las ${UI.horaDe(p.creado)}` })),
        chip(p.estado)),
      h("div", { class: "datos-negocio" },
        h("span", { class: "meta" }, icono("reloj", 16), p.horario === "asap" ? "Lo antes posible" : `Para las ${p.horario}`),
        temporal ? h("span", { class: "meta" }, icono("pin", 16), p.punto_encuentro) : null,
        h("span", { class: "meta" }, icono("info", 16), temporal ? `Te paga con ${UI.METODOS[p.pago.metodo].toLowerCase()}` : UI.PAGOS[p.pago.estado])),
      h("ul", { class: "pedido-items" },
        p.items.map((i) => h("li", {}, h("span", { text: `${i.cantidad} × ${i.nombre}` }), h("span", { class: "precio", text: pesos(i.subtotal) }))),
        h("li", {}, h("strong", { text: temporal ? "Cobras en persona" : "Total pagado" }), h("strong", { class: "precio", text: pesos(p.total) })),
        h("li", { class: "suave" }, h("span", { text: `Comisión Lion Pick Up (${pct}%)` }), h("span", { class: "precio", text: `−${pesos(p.comision_total)}` })),
        h("li", {}, h("span", { text: temporal ? "Te quedas con" : "Recibes" }), h("span", { class: "precio", text: pesos(p.neto) }))),
      p.codigo_bloqueado ? h("div", { class: "aviso error" }, icono("alerta"), "Bloqueado por códigos incorrectos. El cliente puede cancelarlo o pedir ayuda a soporte.") : null,
      acciones.length ? h("div", { class: "acciones" }, acciones) : null,
      liberar);
  }

  async function ejecutar(p, accion, boton) {
    if (accion === "rechazar") {
      const ok = await confirmar("¿Rechazar este pedido?",
        p.tipo === "fijo" ? "Al cliente se le reembolsa el pago simulado y el producto vuelve a tu stock." : "El apartado se cancela y el producto vuelve a tu stock.",
        { aceptar: "Rechazar", peligro: true });
      if (!ok) return;
    }
    await conCarga(boton, async () => {
      try {
        await API.llamar(`/negocio/pedidos/${encodeURIComponent(p.id)}/accion`, { metodo: "POST", datos: { accion } });
        toast({ preparar: "Pedido en preparación.", listo: "Avisamos al cliente que está listo.", entregar: "Pedido entregado. Venta registrada.", aceptar: "Apartado aceptado.", rechazar: "Pedido rechazado." }[accion], "ok");
        if (accion === "entregar") await recargar();
        panel();
      } catch (e) { toast(e.message, "error"); }
    });
  }

  // ---------- Productos ----------
  function tabProductos(cont) {
    const productos = datos.productos;
    limpiar(cont,
      h("div", { class: "seccion-cabeza" },
        h("h2", { text: "Tu menú" }),
        h("button", { class: "btn btn-primario btn-chico", onclick: () => editarProducto(null) }, icono("mas", 16), "Agregar producto")),
      productos.length
        ? h("div", { class: "lista" }, productos.map(filaProducto))
        : UI.vacio("🧺", "Todavía no tienes productos", "Agrega lo que vas a vender con su precio y cuántas piezas tienes.",
          h("button", { class: "btn btn-primario", onclick: () => editarProducto(null) }, "Agregar producto")));
  }

  function filaProducto(p) {
    const salida = h("output", { text: p.stock });
    const actualizar = async (cambios, mensaje) => {
      try {
        const r = await API.llamar(`/negocio/productos/${encodeURIComponent(p.id)}`, { metodo: "PUT", datos: cambios });
        Object.assign(p, r.producto);
        salida.textContent = p.stock;
        menos.disabled = p.stock <= 0;
        if (mensaje) toast(mensaje, "ok");
      } catch (e) { toast(e.message, "error"); }
    };
    const menos = h("button", { "aria-label": `Una pieza menos de ${p.nombre}`, disabled: p.stock <= 0, onclick: () => actualizar({ stock: Math.max(0, p.stock - 1) }) }, icono("menos", 16));
    const mas = h("button", { "aria-label": `Una pieza más de ${p.nombre}`, onclick: () => actualizar({ stock: Math.min(999, p.stock + 1) }) }, icono("mas", 16));
    const visible = h("input", { type: "checkbox", checked: p.activo, "aria-label": `Mostrar ${p.nombre} en el menú` });
    visible.addEventListener("change", () => actualizar({ activo: visible.checked }, visible.checked ? "Producto visible." : "Producto oculto."));
    return h("div", { class: "fila", style: "flex-wrap:wrap" },
      h("span", { class: "emoji-sello", style: "width:46px;height:46px;font-size:1.5rem", text: p.emoji }),
      h("span", { class: "cuerpo", style: "min-width:160px" },
        h("strong", { text: p.nombre }),
        h("span", { class: "precio suave", text: pesos(p.precio) })),
      h("div", { class: "acciones", style: "align-items:center" },
        h("div", { class: "stepper", title: "Piezas disponibles" }, menos, salida, mas),
        h("label", { class: "interruptor" }, visible, "Visible"),
        h("button", { class: "btn btn-fantasma btn-icono", "aria-label": `Editar ${p.nombre}`, onclick: () => editarProducto(p) }, icono("lapiz", 18))));
  }

  function editarProducto(p) {
    const nombre = h("input", { type: "text", maxlength: 50, value: p?.nombre || "" });
    const descripcion = h("input", { type: "text", maxlength: 120, value: p?.descripcion || "" });
    const precio = h("input", { type: "number", min: 1, max: 5000, step: "0.50", inputmode: "decimal", value: p ? (p.precio / 100).toFixed(2) : "" });
    const stock = h("input", { type: "number", min: 0, max: 999, step: 1, inputmode: "numeric", value: p ? p.stock : 10 });
    let emoji = p?.emoji || datos.negocio.emoji;
    const selector = h("div", { class: "selector-emoji" }, config.emojis.map((e) => h("button", {
      type: "button", "aria-pressed": String(e === emoji), "aria-label": `Ícono ${e}`, text: e,
      onclick: (ev) => { emoji = e; selector.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); },
    })));
    const pct = config.comision_pct[datos.negocio.tipo];
    const calculo = h("p", { class: "suave pequeno" });
    const recalcular = () => {
      const centavos = Math.round(parseFloat(precio.value || "0") * 100);
      if (!(centavos > 0)) { calculo.textContent = `Comisión de ${pct}% por pieza vendida.`; return; }
      const comision = Math.floor((centavos * pct + 50) / 100);
      calculo.textContent = `Por cada pieza: comisión de ${pesos(comision)} (${pct}%), recibes ${pesos(centavos - comision)}.`;
    };
    precio.addEventListener("input", recalcular);
    recalcular();
    const errorCaja = h("p", { class: "aviso error oculto" });
    const boton = h("button", { class: "btn btn-primario btn-bloque" }, p ? "Guardar cambios" : "Agregar producto");
    const ventana = hoja({
      titulo: p ? "Editar producto" : "Nuevo producto",
      contenido: h("div", { class: "formulario" },
        h("label", { class: "campo" }, h("span", { text: "Nombre" }), nombre),
        h("label", { class: "campo" }, h("span", { text: "Descripción corta" }), descripcion),
        h("div", { class: "fila-campos" },
          h("label", { class: "campo" }, h("span", { text: "Precio (MXN)" }), precio),
          h("label", { class: "campo" }, h("span", { text: "Piezas disponibles" }), stock)),
        calculo,
        h("div", { class: "campo" }, h("span", { text: "Ícono" }), selector),
        errorCaja, boton),
    });
    boton.addEventListener("click", () => conCarga(boton, async () => {
      errorCaja.classList.add("oculto");
      const cuerpo = { nombre: nombre.value, descripcion: descripcion.value, precio: precio.value, stock: Number(stock.value), emoji };
      try {
        if (p) await API.llamar(`/negocio/productos/${encodeURIComponent(p.id)}`, { metodo: "PUT", datos: cuerpo });
        else await API.llamar("/negocio/productos", { metodo: "POST", datos: cuerpo });
        await recargar();
        ventana.cerrar();
        toast(p ? "Producto actualizado." : "Producto agregado.", "ok");
        panel();
      } catch (e) { errorCaja.textContent = e.message; errorCaja.classList.remove("oculto"); }
    }));
    setTimeout(() => nombre.focus(), 50);
  }

  // ---------- Ventas ----------
  async function tabVentas(cont) {
    limpiar(cont, UI.esqueleto(2));
    try { await recargar(); } catch (e) { limpiar(cont, UI.vacio("⚠️", "No pudimos cargar tus ventas", e.message)); return; }
    const n = datos.negocio;
    const r = n.resumen;
    const temporal = n.tipo === "temporal";
    const ejemplo = datos.productos[0];
    const ejemploComision = ejemplo ? Math.floor((ejemplo.precio * r.comision_pct + 50) / 100) : 0;
    limpiar(cont,
      h("div", { class: "kpis" },
        h("div", { class: "kpi destacado" },
          h("span", { text: temporal ? "Comisión por liquidar" : "Neto a depositarte" }),
          h("strong", { text: pesos(temporal ? r.saldo_por_liquidar : r.neto_a_depositar) })),
        h("div", { class: "kpi" }, h("span", { text: "Ventas completadas" }), h("strong", { text: pesos(r.ventas_total) })),
        h("div", { class: "kpi" }, h("span", { text: "Pedidos completados" }), h("strong", { text: r.pedidos_completados })),
        h("div", { class: "kpi" }, h("span", { text: `Comisión total (${r.comision_pct}%)` }), h("strong", { text: pesos(r.comision_total) }))),
      h("section", { class: "panel seccion pila" },
        h("h2", { text: "Cómo se calcula tu comisión" }),
        h("p", { text: temporal
          ? `Lion Pick Up cobra ${r.comision_pct}% por cada producto vendido. Como el cliente te paga en persona, la comisión se acumula como saldo por liquidar y solo cuenta cuando liberas el pedido con el código.`
          : `Lion Pick Up cobra ${r.comision_pct}% por cada producto vendido. Se descuenta del pago que hace el cliente en la app y te depositamos el resto.` }),
        ejemplo ? h("div", { class: "aviso info" }, icono("info"),
          `Ejemplo: ${ejemplo.nombre} a ${pesos(ejemplo.precio)} genera ${pesos(ejemploComision)} de comisión; ${temporal ? "te quedas con" : "recibes"} ${pesos(ejemplo.precio - ejemploComision)}.`) : null));
  }

  // ---------- Perfil ----------
  function tabPerfil(cont) {
    const n = datos.negocio;
    const form = formularioNegocio(n.tipo, n);
    const errorCaja = h("p", { class: "aviso error oculto" });
    const boton = h("button", { class: "btn btn-primario" }, "Guardar cambios");
    boton.addEventListener("click", () => conCarga(boton, async () => {
      errorCaja.classList.add("oculto");
      try {
        datos = await API.llamar("/negocio", { metodo: "POST", datos: form.leer() });
        toast("Cambios guardados.", "ok");
        panel();
      } catch (e) { errorCaja.textContent = e.message; errorCaja.classList.remove("oculto"); }
    }));
    limpiar(cont, h("section", { class: "panel" },
      h("h2", { text: "Datos del negocio", style: "margin-bottom:.4rem" }),
      n.tipo === "temporal" ? h("p", { class: "suave", style: "margin-bottom:1rem", text: "Para vender otro día, cambia la fecha y el horario de tu venta." }) : null,
      form.elemento, errorCaja, h("div", { class: "hoja-acciones" }, boton)));
  }
})();
