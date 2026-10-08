"use strict";

// ===== Historial GPS avanzado: fecha/hora exacta + recorrido por intervalo =====
const __renderLocalizacionHistoryBase = renderLocalizacion;

function gpsLocalInputValue(date){
  const d = new Date(date);
  const pad = n => String(n).padStart(2,"0");
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
}

function gpsDiffText(seconds){
  const s=Math.max(0,Number(seconds)||0);
  if(s<60) return Math.round(s)+" s";
  if(s<3600) return Math.round(s/60)+" min";
  if(s<86400) return (s/3600).toFixed(s<7200?1:0)+" h";
  return (s/86400).toFixed(1)+" días";
}

function gpsGoogleMapsUrl(lat,lon){
  return "https://www.google.com/maps/search/?api=1&query="+
    encodeURIComponent(Number(lat).toFixed(7)+","+Number(lon).toFixed(7));
}

function gpsHaversineClient(a,b){
  const toRad=x=>x*Math.PI/180;
  const R=6371000;
  const lat1=toRad(Number(a.latitud)), lat2=toRad(Number(b.latitud));
  const dLat=lat2-lat1;
  const dLon=toRad(Number(b.longitud)-Number(a.longitud));
  const h=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

renderLocalizacion = async function(){
  await __renderLocalizacionHistoryBase();

  const host=$("content");
  if(!host) return;

  const devices=await sb(
    "/rest/v1/gps_dispositivos?activo=eq.true&select=id,codigo,tipo_dispositivo,nombre_equipo,machine_id,vehiculo_id&order=codigo.asc"
  ).catch(()=>[]);

  const options=(devices||[]).map(d=>
    '<option value="'+esc(d.id)+'">'+esc([d.codigo,d.nombre_equipo,d.tipo_dispositivo].filter(Boolean).join(" · "))+'</option>'
  ).join("");

  const now=new Date();
  const weekAgo=new Date(now.getTime()-7*24*60*60*1000);
  const dayStart=new Date(now); dayStart.setHours(8,0,0,0);
  const dayEnd=new Date(now); dayEnd.setHours(16,0,0,0);

  const card=document.createElement("div");
  card.className="card";
  card.style.marginTop="16px";
  card.innerHTML=`
    <div class="section-head">
      <div>
        <h3>Consulta histórica GPS</h3>
        <p>Busca dónde estaba un equipo en una fecha y hora concreta o revisa su recorrido durante un intervalo.</p>
      </div>
    </div>

    <div class="grid two">
      <div>
        <h4 style="margin-top:0">¿Dónde estaba?</h4>
        <div class="form-grid">
          <div>
            <label>Dispositivo</label>
            <select id="gpsExactDevice">
              <option value="">Seleccionar…</option>
              ${options}
            </select>
          </div>
          <div>
            <label>Fecha y hora</label>
            <input id="gpsExactMoment" type="datetime-local" value="${esc(gpsLocalInputValue(weekAgo))}">
          </div>
        </div>
        <button id="gpsExactBtn" class="btn" type="button">Buscar posición</button>
        <div id="gpsExactResult" style="margin-top:12px"></div>
      </div>

      <div>
        <h4 style="margin-top:0">Recorrido por intervalo</h4>
        <div class="form-grid">
          <div>
            <label>Dispositivo</label>
            <select id="gpsRangeDevice">
              <option value="">Seleccionar…</option>
              ${options}
            </select>
          </div>
          <div>
            <label>Desde</label>
            <input id="gpsRangeFrom" type="datetime-local" value="${esc(gpsLocalInputValue(dayStart))}">
          </div>
          <div>
            <label>Hasta</label>
            <input id="gpsRangeTo" type="datetime-local" value="${esc(gpsLocalInputValue(dayEnd))}">
          </div>
        </div>
        <button id="gpsRangeBtn" class="btn secondary" type="button">Ver recorrido</button>
        <div id="gpsRangeResult" style="margin-top:12px"></div>
      </div>
    </div>
  `;

  host.appendChild(card);

  $("gpsExactBtn")?.addEventListener("click",async ()=>{
    const id=$("gpsExactDevice").value;
    const raw=$("gpsExactMoment").value;
    const out=$("gpsExactResult");

    if(!id || !raw){
      out.innerHTML='<div class="error">Selecciona un dispositivo y una fecha/hora.</div>';
      return;
    }

    const target=new Date(raw);
    if(Number.isNaN(target.getTime())){
      out.innerHTML='<div class="error">La fecha u hora no es válida.</div>';
      return;
    }

    out.innerHTML='<div class="muted">Buscando la posición más cercana…</div>';

    try{
      const rows=await sb("/rest/v1/rpc/gps_posicion_cercana",{
        method:"POST",
        body:JSON.stringify({
          p_dispositivo_id:id,
          p_momento:target.toISOString()
        })
      });

      const p=(rows||[])[0];
      if(!p){
        out.innerHTML='<div class="muted">No hay posiciones guardadas para este dispositivo.</div>';
        return;
      }

      const diff=Number(p.diferencia_segundos)||0;
      const far=diff>30*60;
      const gm=gpsGoogleMapsUrl(p.latitud,p.longitud);

      out.innerHTML=`
        <div class="module-note ${far ? "sensitive-note" : ""}">
          <b>${far ? "Posición más cercana disponible" : "Posición encontrada"}</b>
          <div style="margin-top:6px">
            Solicitada: ${esc(target.toLocaleString())}<br>
            Registrada: <b>${esc(new Date(p.registrado_en).toLocaleString())}</b><br>
            Diferencia: ${esc(gpsDiffText(diff))}
          </div>
        </div>

        <div class="detail-grid" style="margin-top:10px">
          <div class="kv"><b>Coordenadas</b><span>${esc(Number(p.latitud).toFixed(7))}, ${esc(Number(p.longitud).toFixed(7))}</span></div>
          <div class="kv"><b>Precisión</b><span>${esc(p.precision_m ?? "—")} m</span></div>
          <div class="kv"><b>Velocidad</b><span>${esc(p.velocidad_kmh ?? "—")} km/h</span></div>
          <div class="kv"><b>Batería</b><span>${esc(p.bateria_pct ?? "—")}${p.bateria_pct!=null?"%":""}</span></div>
          <div class="kv"><b>Ignición</b><span>${esc(p.ignicion==null?"—":(p.ignicion?"Sí":"No"))}</span></div>
        </div>

        <div class="row" style="margin-top:10px">
          <button id="gpsExactMapBtn" class="btn secondary" type="button">Ver aquí en el mapa</button>
          <a class="btn secondary" href="${esc(gm)}" target="_blank" rel="noopener noreferrer">Abrir en Google Maps</a>
        </div>

        ${far ? '<div class="muted" style="margin-top:8px">El GPS no registró un punto suficientemente cercano a la hora solicitada; por eso se muestra la posición disponible más próxima.</div>' : ""}
      `;

      $("gpsExactMapBtn")?.addEventListener("click",()=>{
        renderLocalMap(
          p.latitud,
          p.longitud,
          "Posición histórica",
          "Registrada: "+new Date(p.registrado_en).toLocaleString()
        );
        $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
      });
    }catch(err){
      out.innerHTML='<div class="error">'+esc(err.message)+'</div>';
    }
  });

  $("gpsRangeBtn")?.addEventListener("click",async ()=>{
    const id=$("gpsRangeDevice").value;
    const fromRaw=$("gpsRangeFrom").value;
    const toRaw=$("gpsRangeTo").value;
    const out=$("gpsRangeResult");

    if(!id || !fromRaw || !toRaw){
      out.innerHTML='<div class="error">Selecciona un dispositivo y el intervalo completo.</div>';
      return;
    }

    const from=new Date(fromRaw);
    const to=new Date(toRaw);
    if(Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to<=from){
      out.innerHTML='<div class="error">El intervalo no es válido.</div>';
      return;
    }

    out.innerHTML='<div class="muted">Cargando recorrido…</div>';

    try{
      const rows=await sb(
        "/rest/v1/gps_posiciones?dispositivo_id=eq."+encodeURIComponent(id)+
        "&registrado_en=gte."+encodeURIComponent(from.toISOString())+
        "&registrado_en=lte."+encodeURIComponent(to.toISOString())+
        "&select=id,registrado_en,latitud,longitud,precision_m,velocidad_kmh,bateria_pct,ignicion"+
        "&order=registrado_en.asc&limit=1000"
      );

      if(!(rows||[]).length){
        out.innerHTML='<div class="muted">No hay posiciones guardadas en ese intervalo.</div>';
        return;
      }

      let distance=0;
      for(let i=1;i<rows.length;i++){
        distance+=gpsHaversineClient(rows[i-1],rows[i]);
      }

      const duration=(new Date(rows[rows.length-1].registrado_en)-new Date(rows[0].registrado_en))/1000;
      const maxRows=200;
      const step=Math.max(1,Math.ceil(rows.length/maxRows));
      const shown=rows.filter((_,i)=>i%step===0 || i===rows.length-1);
      const start=rows[0];
      const end=rows[rows.length-1];

      const table=shown.map((p,i)=>`
        <tr>
          <td>${esc(new Date(p.registrado_en).toLocaleString())}</td>
          <td>${esc(Number(p.latitud).toFixed(6))}, ${esc(Number(p.longitud).toFixed(6))}</td>
          <td>${esc(p.velocidad_kmh ?? "—")}</td>
          <td>${esc(p.bateria_pct ?? "—")}</td>
          <td>
            <a class="linkbtn" href="${esc(gpsGoogleMapsUrl(p.latitud,p.longitud))}" target="_blank" rel="noopener noreferrer">Google Maps</a>
          </td>
        </tr>
      `).join("");

      out.innerHTML=`
        <div class="grid cards">
          <div class="card"><div class="metric-label">Puntos recibidos</div><div class="metric">${rows.length}</div></div>
          <div class="card"><div class="metric-label">Distancia GPS aprox.</div><div class="metric">${distance>=1000 ? (distance/1000).toFixed(1)+" km" : Math.round(distance)+" m"}</div></div>
          <div class="card"><div class="metric-label">Tiempo entre primer/último punto</div><div class="metric">${esc(gpsDiffText(duration))}</div></div>
        </div>

        <div class="row" style="margin:10px 0">
          <button id="gpsRangeStartMap" class="btn secondary" type="button">Ver inicio</button>
          <button id="gpsRangeEndMap" class="btn secondary" type="button">Ver final</button>
          <a class="btn secondary" href="${esc(gpsGoogleMapsUrl(start.latitud,start.longitud))}" target="_blank" rel="noopener noreferrer">Inicio en Google Maps</a>
          <a class="btn secondary" href="${esc(gpsGoogleMapsUrl(end.latitud,end.longitud))}" target="_blank" rel="noopener noreferrer">Final en Google Maps</a>
        </div>

        <div class="table-wrap"><table>
          <thead><tr><th>Fecha/hora</th><th>Coordenadas</th><th>km/h</th><th>Batería %</th><th></th></tr></thead>
          <tbody>${table}</tbody>
        </table></div>

        ${rows.length>=1000 ? '<div class="muted" style="margin-top:8px">Se alcanzó el límite de 1.000 posiciones para una consulta. Para recorridos muy largos conviene dividir el intervalo.</div>' : ""}
        ${shown.length<rows.length ? '<div class="muted" style="margin-top:8px">La tabla se ha reducido a una muestra para que siga siendo rápida; los cálculos usan todos los puntos descargados.</div>' : ""}
      `;

      $("gpsRangeStartMap")?.addEventListener("click",()=>{
        renderLocalMap(start.latitud,start.longitud,"Inicio del recorrido",new Date(start.registrado_en).toLocaleString());
        $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
      });

      $("gpsRangeEndMap")?.addEventListener("click",()=>{
        renderLocalMap(end.latitud,end.longitud,"Final del recorrido",new Date(end.registrado_en).toLocaleString());
        $("localMapHost")?.scrollIntoView({behavior:"smooth",block:"start"});
      });
    }catch(err){
      out.innerHTML='<div class="error">'+esc(err.message)+'</div>';
    }
  });
};
