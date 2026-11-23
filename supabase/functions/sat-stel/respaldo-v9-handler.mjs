/*
 * DAFRICA SAT · única puerta entre la aplicación de partes y STEL Order (2026-11-16; desplegada el 2026-11-17 con
 * autorización del usuario, verify_jwt activado).
 * La clave de STEL (`STEL_API_KEY`) solo existe aquí, en el servidor. Rutas y campos tomados de la
 * especificación OpenAPI oficial (https://app.stelorder.com/app/api/openapi.json); ver docs/sat-diseno.md.
 *
 * Acciones (POST JSON, con la sesión del usuario en Authorization):
 *  - {accion:"procesar", parte_id}: técnico del parte o administración. Procesa las operaciones pendientes del
 *    parte (incidencia, albarán de trabajo con PDF y fotos, factura aprobada).
 *  - {accion:"procesar"} sin parte: administración; todas las pendientes (también altas de clientes).
 *  - {accion:"catalogo"}: administración; copia clientes, direcciones, contactos, equipos, artículos y servicios.
 *
 * Nada se duplica al reintentar: cada operación busca antes en STEL lo que habría creado.
 *  - Incidencia: `external-id` = "DAFRICA-SAT-<id del aviso>" (STEL lo acepta al crear y lo filtra en GET).
 *  - Albarán de trabajo: los documentos NO aceptan external-id al crearlos; el título empieza por el código del parte
 *    (PT-26-00001) y se busca por título y cliente; además se guarda el id devuelto.
 *  - Adjuntos: por nombre de fichero dentro del albarán.
 *  - Factura: por `parent-document-id` = albarán de trabajo (si alguien ya la hizo en STEL, se reutiliza).
 * Una respuesta perdida tras un POST deja la operación en ERROR; el siguiente intento la encuentra y no repite.
 */
const ORIGENES = ["https://ernestvz98-boop.github.io"];
const RE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRIORIDAD = {BAJA: "LOW", NORMAL: "NORMAL", ALTA: "HIGH", URGENTE: "VERYHIGH"};
const MOMENTO = {ANTES: "antes", DURANTE: "durante", DESPUES: "despues", MATERIAL: "albaran_proveedor"};

