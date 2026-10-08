"use strict";

const __renderMachineDetailLocalizationBase = renderMachineDetail;

renderMachineDetail = async function(m, fromQr=false){
  await __renderMachineDetailLocalizationBase(m, fromQr);

  try{
    const devices = await sb(
      "/rest/v1/gps_dispositivos?activo=eq.true&machine_id=eq." +
      encodeURIComponent(m.id) +
      "&select=id,codigo,tipo_dispositivo,es_principal,nombre_equipo,proveedor,modelo_dispositivo,proveedor_device_id,imei,ultima_conexion,bateria_pct,notas&order=es_principal.desc,codigo.asc"
    ).catch(()=>[]);

    const host = $("content");
    if(!host) return;

    const section = host.querySelector(".section-head");
    const anchor = section ? section.nextSibling : host.firstChild;

    if(!(devices||[]).length){
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="section-head">
          <div>
            <h3>📍 Localización principal</h3>
            <p>Control patrimonial prioritario de esta máquina.</p>
          </div>
          <span class="badge">SIN LOCALIZADOR</span>
        </div>
        <div class="module-note sensitive-note">
          Esta máquina todavía no tiene GPS/Beacon asociado. El QR seguirá funcionando,
          pero la localización física no podrá verificarse hasta instalar un dispositivo.
        </div>
        ${has("localizacion.editar") ? '<button id="goAddLocator" class="btn" type="button">+ Añadir localizador</button>' : ""}
      `;
      host.insertBefore(card, anchor);
      $("goAddLocator")?.addEventListener("click",()=>navigate("localizacion"));
      return;
    }

    let primary = (devices||[]).find(d=>d.es_principal);
    if(!primary) primary = (devices||[]).find(d=>String(d.tipo_dispositivo||"").toUpperCase()==="GPS") || devices[0];

    let pos = null;
    if(primary?.id){
      const positions = await sb(
        "/rest/v1/gps_posiciones?dispositivo_id=eq." +
        encodeURIComponent(primary.id) +
        "&select=registrado_en,latitud,longitud,precision_m,velocidad_kmh,bateria_pct,ignicion&order=registrado_en.desc&limit=1"
      ).catch(()=>[]);
      pos = (positions||[])[0] || null;
    }

    const ts = primary.ultima_conexion || pos?.registrado_en || null;
    let signalText = "SIN SEÑAL";
    let signalClass = "";
    if(ts){
      const ageMs = Date.now() - new Date(ts).getTime();
      if(ageMs <= 60*60*1000){
        signalText = "CONECTADO";
        signalClass = "ok";
      }else if(ageMs <= 24*60*60*1000){
        signalText = "SEÑAL ANTIGUA";
        signalClass = "";
      }else{
        signalText = "SIN CONEXIÓN";
        signalClass = "error";
      }
    }

    const battery = pos?.bateria_pct ?? primary.bateria_pct;
    const coords = (pos && Number.isFinite(Number(pos.latitud)) && Number.isFinite(Number(pos.longitud)))
      ? Number(pos.latitud).toFixed(6) + ", " + Number(pos.longitud).toFixed(6)
      : "Sin posición recibida";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="section-head">
        <div>
          <h3>📍 Localización principal</h3>
          <p>Este dispositivo tiene prioridad sobre el QR para control y seguimiento de la máquina.</p>
        </div>
        <span class="badge ${signalClass}">${esc(signalText)}</span>
      </div>

      <div class="detail-grid">
        <div class="kv"><b>Dispositivo</b><span>${esc(primary.codigo || "—")} · ${esc(primary.tipo_dispositivo || "—")}</span></div>
        <div class="kv"><b>Proveedor / modelo</b><span>${esc([primary.proveedor,primary.modelo_dispositivo].filter(Boolean).join(" ") || "Pendiente")}</span></div>
        <div class="kv"><b>ID / IMEI</b><span>${esc(primary.proveedor_device_id || primary.imei || "—")}</span></div>
        <div class="kv"><b>Última señal</b><span>${esc(ts ? new Date(ts).toLocaleString() : "Nunca")}</span></div>
        <div class="kv"><b>Batería</b><span>${esc(battery ?? "—")}${battery != null ? "%" : ""}</span></div>
        <div class="kv"><b>Última posición</b><span>${esc(coords)}</span></div>
      </div>

      ${pos ? '<div class="module-note"><b>Velocidad:</b> ' + esc(pos.velocidad_kmh ?? "—") + ' km/h · <b>Precisión:</b> ' + esc(pos.precision_m ?? "—") + ' m · <b>Ignición:</b> ' + esc(pos.ignicion == null ? "—" : (pos.ignicion ? "Sí" : "No")) + '</div>' : ""}

      ${(devices||[]).length > 1 ? '<div class="muted" style="margin-top:8px">Hay ' + (devices||[]).length + ' localizadores asociados a esta máquina.</div>' : ""}
    `;

    host.insertBefore(card, anchor);
  }catch(err){
    console.error("Localización en ficha:", err);
  }
};
