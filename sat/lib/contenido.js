// DAFRICA SAT · contenido del parte (lo que se firma) y comprobaciones antes de firmar.
// El contenido NO lleva importes: firmar la intervención no supone aceptar precios.

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

export function minutosEntre(inicio, fin) {
  const m = (h) => { const x = /^(\d{2}):(\d{2})$/.exec(h || ""); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(inicio), b = m(fin);
  if (a === null || b === null) return null;
  return b >= a ? b - a : b + 1440 - a;
}

/** Lo que falta o es dudoso antes de presentar el parte a la firma. */
export function problemasParaFirmar(c) {
  const p = [];
  if (!c.tipo_visita) p.push("Indica el tipo de visita (diagnóstico, reparación finalizada o pendiente).");
  if (c.tipo_visita === "PENDIENTE" && !c.pendiente_de) p.push("Indica de qué queda pendiente (presupuesto, repuestos o segunda visita).");
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

/** Texto plano del contenido para la pantalla de firma y el PDF (sin importes). */
export function resumenTipo(c) {
  return (TIPOS_VISITA[c.tipo_visita] || "Sin indicar") + (c.tipo_visita === "PENDIENTE" && c.pendiente_de ? " " + PENDIENTE_DE[c.pendiente_de] : "");
}