const cabecerasCors = (origen) => ({
  "Access-Control-Allow-Origin": origen,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

export class ErrorStel extends Error {
  constructor(mensaje, {estado = 0, red = false} = {}) { super(mensaje); this.estado = estado; this.red = red; }
}
class Espera extends Error {}     // la operación depende de otra todavía no hecha (PENDIENTE)
class Bloqueo extends Error {}    // falta algo que tiene que decidir una persona (BLOQUEADA)

/** Fecha en el formato de STEL: yyyy-MM-dd'T'HH:mm:ssZ (hora de Madrid con su desfase). */
export function fechaStel(fecha, hora = "00:00") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) return null;
  const h = /^\d{2}:\d{2}$/.test(hora || "") ? hora : "00:00";
  const d = new Date(`${fecha}T${h}:00Z`);
  // Desfase de Europa/Madrid ese día (horario de verano): +0200 o +0100.
  const local = new Date(d.toLocaleString("en-US", {timeZone: "Europe/Madrid"}));
  const utc = new Date(d.toLocaleString("en-US", {timeZone: "UTC"}));
  const min = Math.round((local - utc) / 60000);
  const signo = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `${fecha}T${h}:00${signo}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
}

function aBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const primero = (v) => (Array.isArray(v) ? v[0] : v) || null;
const idDe = (v) => { const x = primero(v); const n = Number(x?.id); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const horas = (min) => Math.round((Number(min) || 0) / 60 * 100) / 100;
const redondear2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

/**
 * Margen de los materiales comprados (usuario, 2026-11-23: «a todos los materiales que se compren le pongas un 30 % por
 * encima del precio»): ajuste `margen_materiales_pct`, 30 si no está.
 */
export function margenDe(ajustes) {
  const v = ajustes?.margen_materiales_pct;
  return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 30;
}
/** Precio de venta de un material: su coste NETO (con los descuentos) más el margen, a céntimos. */
export function precioVenta(coste, margen) { return redondear2(Number(coste) * (1 + Number(margen) / 100)); }
/**
 * Coste de un material: el neto del albarán del proveedor (la línea cuadraba con sus descuentos, o el técnico copió precio y
 * descuento del papel); si no, el de compra de STEL; si no, el ESTIMADO con lo leído del papel (usuario, 2026-11-23: «que
 * intente rellenar y ya si existe error se modifica, o el técnico o en el STEL Order»), marcado sin comprobar.
 */
export function costeDe(m, costesStel = new Map()) {
  if (Number(m?.precio_neto) > 0) return {coste: Number(m.precio_neto), origen: m.precio_comprobado === "TECNICO" ? "precio y descuento copiados del papel por el técnico" : "albarán del proveedor (con descuentos)"};
  const c = Number(costesStel.get(m?.id));
  if (c > 0) return {coste: c, origen: "precio de compra en STEL"};
  if (Number(m?.precio_neto_estimado) > 0) return {coste: Number(m.precio_neto_estimado), origen: `SIN COMPROBAR: ${m.neto_estimado_como || "leído del papel"}`, dudoso: true};
  return null;
}
const esDelProveedor = (m) => (typeof m?.origen === "object" && m.origen ? m.origen.tipo : m?.origen) === "ALBARAN_PROVEEDOR";
/**
 * Forma de pago y cuenta bancaria de STEL de todos los albaranes de trabajo y facturas (usuario, 2026-11-23: «en forma de
 * pago siempre tiene que ser transferencia y cuenta bancaria la terminada en …»). Sin las dos, null: el documento se para.
 */
export function pagoDe(ajustes) {
  const fp = Number(ajustes?.stel_forma_pago_id), cb = Number(ajustes?.stel_cuenta_bancaria_id);
  return Number.isSafeInteger(fp) && fp > 0 && Number.isSafeInteger(cb) && cb > 0 ? {"payment-option-id": fp, "bank-account-id": cb} : null;
}
export const FALTA_PAGO = "Falta: forma de pago y cuenta bancaria (Ajustes)";

/**
 * Líneas del albarán de trabajo a partir del parte. Cada línea necesita un artículo o servicio de STEL; si falta alguno,
 * devuelve `faltan`. `costesStel`: precio de compra en STEL de los materiales sin neto del papel (id del material → €).
 */
export function lineasAlbaran(contenido, revision, ajustes, resueltos = new Map(), costesStel = new Map()) {
  const lineas = [], faltan = [], sinComprobar = [];
  const porMaterial = new Map((revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => [l.material_id, l.stel_item_id]));
  // Precio de cada línea: el de la revisión de la oficina si la hay; si no, materiales a su coste neto más el margen
  // (usuario, 2026-11-23) y mano de obra y desplazamiento al precio por hora de Ajustes.
  const precioRevision = (pred) => { const l = (revision || []).find(pred); return l && Number(l.precio) >= 0 && l.precio !== null && l.precio !== "" ? Number(l.precio) : null; };
  const conPrecio = (p) => (p !== null && Number.isFinite(p) && p >= 0 ? {"item-base-price": p} : {});
  const margen = margenDe(ajustes);
  for (const m of contenido.materiales || []) {
    const item = m.stel_item_id || porMaterial.get(m.id) || resueltos.get(m.id);
    const cantidad = Number(m.cantidad);
    if (!item) { faltan.push(`artículo de STEL para «${m.descripcion}»`); continue; }
    if (!Number.isFinite(cantidad) || cantidad === 0) { faltan.push(`cantidad de «${m.descripcion}»`); continue; }
    const desc = [m.descripcion, m.referencia ? `Ref. ${m.referencia}` : "", m.unidad ? `(${m.unidad})` : ""].filter(Boolean).join(" ");
    let precio = precioRevision((l) => l.material_id === m.id), dto = 0;
    if (precio !== null) dto = Number((revision || []).find((l) => l.material_id === m.id)?.descuento_pct) || 0;
    else {
      const c = costeDe(m, costesStel);
      // Comprado al proveedor sin coste con descuentos comprobado: nunca el PRECIO bruto del papel (no lleva los descuentos).
      if (!c && esDelProveedor(m)) { faltan.push(`precio de compra con descuentos de «${m.descripcion}» (escríbelo en la revisión)`); continue; }
      if (c) precio = precioVenta(c.coste, margen);
      if (c?.dudoso) sinComprobar.push(m.descripcion);
    }
    // El descuento de la revisión también va al albarán (antes se perdía); el coste + margen ya lleva los del proveedor.
    lineas.push({"line-type": "ITEM", "item-id": Number(item), "units": cantidad, "item-description": desc, ...conPrecio(precio), ...(precio !== null ? {"discount-percentage": dto} : {})});
  }
  const servicio = (clave) => { const v = ajustes?.[clave]; return Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null; };
  const dtoRevision = (tipo) => { const d = Number((revision || []).find((l) => l.tipo === tipo && l.precio !== null && l.precio !== "")?.descuento_pct); return d > 0 ? {"discount-percentage": d} : {}; };
  const porHora = (tipo, clave) => precioRevision((l) => l.tipo === tipo) ?? (Number(ajustes?.[clave]) > 0 ? Number(ajustes[clave]) : null);
  if (Number(contenido.tiempo_trabajo_min) > 0) {
    const id = servicio("stel_servicio_mano_obra_id");
    if (!id) faltan.push("servicio de mano de obra de STEL (Ajustes)");
    else lineas.push({"line-type": "ITEM", "item-id": id, "units": horas(contenido.tiempo_trabajo_min),
      "item-description": `Mano de obra: ${String(horas(contenido.tiempo_trabajo_min)).replace(".", ",")} h`, ...conPrecio(porHora("MANO_OBRA", "precio_hora_mano_obra")), ...dtoRevision("MANO_OBRA")});
  }
  if (Number(contenido.desplazamiento_min) > 0 || Number(contenido.desplazamiento_km) > 0) {
    // En horas (usuario, 2026-11-18: «el desplazamiento y el tiempo de mano de obra en horas»); solo km: 1 desplazamiento.
    const id = servicio("stel_servicio_desplazamiento_id");
    const h = Number(contenido.desplazamiento_min) > 0 ? horas(contenido.desplazamiento_min) : null;
    const partes = [h ? `${String(h).replace(".", ",")} h` : "", Number(contenido.desplazamiento_km) > 0 ? `${contenido.desplazamiento_km} km` : ""].filter(Boolean).join(", ");
    if (!id) faltan.push("servicio de desplazamiento de STEL (Ajustes)");
    else lineas.push({"line-type": "ITEM", "item-id": id, "units": h || 1, "item-description": `Desplazamiento: ${partes}`,
      ...conPrecio(porHora("DESPLAZAMIENTO", "precio_hora_desplazamiento")), ...dtoRevision("DESPLAZAMIENTO")});
  }
  if (!lineas.length && !faltan.length) faltan.push("al menos un material, tiempo de trabajo o desplazamiento");
  return {lineas, faltan, sinComprobar};
}

const canonRef = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/**
 * ¿La referencia de STEL es la del papel? Igual, o «prefijo del proveedor + separador + código» («H8953- 1255087035»):
 * misma regla que el robot de albaranes (robot-stel/procesar-cola.js, mismaReferencia).
 */
export function mismaReferencia(stel, ref) {
  const r = canonRef(ref);
  if (!r) return false;
  if (canonRef(stel) === r) return true;
  const m = String(stel ?? "").trim().toUpperCase().match(/^([A-Z]{1,3}\d{2,10})(\s*-\s*|\s+)(.+)$/);
  return Boolean(m) && r.length >= 6 && canonRef(m[3]) === r;
}
/**
 * Material que la función puede buscar o dar de alta en STEL sola (usuario, 2026-11-20: «necesito que cree el albarán»):
 * leído del albarán del PROVEEDOR, sin dudas o comparado con el papel por el técnico, con referencia y descripción. Lo
 * dictado (una referencia dictada no es fiable) no se da de alta solo: lo asigna la oficina en la revisión.
 */
export function materialDelProveedor(m) {
  const origen = typeof m?.origen === "object" && m.origen ? m.origen.tipo : m?.origen;
  return origen === "ALBARAN_PROVEEDOR" && (m.comprobado === "TECNICO" || !(m.dudas || []).length)
    && canonRef(m.referencia).length >= 3 && String(m.descripcion || "").trim().length >= 2;
}

/** Texto del albarán visible para el cliente: avería, trabajos, estado final y pendientes (sin importes). */
export function textoAlbaran(c) {
  const tipos = {DIAGNOSTICO: "Visita de diagnóstico", REPARACION_FINALIZADA: "Reparación finalizada", PENDIENTE: "Intervención pendiente"};
  const pend = {PRESUPUESTO: "de presupuesto", REPUESTOS: "de repuestos", SEGUNDA_VISITA: "de segunda visita"};
  const out = [tipos[c.tipo_visita] + (c.tipo_visita === "PENDIENTE" && pend[c.pendiente_de] ? " " + pend[c.pendiente_de] : "")];
  if (c.averia) out.push("Avería: " + c.averia);
  if (c.trabajos) out.push("Trabajos: " + c.trabajos);
  if (c.estado_final) out.push("Estado final: " + c.estado_final);
  if (c.pendientes) out.push("Pendiente: " + c.pendientes);
  return out.join("\n").slice(0, 3900);
}

export async function handler(req, {env, fetcher = fetch, dormir = (ms) => new Promise((r) => setTimeout(r, ms))} = {}) {
  const origen = req.headers.get("origin") || "";
  const permitidos = [...ORIGENES, ...(env("SAT_ORIGENES") || "").split(",").map((s) => s.trim()).filter(Boolean)];
  const cors = permitidos.includes(origen) ? cabecerasCors(origen) : {};
  const responder = (datos, estado = 200) => new Response(JSON.stringify(datos), {status: estado,
    headers: {...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}});
  if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
  if (req.method !== "POST") return responder({error: "Método no permitido"}, 405);

  const base = env("SUPABASE_URL") || "", servicio = env("SUPABASE_SERVICE_ROLE_KEY") || "", clave = env("STEL_API_KEY") || "";
  const stelBase = (env("STEL_BASE") || "https://app.stelorder.com/app/").replace(/\/?$/, "/");
  if (!base || !servicio) return responder({error: "Configuración incompleta"}, 503);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({error: "Sin sesión"}, 401);
  let cuerpo;
  try { cuerpo = await req.json(); } catch { return responder({error: "JSON no válido"}, 400); }
  const parteId = cuerpo?.parte_id ?? null;
  if (parteId !== null && !RE_ID.test(String(parteId))) return responder({error: "parte_id no válido"}, 400);

  // Supabase: como el usuario (para comprobar permisos) o con la clave de servicio. Con la clave de servicio va también
  // en `apikey` (como robot-cola): con la clave pública en `apikey` y la de servicio en Authorization, la puerta de
  // Supabase responde 401 (visto en producción el 2026-11-18 al actualizar el catálogo).
  const rpc = async (fn, args, {usuario = false} = {}) => {
    const r = await fetcher(`${base}/rest/v1/rpc/${fn}`, {method: "POST", signal: AbortSignal.timeout(20000),
      headers: {apikey: usuario ? (env("SUPABASE_ANON_KEY") || servicio) : servicio, Authorization: "Bearer " + (usuario ? token : servicio), "Content-Type": "application/json"},
      body: JSON.stringify(args || {})});
    const t = await r.text();
    if (!r.ok) throw Object.assign(new Error(`Supabase ${fn} ${r.status}: ${t.slice(0, 200)}`), {status: r.status});
    return t ? JSON.parse(t) : null;
  };
  let puede;
  try { puede = await rpc("sat_puede_procesar", {p_parte: parteId}, {usuario: true}); }
  catch (e) { return responder({error: "Sin permiso"}, e.status === 401 ? 401 : 403); }
  if (puede !== true) return responder({error: "Sin permiso"}, 403);
  if (!clave) return responder({error: "Falta la clave de STEL en el servidor (STEL_API_KEY)"}, 503);

  // ---------- Cliente de STEL con cuenta de llamadas (límite diario configurable)
  let llamadas = 0, limiteDia = 250, hechasHoy = 0;
  const stel = async (metodo, ruta, {query, body, crudo = false} = {}) => {
    if (hechasHoy + llamadas >= limiteDia) throw new ErrorStel(`Límite diario de llamadas a STEL alcanzado (${limiteDia})`, {estado: 429});
    const url = new URL(ruta, stelBase);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    for (let intento = 0; ; intento++) {
      llamadas++;
      let r;
      try {
        r = await fetcher(url.href, {method: metodo, signal: AbortSignal.timeout(30000),
          headers: {APIKEY: clave, Accept: crudo ? "*/*" : "application/json; charset=utf-8", ...(body ? {"Content-Type": "application/json; charset=utf-8"} : {})},
          body: body ? JSON.stringify(body) : undefined});
      } catch (e) {
        // Un POST/PUT sin respuesta puede haberse hecho: no se repite aquí (el siguiente intento busca antes).
        if (metodo === "GET" && intento < 2) { await dormir(1500 * (intento + 1)); continue; }
        throw new ErrorStel(`STEL sin respuesta (${metodo} ${ruta})`, {red: true});
      }
      if (metodo === "GET" && (r.status === 429 || r.status >= 500) && intento < 2) { await dormir(4000 * (intento + 1)); continue; }
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new ErrorStel(`STEL ${r.status} en ${metodo} ${ruta}: ${t.slice(0, 300)}`, {estado: r.status});
      }
      if (crudo) return new Uint8Array(await r.arrayBuffer());
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    }
  };
  const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x && !x.deleted);

  // ---------- Almacén de archivos (clave de servicio)
  const descargar = async (ruta) => {
    const r = await fetcher(`${base}/storage/v1/object/sat-archivos/${ruta.split("/").map(encodeURIComponent).join("/")}`,
      {headers: {apikey: servicio, Authorization: "Bearer " + servicio}, signal: AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error(`No se pudo leer ${ruta} del almacén (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  };
  const subir = async (ruta, bytes, tipo) => {
    const r = await fetcher(`${base}/storage/v1/object/sat-archivos/${ruta.split("/").map(encodeURIComponent).join("/")}`,
      {method: "POST", headers: {apikey: servicio, Authorization: "Bearer " + servicio, "Content-Type": tipo, "x-upsert": "true"},
        body: bytes, signal: AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error(`No se pudo guardar ${ruta} (${r.status})`);
  };

  // ---------- Operaciones
  async function cliente(ctx) {
    const c = ctx.cliente;
    if (!c) throw new Bloqueo("El cliente ya no existe");
    if (c.stel_id) return {stel_id: c.stel_id, detalle: {ya_vinculado: true}};
    if (c.nif) {
      const porNif = lista(await stel("GET", "clients", {query: {"tax-identification-number": c.nif, limit: 10}}));
      if (porNif.length === 1) return {stel_id: idDe(porNif), detalle: {vinculado_por: "nif"}};
      if (porNif.length > 1) throw new Bloqueo(`Hay ${porNif.length} clientes con ese NIF en STEL: vincúlalo a mano`);
    }
    const porNombre = lista(await stel("GET", "clients", {query: {name: c.nombre, limit: 10}}));
    if (porNombre.length) throw new Bloqueo(`Hay ${porNombre.length} cliente(s) en STEL con ese nombre: vincúlalo a mano para no duplicarlo`);
    const creado = await stel("POST", "clients", {body: {name: c.nombre, ...(c.nif ? {"tax-identification-number": c.nif} : {}),
      ...(c.telefono ? {phone: c.telefono} : {}), ...(c.email ? {email: c.email} : {})}});
    const id = idDe(creado);
    if (!id) throw new Error("STEL no devolvió el id del cliente creado");
    return {stel_id: id, detalle: {creado: true}};
  }

  const incidenciasHechas = new Map();
  async function incidencia(ctx) {
    const a = ctx.aviso;
    if (a.stel_incidencia_id) return {stel_id: a.stel_incidencia_id, detalle: {ya_existia: true}};
    if (!ctx.cliente?.stel_id) throw new Bloqueo("Cliente provisional: vincúlalo a un cliente de STEL o créalo en STEL");
    const externo = "DAFRICA-SAT-" + a.id;
    const previa = lista(await stel("GET", "incidents", {query: {"external-id": externo, limit: 5}}));
    if (previa.length) { incidenciasHechas.set(a.id, idDe(previa)); return {stel_id: idDe(previa), detalle: {reutilizada: true}}; }
    const equipo = ctx.parte?.contenido?.equipo?.stel_id, direccion = ctx.parte?.contenido?.direccion?.stel_id;
    const body = {description: `${a.codigo} · ${a.motivo}`.slice(0, 2000), "external-id": externo, "account-id": Number(ctx.cliente.stel_id),
      priority: PRIORIDAD[a.prioridad] || "NORMAL", ...(direccion ? {"address-id": Number(direccion)} : {}),
      ...(equipo ? {assets: [{id: Number(equipo)}]} : {}), date: fechaStel(String(a.creado_en).slice(0, 10), String(a.creado_en).slice(11, 16))};
    const creada = await stel("POST", "incidents", {body});
    let id = idDe(creada);
    if (!id) id = idDe(lista(await stel("GET", "incidents", {query: {"external-id": externo, limit: 5}})));
    if (!id) throw new Error("STEL no devolvió la incidencia creada");
    incidenciasHechas.set(a.id, id);
    return {stel_id: id, detalle: {creada: true}};
  }

  async function albaran(ctx) {
    const p = ctx.parte, c = p.contenido, a = ctx.aviso;
    if (!ctx.cliente?.stel_id) throw new Bloqueo("Cliente provisional: vincúlalo a un cliente de STEL o créalo en STEL");
    const incidente = a.stel_incidencia_id || incidenciasHechas.get(a.id) || null;
    if (!incidente) throw new Espera("Esperando la incidencia de STEL del aviso");
    // Antes de nada, que no falte un servicio ni la forma de pago (para no dar de alta artículos de un albarán que no se
    // puede crear todavía).
    const pago = pagoDe(ctx.ajustes);
    if (!pago) throw new Bloqueo(FALTA_PAGO);
    const sinServicio = lineasAlbaran({...c, materiales: []}, p.revision, ctx.ajustes).faltan.filter((f) => /servicio/.test(f));
    if (sinServicio.length) throw new Bloqueo("Falta: " + sinServicio.join("; "));
    // Materiales del albarán del proveedor sin artículo de STEL: se busca o se da de alta (regla del robot de albaranes).
    const conRevision = new Set((p.revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => l.material_id));
    const resueltos = new Map(), altas = [];
    for (const m of c.materiales || []) {
      if (m.stel_item_id || conRevision.has(m.id) || !materialDelProveedor(m)) continue;
      const r = await articuloParaMaterial(m, p, ctx.ajustes);
      resueltos.set(m.id, r.id);
      if (r.creado) altas.push({material_id: m.id, referencia: String(m.referencia).trim(), nombre: String(m.descripcion).trim().slice(0, 250), stel_id: r.id,
        ...(Number(m.precio_neto) > 0 ? {precio: precioVenta(m.precio_neto, margenDe(ctx.ajustes))} : {})});
    }
    const costes = await costesDeStel(c.materiales, p.revision, resueltos, new Set(altas.map((x) => x.material_id)));
    const {lineas, faltan, sinComprobar} = lineasAlbaran(c, p.revision, ctx.ajustes, resueltos, costes);
    if (faltan.length) throw new Bloqueo("Falta: " + faltan.join("; "));
    // Precio estimado con lo leído del papel: se avisa en los comentarios PRIVADOS (no los ve el cliente) para revisarlo.
    const notaPrecios = sinComprobar.length ? ` · PRECIO SIN COMPROBAR (revisar con el albarán del proveedor): ${sinComprobar.join(", ")}` : "";
    const titulo = `${p.codigo} · ${a.motivo}`.slice(0, 150);
    const version = Number(ctx.op.detalle?.version || p.version);
    // 1. ¿Ya existe? Por el id guardado o por el título (el código del parte va al principio).
    let doc = null;
    if (p.stel_albaran_id) doc = primero(lista(await stel("GET", `workDeliveryNotes/${p.stel_albaran_id}`)));
    if (!doc) {
      let encontrados;
      try { encontrados = lista(await stel("GET", "workDeliveryNotes", {query: {title: titulo, "account-id": ctx.cliente.stel_id, limit: 50}})); }
      catch (e) {
        if (!(e instanceof ErrorStel) || e.estado !== 400) throw e;
        encontrados = lista(await stel("GET", "workDeliveryNotes", {query: {"account-id": ctx.cliente.stel_id, limit: 500, sort: "-id"}}));
      }
      const mios = encontrados.filter((d) => String(d.title || "").startsWith(p.codigo + " "));
      if (mios.length > 1) throw new Bloqueo(`Hay ${mios.length} albaranes de trabajo con el código ${p.codigo} en STEL: revisar a mano`);
      doc = mios[0] || null;
    }
    const cuerpoDoc = {
      "account-id": Number(ctx.cliente.stel_id), title: titulo, "parent-incident-id": Number(incidente),
      date: fechaStel(c.fecha, c.hora_inicio), "start-date": fechaStel(c.fecha, c.hora_inicio), "end-date": fechaStel(c.fecha, c.hora_fin),
      comments: textoAlbaran(c),
      "private-comments": `DAFRICA SAT ${p.codigo} · parte v${version} firmado · técnico: ${ctx.tecnico_nombre || ""}${notaPrecios}`.slice(0, 1000),
      ...(c.direccion?.stel_id ? {"work-address-id": Number(c.direccion.stel_id)} : {}),
      ...(c.equipo?.stel_id ? {assets: [{id: Number(c.equipo.stel_id)}]} : {}),
      ...(Number(ctx.ajustes?.stel_serie_albaran_trabajo_id) > 0 ? {"serial-number-id": Number(ctx.ajustes.stel_serie_albaran_trabajo_id)} : {}),
      ...pago,
      lines: lineas,
    };
    let id, accion;
    if (!doc) {
      const creado = await stel("POST", "workDeliveryNotes", {body: cuerpoDoc});
      id = idDe(creado);
      accion = "creado";
      if (!id) throw new Error("STEL no devolvió el id del albarán de trabajo (se buscará en el siguiente intento)");
    } else {
      id = idDe(doc);
      accion = "reutilizado";
      if (Number(p.stel_albaran_version || 0) < version && p.stel_albaran_id) {
        // Corrección firmada de nuevo: se actualizan las líneas y los textos del mismo albarán.
        const {"account-id": _c, "parent-incident-id": _i, ...cambios} = cuerpoDoc;
        await stel("PUT", `workDeliveryNotes/${id}`, {body: cambios});
        accion = "actualizado";
      }
    }
    // 2. Adjuntos: el PDF firmado de la versión enviada y las fotos del parte.
    const yaAdjuntos = new Set(lista(await stel("GET", "entityAttachments", {query: {"entity-id": id, "entity-type": "WORKDELIVERYNOTE", limit: 100}}))
      .map((x) => x.name));
    const fotos = new Map((c.fotos || []).map((f) => [f.id, f]));
    const adjuntar = [];
    for (const ar of ctx.archivos) {
      if (ar.tipo === "PDF_PARTE" && ar.storage_path === p.pdf_path) adjuntar.push({ar, nombre: `${p.codigo}_parte_firmado_v${p.pdf_version}.pdf`, desc: `Parte firmado v${p.pdf_version}`});
      if (ar.tipo === "FOTO" && fotos.has(ar.id)) {
        const f = fotos.get(ar.id);
        adjuntar.push({ar, nombre: `${p.codigo}_foto_${MOMENTO[f.momento] || "foto"}_${ar.id.slice(0, 8)}.jpg`, desc: (f.comentario || `Foto ${MOMENTO[f.momento] || ""}`).slice(0, 250)});
      }
    }
    let adjuntados = 0;
    for (const x of adjuntar) {
      if (yaAdjuntos.has(x.nombre)) continue;
      const bytes = await descargar(x.ar.storage_path);
      await stel("POST", "entityAttachments", {body: {"file-base64": aBase64(bytes), "file-name": x.nombre, "entity-id": id,
        "entity-type": "WORKDELIVERYNOTE", description: x.desc}});
      adjuntados++;
    }
    const final = primero(lista(await stel("GET", `workDeliveryNotes/${id}`)));
    return {stel_id: id, detalle: {referencia: final?.["full-reference"] || final?.reference || null, version, accion, adjuntos: adjuntados,
      adjuntos_total: adjuntar.length, articulos: Object.fromEntries(resueltos), ...(altas.length ? {articulos_creados: altas} : {}),
      ...(sinComprobar.length ? {precios_sin_comprobar: sinComprobar} : {})}};
  }

  /**
   * Artículo de STEL de un material del albarán del proveedor. Referencia UNA vez en STEL (igual o con el prefijo del
   * proveedor) → se usa; varias → lo elige la persona; ninguna → mismo nombre UNA vez (STEL no deja dos nombres iguales)
   * → se usa; si no, se da de alta con nombre, referencia y, si la línea cuadraba, el precio neto como compra y venta base
   * (regla del robot, usuario 2026-10-30). Reintentar no duplica: la siguiente vez lo encuentra por la referencia.
   */
  async function articuloParaMaterial(m, p, ajustes) {
    const ref = String(m.referencia).trim(), nombre = String(m.descripcion).trim().slice(0, 250);
    const porRef = lista(await stel("GET", "products", {query: {reference: ref, limit: 20}})).filter((x) => mismaReferencia(x.reference, ref));
    if (porRef.length > 1) throw new Bloqueo(`La referencia ${ref} está ${porRef.length} veces en STEL: elige el artículo en la revisión`);
    if (porRef.length === 1) return {id: idDe(porRef), creado: false};
    const porNombre = lista(await stel("GET", "products", {query: {name: nombre, limit: 20}})).filter((x) => canonRef(x.name) === canonRef(nombre));
    if (porNombre.length > 1) throw new Bloqueo(`«${nombre}» está ${porNombre.length} veces en STEL: elige el artículo en la revisión`);
    if (porNombre.length === 1) return {id: idDe(porNombre), creado: false};
    // Precios: compra = neto del albarán del proveedor (con descuentos, si la línea cuadraba); venta = ese neto más el margen
    // (usuario, 2026-11-23: 30 %). Sin neto comprobado, sin precios (nunca el PRECIO bruto del papel, que no lleva descuentos).
    const neto = Number(m.precio_neto);
    const o = typeof m.origen === "object" && m.origen ? m.origen : {};
    // La referencia es la del papel: serie MANUAL (-2), si no STEL rechaza las que llevan letras o pone la suya (E000191).
    const creado = await stel("POST", "products", {body: {name: nombre, reference: ref, "serial-number-id": -2,
      ...(neto > 0 ? {"purchase-price": neto, "sales-price": precioVenta(neto, margenDe(ajustes))} : {}),
      "private-comments": `Alta de DAFRICA SAT ${p.codigo}: albarán del proveedor ${[o.proveedor, o.numero].filter(Boolean).join(" ")}`.slice(0, 500)}});
    let id = idDe(creado);
    if (!id) id = idDe(lista(await stel("GET", "products", {query: {reference: ref, limit: 5}})).filter((x) => mismaReferencia(x.reference, ref)));
    if (!id) throw new Error(`STEL no devolvió el artículo creado (${ref}); se buscará en el siguiente intento`);
    return {id, creado: true};
  }

  /**
   * Precio de compra en STEL de los materiales que no traen el neto del papel ni precio en la revisión y ya tienen
   * artículo (los recién dados de alta sin neto no tienen precio de compra: no se piden).
   */
  async function costesDeStel(materiales, revision, resueltos = new Map(), recienCreados = new Set()) {
    const conPrecio = new Set((revision || []).filter((l) => l.material_id && l.precio !== null && l.precio !== "" && Number(l.precio) >= 0).map((l) => l.material_id));
    const porMaterial = new Map((revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => [l.material_id, l.stel_item_id]));
    const costes = new Map(), leidos = new Map();
    for (const m of materiales || []) {
      if (Number(m.precio_neto) > 0 || conPrecio.has(m.id) || recienCreados.has(m.id)) continue;
      const item = Number(m.stel_item_id || porMaterial.get(m.id) || resueltos.get(m.id));
      if (!(item > 0)) continue;
      if (!leidos.has(item)) leidos.set(item, Number(primero(lista(await stel("GET", `products/${item}`)))?.["purchase-price"]));
      if (leidos.get(item) > 0) costes.set(m.id, leidos.get(item));
    }
    return costes;
  }

  async function factura(ctx) {
    const p = ctx.parte, f = ctx.factura;
    if (!f) throw new Bloqueo("La factura no está aprobada");
    if (!p.stel_albaran_id) throw new Espera("Esperando el albarán de trabajo en STEL");
    const pago = pagoDe(ctx.ajustes);
    if (!pago) throw new Bloqueo(FALTA_PAGO);
    let doc = null, accion;
    if (f.stel_factura_id) doc = primero(lista(await stel("GET", `ordinaryInvoices/${f.stel_factura_id}`)));
    if (!doc) {
      const previas = lista(await stel("GET", "ordinaryInvoices", {query: {"parent-document-id": p.stel_albaran_id, limit: 10}}));
      if (previas.length > 1) throw new Bloqueo(`El albarán ${p.stel_albaran_ref || p.stel_albaran_id} ya tiene ${previas.length} facturas en STEL: revisar a mano`);
      doc = previas[0] || null;
      accion = doc ? "reutilizada" : null;
    }
    if (!doc) {
      const lineas = f.lineas.map((l) => ({"line-type": "ITEM", "item-id": Number(l.stel_item_id), units: Number(l.cantidad),
        "item-base-price": Number(l.precio), "discount-percentage": Number(l.descuento_pct || 0), "primary-tax-percentage": Number(l.iva_pct),
        ...(l.descripcion ? {"item-description": String(l.descripcion).slice(0, 1000)} : {})}));
      const creada = await stel("POST", "ordinaryInvoices", {body: {"account-id": Number(ctx.cliente.stel_id), "parent-document-id": Number(p.stel_albaran_id),
        ...(ctx.aviso.stel_incidencia_id ? {"parent-incident-id": Number(ctx.aviso.stel_incidencia_id)} : {}),
        title: `${p.codigo} · ${ctx.aviso.motivo}`.slice(0, 150), "private-comments": `DAFRICA SAT ${p.codigo} · factura aprobada el ${String(f.aprobado_en).slice(0, 10)}`,
        ...pago, lines: lineas}});
      const id = idDe(creada);
      if (!id) throw new Error("STEL no devolvió el id de la factura (se buscará en el siguiente intento)");
      doc = primero(lista(await stel("GET", `ordinaryInvoices/${id}`))) || {id};
      accion = "creada";
    }
    const id = idDe(doc);
    let emitida = Boolean(ctx.op.detalle?.emitida);
    if (!emitida && ctx.ajustes?.stel_emitir_factura === true) {
      await stel("POST", `issueInvoiceVerifactu/${id}`, {body: {paid: false}});
      emitida = true;
      doc = primero(lista(await stel("GET", `ordinaryInvoices/${id}`))) || doc;
    }
    // PDF: solo de una factura EMITIDA (por la API o confirmada por una persona autorizada): nunca un borrador al cliente.
    // El campo `pdf-path` existe en la API pero su contenido no está confirmado con la cuenta real.
    let pdf_path = null;
    let pdf_nota = emitida ? "STEL no da el PDF (pdf-path vacío): súbelo desde STEL" : "Pendiente de emitir en STEL";
    const ruta = emitida ? String(doc["pdf-path"] || "").trim() : "";
    if (ruta) {
      try {
        const url = /^https?:\/\//.test(ruta) ? ruta : "https://" + ruta.replace(/^\/+/, "");
        const bytes = await stel("GET", url, {crudo: true});
        if (String.fromCharCode(...bytes.subarray(0, 4)) === "%PDF") {
          const ref = String(doc["full-reference"] || doc.reference || id).replace(/[^A-Za-z0-9_-]/g, "_");
          pdf_path = `${p.id}/factura-${ref}.pdf`;
          await subir(pdf_path, bytes, "application/pdf");
          pdf_nota = null;
        } else pdf_nota = "pdf-path no devolvió un PDF";
      } catch (e) { pdf_nota = "No se pudo descargar el PDF: " + e.message; }
    }
    const total = Number(doc["total-amount"]);
    return {stel_id: id, detalle: {referencia: doc["full-reference"] || doc.reference || null, total: Number.isFinite(total) ? total : null,
      diferencia_total: Number.isFinite(total) ? Math.round((total - Number(f.total_previsto)) * 100) / 100 : null,
      emitida, accion, ...(pdf_path ? {pdf_path} : {}), ...(pdf_nota ? {pdf_nota} : {})}};
  }

  const procesadores = {CLIENTE: cliente, INCIDENCIA: incidencia, ALBARAN_TRABAJO: albaran, FACTURA: factura};

  try {
    if (cuerpo.accion === "catalogo") {
      if (parteId) return responder({error: "El catálogo no lleva parte"}, 400);
      limiteDia = Number(await rpc("sat_ajuste", {p_clave: "stel_limite_llamadas_dia"})) || limiteDia;
      hechasHoy = Number(await rpc("sat_stel_sumar_llamadas", {p_n: 0})) || 0;
      const leerTodo = async (ruta) => {
        const filas = [];
        for (let start = 0, pag = 0; pag < 40; pag++, start += 500) {
          const f = lista(await stel("GET", ruta, {query: {limit: 500, start}}));
          filas.push(...f);
          if (f.length < 500) break;
        }
        return filas;
      };
      const r = {};
      const cargar = async (tipo, filas) => {
        let n = 0;
        for (let i = 0; i < filas.length; i += 500) n += await rpc("sat_stel_catalogo_cargar", {p_tipo: tipo, p_filas: filas.slice(i, i + 500)});
        r[tipo.toLowerCase()] = n;
      };
      await cargar("CLIENTES", (await leerTodo("clients")).map((x) => ({stel_id: x.id, nombre: x.name || x["legal-name"] || `Cliente ${x.id}`,
        nif: x["tax-identification-number"] || x["identification-number"] || null, telefono: x.phone || null, email: x.email || null})));
      await cargar("DIRECCIONES", (await leerTodo("addresses")).filter((x) => x["account-id"]).map((x) => ({stel_id: x.id, cliente_stel_id: x["account-id"],
        texto: [x.name, x["address-data"], x["postal-code"], x["city-town"], x.province].filter(Boolean).join(", ") || `Dirección ${x.id}`})));
      await cargar("CONTACTOS", (await leerTodo("contacts")).filter((x) => x["account-id"]).map((x) => ({stel_id: x.id, cliente_stel_id: x["account-id"],
        nombre: x.name || `Contacto ${x.id}`, cargo: x.position || null, telefono: x.phone || null, email: x.email || null})));
      await cargar("EQUIPOS", (await leerTodo("assets")).filter((x) => x["account-id"]).map((x) => ({stel_id: x.id, cliente_stel_id: x["account-id"],
        direccion_stel_id: x["address-id"] || null, nombre: x.name || x.reference || `Equipo ${x.id}`, referencia: x["full-reference"] || x.reference || null,
        marca: x.brand || null, modelo: x.model || null, numero_serie: x["serial-number"] || x.identifier || null})));
      const articulo = (tipo) => (x) => ({stel_id: x.id, tipo, referencia: x.reference || null, nombre: x.name || x.reference || `${tipo} ${x.id}`,
        precio: Number.isFinite(Number(x["sales-price"])) ? Number(x["sales-price"]) : null,
        iva_pct: Number.isFinite(Number(x["primary-tax-percentage"])) ? Number(x["primary-tax-percentage"]) : null, activo: !x.inactive});
      await cargar("ARTICULOS", [...(await leerTodo("products")).map(articulo("PRODUCTO")), ...(await leerTodo("services")).map(articulo("SERVICIO"))]);
      await rpc("sat_stel_sumar_llamadas", {p_n: llamadas});
      return responder({ok: true, cargados: r, llamadas});
    }

    if (cuerpo.accion === "servicios") {
      // Servicios de mano de obra y desplazamiento por horas (usuario, 2026-11-20: «no he creado nada, créalo»). Solo
      // oficina (sin parte, sat_puede_procesar exige sat.administrar). Si ya existe UNO (por referencia o nombre), se usa;
      // varios: se para; ninguno: se crea al precio por hora de Ajustes con el 21 %. Después se eligen en Ajustes (con la
      // sesión del usuario: queda auditado a su nombre) y eso devuelve a la cola los albaranes parados solo por ellos.
      if (parteId) return responder({error: "Los servicios no llevan parte"}, 400);
      hechasHoy = Number(await rpc("sat_stel_sumar_llamadas", {p_n: 0})) || 0;
      const defs = [
        {clave: "stel_servicio_mano_obra_id", nombre: "MANO DE OBRA (HORA)", referencia: "MO-HORA", precio: "precio_hora_mano_obra"},
        {clave: "stel_servicio_desplazamiento_id", nombre: "DESPLAZAMIENTO (HORA)", referencia: "DESP-HORA", precio: "precio_hora_desplazamiento"}];
      const hechos = [];
      for (const d of defs) {
        const precio = Number(await rpc("sat_ajuste", {p_clave: d.precio})) || 50;
        const porRef = lista(await stel("GET", "services", {query: {reference: d.referencia, limit: 10}})).filter((x) => canonRef(x.reference) === canonRef(d.referencia));
        const porNombre = porRef.length ? [] : lista(await stel("GET", "services", {query: {name: d.nombre, limit: 10}})).filter((x) => canonRef(x.name) === canonRef(d.nombre));
        const ya = porRef.length ? porRef : porNombre;
        if (ya.length > 1) throw new ErrorStel(`Hay ${ya.length} servicios «${d.nombre}» en STEL: elige el bueno en Ajustes`);
        let fila = ya[0] || null, creado = false;
        if (!fila) {
          // Referencia propia: STEL exige la serie MANUAL (-2) si no es solo de cifras (E000191, visto el 2026-11-20).
          const r = await stel("POST", "services", {body: {name: d.nombre, reference: d.referencia, "serial-number-id": -2, "sales-price": precio, "primary-tax-percentage": 21}});
          fila = primero(lista(r)) || primero(lista(await stel("GET", "services", {query: {reference: d.referencia, limit: 5}})));
          creado = true;
        }
        const id = idDe(fila);
        if (!id) throw new Error(`STEL no devolvió el servicio «${d.nombre}»`);
        await rpc("sat_stel_catalogo_cargar", {p_tipo: "ARTICULOS", p_filas: [{stel_id: id, tipo: "SERVICIO", referencia: fila.reference || d.referencia,
          nombre: fila.name || d.nombre, precio: Number.isFinite(Number(fila["sales-price"])) ? Number(fila["sales-price"]) : precio,
          iva_pct: Number.isFinite(Number(fila["primary-tax-percentage"])) ? Number(fila["primary-tax-percentage"]) : 21, activo: !fila.inactive}]});
        await rpc("sat_ajuste_guardar", {p_clave: d.clave, p_valor: id}, {usuario: true});
        hechos.push({clave: d.clave, stel_id: id, nombre: fila.name || d.nombre, creado});
      }
      await rpc("sat_stel_sumar_llamadas", {p_n: llamadas});
      return responder({ok: true, servicios: hechos, llamadas});
    }

    if (["borrar_albaran", "precios_albaran", "precio_articulo", "pagos", "recalcular_materiales", "precios_desde_stel"].includes(cuerpo.accion)) {
      // Acciones de oficina (usuario, 2026-11-20: «quiero un solo albarán, no dos, y que actualice los precios»). Solo con
      // sat.administrar, comprobado con la sesión de la persona.
      if ((await rpc("tiene_permiso", {permiso_codigo: "sat.administrar"}, {usuario: true})) !== true) return responder({error: "Solo administración"}, 403);
      hechasHoy = Number(await rpc("sat_stel_sumar_llamadas", {p_n: 0})) || 0;
      const fin = async (datos) => { await rpc("sat_stel_sumar_llamadas", {p_n: llamadas}); return responder({ok: true, ...datos, llamadas}); };
      if (cuerpo.accion === "pagos") {
        // Forma de pago y cuenta bancaria de todos los documentos del SAT (usuario, 2026-11-23). Se busca en STEL la forma de
        // pago por su nombre («transferencia») y la cuenta por sus últimas cifras; solo si cada una es UNA se guardan en
        // Ajustes (con la sesión de la persona: queda auditado) y los documentos parados por ellas vuelven a la cola.
        const sinAcentos = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        const forma = sinAcentos(cuerpo.forma), cifras = String(cuerpo.cuenta ?? "").replace(/\D/g, "");
        if (forma.length < 3 || cifras.length < 4) return responder({error: "Escribe la forma de pago y al menos las 4 últimas cifras de la cuenta"}, 400);
        const opciones = lista(await stel("GET", "paymentOptions", {query: {limit: 100}}));
        let fp = opciones.filter((o) => sinAcentos(o.name) === forma);
        if (!fp.length) fp = opciones.filter((o) => sinAcentos(o.name).includes(forma));
        const cuentas = lista(await stel("GET", "bankAccounts", {query: {limit: 100}}));
        const cb = cuentas.filter((c) => [c.account, c.name, c.description].some((x) => String(x ?? "").replace(/\D/g, "").endsWith(cifras)));
        const final4 = (c) => "···" + String(c.account ?? "").replace(/\D/g, "").slice(-4);
        if (fp.length !== 1) { await rpc("sat_stel_sumar_llamadas", {p_n: llamadas});
          return responder({error: `${fp.length} formas de pago de STEL encajan con «${cuerpo.forma}». En STEL: ${opciones.map((o) => o.name).join(", ") || "ninguna"}`, formas: opciones.map((o) => o.name)}, 409); }
        if (cb.length !== 1) { await rpc("sat_stel_sumar_llamadas", {p_n: llamadas});
          return responder({error: `${cb.length} cuentas bancarias de STEL terminan en ${cifras}. En STEL: ${cuentas.map((c) => `${c.name || "cuenta"} ${final4(c)}`).join(", ") || "ninguna"}`, cuentas: cuentas.map((c) => `${c.name || "Cuenta"} ${final4(c)}`)}, 409); }
        const descripcion = `${fp[0].name} · ${cb[0].name || "cuenta"} ${final4(cb[0])}`;
        await rpc("sat_ajuste_guardar", {p_clave: "stel_pago_descripcion", p_valor: descripcion}, {usuario: true});
        await rpc("sat_ajuste_guardar", {p_clave: "stel_cuenta_bancaria_id", p_valor: idDe(cb)}, {usuario: true});
        await rpc("sat_ajuste_guardar", {p_clave: "stel_forma_pago_id", p_valor: idDe(fp)}, {usuario: true});
        return fin({forma_pago: {stel_id: idDe(fp), nombre: fp[0].name}, cuenta: {stel_id: idDe(cb), nombre: cb[0].name || null, final: final4(cb[0])}, descripcion,
          ...(fp[0]["linked-to-bank-account"] === false ? {aviso: "En STEL esa forma de pago no está ligada a una cuenta bancaria: STEL puede no guardar la cuenta en los documentos"} : {})});
      }
      if (cuerpo.accion === "precio_articulo") {
        // Precio de compra y de venta base de UN artículo (nunca nombre ni referencia).
        const id = Number(cuerpo.stel_id), compra = Number(cuerpo.compra), venta = Number(cuerpo.venta);
        if (!Number.isSafeInteger(id) || id <= 0 || !(compra >= 0) || !(venta >= 0)) return responder({error: "Datos no válidos"}, 400);
        const art = primero(lista(await stel("GET", `products/${id}`)));
        if (!art) return responder({error: "El artículo no existe en STEL"}, 404);
        await stel("PUT", `products/${id}`, {body: {"purchase-price": compra, "sales-price": venta}});
        await rpc("sat_stel_catalogo_cargar", {p_tipo: "ARTICULOS", p_filas: [{stel_id: id, tipo: "PRODUCTO", referencia: art.reference || null,
          nombre: art.name || String(id), precio: venta, iva_pct: Number.isFinite(Number(art["primary-tax-percentage"])) ? Number(art["primary-tax-percentage"]) : null, activo: !art.inactive}]});
        return fin({articulo: {stel_id: id, referencia: art.reference || null, compra, venta}});
      }
      if (!parteId) return responder({error: "Falta el parte"}, 400);
      const det = await rpc("sat_parte_detalle", {p_id: parteId}, {usuario: true});
      if (cuerpo.accion === "borrar_albaran") {
        // Solo un parte que la oficina ya marcó NO FACTURABLE y sin factura (duplicado, prueba…): se borra su albarán de
        // trabajo y, si el aviso no tiene otro parte, su incidencia.
        if (det.estado !== "NO_FACTURABLE") return responder({error: "Primero marca el parte como no facturable (con el motivo)"}, 409);
        if (det.factura) return responder({error: "El parte tiene factura: no se borra"}, 409);
        const borrado = {};
        if (det.stel_albaran_id) {
          const doc = primero(lista(await stel("GET", `workDeliveryNotes/${det.stel_albaran_id}`)));
          if (doc) { await stel("DELETE", `workDeliveryNotes/${det.stel_albaran_id}`); borrado.albaran = doc["full-reference"] || doc.reference || det.stel_albaran_id; }
        }
        const avisos = await rpc("sat_avisos_listar", {}, {usuario: true});
        const av = (avisos || []).find((a) => a.id === det.aviso_id);
        const inc = det.aviso?.stel_incidencia_id;
        if (inc && av && (av.partes || []).length <= 1) {
          const x = primero(lista(await stel("GET", `incidents/${inc}`)));
          if (x) { await stel("DELETE", `incidents/${inc}`); borrado.incidencia = x["full-reference"] || x.reference || inc; }
        }
        return fin({borrado});
      }
      const aj = (await rpc("sat_ajustes_leer", {}, {usuario: true})) || {};
      let revision = det.revision;
      let recalculado = null;
      if (cuerpo.accion === "precios_desde_stel") {
        // Precios corregidos a mano en el albarán de trabajo de STEL (usuario, 2026-11-23: «si existe error se modifica, o el
        // técnico o en el STEL Order»): se traen a la revisión (cantidad, precio y descuento de cada línea, emparejadas por su
        // artículo y en orden) para que la factura salga igual que el albarán. No se escribe nada en STEL.
        if (!(revision || []).length) return responder({error: "Guarda primero la revisión económica"}, 409);
        if (!det.stel_albaran_id) return responder({error: "El parte no tiene albarán de trabajo en STEL"}, 409);
        const doc = primero(lista(await stel("GET", `workDeliveryNotes/${det.stel_albaran_id}`)));
        if (!doc) return responder({error: "El albarán de trabajo ya no está en STEL"}, 404);
        const deStel = (doc.lines || []).filter((x) => Number(x["item-id"]) > 0);
        const usadas = new Set(), cambios = [];
        revision = revision.map((l) => {
          const i = deStel.findIndex((x, k) => !usadas.has(k) && Number(x["item-id"]) === Number(l.stel_item_id));
          if (i < 0) return l;
          usadas.add(i);
          const x = deStel[i], precio = Number(x["item-base-price"]), dto = Number(x["discount-percentage"] || 0), uds = Number(x.units);
          if (!Number.isFinite(precio) || precio < 0) return l;
          const cantidad = Number.isFinite(uds) && uds !== 0 ? uds : l.cantidad;
          if (precio === Number(l.precio) && dto === Number(l.descuento_pct || 0) && Number(cantidad) === Number(l.cantidad)) return l;
          cambios.push({descripcion: l.descripcion, antes: {cantidad: l.cantidad, precio: l.precio, dto: Number(l.descuento_pct || 0)}, ahora: {cantidad, precio, dto}});
          return {...l, cantidad, precio, descuento_pct: dto, coste_dudoso: false, coste_origen: "corregido en el albarán de STEL"};
        });
        if (cambios.length) await rpc("sat_revision_guardar", {p_id: parteId, p_lineas: revision, p_nota: det.revision_nota ?? null}, {usuario: true});
        return fin({albaran: doc["full-reference"] || null, cambios, sin_pareja: revision.filter((l) => l.stel_item_id).length - usadas.size});
      }
      if (cuerpo.accion === "recalcular_materiales") {
        // Materiales de la revisión a su coste NETO (con descuentos: el del albarán del proveedor o, si no, el de compra
        // en STEL) más el margen (usuario, 2026-11-23). Se guarda la revisión (con la sesión de la persona) y, si el parte ya
        // tiene albarán de trabajo, se actualizan sus líneas. Lo que no tiene coste queda como estaba y se dice.
        if (!(revision || []).length) return responder({error: "Guarda primero la revisión económica"}, 409);
        const margen = margenDe(aj);
        const mats = new Map((det.contenido?.materiales || []).map((m) => [m.id, m]));
        const sinPrecio = (revision || []).map((l) => (l.tipo === "MATERIAL" ? {...l, precio: null} : l));
        const costes = await costesDeStel([...mats.values()], sinPrecio,
          new Map((revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => [l.material_id, l.stel_item_id])));
        const sinCoste = [];
        revision = revision.map((l) => {
          if (l.tipo !== "MATERIAL" || !l.material_id || !mats.has(l.material_id)) return l;
          const c = costeDe(mats.get(l.material_id), costes);
          if (!c) { sinCoste.push(l.descripcion); return l; }
          return {...l, coste: c.coste, coste_origen: c.origen, coste_dudoso: Boolean(c.dudoso), margen_pct: margen, precio: precioVenta(c.coste, margen), descuento_pct: 0};
        });
        await rpc("sat_revision_guardar", {p_id: parteId, p_lineas: revision, p_nota: det.revision_nota ?? null}, {usuario: true});
        recalculado = {margen, materiales: revision.filter((l) => l.coste_origen).map((l) => ({descripcion: l.descripcion, coste: l.coste, origen: l.coste_origen, precio: l.precio, dudoso: Boolean(l.coste_dudoso)})),
          sin_coste: sinCoste};
        if (!det.stel_albaran_id) return fin({recalculado});
      }
      // precios_albaran: las líneas del albarán de trabajo con el precio de la revisión (o coste + margen / por hora), y
      // la forma de pago y la cuenta de Ajustes.
      if (!det.stel_albaran_id) return responder({error: "El parte no tiene albarán de trabajo en STEL"}, 409);
      const doc = primero(lista(await stel("GET", `workDeliveryNotes/${det.stel_albaran_id}`)));
      if (!doc) return responder({error: "El albarán de trabajo ya no está en STEL"}, 404);
      const pago = pagoDe(aj);
      if (!pago) return responder({error: FALTA_PAGO}, 409);
      const resueltos = new Map((revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => [l.material_id, l.stel_item_id]));
      const {lineas, faltan} = lineasAlbaran(det.contenido, revision, aj, resueltos, await costesDeStel(det.contenido?.materiales, revision, resueltos));
      if (faltan.length) return responder({error: "Falta: " + faltan.join("; "), ...(recalculado ? {recalculado} : {})}, 409);
      // PUT con «lines» sustituye TODAS las líneas por las que se mandan (especificación de STEL).
      await stel("PUT", `workDeliveryNotes/${det.stel_albaran_id}`, {body: {...pago, lines: lineas}});
      const final = primero(lista(await stel("GET", `workDeliveryNotes/${det.stel_albaran_id}`)));
      return fin({albaran: final?.["full-reference"] || null, forma_pago: final?.["payment-option-id"] ?? null, cuenta: final?.["bank-account-id"] ?? null,
        total: final?.["total-amount"] ?? null, ...(recalculado ? {recalculado} : {}),
        lineas: (final?.lines || []).map((l) => ({item: l["item-id"], unidades: l.units, precio: l["item-base-price"], dto: l["discount-percentage"] ?? 0}))});
    }

    if (cuerpo.accion !== "procesar") return responder({error: "Acción no válida"}, 400);
    hechasHoy = Number(await rpc("sat_stel_sumar_llamadas", {p_n: 0})) || 0;
    const resultado = [];
    // Hasta 3 rondas: un cliente recién creado o vinculado desbloquea su incidencia y su albarán en la misma pasada.
    for (let ronda = 0; ronda < 3; ronda++) {
    const ops = await rpc("sat_stel_tomar", {p_parte: parteId, p_max: 10});
    if (!ops?.length) break;
    let clienteResuelto = false;
    for (const ctx of ops || []) {
      limiteDia = Number(ctx.ajustes?.stel_limite_llamadas_dia) || limiteDia;
      const op = ctx.op;
      let estado = "OK", stel_id = null, detalle = {}, error = null;
      try {
        ({stel_id, detalle} = await procesadores[op.tipo](ctx));
      } catch (e) {
        if (e instanceof Espera) { estado = "PENDIENTE"; error = e.message; }
        else if (e instanceof Bloqueo) { estado = "BLOQUEADA"; error = e.message; }
        else { estado = "ERROR"; error = e.message || String(e); }
      }
      await rpc("sat_stel_terminar", {p_op: op.id, p_estado: estado, p_stel_id: stel_id, p_detalle: detalle || {}, p_error: error});
      // Lo que se acaba de hacer en esta misma pasada sirve a las siguientes operaciones (incidencia → albarán → factura).
      if (estado === "OK" && op.tipo === "ALBARAN_TRABAJO") for (const o of ops) if (o.parte?.id === op.parte_id) {
        o.parte.stel_albaran_id = stel_id; o.parte.stel_albaran_ref = detalle.referencia;
      }
      if (estado === "OK" && op.tipo === "INCIDENCIA") for (const o of ops) if (o.aviso?.id === op.aviso_id) o.aviso.stel_incidencia_id = stel_id;
      if (estado === "OK" && op.tipo === "CLIENTE") clienteResuelto = true;
      resultado.push({tipo: op.tipo, estado, stel_id, error, detalle});
    }
    if (!clienteResuelto) break;
    }
    if (llamadas) await rpc("sat_stel_sumar_llamadas", {p_n: llamadas});
    return responder({ok: true, operaciones: resultado, llamadas});
  } catch (e) {
    if (llamadas) await rpc("sat_stel_sumar_llamadas", {p_n: llamadas}).catch(() => {});
    return responder({error: e.message || String(e), llamadas}, e instanceof ErrorStel ? 502 : 500);
  }
}
