"use strict";

// Geocercas V2: buscar una dirección por texto + ubicación actual + selección manual en mapa.
renderGeofenceForm = function(works){
  const host=$("geofenceFormHost");
  if(!host) return;

  const options=(works||[]).map(w=>
    '<option value="'+esc(w.id)+'">'+esc([w.legacy_id,w.nombre,w.municipio].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  host.innerHTML=`
    <div class="card" style="margin-bottom:16px">
      <div class="section-head">
        <div>
          <h3>Nueva geocerca</h3>
          <p>Busca la ubicación escribiendo, usa tu ubicación actual o marca el punto en el mapa.</p>
        </div>
        <button id="closeGeoForm" class="btn secondary" type="button">Cerrar</button>
      </div>

      <form id="geoForm">
        <div style="margin-bottom:12px">
          <label>Buscar dirección o lugar</label>
          <div class="row">
            <input id="geoAddressSearch" style="flex:1;min-width:260px"
              placeholder="Ej. Tremor de Arriba, León / Calle ... / Castillo de los Templarios">
            <button id="geoAddressBtn" class="btn secondary" type="button">Buscar ubicación</button>
          </div>
          <div id="geoAddressResults" class="list" style="margin-top:8px"></div>
        </div>

        <div class="form-grid">
          <div><label>Nombre *</label><input id="geoName" required placeholder="Ej. Colmenas · perímetro obra"></div>
          <div><label>Obra</label><select id="geoWork"><option value="">Sin obra</option>${options}</select></div>
          <div><label>Latitud *</label><input id="geoLat" type="number" step="any" required></div>
          <div><label>Longitud *</label><input id="geoLon" type="number" step="any" required></div>
          <div><label>Radio permitido (m) *</label><input id="geoRadius" type="number" min="20" step="10" value="300" required></div>
        </div>

        <div class="row">
          <button id="useMyLocation" class="btn secondary" type="button">Usar mi ubicación actual</button>
          <button id="toggleGeoPicker" class="btn secondary" type="button">Seleccionar punto en mapa</button>
          <button class="btn" type="submit">Guardar geocerca</button>
        </div>
        <span id="geoStatus" class="statusline"></span>
      </form>

      <div id="geoPickerHost" hidden style="margin-top:14px"></div>
    </div>
  `;

  $("closeGeoForm")?.addEventListener("click",()=>{ host.innerHTML=""; });

  let centerLat = 42.55;
  let centerLon = -6.59;
  let span = 0.35;
  let selectedLat = null;
  let selectedLon = null;

  function setSelectedPoint(lat,lon,message){
    selectedLat=Number(lat);
    selectedLon=Number(lon);
    centerLat=selectedLat;
    centerLon=selectedLon;
    span=0.01;

    $("geoLat").value=selectedLat.toFixed(7);
    $("geoLon").value=selectedLon.toFixed(7);

    const s=$("geoStatus");
    s.textContent=message || "Ubicación seleccionada. Ajusta el radio y guarda la geocerca.";
    s.className="statusline ok";

    const p=$("geoPickerHost");
    p.hidden=false;
    renderPicker();
  }

  function pickerUrl(){
    const markerLat = selectedLat ?? centerLat;
    const markerLon = selectedLon ?? centerLon;
    const bbox=[centerLon-span,centerLat-span,centerLon+span,centerLat+span].join(",");
    return "https://www.openstreetmap.org/export/embed.html?bbox="+
      encodeURIComponent(bbox)+
      "&layer=mapnik&marker="+
      encodeURIComponent(markerLat+","+markerLon);
  }

  function renderPicker(){
    const p=$("geoPickerHost");
    if(!p || p.hidden) return;

    p.innerHTML=`
      <div class="module-note">
        <b>Centro de la geocerca:</b> puedes afinarlo pulsando sobre el mapa.
        Para más precisión, selecciona una zona y pulsa <b>Acercar</b>.
      </div>
      <div class="row" style="margin-bottom:8px">
        <button id="geoZoomIn" class="btn secondary" type="button">Acercar</button>
        <button id="geoZoomOut" class="btn secondary" type="button">Alejar</button>
        <button id="geoRecenter" class="btn secondary" type="button">Centrar en coordenadas</button>
      </div>
      <div id="geoPickerMap" style="position:relative;width:100%;height:390px;border-radius:12px;overflow:hidden;border:1px solid #d8dee8">
        <iframe
          title="Selector de geocerca"
          src="${esc(pickerUrl())}"
          style="width:100%;height:100%;border:0;pointer-events:none"
          loading="lazy"></iframe>
        <div id="geoPickerOverlay"
             title="Pulsa para seleccionar este punto"
             style="position:absolute;inset:0;cursor:crosshair;background:transparent"></div>
      </div>
      <div class="muted" style="margin-top:8px">
        ${selectedLat==null ? "Pulsa sobre el mapa para fijar el centro." :
          "Punto seleccionado: "+selectedLat.toFixed(7)+", "+selectedLon.toFixed(7)}
      </div>
    `;

    $("geoPickerOverlay")?.addEventListener("click",ev=>{
      const rect=ev.currentTarget.getBoundingClientRect();
      const x=(ev.clientX-rect.left)/rect.width;
      const y=(ev.clientY-rect.top)/rect.height;

      selectedLon=(centerLon-span)+(2*span*x);
      selectedLat=(centerLat+span)-(2*span*y);

      $("geoLat").value=selectedLat.toFixed(7);
      $("geoLon").value=selectedLon.toFixed(7);

      centerLat=selectedLat;
      centerLon=selectedLon;

      const s=$("geoStatus");
      s.textContent="Punto seleccionado en el mapa. Ajusta el radio y guarda la geocerca.";
      s.className="statusline ok";
      renderPicker();
    });

    $("geoZoomIn")?.addEventListener("click",()=>{
      span=Math.max(0.0015,span/3);
      if(selectedLat!=null){
        centerLat=selectedLat;
        centerLon=selectedLon;
      }
      renderPicker();
    });

    $("geoZoomOut")?.addEventListener("click",()=>{
      span=Math.min(1.5,span*3);
      renderPicker();
    });

    $("geoRecenter")?.addEventListener("click",()=>{
      const la=Number($("geoLat").value);
      const lo=Number($("geoLon").value);
      if(Number.isFinite(la) && Number.isFinite(lo)){
        centerLat=la;
        centerLon=lo;
        selectedLat=la;
        selectedLon=lo;
        span=Math.min(span,0.02);
        renderPicker();
      }
    });
  }

  async function searchAddress(){
    const q=$("geoAddressSearch").value.trim();
    const resultsHost=$("geoAddressResults");
    const s=$("geoStatus");

    if(!q){
      s.textContent="Escribe una dirección, municipio o lugar.";
      s.className="statusline error";
      return;
    }

    s.textContent="Buscando ubicación…";
    s.className="statusline muted";
    resultsHost.innerHTML="";

    try{
      const url="https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=es&limit=5&q="+encodeURIComponent(q);
      const r=await fetch(url,{headers:{"Accept":"application/json"}});
      if(!r.ok) throw new Error("No se pudo buscar la dirección.");
      const rows=await r.json();

      if(!Array.isArray(rows) || !rows.length){
        s.textContent="No encontré esa ubicación. Prueba con más detalle, por ejemplo municipio y provincia.";
        s.className="statusline error";
        return;
      }

      resultsHost.innerHTML=rows.map((x,i)=>`
        <button type="button" class="list-item" data-geo-address-result="${i}"
          style="width:100%;text-align:left;cursor:pointer">
          <b>${esc(x.display_name || q)}</b>
          <div class="meta">${esc(Number(x.lat).toFixed(6))}, ${esc(Number(x.lon).toFixed(6))}</div>
        </button>
      `).join("");

      s.textContent="Selecciona uno de los resultados.";
      s.className="statusline ok";

      document.querySelectorAll("[data-geo-address-result]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const x=rows[Number(btn.dataset.geoAddressResult)];
          if(!x) return;

          setSelectedPoint(Number(x.lat),Number(x.lon),"Ubicación encontrada. Revisa el punto y el radio antes de guardar.");

          if(!$("geoName").value.trim()){
            const short=x.name || x.display_name?.split(",")[0] || q;
            $("geoName").value=short+" · perímetro";
          }

          resultsHost.innerHTML="";
        });
      });
    }catch(err){
      s.textContent=err.message || "No se pudo buscar la ubicación.";
      s.className="statusline error";
    }
  }

  $("geoAddressBtn")?.addEventListener("click",searchAddress);
  $("geoAddressSearch")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      searchAddress();
    }
  });

  $("toggleGeoPicker")?.addEventListener("click",()=>{
    const p=$("geoPickerHost");
    p.hidden=!p.hidden;
    if(!p.hidden) renderPicker();
  });

  $("geoWork")?.addEventListener("change",()=>{
    const w=(works||[]).find(x=>x.id===$("geoWork").value);
    if(!w) return;

    if(!$("geoName").value.trim()){
      $("geoName").value=(w.nombre||w.legacy_id||"Obra")+" · perímetro";
    }

    if(w.latitud!=null && w.longitud!=null){
      setSelectedPoint(Number(w.latitud),Number(w.longitud),"Se ha cargado la ubicación guardada de la obra.");
      return;
    }

    const suggested=[w.direccion,w.municipio,w.provincia].filter(Boolean).join(", ");
    if(suggested){
      $("geoAddressSearch").value=suggested;
    }else if(w.nombre){
      $("geoAddressSearch").value=w.nombre;
    }
  });

  $("useMyLocation")?.addEventListener("click",()=>{
    const s=$("geoStatus");

    if(!navigator.geolocation){
      s.textContent="Este dispositivo no permite obtener ubicación. Puedes buscarla escribiendo arriba.";
      s.className="statusline error";
      return;
    }

    s.textContent="Solicitando ubicación al navegador…";
    s.className="statusline muted";

    navigator.geolocation.getCurrentPosition(pos=>{
      setSelectedPoint(
        pos.coords.latitude,
        pos.coords.longitude,
        "Ubicación actual cargada. Revisa el punto y el radio antes de guardar."
      );
    },err=>{
      if(err && err.code===1){
        s.textContent="El navegador tiene bloqueado el permiso de ubicación. Puedes buscarla escribiendo o permitir Ubicación en los permisos del sitio y volver a intentarlo.";
      }else{
        s.textContent="No se pudo obtener tu ubicación. Puedes buscarla escribiendo o seleccionar el punto en el mapa.";
      }
      s.className="statusline error";
    },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });

  $("geoForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const s=$("geoStatus");
    const lat=Number($("geoLat").value);
    const lon=Number($("geoLon").value);

    if(!Number.isFinite(lat) || !Number.isFinite(lon)){
      s.textContent="Busca una ubicación, selecciona un punto en el mapa o introduce coordenadas válidas.";
      s.className="statusline error";
      return;
    }

    s.textContent="Guardando…";
    s.className="statusline muted";

    try{
      await sb("/rest/v1/rpc/crear_geocerca",{
        method:"POST",
        body:JSON.stringify({
          p_nombre:$("geoName").value.trim(),
          p_obra_id:$("geoWork").value || null,
          p_latitud:lat,
          p_longitud:lon,
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
};
