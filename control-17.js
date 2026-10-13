"use strict";
async function renderUbicalyKm(embedded=false){
 if(!embedded) setTopbar("Kilometraje mensual","Control de kilómetros y mantenimientos");
 const now=new Date(), prev=new Date(now.getFullYear(),now.getMonth()-1,1);
 const ym=prev.getFullYear()+"-"+String(prev.getMonth()+1).padStart(2,"0");
 const markup='<div class="card"><h2>Kilometraje, consumo y mantenimiento</h2><p class="muted">Distancias: Ubicaly · Litros y coste: pendiente STEL Order · Revisiones: kilometraje verificado.</p><div class="form-grid"><div><label>Mes</label><input type="month" id="ubMonth" value="'+ym+'"></div><div style="display:flex;align-items:end;gap:8px"><button class="btn" type="button" id="ubRun">Actualizar informe</button><button class="btn secondary" type="button" id="ubCSV" disabled>Exportar CSV</button></div></div><div id="ubStatus" class="statusline muted" aria-live="polite"></div><div id="ubResults"></div></div>';
 if(embedded) $("content").insertAdjacentHTML("beforeend",markup);else setContent(markup);
 let rows=[],config=[];
 const key=p=>String(p||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
 const fmt=x=>Number(x).toLocaleString("es-ES",{maximumFractionDigits:2,minimumFractionDigits:2});
 const confFor=p=>config.find(x=>key(x.matricula)===key(p));
 async function loadPlans(){
   try{config=await sb("/rest/v1/vehiculos_control_km?select=matricula,odometro_verificado_km,fecha_lectura,proxima_revision_km,intervalo_revision_km,observaciones");}
   catch(e){config=[];$("ubStatus").textContent="No se pudo consultar configuración de mantenimiento: "+e.message;}
 }
 function maintenance(c){
   if(!c||c.proxima_revision_km==null)return "Sin programar";
   if(c.odometro_verificado_km==null)return "Falta odómetro";
   const faltan=Number(c.proxima_revision_km)-Number(c.odometro_verificado_km);
   return faltan<=0?"REVISIÓN VENCIDA":faltan<=500?"Próxima · "+fmt(faltan)+" km":"Faltan "+fmt(faltan)+" km";
 }
 function display(){
   const valid=rows.filter(x=>Number.isFinite(x.km)),total=valid.reduce((a,x)=>a+x.km,0);
   const overdue=config.filter(c=>c.proxima_revision_km!=null&&c.odometro_verificado_km!=null&&Number(c.odometro_verificado_km)>=Number(c.proxima_revision_km));
   $("ubResults").innerHTML='<div class="summarybar"><div class="summaryitem"><b>'+rows.length+'</b> vehículos Ubicaly</div><div class="summaryitem"><b>'+fmt(total)+'</b> km en el mes</div><div class="summaryitem"><b>'+overdue.length+'</b> revisiones vencidas verificadas</div></div>'+
     (overdue.length?'<div class="error"><b>Revisión por kilometraje:</b> '+esc(overdue.map(c=>c.matricula).join(", "))+'. Verificar el odómetro antes de programar la intervención.</div>':"")+
     '<div class="tablewrap"><table><thead><tr><th>Matrícula</th><th>Km del mes</th><th>Litros STEL</th><th>L/100 km</th><th>Odómetro verificado</th><th>Mantenimiento</th><th>Configurar</th></tr></thead><tbody>'+
     rows.map(r=>{const c=confFor(r.plate);return '<tr><td>'+esc(r.plate||r.vehicleId)+'</td><td>'+(Number.isFinite(r.km)?fmt(r.km):"—")+'</td><td>Pendiente</td><td>—</td><td>'+(c?.odometro_verificado_km!=null?fmt(c.odometro_verificado_km)+" km":"Sin verificar")+'</td><td>'+esc(maintenance(c))+'</td><td><button type="button" class="btn secondary ubEdit" data-plate="'+esc(r.plate||"")+'">Revisión</button></td></tr>';}).join("")+'</tbody></table></div>'+
     '<p class="muted">L/100 km = litros repostados ÷ kilómetros recorridos × 100 (consumo aparente). Sin datos STEL no se calcula. El kilometraje GPS mensual no equivale al odómetro total del vehículo.</p>'+
     '<div id="ubEditPanel"></div>';
   document.querySelectorAll(".ubEdit").forEach(b=>b.addEventListener("click",()=>editPlan(b.dataset.plate)));
 }
 function editPlan(plate){
   const c=confFor(plate)||{};
   $("ubEditPanel").innerHTML='<div class="card"><h3>Programar revisión · '+esc(plate)+'</h3><p class="muted">Introduce una lectura real y comprobada del cuadro. No sumaremos kilómetros GPS de distintas fuentes como si fueran odómetro oficial.</p><form id="ubPlanForm"><div class="form-grid"><div><label>Odómetro verificado (km)</label><input id="ubOdo" type="number" min="0" step="0.01" required value="'+esc(c.odometro_verificado_km??"")+'"></div><div><label>Fecha de lectura</label><input id="ubDate" type="date" required value="'+esc(c.fecha_lectura||new Date().toISOString().slice(0,10))+'"></div><div><label>Próxima revisión a los (km)</label><input id="ubNext" type="number" min="0" step="0.01" required value="'+esc(c.proxima_revision_km??"")+'"></div><div><label>Intervalo habitual (km), opcional</label><input id="ubInterval" type="number" min="1" step="1" value="'+esc(c.intervalo_revision_km??"")+'"></div></div><button type="submit" class="btn">Guardar plan</button> <span id="ubSaveStatus"></span></form></div>';
   $("ubPlanForm").addEventListener("submit",async e=>{
     e.preventDefault();$("ubSaveStatus").textContent="Guardando…";
     const val=id=>Number($(id).value);
     const payload={matricula:plate,odometro_verificado_km:val("ubOdo"),fecha_lectura:$("ubDate").value,proxima_revision_km:val("ubNext"),intervalo_revision_km:$("ubInterval").value?val("ubInterval"):null};
     try{
       await sb("/rest/v1/vehiculos_control_km?on_conflict=matricula",{method:"POST",headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(payload)});
       await loadPlans();display();
       $("ubStatus").textContent="Plan guardado. La alerta se calcula con la última lectura verificada y se actualizará cuando se registre otra.";
     }catch(err){$("ubSaveStatus").textContent="No se pudo guardar: "+err.message;}
   });
 }
 $("ubCSV").addEventListener("click",()=>{
   const names=["matricula","mes","km_mes","litros_stel","l_100km","odometro_verificado_km","proxima_revision_km","estado_revision"];
   const cell=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
   const csv=[names.join(";"),...rows.map(r=>{const c=confFor(r.plate);return [r.plate,r.month,r.km,"","",c?.odometro_verificado_km,c?.proxima_revision_km,maintenance(c)].map(cell).join(";");})].join("\r\n");
   const url=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));
   const a=document.createElement("a");a.href=url;a.download="DAFRICA_control_vehiculos_"+$("ubMonth").value+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 $("ubRun").addEventListener("click",async()=>{
   const month=$("ubMonth").value,stat=$("ubStatus"),btn=$("ubRun");
   if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){stat.textContent="Selecciona un mes válido.";return;}
   btn.disabled=true;$("ubCSV").disabled=true;stat.textContent="Consultando Ubicaly y revisiones…";
   try{
     const [data]=await Promise.all([sb("/functions/v1/ubicaly-kilometraje",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({month})}),loadPlans()]);
     rows=data.vehicles||[];display();$("ubCSV").disabled=!rows.length;
     stat.textContent="Consulta completada. Distancias provisionales: revisar cobertura histórica antes del cierre mensual.";
   }catch(e){stat.textContent="Error al consultar datos: "+(e.message||String(e));}
   finally{btn.disabled=false;}
 });
 $("ubRun").click();
}
