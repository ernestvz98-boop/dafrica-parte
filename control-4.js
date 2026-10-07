async function renderMaintenance(){
  setTopbar("Mantenimientos","Planes, vencimientos y registros");
  loading("Cargando mantenimiento…");

  const [plans,equips] = await Promise.all([
    sb("/rest/v1/mantenimiento_planes?activo=eq.true&select=id,equipo_id,periodicidad,campana,fecha_inicio,proxima_revision,observaciones&order=proxima_revision.asc"),
    sb("/rest/v1/mantenimiento_equipos?activo=eq.true&select=id,referencia,nombre,tipo,fabricante,modelo&order=nombre.asc").catch(()=>[])
  ]);
  const eqMap = new Map((equips||[]).map(e=>[e.id,e]));
  const today = new Date(); today.setHours(0,0,0,0);

  const rows = (plans||[]).map(p=>{
    const eq = eqMap.get(p.equipo_id) || {};
    const d = p.proxima_revision ? new Date(p.proxima_revision+"T00:00:00") : null;
    const overdue = d && d < today;
    const soon = d && !overdue && ((d-today)/86400000 <= 30);
    const st = overdue ? '<span class="badge danger">Vencido</span>' : soon ? '<span class="badge warn">Próximo</span>' : '<span class="badge ok">Al día</span>';
    return `<tr>
      <td><b>${esc(eq.nombre || eq.referencia || "Equipo")}</b><div class="muted">${esc(eq.tipo || "")}</div></td>
      <td>${esc(p.periodicidad || "—")}</td>
      <td>${esc(p.campana || "—")}</td>
      <td>${esc(p.proxima_revision || "—")}</td>
      <td>${st}</td>
      <td>${esc(p.observaciones || "")}</td>
    </tr>`;
  }).join("");

  setContent(`
    <div class="section-head"><div><h2>Mantenimientos</h2><p>${(plans||[]).length} plan(es) activo(s).</p></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Equipo</th><th>Periodicidad</th><th>Campaña</th><th>Próxima revisión</th><th>Estado</th><th>Observaciones</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="empty">No hay planes activos.</td></tr>'}</tbody>
    </table></div>
  `);
}

async function renderPartes(){
  setTopbar("Partes","Partes diarios de obra");
  loading("Cargando partes…");
  const [parts,works] = await Promise.all([
    has("partes.ver") ? sb("/rest/v1/partes_diarios?select=id,obra_id,fecha,estado,created_at,cerrado_en&order=fecha.desc,created_at.desc&limit=100").catch(()=>[]) : Promise.resolve([]),
    has("obras.ver") ? sb("/rest/v1/obras?select=id,nombre,codigo&order=nombre.asc").catch(()=>[]) : Promise.resolve([])
  ]);
  const workMap = new Map((works||[]).map(o=>[o.id,o]));

  const rows = (parts||[]).map(p=>{
    const o = workMap.get(p.obra_id) || {};
    return `<tr><td>${esc(p.fecha || "—")}</td><td><b>${esc(o.nombre || "Obra")}</b></td><td>${statusBadge(p.estado || "—")}</td><td>${esc(p.cerrado_en ? new Date(p.cerrado_en).toLocaleString() : "—")}</td></tr>`;
  }).join("");

  setContent(`
    <div class="section-head">
      <div><h2>Partes diarios</h2><p>Creación y consulta dentro de la zona privada.</p></div>
      ${(has("partes.crear")||has("partes.editar")) ? '<button id="newParte" class="btn" type="button">Nuevo parte</button>' : ""}
    </div>
    <div class="module-note">El formulario de creación está protegido por la misma sesión de DAFRICA Control.</div>
    ${has("partes.ver") ? `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Obra</th><th>Estado</th><th>Cerrado</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">Sin partes registrados.</td></tr>'}</tbody></table></div>` : '<div class="card">Puedes crear partes, pero tu rol no tiene permiso de consulta.</div>'}
  `);
  $("newParte")?.addEventListener("click",()=>location.href="./parte.html");
}

async function renderObras(){
  setTopbar("Obras","Centros y obras activas");
  loading("Cargando obras…");
  const rows = await sb("/rest/v1/obras?activo=eq.true&select=id,codigo,legacy_id,nombre,cliente,direccion,municipio,provincia,estado,responsable,fecha_inicio,fecha_fin_prevista&order=nombre.asc");
  const html = (rows||[]).map(o=>`<tr>
    <td><b>${esc(o.codigo || o.legacy_id || "—")}</b></td><td>${esc(o.nombre || "—")}</td><td>${esc(o.cliente || "—")}</td>
    <td>${esc([o.municipio,o.provincia].filter(Boolean).join(", ") || o.direccion || "—")}</td>
    <td>${statusBadge(o.estado || "—")}</td><td>${esc(o.responsable || "—")}</td><td>${esc(o.fecha_inicio || "—")}</td>
  </tr>`).join("");
  setContent(`<div class="section-head"><div><h2>Obras</h2><p>${(rows||[]).length} obra(s) activa(s).</p></div></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Obra</th><th>Cliente</th><th>Ubicación</th><th>Estado</th><th>Responsable</th><th>Inicio</th></tr></thead><tbody>${html || '<tr><td colspan="7" class="empty">Sin obras activas.</td></tr>'}</tbody></table></div>`);
}

async function renderVehiculos(){
  setTopbar("Vehículos","Flota y asignaciones");
  loading("Cargando vehículos…");
  const rows = await sb("/rest/v1/vehiculos?activo=eq.true&select=id,legacy_id,referencia,matricula,marca,modelo,combustible,kilometraje,estado,responsable,ubicacion,beacon_id,stel_id&order=legacy_id.asc");
  const html = (rows||[]).map(v=>`<tr>
    <td><b>${esc(v.legacy_id || v.referencia || "—")}</b></td><td>${esc(v.matricula || "—")}</td><td>${esc([v.marca,v.modelo].filter(Boolean).join(" ") || "—")}</td>
    <td>${esc(v.combustible || "—")}</td><td>${esc(v.kilometraje ?? "—")}</td><td>${statusBadge(v.estado || "—")}</td><td>${esc(v.responsable || "—")}</td><td>${esc(v.ubicacion || "—")}</td>
  </tr>`).join("");
  setContent(`<div class="section-head"><div><h2>Vehículos</h2><p>${(rows||[]).length} vehículo(s) activo(s).</p></div></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Matrícula</th><th>Marca / modelo</th><th>Combustible</th><th>Km</th><th>Estado</th><th>Responsable</th><th>Ubicación</th></tr></thead><tbody>${html || '<tr><td colspan="8" class="empty">Sin vehículos.</td></tr>'}</tbody></table></div>`);
}

