async function renderWorkers(){
  setTopbar("Trabajadores","Personal autorizado");
  loading("Cargando trabajadores…");
  const rows = await sb("/rest/v1/workers?active=eq.true&select=id,legacy_id,name,job_role,center,telefono,email,responsable,ubicacion,estado,obra_id&order=name.asc");
  const canDocs = has("trabajadores.documentos");
  const html = (rows||[]).map((w,i)=>`<tr>
    <td><b>${esc(w.legacy_id || "—")}</b></td><td>${esc(w.name || "—")}</td><td>${esc(w.job_role || "—")}</td>
    <td>${esc(w.center || "—")}</td><td>${statusBadge(w.estado || "ACTIVO")}</td><td>${esc(w.telefono || "—")}</td><td>${esc(w.email || "—")}</td>
    ${canDocs ? '<td><button type="button" class="linkbtn" data-worker-docs="'+i+'">Documentación</button></td>' : ""}
  </tr>`).join("");

  setContent(`
    <div class="section-head"><div><h2>Trabajadores</h2><p>${(rows||[]).length} trabajador(es) activo(s).</p></div></div>
    <div class="module-note sensitive-note"><b>Datos protegidos:</b> la documentación individual solo se habilita con el permiso específico <code>trabajadores.documentos</code>.</div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Nombre</th><th>Puesto</th><th>Centro</th><th>Estado</th><th>Teléfono</th><th>Email</th>${canDocs?"<th></th>":""}</tr></thead><tbody>${html || '<tr><td colspan="8" class="empty">Sin trabajadores.</td></tr>'}</tbody></table></div>
  `);

  if(canDocs){
    document.querySelectorAll("[data-worker-docs]").forEach(btn=>btn.addEventListener("click",()=>openWorkerDocs(rows[Number(btn.dataset.workerDocs)])));
  }
}

async function openWorkerDocs(worker){
  if(!worker || !has("trabajadores.documentos")) return;
  loading("Cargando documentación protegida…");
  const docs = await sb("/rest/v1/documents?kind=eq.worker&entity_legacy_id=eq." + encodeURIComponent(worker.legacy_id) + "&active=eq.true&select=id,file_name,file_type,storage_bucket,storage_path,modified_at&order=file_name.asc");
  state.machineDocs = docs || [];
  const html = (docs||[]).map((d,i)=>`<div class="list-item"><b>${esc(d.file_name||"Documento")}</b><div class="meta">${esc(d.file_type||"")}</div><button type="button" class="btn secondary docbtn" data-worker-doc="${i}">Abrir</button></div>`).join("");
  setTopbar("Trabajadores","Documentación protegida");
  setContent(`
    <div class="section-head"><div><h2>${esc(worker.name)}</h2><p>${esc(worker.legacy_id||"")}</p></div><button id="backWorkers" class="btn secondary" type="button">Volver</button></div>
    <div class="module-note sensitive-note">Acceso concedido por <code>trabajadores.documentos</code>. Los archivos permanecen en Storage privado.</div>
    <div class="card"><h3>Documentos</h3><div class="list">${html || '<div class="muted">Sin documentos.</div>'}</div></div>
  `);
  $("backWorkers")?.addEventListener("click",()=>navigate("trabajadores"));
  document.querySelectorAll("[data-worker-doc]").forEach(b=>b.addEventListener("click",()=>openPrivateDoc(state.machineDocs[Number(b.dataset.workerDoc)])));
}

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

