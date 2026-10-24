// Panel de administración: métricas, verificación de negocios, comisiones, soporte y datos de ejemplo.
(function () {
  const usuario = API.exigir(["admin"]);
  if (!usuario) return;
  const { h, limpiar, icono, pesos, chip, toast, hoja, confirmar, pedirTexto, conCarga } = UI;

  const raiz = document.getElementById("vista");
  const btnSalir = document.getElementById("btn-salir");
  btnSalir.appendChild(icono("salir", 22));
  btnSalir.addEventListener("click", API.salir);
  document.getElementById("pie").replaceWith(UI.pie());

  const TABS = [["verificacion", "Verificación"], ["negocios", "Negocios"], ["soporte", "Soporte"], ["demo", "Datos de ejemplo"]];
  const kpis = h("div", { class: "kpis" }, UI.esqueleto(1));
  const zona = h("div", { class: "seccion" });
  let contenido = h("div");
  let detener = null;

  window.addEventListener("hashchange", pintarTab);
  limpiar(raiz,
    h("div", { class: "cabecera-panel" },
      h("div", { class: "cuerpo" },
        h("h1", { text: "Panel de administración" }),
        h("p", { class: "suave", text: `Sesión de ${usuario.nombre}` })),
      h("button", { class: "btn btn-secundario btn-chico", onclick: () => { cargarResumen(); pintarTab(); } }, icono("refrescar", 16), "Actualizar")),
    kpis,
    h("div", { class: "segmentos", role: "tablist", id: "tabs", style: "margin-top:1.5rem" }),
    zona);
  cargarResumen();
  pintarTab();
  UI.cadaTanto(cargarResumen, 15000);

  function tabActual() {
    const t = location.hash.slice(1);
    return TABS.some(([id]) => id === t) ? t : "verificacion";
  }

  async function cargarResumen() {
    try {
      const r = await API.llamar("/admin/resumen");
      const kpi = (texto, valor, destacado) => h("div", { class: `kpi ${destacado ? "destacado" : ""}` }, h("span", { text: texto }), h("strong", { text: valor }));
      limpiar(kpis,
        kpi("Comisión generada", pesos(r.comision_total), true),
        kpi("Ventas completadas", pesos(r.ventas_total)),
        kpi("Comisión por cobrar a estudiantes", pesos(r.comision_por_cobrar)),
        kpi("Pedidos en curso", r.pedidos.activos),
        kpi("Negocios por verificar", r.negocios.pendientes),
        kpi("Reportes abiertos", r.tickets_abiertos));
    } catch (e) {
      limpiar(kpis, h("div", { class: "aviso error" }, icono("alerta"), e.message));
    }
  }

  function pintarTab() {
    if (detener) { detener(); detener = null; }
    const tab = tabActual();
    limpiar(document.getElementById("tabs"), TABS.map(([id, texto]) => h("button", {
      role: "tab", "aria-selected": String(id === tab), "aria-pressed": String(id === tab),
      onclick: () => { location.hash = id; },
    }, texto)));
    contenido = h("div");
    limpiar(zona, contenido);
    ({ verificacion: tabVerificacion, negocios: tabNegocios, soporte: tabSoporte, demo: tabDemo })[tab]();
  }

  // ---------- Verificación ----------
  async function tabVerificacion() {
    const caja = contenido;
    limpiar(caja, UI.esqueleto(2));
    try {
      const r = await API.llamar("/admin/negocios?estado=pendiente");
      limpiar(caja, r.negocios.length
        ? h("div", { class: "pila" }, r.negocios.map(tarjetaPendiente))
        : UI.vacio("✅", "No hay negocios por verificar", "Cuando alguien registre un negocio y suba su documento, aparecerá aquí."));
    } catch (e) { limpiar(caja, UI.vacio("⚠️", "No pudimos cargar los negocios", e.message)); }
  }

  function datosNegocio(n) {
    const v = n.ventana || {};
    return h("div", { class: "datos-negocio" },
      h("span", { class: `chip sin-punto ${n.tipo === "temporal" ? "amarillo" : ""}`, text: n.tipo === "temporal" ? "Estudiante" : "Local del campus" }),
      h("span", { class: "meta" }, icono("usuario", 16), `${n.owner_nombre || ""} (${n.owner_email})`),
      n.tipo === "temporal"
        ? h("span", { class: "meta" }, icono("reloj", 16), `${UI.fechaCorta(v.fecha)}, ${v.inicio} a ${v.fin}`)
        : h("span", { class: "meta" }, icono("pin", 16), n.ubicacion));
  }

  function tarjetaPendiente(n) {
    const verDocumento = h("button", { class: "btn btn-secundario btn-chico", disabled: !n.documento_subido }, icono("documento", 16), "Ver documento");
    verDocumento.addEventListener("click", () => conCarga(verDocumento, async () => {
      try {
        const r = await API.llamar(`/admin/negocios/${encodeURIComponent(n.id)}/documento`);
        hoja({
          titulo: `Documento de ${n.nombre}`,
          contenido: [
            h("img", { src: r.url, alt: `Documento enviado por ${n.owner_nombre || n.owner_email}`, style: "width:100%;border-radius:12px;border:2px solid var(--linea)" }),
            h("p", { class: "suave pequeno", style: "margin-top:.6rem", text: "El enlace caduca en 5 minutos y no se guarda en el navegador." }),
          ],
        });
      } catch (e) { toast(e.message, "error"); }
    }));
    const aprobar = h("button", { class: "btn btn-primario btn-chico" }, icono("check", 16), "Aprobar");
    aprobar.addEventListener("click", async () => {
      if (!n.verificacion) {
        const ok = await confirmar("¿Aprobar sin documento?", "Este negocio no ha enviado un documento. En la demo puedes aprobarlo de todos modos.", { aceptar: "Aprobar" });
        if (!ok) return;
      }
      await decidir(n, "aprobar", "", aprobar);
    });
    const rechazar = h("button", { class: "btn btn-peligro btn-chico" }, "Rechazar");
    rechazar.addEventListener("click", async () => {
      const nota = await pedirTexto("Rechazar negocio", "Motivo (lo verá el vendedor)", { aceptar: "Rechazar", requerido: true });
      if (nota === null) return;
      await decidir(n, "rechazar", nota, rechazar);
    });
    return h("article", { class: "pedido" },
      h("div", { class: "pedido-cabeza" },
        h("span", { class: `emoji-sello ${n.tipo === "temporal" ? "temporal" : ""}`, text: n.emoji }),
        h("div", { class: "cuerpo" }, h("h3", { text: n.nombre }), h("span", { class: "suave pequeno", text: `Registrado el ${UI.fechaCorta(n.creado)}` })),
        chip(n.estado)),
      datosNegocio(n),
      n.verificacion ? UI.resultadoIA(n.verificacion) : h("div", { class: "aviso" }, icono("info"), "Todavía no envía su documento."),
      h("div", { class: "acciones" }, verDocumento, aprobar, rechazar));
  }

  async function decidir(n, decision, nota, boton) {
    await conCarga(boton, async () => {
      try {
        await API.llamar(`/admin/negocios/${encodeURIComponent(n.id)}/decision`, { metodo: "POST", datos: { decision, nota } });
        toast(decision === "aprobar" ? `${n.nombre} ya aparece para los clientes.` : `${n.nombre} fue rechazado.`, "ok");
        cargarResumen();
        pintarTab();
      } catch (e) { toast(e.message, "error"); }
    });
  }

  // ---------- Negocios y comisiones ----------
  async function tabNegocios() {
    const caja = contenido;
    limpiar(caja, UI.esqueleto(3));
    try {
      const r = await API.llamar("/admin/negocios");
      const lista = r.negocios.filter((n) => n.estado !== "pendiente");
      limpiar(caja, lista.length
        ? h("div", { class: "lista" }, lista.map(filaNegocio))
        : UI.vacio("🏪", "Aún no hay negocios aprobados", "Aprueba negocios en Verificación o carga los datos de ejemplo."));
    } catch (e) { limpiar(caja, UI.vacio("⚠️", "No pudimos cargar los negocios", e.message)); }
  }

  function filaNegocio(n) {
    const r = n.resumen;
    const temporal = n.tipo === "temporal";
    let accion = null;
    if (temporal && r.saldo_por_liquidar > 0) {
      accion = h("button", { class: "btn btn-secundario btn-chico" }, "Marcar comisión pagada");
      accion.addEventListener("click", async () => {
        const ok = await confirmar("¿El vendedor ya pagó su comisión?", `Se registrará el pago de ${pesos(r.saldo_por_liquidar)} y su saldo quedará en cero.`, { aceptar: "Registrar pago" });
        if (!ok) return;
        await conCarga(accion, async () => {
          try {
            await API.llamar(`/admin/negocios/${encodeURIComponent(n.id)}/liquidar`, { metodo: "POST", datos: {} });
            toast("Comisión registrada como pagada.", "ok");
            cargarResumen();
            pintarTab();
          } catch (e) { toast(e.message, "error"); }
        });
      });
    }
    return h("div", { class: "fila", style: "flex-wrap:wrap" },
      h("span", { class: `emoji-sello ${temporal ? "temporal" : ""}`, text: n.emoji }),
      h("span", { class: "cuerpo", style: "min-width:200px" },
        h("strong", { text: n.nombre }),
        h("span", { class: "suave pequeno", text: `${temporal ? "Estudiante" : "Local"}, ${r.pedidos_completados} pedidos, ${pesos(r.ventas_total)} vendidos` }),
        h("span", { class: "pequeno", text: temporal
          ? `Comisión ${r.comision_pct}%: ${pesos(r.comision_total)} en total, ${pesos(r.saldo_por_liquidar)} por cobrar`
          : `Comisión ${r.comision_pct}%: ${pesos(r.comision_total)} retenidos, ${pesos(r.neto_a_depositar)} por depositar` })),
      h("span", { class: "derecha" }, chip(n.estado), accion));
  }

  // ---------- Soporte ----------
  async function tabSoporte() {
    const caja = contenido;
    limpiar(caja, UI.esqueleto(2));
    try {
      const r = await API.llamar("/admin/tickets");
      limpiar(caja, r.tickets.length
        ? h("div", { class: "pila" }, r.tickets.map(tarjetaTicket))
        : UI.vacio("💬", "Sin reportes", "Cuando alguien pida hablar con una persona, el reporte aparecerá aquí."));
    } catch (e) { limpiar(caja, UI.vacio("⚠️", "No pudimos cargar los reportes", e.message)); }
  }

  function tarjetaTicket(t) {
    const resolver = t.estado === "abierto" ? h("button", { class: "btn btn-primario btn-chico" }, icono("check", 16), "Marcar como resuelto") : null;
    if (resolver) {
      resolver.addEventListener("click", () => conCarga(resolver, async () => {
        try {
          await API.llamar(`/admin/tickets/${encodeURIComponent(t.id)}/resolver`, { metodo: "POST", datos: {} });
          toast("Reporte resuelto.", "ok");
          cargarResumen();
          pintarTab();
        } catch (e) { toast(e.message, "error"); }
      }));
    }
    return h("article", { class: "pedido" },
      h("div", { class: "pedido-cabeza" },
        h("div", { class: "cuerpo" }, h("h3", { text: `Reporte ${t.id}` }),
          h("span", { class: "suave pequeno", text: `${t.nombre} (${t.email}), ${UI.fechaCorta(t.creado)} ${UI.horaDe(t.creado)}` })),
        chip(t.estado)),
      t.pedido_id ? h("span", { class: "meta" }, icono("recibo", 16), `Sobre el pedido ${t.pedido_id}`) : null,
      h("p", { style: "white-space:pre-wrap", text: t.mensaje }),
      resolver ? h("div", { class: "acciones" }, resolver) : null);
  }

  // ---------- Datos de ejemplo ----------
  function tabDemo() {
    const caja = contenido;
    const resultado = h("div");
    const boton = h("button", { class: "btn btn-acento" }, icono("chispa", 18), API.modoLocal() ? "Reiniciar la demo" : "Cargar datos de ejemplo");
    boton.addEventListener("click", () => conCarga(boton, async () => {
      try {
        const r = await API.llamar("/admin/demo", { metodo: "POST", datos: {} });
        toast("Datos de ejemplo listos.", "ok");
        cargarResumen();
        limpiar(resultado, h("div", { class: "aviso ok pila", style: "gap:.4rem" },
          h("strong", { text: "Cuentas para la demo" }),
          h("span", {}, "Contraseña de todas: ", h("code", { text: r.password_demo })),
          h("span", {}, "Cliente: ", h("code", { text: r.cuentas.cliente })),
          h("span", {}, "Local fijo: ", h("code", { text: r.cuentas.negocio_fijo })),
          h("span", {}, "Estudiante que vende: ", h("code", { text: r.cuentas.vendedor_temporal })),
          h("span", {}, "Pendiente de aprobar: ", h("code", { text: r.cuentas.pendiente_de_aprobar }))));
      } catch (e) { toast(e.message, "error"); }
    }));
    limpiar(caja, h("section", { class: "panel pila" },
      h("h2", { text: "Datos de ejemplo" }),
      h("p", { class: "suave", text: API.modoLocal()
        ? "Borra todo lo de esta demo y vuelve a empezar con tres locales, dos estudiantes vendiendo hoy y uno pendiente de verificación."
        : "Crea tres locales, dos estudiantes vendiendo hoy y uno pendiente de verificación, con sus menús y cuentas de prueba. Si ya existen, restablece su stock, sus contadores de ventas y su horario de venta a hoy. No borra pedidos." }),
      h("div", {}, boton),
      resultado));
  }
})();
