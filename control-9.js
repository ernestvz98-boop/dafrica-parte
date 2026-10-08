"use strict";

renderLocalizacion = async function(){
  setTopbar("Localización","GPS / Beacon");
  loading("Cargando localización…");

  const [devices, machines, vehicles] = await Promise.all([
    sb("/rest/v1/gps_dispositivos?activo=eq.true&select=id,codigo,tipo_dispositivo,tipo_objetivo,machine_id,vehiculo_id,nombre_equipo,proveedor,modelo_dispositivo,proveedor_device_id,imei,sim_iccid,ultima_conexion,bateria_pct,notas&order=codigo.asc").catch(()=>[]),
    has("maquinaria.ver")
      ? sb("/rest/v1/machines?active=eq.true&select=id,legacy_id,nombre,machine_type,location&order=legacy_id.asc").catch(()=>[])
      : Promise.resolve([]),
    has("vehiculos.ver")
      ? sb("/rest/v1/vehiculos?activo=eq.true&select=id,legacy_id,referencia,nombre,matricula,marca,modelo,ubicacion&order=matricula.asc").catch(()=>[])
      : Promise.resolve([])
  ]);

  const machineMap = new Map((machines||[]).map(m=>[m.id,m]));
  const vehicleMap = new Map((vehicles||[]).map(v=>[v.id,v]));

  const rows = (devices||[]).map(d=>{
    let asset = "—";
    if(d.machine_id){
      const m = machineMap.get(d.machine_id);
      asset = m ? [m.legacy_id,m.nombre].filter(Boolean).join(" · ") : "Maquinaria";
    }else if(d.vehiculo_id){
      const v = vehicleMap.get(d.vehiculo_id);
      asset = v ? [v.matricula,v.nombre||[v.marca,v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "Vehículo";
    }
    return `<tr>
      <td><b>${esc(d.codigo||"—")}</b></td>
      <td>${esc(d.tipo_dispositivo||"—")}</td>
      <td>${esc(asset)}</td>
      <td>${esc(d.proveedor||"Pendiente")}</td>
      <td>${esc(d.modelo_dispositivo||"—")}</td>
      <td>${esc(d.proveedor_device_id||d.imei||"—")}</td>
      <td>${esc(d.ultima_conexion ? new Date(d.ultima_conexion).toLocaleString() : "Sin conexión")}</td>
      <td>${esc(d.bateria_pct ?? "—")}</td>
    </tr>`;
  }).join("");

  const canEdit = has("localizacion.editar");

  setContent(`
    <div class="section-head">
      <div>
        <h2>Localización de equipos</h2>
        <p>Registro central de Beacon y GPS. El proveedor de hardware puede conectarse después sin rehacer la estructura.</p>
      </div>
      ${canEdit ? '<button id="newLocatorBtn" class="btn" type="button">+ Añadir localizador</button>' : ""}
    </div>

    <div class="grid cards">
      <div class="card"><div class="metric-label">Dispositivos activos</div><div class="metric">${(devices||[]).length}</div></div>
      <div class="card"><div class="metric-label">Beacon</div><div class="metric">${(devices||[]).filter(d=>String(d.tipo_dispositivo).toUpperCase()==="BEACON").length}</div></div>
      <div class="card"><div class="metric-label">GPS</div><div class="metric">${(devices||[]).filter(d=>String(d.tipo_dispositivo).toUpperCase()==="GPS").length}</div></div>
    </div>

    <div id="locatorFormHost"></div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Asignado a</th><th>Proveedor</th><th>Modelo</th><th>ID / IMEI</th><th>Última conexión</th><th>Batería %</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">Aún no hay dispositivos. Puedes registrar el primero aunque todavía no hayas elegido proveedor.</td></tr>'}</tbody>
      </table>
    </div>
  `);

  $("newLocatorBtn")?.addEventListener("click",()=>renderLocatorForm(machines||[],vehicles||[]));
};

function renderLocatorForm(machines,vehicles){
  const machineOptions = (machines||[]).map(m=>
    '<option value="'+esc(m.id)+'">'+esc([m.legacy_id,m.nombre,m.location].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  const vehicleOptions = (vehicles||[]).map(v=>
    '<option value="'+esc(v.id)+'">'+esc([v.matricula,v.nombre||[v.marca,v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  $("locatorFormHost").innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="section-head">
        <div><h3>Nuevo localizador</h3><p>Se puede registrar ahora y completar proveedor/IMEI más adelante.</p></div>
        <button id="closeLocatorForm" class="btn secondary" type="button">Cerrar</button>
      </div>

      <form id="locatorForm">
        <div class="form-grid">
          <div>
            <label>Tipo de dispositivo *</label>
            <select id="locType" required>
              <option value="BEACON">Beacon</option>
              <option value="GPS">GPS</option>
            </select>
          </div>
          <div>
            <label>Asignar a *</label>
            <select id="locTargetType" required>
              <option value="MAQUINARIA">Maquinaria</option>
              <option value="VEHICULO">Vehículo</option>
            </select>
          </div>

          <div id="locMachineWrap">
            <label>Máquina *</label>
            <select id="locMachine"><option value="">Seleccionar…</option>${machineOptions}</select>
          </div>
          <div id="locVehicleWrap" style="display:none">
            <label>Vehículo *</label>
            <select id="locVehicle"><option value="">Seleccionar…</option>${vehicleOptions}</select>
          </div>

          <div><label>Nombre del equipo</label><input id="locName" placeholder="Ej. Beacon dumper 1"></div>
          <div><label>Proveedor</label><input id="locProvider" placeholder="Pendiente / fabricante"></div>
          <div><label>Modelo</label><input id="locModel"></div>
          <div><label>ID del proveedor</label><input id="locProviderId"></div>
          <div><label>IMEI</label><input id="locImei"></div>
          <div><label>ICCID SIM</label><input id="locIccid"></div>
        </div>

        <label>Observaciones</label>
        <textarea id="locNotes" placeholder="Instalación, batería, ubicación física del dispositivo…"></textarea>

        <button class="btn" type="submit">Guardar localizador</button>
        <span id="locStatus" class="statusline"></span>
      </form>
    </div>
  `;

  $("closeLocatorForm")?.addEventListener("click",()=>{ $("locatorFormHost").innerHTML=""; });

  $("locTargetType")?.addEventListener("change",()=>{
    const isMachine = $("locTargetType").value === "MAQUINARIA";
    $("locMachineWrap").style.display = isMachine ? "" : "none";
    $("locVehicleWrap").style.display = isMachine ? "none" : "";
  });

  $("locatorForm")?.addEventListener("submit", async e=>{
    e.preventDefault();
    const status = $("locStatus");
    const target = $("locTargetType").value;
    const machineId = target==="MAQUINARIA" ? ($("locMachine").value || null) : null;
    const vehicleId = target==="VEHICULO" ? ($("locVehicle").value || null) : null;

    if((target==="MAQUINARIA" && !machineId) || (target==="VEHICULO" && !vehicleId)){
      status.textContent = "Selecciona el equipo al que vas a asignar el localizador.";
      status.className = "statusline error";
      return;
    }

    status.textContent = "Guardando…";
    status.className = "statusline muted";

    try{
      const out = await sb("/rest/v1/rpc/crear_dispositivo_localizacion",{
        method:"POST",
        body:JSON.stringify({
          p_tipo_dispositivo:$("locType").value,
          p_tipo_objetivo:target,
          p_machine_id:machineId,
          p_vehiculo_id:vehicleId,
          p_nombre_equipo:$("locName").value.trim() || null,
          p_proveedor:$("locProvider").value.trim() || null,
          p_modelo_dispositivo:$("locModel").value.trim() || null,
          p_proveedor_device_id:$("locProviderId").value.trim() || null,
          p_imei:$("locImei").value.trim() || null,
          p_sim_iccid:$("locIccid").value.trim() || null,
          p_notas:$("locNotes").value.trim() || null
        })
      });

      status.textContent = "Localizador guardado correctamente.";
      status.className = "statusline ok";
      setTimeout(()=>renderLocalizacion().catch(handleModuleError),400);
    }catch(err){
      status.textContent = err.message;
      status.className = "statusline error";
    }
  });
}
