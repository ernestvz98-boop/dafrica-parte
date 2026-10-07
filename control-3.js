async function renderMachineDetail(m, fromQr=false){
  setTopbar("Maquinaria", fromQr ? "Acceso mediante QR" : "Ficha de máquina");
  loading("Cargando ficha…");

  let docs = [], historyRows = [], obras = [];
  const tasks = [
    sb("/rest/v1/documents?kind=eq.machine&entity_legacy_id=eq." + encodeURIComponent(m.legacy_id) + "&active=eq.true&select=id,file_name,file_type,storage_bucket,storage_path,modified_at&order=file_name.asc").catch(()=>[]),
    sb("/rest/v1/movimientos_recursos?maquina_id=eq." + encodeURIComponent(m.id) + "&select=tipo_movimiento,fecha_movimiento,obra_nueva_legacy_id,ubicacion_nueva,estado_nuevo,observaciones&order=fecha_movimiento.desc&limit=30").catch(()=>[])
  ];
  if(has("obras.ver")) tasks.push(sb("/rest/v1/obras?activo=eq.true&select=id,legacy_id,nombre&order=nombre.asc").catch(()=>[]));
  const res = await Promise.all(tasks);
  docs = res[0] || [];
  historyRows = res[1] || [];
  obras = res[2] || [];
  state.machineDocs = docs;

  const docsHtml = docs.length ? docs.map((d,i)=>`
    <div class="list-item"><b>${esc(d.file_name || "Documento")}</b>
      <div class="meta">${esc(d.file_type || "")}</div>
      <button class="btn secondary docbtn" type="button" data-doc="${i}">Abrir</button>
    </div>
  `).join("") : '<div class="muted">Sin documentos registrados.</div>';

  const histHtml = historyRows.length ? historyRows.map(h=>`
    <div class="list-item">
      <b>${esc(h.tipo_movimiento || "Movimiento")}</b>
      <div class="meta">${esc(h.fecha_movimiento ? new Date(h.fecha_movimiento).toLocaleString() : "")}
      ${h.estado_nuevo ? " · " + esc(h.estado_nuevo) : ""}
      ${h.obra_nueva_legacy_id ? " · " + esc(h.obra_nueva_legacy_id) : ""}</div>
      ${h.observaciones ? '<div class="meta">'+esc(h.observaciones)+'</div>' : ""}
    </div>
  `).join("") : '<div class="muted">Sin movimientos registrados.</div>';

  const movementHtml = has("maquinaria.editar") ? `
    <div class="card">
      <h3>Registrar movimiento</h3>
      <form id="machineMoveForm">
        <div class="form-grid">
          <div><label>Movimiento</label><select id="moveType">
            <option value="ASIGNACION">Asignación / traslado</option>
            <option value="DEVOLUCION">Devolución</option>
            <option value="MANTENIMIENTO">Mantenimiento</option>
            <option value="AVERIA">Avería</option>
            <option value="REPARACION">Reparada</option>
          </select></div>
          <div><label>Obra</label><select id="moveObra"><option value="">Sin obra</option>
            ${obras.map(o=>'<option value="'+esc(o.legacy_id)+'">'+esc(o.nombre)+'</option>').join("")}
          </select></div>
          <div><label>Responsable</label><input id="moveResponsable" value="${esc(m.responsable || "")}"></div>
          <div><label>Ubicación</label><input id="moveLocation" value="${esc(m.location || "")}"></div>
        </div>
        <label>Observaciones</label><textarea id="moveNotes"></textarea>
        <button class="btn" type="submit">Guardar movimiento</button>
        <span id="moveStatus" class="statusline"></span>
      </form>
    </div>` : "";

  setContent(`
    <div class="section-head">
      <div><h2>${esc(m.nombre || m.legacy_id)}</h2><p>${esc(m.legacy_id || "")} · ${esc([m.manufacturer,m.model].filter(Boolean).join(" "))}</p></div>
      ${fromQr ? "" : '<button id="backMachines" class="btn secondary" type="button">Volver</button>'}
    </div>
    <div class="card">
      <div class="detail-grid">
        <div class="kv"><b>Estado</b><span>${statusBadge(m.operational_status)}</span></div>
        <div class="kv"><b>Tipo</b><span>${esc(m.machine_type || "—")}</span></div>
        <div class="kv"><b>Nº serie</b><span>${esc(m.serial || "—")}</span></div>
        <div class="kv"><b>Responsable</b><span>${esc(m.responsable || "—")}</span></div>
        <div class="kv"><b>Ubicación</b><span>${esc(m.location || "—")}</span></div>
        <div class="kv"><b>Beacon ID</b><span>${esc(m.beacon_id || "—")}</span></div>
        <div class="kv"><b>STEL ID</b><span>${esc(m.stel_id || "—")}</span></div>
        <div class="kv"><b>QR</b><span>Privado · requiere sesión</span></div>
      </div>
    </div>
    ${movementHtml}
    <div class="grid two">
      <div class="card"><h3>Documentos</h3><div class="list">${docsHtml}</div></div>
      <div class="card"><h3>Historial de movimientos</h3><div class="list">${histHtml}</div></div>
    </div>
  `);

  $("backMachines")?.addEventListener("click",()=>navigate("maquinaria"));
  document.querySelectorAll("[data-doc]").forEach(b => b.addEventListener("click",()=>openPrivateDoc(state.machineDocs[Number(b.dataset.doc)])));
  $("machineMoveForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const status = $("moveStatus");
    status.textContent = "Guardando…";
    status.className = "statusline muted";
    try{
      let obra = $("moveObra")?.value || null;
      const tipo = $("moveType").value;
      if(tipo === "DEVOLUCION") obra = null;
      await sb("/rest/v1/rpc/registrar_movimiento_recurso", {
        method:"POST",
        body:JSON.stringify({
          p_tipo_recurso:"maquinaria",
          p_recurso_clave:m.legacy_id,
          p_tipo_movimiento:tipo,
          p_fecha_movimiento:new Date().toISOString(),
          p_obra_clave:obra,
          p_responsable:$("moveResponsable").value.trim() || null,
          p_ubicacion:$("moveLocation").value.trim() || null,
          p_observaciones:$("moveNotes").value.trim(),
          p_movimiento_local_id:null,
          p_origen:"WEB_PRIVADA"
        })
      });
      status.textContent = "Movimiento guardado.";
      status.className = "statusline ok";
      setTimeout(()=>renderMachineDetail(m,fromQr).catch(handleModuleError),500);
    }catch(err){
      status.textContent = err.message;
      status.className = "statusline error";
    }
  });
}

async function openPrivateDoc(d){
  if(!d?.storage_path) return;
  try{
    const bucket = d.storage_bucket || "documentos-control";
    const path = d.storage_path.split("/").map(encodeURIComponent).join("/");
    const r = await authFetch(SUPABASE_URL + "/storage/v1/object/authenticated/" + encodeURIComponent(bucket) + "/" + path);
    if(!r.ok) throw new Error("No se pudo abrir el documento.");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(err){
    alert(err.message);
  }
}

