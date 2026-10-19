"use strict";
/*
 * DAFRICA PDF Reader (temporary mode).
 * Overrides old auto-archive UI at the same entry point.
 * No stored history, no retries from Supabase and no write calls.
 * Files remain in browser RAM and are sent only to temporary OCR service.
 */
renderComprasLotePilot=function renderComprasTemporal(){
 const root=$("pcBatch");if(!root||!has("costes.ver"))return;
 root.innerHTML='<div class="card">'+
 '<h3>Interpretar albaranes de PDF · SIN GUARDAR</h3>'+
 '<p class="muted">Modo temporal: separa páginas, lee proveedor, número impreso, fecha, PRY y cada artículo. Si hay dos interpretaciones distintas, muestra las dos para contrastarlas. <b>No archiva PDF, no guarda materiales, no registra costes, no crea albaranes en STEL y no asigna obras.</b></p>'+
 '<label for="pcPreviewFile">PDF a interpretar (máximo 6 MB y 10 páginas por lote)</label>'+
 '<input type="file" id="pcPreviewFile" accept=".pdf,application/pdf">'+
 '<label style="display:flex;align-items:center;gap:8px;margin:12px 0">'+
 '<input type="checkbox" style="width:auto" id="pcPreviewConsent">'+
 '<span>Autorizo el análisis temporal de este PDF mediante IA externa. No se archivará en DAFRICA.</span></label>'+
 '<button type="button" class="btn" id="pcPreviewStart">Interpretar PDF (sin guardar)</button>'+
 '<p class="muted" role="status" id="pcPreviewStatus">Selecciona un PDF.</p>'+
 '<div id="pcPreviewResults"></div>'+
 '<p class="muted">El historial anterior de Supabase se conserva intacto, pero esta pantalla no lo utiliza. Cerrar o actualizar la página elimina las lecturas de esta sesión.</p>'+
 '</div>';
 const file=$("pcPreviewFile"),consent=$("pcPreviewConsent"),button=$("pcPreviewStart"),
   status=$("pcPreviewStatus"),results=$("pcPreviewResults");
 let currentRun=0;
 const join=(values,sep=" · ")=>values.filter(Boolean).join(sep);
 const lineTable=d=>{
  const rows=Array.isArray(d.lineas)?d.lineas:[];
  if(!rows.length)return '<p class="muted">Sin filas fiables en la tabla. Se necesita una lectura de mayor calidad.</p>';
  return '<div class="table-wrap" style="overflow:auto;max-height:700px"><table>'+
   '<thead><tr><th>Fila</th><th>Referencia</th><th>Descripción interpretada</th><th>Cantidad</th><th>Unidad</th><th>Precio impreso</th><th>Lecturas</th></tr></thead><tbody>'+
   rows.map(r=>{
    const statusText=r.estado_lectura==="COINCIDE"?"Coinciden":r.estado_lectura==="DIFERENTE"?"Difieren":"Lectura incompleta";
    const value=Array.isArray(r.lecturas)?r.lecturas:[];
    const evidence=value.length?'<details><summary>'+esc(statusText)+(r.campos_diferentes?.length?' ('+esc(r.campos_diferentes.join(", "))+')':'')+'</summary>'+
       value.map((x,i)=>'<p><b>Lectura '+(i+1)+'</b>: '+esc(x.referencia||"sin referencia")+' | '+esc(x.descripcion||"sin descripción")+
       ' | Cant. '+esc(x.cantidad??"no legible")+' | '+esc(x.unidad||"sin unidad")+
       ' | Precio '+esc(x.precio_unitario??"no consta")+'</p>').join("")+'</details>':'No disponible';
    return '<tr><td>'+esc(r.fila)+'</td><td>'+esc(r.referencia||"—")+'</td>'+
      '<td>'+esc(r.descripcion||"No legible")+'</td><td>'+esc(r.cantidad??"—")+'</td>'+
      '<td>'+esc(r.unidad||"—")+'</td><td>'+esc(r.precio_unitario??"No consta")+'</td><td>'+evidence+'</td></tr>';
   }).join("")+'</tbody></table></div>';
 };
 const renderResult=(r,source,index)=>{
  const number=String(r.numero||source?.numero||"Sin número impreso");
  const problems=Array.isArray(r.avisos)?r.avisos:[];
  const verified=r.lectura_completa===true;
  const title='<summary style="cursor:pointer;font-weight:bold">'+esc(number)+
    ' · '+esc(r.proveedor||source?.proveedor||"Proveedor no identificado")+
    ' · '+esc(r.lineas_detectadas??0)+' líneas'+
    ' · '+(verified?'Lecturas concordantes':'Interpretación con dudas')+'</summary>';
  const c=r.cabecera||{};
  const header='<p><b>Número impreso:</b> '+esc(number)+' · <b>Fecha:</b> '+esc(r.fecha||"No comprobada")+
    ' · <b>Proveedor:</b> '+esc(r.proveedor||"No identificado")+'</p>'+
    '<p><b>Obra impresa:</b> '+esc(r.obra_impresa||"No consta")+
    ' · <b>PRY manuscrito:</b> '+esc(r.pry_literal||r.pry_codigo||"No consta")+
    ' · <b>Estado:</b> '+(verified?'Lectura concordante':'Hay campos o filas por corroborar')+'</p>';
  const alt=Array.isArray(r.cabeceras_leidas)&&r.cabeceras_leidas.length?
    '<details><summary>Ver las lecturas de la cabecera</summary>'+
      r.cabeceras_leidas.map((h,i)=>'<p>Lectura '+(i+1)+': '+esc(join([h.numero,h.proveedor,h.fecha], " / "))+'</p>').join("")+'</details>':"";
  return '<details open style="border:1px solid #d6dee8;border-radius:8px;padding:12px;margin:9px 0">'+
    title+header+alt+lineTable(r)+
    (problems.length?'<details><summary>'+esc(problems.length)+' advertencias de interpretación</summary>'+
      problems.map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")+'</details>':'')+
    '<p class="muted">Lectura temporal n.º '+esc(index+1)+'. No se ha guardado ni enviado a STEL.</p>'+
   '</details>';
 };
 button.addEventListener("click",async()=>{
  const upload=file.files?.[0];
  if(!upload||!consent.checked){status.textContent="Selecciona un PDF y autoriza su análisis temporal.";return}
  if(!/\.pdf$/i.test(upload.name)||upload.size>6000000||upload.size<100){
    status.textContent="El archivo debe ser un PDF de hasta 6 MB.";return
  }
  const run=++currentRun;
  button.disabled=true;results.textContent="";status.textContent="Separando páginas del PDF sin guardar archivos…";
  try{
   const contents=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error("No se pudo leer el archivo"));reader.readAsDataURL(upload);
   });
   const split=await sb("/functions/v1/compras-lote-piloto",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name:upload.name,mime:"application/pdf",data:contents})});
   if(!Array.isArray(split.documentos)||split.documentos.length<1)
     throw Error("No se pudieron separar los documentos de este PDF");
   const pageMap=split.documentos.flatMap(d=>d.paginas||[]);
   if(new Set(pageMap).size!==pageMap.length||pageMap.length!==split.paginas_pdf)
     throw Error("El separador encontró páginas repetidas o sin asignar; no se pueden interpretar como albaranes independientes");
   const tasks=split.documentos.map((d,index)=>({d,index})),out=[];
   const worker=async()=>{
    while(tasks.length){
     const item=tasks.shift();if(!item)break;
     const {d,index}=item;
     status.textContent="Interpretando "+(index+1)+" de "+split.documentos.length+
       " · "+String(d.numero||"documento sin identificar");
     if(!d.pdf_separado_b64){out[index]={error:"No se pudo separar el PDF de este documento"};continue}
     let n=null,rows=null,bands=null,header=null,profile="",noRef=false,warning="";
     if((d.lineas||[]).length<=5||String(d.proveedor||"").toUpperCase().includes("SALTOKI")){
       try{
         const geo=String(d.proveedor||"").toUpperCase().includes("SALTOKI")?
            ((d.lineas||[]).length===1?await pcLeerSaltokiFilaUnica(d):await pcLeerSaltokiFilas(d)):
            await pcLeerTablaMixta(d);
         if(geo?.lineas_validas&&Number.isInteger(geo.numero_filas_geometricas)&&
            geo.numero_filas_geometricas===geo.lineas?.length){
           n=geo.numero_filas_geometricas;rows=geo.lineas;bands=geo.imagenes_zonas;
           header=geo.imagen_cabecera||null;profile=geo.perfil_formato||"";
           noRef=geo.permite_sin_referencia===true;
         }else warning=geo?.geometria_razon||"La geometría de tabla no es concluyente";
       }catch(e){warning="No pudo delimitarse la tabla física: "+String(e?.message||e)}
     }
     try{
       const res=await authFetch(SUPABASE_URL+"/functions/v1/compras-interpretar-v1",{
         method:"POST",headers:{"Content-Type":"application/json"},
         body:JSON.stringify({
           data:"data:application/pdf;base64,"+d.pdf_separado_b64,
           numero_esperado:d.numero||"",proveedor_esperado:d.proveedor||"",fecha_esperada:d.fecha||null,
           lineas_geometricas:n,geometria_filas:rows,geometria_imagenes:bands,imagen_cabecera:header,
           perfil_formato:profile,permite_sin_referencia:noRef
         })
       });
       const value=await res.json().catch(()=>({error:"El servidor no devolvió una respuesta válida"}));
       if(!res.ok)out[index]={error:value.error||"La interpretación no está disponible",etapa:value.etapa,warning};
       else out[index]={...value,warning};
     }catch(e){out[index]={error:String(e?.message||e),warning}}
    }
   };
   await Promise.all(Array.from({length:Math.min(2,tasks.length)},()=>worker()));
   if(run!==currentRun)return;
   const interpreted=out.filter(x=>x&&x.estado==="INTERPRETADO_SIN_GUARDAR");
   const full=interpreted.filter(x=>x.lectura_completa).length;
   const incomplete=interpreted.length-full;
   const failed=out.length-interpreted.length;
   results.innerHTML='<p><b>'+esc(split.documentos.length)+' documentos separados.</b> '+esc(interpreted.length)+
     ' interpretados, '+esc(full)+' con lecturas concordantes, '+esc(incomplete)+
     ' con campos por comprobar, '+esc(failed)+' sin interpretación. <b>0 documentos archivados.</b></p>'+
     out.map((r,i)=>r?.error?
       '<div class="module-note sensitive-note"><b>'+esc(split.documentos[i]?.numero||"Documento "+(i+1))+
       ' · Sin interpretación</b><p>'+esc(r.error)+'</p></div>':renderResult(r,split.documentos[i],i)).join("")+
    '<p class="muted"><b>Próxima etapa (no activada):</b> contrastar lectura con STEL, crear albarán autorizado y enlazarlo a una obra verificada.</p>';
   status.textContent="Interpretación temporal finalizada. No se han guardado archivos ni materiales en DAFRICA ni se ha modificado STEL.";
  }catch(e){status.textContent="No se pudo interpretar el lote: "+String(e?.message||e)}
  finally{button.disabled=false}
 });
};