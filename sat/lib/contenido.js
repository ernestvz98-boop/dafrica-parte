// DAFRICA SAT · contenido del parte (lo que se firma) y comprobaciones antes de firmar.
// El contenido NO lleva importes: firmar la intervención no supone aceptar precios.
import {camposDePrecio} from "./materiales-albaran.js";

export const TIPOS_VISITA = {
  DIAGNOSTICO: "Visita de diagnóstico",
  REPARACION_FINALIZADA: "Reparación finalizada",
  PENDIENTE: "Pendiente",
};
export const PENDIENTE_DE = {PRESUPUESTO: "de presupuesto", REPUESTOS: "de repuestos", SEGUNDA_VISITA: "de segunda visita"};
export const RESULTADOS = {CORRECTO: "Correcto", INCORRECTO: "Incorrecto", NO_APLICA: "No aplica"};
export const MOMENTOS = {ANTES: "Antes", DURANTE: "Durante", DESPUES: "Después", MATERIAL: "Albarán del proveedor"};
export const PRIORIDADES = {URGENTE: "Urgente", ALTA: "Alta", NORMAL: "Normal", BAJA: "Baja"};

export function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ahoraHora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function nuevoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Contenido inicial a partir del aviso. */
export function contenidoNuevo(aviso, catalogo = {}) {
  const buscar = (lista, id) => (lista || []).find((x) => x.id === id) || null;
  const cli = buscar(catalogo.clientes, aviso.cliente_id);
  const dir = buscar(catalogo.direcciones, aviso.direccion_id);
  const con = buscar(catalogo.contactos, aviso.contacto_id);
  const eq = buscar(catalogo.equipos, aviso.equipo_id);
  return {
    tipo_visita: null, pendiente_de: null,
    cliente: {id: aviso.cliente_id || null, stel_id: cli?.stel_id ?? null, nombre: cli?.nombre || aviso.cliente_texto || ""},
    direccion: {id: aviso.direccion_id || null, stel_id: dir?.stel_id ?? null, texto: dir?.texto || aviso.direccion_texto || ""},
    contacto: {id: aviso.contacto_id || null, nombre: con?.nombre || aviso.contacto_texto || "", telefono: con?.telefono || ""},
    equipo: {id: aviso.equipo_id || null, stel_id: eq?.stel_id ?? null, nombre: eq ? [eq.nombre, eq.marca, eq.modelo].filter(Boolean).join(" · ") : (aviso.equipo_texto || ""),
      numero_serie: eq?.numero_serie || ""},
    motivo: aviso.motivo || "", prioridad: aviso.prioridad || "NORMAL",
    fecha: hoy(), hora_inicio: ahoraHora(), hora_fin: "",
    comprobaciones: [], averia: "", trabajos: "", materiales: [],
    tiempo_trabajo_min: null, desplazamiento_min: null, desplazamiento_km: null,
    estado_final: "", pendientes: "", fotos: [],
  };
}

