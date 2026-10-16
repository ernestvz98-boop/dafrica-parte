"use strict";
// Single material Saltoki pages need a physical crop, not another full-page OCR.
async function pcLeerSaltokiFilaUnica(doc){
  if(!String(doc?.proveedor||"").toUpperCase().includes("SALTOKI")||doc?.lineas?.length!==1)
    throw Error("Se requiere un albarán Saltoki con una sola fila");
  const encoded=String(doc.pdf_separado_b64||"");
  if(!encoded||encoded.length>9000000)throw Error("El PDF individual no está disponible");
  const pdfjs=await pcLoadPdfJs(),raw=atob(encoded);
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  const task=pdfjs.getDocument({data:bytes,verbosity:0,useSystemFonts:true});
  let canvas=null;
  try{
    const pdf=await task.promise;
    if(pdf.numPages!==1)throw Error("La página individual debe contener una sola hoja");
    const page=await pdf.getPage(1);
    const base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(5.2,2400/base.width)});
    canvas=document.createElement("canvas");
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)throw Error("No se puede dibujar el albarán");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    // Physical row region of the SALTOKI October-2026 template:
    // reference + description + quantity, excluding the table header.
    const x0=Math.floor(canvas.width*.077),x1=Math.ceil(canvas.width*.748);
    const y0=Math.floor(canvas.height*.156),y1=Math.ceil(canvas.height*.186);
    const out=document.createElement("canvas");out.width=1740;out.height=145;
    const o=out.getContext("2d",{alpha:false});if(!o)throw Error("No se puede generar el recorte");
    o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);
    o.fillStyle="#171717";o.font="bold 18px sans-serif";o.fillText("F1 · REFERENCIA / CONCEPTO / CANTIDAD",15,23);
    o.drawImage(canvas,x0,y0,x1-x0,y1-y0,80,31,out.width-100,105);
    const crop=out.toDataURL("image/jpeg",.94);out.width=0;out.height=0;
    // Saltoki places its PRINTED albaran number near the bottom of the page,
    // whereas the handwritten ABP marker is near the top. Show both header and
    // printed number to the independent header-verification model.
    const hdr=document.createElement("canvas");
    hdr.width=1600;hdr.height=680;
    const h=hdr.getContext("2d",{alpha:false});h.fillStyle="white";h.fillRect(0,0,1600,680);
    h.fillStyle="#111";h.font="bold 18px sans-serif";
    h.fillText("EMISOR IMPRESO (superior) Y Nº ALBARÁN IMPRESO (inferior)",12,24);
    h.drawImage(canvas,Math.floor(canvas.width*.025),Math.floor(canvas.height*.012),
      Math.floor(canvas.width*.95),Math.floor(canvas.height*.13),5,37,1590,350);
    h.drawImage(canvas,Math.floor(canvas.width*.04),Math.floor(canvas.height*.690),
      Math.floor(canvas.width*.73),Math.floor(canvas.height*.096),5,405,1590,265);
    const headerJpeg=hdr.toDataURL("image/jpeg",.94);hdr.width=0;hdr.height=0;
    const row=doc.lineas[0];
    return {numero_filas_geometricas:1,lineas_validas:true,lineas:[{
      referencia:String(row.referencia||""),descripcion:String(row.descripcion||""),
      cantidad:row.cantidad===null?null:Number(row.cantidad),
      unidad:String(row.unidad||""),precio_unitario:row.precio_unitario??null
    }],imagenes_zonas:[crop],imagen_cabecera:headerJpeg,codigo_proyecto:"",codigo_pry_sin_conflictos:false};
  }finally{
    if(canvas){canvas.width=0;canvas.height=0}
    await task.destroy().catch(()=>{});
  }
}
// Ingesta automatica V2: una carga, documentos separados, archivados y contrastados.
// No crea entregas ni imputaciones economicas a partir de OCR no verificado.
renderComprasLotePilot = function renderComprasAutonomasV2(){
 const root=$("pcBatch");if(!root||!has("costes.ver"))return;
 root.innerHTML='<div class="card">'+
  '<h3>Albaranes automáticos V5 · Verificación de filas físicas</h3>'+
  '<p class="muted">Sube un PDF. DAFRICA separa los documentos, detecta las filas físicas y exige dos lecturas independientes concordantes; una tercera verifica las divergencias. Los datos inciertos quedan retenidos. Sin revisión de filas, sin casillas de confirmación y sin modificar STEL Order. Los documentos no verificables se retienen automáticamente sin contabilizar importes.</p>'+
  (!has("costes.editar")?'<p class="error">Esta cuenta no tiene permisos para archivar albaranes (costes.editar).</p>':'')+
  '<label for="pcAutoFile">PDF de albaranes (máximo 6 MB, 10 páginas por lote)</label>'+
  '<input type="file" id="pcAutoFile" accept="application/pdf,.pdf">'+
  '<label style="display:flex;align-items:center;gap:8px;margin:12px 0">'+
    '<input type="checkbox" id="pcAutoConsent" style="width:auto">'+
    '<span>Autorizo el procesamiento y análisis documental mediante IA externa y su archivo privado en DAFRICA.</span></label>'+
  '<button class="btn" type="button" id="pcAutoStart">Procesar y archivar automáticamente</button>'+
  '<p id="pcAutoStatus" class="muted" role="status">Selecciona un archivo.</p>'+
  '<div id="pcAutoResults"></div>'+
  '<h4>Lecturas de albaranes y materiales guardados</h4><div id="pcAutoOverview"></div><button type="button" class="btn secondary" id="pcAutoRetry" style="margin-bottom:10px">Reprocesar retenidos (sin subir PDF)</button><div id="pcAutoHistory" class="muted">Cargando…</div>'+
  '</div>';
 const file=$("pcAutoFile"),consent=$("pcAutoConsent"),button=$("pcAutoStart"),status=$("pcAutoStatus"),results=$("pcAutoResults"),history=$("pcAutoHistory"),retry=$("pcAutoRetry");
 const overview=$("pcAutoOverview");
 let firstHistory=true;
 let loadedDocuments=new Map();
 const pryChecked=new Set();
 const stelExplanation=diag=>{
   if(!diag)return "";
   const projects=Number(diag.proyectos_http||0),filtered=Number(diag.albaranes_filtrados_http||0),paged=Number(diag.albaranes_paginados_http||0);
   if([401,403].includes(projects))return "STEL no autoriza consultar proyectos con esta clave API";
   if([404,405].includes(projects)&&[404,405].includes(filtered)&&[404,405].includes(paged))
     return "La API de STEL no expone los proyectos ni los albaranes necesarios para este enlace";
   if(projects===404&&filtered===400&&paged===200&&Number(diag.albaranes_mismo_numero_y_proveedor)===0)
     return "API STEL: proyectos 404; filtro de referencia externa 400; el listado general no acredita este vínculo. No es un fallo de OCR";
   if(Number(diag.albaranes_mismo_numero_y_proveedor)===0&&(filtered===200||paged===200))
     return "La API no proporciona una relación verificable entre este número externo y un proyecto";
   if([404,405].includes(projects))return "El catálogo de proyectos no está disponible en esta ruta de STEL";
   if([404,405].includes(Number(diag.proyecto_por_id_http)))
     return "STEL no permite verificar el ID de proyecto por esta ruta";
   if(!diag.catalogo_completo)return "El catálogo de STEL sigue sin poder comprobarse completo";
   return "Sin coincidencia exacta y única demostrable en STEL";
 };
 const safeQuantity=v=>v===null||v===undefined||v===""?"—":Number.isFinite(Number(v))?Number(v).toLocaleString("es-ES",{maximumFractionDigits:4}):String(v);
 const lineFingerprint=x=>[
  String(x.codigo_articulo??x.referencia??"").trim(),
  Number(x.cantidad).toString(),
  String(x.descripcion??"").trim()
 ].join("¦");
 const rowsMatch=(read,stored)=>{
  if(!Array.isArray(read)||!Array.isArray(stored)||read.length!==stored.length||read.length===0)return false;
  const count=new Map();
  for(const line of stored){const key=lineFingerprint(line);count.set(key,(count.get(key)||0)+1)}
  for(const line of read){const key=lineFingerprint(line);const left=count.get(key)||0;if(!left)return false;count.set(key,left-1)}
  return [...count.values()].every(n=>n===0);
 };
 const renderHistory=async()=>{
  try{
   const rows=await sb("/rest/v1/coste_documentos?select=id,tipo,numero_documento,proveedor_nombre,fecha_documento,archivo_path,obra_id,ia_estado,ia_datos,created_at&ia_estado=neq.VARIANTE_OCR_NO_CANONICA&order=created_at.desc&limit=30");
   loadedDocuments=new Map(rows.map(d=>[d.id,d]));
   const ids=rows.map(d=>String(d.id)).filter(id=>/^[0-9a-f-]{36}$/i.test(id));
   let stored=[],linesLoaded=true;
   if(ids.length){
    try{
     stored=await sb("/rest/v1/coste_lineas?select=documento_id,codigo_articulo,descripcion,cantidad,unidad,precio_unitario&documento_id=in.("+ids.join(",")+")&limit=1000");
     if(stored.length===1000)linesLoaded=false; // do not claim exhaustive comparison if paginated.
    }catch(e){linesLoaded=false}
   }
   const storedByDoc=new Map();
   for(const line of stored){if(!storedByDoc.has(line.documento_id))storedByDoc.set(line.documento_id,[]);storedByDoc.get(line.documento_id).push(line)}
   const oldOpen=new Set([...history.querySelectorAll("details[data-doc-id][open]")].map(x=>x.dataset.docId));
   const openOnLoad=firstHistory&&rows.length<=3;firstHistory=false;
   const info=rows.map(d=>{
    const materials=Array.isArray(d.ia_datos?.materiales)?d.ia_datos.materiales:[];
    const saved=storedByDoc.get(d.id)||[];
    const matched=linesLoaded&&rowsMatch(materials,saved);
    const verified=d.ia_estado==="CONTRASTADO_SIN_IMPUTACION"&&matched;
    const warnings=Array.isArray(d.ia_datos?.avisos)?d.ia_datos.avisos:[];
    const errors=Array.isArray(d.ia_datos?.errores)?d.ia_datos.errores:[];
    // OCR readings are immutable evidence. Prices belong to the persisted
    // material line and are enriched only after a verified invoice link.
    const remaining=saved.map(x=>({...x,_used:false}));
    const displayLines=materials.map(x=>{
      const y=remaining.find(z=>!z._used&&lineFingerprint(z)===lineFingerprint(x));
      if(y)y._used=true;
      return {...x,unidad:y?.unidad??x.unidad,precio_unitario:y?.precio_unitario??x.precio_unitario};
    });
    const withPrice=displayLines.filter(x=>x.precio_unitario!==null&&x.precio_unitario!==undefined).length;
    return {d,materials,displayLines,saved,matched,verified,warnings,errors,withPrice};
   });
   const verifiedDocs=info.filter(x=>x.verified);
   const verifiedRows=verifiedDocs.reduce((n,x)=>n+x.saved.length,0);
   overview.innerHTML='<p><b>Lecturas almacenadas:</b> '+esc(rows.length)+' documento(s) en el historial · '+esc(verifiedDocs.length)+' con materiales contrastados y comprobados en la base de datos · '+esc(verifiedRows)+' líneas comprobadas.</p>'+
    '<p class="muted">«Contrastado sin imputación» significa que se archivaron las referencias y cantidades, NO que existan precios o una obra asignada. La información puede consultarse sin volver a ejecutar IA.</p>';
   history.innerHTML=rows.length?info.map(({d,materials,displayLines,saved,matched,verified,warnings,errors,withPrice})=>{
     const statusLabel=verified?"Materiales contrastados":d.ia_estado==="CONTRASTADO_SIN_IMPUTACION"?"Auditoría contrastada, comprobar archivo de líneas":d.ia_estado==="RETENIDO_AUTOMATICAMENTE"?"Retenido, sin aceptar materiales":d.ia_estado||"Pendiente";
     const opened=openOnLoad||oldOpen.has(d.id);
     const savedStelDiagnosis=stelExplanation(d.ia_datos?.pry_diagnostico_api);
     const pryText=d.ia_datos?.pry_codigo_confirmado?
       "Confirmado STEL: "+d.ia_datos.pry_codigo_confirmado:
       d.ia_datos?.pry_ocr_candidato?
       "Candidato "+d.ia_datos.pry_ocr_candidato+" (sin confirmar)":
       "Sin confirmar";
     const table=materials.length?'<div class="table-wrap" style="max-height:600px;overflow:auto"><table><thead><tr><th>Fila</th><th>Referencia</th><th>Descripción leída</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th></tr></thead><tbody>'+
      displayLines.map((line,i)=>'<tr><td>'+esc(i+1)+'</td><td>'+esc(line.referencia||"Sin referencia")+'</td><td>'+esc(line.descripcion||"Sin descripción")+'</td><td>'+esc(safeQuantity(line.cantidad))+'</td><td>'+esc(line.unidad||"—")+'</td><td>'+esc(line.precio_unitario===null||line.precio_unitario===undefined?"No consta":safeQuantity(line.precio_unitario)+" €")+'</td></tr>').join("")+
      '</tbody></table></div>':'<p>La lectura no contiene materiales disponibles.</p>';
     return '<details data-doc-id="'+esc(d.id)+'" '+(opened?'open':'')+' style="border:1px solid #d6dee8;border-radius:10px;padding:12px;margin:9px 0">'+
      '<summary style="cursor:pointer"><b>'+esc(d.numero_documento||"sin número")+'</b> · '+esc(materials.length)+' fila(s) leída(s) · '+esc(saved.length)+' guardada(s) · '+esc(statusLabel)+'</summary>'+
      '<p><b>Proveedor:</b> '+esc(d.proveedor_nombre||"No reconocido")+' · <b>Fecha:</b> '+esc(d.fecha_documento||"No reconocida")+'</p>'+
      '<p><b>Obra:</b> <span data-obra-doc="'+esc(d.id)+'">'+esc(d.obra_id?(d.ia_datos?.pry_stel_nombre||"Asignación registrada"):"Sin asignar")+'</span> · <b>PRY:</b> <span data-pry-doc="'+esc(d.id)+'">'+esc(pryText+(savedStelDiagnosis?" · "+savedStelDiagnosis:""))+'</span> · <b>Precios:</b> '+esc(withPrice)+'/'+esc(materials.length)+' ('+esc(withPrice===materials.length?"Precios disponibles":d.tipo==="FACTURA"?"Factura sin todos los precios legibles":"Pendientes de factura vinculada")+')</p>'+
      '<p><b>Comprobación de guardado:</b> '+esc(matched?"Las referencias, conceptos y cantidades coinciden con las filas registradas":linesLoaded?"La lectura y los registros no coinciden o faltan líneas":"No se ha podido comprobar el registro completo")+'</p>'+
      (d.ia_datos?.factura_origen?'<p><b>Precio vinculado desde factura:</b> '+esc(d.ia_datos.factura_origen)+'</p>':'')+
      table+
      (warnings.length?'<p class="muted"><b>Avisos:</b> '+esc(warnings.join(" · "))+'</p>':'')+
      (errors.length?'<p><b>Incidencias:</b> '+esc(errors.join(" · "))+'</p>':'')+
      (d.archivo_path?'<p><button type="button" class="btn secondary" data-pdf-id="'+esc(d.id)+'">Descargar PDF original archivado</button></p>':'')+
      '</details>';
   }).join(""):'Aún no hay documentos archivados.';
   const consultables=rows.filter(d=>d.tipo!=="FACTURA"&&d.ia_estado==="CONTRASTADO_SIN_IMPUTACION"&&!d.obra_id&&!pryChecked.has(d.id)).slice(0,6);
   for(const d of consultables)pryChecked.add(d.id);
   if(consultables.length){
     Promise.all(consultables.map(async d=>{
       const statusCell=history.querySelector('[data-pry-doc="'+d.id+'"]');
       const workCell=history.querySelector('[data-obra-doc="'+d.id+'"]');
       if(!statusCell)return;
       const prior=statusCell.textContent;
       statusCell.textContent=prior+" · Consultando STEL…";
       try{
         const value=await sb("/functions/v1/compras-stel-pry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({documento_id:d.id})});
         if(value.obra_asignada){
           statusCell.textContent="Confirmado y asignado · "+value.candidato_ocr;
           if(workCell)workCell.textContent=value.obra_nombre||value.proyecto_stel?.name||"Obra STEL confirmada";
         }else if(value.confirmado){
           statusCell.textContent="Confirmado STEL: "+value.candidato_ocr+" · Asignación pendiente ("+(value.detalle_asignacion||"sin detalles")+")";
         }else{
           statusCell.textContent=value.candidato_ocr?"Candidato "+value.candidato_ocr+" sin confirmar en STEL":"PRY no legible";
           if(value.fuente==="CATALOGO_NO_VERIFICADO_COMPLETO"&&value.diagnostico){
             statusCell.textContent+=" · "+stelExplanation(value.diagnostico);
           }
           if(value.consulta_reutilizada)statusCell.title="Diagnóstico reciente conservado; evitar consultas repetitivas a STEL";
         }
         if(value.similares?.length)statusCell.textContent+=" · Similares: "+value.similares.map(x=>x.code).join(", ");
         if(value.estado==="STEL_SIN_CLAVE")statusCell.textContent+=" · API no configurada";
         if(value.fuente)statusCell.title="Origen: "+value.fuente+"; proyectos examinados: "+String(value.comprobados??0)+"; HTTP proyectos: "+String(value.diagnostico?.proyectos_http??value.consulta_catalogo??"sin respuesta")+"; documentos STEL con referencia y proveedor coincidentes: "+String(value.diagnostico?.albaranes_mismo_numero_y_proveedor??"no determinado");
       }catch(e){statusCell.textContent=prior+" · Consulta STEL no disponible";}
     })).catch(()=>{});
   }
  }catch(e){history.textContent="No se pudo consultar el historial: "+(e?.message||e);overview.textContent="No se han podido comprobar las lecturas registradas."}
 };
 history.addEventListener("click",async e=>{
  const clicked=e.target?.closest?.("button[data-pdf-id]");
  if(!clicked)return;
  const record=loadedDocuments.get(clicked.dataset.pdfId);
  if(!record||!record.archivo_path||!/^[A-Za-z0-9._/-]+$/.test(record.archivo_path))return;
  clicked.disabled=true;const before=clicked.textContent;clicked.textContent="Preparando PDF privado…";
  try{
   const url=SUPABASE_URL+"/storage/v1/object/authenticated/costes-auto/"+record.archivo_path.split("/").map(encodeURIComponent).join("/");
   const response=await authFetch(url);
   if(!response.ok)throw Error("No se pudo recuperar el PDF (HTTP "+response.status+")");
   const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),a=document.createElement("a");
   a.href=objectUrl;a.download="Albaran_"+String(record.numero_documento||"documento").replace(/[^A-Za-z0-9.-]/g,"_")+".pdf";
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  }catch(err){status.textContent="Error al recuperar el PDF: "+(err?.message||err)}
  finally{clicked.disabled=false;clicked.textContent=before}
 });
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
       let geo=null,rows=null,images=null,geoProject="",headerImage=null,profile="",allowNoRef=false;
       if(doc.lineas.length>=1&&doc.lineas.length<=5){
        const parsed=String(doc.proveedor).toUpperCase().includes("SALTOKI")?(doc.lineas.length===1?await pcLeerSaltokiFilaUnica(doc):await pcLeerSaltokiFilas(doc)):await pcLeerTablaMixta(doc);
        if(parsed.lineas_validas===true&&parsed.numero_filas_geometricas===parsed.lineas?.length){
         geo=parsed.numero_filas_geometricas;rows=parsed.lineas;images=parsed.imagenes_zonas;headerImage=parsed.imagen_cabecera||null;profile=parsed.perfil_formato||"";allowNoRef=parsed.permite_sin_referencia===true;
         geoProject=parsed.codigo_pry_sin_conflictos?parsed.codigo_proyecto:"";
        }
       }
       const response=await authFetch(SUPABASE_URL+"/functions/v1/compras-auto-v3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"reproceso_"+String(doc.numero||"documento")+".pdf",data:"data:application/pdf;base64,"+pdfb64,lineas_geometricas:geo,geometria_filas:rows,geometria_imagenes:images,imagen_cabecera:headerImage,perfil_formato:profile,permite_sin_referencia:allowNoRef,geometria_proyecto:geoProject,pry_primera_lectura:String(d.ia_datos?.pry_ocr_candidato||""),numero_esperado:doc.numero,fecha_esperada:d.fecha_documento||null,proveedor_esperado:doc.proveedor,tipo_esperado:"ALBARAN",reprocesar:true})});
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
     let geo=null,geometryWarning="",geometryRows=null,geometryImages=null,geometryProject="",headerImage=null,profile="",allowNoRef=false;
     if((d.lineas||[]).length>=1&&(d.lineas||[]).length<=5||String(d.proveedor||"").toUpperCase().includes("SALTOKI")){
      try{
       const parsed=String(d.proveedor||"").toUpperCase().includes("SALTOKI")?(d.lineas.length===1?await pcLeerSaltokiFilaUnica(d):await pcLeerSaltokiFilas(d)):await pcLeerTablaMixta(d);
       if(parsed.lineas_validas===true&&Number.isInteger(parsed.numero_filas_geometricas)&&parsed.lineas?.length===parsed.numero_filas_geometricas&&Array.isArray(parsed.imagenes_zonas)){
        geo=parsed.numero_filas_geometricas;geometryRows=parsed.lineas;geometryImages=parsed.imagenes_zonas;headerImage=parsed.imagen_cabecera||null;profile=parsed.perfil_formato||"";allowNoRef=parsed.permite_sin_referencia===true;geometryProject=parsed.codigo_pry_sin_conflictos===true?parsed.codigo_proyecto:"";
       }else geometryWarning="Se identificaron filas pero faltan datos; la lectura queda retenida";
      }catch(err){geometryWarning="No se completó la geometría: "+(err?.message||err)}
     }
     try{
      const response=await authFetch(SUPABASE_URL+"/functions/v1/compras-auto-v3",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:d.tipo+"_"+(d.numero||"sin_numero")+".pdf",data:"data:application/pdf;base64,"+d.pdf_separado_b64,lineas_geometricas:geo,geometria_filas:geometryRows,geometria_imagenes:geometryImages,imagen_cabecera:headerImage,perfil_formato:profile,permite_sin_referencia:allowNoRef,geometria_proyecto:geometryProject,pry_primera_lectura:String(d.codigo_proyecto||""),numero_esperado:String(d.numero||""),fecha_esperada:d.fecha||null,proveedor_esperado:d.proveedor||"",tipo_esperado:d.tipo||"",reprocesar:true})});
      const result=await response.json().catch(()=>({error:"Respuesta del servidor no interpretable"}));
      if(!response.ok)throw Error([result.error,result.etapa?"Etapa: "+result.etapa:"",result.detalle].filter(Boolean).join(" · ")||"HTTP "+response.status);
      out[i]={...result,geometryWarning};
     }catch(err){out[i]={estado:"ERROR",numero:d.numero,incidencias:[err?.message||String(err)],geometryWarning}}
    }
   }
   await Promise.all(Array.from({length:Math.min(2,work.length)},()=>consume()));
   const ok=out.filter(x=>x.estado==="CONTRASTADO_SIN_IMPUTACION").length;
   const held=out.filter(x=>["RETENIDO_AUTOMATICAMENTE","RETENIDO","ARCHIVO_EXISTENTE_INCOMPLETO"].includes(x.estado)).length;
   const already=out.filter(x=>x.estado==="YA_PROCESADO"||x.estado==="DUPLICADO").length;
   const discrepancies=out.filter(x=>x.estado==="LECTURA_DIFIERE_DE_ARCHIVO").length;
   const errors=out.filter(x=>["ERROR","LINEAS_PENDIENTES","RETENIDO_SIN_PROCESAR"].includes(x.estado)).length;
   const accepted=ok+already,rate=split.documentos.length?Math.round(100*accepted/split.documentos.length):0;
   results.innerHTML='<p><b>'+esc(split.documentos.length)+' documentos analizados.</b> <b>'+esc(accepted)+' aceptados o coincidentes con el archivo ('+esc(rate)+'%)</b>; <b>'+esc(held)+' retenidos</b>; <b>'+esc(discrepancies)+' relecturas diferentes de registros existentes</b>; '+esc(errors)+' errores técnicos. Las relecturas diferentes NO se contabilizan como nuevas verificaciones.</p>'+
    out.map((x,i)=>'<div class="module-note sensitive-note"><b>'+esc(x.numero||split.documentos[i]?.numero||"Documento "+(i+1))+' · '+esc(x.estado||"ERROR")+'</b>'+
    '<p>'+esc(x.lineas_detectadas??"?")+' líneas; obra: '+esc(x.proyecto_candidato||"sin asociar")+'</p>'+
    (x.documento_id?'<p><a href="#pcAutoHistory"><b>Ver lectura completa y materiales guardados ↓</b></a></p>':'')+
    (x.geometryWarning?'<p class="muted">'+esc(x.geometryWarning)+'</p>':'')+
    (x.incidencias||[]).slice(0,12).map(z=>'<p class="error">• '+esc(z)+'</p>').join("")+
    ((x.incidencias||[]).length>12?'<p class="muted">'+esc(x.incidencias.length-12)+' incidencias adicionales; no se han aceptado datos inciertos.</p>':"")+
    (x.avisos||[]).map(z=>'<p class="muted">• '+esc(z)+'</p>').join("")+'</div>').join("")+
    '<p class="muted">Registro documental automático. No se contabilizan costes sin importes fiables ni asignación de obra comprobada. STEL no se modifica.</p>';
   status.textContent=errors?"Proceso incompleto: "+errors+" error(es) técnicos. Consulta los detalles.":"Proceso finalizado: "+ok+" nuevos contrastados, "+already+" existentes coincidentes, "+discrepancies+" relecturas contradictorias y "+held+" retenidos. No se han modificado albaranes existentes ni costes.";
   await renderHistory();
  }catch(e){status.textContent="Lote retenido sin registrar: "+(e?.message||String(e))}
  finally{button.disabled=false}
 });
};