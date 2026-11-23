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
 * servicio de STEL. Materiales: coste neto + margen (ver abajo). Sin precio o sin horas, la línea queda incompleta para
 * que administración la complete (nunca se inventa).
 */
/** Margen de los materiales comprados (usuario, 2026-11-23: 30 %); el mismo cálculo que la función sat-stel. */
export function margenDe(ajustes) {
  const v = ajustes?.margen_materiales_pct;
  return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 30;
}
export function precioVenta(coste, margen) { return redondear2(Number(coste) * (1 + Number(margen) / 100)); }

export function proponerLineas(contenido, articulos, ajustes) {
  const porId = new Map((articulos || []).map((a) => [Number(a.stel_id), a]));
  const lineas = [];
  const margen = margenDe(ajustes);
  for (const m of contenido.materiales || []) {
    const a = m.stel_item_id ? porId.get(Number(m.stel_item_id)) : null;
    // Materiales comprados (usuario, 2026-11-23): coste NETO con los descuentos del albarán del proveedor (solo si la línea
    // cuadraba) más el margen. Sin ese neto, el precio queda vacío: «Precios de materiales (compra + margen)» lo trae del
    // precio de compra de STEL. Nunca el PRECIO bruto del papel (no lleva los descuentos).
    // Sin neto comprobado, el ESTIMADO con lo leído (usuario, 2026-11-23: «que intente rellenar y ya si existe error se
    // modifica»), marcado sin comprobar (en ámbar) para que la oficina lo mire.
    const comprobado = Number(m.precio_neto) > 0, estimado = !comprobado && Number(m.precio_neto_estimado) > 0;
    const coste = comprobado ? Number(m.precio_neto) : estimado ? Number(m.precio_neto_estimado) : null;
    const origen = comprobado ? (m.precio_comprobado === "TECNICO" ? "precio y descuento copiados del papel por el técnico" : "albarán del proveedor (con descuentos)")
      : `SIN COMPROBAR: ${m.neto_estimado_como || "leído del papel"}`;
    lineas.push({tipo: "MATERIAL", material_id: m.id, stel_item_id: a ? a.stel_id : (m.stel_item_id ?? null),
      descripcion: [m.descripcion, m.referencia ? `Ref. ${m.referencia}` : ""].filter(Boolean).join(" "),
      cantidad: Number(m.cantidad) || null, precio: coste !== null ? precioVenta(coste, margen) : null, descuento_pct: 0, iva_pct: a?.iva_pct ?? 21,
      ...(coste !== null ? {coste, coste_origen: origen, coste_dudoso: estimado, margen_pct: margen} : {})});
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
