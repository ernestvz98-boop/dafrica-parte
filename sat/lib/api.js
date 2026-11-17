// DAFRICA SAT · acceso a Supabase (funciones sat_*, almacén privado, función Edge sat-stel) con la sesión del usuario.
import {CONFIG} from "./config.js";

export class SinConexion extends Error {}
export class ErrorApi extends Error {
  constructor(mensaje, estado, codigo, original) { super(mensaje); this.estado = estado; this.codigo = codigo; this.original = original; }
}

const MENSAJES = [
  [/sin_permiso/, "No tienes permiso para esta acción."],
  [/sin_sesion|JWT|invalid_grant/i, "La sesión ha caducado: vuelve a entrar."],
  [/aviso_de_otro_tecnico|parte_de_otro_tecnico/, "Este aviso o parte es de otro técnico."],
  [/aviso_cerrado/, "El aviso ya está cerrado o anulado."],
  [/parte_no_editable/, "El parte ya se envió y no se puede cambiar (administración puede pedir información para corregirlo)."],
  [/parte_no_firmable/, "El parte ya se envió: no se puede firmar de nuevo."],
  [/parte_sin_firmas/, "Faltan las firmas válidas del técnico y del responsable (o el motivo de su ausencia)."],
  [/pdf_no_subido/, "El PDF firmado todavía no se ha subido."],
  [/falta_firma_o_motivo/, "Falta la firma del responsable o el motivo por el que no firma."],
  [/falta_nombre_firmante/, "Falta el nombre de quien firma."],
  [/falta_tipo_visita/, "Indica el tipo de visita."],
  [/falta_motivo_pendiente/, "Indica de qué queda pendiente."],
  [/faltan_fecha_horas/, "Faltan la fecha o las horas."],
  [/linea_incompleta: (.*)/, (m) => `Línea incompleta (${m[1]}): falta artículo de STEL, cantidad, precio o IVA.`],
  [/sin_lineas_economicas/, "Añade las líneas económicas antes de decidir facturar."],
  [/total_distinto: (.*)/, (m) => `El total ha cambiado (${m[1]} €): vuelve a revisarlo antes de aprobar.`],
  [/ya_facturado/, "Este parte ya tiene una factura aprobada."],
  [/parte_no_pendiente_de_aprobacion/, "El parte no está pendiente de aprobación."],
  [/falta_nota/, "Escribe una nota que lo explique."],
  [/falta_confirmacion/, "Confirma la aprobación."],
  [/factura_sin_pdf/, "La factura todavía no tiene PDF."],
  [/operacion_no_reintentable/, "Esa operación está en curso: espera a que termine."],
  [/factura_no_creada_en_stel/, "La factura todavía no está creada en STEL."],
  [/cliente_stel_no_cargado/, "Ese cliente de STEL no está en el catálogo: actualiza el catálogo."],
];
export function traducir(texto) {
  for (const [re, m] of MENSAJES) { const x = String(texto || "").match(re); if (x) return typeof m === "function" ? m(x) : m; }
  return String(texto || "Error desconocido");
}

let sesion = leerSesion();
function leerSesion() { try { return JSON.parse(localStorage.getItem(CONFIG.sesionClave) || "null"); } catch { return null; } }
function guardarSesion(s) { sesion = s; try { localStorage.setItem(CONFIG.sesionClave, JSON.stringify(s)); } catch { /* sin almacenamiento */ } }
export function haySesion() { return Boolean(sesion?.access_token); }
export function salir() { sesion = null; try { localStorage.removeItem(CONFIG.sesionClave); } catch { /* nada */ } }

