// DAFRICA SAT · importes de la revisión económica (solo administración). Misma regla que sat_total() en Supabase:
// cada línea, base = cantidad × precio × (1 − descuento) redondeada a céntimos; total = base × (1 + IVA) redondeado.

export function redondear2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  const s = Math.sign(n) || 1;
  return s * Number(Math.round(Number(Math.abs(n) + "e2")) + "e-2");
}
export function baseLinea(l) {
  return redondear2((Number(l.cantidad) || 0) * (Number(l.precio) || 0) * (1 - (Number(l.descuento_pct) || 0) / 100));
}
export function totalLinea(l) { return redondear2(baseLinea(l) * (1 + (Number(l.iva_pct) || 0) / 100)); }
export function totales(lineas) {
  let base = 0, total = 0;
  for (const l of lineas || []) { base += baseLinea(l); total += totalLinea(l); }
  return {base: redondear2(base), iva: redondear2(total - base), total: redondear2(total)};
}
export function euros(x) {
  return new Intl.NumberFormat("es-ES", {style: "currency", currency: "EUR"}).format(Number(x) || 0);
}

/**
 * Propuesta de líneas económicas a partir del parte: materiales (con el artículo y precio de STEL si se eligió),
 * mano de obra y desplazamiento con los servicios configurados. Los precios salen SOLO del catálogo de STEL;
 * si no hay precio, la línea queda sin precio para que administración lo complete.
 */
export function proponerLineas(contenido, articulos, ajustes) {
  const porId = new Map((articulos || []).map((a) => [Number(a.stel_id), a]));
  const lineas = [];
  for (const m of contenido.materiales || []) {
    const a = m.stel_item_id ? porId.get(Number(m.stel_item_id)) : null;
    lineas.push({tipo: "MATERIAL", material_id: m.id, stel_item_id: a ? a.stel_id : null,
      descripcion: [m.descripcion, m.referencia ? `Ref. ${m.referencia}` : ""].filter(Boolean).join(" "),
      cantidad: Number(m.cantidad) || null, precio: a?.precio ?? null, descuento_pct: 0, iva_pct: a?.iva_pct ?? 21});
  }
  const servicio = (clave) => porId.get(Number(ajustes?.[clave])) || null;
  if (Number(contenido.tiempo_trabajo_min) > 0) {
    const s = servicio("stel_servicio_mano_obra_id");
    lineas.push({tipo: "MANO_OBRA", stel_item_id: s?.stel_id ?? null, descripcion: s?.nombre || "Mano de obra",
      cantidad: Math.round(Number(contenido.tiempo_trabajo_min) / 60 * 100) / 100, precio: s?.precio ?? null, descuento_pct: 0, iva_pct: s?.iva_pct ?? 21});
  }
  if (Number(contenido.desplazamiento_min) > 0 || Number(contenido.desplazamiento_km) > 0) {
    const s = servicio("stel_servicio_desplazamiento_id");
    lineas.push({tipo: "DESPLAZAMIENTO", stel_item_id: s?.stel_id ?? null, descripcion: s?.nombre || "Desplazamiento",
      cantidad: 1, precio: s?.precio ?? null, descuento_pct: 0, iva_pct: s?.iva_pct ?? 21});
  }
  return lineas;
}

export function lineasIncompletas(lineas) {
  return (lineas || []).filter((l) => !l.stel_item_id || l.cantidad === null || l.cantidad === "" || l.precio === null || l.precio === "" || l.iva_pct === null || l.iva_pct === "");
}
