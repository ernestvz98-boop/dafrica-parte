// DAFRICA SAT · materiales del parte a partir del albarán o ticket del PROVEEDOR leído por el lector de albaranes.
// Reglas (las del lector): nunca se inventa; un campo con confianza < 0,9 se marca para que el técnico lo compare con
// el papel; el artículo de STEL solo se asigna si la referencia coincide con UN solo artículo del catálogo.
// Los precios del papel no pasan al parte (el técnico no firma importes); quedan como dato para la oficina.

export const UMBRAL = 0.9;
const UNIDADES = [
  [/^(ud|uds|u|un|und|unid|unidad(es)?|pza|pz|pieza(s)?)\.?$/i, "ud"], [/^(m|ml|mts?|metros?)\.?$/i, "m"], [/^(cm)\.?$/i, "cm"],
  [/^(mm)\.?$/i, "mm"], [/^(l|lt|lts|litros?)\.?$/i, "l"], [/^(kg|kgs|kilos?)\.?$/i, "kg"], [/^(g|gr|grs)\.?$/i, "g"],
  [/^(rollo|rol)s?\.?$/i, "rollo"], [/^(caja|cj|cja)s?\.?$/i, "caja"], [/^(saco|sac)s?\.?$/i, "saco"], [/^(bote)s?\.?$/i, "bote"],
  [/^(par)(es)?\.?$/i, "par"], [/^(h|hr|hora)s?\.?$/i, "h"],
];
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[\s.\-_/]+/g, "");

export function unidadDe(texto) {
  const t = String(texto ?? "").trim();
  for (const [re, u] of UNIDADES) if (re.test(t)) return u;
  return null;
}

/**
 * Artículo de STEL con esa referencia: igual, o con el prefijo del proveedor («H8953025 - 1601091045»). Solo si es UNO.
 * @returns {{articulo: object|null, motivo: string}}
 */
export function articuloPorReferencia(referencia, articulos) {
  const r = norm(referencia);
  if (r.length < 3) return {articulo: null, motivo: "sin referencia"};
  const iguales = (articulos || []).filter((a) => {
    const ref = String(a.referencia || "");
    if (norm(ref) === r) return true;
    const partes = ref.split(/\s+-\s+/);
    return partes.length > 1 && norm(partes.at(-1)) === r;
  });
  if (iguales.length === 1) return {articulo: iguales[0], motivo: "referencia única en el catálogo de STEL"};
  return {articulo: null, motivo: iguales.length ? `${iguales.length} artículos de STEL con esa referencia: elige tú` : "no está en el catálogo de STEL"};
}

/**
 * Propuesta de materiales a partir del resultado del lector (`extraerEscaneado`).
 * @returns {{proveedor, numero, fecha, materiales: object[], avisos: string[], confianza}}
 */
export function materialesDesdeAlbaran(resultado, {articulos = [], fotoId = null} = {}) {
  const avisos = [];
  const valor = (c) => (c && c.valor !== undefined && c.valor !== null && c.valor !== "" ? c.valor : null);
  const fiable = (c) => typeof c?.confianza === "number" && c.confianza >= UMBRAL;
  const proveedor = typeof resultado?.proveedor?.nombre === "string" ? resultado.proveedor.nombre : null;
  const numero = valor(resultado?.numero), fecha = valor(resultado?.fecha);
  const materiales = [];
  for (const [i, l] of (resultado?.lineas || []).entries()) {
    const descripcion = valor(l.descripcion), referencia = valor(l.referencia);
    if (!descripcion && !referencia) continue;
    const cantidadLeida = valor(l.cantidad);
    const cantidad = cantidadLeida !== null && Number.isFinite(Number(cantidadLeida)) ? Number(cantidadLeida) : null;
    const dudas = [];
    if (!descripcion) dudas.push("No se leyó la descripción: escríbela");
    else if (!fiable(l.descripcion)) dudas.push("Descripción leída con dudas: compárala con el papel");
    if (referencia && !fiable(l.referencia)) dudas.push("Referencia leída con dudas: compárala letra a letra");
    if (cantidad === null) dudas.push("No se leyó la cantidad: escríbela");
    else if (!fiable(l.cantidad)) dudas.push("Cantidad leída con dudas: compárala con el papel");
    const unidadLeida = valor(l.unidad);
    let unidad = unidadDe(unidadLeida) || "ud";
    if (unidadLeida && !unidadDe(unidadLeida)) dudas.push(`Unidad del papel «${unidadLeida}»: comprueba la unidad`);
    // «ML TUBO COBRE 15»: el papel dice metros lineales en la descripción (sin columna de unidad).
    if (!unidadLeida && /^M\.?L\.?\s/i.test(String(descripcion || ""))) { unidad = "m"; dudas.push("Unidad «ML» (metro lineal) de la descripción: comprueba que son metros"); }
    // Solo con una referencia fiable se busca el artículo de STEL (una cifra mal leída daría otro artículo).
    const enStel = referencia && fiable(l.referencia) ? articuloPorReferencia(referencia, articulos) : {articulo: null, motivo: "referencia sin confirmar"};
    materiales.push({
      descripcion: String(descripcion || "").trim(), referencia: referencia ? String(referencia).trim() : "",
      cantidad, unidad, stel_item_id: enStel.articulo ? enStel.articulo.stel_id : null, articulo_stel: enStel.articulo?.nombre || null,
      motivo_articulo: enStel.motivo, dudas, fiable: dudas.length === 0,
      origen: {tipo: "ALBARAN_PROVEEDOR", foto_id: fotoId, proveedor, numero, fecha, linea: i + 1},
      dicho: `Albarán ${[proveedor, numero].filter(Boolean).join(" ") || "del proveedor"}, línea ${i + 1}`,
    });
  }
  if (!materiales.length) avisos.push("No se han podido leer líneas en la foto. Repite la foto (el papel entero, recto y con luz) o escribe los materiales.");
  if (materiales.some((m) => !m.fiable)) avisos.push("Hay datos leídos con dudas (en ámbar): compáralos con el papel antes de añadirlos.");
  return {proveedor, numero, fecha, materiales, avisos, confianza: resultado?.confianza ?? null};
}
