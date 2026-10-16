"use strict";
// Ingesta automatica V2: una carga, documentos separados, archivados y contrastados.
// No crea entregas ni imputaciones economicas a partir de OCR no verificado.
renderComprasLotePilot = function renderComprasAutonomasV2(){
 const root=$("pcBatch");if(!root||!has("costes.ver"))return;
 root.innerHTML='<div class="card">'+
  '<h3>Albaranes automáticos V3 · OCR por filas</h3>'+
  '<p class="muted">Sube un PDF. DAFRICA separa los documentos, compara dos lecturas independientes y archiva cada resultado. Sin revisión de filas, sin casillas de confirmación y sin modificar STEL Order. Los documentos no verificables se retienen automáticamente sin contabilizar importes.</p>'+
  (!has("costes.editar")?'<p class="error">Esta cuenta no tiene permisos para archivar albaranes (costes.editar).</p>':'')+
  '<label for="pcAutoFile">PDF de albaranes (máximo 6 MB, 10 páginas por lote)</label>'+
  '<input type="file" id="pcAutoFile" accept="application/pdf,.pdf">'+
  '<label style="display:flex;align-items:center;gap:8px;margin:12px 0">'+
    '<input type="checkbox" id="pcAutoConsent" style="width:auto">'+
    '<span>Autorizo el procesamiento y análisis documental mediante IA externa y su archivo privado en DAFRICA.</span></label>'+
  '<button class="btn" type="button" id="pcAutoStart">Procesar y archivar automáticamente</button>'+
  '<p id="pcAutoStatus" class="muted" role="status">Selecciona un archivo.</p>'+
  '<div id="pcAutoResults"></div>'+
  '<h4>Últimos documentos procesados</h4><button type="button" class="btn secondary" id="pcAutoRetry" style="margin-bottom:10px">Reprocesar retenidos (sin subir PDF)</button><div id="pcAutoHistory" class="muted">Cargando…</div>'+
  '</div>';
 const file=$("pcAutoFile"),consent=$("pcAutoConsent"),button=$("pcAutoStart"),status=$("pcAutoStatus"),results=$("pcAutoResults"),history=$("pcAutoHistory"),retry=$("pcAutoRetry");
 const renderHistory=async()=>{
  try{
   const rows=await sb("/rest/v1/coste_documentos?select=id,numero_documento,proveedor_nombre,fecha_documento,archivo_path,ia_estado,ia_datos,created_at&order=created_at.desc&limit=30");
   history.innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Albarán</th><th>Proveedor</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>'+
    rows.map(d=>'<tr><td>'+esc(d.numero_documento||"Sin número")+'</td><td>'+esc(d.proveedor_nombre||"—")+'</td><td>'+esc(d.fecha_documento||"—")+'</td><td>'+esc(d.ia_estado||"PENDIENTE")+'</td></tr>').join("")+'</tbody></table></div>':
    'Aún no hay documentos archivados.';
  }catch(e){history.textContent="No se pudo consultar el historial: "+(e?.message||e)}
 };
 renderHistory();
 retry.addEventListener("click",async()=>{
   if(!has("costes.editar")||!consent.checked){status.textContent="Para reprocesar, autoriza el análisis documental y comprueba tus permisos.";return}
   retry.disabled=true;button.disabled=true;results.textContent="";
   try{
    const docs=await sb("/rest/v1/coste_documentos?select=id,numero_documento,proveedor_nombre,fecha_documento,archivo_path,ia_estado,ia_datos&ia_estado=eq.RETENIDO_AUTOMATICAMENTE&order=created_at.desc&limit=10");
    if(!docs.length){status.textContent="No hay documentos retenidos pendientes de reprocesar.";return}
    const outcomes=[];
    for(const d of docs){
      status.textContent="Reprocesando documento archivado "+String(d.numero_documento||d.id);
      try{
       if(!d.archivo_path||!/^[A-Za-z0-9._/-]+$/.test(d.archivo_path))throw Error("Ruta de PDF privado no válida");
       const escaped=d.archivo_path.split("/").map(encodeURIComponent).join("/");
       const r=await authFetch(SUPABASE_URL+"/storage/v1/object/authenticated/costes-auto/"+escaped);
       if(!r.ok)throw Error("No se puede leer el PDF archivado (HTTP "+r.status+")");
       const fileBuffer=new Uint8Array(await r.arrayBuffer());
       let binary="";for(let n=0;n<fileBuffer.length;n+=8192)binary+=String.fromCharCode(...fileBuffer.subarray(n,n+8192));
       const pdfb64=btoa(binary);
       const doc={pdf_separado_b64:pdfb64,proveedor:d.proveedor_nombre||"",numero:d.numero_documento||"",tipo:"ALBARAN",lineas:Array.isArray(d.ia_datos?.materiales)?d.ia_datos.materiales:[]};
       let geo=null,rows=null,images=null,geoProject="";
       if(String(doc.proveedor).toUpperCase().includes("SALTOKI")&&doc.lineas.length>=5){
        const parsed=await pcLeerSaltokiFilas(doc);
        if(parsed.lineas_validas===true&&parsed.numero_filas_geometricas===parsed.lineas?.length){
         geo=parsed.numero_filas_geometricas;rows=parsed.lineas;images=parsed.imagenes_zonas;
         geoProject=parsed.codigo_pry_sin_conflictos?parsed.codigo_proyecto:"";
        }
       }
       const response=await authFetch(SUPABASE_URL+"/functions/v1/compras-auto-v3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"reproceso_"+String(doc.numero||"documento")+".pdf",data:"data:application/pdf;base64,"+pdfb64,lineas_geometricas:geo,geometria_filas:rows,geometria_imagenes:images,geometria_proyecto:geoProject,numero_esperado:doc.numero,fecha_esperada:d.fecha_documento||null,proveedor_esperado:doc.proveedor,tipo_esperado:"ALBARAN",reprocesar:true})});
       const value=await response.json().catch(()=>({error:"Respuesta inválida"}));
       if(!response.ok)throw Error([value.error,value.etapa,value.detalle].filter(Boolean).join(" · ")||"HTTP "+response.status);
       outcomes.push({numero:doc.numero,estado:value.estado,filas:value.lineas_detectadas??0,problemas:value.incidencias||[]});
      }catch(e){outcomes.push({numero:d.numero_documento,estado:"ERROR",filas:0,problemas:[e?.message||String(e)]})}
    }
    const ok=outcomes.filter(x=>x.estado==="CONTRASTADO_SIN_IMPUTACION").length;
    status.textContent="Reprocesados "+outcomes.length+" PDF archivados: "+ok+" contrastados; "+(outcomes.length-ok)+" continúan sin verificar. Sin correcciones manuales ni escrituras en STEL.";
    results.innerHTML=outcomes.map(v=>'<div class="module-note sensitive-note"><b>'+esc(v.numero)+" · "+esc(v.estado)+'</b><p>'+esc(v.filas)+' líneas</p>'+v.problemas.slice(0,10).map(z=>'<p class="error">• '+esc(z)+'</p>').join("")+'</div>').join("");
    await renderHistory();
   }catch(e){status.textContent="No se completó el reproceso: "+(e?.message||String(e))}
   finally{retry.disabled=false;button.disabled=false}
 });
 button.addEventListener("click",async()=>{
  if(!has("costes.editar")){status.textContent="Permiso costes.editar requerido";return}
  const doc=file.files?.[0];
  if(!doc||!consent.checked){status.textContent="Selecciona el PDF y autoriza el procesamiento.";return}
  if(!/\.pdf$/i.test(doc.name)||doc.size>6_000_000||doc.size<100){status.textContent="PDF no válido o superior a 6 MB.";return}
  button.disabled=true;results.textContent="";status.textContent="Separando documentos del lote…";
  try{
   const data=await new Promise((resolve,reject)=>{
    const rd=new FileReader();rd.onload=()=>resolve(String(rd.result));rd.onerror=()=>reject(Error("No se pudo abrir el PDF"));rd.readAsDataURL(doc);
   });
   const split=await sb("/functions/v1/compras-lote-piloto",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mime:"application/pdf",name:doc.name,data})});
   if(!Array.isArray(split.documentos)||!split.documentos.length)throw Error("No se pudieron separar los documentos");
   const pages=split.documentos.flatMap(x=>x.paginas||[]),uniquePages=new Set(pages);
   if(pages.length!==uniquePages.size||uniquePages.size!==split.paginas_pdf)throw Error("La división de páginas no es inequívoca: se ha bloqueado el lote");
   const work=split.documentos.map((d,i)=>({d,i})),out=[];
   async function consume(){
    while(work.length){
     const {d,i}=work.shift();
     if(!d.pdf_separado_b64){out[i]={estado:"RETENIDO",numero:d.numero,incidencias:["Documento sin PDF separable"]};continue}
     status.textContent="Procesando "+(i+1)+"/"+split.documentos.length+" · "+String(d.numero||"sin número");
     let geo=null,geometryWarning="",geometryRows=null,geometryImages=null,geometryProject="";
     if(String(d.proveedor||"").toUpperCase().includes("SALTOKI")&&(d.lineas||[]).length>=5){
      try{
       const parsed=await pcLeerSaltokiFilas(d);
       if(parsed.lineas_validas===true&&Number.isInteger(parsed.numero_filas_geometricas)&&parsed.lineas?.length===parsed.numero_filas_geometricas&&Array.isArray(parsed.imagenes_zonas)){
        geo=parsed.numero_filas_geometricas;geometryRows=parsed.lineas;geometryImages=parsed.imagenes_zonas;geometryProject=parsed.codigo_pry_sin_conflictos===true?parsed.codigo_proyecto:"";
       }else geometryWarning="Se identificaron filas pero faltan datos; la lectura queda retenida";
      }catch(err){geometryWarning="No se completó la geometría: "+(err?.message||err)}
     }
     try{
      const response=await authFetch(SUPABASE_URL+"/functions/v1/compras-auto-v3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:d.tipo+"_"+(d.numero||"sin_numero")+".pdf",data:"data:application/pdf;base64,"+d.pdf_separado_b64,lineas_geometricas:geo,geometria_filas:geometryRows,geometria_imagenes:geometryImages,geometria_proyecto:geometryProject,numero_esperado:String(d.numero||""),fecha_esperada:d.fecha||null,proveedor_esperado:d.proveedor||"",tipo_esperado:d.tipo||"",reprocesar:true})});
      const result=await response.json().catch(()=>({error:"Respuesta del servidor no interpretable"}));
      if(!response.ok)throw Error([result.error,result.etapa?"Etapa: "+result.etapa:"",result.detalle].filter(Boolean).join(" · ")||"HTTP "+response.status);
      out[i]={...result,geometryWarning};
     }catch(err){out[i]={estado:"ERROR",numero:d.numero,incidencias:[err?.message||String(err)],geometryWarning}}
    }
   }
   await Promise.all(Array.from({length:Math.min(2,work.length)},()=>consume()));
   const ok=out.filter(x=>x.estado==="CONTRASTADO_SIN_IMPUTACION").length;
   const held=out.filter(x=>x.estado==="RETENIDO_AUTOMATICAMENTE"||x.estado==="RETENIDO").length;
   const duplicates=out.filter(x=>x.estado==="DUPLICADO").length;
   const errors=out.filter(x=>x.estado==="ERROR"||x.estado==="LINEAS_PENDIENTES"||x.estado==="RETENIDO_SIN_PROCESAR").length;
   const archived=out.filter(x=>!!x.documento_id).length;
   results.innerHTML='<p><b>'+esc(split.documentos.length)+' documentos analizados.</b> '+esc(ok)+' contrastados, '+esc(held)+' retenidos, '+esc(duplicates)+' duplicados, <b>'+esc(errors)+' errores</b>.</p>'+
    out.map((x,i)=>'<div class="module-note sensitive-note"><b>'+esc(x.numero||split.documentos[i]?.numero||"Documento "+(i+1))+' · '+esc(x.estado||"ERROR")+'</b>'+
    '<p>'+esc(x.lineas_detectadas??"?")+' líneas; obra: '+esc(x.proyecto_candidato||"sin asociar")+'</p>'+
    (x.geometryWarning?'<p class="muted">'+esc(x.geometryWarning)+'</p>':'')+
    (x.incidencias||[]).slice(0,12).map(z=>'<p class="error">• '+esc(z)+'</p>').join("")+
    ((x.incidencias||[]).length>12?'<p class="muted">'+esc(x.incidencias.length-12)+' incidencias adicionales; no se han aceptado datos inciertos.</p>':"")+
    (x.avisos||[]).map(z=>'<p class="muted">• '+esc(z)+'</p>').join("")+'</div>').join("")+
    '<p class="muted">Registro documental automático. No se contabilizan costes sin importes fiables ni asignación de obra comprobada. STEL no se modifica.</p>';
   status.textContent=errors?"Proceso incompleto: "+errors+" documento(s) con error; "+archived+" archivo(s) registrados. Consulta los detalles.": "Proceso terminado: "+archived+" archivo(s) registrados y "+duplicates+" duplicado(s) detectados.";
   await renderHistory();
  }catch(e){status.textContent="Lote retenido sin registrar: "+(e?.message||String(e))}
  finally{button.disabled=false}
 });
};