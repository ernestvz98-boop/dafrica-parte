async function renderHome(){
  setTopbar("Inicio", "DAFRICA Control Web · acceso privado");
  loading("Preparando panel…");

  const cards = [
    ["Maquinaria","machines","maquinaria.ver","maquinaria"],
    ["Mantenimientos","mantenimiento_planes","mantenimiento.ver","mantenimiento"],
    ["Partes","partes_diarios","partes.ver","partes"],
    ["Obras","obras","obras.ver","obras"],
    ["Vehículos","vehiculos","vehiculos.ver","vehiculos"],
    ["Trabajadores","workers","trabajadores.ver","trabajadores"],
    ["EPIs","epis","epis.ver","epis"],
    ["Costes","coste_documentos","costes.ver","costes"]
  ].filter(x => has(x[2]));

  const counts = await Promise.all(cards.map(x => countRows(x[1],x[2])));

  let alertsHtml = "";
  if(has("mantenimiento.ver")){
    try{
      const today = new Date().toISOString().slice(0,10);
      const due = await sb("/rest/v1/mantenimiento_planes?activo=eq.true&proxima_revision=lte." + today + "&select=id,proxima_revision&limit=50");
      if(due?.length){
        alertsHtml += '<div class="module-note sensitive-note"><b>Atención:</b> hay ' + due.length + ' plan(es) de mantenimiento con revisión vencida o para hoy.</div>';
      }
    }catch{}
  }

  const cardHtml = cards.map((x,i) => `
    <button class="card home-card" data-go="${esc(x[3])}" type="button">
      <div class="metric-label">${esc(x[0])}</div>
      <div class="metric">${counts[i] ?? "—"}</div>
      <div class="muted">Abrir módulo</div>
    </button>
  `).join("");

  setContent(`
    ${alertsHtml}
    <div class="section-head">
      <div><h2>Panel principal</h2><p>Solo aparecen módulos autorizados para tu usuario.</p></div>
    </div>
    <div class="grid cards">${cardHtml || '<div class="card">No tienes módulos asignados.</div>'}</div>
    <div class="grid two dashboard-bottom">
      <div class="card">
        <h3>Sesión</h3>
        <div class="detail-grid">
          <div class="kv"><b>Usuario</b><span>${esc(state.user?.email || "")}</span></div>
          <div class="kv"><b>Rol</b><span>${esc(state.roles.map(r=>r.nombre||r.codigo).join(", ") || "Sin rol")}</span></div>
          <div class="kv"><b>Acceso</b><span>Privado · Supabase Auth + RLS</span></div>
        </div>
      </div>
      <div class="card">
        <h3>Seguridad</h3>
        <div class="muted">Los datos no se cargan hasta validar la sesión. Cada consulta vuelve a pasar por los permisos y las políticas RLS de Supabase.</div>
      </div>
    </div>
  `);

  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click",()=>navigate(b.dataset.go)));
}

function statusBadge(v){
  const s = String(v || "").toUpperCase();
  let cls = "";
  if(["ACTIVO","DISPONIBLE","EN USO","OPERATIVO","OK","CERRADO","REVISADO"].some(x=>s.includes(x))) cls="ok";
  if(["MANTENIMIENTO","PENDIENTE","REVISION","REVISIÓN"].some(x=>s.includes(x))) cls="warn";
  if(["AVERIA","AVERÍA","BAJA","VENCIDO","INCIDENCIA"].some(x=>s.includes(x))) cls="danger";
  return '<span class="badge '+cls+'">'+esc(v || "—")+'</span>';
}

async function renderMachines(){
  setTopbar("Maquinaria", state.qrToken ? "Ficha abierta desde QR" : "Equipos y movimientos");
  loading("Cargando maquinaria…");

  const filter = state.qrToken
    ? "&qr_token=eq." + encodeURIComponent(state.qrToken)
    : "";

  const rows = await sb(
    "/rest/v1/machines?active=eq.true" + filter +
    "&select=id,legacy_id,clave_local,nombre,machine_type,manufacturer,model,serial,location,operational_status,obra_id,responsable,beacon_id,stel_id,qr_token&order=legacy_id.asc"
  );
  state.machines = rows || [];

  if(state.qrToken){
    if(!state.machines.length){
      setContent('<div class="card"><h2>Máquina no encontrada</h2><div class="error">El QR no corresponde a una máquina activa o no tienes permiso para verla.</div></div>');
      return;
    }
    return renderMachineDetail(state.machines[0], true);
  }

  const table = state.machines.map((m,i)=>`
    <tr>
      <td><b>${esc(m.legacy_id || "")}</b></td>
      <td>${esc(m.nombre || "—")}</td>
      <td>${esc([m.manufacturer,m.model].filter(Boolean).join(" ") || "—")}</td>
      <td>${statusBadge(m.operational_status)}</td>
      <td>${esc(m.responsable || "—")}</td>
      <td>${esc(m.location || "—")}</td>
      <td><button class="linkbtn" type="button" data-machine="${i}">Ficha</button></td>
    </tr>
  `).join("");

  setContent(`
    <div class="section-head">
      <div><h2>Maquinaria</h2><p>${state.machines.length} equipo(s) activo(s).</p></div>
    </div>
    <div class="toolbar"><input id="machineSearch" type="search" placeholder="Buscar máquina…"></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Nombre</th><th>Marca / modelo</th><th>Estado</th><th>Responsable</th><th>Ubicación</th><th></th></tr></thead>
        <tbody id="machineBody">${table || '<tr><td colspan="7" class="empty">Sin maquinaria.</td></tr>'}</tbody>
      </table>
    </div>
  `);

  bindMachineRows();
  $("machineSearch")?.addEventListener("input", e => filterMachineRows(e.target.value));
}

function bindMachineRows(){
  document.querySelectorAll("[data-machine]").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = state.machines[Number(btn.dataset.machine)];
      if(m) renderMachineDetail(m,false).catch(handleModuleError);
    });
  });
}

function filterMachineRows(q){
  q = String(q || "").toLowerCase().trim();
  document.querySelectorAll("#machineBody tr").forEach(tr => {
    tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
  });
}

