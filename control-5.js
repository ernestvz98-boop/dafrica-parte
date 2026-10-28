"use strict";
// Inventario operativo de EPIs y localización; gestión individual de trabajadores retirada de la web.
async function renderEpis(){
  setTopbar("EPIs","Inventario y entregas");
  loading("Cargando EPIs…");
  const rows = await sb("/rest/v1/epis?activo=eq.true&select=id,legacy_id,referencia,nombre,tipo,categoria,marca,modelo,estado,stock_actual,stock_minimo,fecha_caducidad,proxima_revision&order=nombre.asc");
  const html = (rows||[]).map(e=>`<tr>
    <td><b>${esc(e.legacy_id || e.referencia || "—")}</b></td><td>${esc(e.nombre || e.tipo || "—")}</td><td>${esc(e.categoria || "—")}</td>
    <td>${esc([e.marca,e.modelo].filter(Boolean).join(" ") || "—")}</td><td>${statusBadge(e.estado || "—")}</td><td>${esc(e.stock_actual ?? "—")}</td><td>${esc(e.stock_minimo ?? "—")}</td><td>${esc(e.fecha_caducidad || e.proxima_revision || "—")}</td>
  </tr>`).join("");
  setContent(`<div class="section-head"><div><h2>EPIs</h2><p>${(rows||[]).length} referencia(s) activa(s).</p></div></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Nombre</th><th>Categoría</th><th>Marca / modelo</th><th>Estado</th><th>Stock</th><th>Mínimo</th><th>Caducidad / revisión</th></tr></thead><tbody>${html || '<tr><td colspan="8" class="empty">Sin EPIs.</td></tr>'}</tbody></table></div>`);
}

async function renderLocalizacion(){
  setTopbar("Localización","Dispositivos GPS / Beacon");
  loading("Cargando dispositivos…");
  const rows = await sb("/rest/v1/gps_dispositivos?activo=eq.true&select=id,codigo,proveedor,tipo_objetivo,nombre_equipo,ultima_conexion,bateria_pct,imei&order=nombre_equipo.asc").catch(()=>[]);
  const html = (rows||[]).map(d=>`<tr><td><b>${esc(d.codigo||"—")}</b></td><td>${esc(d.nombre_equipo||"—")}</td><td>${esc(d.tipo_objetivo||"—")}</td><td>${esc(d.proveedor||"—")}</td><td>${esc(d.ultima_conexion?new Date(d.ultima_conexion).toLocaleString():"—")}</td><td>${esc(d.bateria_pct??"—")}</td></tr>`).join("");
  setContent(`
    <div class="section-head"><div><h2>Localización</h2><p>Base preparada para GPS y Beacon. La ingestión del proveedor se activará cuando definamos el hardware.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Equipo</th><th>Tipo</th><th>Proveedor</th><th>Última conexión</th><th>Batería %</th></tr></thead><tbody>${html || '<tr><td colspan="6" class="empty">Aún no hay dispositivos dados de alta.</td></tr>'}</tbody></table></div>
  `);
}

