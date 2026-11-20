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
 * mano de obra y desplazamiento con los servicios configurados. Mano de obra y desplazamiento: por horas (minutos que
 * anotó el técnico ÷ 60) al precio fijo por hora de Ajustes (usuario, 2026-11-18: 50 €/h); sin ese ajuste, el del
 * servicio de STEL. Materiales: precio SOLO del catálogo de STEL. Sin precio o sin horas, la línea queda incompleta para
 * que administración la complete (nunca se inventa).
 */
export function proponerLineas(contenido, articulos, ajustes) {
  const porId = new Map((articulos || []).map((a) => [Number(a.stel_id), a]));
  const lineas = [];
  for (const m of contenido.materiales || []) {
    const a = m.stel_item_id ? porId.get(Number(m.stel_item_id)) : null;
    // Material del albarán del proveedor: el PRECIO del papel (usuario, 2026-11-20: «el precio que reflejaba en el
    // albarán»); si no se leyó con seguridad, el del artículo de STEL; si no hay ninguno, vacío para la oficina.
    const precio = Number(m.precio_papel) > 0 ? Number(m.precio_papel) : (a?.precio ?? null);
    lineas.push({tipo: "MATERIAL", material_id: m.id, stel_item_id: a ? a.stel_id : (m.stel_item_id ?? null),
      descripcion: [m.descripcion, m.referencia ? `Ref. ${m.referencia}` : ""].filter(Boolean).join(" "),
      cantidad: Number(m.cantidad) || null, precio, descuento_pct: 0, iva_pct: a?.iva_pct ?? 21});
  }
  const servicio = (clave) => porId.get(Number(ajustes?.[clave])) || null;
  const precioHora = (clave, s) => {
    const v = ajustes?.[clave];
    return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : (s?.precio ?? null);
  };
  const horas = (min) => Math.round(Number(min) / 60 * 100) / 100;
  if (Number(contenido.tiempo_trabajo_min) > 0) {
    const s = servicio("stel_servicio_mano_obra_id");
    lineas.push({tipo: "MANO_OBRA", stel_item_id: s?.stel_id ?? null, descripcion: `${s?.nombre || "Mano de obra"} (horas)`,
      cantidad: horas(contenido.tiempo_trabajo_min), precio: precioHora("precio_hora_mano_obra", s), descuento_pct: 0, iva_pct: s?.iva_pct ?? 21});
  }
  if (Number(contenido.desplazamiento_min) > 0 || Number(contenido.desplazamiento_km) > 0) {
    const s = servicio("stel_servicio_desplazamiento_id");
    // Por horas: sin minutos anotados (solo km) no hay horas que cobrar y la cantidad queda para administración.
    lineas.push({tipo: "DESPLAZAMIENTO", stel_item_id: s?.stel_id ?? null, descripcion: `${s?.nombre || "Desplazamiento"} (horas)`,
      cantidad: Number(contenido.desplazamiento_min) > 0 ? horas(contenido.desplazamiento_min) : null,
      precio: precioHora("precio_hora_desplazamiento", s), descuento_pct: 0, iva_pct: s?.iva_pct ?? 21});
  }
  return lineas;
}

export function lineasIncompletas(lineas) {
  return (lineas || []).filter((l) => !l.stel_item_id || l.cantidad === null || l.cantidad === "" || l.precio === null || l.precio === "" || l.iva_pct === null || l.iva_pct === "");
}
