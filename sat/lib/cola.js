// DAFRICA SAT · cola de envío. Todo lo que el técnico hace se guarda primero en el teléfono y se sube en orden
// cuando hay conexión. Cada tarea es idempotente (ids generados en el teléfono): repetirla nunca duplica nada.
import {cola, partes, archivos} from "./almacen.js";
import {rpc, subirArchivo, funcion, SinConexion, ErrorApi} from "./api.js";

const oyentes = new Set();
let enMarcha = false, otraVez = false, sinConexion = !navigator.onLine, ultimoError = null;

export function alCambiar(fn) { oyentes.add(fn); fn(estadoActual); return () => oyentes.delete(fn); }
let estadoActual = {pendientes: 0, errores: [], sinConexion, enMarcha: false};
async function avisar() {
  const t = await cola.todas();
  estadoActual = {pendientes: t.length, errores: t.filter((x) => x.error), sinConexion, enMarcha, tareas: t, ultimoError};
  for (const fn of oyentes) try { fn(estadoActual); } catch { /* nada */ }
}

const TAREAS = {
  async ALTA({tipo, datos}) { await rpc("sat_alta_provisional", {p_tipo: tipo, p_datos: datos}); },
  async AVISO({aviso}) { await rpc("sat_aviso_guardar", {p: aviso}); },
  async GUARDAR({parte_id}) {
    const p = await partes.get(parte_id);
    if (!p) return;
    const r = await rpc("sat_parte_guardar", {p_parte: {id: p.id, aviso_id: p.aviso_id, contenido: p.contenido}});
    await partes.modificar(parte_id, (q) => { Object.assign(q, {codigo: r.codigo, estadoServidor: r.estado, versionServidor: r.version, decisionNota: r.decision_nota}); });
    window.dispatchEvent(new CustomEvent("sat:codigo", {detail: {id: parte_id, codigo: r.codigo}}));
  },
  async ARCHIVO({archivo_id}) {
    const a = await archivos.get(archivo_id);
    if (!a) return;
    if (!a.subido) { await subirArchivo(a.ruta, a.blob, a.mime); await archivos.put({...a, subido: true}); }
    await rpc("sat_archivo_registrar", {p: {id: a.id, parte_id: a.parte_id, tipo: a.tipo, momento: a.momento || null, comentario: a.comentario || null,
      storage_path: a.ruta, mime_type: a.mime, bytes: a.blob?.size ?? null, sha256: a.sha256, ...(a.transcripcion !== undefined ? {transcripcion: a.transcripcion} : {})}});
    const b = await archivos.get(archivo_id);
    await archivos.put({...b, registrado: true});
  },
  async FIRMA({parte_id, firma_id}) {
    const p = await partes.get(parte_id);
    const f = p?.firmas?.find((x) => x.id === firma_id);
    if (!f) return;
    const img = f.imagen_archivo_id ? await archivos.get(f.imagen_archivo_id) : null;
    const r = await rpc("sat_firma_registrar", {p: {id: f.id, parte_id, rol: f.rol, nombre: f.nombre || null, cargo: f.cargo || null,
      imagen_path: img?.ruta || null, ausente_motivo: f.ausente_motivo || null, texto_alcance: f.texto_alcance, firmado_en: f.firmado_en,
      contenido: f.contenido, dispositivo: navigator.userAgent.slice(0, 180)}});
    await partes.modificar(parte_id, (q) => {
      q.estadoServidor = r.estado_parte;
      q.firmas = q.firmas.map((x) => x.id === firma_id ? {...x, servidor: {valida: r.valida, motivo: r.invalidada_motivo}} : x);
    });
  },
  async DESCARTAR({parte_id}) { await rpc("sat_parte_descartar", {p_id: parte_id}); },
  async ENVIAR({parte_id, pdf_path, sha}) {
    const r = await rpc("sat_parte_enviar", {p_id: parte_id, p_pdf_path: pdf_path, p_pdf_sha256: sha});
    await partes.modificar(parte_id, (q) => { q.estadoServidor = r.estado; q.codigo = r.codigo; });
    // Sincronización con STEL: si falla, administración lo ve y lo reintenta; el parte ya está enviado.
    try { await funcion("sat-stel", {accion: "procesar", parte_id}); } catch { /* lo reintenta administración */ }
  },
};

/** Procesa la cola en orden. Se para al perder la conexión; un error de datos se queda marcado para verlo. */
export async function procesar() {
  if (enMarcha) { otraVez = true; return; }
  enMarcha = true; await avisar();
  let repetir = false;
  try {
    const lista = (await cola.todas()).sort((a, b) => a.n - b.n);
    for (const t of lista) {
      if (t.error && t.intentos >= 3) continue;
      try {
        await TAREAS[t.tipo](t.datos);
        // Si mientras subía hubo un cambio nuevo (rev distinto), se repite; si no, se quita.
        const ahora = await cola.get(t.n);
        if (!ahora || (ahora.rev || 0) === (t.rev || 0)) await cola.quitar(t.n);
        else repetir = true;
        sinConexion = false;
      } catch (e) {
        if (e instanceof SinConexion) { sinConexion = true; break; }
        // Sesión caducada: nada se marca como error; se sube al volver a entrar.
        if (e instanceof ErrorApi && e.estado === 401) { ultimoError = e.message; break; }
        const temporal = !(e instanceof ErrorApi) || e.estado >= 500 || e.estado === 429;
        await cola.actualizar({...t, intentos: t.intentos + 1, error: e.message || String(e)});
        ultimoError = e.message;
        if (temporal) break; // el servidor no responde bien: se reintentará después
      }
      await avisar();
    }
  } finally {
    enMarcha = false; await avisar();
  }
  // Tareas añadidas o cambiadas durante esta pasada: otra pasada enseguida (si hay conexión).
  if ((repetir || otraVez) && !sinConexion) { otraVez = false; setTimeout(procesar, 300); }
}
export async function poner(tipo, clave, datos) {
  await cola.poner({tipo, clave, datos});
  await avisar();
  procesar();
}
export async function reintentarTodo() {
  for (const t of await cola.todas()) if (t.error) await cola.actualizar({...t, intentos: 0, error: null});
  await procesar();
}
export async function descartar(n) { await cola.quitar(n); await avisar(); }

/**
 * Descarta un parte SIN ENVIAR (usuario, 2026-11-23: partes duplicados): se quita del teléfono con sus fotos, audios y firmas,
 * se quitan sus tareas pendientes de subir (para que no se vuelva a crear) y se pide al servidor que lo borre. Si su aviso se
 * creó en este teléfono, no ha subido aún y no tiene otro parte, tampoco se sube (`quitarAviso`).
 */
export async function descartarParte(parteId, {avisoId = null, quitarAviso = false} = {}) {
  const suyos = await archivos.deParte(parteId);
  const ids = new Set(suyos.map((a) => a.id));
  for (const t of await cola.todas()) {
    const d = t.datos || {};
    if (d.parte_id === parteId || (t.tipo === "ARCHIVO" && ids.has(d.archivo_id)) || (quitarAviso && t.tipo === "AVISO" && d.aviso?.id === avisoId)) await cola.quitar(t.n);
  }
  for (const a of suyos) await archivos.borrar(a.id);
  await partes.borrar(parteId);
  await poner("DESCARTAR", "descartar:" + parteId, {parte_id: parteId});
}
export function arrancar() {
  window.addEventListener("online", () => { sinConexion = false; procesar(); });
  window.addEventListener("offline", () => { sinConexion = true; avisar(); });
  setInterval(() => { procesar(); }, 20000);
  procesar();
}
