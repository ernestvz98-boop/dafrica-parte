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

/**
 * Líneas del albarán de trabajo a partir del parte (lo que hizo el técnico, sin precios: los pone administración
 * en la factura). Cada línea necesita un artículo o servicio de STEL; si falta alguno, devuelve `faltan`.
 */
export function lineasAlbaran(contenido, revision, ajustes) {
  const lineas = [], faltan = [];
  const porMaterial = new Map((revision || []).filter((l) => l.material_id && l.stel_item_id).map((l) => [l.material_id, l.stel_item_id]));
  for (const m of contenido.materiales || []) {
    const item = m.stel_item_id || porMaterial.get(m.id);
    const cantidad = Number(m.cantidad);
    if (!item) { faltan.push(`artículo de STEL para «${m.descripcion}»`); continue; }
    if (!Number.isFinite(cantidad) || cantidad === 0) { faltan.push(`cantidad de «${m.descripcion}»`); continue; }
    const desc = [m.descripcion, m.referencia ? `Ref. ${m.referencia}` : "", m.unidad ? `(${m.unidad})` : ""].filter(Boolean).join(" ");
    lineas.push({"line-type": "ITEM", "item-id": Number(item), "units": cantidad, "item-description": desc});
  }
  const servicio = (clave) => { const v = ajustes?.[clave]; return Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null; };
  if (Number(contenido.tiempo_trabajo_min) > 0) {
    const id = servicio("stel_servicio_mano_obra_id");
    if (!id) faltan.push("servicio de mano de obra de STEL (Ajustes)");
    else lineas.push({"line-type": "ITEM", "item-id": id, "units": horas(contenido.tiempo_trabajo_min),
      "item-description": `Mano de obra: ${String(horas(contenido.tiempo_trabajo_min)).replace(".", ",")} h`});
  }
  if (Number(contenido.desplazamiento_min) > 0 || Number(contenido.desplazamiento_km) > 0) {
    // En horas (usuario, 2026-11-18: «el desplazamiento y el tiempo de mano de obra en horas»); solo km: 1 desplazamiento.
    const id = servicio("stel_servicio_desplazamiento_id");
    const h = Number(contenido.desplazamiento_min) > 0 ? horas(contenido.desplazamiento_min) : null;
    const partes = [h ? `${String(h).replace(".", ",")} h` : "", Number(contenido.desplazamiento_km) > 0 ? `${contenido.desplazamiento_km} km` : ""].filter(Boolean).join(", ");
    if (!id) faltan.push("servicio de desplazamiento de STEL (Ajustes)");
    else lineas.push({"line-type": "ITEM", "item-id": id, "units": h || 1, "item-description": `Desplazamiento: ${partes}`});
  }
  if (!lineas.length && !faltan.length) faltan.push("al menos un material, tiempo de trabajo o desplazamiento");
  return {lineas, faltan};
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

  // Supabase: como el usuario (para comprobar permisos) o con la clave de servicio.
  const rpc = async (fn, args, {usuario = false} = {}) => {
    const r = await fetcher(`${base}/rest/v1/rpc/${fn}`, {method: "POST", signal: AbortSignal.timeout(20000),
      headers: {apikey: env("SUPABASE_ANON_KEY") || servicio, Authorization: "Bearer " + (usuario ? token : servicio), "Content-Type": "application/json"},
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
    const {lineas, faltan} = lineasAlbaran(c, p.revision, ctx.ajustes);
    if (faltan.length) throw new Bloqueo("Falta: " + faltan.join("; "));
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
      "private-comments": `DAFRICA SAT ${p.codigo} · parte v${version} firmado · técnico: ${ctx.tecnico_nombre || ""}`.slice(0, 1000),
      ...(c.direccion?.stel_id ? {"work-address-id": Number(c.direccion.stel_id)} : {}),
      ...(c.equipo?.stel_id ? {assets: [{id: Number(c.equipo.stel_id)}]} : {}),
      ...(Number(ctx.ajustes?.stel_serie_albaran_trabajo_id) > 0 ? {"serial-number-id": Number(ctx.ajustes.stel_serie_albaran_trabajo_id)} : {}),
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
      adjuntos_total: adjuntar.length}};
  }

  async function factura(ctx) {
    const p = ctx.parte, f = ctx.factura;
    if (!f) throw new Bloqueo("La factura no está aprobada");
    if (!p.stel_albaran_id) throw new Espera("Esperando el albarán de trabajo en STEL");
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
        lines: lineas}});
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
