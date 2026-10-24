// App del cliente: explorar, carrito, pedidos y ayuda.
(function () {
  const usuario = API.exigir(["cliente", "negocio"]);
  if (!usuario) return;
  const { h, limpiar, icono, pesos, chip, toast, hoja, confirmar, conCarga, preferencias } = UI;

  const raiz = document.getElementById("vista");
  const barraCarrito = document.getElementById("barra-carrito");
  const btnCarrito = document.getElementById("btn-carrito");
  const primerNombre = usuario.nombre.split(" ")[0];
  const ACTIVOS = ["pagado", "preparando", "listo", "apartado", "aceptado"];

  const estado = {
    negocios: null,
    filtro: preferencias.leer("filtro", "todos"),
    busqueda: "",
    carrito: preferencias.leer("carrito", null),
    negocioActual: null,
    pedidos: null,
    firmaPedidos: "",
    nuevoPedidoId: null,
    pedidoAyuda: null,
    chat: [{ rol: "asistente", texto: `Hola, ${primerNombre}. Soy Leo, el asistente de Lion Pick Up. Pregúntame sobre tus pedidos, los apartados o cómo vender.` }],
  };
  let detenerSondeo = null;
  let version = 0; // cambia en cada navegación: evita que una respuesta tardía pinte otra vista

  // ---------- Encabezado y navegación ----------
  btnCarrito.appendChild(icono("carrito", 22));
  const contador = h("span", { class: "contador oculto" });
  btnCarrito.appendChild(contador);
  btnCarrito.addEventListener("click", abrirCarrito);
  const btnSalir = document.getElementById("btn-salir");
  btnSalir.appendChild(icono("salir", 22));
  btnSalir.addEventListener("click", API.salir);
  if (usuario.rol === "negocio") document.getElementById("ir-negocio").classList.remove("oculto");
  const ETIQUETAS_NAV = { explorar: ["explorar", "Explorar"], pedidos: ["recibo", "Pedidos"], ayuda: ["ayuda", "Ayuda"] };
  document.querySelectorAll(".nav-inferior a").forEach((a) => {
    const [ic, texto] = ETIQUETAS_NAV[a.dataset.vista];
    a.append(icono(ic, 22), texto);
  });
  document.getElementById("pie").replaceWith(UI.pie());

  function marcarNav(vista) {
    document.querySelectorAll("[data-vista]").forEach((a) => {
      if (a.dataset.vista === vista) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  window.addEventListener("hashchange", enrutar);
  enrutar();

  function enrutar() {
    version++;
    if (detenerSondeo) { detenerSondeo(); detenerSondeo = null; }
    const [vista, parametro] = (location.hash.slice(1) || "explorar").split("/");
    marcarNav(vista === "negocio" ? "explorar" : vista);
    window.scrollTo(0, 0);
    actualizarCarritoUI(vista);
    if (vista === "negocio" && parametro) return mostrarNegocio(decodeURIComponent(parametro));
    if (vista === "pedidos") return mostrarPedidos();
    if (vista === "ayuda") return mostrarAyuda();
    return mostrarExplorar();
  }

  const normalizar = (t) => (t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function abiertoAhora(n) {
    if (!n.apertura || !n.cierre) return true;
    const d = new Date();
    const ahora = d.getHours() * 60 + d.getMinutes();
    return ahora >= UI.aMinutos(n.apertura) && ahora <= UI.aMinutos(n.cierre);
  }

  // ---------- Explorar ----------
  async function mostrarExplorar() {
    const buscador = h("input", {
      type: "search", placeholder: "Busca café, marquesitas, bowls…", "aria-label": "Buscar", value: estado.busqueda,
      oninput: (e) => { estado.busqueda = e.target.value; pintarResultados(); },
    });
    const opciones = [["todos", "Todo"], ["temporal", "Estudiantes hoy"], ["fijo", "Locales"]];
    const segmentos = h("div", { class: "segmentos", role: "group", "aria-label": "Filtrar" },
      opciones.map(([valor, texto]) => h("button", {
        type: "button", "aria-pressed": String(estado.filtro === valor),
        onclick: (e) => {
          estado.filtro = valor;
          preferencias.guardar("filtro", valor);
          segmentos.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
          e.currentTarget.setAttribute("aria-pressed", "true");
          pintarResultados();
        },
      }, texto)));
    limpiar(raiz,
      h("section", { class: "saludo" },
        h("p", { class: "suave", text: `Hola, ${primerNombre}` }),
        h("h1", { text: "¿Qué se te antoja hoy?" }),
        h("div", { class: "buscador" }, icono("explorar", 18), buscador),
        h("div", {}, segmentos)),
      h("div", { id: "resultados" }, estado.negocios ? null : UI.esqueleto(3)));
    if (estado.negocios) pintarResultados();
    try {
      const r = await API.llamar("/negocios");
      estado.negocios = r.negocios;
      pintarResultados();
    } catch (e) {
      const cont = document.getElementById("resultados");
      if (cont && !estado.negocios) {
        limpiar(cont, UI.vacio("⚠️", "No pudimos cargar los negocios", e.message,
          h("button", { class: "btn btn-primario", onclick: mostrarExplorar }, "Reintentar")));
      }
    }
  }

  function pintarResultados() {
    const cont = document.getElementById("resultados");
    if (!cont || !estado.negocios) return;
    const q = normalizar(estado.busqueda.trim());
    let lista = estado.negocios.filter((n) => estado.filtro === "todos" || n.tipo === estado.filtro);
    if (q) lista = lista.filter((n) => normalizar(`${n.nombre} ${n.descripcion} ${n.categoria}`).includes(q));
    const temporales = lista.filter((n) => n.tipo === "temporal");
    const fijos = lista.filter((n) => n.tipo === "fijo");
    limpiar(cont,
      temporales.length ? h("section", { class: "seccion" },
        h("div", { class: "seccion-cabeza" }, h("h2", { text: "Estudiantes que venden hoy" }), h("span", { class: "suave pequeno", text: "Apartas y pagas al recoger" })),
        h("div", { class: "franja" }, temporales.map(tarjetaVendedor))) : null,
      fijos.length ? h("section", { class: "seccion" },
        h("div", { class: "seccion-cabeza" }, h("h2", { text: "Locales del campus" }), h("span", { class: "suave pequeno", text: "Pagas en la app" })),
        h("div", { class: "lista" }, fijos.map(filaLocal))) : null,
      lista.length ? null : UI.vacio("🔎",
        q ? "No encontramos nada con esa búsqueda" : "Todavía no hay negocios aquí",
        q ? "Prueba con otra palabra, como café o tacos." : "Cuando el equipo apruebe negocios, aparecerán en esta sección."));
  }

  function tarjetaVendedor(n) {
    const v = n.ventana || {};
    const cuando = n.estado_venta === "proxima" ? `Vende el ${UI.fechaCorta(v.fecha)}, de ${v.inicio} a ${v.fin}` : `Hoy de ${v.inicio} a ${v.fin}`;
    return h("button", { class: "vendedor-hoy", onclick: () => { location.hash = `negocio/${encodeURIComponent(n.id)}`; } },
      h("span", { class: "banda", "aria-hidden": "true" }),
      h("span", { class: "contenido" },
        h("span", { class: "titulo" },
          h("span", { class: "emoji-sello temporal", text: n.emoji }),
          h("span", {}, h("strong", { text: n.nombre }), h("span", { class: "suave pequeno", style: "display:block", text: n.categoria }))),
        h("span", { class: "meta" }, icono("reloj", 16), cuando),
        h("span", { class: "meta" }, icono("pin", 16), (n.puntos_encuentro || []).join(", ")),
        n.productos_disponibles === 0 ? h("span", { class: "agotado", text: "Agotado por hoy" }) : null));
  }

  function filaLocal(n) {
    const abierto = abiertoAhora(n);
    return h("button", { class: "fila", onclick: () => { location.hash = `negocio/${encodeURIComponent(n.id)}`; } },
      h("span", { class: "emoji-sello", text: n.emoji }),
      h("span", { class: "cuerpo" },
        h("strong", { text: n.nombre }),
        h("span", { class: "meta" }, icono("pin", 16), n.ubicacion),
        h("span", { class: "meta" }, icono("reloj", 16), `${n.apertura} a ${n.cierre}`, abierto ? "" : ", cerrado ahora")),
      h("span", { class: "derecha" }, icono("derecha")));
  }

  // ---------- Detalle de negocio ----------
  const botonVolver = () => h("a", { class: "btn btn-fantasma btn-chico", href: "#explorar" }, icono("atras", 18), "Volver");

  async function mostrarNegocio(id) {
    const mia = version;
    limpiar(raiz, botonVolver(), h("div", { style: "margin-top:1rem" }, UI.esqueleto(4)));
    try {
      const r = await API.llamar(`/negocios/${encodeURIComponent(id)}`);
      if (mia !== version) return;
      estado.negocioActual = r;
      pintarNegocio();
    } catch (e) {
      if (mia !== version) return;
      limpiar(raiz, botonVolver(), UI.vacio("🍽️", "Este negocio no está disponible", e.message));
    }
  }

  function pintarNegocio() {
    const { negocio: n, productos } = estado.negocioActual;
    const temporal = n.tipo === "temporal";
    const v = n.ventana || {};
    const puedeComprar = temporal ? n.estado_venta === "abierta" : abiertoAhora(n);
    const datos = temporal
      ? [h("span", { class: "chip amarillo sin-punto", text: "Estudiante" }),
         h("span", { class: "meta" }, icono("reloj", 16), n.estado_venta === "proxima" ? `Vende el ${UI.fechaCorta(v.fecha)}, ${v.inicio} a ${v.fin}` : `Hoy de ${v.inicio} a ${v.fin}`),
         h("span", { class: "meta" }, icono("pin", 16), (n.puntos_encuentro || []).join(", "))]
      : [h("span", { class: "chip sin-punto", text: "Local del campus" }),
         h("span", { class: "meta" }, icono("pin", 16), n.ubicacion),
         h("span", { class: "meta" }, icono("reloj", 16), `${n.apertura} a ${n.cierre}`)];
    limpiar(raiz,
      botonVolver(),
      h("div", { class: "cabecera-negocio" },
        h("span", { class: `emoji-sello grande ${temporal ? "temporal" : ""}`, text: n.emoji }),
        h("div", { class: "cuerpo" },
          h("h1", { text: n.nombre }),
          n.descripcion ? h("p", { class: "suave", text: n.descripcion }) : null,
          h("div", { class: "datos-negocio" }, datos))),
      temporal ? h("div", { class: "aviso" }, icono("info"),
        "Apartas gratis y pagas al recoger. Tu código confirma la entrega.") : null,
      !puedeComprar ? h("div", { class: "aviso error", style: "margin-top:.75rem" }, icono("reloj"),
        temporal ? "Este vendedor todavía no abre su venta. Podrás apartar el día de la venta." : "Este local está cerrado ahora. Vuelve en su horario.") : null,
      h("section", { class: "seccion" },
        h("h2", { text: "Menú", style: "margin-bottom:.75rem" }),
        productos.length
          ? h("div", { class: "lista", id: "lista-productos" }, productos.map((p) => filaProducto(n, p, puedeComprar)))
          : UI.vacio("🧺", "Sin productos por ahora", "Este negocio todavía no publica su menú.")));
  }

  function filaProducto(n, p, puedeComprar) {
    const cantidad = cantidadEnCarrito(p.id);
    const maximo = Math.min(p.stock, 10);
    let control;
    if (p.stock <= 0) control = h("span", { class: "agotado", text: "Agotado" });
    else if (!puedeComprar) control = null;
    else if (cantidad === 0) {
      control = h("button", { class: "btn btn-secundario btn-chico", "data-foco": "agregar", "aria-label": `Agregar ${p.nombre}`, onclick: () => cambiar(n, p, 1) }, icono("mas", 16), "Agregar");
    } else {
      control = h("div", { class: "stepper" },
        h("button", { "aria-label": `Quitar un ${p.nombre}`, "data-foco": "menos", onclick: () => cambiar(n, p, -1) }, icono("menos", 16)),
        h("output", { "aria-live": "polite", text: cantidad }),
        h("button", { "aria-label": `Agregar otro ${p.nombre}`, "data-foco": "mas", disabled: cantidad >= maximo, onclick: () => cambiar(n, p, 1) }, icono("mas", 16)));
    }
    const fila = h("div", { class: "fila", "data-producto": p.id },
      h("span", { class: "emoji-sello", style: "width:46px;height:46px;font-size:1.5rem", text: p.emoji }),
      h("span", { class: "cuerpo" },
        h("strong", { text: p.nombre }),
        p.descripcion ? h("span", { class: "suave pequeno", text: p.descripcion }) : null,
        h("span", {}, h("span", { class: "precio", text: pesos(p.precio) }),
          p.stock > 0 && p.stock <= 5 ? h("span", { class: "quedan", style: "margin-left:.6rem", text: `Quedan ${p.stock}` }) : null)),
      h("span", { class: "derecha" }, control));
    return fila;
  }

  // ---------- Carrito ----------
  function cantidadEnCarrito(productoId) {
    return estado.carrito?.items.find((i) => i.id === productoId)?.cantidad || 0;
  }
  function guardarCarrito() { preferencias.guardar("carrito", estado.carrito); }

  async function cambiar(n, p, delta) {
    if (estado.carrito && estado.carrito.negocio.id !== n.id && delta > 0) {
      const ok = await confirmar("¿Empezar un carrito nuevo?",
        `Tu carrito tiene productos de ${estado.carrito.negocio.nombre}. Cada pedido es de un solo negocio.`,
        { aceptar: "Vaciar y continuar" });
      if (!ok) return;
      estado.carrito = null;
    }
    if (!estado.carrito) estado.carrito = { negocio: n, items: [] };
    let item = estado.carrito.items.find((i) => i.id === p.id);
    if (!item) { item = { id: p.id, nombre: p.nombre, precio: p.precio, emoji: p.emoji, stock: p.stock, cantidad: 0 }; estado.carrito.items.push(item); }
    item.cantidad = Math.max(0, Math.min(item.cantidad + delta, Math.min(p.stock, 10)));
    estado.carrito.items = estado.carrito.items.filter((i) => i.cantidad > 0);
    if (!estado.carrito.items.length) estado.carrito = null;
    guardarCarrito();
    actualizarCarritoUI();
    const vieja = document.querySelector(`[data-producto="${CSS.escape(p.id)}"]`);
    if (vieja && estado.negocioActual) {
      const foco = document.activeElement?.dataset?.foco;
      const n2 = estado.negocioActual.negocio;
      const producto = estado.negocioActual.productos.find((x) => x.id === p.id) || p;
      const nueva = filaProducto(n2, producto, n2.tipo === "temporal" ? n2.estado_venta === "abierta" : abiertoAhora(n2));
      vieja.replaceWith(nueva);
      const destino = nueva.querySelector(`[data-foco="${foco}"]:not([disabled])`) || nueva.querySelector("[data-foco]:not([disabled])");
      if (destino) destino.focus();
    }
  }

  function totalCarrito() {
    return (estado.carrito?.items || []).reduce((s, i) => s + i.precio * i.cantidad, 0);
  }
  function piezasCarrito() {
    return (estado.carrito?.items || []).reduce((s, i) => s + i.cantidad, 0);
  }

  function actualizarCarritoUI(vista) {
    const piezas = piezasCarrito();
    contador.textContent = piezas;
    contador.classList.toggle("oculto", piezas === 0);
    const actual = vista || (location.hash.slice(1) || "explorar").split("/")[0];
    const mostrar = piezas > 0 && (actual === "explorar" || actual === "negocio");
    barraCarrito.classList.toggle("oculto", !mostrar);
    if (mostrar) {
      limpiar(barraCarrito, h("button", { class: "btn btn-primario", onclick: abrirCarrito },
        h("span", {}, `Ver carrito (${piezas})`), h("span", { class: "precio", text: pesos(totalCarrito()) })));
    }
  }

  function abrirCarrito() {
    if (!estado.carrito) { toast("Tu carrito está vacío. Agrega algo del menú."); return; }
    const n = estado.carrito.negocio;
    const temporal = n.tipo === "temporal";
    const contenido = h("div", { class: "pila" });
    const errorCaja = h("p", { class: "aviso error oculto" });
    let ventana;

    const horariosDisponibles = temporal
      ? UI.horarios(n.ventana.inicio, n.ventana.fin, n.ventana.fecha === UI.hoyISO())
      : UI.horarios(n.apertura, n.cierre, true);
    const selectHorario = h("select", { name: "horario" },
      temporal ? null : h("option", { value: "asap" }, "Lo antes posible"),
      horariosDisponibles.map((hh) => h("option", { value: hh }, hh)));
    const selectPunto = temporal ? h("select", { name: "punto" }, (n.puntos_encuentro || []).map((p) => h("option", { value: p }, p))) : null;
    const metodos = temporal ? ["efectivo", "transferencia", "tarjeta_vendedor"] : ["tarjeta_simulada", "saldo_simulado"];
    const grupoMetodo = h("div", { class: "opciones" }, metodos.map((m, i) =>
      h("label", { class: "opcion" }, h("input", { type: "radio", name: "metodo", value: m, checked: i === 0 }), h("span", {}, h("strong", { text: UI.METODOS[m] })))));
    const sinHorario = temporal && horariosDisponibles.length === 0;
    const cerrado = !temporal && !abiertoAhora(n);
    const boton = h("button", { class: `btn ${temporal ? "btn-acento" : "btn-primario"} btn-bloque`, disabled: sinHorario || cerrado }, "");

    function pintar() {
      if (!estado.carrito) { ventana.cerrar(); return; }
      boton.textContent = temporal ? `Apartar por ${pesos(totalCarrito())}` : `Pagar ${pesos(totalCarrito())}`;
      limpiar(contenido,
        h("div", { class: "meta" }, h("span", { text: n.emoji }), `Pedido en ${n.nombre}`),
        h("div", { class: "lista", style: "box-shadow:none;border:2px solid var(--cal)" },
          estado.carrito.items.map((i) => h("div", { class: "fila" },
            h("span", { class: "cuerpo" }, h("strong", { text: i.nombre }), h("span", { class: "precio suave pequeno", text: pesos(i.precio) })),
            h("div", { class: "stepper" },
              h("button", { "aria-label": `Quitar un ${i.nombre}`, onclick: () => { cambiar(n, i, -1); pintar(); } }, icono("menos", 16)),
              h("output", { text: i.cantidad }),
              h("button", { "aria-label": `Agregar otro ${i.nombre}`, disabled: i.cantidad >= Math.min(i.stock, 10), onclick: () => { cambiar(n, i, 1); pintar(); } }, icono("mas", 16)))))),
        h("div", { class: "total-linea" }, h("span", { text: "Total" }), h("span", { class: "precio", text: pesos(totalCarrito()) })),
        temporal ? h("label", { class: "campo" }, h("span", { text: "Punto de entrega" }), selectPunto) : null,
        h("label", { class: "campo" }, h("span", { text: temporal ? "Hora" : "¿Cuándo pasas?" }), selectHorario),
        h("fieldset", { class: "campo", style: "border:0;padding:0;margin:0" },
          h("legend", { style: "font-weight:700;margin-bottom:.35rem", text: temporal ? "Pagarás con" : "Método de pago" }), grupoMetodo),
        sinHorario ? h("div", { class: "aviso error" }, icono("reloj"), "La venta de hoy ya terminó.") : null,
        cerrado ? h("div", { class: "aviso error" }, icono("reloj"), "Este local está cerrado ahora.") : null,
        h("div", { class: temporal ? "aviso" : "aviso info" }, icono("info"),
          temporal
            ? "No pagas aquí: pagas al recoger y das tu código al recibir."
            : "Pago simulado: no se cobra nada real."),
        errorCaja,
        boton);
    }

    boton.addEventListener("click", () => conCarga(boton, async () => {
      errorCaja.classList.add("oculto");
      const datos = {
        negocio_id: n.id,
        items: estado.carrito.items.map((i) => ({ producto_id: i.id, cantidad: i.cantidad })),
        horario: selectHorario.value,
        metodo_pago: grupoMetodo.querySelector("input:checked").value,
      };
      if (temporal) datos.punto_encuentro = selectPunto.value;
      try {
        const r = await API.llamar("/pedidos", { metodo: "POST", datos });
        estado.carrito = null;
        guardarCarrito();
        estado.negocios = null;
        estado.nuevoPedidoId = r.pedido.id;
        ventana.cerrar();
        toast(temporal ? "Apartado listo. Guarda tu código." : "Pedido pagado. Te avisamos cuando esté listo.", "ok");
        location.hash = "pedidos";
      } catch (e) {
        errorCaja.textContent = e.message;
        errorCaja.classList.remove("oculto");
      }
    }));

    ventana = hoja({ titulo: "Tu carrito", contenido, alCerrar: () => actualizarCarritoUI() });
    pintar();
  }

  // ---------- Pedidos ----------
  async function mostrarPedidos() {
    const mia = version;
    limpiar(raiz,
      h("h1", { text: "Mis pedidos" }),
      h("div", { id: "lista-pedidos", class: "seccion" }, UI.esqueleto(2)));
    estado.firmaPedidos = "";
    try {
      await cargarPedidos();
    } catch (e) {
      const cont = document.getElementById("lista-pedidos");
      if (cont) limpiar(cont, UI.vacio("⚠️", "No pudimos cargar tus pedidos", e.message,
        h("button", { class: "btn btn-primario", onclick: mostrarPedidos }, "Reintentar")));
      return;
    }
    if (mia === version) detenerSondeo = UI.cadaTanto(cargarPedidos, 5000);
  }

  async function cargarPedidos() {
    const r = await API.llamar("/pedidos/mios");
    estado.pedidos = r.pedidos;
    const firma = JSON.stringify(r.pedidos);
    if (firma === estado.firmaPedidos) return;
    estado.firmaPedidos = firma;
    pintarPedidos();
  }

  function pintarPedidos() {
    const cont = document.getElementById("lista-pedidos");
    if (!cont) return;
    const pedidos = estado.pedidos || [];
    const activos = pedidos.filter((p) => ACTIVOS.includes(p.estado));
    const historial = pedidos.filter((p) => !ACTIVOS.includes(p.estado));
    limpiar(cont,
      pedidos.length ? null : UI.vacio("🧾", "Aún no tienes pedidos", "Explora los locales y a los estudiantes que venden hoy.",
        h("a", { class: "btn btn-primario", href: "#explorar" }, "Explorar")),
      activos.length ? h("section", { class: "pila" }, h("h2", { text: "En curso" }), activos.map(tarjetaPedido)) : null,
      historial.length ? h("section", { class: "seccion pila" }, h("h2", { text: "Historial" }),
        h("div", { class: "lista" }, historial.map(filaHistorial))) : null);
    estado.nuevoPedidoId = null;
  }

  function pasos(p) {
    const orden = ["pagado", "preparando", "listo", "entregado"];
    const nombres = ["Pagado", "Preparando", "Listo", "Entregado"];
    const indice = orden.indexOf(p.estado);
    if (indice === -1) return null;
    return h("ol", { class: "pasos", "aria-label": `Estado: ${UI.ESTADOS[p.estado][0]}` },
      nombres.map((nombre, i) => h("li", {
        class: i < indice || (i === indice && p.estado === "entregado") ? "hecho" : i === indice ? "hecho actual" : "",
      }, nombre)));
  }

  function boleto(p) {
    return h("div", { class: `boleto ${p.id === estado.nuevoPedidoId ? "revelar" : ""}` },
      h("div", { class: "boleto-banda" }),
      h("div", { class: "boleto-cuerpo" },
        h("span", { class: "pequeno suave", text: "Tu código de entrega" }),
        h("div", { class: "boleto-codigo", "aria-label": `Código ${p.codigo.split("").join(" ")}` },
          h("span", { text: p.codigo.slice(0, 3) }), h("span", { text: p.codigo.slice(3) })),
        h("span", { class: "meta" }, icono("pin", 16), p.punto_encuentro),
        h("span", { class: "meta" }, icono("reloj", 16), `Hoy a las ${p.horario}, pagas con ${UI.METODOS[p.pago.metodo].toLowerCase()}`),
        h("span", { class: "pequeno", text: p.estado === "aceptado"
          ? "El vendedor aceptó. Muestra este código cuando recibas tu pedido."
          : "Esperando que el vendedor acepte. Muestra este código cuando recibas tu pedido." })));
  }

  function tarjetaPedido(p) {
    const temporal = p.tipo === "temporal";
    return h("article", { class: "pedido" },
      h("div", { class: "pedido-cabeza" },
        h("span", { class: `emoji-sello ${temporal ? "temporal" : ""}`, text: p.negocio_emoji }),
        h("div", { class: "cuerpo" }, h("h3", { text: p.negocio_nombre }), h("span", { class: "suave pequeno", text: `Pedido ${p.id}, ${UI.horaDe(p.creado)}` })),
        chip(p.estado)),
      temporal && p.codigo ? boleto(p) : pasos(p),
      !temporal ? h("div", { class: "meta" }, icono("reloj", 16), p.horario === "asap" ? "Lo antes posible" : `Para las ${p.horario}`) : null,
      p.estado === "listo" ? h("div", { class: "aviso ok" }, icono("check"), "Tu pedido está listo. Pasa a recogerlo.") : null,
      h("ul", { class: "pedido-items" },
        p.items.map((i) => h("li", {}, h("span", { text: `${i.cantidad} × ${i.nombre}` }), h("span", { class: "precio", text: pesos(i.subtotal) }))),
        h("li", {}, h("strong", { text: "Total" }), h("strong", { class: "precio", text: pesos(p.total) }))),
      h("div", { class: "meta" }, icono(temporal ? "info" : "check", 16), UI.PAGOS[p.pago.estado] || p.pago.estado),
      p.codigo_bloqueado ? h("div", { class: "aviso error" }, icono("alerta"), "Este apartado se bloqueó por códigos incorrectos. Puedes cancelarlo o reportar el problema.") : null,
      h("div", { class: "acciones" },
        p.puede_cancelar ? h("button", { class: "btn btn-peligro btn-chico", onclick: () => cancelar(p) }, "Cancelar pedido") : null,
        h("button", { class: "btn btn-fantasma btn-chico", onclick: () => { estado.pedidoAyuda = p.id; location.hash = "ayuda"; } }, "Tengo un problema")));
  }

  function filaHistorial(p) {
    return h("div", { class: "fila" },
      h("span", { class: "emoji-sello", style: "width:44px;height:44px;font-size:1.4rem", text: p.negocio_emoji }),
      h("span", { class: "cuerpo" },
        h("strong", { text: p.negocio_nombre }),
        h("span", { class: "suave pequeno", text: `${UI.fechaCorta(p.creado)}, ${p.items.reduce((s, i) => s + i.cantidad, 0)} productos` })),
      h("span", { class: "derecha" }, chip(p.estado), h("span", { class: "precio pequeno", text: pesos(p.total) })));
  }

  async function cancelar(p) {
    const temporal = p.tipo === "temporal";
    const ok = await confirmar("¿Cancelar este pedido?",
      temporal ? "El producto vuelve a estar disponible para otras personas." : "Te reembolsamos el pago simulado de inmediato.",
      { aceptar: "Cancelar pedido", peligro: true });
    if (!ok) return;
    try {
      await API.llamar(`/pedidos/${encodeURIComponent(p.id)}/cancelar`, { metodo: "POST", datos: {} });
      toast("Pedido cancelado.", "ok");
      estado.negocios = null;
      await cargarPedidos();
    } catch (e) { toast(e.message, "error"); }
  }

  // ---------- Ayuda ----------
  const PREGUNTAS = [
    ["¿Cuál es la diferencia entre un local y un estudiante que vende?",
     "En los locales del campus pagas dentro de la app y recoges cuando tu pedido está listo. Con estudiantes que venden no se cobra en la app: apartas, se ven en un punto del campus y pagas en persona."],
    ["¿Para qué sirve mi código de 6 dígitos?",
     "Confirma la entrega. Muéstraselo al vendedor solo cuando tengas tu pedido en la mano."],
    ["¿Qué pasa si no recojo un apartado?",
     "Al terminar la venta del día, el apartado vence y el producto vuelve a estar disponible. Puedes cancelarlo antes desde Mis pedidos."],
    ["¿Puedo cancelar un pedido de un local?",
     "Sí, mientras el local no empiece a prepararlo. El reembolso simulado es inmediato."],
    ["¿Cuántos apartados puedo tener a la vez?",
     "Hasta 3. Así evitamos que alguien aparte productos que no va a recoger."],
    ["¿Cómo empiezo a vender?",
     "Crea una cuenta eligiendo Vender, registra tu negocio y sube tu documento. La IA lo revisa y una persona del equipo lo aprueba."],
  ];

  function mostrarAyuda() {
    const chatLista = h("div", { class: "chat", "aria-live": "polite" });
    const entrada = h("textarea", { placeholder: "Escribe tu duda…", "aria-label": "Mensaje para Leo", maxlength: 500, rows: 1 });
    const enviarBtn = h("button", { class: "btn btn-primario btn-icono", "aria-label": "Enviar" }, icono("enviar"));
    const faq = h("div", { class: "lista faq" }, PREGUNTAS.map(([q, a]) => h("details", {}, h("summary", { text: q }), h("p", { text: a }))));

    function pintarChat() {
      limpiar(chatLista, estado.chat.map((m) => {
        if (m.rol === "persona") {
          return h("div", { class: "burbuja asistente" },
            h("p", { text: "Si quieres, una persona del equipo revisa tu caso." }),
            h("button", { class: "btn btn-secundario btn-chico", style: "margin-top:.5rem", onclick: () => abrirReporte(null, m.texto) }, icono("persona", 16), "Hablar con una persona"));
        }
        return h("div", { class: `burbuja ${m.rol}${m.pensando ? " pensando" : ""}`, text: m.texto });
      }));
      chatLista.scrollTop = chatLista.scrollHeight;
    }

    async function enviar(texto) {
      texto = (texto || "").trim();
      if (!texto) return;
      const historial = estado.chat.filter((m) => m.rol === "usuario" || m.rol === "asistente").filter((m) => !m.pensando).slice(-8)
        .map((m) => ({ rol: m.rol, texto: m.texto }));
      estado.chat.push({ rol: "usuario", texto });
      const pensando = { rol: "asistente", texto: "Leo está escribiendo…", pensando: true };
      estado.chat.push(pensando);
      entrada.value = "";
      enviarBtn.disabled = true;
      pintarChat();
      try {
        const r = await API.llamar("/soporte/chat", { metodo: "POST", datos: { mensaje: texto, historial } });
        estado.chat.splice(estado.chat.indexOf(pensando), 1, { rol: "asistente", texto: r.respuesta });
        if (r.sugerir_persona) estado.chat.push({ rol: "persona", texto });
      } catch (e) {
        estado.chat.splice(estado.chat.indexOf(pensando), 1, { rol: "asistente", texto: e.message });
      } finally {
        enviarBtn.disabled = false;
        if (document.body.contains(chatLista)) { pintarChat(); entrada.focus(); }
      }
    }

    enviarBtn.addEventListener("click", () => enviar(entrada.value));
    entrada.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(entrada.value); }
    });

    const opcion = (ic, titulo, texto, accion) => h("button", { class: "ayuda-opcion", onclick: accion },
      h("span", { class: "icono-circulo" }, icono(ic)),
      h("span", {}, h("strong", { text: titulo }), h("span", { class: "suave pequeno", style: "display:block", text: texto })));

    limpiar(raiz,
      h("h1", { text: "¿En qué te ayudamos?" }),
      h("p", { class: "suave", style: "margin:.5rem 0 1.25rem", text: "Leo, nuestro asistente con IA, responde al momento. Si no lo resuelve, una persona del equipo revisa tu caso." }),
      h("div", { class: "ayuda-opciones" },
        opcion("chispa", "Preguntar a Leo", "Pedidos, apartados, pagos y cómo vender.", () => entrada.focus()),
        opcion("persona", "Hablar con una persona", "Crea un reporte y el equipo lo revisa.", () => abrirReporte()),
        opcion("ayuda", "Preguntas frecuentes", "Respuestas rápidas a lo más común.", () => faq.scrollIntoView({ behavior: "smooth" }))),
      h("section", { class: "panel", style: "padding:0", "aria-label": "Chat con Leo" },
        chatLista,
        h("div", { class: "sugerencias" },
          ["¿Cómo funciona un apartado?", "¿Dónde está mi pedido?", "Quiero cancelar un pedido", "¿Cómo empiezo a vender?"]
            .map((s) => h("button", { type: "button", onclick: () => enviar(s) }, s))),
        h("div", { class: "chat-entrada" }, entrada, enviarBtn),
        API.modoLocal() ? h("p", { class: "suave pequeno", style: "padding:0 1rem 1rem", text: "En la demo sin servidor, Leo usa respuestas simuladas. Con AWS responde Amazon Bedrock." }) : null),
      h("section", { class: "seccion" }, h("h2", { text: "Preguntas frecuentes", style: "margin-bottom:.75rem" }), faq));
    pintarChat();
    if (estado.pedidoAyuda) { const id = estado.pedidoAyuda; estado.pedidoAyuda = null; abrirReporte(id); }
  }

  async function abrirReporte(pedidoId = null, mensajeInicial = "") {
    let pedidos = estado.pedidos;
    if (!pedidos) { try { pedidos = (await API.llamar("/pedidos/mios")).pedidos; } catch { pedidos = []; } }
    const selectPedido = h("select", { name: "pedido" },
      h("option", { value: "" }, "No es sobre un pedido"),
      pedidos.slice(0, 15).map((p) => h("option", { value: p.id, selected: p.id === pedidoId }, `${p.id}, ${p.negocio_nombre} (${UI.ESTADOS[p.estado]?.[0] || p.estado})`)));
    if (pedidoId) selectPedido.value = pedidoId;
    const mensaje = h("textarea", { maxlength: 600, rows: 4, placeholder: "Cuéntanos qué pasó", value: mensajeInicial });
    const errorCaja = h("p", { class: "aviso error oculto" });
    const boton = h("button", { class: "btn btn-primario btn-bloque" }, "Enviar reporte");
    const ventana = hoja({
      titulo: "Hablar con una persona",
      contenido: h("div", { class: "formulario" },
        h("p", { class: "suave", text: "El equipo de Lion Pick Up revisa tu caso. Nunca te pediremos contraseñas ni datos de tarjeta." }),
        h("label", { class: "campo" }, h("span", { text: "Pedido relacionado" }), selectPedido),
        h("label", { class: "campo" }, h("span", { text: "¿Qué pasó?" }), mensaje),
        errorCaja, boton),
    });
    boton.addEventListener("click", () => conCarga(boton, async () => {
      if (mensaje.value.trim().length < 5) { errorCaja.textContent = "Cuéntanos un poco más (mínimo 5 caracteres)."; errorCaja.classList.remove("oculto"); return; }
      try {
        const r = await API.llamar("/soporte/ticket", { metodo: "POST", datos: { mensaje: mensaje.value.trim(), pedido_id: selectPedido.value } });
        ventana.cerrar();
        toast(`Reporte enviado con el folio ${r.ticket.id}.`, "ok");
      } catch (e) { errorCaja.textContent = e.message; errorCaja.classList.remove("oculto"); }
    }));
  }
})();