export async function entrar(email, password) {
  let r;
  try {
    r = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {method: "POST",
      headers: {apikey: CONFIG.supabaseKey, "Content-Type": "application/json"}, body: JSON.stringify({email, password})});
  } catch { throw new SinConexion("Sin conexión"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi("Correo o contraseña incorrectos.", r.status, d.error);
  guardarSesion({access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000});
}

let refrescando = null;
async function refrescar() {
  if (!sesion?.refresh_token) throw new ErrorApi("La sesión ha caducado: vuelve a entrar.", 401, "sin_sesion");
  refrescando ??= (async () => {
    let r;
    try {
      r = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {method: "POST",
        headers: {apikey: CONFIG.supabaseKey, "Content-Type": "application/json"}, body: JSON.stringify({refresh_token: sesion.refresh_token})});
    } catch { throw new SinConexion("Sin conexión"); }
    if (!r.ok) { salir(); throw new ErrorApi("La sesión ha caducado: vuelve a entrar.", 401, "sin_sesion"); }
    const d = await r.json();
    guardarSesion({access_token: d.access_token, refresh_token: d.refresh_token || sesion.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000});
  })().finally(() => { refrescando = null; });
  return refrescando;
}
async function token() {
  // Si se ha entrado de nuevo en otra pestaña (o en DAFRICA Control), se usa esa sesión.
  const enDisco = leerSesion();
  if (enDisco?.access_token && enDisco.access_token !== sesion?.access_token) sesion = enDisco;
  if (!sesion?.access_token) throw new ErrorApi("La sesión ha caducado: vuelve a entrar.", 401, "sin_sesion");
  if ((sesion.expires_at || 0) < Date.now() + 60000) await refrescar();
  return sesion.access_token;
}

async function pedir(ruta, opciones = {}, reintentar = true) {
  let r;
  const cab = {apikey: CONFIG.supabaseKey, Authorization: "Bearer " + await token(), ...(opciones.headers || {})};
  try { r = await fetch(ruta.startsWith("http") ? ruta : CONFIG.supabaseUrl + ruta, {...opciones, headers: cab}); }
  catch { throw new SinConexion("Sin conexión"); }
  if (r.status === 401 && reintentar) { await refrescar(); return pedir(ruta, opciones, false); }
  return r;
}
async function respuesta(r) {
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch { d = {message: t}; }
  if (!r.ok) {
    const msg = d?.message || d?.error || d?.mensaje || `Error ${r.status}`;
    throw new ErrorApi(traducir(msg), r.status, d?.code || d?.statusCode, msg);
  }
  return d;
}

export async function rpc(fn, args = {}) {
  return respuesta(await pedir(`/rest/v1/rpc/${fn}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(args)}));
}

const rutaAlmacen = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");
/** Sube un archivo al almacén privado. Si ya existe (reintento), cuenta como subido. */
export async function subirArchivo(ruta, blob, tipo) {
  const r = await pedir(`/storage/v1/object/sat-archivos/${rutaAlmacen(ruta)}`, {method: "POST",
    headers: {"Content-Type": tipo || blob.type || "application/octet-stream", "x-upsert": "false", "cache-control": "3600"}, body: blob});
  if (r.ok) return "subido";
  const t = await r.text();
  if (r.status === 409 || /"statusCode"\s*:\s*"409"|Duplicate|already exists/i.test(t)) return "ya_existia";
  throw new ErrorApi(r.status === 403 || /security policy/i.test(t) ? "No tienes permiso para subir archivos a este parte." : `No se pudo subir el archivo (${r.status}).`, r.status, "almacen", t);
}
export async function urlFirmada(ruta, segundos = 900) {
  const d = await respuesta(await pedir(`/storage/v1/object/sign/sat-archivos/${rutaAlmacen(ruta)}`, {method: "POST",
    headers: {"Content-Type": "application/json"}, body: JSON.stringify({expiresIn: segundos})}));
  return `${CONFIG.supabaseUrl}/storage/v1${d.signedURL || d.signedUrl}`;
}
export async function descargar(ruta) {
  let r;
  try { r = await fetch(await urlFirmada(ruta, 120)); } catch (e) { if (e instanceof ErrorApi) throw e; throw new SinConexion("Sin conexión"); }
  if (!r.ok) throw new ErrorApi(`No se pudo descargar (${r.status}).`, r.status);
  return r.blob();
}
export async function funcion(nombre, cuerpo) {
  return respuesta(await pedir(`/functions/v1/${nombre}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(cuerpo)}));
}
/** Transcripción del audio con el servicio configurado (sat_ajustes.transcripcion_url). */
export async function transcribir(url, blob, nombre) {
  const fd = new FormData();
  fd.append("audio", blob, nombre);
  const r = await pedir(url, {method: "POST", body: fd});
  const d = await respuesta(r);
  if (typeof d?.texto !== "string") throw new ErrorApi("El servicio de transcripción no devolvió texto.", 502);
  return d.texto;
}
