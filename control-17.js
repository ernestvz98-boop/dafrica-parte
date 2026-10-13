"use strict";
async function renderUbicalyKm(embedded=false){
  if(!embedded) setTopbar("Kilometraje mensual", "Datos de Ubicaly · sin duplicar GPS");
  const now=new Date();const ym=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
  const markup = '<div class="card"><h2>Informe mensual de vehículos</h2><p class="muted">Consulta los recorridos existentes en Ubicaly. No se almacena el historial de posiciones.</p><div class="form-grid"><div><label>Mes</label><input type="month" id="ubMonth" value="'+ym+'"></div><div style="display:flex;align-items:end;gap:8px"><button class="btn" type="button" id="ubRun">Consultar flota</button><button class="btn secondary" type="button" id="ubCSV" disabled>Exportar CSV</button></div></div><div id="ubStatus" class="statusline muted" aria-live="polite"></div><div id="ubResults"></div></div>';
  if(embedded) $("content").insertAdjacentHTML("beforeend", markup);
  else setContent(markup);
  let rows=[];
  $("ubCSV").addEventListener("click",()=>{
    const headers=["vehiculo_id","matricula","nombre","mes","km","trayectos","estado"];
    const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
    const csv=[headers.join(";"),...rows.map(r=>[r.vehicleId,r.plate,r.name,r.month,r.km,r.trips,r.status].map(cell).join(";"))].join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="DAFRICA_kilometraje_"+$("ubMonth").value+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("ubRun").addEventListener("click",async()=>{
    const mes=$("ubMonth").value;const stat=$("ubStatus");const btn=$("ubRun");
    if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(mes)){stat.textContent="Selecciona un mes válido.";return;}
    btn.disabled=true;$("ubCSV").disabled=true;stat.textContent="Consultando recorridos de Ubicaly…";$("ubResults").innerHTML="";
    try{
      const data=await sb("/functions/v1/ubicaly-kilometraje",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({month:mes})});
      rows=data.vehicles||[];
      const fmt=v=>Number(v).toLocaleString("es-ES",{maximumFractionDigits:2,minimumFractionDigits:2});
      const valid=rows.filter(x=>Number.isFinite(x.km));const total=valid.reduce((a,x)=>a+x.km,0);
      $("ubResults").innerHTML='<div class="summarybar"><div class="summaryitem"><b>'+rows.length+'</b> vehículos</div><div class="summaryitem"><b>'+fmt(total)+'</b> km registrados</div><div class="summaryitem"><b>'+rows.filter(x=>x.status==="error").length+'</b> errores</div></div><div class="tablewrap"><table><thead><tr><th>Matrícula</th><th>Vehículo</th><th>Km</th><th>Trayectos</th><th>Estado</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.plate||r.vehicleId)+'</td><td>'+esc(r.name||"—")+'</td><td>'+ (Number.isFinite(r.km)?fmt(r.km):"—")+'</td><td>'+esc(r.trips)+'</td><td>'+esc(r.error||r.status)+'</td></tr>').join("")+'</tbody></table></div><p class="smallnote">'+esc(data.note||"")+'</p>';
      stat.textContent="Consulta completada. Comprueba la cobertura histórica antes de utilizar el resultado como cierre mensual.";
      $("ubCSV").disabled=!rows.length;
    }catch(e){stat.textContent="No se pudo consultar Ubicaly: "+(e.message||String(e));}
    finally{btn.disabled=false;}
  });
}
