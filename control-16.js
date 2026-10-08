"use strict";

// Geocercas V3: buscador fiable mediante Edge Function + mapa siempre visible.
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
          <p>Escribe una dirección o lugar, selecciónalo y comprueba el punto en el mapa antes de guardar.</p>
        </div>
        <button id="closeGeoForm" class="btn secondary" type="button">Cerrar</button>
      </div>

      <form id="geoForm">
        <div style="margin-bottom:14px">
          <label for="geoAddressSearch"><b>Dirección o lugar</b></label>
          <div class="row">
            <input id="geoAddressSearch"
              style="flex:1;min-width:280px"
              placeholder="Ej. Avenida Suspirón, Tremor de Arriba, León">
            <button id="geoAddressBtn" class="btn" type="button">Buscar y mostrar</button>
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
          <button id="refreshGeoMap" class="btn secondary" type="button">Mostrar coordenadas en mapa</button>
          <button class="btn" type="submit">Guardar geocerca</button>
        </div>
        <span id="geoStatus" class="statusline"></span>
      </form>

      <div id="geoMapPreview" style="margin-top:14px">
        <div class="card" style="background:#f8fafc">
          <h4 style="margin-top:0">Mapa</h4>
          <div class="muted">Busca una dirección o introduce coordenadas para mostrar el punto.</div>
        </div>
      </div>
    </div>
  `;

  $("closeGeoForm")?.addEventListener("click",()=>{ host.innerHTML=""; });

  function showMap(lat,lon,label="Punto seleccionado"){
    const la=Number(lat), lo=Number(lon);
    const mapHost=$("geoMapPreview");
    if(!mapHost) return;
    if(!Number.isFinite(la) || !Number.isFinite(lo)){
      mapHost.innerHTML='<div class="card"><div class="error">Las coordenadas no son válidas.</div></div>';
      return;
    }

    const google="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(la.toFixed(7)+","+lo.toFixed(7));
    mapHost.innerHTML=`
      <div class="card" style="background:#f8fafc">
        <div class="section-head">
          <div><h4 style="margin:0">${esc(label)}</h4><p>${esc(la.toFixed(7))}, ${esc(lo.toFixed(7))}</p></div>
          <a class="btn secondary" href="${esc(google)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
        </div>
        <iframe
          title="Mapa de la geocerca"
          src="${esc(osmEmbedUrl(la,lo,0.008))}"
          style="width:100%;height:390px;border:0;border-radius:12px"
          loading="lazy"></iframe>
      </div>
    `;
  }

  function setPoint(lat,lon,label,message){
    const la=Number(lat), lo=Number(lon);
    if(!Number.isFinite(la)||!Number.isFinite(lo)) return;
    $("geoLat").value=la.toFixed(7);
    $("geoLon").value=lo.toFixed(7);
    showMap(la,lo,label);

    const s=$("geoStatus");
    s.textContent=message || "Ubicación seleccionada. Revisa el punto y el radio antes de guardar.";
    s.className="statusline ok";
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

    resultsHost.innerHTML="";
    s.textContent="Buscando dirección…";
    s.className="statusline muted";

    try{
      const data=await sb("/functions/v1/geocodificar-direccion",{
        method:"POST",
        body:JSON.stringify({q})
      });
      const rows=data?.results || [];

      if(!rows.length){
        const g="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(q);
        resultsHost.innerHTML=`
          <div class="module-note">
            No encontré una coincidencia en el buscador interno.
            <a href="${esc(g)}" target="_blank" rel="noopener noreferrer">Buscar esta dirección en Google Maps</a>.
          </div>
        `;
        s.textContent="Prueba quitando el número de portal o escribiendo municipio y provincia.";
        s.className="statusline error";
        return;
      }

      resultsHost.innerHTML=rows.map((x,i)=>`
        <button type="button" class="list-item" data-geo-result="${i}"
          style="width:100%;text-align:left;cursor:pointer">
          <b>${esc(x.display_name || x.nombre || q)}</b>
          <div class="meta">${esc(Number(x.lat).toFixed(6))}, ${esc(Number(x.lon).toFixed(6))}</div>
        </button>
      `).join("");

      s.textContent=rows.length===1 ? "He encontrado una ubicación. Pulsa sobre ella." : "Selecciona la ubicación correcta.";
      s.className="statusline ok";

      document.querySelectorAll("[data-geo-result]").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const x=rows[Number(btn.dataset.geoResult)];
          if(!x) return;
          const label=x.nombre || x.display_name?.split(",")[0] || q;
          setPoint(x.lat,x.lon,label,"Ubicación encontrada y mostrada en el mapa.");
          if(!$("geoName").value.trim()) $("geoName").value=label+" · perímetro";
          resultsHost.innerHTML="";
        });
      });

      if(rows.length===1){
        const x=rows[0];
        const label=x.nombre || x.display_name?.split(",")[0] || q;
        setPoint(x.lat,x.lon,label,"Ubicación encontrada y mostrada en el mapa.");
        if(!$("geoName").value.trim()) $("geoName").value=label+" · perímetro";
      }
    }catch(err){
      s.textContent="No se pudo buscar la dirección: "+(err?.message || "error de conexión");
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

  $("refreshGeoMap")?.addEventListener("click",()=>{
    const rawLa=$("geoLat").value.trim();
    const rawLo=$("geoLon").value.trim();
    const la=Number(rawLa);
    const lo=Number(rawLo);
    if(!rawLa || !rawLo || !Number.isFinite(la)||!Number.isFinite(lo)){
      $("geoStatus").textContent="Introduce latitud y longitud válidas.";
      $("geoStatus").className="statusline error";
      return;
    }
    setPoint(la,lo,$("geoName").value.trim() || "Punto de geocerca","Coordenadas mostradas en el mapa.");
  });

  $("geoWork")?.addEventListener("change",()=>{
    const w=(works||[]).find(x=>x.id===$("geoWork").value);
    if(!w) return;

    if(!$("geoName").value.trim()){
      $("geoName").value=(w.nombre||w.legacy_id||"Obra")+" · perímetro";
    }

    if(w.latitud!=null && w.longitud!=null){
      setPoint(w.latitud,w.longitud,w.nombre||"Obra","Se ha cargado la ubicación guardada de la obra.");
      return;
    }

    const suggested=[w.direccion,w.municipio,w.provincia].filter(Boolean).join(", ");
    $("geoAddressSearch").value=suggested || w.nombre || "";
  });

  $("useMyLocation")?.addEventListener("click",()=>{
    const s=$("geoStatus");

    if(!navigator.geolocation){
      s.textContent="Este navegador no ofrece geolocalización. Usa la dirección o las coordenadas.";
      s.className="statusline error";
      return;
    }

    s.textContent="Obteniendo ubicación actual…";
    s.className="statusline muted";

    navigator.geolocation.getCurrentPosition(pos=>{
      setPoint(
        pos.coords.latitude,
        pos.coords.longitude,
        "Mi ubicación actual",
        "Ubicación actual cargada. Revisa el punto y el radio."
      );
    },err=>{
      s.textContent=err?.code===1
        ? "El navegador tiene bloqueado el permiso de ubicación. La búsqueda por dirección sigue funcionando."
        : "No se pudo obtener la ubicación actual. Usa la búsqueda por dirección.";
      s.className="statusline error";
    },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  });

  $("geoForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const s=$("geoStatus");
    const rawLat=$("geoLat").value.trim();
    const rawLon=$("geoLon").value.trim();
    const lat=Number(rawLat);
    const lon=Number(rawLon);

    if(!rawLat || !rawLon || !Number.isFinite(lat) || !Number.isFinite(lon)){
      s.textContent="Busca una dirección o introduce coordenadas válidas antes de guardar.";
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

      s.textContent="Geocerca guardada correctamente.";
      s.className="statusline ok";
      setTimeout(()=>renderLocalizacion().catch(handleModuleError),400);
    }catch(err){
      s.textContent=err.message;
      s.className="statusline error";
    }
  });
};
