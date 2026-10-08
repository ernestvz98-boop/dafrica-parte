"use strict";

// QR V3: si la etiqueta está libre, permite asignar una máquina existente
// o crear una máquina nueva y vincularla al QR en el mismo paso.
renderQrTagAssignment = async function(tag,currentMachineId=null){
  setTopbar("Maquinaria","Asignar " + tag.codigo);

  if(!has("maquinaria.editar")){
    setContent(
      '<div class="card"><h2>' + esc(tag.codigo) + '</h2>' +
      '<div class="module-note">Esta etiqueta está libre.</div>' +
      '<div class="muted">Tu usuario no tiene permiso para crear ni asignar maquinaria.</div></div>'
    );
    return;
  }

  loading("Preparando " + tag.codigo + "…");

  const [machines, obras] = await Promise.all([
    sb(
      "/rest/v1/machines?active=eq.true" +
      "&select=id,legacy_id,nombre,machine_type,manufacturer,model,operational_status,location" +
      "&order=legacy_id.asc"
    ),
    has("obras.ver")
      ? sb("/rest/v1/obras?activo=eq.true&select=id,legacy_id,nombre&order=nombre.asc").catch(()=>[])
      : Promise.resolve([])
  ]);

  const existingOptions = (machines || []).map(function(m){
    const txt = [
      m.legacy_id,
      m.nombre,
      m.machine_type,
      [m.manufacturer,m.model].filter(Boolean).join(" ")
    ].filter(Boolean).join(" · ");
    return '<option value="' + esc(m.id) + '"' +
      (currentMachineId === m.id ? ' selected' : '') +
      '>' + esc(txt) + '</option>';
  }).join("");

  const workOptions = (obras || []).map(function(o){
    return '<option value="' + esc(o.id) + '">' +
      esc([o.legacy_id,o.nombre].filter(Boolean).join(" · ")) +
      '</option>';
  }).join("");

  let html = '';
  html += '<div class="section-head"><div>';
  html += '<h2>' + esc(tag.codigo) + '</h2>';
  html += '<p>Pega esta etiqueta a una máquina nueva o asígnala a una ya registrada.</p>';
  html += '</div></div>';

  html += '<div class="module-note">';
  html += 'Después de asignarla, al escanear el QR abrirá directamente la ficha privada, ';
  html += 'documentos, ubicación, historial y movimientos de esa máquina.';
  html += '</div>';

  html += '<div class="grid two">';

  html += '<div class="card">';
  html += '<h3>Asignar máquina existente</h3>';
  html += '<form id="assignQrTagForm">';
  html += '<label>Máquina / equipo</label>';
  html += '<select id="assignQrMachine" required>';
  html += '<option value="">Seleccionar…</option>' + existingOptions;
  html += '</select>';
  html += '<button class="btn secondary" type="submit">' +
    (currentMachineId ? 'Cambiar asignación' : 'Asignar existente') +
    '</button>';
  html += '<div id="assignQrStatus" class="statusline"></div>';
  html += '</form></div>';

  html += '<div class="card">';
  html += '<h3>Crear máquina nueva</h3>';
  html += '<div class="muted" style="margin-bottom:10px">';
  html += 'Para una compra nueva: pega el QR, completa la ficha y quedará creada y asignada automáticamente.';
  html += '</div>';
  html += '<form id="createMachineQrForm">';

  html += '<div class="form-grid">';
  html += '<div><label>Nombre *</label><input id="newMachineName" required placeholder="Ej. Taladro Bosch 18V"></div>';
  html += '<div><label>Tipo *</label><select id="newMachineType" required>';
  html += '<option value="">Seleccionar…</option>';
  html += '<option value="MAQUINARIA PESADA">Maquinaria pesada</option>';
  html += '<option value="HERRAMIENTA ELECTRICA">Herramienta eléctrica</option>';
  html += '<option value="HERRAMIENTA">Herramienta</option>';
  html += '<option value="EQUIPO AUXILIAR">Equipo auxiliar</option>';
  html += '<option value="OTRO">Otro</option>';
  html += '</select></div>';
  html += '<div><label>Marca</label><input id="newMachineBrand" placeholder="Bosch, Makita…"></div>';
  html += '<div><label>Modelo</label><input id="newMachineModel"></div>';
  html += '<div><label>Nº de serie</label><input id="newMachineSerial"></div>';
  html += '<div><label>Matrícula</label><input id="newMachinePlate"></div>';
  html += '<div><label>Año fabricación</label><input id="newMachineYear" type="number" min="1900" max="2100"></div>';
  html += '<div><label>Estado</label><select id="newMachineStatus">';
  html += '<option value="DISPONIBLE">Disponible</option>';
  html += '<option value="EN USO">En uso</option>';
  html += '<option value="MANTENIMIENTO">Mantenimiento</option>';
  html += '<option value="AVERIADO">Averiado</option>';
  html += '</select></div>';
  html += '<div><label>Responsable</label><input id="newMachineResponsible"></div>';
  html += '<div><label>Ubicación</label><input id="newMachineLocation" placeholder="Ej. Tremor de Arriba"></div>';

  if(has("obras.ver")){
    html += '<div><label>Obra</label><select id="newMachineWork">';
    html += '<option value="">Sin obra</option>' + workOptions;
    html += '</select></div>';
  }

  html += '<div><label>Fecha de compra</label><input id="newMachinePurchaseDate" type="date"></div>';
  html += '<div><label>Coste de compra (€)</label><input id="newMachineCost" type="number" step="0.01" min="0"></div>';
  html += '<div><label>Proveedor</label><input id="newMachineSupplier"></div>';
  html += '<div><label>Beacon ID</label><input id="newMachineBeacon"></div>';
  html += '<div><label>STEL ID</label><input id="newMachineStel"></div>';
  html += '</div>';

  html += '<label>Observaciones</label>';
  html += '<textarea id="newMachineNotes" placeholder="Características, accesorios, documentación pendiente…"></textarea>';

  html += '<button class="btn" type="submit">Crear máquina y asignar ' + esc(tag.codigo) + '</button>';
  html += '<div id="createMachineQrStatus" class="statusline"></div>';
  html += '</form></div>';

  html += '</div>';

  setContent(html);

  $("assignQrTagForm")?.addEventListener("submit", async function(e){
    e.preventDefault();
    const status = $("assignQrStatus");
    const machineId = $("assignQrMachine").value;
    if(!machineId) return;

    status.textContent = "Asignando…";
    status.className = "statusline muted";

    try{
      await sb("/rest/v1/rpc/asignar_qr_etiqueta_maquinaria",{
        method:"POST",
        body:JSON.stringify({
          p_token:state.tagToken,
          p_machine_id:machineId
        })
      });
      status.textContent = "QR asignado correctamente.";
      status.className = "statusline ok";
      setTimeout(function(){ renderReusableQrTag().catch(handleModuleError); },350);
    }catch(err){
      status.textContent = err.message;
      status.className = "statusline error";
    }
  });

  $("createMachineQrForm")?.addEventListener("submit", async function(e){
    e.preventDefault();

    const status = $("createMachineQrStatus");
    const name = $("newMachineName").value.trim();
    const type = $("newMachineType").value;

    if(!name || !type){
      status.textContent = "Nombre y tipo son obligatorios.";
      status.className = "statusline error";
      return;
    }

    const yearText = $("newMachineYear").value;
    const costText = $("newMachineCost").value;

    status.textContent = "Creando máquina y asignando QR…";
    status.className = "statusline muted";

    try{
      await sb("/rest/v1/rpc/crear_maquina_desde_qr",{
        method:"POST",
        body:JSON.stringify({
          p_tag_token:state.tagToken,
          p_nombre:name,
          p_tipo:type,
          p_marca:$("newMachineBrand").value.trim() || null,
          p_modelo:$("newMachineModel").value.trim() || null,
          p_serie:$("newMachineSerial").value.trim() || null,
          p_anio:yearText ? Number(yearText) : null,
          p_matricula:$("newMachinePlate").value.trim() || null,
          p_estado:$("newMachineStatus").value || "DISPONIBLE",
          p_obra_id:$("newMachineWork")?.value || null,
          p_responsable:$("newMachineResponsible").value.trim() || null,
          p_ubicacion:$("newMachineLocation").value.trim() || null,
          p_fecha_compra:$("newMachinePurchaseDate").value || null,
          p_coste_compra:costText ? Number(costText) : null,
          p_proveedor:$("newMachineSupplier").value.trim() || null,
          p_beacon_id:$("newMachineBeacon").value.trim() || null,
          p_stel_id:$("newMachineStel").value.trim() || null,
          p_observaciones:$("newMachineNotes").value.trim() || null
        })
      });

      status.textContent = "Máquina creada y QR asignado correctamente.";
      status.className = "statusline ok";
      setTimeout(function(){ renderReusableQrTag().catch(handleModuleError); },450);
    }catch(err){
      status.textContent = err.message;
      status.className = "statusline error";
    }
  });
};
