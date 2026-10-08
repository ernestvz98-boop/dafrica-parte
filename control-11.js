"use strict";

const __renderLocalizacionBaseV10 = renderLocalizacion;

function osmEmbedUrl(lat,lon,zoomSpan=0.01){
  const la = Number(lat), lo = Number(lon);
  const d = Number(zoomSpan) || 0.01;
  const bbox = [lo-d, la-d, lo+d, la+d].join(",");
  return "https://www.openstreetmap.org/export/embed.html?bbox=" +
    encodeURIComponent(bbox) +
    "&layer=mapnik&marker=" +
    encodeURIComponent(la + "," + lo);
}

function renderLocalMap(lat,lon,title,subtitle){
  const host = $("localMapHost");
  if(!host) return;
  if(lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
    host.innerHTML = '<div class="card"><h3>Mapa</h3><div class="muted">Aún no hay una posición disponible.</div></div>';
    return;
  }
  host.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div><h3>${esc(title || "Mapa")}</h3><p>${esc(subtitle || "")}</p></div>
      </div>
      <iframe
        title="Mapa de localización"
        src="${esc(osmEmbedUrl(lat,lon))}"
        style="width:100%;height:420px;border:0;border-radius:12px"
        loading="lazy"></iframe>
      <div class="muted" style="margin-top:8px">
        Coordenadas: ${esc(Number(lat).toFixed(6))}, ${esc(Number(lon).toFixed(6))}
      </div>
    </div>
  `;
}

renderLocalizacion = async function(){
  setTopbar("Localización","GPS / Beacon · geocercas");
  loading("Cargando localización…");

  const [devices,machines,vehicles,positions,geofences,works,events] = await Promise.all([
    sb("/rest/v1/gps_dispositivos?activo=eq.true&select=id,codigo,tipo_dispositivo,es_principal,tipo_objetivo,machine_id,vehiculo_id,nombre_equipo,proveedor,modelo_dispositivo,proveedor_device_id,imei,sim_iccid,ultima_conexion,bateria_pct,notas&order=codigo.asc").catch(()=>[]),
    has("maquinaria.ver")
      ? sb("/rest/v1/machines?active=eq.true&select=id,legacy_id,nombre,machine_type,location,obra_id&order=legacy_id.asc").catch(()=>[])
      : Promise.resolve([]),
    has("vehiculos.ver")
      ? sb("/rest/v1/vehiculos?activo=eq.true&select=id,legacy_id,referencia,nombre,matricula,marca,modelo,ubicacion,obra_id&order=matricula.asc").catch(()=>[])
      : Promise.resolve([]),
    sb("/rest/v1/gps_posiciones?select=id,dispositivo_id,registrado_en,latitud,longitud,precision_m,velocidad_kmh,bateria_pct,ignicion&order=registrado_en.desc&limit=300").catch(()=>[]),
    sb("/rest/v1/gps_geocercas?activo=eq.true&select=id,nombre,obra_id,latitud,longitud,radio_m,created_at&order=nombre.asc").catch(()=>[]),
    has("obras.ver")
      ? sb("/rest/v1/obras?activo=eq.true&select=id,legacy_id,codigo,nombre,direccion,municipio,provincia,latitud,longitud&order=nombre.asc").catch(()=>[])
      : Promise.resolve([]),
    sb("/rest/v1/gps_eventos?select=id,dispositivo_id,geocerca_id,tipo,ocurrido_en,latitud,longitud,detalle,atendido&order=ocurrido_en.desc&limit=30").catch(()=>[])
  ]);

  const latest = new Map();
  (positions||[]).forEach(p=>{ if(!latest.has(p.dispositivo_id)) latest.set(p.dispositivo_id,p); });
  const mm = new Map((machines||[]).map(m=>[m.id,m]));
  const vm = new Map((vehicles||[]).map(v=>[v.id,v]));
  const wm = new Map((works||[]).map(w=>[w.id,w]));

  const activeSignals = (devices||[]).filter(d=>{
    const ts = d.ultima_conexion || latest.get(d.id)?.registrado_en;
    return ts && (Date.now()-new Date(ts).getTime()) <= 3600000;
  }).length;

  const deviceRows = (devices||[]).map((d,i)=>{
    const p = latest.get(d.id);
    let asset="—";
    if(d.machine_id){
      const m=mm.get(d.machine_id);
      asset=m ? [m.legacy_id,m.nombre].filter(Boolean).join(" · ") : "Maquinaria";
    }else if(d.vehiculo_id){
      const v=vm.get(d.vehiculo_id);
      asset=v ? [v.matricula,v.nombre||[v.marca,v.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ") : "Vehículo";
    }
    const ts=d.ultima_conexion || p?.registrado_en || null;
    return `<tr>
      <td><b>${esc(d.codigo||"—")}</b>${d.es_principal?' <span class="badge">Principal</span>':""}</td>
      <td>${esc(d.tipo_dispositivo||"—")}</td>
      <td>${esc(asset)}</td>
      <td>${esc(d.proveedor||"Pendiente")}</td>
      <td>${esc(ts ? new Date(ts).toLocaleString() : "Sin señal")}</td>
      <td>${esc((p?.bateria_pct ?? d.bateria_pct) ?? "—")}</td>
      <td>${p ? '<button class="linkbtn" type="button" data-map-device="'+i+'">Ver mapa</button>' : '<span class="muted">Sin posición</span>'}</td>
    </tr>`;
  }).join("");

  const geoRows = (geofences||[]).map((g,i)=>{
    const w=wm.get(g.obra_id);
    return `<tr>
      <td><b>${esc(g.nombre)}</b></td>
      <td>${esc(w ? [w.legacy_id,w.nombre].filter(Boolean).join(" · ") : "Sin obra")}</td>
      <td>${esc(g.radio_m)} m</td>
      <td>${esc(Number(g.latitud).toFixed(6))}, ${esc(Number(g.longitud).toFixed(6))}</td>
      <td><button class="linkbtn" type="button" data-map-geo="${i}">Ver mapa</button></td>
    </tr>`;
  }).join("");

  const eventRows = (events||[]).map(e=>{
    const d=(devices||[]).find(x=>x.id===e.dispositivo_id);
    const g=(geofences||[]).find(x=>x.id===e.geocerca_id);
    return `<tr>
      <td>${esc(e.ocurrido_en ? new Date(e.ocurrido_en).toLocaleString() : "—")}</td>
      <td>${esc(e.tipo||"—")}</td>
      <td>${esc(d?.codigo||"—")}</td>
      <td>${esc(g?.nombre||"—")}</td>
      <td>${e.atendido ? '<span class="badge">Atendido</span>' : '<span class="badge">Pendiente</span>'}</td>
    </tr>`;
  }).join("");

  const canEdit=has("localizacion.editar");

  setContent(`
    <div class="section-head">
      <div>
        <h2>Control de localización</h2>
        <p>GPS/Beacon es el control principal. El QR queda como acceso auxiliar a la ficha.</p>
      </div>
      <div class="row">
        ${canEdit ? '<button id="newGeoBtn" class="btn secondary" type="button">+ Geocerca</button>' : ""}
        ${canEdit ? '<button id="newLocatorBtn" class="btn" type="button">+ Localizador</button>' : ""}
      </div>
    </div>

    <div class="grid cards">
      <div class="card"><div class="metric-label">Localizadores activos</div><div class="metric">${(devices||[]).length}</div></div>
      <div class="card"><div class="metric-label">Con señal &lt; 1 h</div><div class="metric">${activeSignals}</div></div>
      <div class="card"><div class="metric-label">Geocercas</div><div class="metric">${(geofences||[]).length}</div></div>
      <div class="card"><div class="metric-label">Alertas pendientes</div><div class="metric">${(events||[]).filter(e=>!e.atendido).length}</div></div>
    </div>

    <div id="locatorFormHost"></div>
    <div id="geofenceFormHost"></div>
    <div id="localMapHost"></div>

    <div class="card">
      <h3>Equipos localizados</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Código</th><th>Tipo</th><th>Asignado a</th><th>Proveedor</th><th>Última señal</th><th>Batería %</th><th></th></tr></thead>
        <tbody>${deviceRows || '<tr><td colspan="7" class="empty">Aún no hay localizadores dados de alta.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="grid two">
      <div class="card">
        <h3>Geocercas de obra</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Nombre</th><th>Obra</th><th>Radio</th><th>Centro</th><th></th></tr></thead>
          <tbody>${geoRows || '<tr><td colspan="5" class="empty">Aún no hay geocercas.</td></tr>'}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h3>Eventos recientes</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Evento</th><th>Dispositivo</th><th>Geocerca</th><th>Estado</th></tr></thead>
          <tbody>${eventRows || '<tr><td colspan="5" class="empty">Sin eventos de geocerca.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>
  `);

  $("newLocatorBtn")?.addEventListener("click",()=>renderLocatorForm(machines||[],vehicles||[]));
  $("newGeoBtn")?.addEventListener("click",()=>renderGeofenceForm(works||[]));

  document.querySelectorAll("[data-map-device]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const d=(devices||[])[Number(btn.dataset.mapDevice)];
      const p=latest.get(d.id);
      let label=d.codigo || "Dispositivo";
      if(d.machine_id){
        const m=mm.get(d.machine_id);
        if(m) label += " · " + (m.nombre||m.legacy_id);
      }else if(d.vehiculo_id){
        const v=vm.get(d.vehiculo_id);
        if(v) label += " · " + (v.matricula||v.nombre||"Vehículo");
      }
      renderLocalMap(p?.latitud,p?.longitud,label,p?.registrado_en ? "Última posición: "+new Date(p.registrado_en).toLocaleString() : "");
      $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });

  document.querySelectorAll("[data-map-geo]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const g=(geofences||[])[Number(btn.dataset.mapGeo)];
      renderLocalMap(g.latitud,g.longitud,"Geocerca · "+g.nombre,"Radio: "+g.radio_m+" m");
      $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
};

function renderGeofenceForm(works){
  const host=$("geofenceFormHost");
  if(!host) return;
  const options=(works||[]).map(w=>
    '<option value="'+esc(w.id)+'">'+esc([w.legacy_id,w.nombre,w.municipio].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  host.innerHTML=`
    <div class="card" style="margin-bottom:16px">
      <div class="section-head">
        <div><h3>Nueva geocerca</h3><p>Define el centro de la obra y el radio permitido para la maquinaria.</p></div>
        <button id="closeGeoForm" class="btn secondary" type="button">Cerrar</button>
      </div>

      <form id="geoForm">
        <div class="form-grid">
          <div><label>Nombre *</label><input id="geoName" required placeholder="Ej. Colmenas · perímetro obra"></div>
          <div><label>Obra</label><select id="geoWork"><option value="">Sin obra</option>${options}</select></div>
          <div><label>Latitud *</label><input id="geoLat" type="number" step="any" required></div>
          <div><label>Longitud *</label><input id="geoLon" type="number" step="any" required></div>
          <div><label>Radio permitido (m) *</label><input id="geoRadius" type="number" min="20" step="10" value="300" required></div>
        </div>

        <div class="row">
          <button id="useMyLocation" class="btn secondary" type="button">Usar mi ubicación actual</button>
          <button class="btn" type="submit">Guardar geocerca</button>
        </div>
        <span id="geoStatus" class="statusline"></span>
      </form>
    </div>
  `;

  $("closeGeoForm")?.addEventListener("click",()=>{ host.innerHTML=""; });

  $("geoWork")?.addEventListener("change",()=>{
    const w=(works||[]).find(x=>x.id===$("geoWork").value);
    if(w?.latitud!=null && w?.longitud!=null){
      $("geoLat").value=w.latitud;
      $("geoLon").value=w.longitud;
    }
    if(w && !$("geoName").value.trim()){
      $("geoName").value=(w.nombre||w.legacy_id||"Obra")+" · perímetro";
    }
  });

  $("useMyLocation")?.addEventListener("click",()=>{
    const s=$("geoStatus");
    if(!navigator.geolocation){
      s.textContent="Este dispositivo no permite obtener ubicación.";
      s.className="statusline error";
      return;
    }
    s.textContent="Obteniendo ubicación…";
    s.className="statusline muted";
    navigator.geolocation.getCurrentPosition(pos=>{
      $("geoLat").value=pos.coords.latitude.toFixed(7);
      $("geoLon").value=pos.coords.longitude.toFixed(7);
      s.textContent="Ubicación cargada. Revisa el radio antes de guardar.";
      s.className="statusline ok";
      renderLocalMap(pos.coords.latitude,pos.coords.longitude,"Centro propuesto de geocerca","Vista previa del punto central");
    },err=>{
      s.textContent="No se pudo obtener la ubicación: "+err.message;
      s.className="statusline error";
    },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });

  $("geoForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const s=$("geoStatus");
    s.textContent="Guardando…";
    s.className="statusline muted";
    try{
      await sb("/rest/v1/rpc/crear_geocerca",{
        method:"POST",
        body:JSON.stringify({
          p_nombre:$("geoName").value.trim(),
          p_obra_id:$("geoWork").value || null,
          p_latitud:Number($("geoLat").value),
          p_longitud:Number($("geoLon").value),
          p_radio_m:Number($("geoRadius").value)
        })
      });
      s.textContent="Geocerca guardada.";
      s.className="statusline ok";
      setTimeout(()=>renderLocalizacion().catch(handleModuleError),400);
    }catch(err){
      s.textContent=err.message;
      s.className="statusline error";
    }
  });
}
