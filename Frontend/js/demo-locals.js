// Modo demo sin servidor.
// Si js/config.js no tiene la URL de la API, la app usa este simulador: las mismas rutas
// y reglas que la Lambda (stock, apartados, códigos, comisiones, verificación y soporte),
// con los datos guardados solo en este navegador. Varias pestañas comparten los datos,
// así que puedes abrir al cliente en una y al vendedor en otra.
// La IA está simulada: en la versión con AWS la hace Amazon Bedrock.
(function () {
  const CLAVE = "lion.demo.db";
  const VERSION = 3;
  const PASSWORD_DEMO = "LionDemo2026";
  const COMISION = { fijo: 8, temporal: 5 };
  const PUNTOS = ["Entrada principal", "Biblioteca", "Explanada central", "Cafetería central", "Estacionamiento de alumnos"];
  const CATEGORIAS = ["Comida", "Snacks", "Bebidas", "Postres", "Saludable"];
  const EMOJIS = ["🌮", "🍔", "🥪", "🍕", "🥗", "🍩", "🧁", "☕", "🥤", "🍪", "🍱", "🌯", "🍫", "🥐", "🍜", "🧃"];
  const METODOS = { fijo: ["tarjeta_simulada", "saldo_simulado"], temporal: ["efectivo", "transferencia", "tarjeta_vendedor"] };
  const ACCIONES = {
    fijo: { preparar: [["pagado"], "preparando"], listo: [["preparando"], "listo"], entregar: [["listo"], "entregado"], rechazar: [["pagado"], "rechazado"] },
    temporal: { aceptar: [["apartado"], "aceptado"], rechazar: [["apartado", "aceptado"], "rechazado"] },
  };
  const ACTIVOS = ["pagado", "preparando", "listo", "apartado", "aceptado"];
  const MAX_APARTADOS = 3, MAX_INTENTOS = 3, GRACIA_MIN = 30;

  class Fallo extends Error { constructor(status, mensaje) { super(mensaje); this.status = status; } }

  // ---------- Almacenamiento ----------
  let memoria = null;
  function almacen() {
    for (const tipo of ["localStorage", "sessionStorage"]) {
      try { const s = window[tipo]; s.setItem("lion.prueba", "1"); s.removeItem("lion.prueba"); return s; } catch { /* siguiente */ }
    }
    return null;
  }
  function cargar() {
    const s = almacen();
    let db = null;
    if (s) { try { db = JSON.parse(s.getItem(CLAVE)); } catch { db = null; } }
    if (!db && memoria) db = memoria;
    if (!db || db.version !== VERSION) { db = semilla(); guardar(db); }
    if (db.dia !== hoy()) { renovarVentanas(db); guardar(db); }
    return db;
  }
  function guardar(db) {
    memoria = db;
    const s = almacen();
    if (!s) return;
    try { s.setItem(CLAVE, JSON.stringify(db)); }
    catch {
      // Sin espacio: se quitan las imágenes de documentos y se reintenta.
      Object.values(db.negocios).forEach((n) => { delete n.doc_imagen; });
      try { s.setItem(CLAVE, JSON.stringify(db)); } catch { /* se queda en memoria */ }
    }
  }

  // ---------- Utilidades ----------
  const dos = (n) => String(n).padStart(2, "0");
  function hoy(dias = 0) { const d = new Date(); d.setDate(d.getDate() + dias); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; }
  const ahoraISO = () => new Date().toISOString();
  const minutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const minutosAhora = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const id = (prefijo, largo = 8) => prefijo + Array.from(crypto.getRandomValues(new Uint8Array(largo)), (b) => "0123456789ABCDEF"[b % 16]).join("");
  const comisionUnitaria = (precio, tipo) => Math.floor((precio * COMISION[tipo] + 50) / 100);
  function huella(texto) { // solo para la demo local; la Lambda usa PBKDF2
    let h = 2166136261;
    for (const c of "lion:" + texto) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  }
  function texto(valor, campo, min = 1, max = 200, requerido = true) {
    if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
      if (requerido) throw new Fallo(400, `El campo '${campo}' es obligatorio.`);
      return "";
    }
    if (typeof valor !== "string") throw new Fallo(400, `El campo '${campo}' debe ser texto.`);
    const limpio = valor.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
    if (limpio.length < min) throw new Fallo(400, `El campo '${campo}' debe tener al menos ${min} caracteres.`);
    if (limpio.length > max) throw new Fallo(400, `El campo '${campo}' admite máximo ${max} caracteres.`);
    return limpio;
  }
  function opcion(valor, campo, opciones) { if (!opciones.includes(valor)) throw new Fallo(400, `Valor no válido para '${campo}'.`); return valor; }
  function hora(valor, campo = "horario") { if (typeof valor !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)) throw new Fallo(400, `El campo '${campo}' debe tener formato HH:MM.`); return valor; }
  function entero(valor, campo, min, max) {
    const n = Number(valor);
    if (!Number.isInteger(n)) throw new Fallo(400, `El campo '${campo}' debe ser un número entero.`);
    if (n < min || n > max) throw new Fallo(400, `El campo '${campo}' debe estar entre ${min} y ${max}.`);
    return n;
  }
  function centavos(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || Math.round(n * 100) !== Math.round(n * 1000) / 10) throw new Fallo(400, "El precio debe ser un número con máximo dos decimales.");
    if (n < 1 || n > 5000) throw new Fallo(400, "El precio debe estar entre $1 y $5,000.");
    return Math.round(n * 100);
  }

  // ---------- Datos de ejemplo ----------
  const DEMO = [
    { id: "NEG-DEMO-CAFE", nombre: "Café Central", tipo: "fijo", categoria: "Bebidas", emoji: "☕", descripcion: "Café de especialidad y algo rápido entre clases.", ubicacion: "Cafetería central", apertura: "07:00", cierre: "21:00", owner: ["cafe@lionpickup.demo", "Café Central (demo)"],
      productos: [["Americano", "Grano de Chiapas, 12 oz", 3500, 50, "☕"], ["Latte", "Con leche entera o de avena", 4800, 40, "☕"], ["Chai frío", "Especiado y con hielo", 5500, 25, "🧃"], ["Bagel de queso crema", "Recién horneado", 4500, 15, "🥐"]] },
    { id: "NEG-DEMO-COCINA", nombre: "Cocina Yucateca", tipo: "fijo", categoria: "Comida", emoji: "🌮", descripcion: "Antojitos yucatecos hechos al momento.", ubicacion: "Food court, local 3", apertura: "08:00", cierre: "20:00", owner: ["cocina@lionpickup.demo", "Cocina Yucateca (demo)"],
      productos: [["Panuchos (3 pzas)", "De cochinita o pollo", 6500, 30, "🌮"], ["Salbutes (3 pzas)", "Con pavo y cebolla morada", 6000, 30, "🌮"], ["Torta de cochinita", "Con cebolla encurtida", 7000, 25, "🥪"], ["Agua de horchata", "Medio litro", 2500, 40, "🥤"]] },
    { id: "NEG-DEMO-BOWL", nombre: "Bowl & Go", tipo: "fijo", categoria: "Saludable", emoji: "🥗", descripcion: "Bowls y ensaladas para comer ligero.", ubicacion: "Pasillo central", apertura: "09:00", cierre: "19:00", owner: ["bowl@lionpickup.demo", "Bowl & Go (demo)"],
      productos: [["Bowl de pollo", "Arroz, pollo, verduras y aderezo de la casa", 9500, 20, "🍱"], ["Ensalada César", "Con pollo a la plancha", 8500, 15, "🥗"], ["Smoothie verde", "Espinaca, piña y plátano", 5500, 20, "🥤"]] },
    { id: "NEG-DEMO-BROWNIES", nombre: "Brownies de Sofi", tipo: "temporal", categoria: "Postres", emoji: "🧁", descripcion: "Brownies caseros de una estudiante de Diseño.", puntos: ["Biblioteca", "Explanada central"], owner: ["sofi@lionpickup.demo", "Sofía (vendedora demo)"],
      productos: [["Brownie clásico", "Chocolate semiamargo", 2500, 24, "🍫"], ["Brownie con nuez", "Con nuez pecana", 3000, 12, "🍫"], ["Galleta de chispas", "Grande y suave", 2000, 20, "🍪"]] },
    { id: "NEG-DEMO-MARQUESITAS", nombre: "Marquesitas de Dani", tipo: "temporal", categoria: "Postres", emoji: "🌯", descripcion: "Marquesitas recién hechas, como en el centro.", puntos: ["Entrada principal", "Estacionamiento de alumnos"], owner: ["dani@lionpickup.demo", "Daniel (vendedor demo)"],
      productos: [["Marquesita de queso de bola", "La clásica", 4500, 15, "🌯"], ["Marquesita Nutella y queso", "La favorita", 5500, 15, "🌯"], ["Marquesita de cajeta", "Dulce y crujiente", 5000, 10, "🌯"]] },
    { id: "NEG-DEMO-GALLETAS", nombre: "Galletas de Mau", tipo: "temporal", categoria: "Snacks", emoji: "🍪", descripcion: "Galletas de avena y crema de cacahuate.", puntos: ["Biblioteca"], owner: ["mau@lionpickup.demo", "Mauricio (vendedor demo)"], pendiente: true,
      productos: [["Galleta de avena", "Con pasas", 1800, 30, "🍪"]] },
  ];

  function usuarioDemo(db, email, nombre, rol, negocio_id) {
    db.usuarios[email] = { email, nombre, rol, hash: huella(PASSWORD_DEMO), creado: ahoraISO(), demo: true, negocio_id: negocio_id || null, intentos_fallidos: 0 };
  }

  function semilla() {
    const db = { version: VERSION, dia: hoy(), usuarios: {}, negocios: {}, productos: {}, pedidos: {}, tickets: {}, sesiones: {} };
    usuarioDemo(db, "cliente@lionpickup.demo", "Ana (cliente demo)", "cliente");
    usuarioDemo(db, "admin@lionpickup.demo", "Equipo Lion Pick Up (demo)", "admin");
    for (const d of DEMO) {
      const n = {
        id: d.id, nombre: d.nombre, tipo: d.tipo, categoria: d.categoria, emoji: d.emoji, descripcion: d.descripcion,
        owner_email: d.owner[0], owner_nombre: d.owner[1], estado: d.pendiente ? "pendiente" : "aprobado", creado: ahoraISO(), demo: true,
        ventas_total: 0, comision_total: 0, pedidos_completados: 0, neto_a_depositar: 0, saldo_por_liquidar: 0, docs_contador: 0,
      };
      if (d.tipo === "fijo") Object.assign(n, { ubicacion: d.ubicacion, apertura: d.apertura, cierre: d.cierre });
      else Object.assign(n, { ventana: { fecha: hoy(d.pendiente ? 1 : 0), inicio: "07:00", fin: "22:00" }, puntos_encuentro: d.puntos });
      if (!d.pendiente) n.revision = { por: "datos de ejemplo", fecha: ahoraISO(), nota: "Negocio de demostración", decision: "aprobado" };
      db.negocios[n.id] = n;
      usuarioDemo(db, d.owner[0], d.owner[1], "negocio", d.id);
      d.productos.forEach(([nombre, descripcion, precio, stock, emoji], i) => {
        const pid = `${d.id}-P${i + 1}`;
        db.productos[pid] = { id: pid, negocio_id: d.id, nombre, descripcion, precio, stock, emoji, activo: true, creado: ahoraISO(), demo: true };
      });
    }
    return db;
  }

  function renovarVentanas(db) {
    for (const d of DEMO) {
      const n = db.negocios[d.id];
      if (n && n.tipo === "temporal") n.ventana = { fecha: hoy(d.pendiente ? 1 : 0), inicio: "07:00", fin: "22:00" };
    }
    db.dia = hoy();
  }

  // ---------- Vistas (mismas formas que la API real) ----------
  function estadoVentana(n) {
    const v = n.ventana || {};
    if (!v.fecha) return "terminada";
    if (v.fecha > hoy()) return "proxima";
    if (v.fecha < hoy()) return "terminada";
    return minutosAhora() <= minutos(v.fin) + GRACIA_MIN ? "abierta" : "terminada";
  }
  function negocioPublico(n, conteo) {
    const d = { id: n.id, nombre: n.nombre, descripcion: n.descripcion || "", tipo: n.tipo, categoria: n.categoria, emoji: n.emoji, estado: n.estado };
    if (n.tipo === "fijo") Object.assign(d, { ubicacion: n.ubicacion, apertura: n.apertura, cierre: n.cierre });
    else Object.assign(d, { ventana: n.ventana, puntos_encuentro: n.puntos_encuentro || [], estado_venta: estadoVentana(n), disponible_hoy: estadoVentana(n) === "abierta" });
    if (conteo !== undefined) d.productos_disponibles = conteo;
    return d;
  }
  const productoPublico = (p) => ({ id: p.id, negocio_id: p.negocio_id, nombre: p.nombre, descripcion: p.descripcion || "", precio: p.precio, stock: Math.max(0, p.stock), emoji: p.emoji, activo: p.activo });
  const resumen = (n) => ({
    ventas_total: n.ventas_total, comision_total: n.comision_total, pedidos_completados: n.pedidos_completados,
    neto_a_depositar: n.neto_a_depositar, saldo_por_liquidar: n.saldo_por_liquidar, comision_pct: COMISION[n.tipo],
  });
  const usuarioPublico = (u) => ({ email: u.email, nombre: u.nombre, rol: u.rol, negocio_id: u.negocio_id || null });

  function vistaCliente(p) {
    const d = {
      id: p.id, negocio_id: p.negocio_id, negocio_nombre: p.negocio_nombre, negocio_emoji: p.negocio_emoji, tipo: p.tipo, estado: p.estado,
      pago: p.pago, horario: p.horario, punto_encuentro: p.punto_encuentro || null, total: p.total, creado: p.creado, historial: p.historial,
      codigo_bloqueado: p.codigo_bloqueado || null,
      items: p.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, subtotal: i.subtotal })),
    };
    if (p.tipo === "temporal" && ["apartado", "aceptado"].includes(p.estado)) d.codigo = p.codigo;
    d.puede_cancelar = p.tipo === "fijo" ? p.estado === "pagado" : ["apartado", "aceptado"].includes(p.estado);
    return d;
  }
  function vistaNegocio(p) {
    const acciones = Object.entries(ACCIONES[p.tipo]).filter(([, [desde]]) => desde.includes(p.estado)).map(([a]) => a);
    if (p.tipo === "temporal" && ["apartado", "aceptado"].includes(p.estado) && !p.codigo_bloqueado) acciones.push("completar");
    return {
      id: p.id, cliente_nombre: p.cliente_nombre, tipo: p.tipo, estado: p.estado, pago: p.pago, horario: p.horario,
      punto_encuentro: p.punto_encuentro || null, total: p.total, comision_total: p.comision_total, creado: p.creado,
      historial: p.historial, codigo_bloqueado: p.codigo_bloqueado || null, items: p.items, neto: p.total - p.comision_total,
      intentos_restantes: Math.max(0, MAX_INTENTOS - (p.intentos_codigo || 0)), acciones,
    };
  }

  // ---------- Reglas de pedidos ----------
  function devolverStock(db, p) { for (const i of p.items) { const prod = db.productos[i.producto_id]; if (prod) prod.stock += i.cantidad; } }
  function cambiarEstado(p, desde, hacia, extra = {}) {
    if (!desde.includes(p.estado)) return false;
    p.estado = hacia;
    p.actualizado = ahoraISO();
    Object.assign(p, extra);
    p.historial.push({ estado: hacia, ts: p.actualizado });
    return true;
  }
  function vencer(db, p) {
    if (p.tipo === "temporal" && ["apartado", "aceptado"].includes(p.estado) && p.reserva_expira < Date.now()) {
      if (cambiarEstado(p, ["apartado", "aceptado"], "vencido")) devolverStock(db, p);
    }
    return p;
  }
  function registrarVenta(db, p) {
    const n = db.negocios[p.negocio_id];
    if (!n) return;
    n.ventas_total += p.total;
    n.comision_total += p.comision_total;
    n.pedidos_completados += 1;
    if (p.tipo === "fijo") n.neto_a_depositar += p.total - p.comision_total;
    else n.saldo_por_liquidar += p.comision_total;
  }

  // ---------- IA simulada ----------
  const ETIQUETA = { pagado: "pagado", preparando: "en preparación", listo: "listo para recoger", entregado: "entregado", apartado: "apartado, esperando que el vendedor acepte", aceptado: "aceptado por el vendedor", completado: "completado", cancelado: "cancelado", rechazado: "rechazado", vencido: "vencido" };
  function respuestaSoporte(db, usuario, mensaje) {
    const t = mensaje.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const persona = ["reembolso", "no llego", "no me", "estafa", "robo", "persona", "humano", "queja", "problema", "seguridad"].some((k) => t.includes(k));
    const mios = Object.values(db.pedidos).filter((p) => p.cliente_email === usuario.email).sort((a, b) => b.creado.localeCompare(a.creado));
    let r;
    if (/(donde|estado|mi pedido|ya esta|cuando)/.test(t) && mios.length) {
      const p = mios.find((x) => ACTIVOS.includes(x.estado)) || mios[0];
      r = `Tu pedido ${p.id} en ${p.negocio_nombre} está ${ETIQUETA[p.estado]}.` + (p.tipo === "temporal" && ["apartado", "aceptado"].includes(p.estado)
        ? ` Te ven en ${p.punto_encuentro} a las ${p.horario}. Da tu código de 6 dígitos solo cuando tengas tu pedido.`
        : p.estado === "listo" ? " Ya puedes pasar a recogerlo." : " En Mis pedidos ves cada cambio al momento.");
    } else if (/(apart|codigo|estudiante|temporal)/.test(t)) {
      r = "Con estudiantes que venden no pagas en la app: apartas, eligen punto y hora, y pagas al recoger. Tu código de 6 dígitos confirma la entrega; dáselo al vendedor cuando tengas tu pedido.";
    } else if (/(cancel)/.test(t)) {
      r = "Puedes cancelar desde Mis pedidos. En un local, mientras no empiecen a prepararlo (el reembolso simulado es inmediato). Con un estudiante, antes de recoger tu pedido.";
    } else if (/(vender|vendo|negocio|verific)/.test(t)) {
      r = "Para vender, crea una cuenta y elige Vender. Registra tu negocio, agrega tus productos y sube tu documento: la IA lo revisa y una persona del equipo lo aprueba.";
    } else if (/(pago|pagar|tarjeta|efectivo|transfer)/.test(t)) {
      r = "En los locales pagas en la app (simulado en esta demo). Con estudiantes eliges cómo pagarás y lo pagas en persona al recoger.";
    } else {
      r = "Te ayudo con pedidos, apartados, pagos, cancelaciones y cómo vender. ¿Qué necesitas?";
    }
    if (persona) r += " Si quieres, una persona del equipo revisa tu caso.";
    return { respuesta: r, sugerir_persona: persona };
  }

  function medirImagen(dataUrl) {
    return new Promise((resolver) => {
      const img = new Image();
      img.onload = () => {
        const escala = Math.min(1, 900 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
        const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        resolver({ ancho: img.width, alto: img.height, miniatura: c.toDataURL("image/jpeg", 0.6) });
      };
      img.onerror = () => resolver(null);
      img.src = dataUrl;
    });
  }

  // ---------- Rutas ----------
  const RUTAS = [];
  const ruta = (metodo, patron, roles, fn) => RUTAS.push([metodo, new RegExp("^" + patron + "$"), roles, fn]);
  const ID = "([A-Za-z0-9_-]{1,64})";
  const TODOS = ["cliente", "negocio", "admin"];

  function sesion(db, token, roles) {
    const s = token && db.sesiones[token];
    if (!s || s.x < Date.now()) throw new Fallo(401, "Tu sesión expiró o no es válida. Inicia sesión de nuevo.");
    const u = db.usuarios[s.email];
    if (!u) throw new Fallo(401, "Tu cuenta ya no existe. Inicia sesión de nuevo.");
    if (!roles.includes(u.rol)) throw new Fallo(403, "No tienes permiso para esta acción.");
    return u;
  }
  function crearSesion(db, u) {
    const token = id("S", 24);
    db.sesiones[token] = { email: u.email, x: Date.now() + 8 * 3600e3 };
    return { token, usuario: usuarioPublico(u) };
  }
  function miNegocio(db, u, obligatorio = true) {
    const n = u.negocio_id ? db.negocios[u.negocio_id] : null;
    if (obligatorio && !n) throw new Fallo(404, "Primero registra tu negocio.");
    return n;
  }
  function verMiNegocio(db, u) {
    const n = miNegocio(db, u, false);
    if (!n) return { negocio: null, productos: [], comision_pct: COMISION, dominio_institucional: "" };
    const productos = Object.values(db.productos).filter((p) => p.negocio_id === n.id).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return {
      negocio: { ...negocioPublico(n), verificacion: n.verificacion || null, documento_subido: !!n.doc_subido, revision: n.revision || null, resumen: resumen(n) },
      productos: productos.map(productoPublico), comision_pct: COMISION,
    };
  }
  function datosNegocio(b, tipo, parcial) {
    const d = {};
    if (!parcial || "nombre" in b) d.nombre = texto(b.nombre, "nombre del negocio", 3, 50);
    if (!parcial || "descripcion" in b) d.descripcion = texto(b.descripcion, "descripción", 0, 160, false);
    if (!parcial || "categoria" in b) d.categoria = opcion(b.categoria, "categoría", CATEGORIAS);
    if (!parcial || "emoji" in b) d.emoji = opcion(b.emoji, "emoji", EMOJIS);
    if (tipo === "fijo") {
      if (!parcial || "ubicacion" in b) d.ubicacion = texto(b.ubicacion, "ubicación", 3, 80);
      if (!parcial || "apertura" in b || "cierre" in b) {
        const a = hora(b.apertura, "apertura"), c = hora(b.cierre, "cierre");
        if (minutos(a) >= minutos(c)) throw new Fallo(400, "La hora de apertura debe ser antes del cierre.");
        Object.assign(d, { apertura: a, cierre: c });
      }
    } else {
      if (!parcial || "ventana" in b) {
        const v = b.ventana || {};
        if (typeof v.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) throw new Fallo(400, "La fecha de venta no es válida.");
        const i = hora(v.inicio, "inicio"), f = hora(v.fin, "fin");
        if (v.fecha < hoy() || v.fecha > hoy(30)) throw new Fallo(400, "La fecha de venta debe ser entre hoy y los próximos 30 días.");
        if (minutos(i) >= minutos(f)) throw new Fallo(400, "La hora de inicio debe ser antes del fin.");
        d.ventana = { fecha: v.fecha, inicio: i, fin: f };
      }
      if (!parcial || "puntos_encuentro" in b) {
        const p = Array.isArray(b.puntos_encuentro) ? b.puntos_encuentro : [];
        if (p.length < 1 || p.length > 3) throw new Fallo(400, "Elige entre 1 y 3 puntos de encuentro.");
        p.forEach((x) => opcion(x, "punto de encuentro", PUNTOS));
        d.puntos_encuentro = [...new Set(p)];
      }
    }
    return d;
  }

  ruta("GET", "/(salud)?", null, () => ({ ok: true, servicio: "Lion Pick Up (demo local)", hora: ahoraISO() }));
  ruta("GET", "/config", null, () => ({ puntos_encuentro: PUNTOS, categorias: CATEGORIAS, emojis: EMOJIS, comision_pct: COMISION, max_apartados: MAX_APARTADOS, dominio_institucional: "", hoy: hoy() }));

  ruta("GET", "/negocios", null, (db, r) => {
    let lista = Object.values(db.negocios).filter((n) => n.estado === "aprobado");
    if (["fijo", "temporal"].includes(r.query.tipo)) lista = lista.filter((n) => n.tipo === r.query.tipo);
    lista = lista.filter((n) => n.tipo === "fijo" || estadoVentana(n) !== "terminada");
    const conteo = {};
    Object.values(db.productos).filter((p) => p.activo && p.stock > 0).forEach((p) => { conteo[p.negocio_id] = (conteo[p.negocio_id] || 0) + 1; });
    const negocios = lista.map((n) => negocioPublico(n, conteo[n.id] || 0));
    negocios.sort((a, b) => (a.tipo !== "temporal") - (b.tipo !== "temporal") || a.nombre.localeCompare(b.nombre));
    return { negocios };
  });
  ruta("GET", "/negocios/" + ID, null, (db, r) => {
    const n = db.negocios[r.p[0]];
    if (!n || n.estado !== "aprobado") throw new Fallo(404, "Negocio no encontrado.");
    const productos = Object.values(db.productos).filter((p) => p.negocio_id === n.id && p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { negocio: negocioPublico(n), productos: productos.map(productoPublico) };
  });

  ruta("POST", "/auth/registro", null, (db, r) => {
    const b = r.body;
    const nombre = texto(b.nombre, "nombre", 2, 60);
    const email = texto(b.email, "correo", 6, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Fallo(400, "El correo no tiene un formato válido.");
    const pw = b.password;
    if (typeof pw !== "string" || pw.length < 8 || pw.length > 72) throw new Fallo(400, "La contraseña debe tener entre 8 y 72 caracteres.");
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Fallo(400, "La contraseña debe incluir al menos una letra y un número.");
    let rol = opcion(b.rol || "cliente", "rol", ["cliente", "negocio"]);
    if (b.acepta_terminos !== true) throw new Fallo(400, "Debes aceptar el aviso de privacidad y los términos.");
    if (b.codigo_admin) { if (b.codigo_admin !== "LION-ADMIN") throw new Fallo(403, "El código de administrador no es correcto."); rol = "admin"; }
    if (db.usuarios[email]) throw new Fallo(409, "Ya existe una cuenta con ese correo.");
    const u = { email, nombre, rol, hash: huella(pw), creado: ahoraISO(), negocio_id: null, intentos_fallidos: 0 };
    db.usuarios[email] = u;
    return crearSesion(db, u);
  });
  ruta("POST", "/auth/login", null, (db, r) => {
    const email = String(r.body.email || "").trim().toLowerCase();
    const pw = r.body.password;
    if (!email || typeof pw !== "string" || !pw) throw new Fallo(400, "Escribe tu correo y tu contraseña.");
    const u = db.usuarios[email];
    if (u && (u.bloqueado_hasta || 0) > Date.now()) throw new Fallo(429, "Demasiados intentos fallidos. Espera 10 minutos.");
    if (!u) throw new Fallo(400, "Correo o contraseña incorrectos.");
    if (u.hash !== huella(pw)) {
      u.intentos_fallidos = (u.intentos_fallidos || 0) + 1;
      if (u.intentos_fallidos >= 5) { u.intentos_fallidos = 0; u.bloqueado_hasta = Date.now() + 600e3; }
      throw new Fallo(400, "Correo o contraseña incorrectos.");
    }
    u.intentos_fallidos = 0;
    return crearSesion(db, u);
  });
  ruta("GET", "/auth/yo", TODOS, (db, r) => ({ usuario: usuarioPublico(r.u) }));

  ruta("GET", "/negocio", ["negocio"], (db, r) => verMiNegocio(db, r.u));
  ruta("POST", "/negocio", ["negocio"], (db, r) => {
    const actual = miNegocio(db, r.u, false);
    if (actual) {
      const cambios = datosNegocio(r.body, actual.tipo, true);
      if (!Object.keys(cambios).length) throw new Fallo(400, "No hay cambios que guardar.");
      Object.assign(actual, cambios, { actualizado: ahoraISO() });
      return verMiNegocio(db, r.u);
    }
    const tipo = opcion(r.body.tipo, "tipo", ["fijo", "temporal"]);
    const n = {
      id: id("NEG-"), owner_email: r.u.email, owner_nombre: r.u.nombre, tipo, estado: "pendiente", creado: ahoraISO(),
      ventas_total: 0, comision_total: 0, pedidos_completados: 0, neto_a_depositar: 0, saldo_por_liquidar: 0, docs_contador: 0,
      ...datosNegocio(r.body, tipo, false),
    };
    db.negocios[n.id] = n;
    r.u.negocio_id = n.id;
    return verMiNegocio(db, r.u);
  });
  ruta("POST", "/negocio/documento", ["negocio"], async (db, r) => {
    const n = miNegocio(db, r.u);
    const nombre = texto(r.body.nombre_responsable, "nombre del responsable", 3, 80);
    const imagen = r.body.imagen;
    if (typeof imagen !== "string" || !/^data:image\/(jpeg|png);base64,/.test(imagen)) throw new Fallo(400, "Solo se aceptan imágenes JPG o PNG.");
    if ((n.docs_contador || 0) >= 5) throw new Fallo(429, "Alcanzaste el máximo de documentos. Contacta a soporte.");
    const medida = await medirImagen(imagen);
    if (!medida) throw new Fallo(400, "La imagen no se pudo leer.");
    const legible = Math.min(medida.ancho, medida.alto) >= 200;
    n.docs_contador = (n.docs_contador || 0) + 1;
    n.doc_subido = ahoraISO();
    n.doc_imagen = medida.miniatura;
    n.verificacion = {
      analizado: true, es_documento: true, tipo_documento: "documento de muestra", legible, nombre_coincide: "no_visible",
      alertas: ["Demo sin servidor: la imagen no se envió a una IA real"],
      recomendacion: legible ? "revisar" : "rechazar",
      resumen: legible
        ? `Simulación: la imagen mide ${medida.ancho}×${medida.alto} px y se ve legible. En la versión con AWS, Amazon Bedrock lee el documento y compara el nombre.`
        : `Simulación: la imagen mide ${medida.ancho}×${medida.alto} px, demasiado pequeña para leerse. Sube una foto más clara.`,
      modelo: "simulado", fecha: ahoraISO(), nombre_declarado: nombre,
    };
    if (n.estado !== "aprobado") n.estado = "pendiente";
    return { verificacion: n.verificacion, documento_guardado: true };
  });
  ruta("POST", "/negocio/productos", ["negocio"], (db, r) => {
    const n = miNegocio(db, r.u);
    if (Object.values(db.productos).filter((p) => p.negocio_id === n.id).length >= 30) throw new Fallo(400, "Máximo 30 productos por negocio.");
    const b = r.body;
    const p = {
      id: id("PRD-"), negocio_id: n.id, nombre: texto(b.nombre, "nombre", 2, 50), descripcion: texto(b.descripcion, "descripción", 0, 120, false),
      precio: centavos(b.precio), stock: entero(b.stock, "stock", 0, 999), emoji: opcion(b.emoji || n.emoji, "emoji", EMOJIS), activo: true, creado: ahoraISO(),
    };
    db.productos[p.id] = p;
    return { producto: productoPublico(p) };
  });
  ruta("PUT", "/negocio/productos/" + ID, ["negocio"], (db, r) => {
    const n = miNegocio(db, r.u);
    const p = db.productos[r.p[0]];
    if (!p || p.negocio_id !== n.id) throw new Fallo(404, "Producto no encontrado.");
    const b = r.body, c = {};
    if ("nombre" in b) c.nombre = texto(b.nombre, "nombre", 2, 50);
    if ("descripcion" in b) c.descripcion = texto(b.descripcion, "descripción", 0, 120, false);
    if ("precio" in b) c.precio = centavos(b.precio);
    if ("stock" in b) c.stock = entero(b.stock, "stock", 0, 999);
    if ("activo" in b) { if (typeof b.activo !== "boolean") throw new Fallo(400, "El campo 'activo' debe ser verdadero o falso."); c.activo = b.activo; }
    if ("emoji" in b) c.emoji = opcion(b.emoji, "emoji", EMOJIS);
    if (!Object.keys(c).length) throw new Fallo(400, "No hay cambios que guardar.");
    Object.assign(p, c, { actualizado: ahoraISO() });
    return { producto: productoPublico(p) };
  });

  ruta("POST", "/pedidos", ["cliente", "negocio"], (db, r) => {
    const b = r.body, u = r.u;
    const n = db.negocios[b.negocio_id];
    if (!n || n.estado !== "aprobado") throw new Fallo(404, "Este negocio no está disponible.");
    if (n.owner_email === u.email) throw new Fallo(400, "No puedes pedirle a tu propio negocio.");
    const tipo = n.tipo;
    if (tipo === "temporal" && estadoVentana(n) !== "abierta") throw new Fallo(409, "Este vendedor no tiene venta abierta hoy.");
    const lineas = Array.isArray(b.items) ? b.items : [];
    if (lineas.length < 1 || lineas.length > 10) throw new Fallo(400, "El pedido debe tener entre 1 y 10 productos.");
    const cantidades = {};
    for (const l of lineas) cantidades[l.producto_id] = (cantidades[l.producto_id] || 0) + entero(l.cantidad, "cantidad", 1, 10);
    if (Object.values(cantidades).reduce((s, x) => s + x, 0) > 20) throw new Fallo(400, "Máximo 20 piezas por pedido.");
    let horario = b.horario;
    if (tipo === "fijo") {
      if (horario !== "asap") { hora(horario); if (minutos(horario) < minutos(n.apertura) || minutos(horario) > minutos(n.cierre)) throw new Fallo(400, `Elige un horario entre ${n.apertura} y ${n.cierre}.`); }
    } else {
      hora(horario);
      if (minutos(horario) < minutos(n.ventana.inicio) || minutos(horario) > minutos(n.ventana.fin)) throw new Fallo(400, `Elige un horario entre ${n.ventana.inicio} y ${n.ventana.fin}.`);
    }
    const metodo = opcion(b.metodo_pago, "método de pago", METODOS[tipo]);
    let punto = null;
    if (tipo === "temporal") {
      punto = opcion(b.punto_encuentro, "punto de encuentro", n.puntos_encuentro || []);
      const activos = Object.values(db.pedidos).filter((p) => p.cliente_email === u.email && p.tipo === "temporal").map((p) => vencer(db, p)).filter((p) => ["apartado", "aceptado"].includes(p.estado));
      if (activos.length >= MAX_APARTADOS) throw new Fallo(409, `Ya tienes ${MAX_APARTADOS} apartados activos. Recoge o cancela uno antes de apartar otro.`);
    }
    const items = [];
    let total = 0, comision = 0;
    for (const [pid, cantidad] of Object.entries(cantidades)) {
      const p = db.productos[pid];
      if (!p || p.negocio_id !== n.id || !p.activo) throw new Fallo(400, "Uno de los productos ya no está disponible.");
      if (p.stock < cantidad) throw new Fallo(409, `Ya no hay suficiente stock de ${p.nombre}.`);
      const cu = comisionUnitaria(p.precio, tipo);
      items.push({ producto_id: pid, nombre: p.nombre, cantidad, precio: p.precio, subtotal: p.precio * cantidad, comision_unitaria: cu, comision: cu * cantidad });
      total += p.precio * cantidad; comision += cu * cantidad;
    }
    items.forEach((i) => { db.productos[i.producto_id].stock -= i.cantidad; });
    const momento = ahoraISO();
    const pedido = {
      id: id("P"), tipo, negocio_id: n.id, negocio_nombre: n.nombre, negocio_emoji: n.emoji, cliente_email: u.email, cliente_nombre: u.nombre,
      items, total, comision_total: comision, horario, creado: momento, actualizado: momento,
    };
    if (tipo === "fijo") Object.assign(pedido, { estado: "pagado", pago: { modo: "en_app", metodo, estado: "pagado_simulado" } });
    else {
      const [a, m, d] = n.ventana.fecha.split("-").map(Number);
      const [hh, mm] = n.ventana.fin.split(":").map(Number);
      Object.assign(pedido, {
        estado: "apartado", punto_encuentro: punto, pago: { modo: "directo", metodo, estado: "por_acordar" },
        codigo: String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0"), intentos_codigo: 0, codigo_bloqueado: false,
        reserva_expira: new Date(a, m - 1, d, hh, mm + GRACIA_MIN).getTime(),
      });
    }
    pedido.historial = [{ estado: pedido.estado, ts: momento }];
    db.pedidos[pedido.id] = pedido;
    return { pedido: vistaCliente(pedido) };
  });
  ruta("GET", "/pedidos/mios", TODOS, (db, r) => {
    const lista = Object.values(db.pedidos).filter((p) => p.cliente_email === r.u.email).map((p) => vencer(db, p));
    lista.sort((a, b) => b.creado.localeCompare(a.creado));
    return { pedidos: lista.slice(0, 50).map(vistaCliente) };
  });
  ruta("POST", "/pedidos/" + ID + "/cancelar", TODOS, (db, r) => {
    const p = db.pedidos[r.p[0]];
    if (!p || p.cliente_email !== r.u.email) throw new Fallo(404, "Pedido no encontrado.");
    vencer(db, p);
    const ok = p.tipo === "fijo"
      ? cambiarEstado(p, ["pagado"], "cancelado", { pago: { ...p.pago, estado: "reembolsado_simulado" } })
      : cambiarEstado(p, ["apartado", "aceptado"], "cancelado");
    if (!ok) throw new Fallo(409, "Este pedido ya no se puede cancelar.");
    devolverStock(db, p);
    return { pedido: vistaCliente(p) };
  });

  function pedidoDeMiNegocio(db, u, pid) {
    const n = miNegocio(db, u);
    const p = db.pedidos[pid];
    if (!p || p.negocio_id !== n.id) throw new Fallo(404, "Pedido no encontrado.");
    return vencer(db, p);
  }
  ruta("GET", "/negocio/pedidos", ["negocio"], (db, r) => {
    const n = miNegocio(db, r.u);
    const lista = Object.values(db.pedidos).filter((p) => p.negocio_id === n.id).map((p) => vencer(db, p));
    const activos = lista.filter((p) => ACTIVOS.includes(p.estado)).sort((a, b) => a.creado.localeCompare(b.creado));
    const cerrados = lista.filter((p) => !ACTIVOS.includes(p.estado)).sort((a, b) => b.creado.localeCompare(a.creado)).slice(0, 30);
    return { activos: activos.map(vistaNegocio), cerrados: cerrados.map(vistaNegocio), resumen: resumen(n) };
  });
  ruta("POST", "/negocio/pedidos/" + ID + "/accion", ["negocio"], (db, r) => {
    const p = pedidoDeMiNegocio(db, r.u, r.p[0]);
    const accion = opcion(r.body.accion, "acción", Object.keys(ACCIONES[p.tipo]));
    const [desde, hacia] = ACCIONES[p.tipo][accion];
    const extra = {};
    if (accion === "rechazar" && p.tipo === "fijo") extra.pago = { ...p.pago, estado: "reembolsado_simulado" };
    if (accion === "entregar") extra.pago = { ...p.pago, estado: "liquidado_simulado" };
    if (!cambiarEstado(p, desde, hacia, extra)) throw new Fallo(409, "El pedido cambió de estado. Actualiza la lista.");
    if (accion === "rechazar") devolverStock(db, p);
    if (accion === "entregar") registrarVenta(db, p);
    return { pedido: vistaNegocio(p) };
  });
  ruta("POST", "/negocio/pedidos/" + ID + "/completar", ["negocio"], (db, r) => {
    const p = pedidoDeMiNegocio(db, r.u, r.p[0]);
    if (p.tipo !== "temporal") throw new Fallo(400, "Solo los apartados se completan con código.");
    if (!["apartado", "aceptado"].includes(p.estado)) throw new Fallo(409, "Este apartado ya no está activo.");
    if (p.codigo_bloqueado) throw new Fallo(423, "Pedido bloqueado por demasiados códigos incorrectos. Contacten a soporte.");
    const codigo = String(r.body.codigo || "").trim();
    if (codigo !== p.codigo) {
      p.intentos_codigo = (p.intentos_codigo || 0) + 1;
      const restantes = Math.max(0, MAX_INTENTOS - p.intentos_codigo);
      if (!restantes) { p.codigo_bloqueado = true; throw new Fallo(423, "Código incorrecto. El pedido se bloqueó por seguridad."); }
      throw new Fallo(400, `Código incorrecto. Te quedan ${restantes} intentos.`);
    }
    cambiarEstado(p, ["apartado", "aceptado"], "completado", { pago: { ...p.pago, estado: "pagado_en_persona" } });
    registrarVenta(db, p);
    return { pedido: vistaNegocio(p) };
  });

  ruta("POST", "/soporte/chat", TODOS, (db, r) => {
    const mensaje = texto(r.body.mensaje, "mensaje", 1, 500);
    return respuestaSoporte(db, r.u, mensaje);
  });
  ruta("POST", "/soporte/ticket", TODOS, (db, r) => {
    const t = {
      id: id("T", 6), email: r.u.email, nombre: r.u.nombre, rol: r.u.rol,
      mensaje: texto(r.body.mensaje, "mensaje", 5, 600), pedido_id: texto(r.body.pedido_id, "pedido", 0, 20, false),
      estado: "abierto", creado: ahoraISO(),
    };
    db.tickets[t.id] = t;
    return { ticket: { id: t.id, estado: t.estado } };
  });

  const ADMIN = ["admin"];
  ruta("GET", "/admin/resumen", ADMIN, (db) => {
    const negocios = Object.values(db.negocios), pedidos = Object.values(db.pedidos), tickets = Object.values(db.tickets);
    const ok = pedidos.filter((p) => ["entregado", "completado"].includes(p.estado));
    return {
      negocios: { aprobados: negocios.filter((n) => n.estado === "aprobado").length, pendientes: negocios.filter((n) => n.estado === "pendiente").length, fijos: negocios.filter((n) => n.tipo === "fijo").length, temporales: negocios.filter((n) => n.tipo === "temporal").length },
      pedidos: { total: pedidos.length, activos: pedidos.filter((p) => ACTIVOS.includes(p.estado)).length, completados: ok.length, cancelados: pedidos.filter((p) => ["cancelado", "rechazado", "vencido"].includes(p.estado)).length },
      ventas_total: ok.reduce((s, p) => s + p.total, 0), comision_total: ok.reduce((s, p) => s + p.comision_total, 0),
      comision_por_cobrar: negocios.reduce((s, n) => s + (n.saldo_por_liquidar || 0), 0),
      tickets_abiertos: tickets.filter((t) => t.estado === "abierto").length, comision_pct: COMISION,
    };
  });
  ruta("GET", "/admin/negocios", ADMIN, (db, r) => {
    let lista = Object.values(db.negocios);
    if (["pendiente", "aprobado", "rechazado"].includes(r.query.estado)) lista = lista.filter((n) => n.estado === r.query.estado);
    lista.sort((a, b) => (a.estado !== "pendiente") - (b.estado !== "pendiente") || a.creado.localeCompare(b.creado));
    return { negocios: lista.map((n) => ({ ...negocioPublico(n), owner_email: n.owner_email, owner_nombre: n.owner_nombre, verificacion: n.verificacion || null, documento_subido: !!n.doc_imagen, revision: n.revision || null, resumen: resumen(n), creado: n.creado })) };
  });
  ruta("GET", "/admin/negocios/" + ID + "/documento", ADMIN, (db, r) => {
    const n = db.negocios[r.p[0]];
    if (!n || !n.doc_imagen) throw new Fallo(404, "Este negocio no tiene documento guardado.");
    return { url: n.doc_imagen, expira_en_segundos: 300 };
  });
  ruta("POST", "/admin/negocios/" + ID + "/decision", ADMIN, (db, r) => {
    const n = db.negocios[r.p[0]];
    if (!n) throw new Fallo(404, "Negocio no encontrado.");
    const decision = opcion(r.body.decision, "decisión", ["aprobar", "rechazar"]);
    const nota = texto(r.body.nota, "nota", 0, 200, false);
    n.estado = decision === "aprobar" ? "aprobado" : "rechazado";
    n.revision = { por: r.u.email, fecha: ahoraISO(), nota, decision: n.estado };
    return { ok: true, estado: n.estado };
  });
  ruta("POST", "/admin/negocios/" + ID + "/liquidar", ADMIN, (db, r) => {
    const n = db.negocios[r.p[0]];
    if (!n) throw new Fallo(404, "Negocio no encontrado.");
    const monto = n.saldo_por_liquidar || 0;
    n.saldo_por_liquidar = 0;
    n.ultima_liquidacion = { monto, fecha: ahoraISO() };
    return { ok: true, liquidado: monto };
  });
  ruta("GET", "/admin/tickets", ADMIN, (db) => ({ tickets: Object.values(db.tickets).sort((a, b) => (a.estado !== "abierto") - (b.estado !== "abierto") || a.creado.localeCompare(b.creado)) }));
  ruta("POST", "/admin/tickets/" + ID + "/resolver", ADMIN, (db, r) => {
    const t = db.tickets[r.p[0]];
    if (!t) throw new Fallo(404, "Ticket no encontrado.");
    Object.assign(t, { estado: "resuelto", resuelto: ahoraISO(), resuelto_por: r.u.email });
    return { ok: true };
  });
  ruta("POST", "/admin/demo", ADMIN, (db, r) => {
    const sesiones = db.sesiones;
    const yo = r.u;
    const nuevo = semilla();
    Object.keys(db).forEach((k) => delete db[k]);
    Object.assign(db, nuevo, { sesiones }); // las sesiones abiertas siguen funcionando
    if (!db.usuarios[yo.email]) db.usuarios[yo.email] = yo;
    return {
      ok: true, negocios: DEMO.map((d) => d.nombre),
      cuentas: { cliente: "cliente@lionpickup.demo", negocio_fijo: "cocina@lionpickup.demo", vendedor_temporal: "sofi@lionpickup.demo", pendiente_de_aprobar: "mau@lionpickup.demo" },
      password_demo: PASSWORD_DEMO,
    };
  });

  // ---------- Entrada ----------
  async function llamar(rutaCompleta, { metodo = "GET", datos, token } = {}) {
    const [camino, consulta] = rutaCompleta.split("?");
    const query = Object.fromEntries(new URLSearchParams(consulta || ""));
    const db = cargar();
    let existe = false;
    try {
      for (const [m, patron, roles, fn] of RUTAS) {
        const coincide = camino.match(patron);
        if (!coincide) continue;
        existe = true;
        if (m !== metodo) continue;
        const solicitud = { body: datos && typeof datos === "object" ? datos : {}, query, p: coincide.slice(1).filter((x) => x !== undefined && x !== "salud"), u: null };
        if (roles) solicitud.u = sesion(db, token, roles);
        const cuerpo = await fn(db, solicitud);
        guardar(db);
        return { status: 200, cuerpo: JSON.parse(JSON.stringify(cuerpo)) };
      }
      throw new Fallo(existe ? 405 : 404, existe ? "Método no permitido en esta ruta." : "Ruta no encontrada.");
    } catch (e) {
      if (e instanceof Fallo) { if (e.status < 500) guardar(db); return { status: e.status, cuerpo: { error: e.message } }; }
      console.error(e);
      return { status: 500, cuerpo: { error: "Error interno de la demo." } };
    }
  }

  window.DemoLocal = { llamar, PASSWORD_DEMO };
})();
