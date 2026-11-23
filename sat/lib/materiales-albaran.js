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
 * Precios de una línea del albarán del proveedor (usuario, 2026-11-20: «solo le faltó poner el precio que reflejaba en el
 * albarán»). Nunca se estima nada:
 *  - precio_papel: la columna PRECIO tal cual, solo si el lector la aceptó (confianza ≥ 0,9). Es el que la oficina propone
 *    al cliente (lo que el usuario escribía a mano en la revisión).
 *  - precio_neto: precio por unidad con los descuentos, solo si la línea CUADRA (cantidad × precio × (1 − dto) = importe
 *    del papel, ±0,01 €, con el importe aceptado). Es el de compra del artículo de STEL que se dé de alta (regla del robot).
 * No salen en el PDF (la firma no acepta importes). El técnico ve el precio y el descuento leídos de cada línea y los puede
 * corregir copiándolos del papel («Corregir»): entonces el neto queda comprobado por él.
 */
export function preciosDeLinea(l, cantidad) {
  const ok = (c) => typeof c?.confianza === "number" && c.confianza >= UMBRAL && Number.isFinite(Number(c?.valor));
  const num = (c) => (c && c.valor !== null && c.valor !== undefined && c.valor !== "" && Number.isFinite(Number(c.valor)) ? Number(c.valor) : null);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const out = {};
  // Lo leído tal cual (con o sin dudas), para enseñárselo al técnico y que lo corrija con el papel.
  const pl = num(l?.precio), dl = num(l?.descuento);
  if (pl !== null && pl > 0) out.precio_leido = pl;
  if (dl !== null && dl > 0 && dl < 100) out.dto_leido = dl;
  if (ok(l?.precio) && Number(l.precio.valor) > 0) {
    const precio = Number(l.precio.valor);
    out.precio_papel = precio;
    const dto = Number.isFinite(Number(l.descuento?.valor)) ? Number(l.descuento.valor) : 0;
    if (Number(cantidad) > 0 && ok(l.importe)) {
      const calculado = Math.round(Number(cantidad) * precio * (1 - dto / 100) * 100) / 100;
      if (Math.abs(calculado - Number(l.importe.valor)) <= 0.011) out.precio_neto = r4(precio * (1 - dto / 100));
    }
  }
  // Sin neto comprobado, un coste ESTIMADO con lo leído (usuario, 2026-11-23: «que de igual manera intente rellenar y ya si
  // existe error se modifica, o el técnico o en el STEL Order»). Va marcado «sin comprobar» en la revisión; nunca da de alta
  // el precio de compra de un artículo de STEL. Primero el importe ÷ cantidad (el importe ya lleva los descuentos); si no
  // encaja con el precio, el precio menos el descuento leído.
  if (out.precio_neto === undefined) {
    const imp = num(l?.importe), q = Number(cantidad);
    if (q > 0 && imp !== null && imp > 0 && (pl === null || imp / q <= pl * 1.0001)) {
      out.precio_neto_estimado = r4(imp / q); out.neto_estimado_como = "importe ÷ cantidad del papel";
    } else if (pl !== null && pl > 0) {
      const d = dl !== null && dl > 0 && dl < 100 ? dl : 0;
      out.precio_neto_estimado = r4(pl * (1 - d / 100));
      out.neto_estimado_como = d ? `precio del papel − ${d} %` : "precio del papel (sin descuento leído)";
    }
  }
  return out;
}

/**
 * Descuento escrito por el técnico: «» → 0; «62» o «62,5» → ese %; «60+10» o «60 10» → en cascada (64 %). Inválido → null.
 */
export function descuentoTexto(texto) {
  const t = String(texto ?? "").trim();
  if (!t) return 0;
  const partes = t.replace(/%/g, "").split(/\s*\+\s*|\s+/).filter(Boolean);
  let factor = 1;
  for (const p of partes) {
    if (!/^\d{1,3}([.,]\d{1,4})?$/.test(p)) return null;
    const n = Number(p.replace(",", "."));
    if (!(n >= 0 && n < 100)) return null;
    factor *= 1 - n / 100;
  }
  return Math.round((1 - factor) * 1e8) / 1e6;
}

/** Campos de precio de un material que pasan del albarán leído al parte (para la revisión de la oficina). */
export function camposDePrecio(m) {
  const out = {};
  for (const k of ["precio_papel", "precio_neto", "precio_neto_estimado", "precio_leido", "dto_leido"]) if (Number(m?.[k]) > 0) out[k] = Number(m[k]);
  if (out.precio_neto_estimado && m.neto_estimado_como) out.neto_estimado_como = String(m.neto_estimado_como);
  if (out.precio_neto && m.precio_comprobado) out.precio_comprobado = String(m.precio_comprobado);
  return out;
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
  // Si el lector no da por bueno el albarán ENTERO, ninguna línea es fiable aunque sus campos lo parezcan: con una foto
  // torcida el lector puede emparejar un código con la cantidad de OTRA fila con confianza alta (albarán real de un
  // proveedor, 2026-11-18).
  const documentoFiable = resultado?.fiable === true || (typeof resultado?.confianza === "number" && resultado.confianza >= UMBRAL);
  if (!documentoFiable && (resultado?.lineas || []).length) avisos.push("El lector no da por bueno el albarán entero: todas sus líneas quedan para comprobarlas con la foto.");
  for (const [i, l] of (resultado?.lineas || []).entries()) {
    const descripcion = valor(l.descripcion), referencia = valor(l.referencia);
    if (!descripcion && !referencia) continue;
    const cantidadLeida = valor(l.cantidad);
    const cantidad = cantidadLeida !== null && Number.isFinite(Number(cantidadLeida)) ? Number(cantidadLeida) : null;
    const dudas = [];
    if (!documentoFiable) dudas.push("Albarán leído con dudas en conjunto: compara esta línea con el papel");
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
    // Solo con una referencia fiable (y un albarán fiable) se busca el artículo de STEL (una cifra mal leída daría otro).
    const enStel = documentoFiable && referencia && fiable(l.referencia) ? articuloPorReferencia(referencia, articulos) : {articulo: null, motivo: "referencia sin confirmar"};
    const precios = preciosDeLinea(l, cantidad);
    materiales.push({
      descripcion: String(descripcion || "").trim(), referencia: referencia ? String(referencia).trim() : "",
      cantidad, unidad, stel_item_id: enStel.articulo ? enStel.articulo.stel_id : null, articulo_stel: enStel.articulo?.nombre || null,
      ...precios,
      motivo_articulo: enStel.motivo, dudas, fiable: dudas.length === 0,
      origen: {tipo: "ALBARAN_PROVEEDOR", foto_id: fotoId, proveedor, numero, fecha, linea: i + 1},
      dicho: `Albarán ${[proveedor, numero].filter(Boolean).join(" ") || "del proveedor"}, línea ${i + 1}`,
    });
  }
  if (!materiales.length) avisos.push("No se han podido leer líneas en la foto. Repite la foto (el papel entero, recto y con luz) o escribe los materiales.");
  if (materiales.some((m) => !m.fiable)) avisos.push("Hay datos leídos con dudas (en ámbar): compáralos con el papel antes de añadirlos.");
  return {proveedor, numero, fecha, materiales, avisos, confianza: resultado?.confianza ?? null};
}
