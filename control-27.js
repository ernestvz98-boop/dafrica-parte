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
 '<p class="muted">Modo temporal: separa páginas, lee proveedor, número impreso, fecha, PRY y cada artículo. Conserva los números con coma decimal tal como se imprimen y muestra las lecturas originales si existen diferencias. <b>No archiva PDF, no guarda materiales, no registra costes, no crea albaranes en STEL y no asigna obras.</b></p>'+
 '<label for="pcPreviewFile">PDF a interpretar (sin límite de páginas; división automática en bloques)</label>'+
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
   '<thead><tr><th>Fila</th><th>Referencia</th><th>Descripción interpretada</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th><th>Dto. %</th><th>Importe final</th><th>Lecturas</th></tr></thead><tbody>'+
   rows.map(r=>{
    const statusText=r.estado_lectura==="COINCIDE"?"Coinciden":r.estado_lectura==="COINCIDENCIA_PRINCIPAL"?"Referencia, descripción y cantidad verificadas; importe incompleto":r.estado_lectura==="PARCIAL"?"Referencia y cantidad verificadas; descripción pendiente":r.estado_lectura==="SIN_GEOMETRIA"?"Solo lectura global; filas físicas sin verificar":r.estado_lectura==="DIFERENTE"?"Lecturas discrepantes":"Lectura incompleta";
    const value=Array.isArray(r.lecturas)?r.lecturas:[];
    const literal=Array.isArray(r.lecturas_literales)?r.lecturas_literales:[];
    const extra=literal.length?'<p><b>Columnas transcritas literalmente:</b></p>'+literal.map((x,i)=>
      '<p><b>Transcripción literal '+(i+1)+'</b>: código '+esc(x.referencia||"vacío")+
      ' · cantidad «'+esc(x.cantidad_impresa||"ilegible")+'» · precio «'+esc(x.precio_impreso||"en blanco")+
      '» · descuento «'+esc(x.descuento_impreso||"en blanco")+'» · importe «'+
      esc(x.importe_impreso||"en blanco")+'»</p>').join(""):"";
    const codeWarning=r.codigo_formato_no_confirmado?
      '<p><b>Atención:</b> «'+esc(r.referencia_candidata||"")+
      '» apareció como referencia candidata, pero su formato no coincide con la columna de código del proveedor; no se considera verificada.</p>':"";
    const evidence=value.length||literal.length?'<details><summary>'+esc(statusText)+(r.campos_diferentes?.length?' ('+esc(r.campos_diferentes.join(", "))+')':'')+'</summary>'+
       value.map((x,i)=>'<p><b>Lectura '+(i+1)+'</b>: '+esc(x.referencia||"sin referencia")+' | '+esc(x.descripcion||"sin descripción")+
       ' | Cant. '+esc(x.cantidad??"no legible")+' | '+esc(x.unidad||"sin unidad")+
       ' | Precio '+esc(x.precio_unitario??"no consta")+'</p>').join("")+extra+codeWarning+'</details>':'No disponible';
    return '<tr><td>'+esc(r.fila)+'</td><td>'+esc(r.referencia||"—")+'</td>'+
      '<td>'+esc(r.descripcion||"No legible")+'</td><td>'+esc(r.cantidad_impresa||((r.cantidad??"—")) )+'</td>'+
      '<td>'+esc(!r.unidad||/^(n\/a|none|null)$/i.test(r.unidad)?"—":r.unidad)+'</td><td>'+esc(r.precio_impreso||(r.precio_unitario??"No consta"))+'</td>'+ 
      '<td>'+esc(r.descuento_impreso||(r.descuento??"—"))+'</td><td>'+esc(r.importe_impreso||(r.importe??"—"))+'</td><td>'+evidence+'</td></tr>';
   }).join("")+'</tbody></table></div>';
 };
 const renderResult=(r,source,index)=>{
  if(r.estado!=="DETERMINISTA"&&r.determinista?.tipo_pdf==="ESCANEADO_OCR"&&r.determinista.lineas?.length){
   const det=r.determinista;
   return '<details open style="border:1px solid #d6dee8;border-radius:8px;padding:12px;margin:9px 0">'+
    '<summary>'+esc(det.numero?.valor||"Número pendiente")+' · '+esc(det.lineas.length)+
    ' artículos leídos con OCR local · requiere revisión</summary>'+pcRenderDeterminista(det)+
    '<details><summary>Comparar con la interpretación de IA (puede contener discrepancias)</summary>'+
    renderResult({...r,determinista:null},source,index)+'</details></details>';
  }
  if(r.estado==="DETERMINISTA")return '<details open style="border:1px solid #d6dee8;border-radius:8px;padding:12px;margin:9px 0">'+
    '<summary style="cursor:pointer;font-weight:bold">'+esc(r.determinista.numero?.valor||source?.numero||"Sin número")+' · '+
    esc(r.determinista.proveedor?.nombre||"")+' · '+esc(r.determinista.lineas.length)+' líneas · verificado sin IA</summary>'+
    pcRenderDeterminista(r.determinista)+'<p class="muted">Lectura temporal n.º '+esc(index+1)+'. No se ha guardado ni enviado a STEL.</p></details>';
  r={...r,proveedor:pcProveedorMostrable(r.proveedor)};
  const number=String(r.numero||source?.numero||"Sin número impreso");
  const problems=Array.isArray(r.avisos)?[...new Set(r.avisos.map(x=>String(x).trim()).filter(Boolean))]:[];
  const verified=r.lectura_completa===true;
  const count=Number(r.lineas_detectadas||0);
  const checked=Number(r.filas_principales_comprobadas||0);
  const coverage=count>0?checked+"/"+count+" filas con referencia, descripción y cantidad contrastadas":"sin filas verificadas";
  const title='<summary style="cursor:pointer;font-weight:bold">'+esc(number)+
    ' · '+esc(r.proveedor||pcProveedorMostrable(source?.proveedor)||"Proveedor no identificado")+
    ' · '+esc(count)+' líneas · '+esc(coverage)+
    (verified?' · cabecera y líneas verificadas':' · interpretación parcial')+'</summary>';
  const c=r.cabecera||{};
  const header='<p><b>Número impreso:</b> '+esc(number)+' · <b>Fecha:</b> '+esc(r.fecha||"No comprobada")+
    ' · <b>Proveedor:</b> '+esc(r.proveedor||"No identificado")+'</p>'+
    '<p><b>Obra impresa:</b> '+esc(r.obra_impresa||"No consta")+
    ' · <b>PRY manuscrito (no confirmado en STEL):</b> '+esc(r.pry_codigo||"No identificado")+
    (r.anotacion_manual?'<br><b>Otras anotaciones:</b> '+esc(r.anotacion_manual):"")+
    ' · <b>Filas:</b> '+esc(coverage)+
    ' · <b>Cabecera:</b> '+(verified?'Contrastada':'No completamente contrastada')+'</p>';
  const alt=Array.isArray(r.cabeceras_leidas)&&r.cabeceras_leidas.length?
    '<details><summary>Ver las lecturas de la cabecera</summary>'+
      r.cabeceras_leidas.map((h,i)=>'<p>Lectura '+(i+1)+': '+esc(join([h.numero,h.proveedor,h.fecha], " / "))+'</p>').join("")+'</details>':"";
  const deterministic=r.determinista&&r.determinista.tipo_pdf!=="ESCANEADO"?
    '<details><summary>Ver lectura determinista del PDF digital (sin IA)</summary>'+pcRenderDeterminista(r.determinista)+'</details>':"";
  return '<details open style="border:1px solid #d6dee8;border-radius:8px;padding:12px;margin:9px 0">'+
    title+header+alt+lineTable(r)+deterministic+
    (problems.length?'<details><summary>'+esc(problems.length)+' observaciones OCR (no son necesariamente errores)</summary>'+
      problems.map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")+'</details>':'')+
    '<p class="muted">Lectura temporal n.º '+esc(index+1)+'. No se ha guardado ni enviado a STEL.</p>'+
   '</details>';
 };
 button.addEventListener("click",async()=>{
  const upload=file.files?.[0];
  if(!upload||!consent.checked){status.textContent="Selecciona un PDF y autoriza su análisis temporal.";return}
  if(!/\.pdf$/i.test(upload.name)||upload.size<100){
    status.textContent="El archivo debe ser un PDF válido.";return
  }
  const run=++currentRun;
  button.disabled=true;results.textContent="";status.textContent="Separando páginas del PDF sin guardar archivos…";
  try{
   const PDFDocument=await pcLoadPdfLib();
   const split=await window.DafricaAlbaranes.lotesPdf.procesar({
    PDFDocument,bytes:new Uint8Array(await upload.arrayBuffer()),
    progreso:t=>{if(run===currentRun)status.textContent=t},
    separar:(data)=>sb("/functions/v1/compras-lote-piloto",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name:upload.name,mime:"application/pdf",data:"data:application/pdf;base64,"+data})}),
    liberar:()=>window.DafricaAlbaranes.motorNavegador.cerrar(),
    alResultado:(r,d,i)=>{if(run===currentRun)results.insertAdjacentHTML("beforeend",r?.error?
      '<p class="error">'+esc(r.error)+'</p>':renderResult(r,d,i))},
    interpretar:async(d,index,total)=>{
     let result;
     // PDF digital: lectura exacta del texto. Si todo cuadra no se usa la IA.
     let det=null;
     try{det=await pcLecturaDeterminista(d)}catch(e){console.warn("Lectura determinista no disponible",String(e).slice(0,120))}
     // PDF escaneado: OCR local con el mismo lector (las cifras solo se aceptan si cuadran).
     if(det?.estado==="NO_DIGITAL"){
       try{det=await pcLecturaOCR(d,t=>{if(run===currentRun)status.textContent="Documento "+(index+1)+" de "+total+" · "+t})}
       catch(e){console.warn("Lectura OCR no disponible",String(e).slice(0,120))}
     }
     if(det?.estado==="AUTO_OK"){return {estado:"DETERMINISTA",determinista:det}}
     // Las imágenes para geometría e IA también deben recibir la orientación
     // que detectó el OCR. Antes se enviaba otra vez el escaneo de lado.
     if(det?.tipo_pdf==="ESCANEADO_OCR"){
       d.pdf_separado_b64=await window.DafricaAlbaranes.lotesPdf.enderezar(PDFDocument,d.pdf_separado_b64,det.orientacion);
       if(det.numero?.estado==="OK"&&det.numero.confianza>=0.9)d.numero=det.numero.valor;
       if(det.fecha?.estado==="OK"&&det.fecha.confianza>=0.9)d.fecha=det.fecha.valor;
     }
     let n=null,rows=null,bands=null,columnHints=null,header=null,profile="",noRef=false,warning="";
     const perfilLocal=det?.proveedor?.id;
     if(((d.lineas||[]).length<=5||String(d.proveedor||"").toUpperCase().includes("SALTOKI"))&&
        (!perfilLocal||["SALTOKI","RODAVI","MADERAS_PEREIRA"].includes(perfilLocal))){
       try{
         const geo=String(d.proveedor||"").toUpperCase().includes("SALTOKI")?
            ((d.lineas||[]).length===1?await pcLeerSaltokiFilaUnica(d):await pcLeerSaltokiFilas(d)):
            await pcLeerTablaMixta(d);
         if(geo?.lineas_validas&&Number.isInteger(geo.numero_filas_geometricas)&&
            geo.numero_filas_geometricas===geo.lineas?.length){
           n=geo.numero_filas_geometricas;rows=geo.lineas;bands=geo.imagenes_zonas;columnHints=geo.imagen_columnas||null;
           header=geo.imagen_cabecera||null;profile=geo.perfil_formato||"";
           noRef=geo.permite_sin_referencia===true;
         }else warning=geo?.geometria_razon||"La geometría de tabla no es concluyente";
       }catch(e){warning="No pudo delimitarse la tabla física: "+String(e?.message||e)}
     }
     try{
       const res=await authFetch(SUPABASE_URL+"/functions/v1/compras-interpretar-v2",{
         method:"POST",headers:{"Content-Type":"application/json"},
         body:JSON.stringify({
           data:"data:application/pdf;base64,"+d.pdf_separado_b64,
           numero_esperado:d.numero||"",proveedor_esperado:d.proveedor||"",fecha_esperada:d.fecha||null,
           lineas_geometricas:n,geometria_filas:rows,geometria_imagenes:bands,imagen_columnas:columnHints,imagen_cabecera:header,
           perfil_formato:profile,permite_sin_referencia:noRef
         })
       });
       const value=await res.json().catch(()=>({error:"El servidor no devolvió una respuesta válida"}));
       if(!res.ok)result={error:value.error||"La interpretación no está disponible",etapa:value.etapa,warning,determinista:det};
       else result={...value,warning,determinista:det};
     }catch(e){result={error:String(e?.message||e),warning,determinista:det}}
     return result;
    }
   });
   const out=split.out;
   if(run!==currentRun)return;
   const interpreted=out.filter(x=>x&&x.estado==="INTERPRETADO_SIN_GUARDAR");
   const full=interpreted.filter(x=>x.lectura_completa).length;
   const incomplete=interpreted.length-full;
   const deterministic=out.filter(x=>x&&x.estado==="DETERMINISTA").length;
   const failed=out.length-interpreted.length-deterministic;
   const verifiedLines=interpreted.reduce((n,d)=>n+Number(d.filas_principales_comprobadas||0),0);
   const totalLines=interpreted.reduce((n,d)=>n+Number(d.lineas_detectadas||0),0);
   results.innerHTML=(split.fallos.length?'<p class="error">Resultado parcial: '+esc(split.fallos.map(f=>'Páginas '+f.inicio+'–'+f.fin+': '+f.error).join(' · '))+'</p>':"")+'<p><b>'+esc(split.documentos.length)+' documentos separados.</b> <b>'+esc(deterministic)+
     ' verificados sin IA (PDF digital u OCR local)</b>, '+esc(interpreted.length)+
     ' interpretados con IA, <b>'+esc(verifiedLines)+' de '+esc(totalLines)+' filas principales contrastadas físicamente</b>, '+
     esc(full)+' documentos con cabecera y líneas verificadas, '+esc(incomplete)+
     ' con datos pendientes, '+esc(failed)+' sin interpretación. <b>0 documentos archivados.</b></p>'+
     out.map((r,i)=>r?.error?
       '<div class="module-note sensitive-note"><b>'+esc(split.documentos[i]?.numero||"Documento "+(i+1))+
       ' · Sin interpretación</b><p>'+esc(r.error)+'</p>'+(r.determinista?pcRenderDeterminista(r.determinista):"")+'</div>':renderResult(r,split.documentos[i],i)).join("")+
    '<p class="muted"><b>Próxima etapa (no activada):</b> contrastar lectura con STEL, crear albarán autorizado y enlazarlo a una obra verificada.</p>';
   status.textContent=(split.fallos.length?"Interpretación parcial; hay bloques pendientes. ":"Interpretación temporal finalizada. ")+" No se han guardado archivos ni materiales en DAFRICA ni se ha modificado STEL.";
  }catch(e){status.textContent="No se pudo interpretar el lote: "+String(e?.message||e)}
  finally{button.disabled=false}
 });
};
let pcPdfLibPromise=null;
async function pcLoadPdfLib(){
 if(!pcPdfLibPromise)pcPdfLibPromise=import("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.esm.min.js")
  .then(m=>m.PDFDocument).catch(e=>{pcPdfLibPromise=null;throw e});
 return pcPdfLibPromise;
}