/** Forma estable del contenido (sin campos vacíos de más ni espacios sobrantes) para guardar y comparar. */
export function normalizar(c) {
  const limpio = (v) => {
    if (Array.isArray(v)) return v.map(limpio);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = limpio(v[k]);
      return o;
    }
    if (typeof v === "string") return v.trim();
    return v;
  };
  return limpio(JSON.parse(JSON.stringify(c)));
}
export function canonico(v) {
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export function iguales(a, b) { return canonico(normalizar(a)) === canonico(normalizar(b)); }

/** Minutos → «1,5 h» (el técnico y la oficina trabajan en horas; usuario, 2026-11-18). */
export function horasTexto(min) {
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${String(Math.round(n / 60 * 100) / 100).replace(".", ",")} h`;
}
/** «1,5» / «1.5» / «1 h» → minutos (null si no es un número de horas válido). */
export function minutosDeHoras(texto) {
  const v = Number(String(texto ?? "").replace(",", ".").replace(/\s*h(oras?)?\s*$/i, "").trim());
  return Number.isFinite(v) && v >= 0 && v <= 24 ? Math.round(v * 60) : null;
}

export function minutosEntre(inicio, fin) {
  const m = (h) => { const x = /^(\d{2}):(\d{2})$/.exec(h || ""); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(inicio), b = m(fin);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + 1440 - a;
}

/**
 * Lo que falta o es dudoso antes de presentar el parte a la firma.
 * Parte rápido (`modo: "RAPIDO"`, usuario 2026-11-18): el técnico solo graba, hace fotos y firma. Lo dictado con dudas
 * (una referencia dictada) no impide firmar: va marcado «a confirmar por la oficina». Del albarán del proveedor solo entra
 * lo leído sin dudas (contenidoRapido); lo demás lo revisa la oficina con la foto. Nunca se inventan cantidades.
 */
export function problemasParaFirmar(c) {
  const p = [];
  const rapido = c.modo === "RAPIDO";
  if (!c.tipo_visita) p.push(rapido ? "Indica si queda terminado o pendiente." : "Indica el tipo de visita (diagnóstico, reparación finalizada o pendiente).");
  if (c.tipo_visita === "PENDIENTE" && !c.pendiente_de) p.push("Indica de qué queda pendiente (presupuesto, repuestos o segunda visita).");
  if (rapido) {
    if (!c.cliente?.nombre) p.push("Falta el cliente.");
    if (!c.direccion?.texto) p.push("Falta la dirección de la intervención.");
    if (!c.fecha || !c.hora_inicio || !c.hora_fin) p.push("Faltan la fecha o las horas.");
    if (!c.averia && !c.trabajos) p.push("Graba el audio contando lo que has hecho (o escríbelo).");
    if (!(Number(c.tiempo_trabajo_min) > 0)) p.push("Indica las horas de trabajo.");
    if (c.desplazamiento_min === null || c.desplazamiento_min === undefined) p.push("Indica las horas de desplazamiento (o «sin desplazamiento»).");
    (c.materiales || []).forEach((m) => {
      if (!m.descripcion || !(Number(m.cantidad) > 0)) p.push(`Material «${m.descripcion || "?"}»: sin descripción o cantidad.`);
    });
    return p;
  }
  if (!c.cliente?.nombre) p.push("Falta el cliente.");
  if (!c.direccion?.texto) p.push("Falta la dirección de la intervención.");
  if (!c.fecha || !c.hora_inicio || !c.hora_fin) p.push("Faltan la fecha, la hora de inicio o la de finalización.");
  if (!c.averia && !c.trabajos && !(c.comprobaciones || []).length) p.push("Describe al menos la avería, las comprobaciones o los trabajos.");
  (c.comprobaciones || []).forEach((x, i) => { if (!x.resultado) p.push(`Comprobación ${i + 1}: indica el resultado.`); });
  (c.materiales || []).forEach((m) => {
    if (!m.descripcion) p.push("Hay un material sin descripción.");
    if (m.cantidad === null || m.cantidad === undefined || m.cantidad === "" || !Number.isFinite(Number(m.cantidad)) || Number(m.cantidad) <= 0)
      p.push(`Material «${m.descripcion || "?"}»: falta la cantidad.`);
    if ((m.dudas || []).length) p.push(`Material «${m.descripcion || "?"}»: confirma lo dudoso (${m.dudas.join("; ")}).`);
  });
  if (c.tipo_visita === "PENDIENTE" && !c.pendientes) p.push("Describe los trabajos pendientes.");
  return p;
}

/**
 * Contenido del parte rápido a partir de lo que hizo el técnico: el texto de sus audios ordenado (sin inventar: cada frase
 * entera en su sección; lo que no encaja va a «Trabajos realizados», nunca se pierde), los materiales con cantidad dicha o
 * leída en el albarán del proveedor (lo dudoso marcado), y las horas.
 * @param {object} c contenido actual (se devuelve uno nuevo)
 * @param {{textos:string[], organizar:(t:string)=>object, materialesAlbaran:object[], horaFin:string, nuevoId:()=>string}} d
 */
export function contenidoRapido(c, {textos, organizar, materialesAlbaran = [], horaFin, nuevoId: id = nuevoId}) {
  const texto = (textos || []).map((t) => String(t || "").trim()).filter(Boolean).join("\n");
  const r = texto ? organizar(texto) : {averia: [], comprobaciones: [], trabajos: [], materiales: [], pendientes: [], otros: []};
  const unir = (xs) => xs.filter(Boolean).join("\n");
  const n = structuredClone(c);
  n.modo = "RAPIDO";
  n.averia = unir(r.averia);
  n.comprobaciones = [];
  n.trabajos = unir([...r.comprobaciones.map((x) => x.texto), ...r.trabajos, ...r.otros]);
  n.pendientes = unir(r.pendientes);
  if (r.pendientes.length && !n.tipo_visita) n.tipo_visita = "PENDIENTE";
  // Id estable (el mismo dictado da el mismo parte: preparar dos veces no invalida firmas ni descoloca la revisión).
  const dictados = r.materiales.filter((m) => Number(m.cantidad) > 0).map((m, i) => ({id: `dictado-${i + 1}`, descripcion: m.descripcion, referencia: m.referencia || "",
    cantidad: m.cantidad, unidad: m.unidad, stel_item_id: null, dudas: m.dudas || [], dicho: m.dicho, origen: "DICTADO"}));
  // Del albarán del proveedor entra en lo firmado lo leído SIN dudas y lo que el técnico ha comparado con el papel
  // («Coinciden con el papel» o «Corregir»); lo demás lo revisa la oficina con la foto (con fotos torcidas el lector puede
  // emparejar mal filas con confianza alta: nada así se firma sin que una persona lo compare).
  const leidos = materialesAlbaran.filter((m) => Number(m.cantidad) > 0 && m.descripcion && (!(m.dudas || []).length || m.confirmado)).map((m) => ({id: m.id || id(), descripcion: m.descripcion,
    referencia: m.referencia || "", cantidad: m.cantidad, unidad: m.unidad || "ud", stel_item_id: m.stel_item_id ?? null, dudas: m.confirmado ? [] : (m.dudas || []),
    ...(m.confirmado ? {comprobado: "TECNICO"} : {}),
    ...camposDePrecio(m),
    ...(m.dicho ? {dicho: m.dicho} : {}), origen: m.origen || "ALBARAN_PROVEEDOR"}));
  n.materiales = [...leidos, ...dictados];
  if (horaFin) n.hora_fin = horaFin; // hora a la que se presenta a la firma
  // Horas de trabajo y de desplazamiento: las que elige el técnico (no se calculan solas).
  return n;
}

/** Texto plano del contenido para la pantalla de firma y el PDF (sin importes). */
export function resumenTipo(c) {
  return (TIPOS_VISITA[c.tipo_visita] || "Sin indicar") + (c.tipo_visita === "PENDIENTE" && c.pendiente_de ? " " + PENDIENTE_DE[c.pendiente_de] : "");
}
