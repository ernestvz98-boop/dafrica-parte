"use strict";

const __renderMachinesBase = renderMachines;
const __enterAppBase = enterApp;
const __navigateBase = navigate;

navigate = function(id, options={}){
  const mod = modules.find(m => m.id === id);
  if(!mod || !allowed(mod)) id = "inicio";
  state.module = id;

  const params = new URLSearchParams(location.search);
  params.set("mod", id);

  if(id !== "maquinaria" || !options.keepQr){
    params.delete("token");
    params.delete("tag");
    state.qrToken = "";
    state.tagToken = "";
  }

  history.replaceState(null, "", "./?" + params.toString());
  renderNav();
  renderModule().catch(handleModuleError);
  if(window.innerWidth <= 760) closeSidebar();
};

enterApp = async function(){
  const params = new URLSearchParams(location.search);
  state.qrToken = params.get("token") || "";
  state.tagToken = params.get("tag") || "";

  const requested =
    params.get("mod") ||
    ((state.qrToken || state.tagToken) ? "maquinaria" : "inicio");

  const mod = modules.find(m=>m.id===requested);
  state.module = mod && allowed(mod) ? requested : "inicio";

  if((state.qrToken || state.tagToken) && !has("maquinaria.ver")){
    state.module = "inicio";
    state.qrToken = "";
    state.tagToken = "";
  }

  showApp();
  renderNav();

  if(
    state.module === "partes" &&
    params.get("nuevo") === "1" &&
    (has("partes.crear") || has("partes.editar"))
  ){
    location.replace("./parte.html");
    return;
  }

  await renderModule();

  if((state.qrToken || state.tagToken) && state.module === "maquinaria"){
    const p = new URLSearchParams(location.search);
    p.set("mod","maquinaria");
    history.replaceState(null,"","./?"+p.toString());
  }
};

renderMachines = async function(){
  if(state.tagToken){
    return renderReusableQrTag();
  }
  return __renderMachinesBase();
};

async function renderReusableQrTag(){
  setTopbar("Maquinaria","Etiqueta QR reutilizable");
  loading("Comprobando etiqueta QR…");

  const tags = await sb(
    "/rest/v1/maquinaria_qr_etiquetas?token=eq." +
    encodeURIComponent(state.tagToken) +
    "&activo=eq.true&select=id,codigo,token,machine_id,asignado_en&limit=1"
  );

  const tag = (tags || [])[0];
  if(!tag){
    setContent('<div class="card"><h2>QR no válido</h2><div class="error">La etiqueta no existe o ha sido desactivada.</div></div>');
    return;
  }

  if(tag.machine_id){
    const rows = await sb(
      "/rest/v1/machines?id=eq." + encodeURIComponent(tag.machine_id) +
      "&active=eq.true&select=id,legacy_id,clave_local,nombre,machine_type,manufacturer,model,serial,location,operational_status,obra_id,responsable,beacon_id,stel_id,qr_token&limit=1"
    );
    const machine = (rows || [])[0];

    if(!machine){
      setContent('<div class="card"><h2>' + esc(tag.codigo) + '</h2><div class="error">La etiqueta está asignada, pero la máquina ya no está activa.</div></div>');
      return;
    }

    await renderMachineDetail(machine,true);

    const note = document.createElement("div");
    note.className = "module-note";
    note.innerHTML =
      "<b>" + esc(tag.codigo) + "</b> · etiqueta QR reutilizable asignada a " +
      "<b>" + esc(machine.legacy_id || machine.nombre || "máquina") + "</b>." +
      (has("maquinaria.editar")
        ? ' <button id="changeQrTag" class="btn secondary" type="button" style="margin-left:8px">Cambiar asignación</button>'
        : "");

    $("content").prepend(note);

    $("changeQrTag")?.addEventListener("click",()=>renderQrTagAssignment(tag,machine.id));
    return;
  }

  return renderQrTagAssignment(tag,null);
}

async function renderQrTagAssignment(tag,currentMachineId=null){
  setTopbar("Maquinaria","Asignar " + tag.codigo);

  if(!has("maquinaria.editar")){
    setContent(
      '<div class="card"><h2>' + esc(tag.codigo) + '</h2>' +
      '<div class="module-note">Esta etiqueta está libre.</div>' +
      '<div class="muted">Tu usuario puede consultar maquinaria, pero no tiene permiso para asignar etiquetas QR.</div></div>'
    );
    return;
  }

  loading("Cargando maquinaria disponible…");

  const machines = await sb(
    "/rest/v1/machines?active=eq.true" +
    "&select=id,legacy_id,nombre,machine_type,manufacturer,model,operational_status,location" +
    "&order=legacy_id.asc"
  );

  const options = (machines || []).map(m => {
    const text = [
      m.legacy_id,
      m.nombre,
      m.machine_type,
      [m.manufacturer,m.model].filter(Boolean).join(" ")
    ].filter(Boolean).join(" · ");
    return '<option value="' + esc(m.id) + '"' +
      (currentMachineId === m.id ? " selected" : "") +
      '>' + esc(text) + '</option>';
  }).join("");

  setContent(`
    <div class="section-head">
      <div>
        <h2>${esc(tag.codigo)}</h2>
        <p>Etiqueta QR reutilizable para maquinaria pesada, eléctrica o cualquier equipo registrado.</p>
      </div>
    </div>

    <div class="module-note">
      Selecciona la máquina que llevará físicamente esta etiqueta. Cuando se escanee,
      abrirá directamente su ficha privada con documentos, ubicación e historial.
    </div>

    <div class="card" style="max-width:720px">
      <form id="assignQrTagForm">
        <label>Máquina / equipo</label>
        <select id="assignQrMachine" required>
          <option value="">Seleccionar…</option>
          ${options}
        </select>

        <button class="btn" type="submit">
          ${currentMachineId ? "Guardar nueva asignación" : "Asignar QR"}
        </button>
        <div id="assignQrStatus" class="statusline"></div>
      </form>
    </div>
  `);

  $("assignQrTagForm")?.addEventListener("submit", async e => {
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
      setTimeout(()=>renderReusableQrTag().catch(handleModuleError),350);
    }catch(err){
      status.textContent = err.message;
      status.className = "statusline error";
    }
  });
}
