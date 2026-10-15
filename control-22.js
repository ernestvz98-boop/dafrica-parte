"use strict";
// Piloto de clasificación de PDFs por lotes. La IA no escribe en STEL.
function renderComprasLotePilot(){
 const container=$("pcBatch");
 if(!container||!has("costes.ver"))return;
 container.innerHTML='<div class="card">'+
  '<h3>PDF por lotes · Pedidos, albaranes y facturas</h3>'+
  '<p>Una sola carga: la IA separa el PDF, realiza automáticamente tres lecturas del contenido de cada documento. Si la primera discrepa, contrasta las dos siguientes y propone correcciones. Solo revisas las filas conflictivas antes del registro.</p>'+
  '<label for="pcBatchFile">Archivo PDF (máximo 6 MB y 10 páginas)</label>'+
  '<input id="pcBatchFile" type="file" accept="application/pdf,.pdf">'+
  '<label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">'+
   '<input type="checkbox" id="pcBatchConsent" style="width:auto;margin-top:3px">'+
   '<span>Autorizo el análisis del PDF por el proveedor externo de IA. Esta prueba no guarda el original ni crea documentos en STEL.</span>'+
  '</label>'+
  '<button type="button" class="btn" id="pcBatchRun" disabled>Separar y analizar documentos</button>'+
  '<p id="pcBatchStatus" class="muted" aria-live="polite">Selecciona un PDF.</p>'+
  '<div id="pcBatchResults"></div>'+
  '</div>';
 const f=$("pcBatchFile"),c=$("pcBatchConsent"),b=$("pcBatchRun"),s=$("pcBatchStatus"),res=$("pcBatchResults");
 const ready=()=>{b.disabled=!f.files?.length||!c.checked;};
 f.addEventListener("change",()=>{s.textContent=f.files?.[0]?.name||"Selecciona un PDF.";res.innerHTML="";ready();});
 c.addEventListener("change",ready);
 b.addEventListener("click",async()=>{
  const file=f.files?.[0];if(!file||!c.checked)return;
  if(!file.name.toLowerCase().endsWith(".pdf")||file.size>6_000_000||file.size<100){
   s.textContent="Selecciona un PDF de hasta 6 MB.";return;
  }
  b.disabled=true;s.textContent="Analizando páginas y separando los documentos…";res.innerHTML="";
  try{
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||""));r.onerror=()=>reject(new Error("No se pudo leer el PDF"));r.readAsDataURL(file);});
   const output=await sb("/functions/v1/compras-lote-piloto",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mime:"application/pdf",name:file.name,data})
   });
   if(!Array.isArray(output.documentos))throw Error("La IA no devolvió una lista verificable");
   s.textContent="PDF separado. Leyendo automáticamente la tabla por franjas ampliadas…";
   // Antes de mostrar el formulario se reconstruyen las tablas largas desde JPEG físicos
   // para evitar depender de una lectura de página completa a baja resolución.
   for(let k=0;k<output.documentos.length;k++){
     const doc=output.documentos[k];
     if(doc.tipo!=="ALBARAN"||!doc.pdf_separado_b64)continue;
     doc.__franjasNecesarias=true;
     try{
       s.textContent="Ampliando tablas del documento "+(k+1)+"/"+output.documentos.length+
         " · identificando filas por columnas en Saltoki o franjas en otros formatos…";
       const usarSaltoki=String(doc.proveedor||"").toUpperCase().includes("SALTOKI")&&Array.isArray(doc.lineas)&&doc.lineas.length>=7;
       const zonal=usarSaltoki?await pcLeerSaltokiFilas(doc):await pcLeerDocumentoPorFranjas(doc);
       doc.__zonas=({
        lineas: Array.isArray(zonal.lineas)?zonal.lineas.length:0,
        avisos:Array.isArray(zonal.advertencias)?zonal.advertencias:[]
       });
       doc.__zoneImages=zonal.imagenes_zonas||[];
       if(zonal.lineas.length>=doc.lineas.length&&zonal.lineas.length>0&&(!usarSaltoki||zonal.estado==="CANDIDATO_POR_FILAS")){
         doc.__primeraExtraccionResumen={
           lineas:doc.lineas.length,codigo_proyecto:doc.codigo_proyecto
         };
         doc.lineas=zonal.lineas.map(row=>({
          referencia:row.referencia,descripcion:row.descripcion,
          cantidad:row.cantidad,unidad:row.unidad,precio_unitario:row.precio_unitario
         }));
         const code=String(zonal.codigo_proyecto||"").trim().toUpperCase();
         if(/^PRY[0-9]{4,8}$/.test(code))doc.codigo_proyecto=code;
         if(zonal.codigo_proyecto_literal)doc.codigo_proyecto_literal=zonal.codigo_proyecto_literal;
         doc.__franjasAplicadas=true;
         doc.__lecturaGeometrica=usarSaltoki;
       }else{
         doc.__franjasAplicadas=false;
       }
       if(zonal.advertencias?.length){
         doc.dudas=(Array.isArray(doc.dudas)?doc.dudas:[]).concat(
           zonal.advertencias.map(x=>"Lectura ampliada: "+x)
         );
       }
     }catch(error){
       doc.__errorFranjas=error?.message||String(error);
       doc.dudas=(Array.isArray(doc.dudas)?doc.dudas:[]).concat(
        ["No se pudo completar la lectura de imágenes ampliadas: "+doc.__errorFranjas]
       );
     }
   }
   s.textContent="Documentos preparados: "+output.documentos.length+
     ". Iniciando comprobación automática independiente…";
   res.innerHTML='<div class="module-note sensitive-note"><b>Verificación automática:</b> DAFRICA realiza dos lecturas y compara cada línea; si discrepan, ejecuta una tercera lectura independiente. Los artículos sin consenso quedan bloqueados. No se modifica STEL.</div>'+
    (output.advertencias||[]).map(x=>'<p class="error">'+esc(x)+'</p>').join("")+
    output.documentos.map((d,i)=>{
     const lines=Array.isArray(d.lineas)?d.lineas:[];
     const regional=String(d.__lecturaGeometrica?" · FILAS/ COLUMNAS DETECTADAS":d.__franjasAplicadas===true?" · LECTURA POR FRANJAS":d.__errorFranjas?" · AMPLIACIÓN FALLIDA":"");
     const lineRows=lines.map((l,j)=>'<tr><td><input type="text" class="pcBatchEdit" data-pc-doc="'+i+'" data-pc-row="'+j+'" data-pc-field="referencia" aria-label="Referencia fila '+(j+1)+'" style="min-width:122px" value="'+esc(l.referencia??"")+'"></td><td><input type="text" class="pcBatchEdit" data-pc-doc="'+i+'" data-pc-row="'+j+'" data-pc-field="descripcion" aria-label="Descripción fila '+(j+1)+'" style="min-width:215px" value="'+esc(l.descripcion??"")+'"></td>'+
      '<td><input type="number" step="0.001" min="0.001" class="pcBatchEdit" data-pc-doc="'+i+'" data-pc-row="'+j+'" data-pc-field="cantidad" aria-label="Cantidad fila '+(j+1)+'" style="min-width:90px;max-width:105px" value="'+esc(l.cantidad??"")+'"></td><td>'+esc(l.unidad||"—")+'</td><td>'+esc(l.precio_unitario===null?"Sin precio":l.precio_unitario)+'</td>'+
      '<td><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" class="pcBatchLineChecked" style="width:auto" data-pc-doc="'+i+'" data-pc-row="'+j+'">Sí</label></td></tr>').join("");
     return '<div class="card" style="margin-top:12px"><h4>Documento '+(i+1)+' · '+esc(d.tipo)+' · '+esc(d.numero||"Número sin identificar")+esc(regional)+'</h4>'+
      (d.__primeraExtraccionResumen?'<p class="muted">Lectura completa: '+esc(d.__primeraExtraccionResumen.lineas)+' materiales; lectura por franjas reales: '+esc(lines.length)+'. Ambas deberán validarse.</p>':"")+

      '<p><b>Página(s) del PDF:</b> '+esc((d.paginas||[]).join(", ")||"Revisar")+
      ' · <b>Proveedor:</b> '+esc(d.proveedor||"—")+
      ' · <b>Fecha:</b> '+esc(d.fecha_literal||d.fecha||"—")+'</p>'+
      '<p><b>Proyecto manuscrito leído:</b> '+esc(d.codigo_proyecto_literal||"No identificado")+
      ' · <b>Obra impresa:</b> '+esc(d.obra_impresa||"—")+'</p>'+
      '<label for="pcBatchProject'+i+'">Código PRY comprobado con el original (editable)</label>'+
      '<input id="pcBatchProject'+i+'" type="text" class="pcBatchEdit" data-pc-doc="'+i+'" data-pc-field="codigo_proyecto" maxlength="30" value="'+esc(d.codigo_proyecto||"")+'">'+
      (d.cantidades_sospechosas?'<div class="module-note sensitive-note"><b>Revisión obligatoria de cantidades:</b> la IA ha repetido la misma cifra en gran parte de las filas. Corrige los números con el PDF original antes de registrar entregas.</div>':'')+
      (d.numero_pedido_mencionado?'<p><b>Pedido citado:</b> '+esc(d.numero_pedido_mencionado)+'</p>':"")+
      (d.albaranes_mencionados?.length?'<p><b>Albaranes citados:</b> '+esc(d.albaranes_mencionados.join(", "))+'</p>':"")+
      '<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Concepto</th><th>Cantidad</th><th>Unidad</th><th>Precio</th><th>Comprobación</th></tr></thead><tbody>'+
      (lineRows||'<tr><td colspan="6">Sin líneas detectadas.</td></tr>')+'</tbody></table></div>'+
      (d.dudas||[]).map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")+
      '<div class="module-note sensitive-note" id="pcBatchAuditStatus'+i+'"><b>Esperando verificación automática.</b></div>'+
      (d.pdf_separado_b64?'<button type="button" class="btn secondary" data-pc-audit="'+i+'">Repetir auditoría de este documento</button>':
        '<p class="error">No existe un PDF separado fiable. La auditoría y la importación quedan bloqueadas.</p>')+
      (d.tipo==="ALBARAN"&&has("costes.editar")?'<div id="pcBatchMatch'+i+'" style="margin-top:12px"></div>':"")+
      (d.pdf_separado_b64?'<button class="btn secondary" type="button" data-pc-download="'+i+'">Descargar PDF separado</button>':"")+
      (d.tipo==="PEDIDO"&&has("costes.editar")?'<button class="btn secondary" type="button" data-pc-load-order="'+i+'">Cargar pedido en formulario para revisar</button>':"")+
      '</div>';
    }).join("")+
    '<p class="muted">Las facturas y albaranes quedan clasificados pero todavía requieren vinculación con un pedido y comprobación de duplicados. Los originales no quedan guardados.</p>';
   res.querySelectorAll(".pcBatchEdit").forEach(control=>control.addEventListener("change",()=>{
    const doc=output.documentos[Number(control.dataset.pcDoc)];
    if(!doc)return;
    doc.__audit=null;
    doc.__reviewRows=null;
    doc.__revision=(doc.__revision||0)+1;
    refreshManualChecks(Number(control.dataset.pcDoc),doc);
    const status=$("pcBatchAuditStatus"+control.dataset.pcDoc);
    if(status)status.innerHTML='<b>Verificación caducada:</b> has cambiado datos desde la última lectura. Vuelve a ejecutar la segunda IA.';
    const field=control.dataset.pcField;
    const row=Number(control.dataset.pcRow);
    const item=Number.isInteger(row)&&Array.isArray(doc.lineas)?doc.lineas[row]:null;
    if(field==="referencia"&&item)item.referencia=control.value.trim();
    if(field==="descripcion"&&item)item.descripcion=control.value.trim();
    if(field==="cantidad"&&item){
      const text=control.value.trim();
      item.cantidad=text===""?null:Number(text);
    }
    if(field==="codigo_proyecto")doc.codigo_proyecto=control.value.trim().toUpperCase().replace(/\s+/g,"");
    const selected=$("pcBatchOrder"+control.dataset.pcDoc);
    if(selected&&selected.value)selected.dispatchEvent(new Event("change"));
   }));
   res.querySelectorAll(".pcBatchLineChecked").forEach(control=>control.addEventListener("change",()=>{
    const sel=$("pcBatchOrder"+control.dataset.pcDoc);
    if(sel?.value)sel.dispatchEvent(new Event("change"));
   }));

   const completedAudits=new Set();
   const updateProgress=()=>{
     if(!res.isConnected)return;
     const approved=output.documentos.filter(d=>d.__audit?.auditoria_id).length;
     const pending=output.documentos.length-approved;
     s.textContent="Separados "+output.documentos.length+" documentos. Auditoría automática "+completedAudits.size+"/"+output.documentos.length+
       " · "+approved+" validados · "+(completedAudits.size===output.documentos.length?pending+" pendientes de revisión":"procesando…");
   };
   const copyFirst=doc=>({
     tipo:doc.tipo,numero:doc.numero,proveedor:doc.proveedor,
     fecha:doc.fecha,codigo_proyecto:doc.codigo_proyecto,
     lineas:(doc.lineas||[]).map(x=>({
       referencia:x.referencia,descripcion:x.descripcion,cantidad:x.cantidad,
       unidad:x.unidad,precio_unitario:x.precio_unitario
     }))
   });
   const callAudit=async (doc,first,third=false)=>sb("/functions/v1/compras-verificar-documento",{
     method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({data:"data:application/pdf;base64,"+doc.pdf_separado_b64,primera_lectura:first,modo:third?"tercera":"segunda",ampliar:third&&(doc.lineas||[]).length>=7&&!(doc.__zoneImages?.length),imagenes_zonas:doc.__zoneImages||[]})
   });
   const auditReport=(result,label)=>{
     const stats=result?.estadisticas||{};
     const differences=(result?.diferencias||[]).slice(0,80).map(x=>'<p class="error">• '+esc(x)+'</p>').join("");
     const rows=(result?.comparacion_lineas||[]).filter(x=>!x.coincide).slice(0,100)
       .map(x=>'<p class="error">Fila '+esc(x.fila)+': '+esc(x.referencia_primera||"—")+
       ' / '+esc(x.referencia_segunda||"—")+' · cantidad '+esc(x.cantidad_primera??"—")+
       ' / '+esc(x.cantidad_segunda??"—")+
       ' · '+esc((x.motivos||[]).join(", "))+'</p>').join("");
     return '<p><b>'+esc(label)+':</b> '+esc(stats.lineas_primera??"?")+
       ' / '+esc(stats.lineas_segunda??"?")+' líneas. Diferencias: '+esc(stats.lineas_diferentes??"?")+'</p>'+
       differences+rows;
   };
   const refreshManualChecks=(i,doc)=>{
     const required=doc.__reviewRows instanceof Set?doc.__reviewRows:new Set((doc.lineas||[]).map((_,n)=>n));
     const controls=[...res.querySelectorAll('.pcBatchLineChecked[data-pc-doc="'+i+'"]')];
     controls.forEach(control=>{
       const idx=Number(control.dataset.pcRow),needs=required.has(idx);
       control.disabled=!needs;
       if(!needs)control.checked=false;
       const text=control.parentElement?.lastChild;
       if(text)text.textContent=needs?"Revisar":"Verificado IA";
     });
   };
   const syncFields=(i,doc)=>{
     const project=$("pcBatchProject"+i);
     if(project)project.value=doc.codigo_proyecto||"";
     (doc.lineas||[]).forEach((line,j)=>{
       for(const field of ["referencia","descripcion","cantidad"]){
         const el=res.querySelector('.pcBatchEdit[data-pc-doc="'+i+'"][data-pc-row="'+j+'"][data-pc-field="'+field+'"]');
         if(el)el.value=line[field]??"";
       }
     });
   };
   const verify=async i=>{
     const doc=output.documentos[i],status=$("pcBatchAuditStatus"+i);
     const retry=res.querySelector('[data-pc-audit="'+i+'"]');
     if(!doc||!status||!doc.pdf_separado_b64){
       if(status)status.innerHTML='<b>Bloqueado:</b> no hay PDF separado fiable para verificar.';
       return;
     }
     if(doc.tipo==="ALBARAN"&&doc.__franjasNecesarias&&doc.__franjasAplicadas!==true){
       doc.__audit=null;
       status.innerHTML='<b>DOCUMENTO BLOQUEADO:</b> no se pudo completar una lectura fiable por franjas de la tabla'+
         (doc.__errorFranjas?'. Motivo: '+esc(doc.__errorFranjas):'. Hay menos filas legibles en las ampliaciones que en el PDF completo.')+
         '<p>Se requiere una nueva digitalización legible. No se aceptarán lecturas completas sin ampliar.</p>';
       completedAudits.add(i);updateProgress();return;
     }
     if(retry)retry.disabled=true;
     const revisionAtStart=doc.__revision||0;
     doc.__audit=null;
     status.innerHTML='<b>Leyendo automáticamente por segunda vez…</b> Comprobando todas las referencias, cantidades y PRY.';
     try{
       const first=copyFirst(doc);
       const second=await callAudit(doc,first);
       if((doc.__revision||0)!==revisionAtStart)throw Error("El documento se editó mientras se analizaba; los resultados se han descartado.");
       if(second.estado==="DOBLE_COINCIDENCIA"&&second.auditoria_id){
         status.innerHTML='<b>Segunda lectura coincidente. Ejecutando tercera lectura independiente como control final…</b>';
         const third=await callAudit(doc,first,true);
         if((doc.__revision||0)!==revisionAtStart)throw Error("Los datos cambiaron mientras se verificaban; repite la auditoría.");
         if(third.estado==="DOBLE_COINCIDENCIA"&&third.auditoria_id){
           doc.__audit=third;
           doc.__reviewRows=new Set();
           status.innerHTML='<b>Verificado: tres lecturas coinciden'+(third.ampliacion_automatica?' (con zoom automático por zonas)':'')+'.</b>'+
             '<p>Las tres lecturas coinciden, sin excepciones. Confirma el documento antes del registro; no tienes que marcar cada línea.</p>';
           refreshManualChecks(i,doc);
         }else{
           doc.__audit=null;
           status.innerHTML='<b>DOCUMENTO BLOQUEADO:</b> la tercera lectura ha encontrado diferencias.'+
             '<p>No se realizará ninguna importación automática.</p>'+
             auditReport(third,"Lecturas 1 y 3");
         }
       }else{
         status.innerHTML='<b>Hay discrepancias; iniciando tercera lectura independiente automáticamente…</b>'+
           auditReport(second,"Lecturas 1 y 2");
         const candidate=second.lectura_independiente;
         if(!candidate||!Array.isArray(candidate.lineas))throw Error("La segunda lectura no ha devuelto todas las líneas");
         const secondAsFirst={
           tipo:candidate.tipo,numero:candidate.numero,proveedor:candidate.proveedor,
           fecha:candidate.fecha,codigo_proyecto:candidate.codigo_proyecto,
           lineas:candidate.lineas.map(x=>({
             referencia:x.referencia,descripcion:x.descripcion,cantidad:x.cantidad,
             unidad:x.unidad,precio_unitario:x.precio_unitario
           }))
         };
         const third=await callAudit(doc,secondAsFirst,true);
         if((doc.__revision||0)!==revisionAtStart)throw Error("Los datos se han editado durante la auditoría; resultados descartados.");
         const headerSame=["tipo","numero","proveedor","fecha"].every(field=>
           String(first[field]??"").trim().toUpperCase()===String(secondAsFirst[field]??"").trim().toUpperCase());
         const lineCountSame=first.lineas.length===secondAsFirst.lineas.length;
         const certified=third.estado==="DOBLE_COINCIDENCIA"&&!!third.auditoria_id;
         if(certified&&headerSame&&lineCountSame){
           // Conservar el orden y corregir automáticamente SOLO donde dos auditorías independientes coinciden.
           const correctedRowIndexes=first.lineas.map((x,j)=>{
             const y=secondAsFirst.lineas[j];
             return x.referencia!==y.referencia||x.descripcion!==y.descripcion||
               x.cantidad!==y.cantidad||x.unidad!==y.unidad||
               x.precio_unitario!==y.precio_unitario?j:-1;
           }).filter(j=>j>=0);
           doc.__reviewRows=new Set(correctedRowIndexes);
           const differences=first.lineas.reduce((n,x,j)=>{
             const y=secondAsFirst.lineas[j];
             return n+((x.referencia!==y.referencia||x.descripcion!==y.descripcion||
               x.cantidad!==y.cantidad||x.unidad!==y.unidad||
               x.precio_unitario!==y.precio_unitario)?1:0);
           },0);
           doc.codigo_proyecto=secondAsFirst.codigo_proyecto;
           doc.lineas=secondAsFirst.lineas.map(x=>({...x}));
           doc.__audit=third;
           // El panel sigue siendo editable; cualquier modificación invalidará el certificado.
           syncFields(i,doc);
           refreshManualChecks(i,doc);
           status.innerHTML='<b>Corrección automática contrastada:</b> la segunda y tercera lecturas coinciden.'+
             '<p>DAFRICA ha propuesto '+esc(differences)+' corrección(es) de línea'+(third.ampliacion_automatica?' tras ampliar automáticamente el PDF por zonas':'')+' y comprobado PRY '+
             esc(doc.codigo_proyecto||"no identificado")+'. Marca únicamente las filas corregidas y confirma el documento antes de registrar.</p>'+
             auditReport(second,"Diferencias detectadas en lectura inicial");
         }else{
           doc.__audit=null;
           doc.__reviewRows=null;
           refreshManualChecks(i,doc);
           status.innerHTML='<b>DOCUMENTO BLOQUEADO:</b> las lecturas no han logrado confirmar todos los datos.'+
             '<p>No se inventarán referencias ni cantidades. Solo este documento necesita revisión humana.</p>'+
             auditReport(second,"Lecturas 1 y 2")+
             auditReport(third,"Lecturas 2 y 3");
         }
       }
     }catch(err){
       doc.__audit=null;
       status.innerHTML='<b>Auditoría incompleta: documento bloqueado.</b><p class="error">'+
         esc(err?.message||String(err))+'</p>';
     }finally{
       if(retry)retry.disabled=false;
       const sel=$("pcBatchOrder"+i);
       if(sel?.value)sel.dispatchEvent(new Event("change"));
       completedAudits.add(i);
       updateProgress();
     }
   };
   res.querySelectorAll("[data-pc-audit]").forEach(btn=>btn.addEventListener("click",()=>{
     const i=Number(btn.dataset.pcAudit);
     verify(i);
   }));
   if(has("costes.editar"))await pcBindBatchDeliveryMatches(output.documentos);
   document.querySelectorAll("[data-pc-download]").forEach(el=>el.addEventListener("click",()=>{
    try{
     const d=output.documentos[Number(el.dataset.pcDownload)];
     const binary=atob(String(d.pdf_separado_b64||""));
     const bytes=new Uint8Array(binary.length);
     for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
     const url=URL.createObjectURL(new Blob([bytes],{type:"application/pdf"}));
     const a=document.createElement("a");a.href=url;
     a.download=(String(d.tipo||"DOCUMENTO")+"_"+String(d.numero||"SIN_NUMERO")).replace(/[^a-zA-Z0-9_.-]/g,"_")+".pdf";
     document.body.appendChild(a);a.click();a.remove();
     URL.revokeObjectURL(url);
    }catch(e){alert("No se pudo preparar el PDF separado: "+e.message);}
   }));
   document.querySelectorAll("[data-pc-load-order]").forEach(el=>{
    el.addEventListener("click",()=>{
     const d=output.documentos[Number(el.dataset.pcLoadOrder)];
     if(!d?.__audit||d.__audit.estado!=="DOBLE_COINCIDENCIA"){
      alert("La carga del pedido queda bloqueada hasta que una segunda IA confirme todos los datos.");return;
     }
     const j=String(el.dataset.pcLoadOrder);
     const lineChecks=[...document.querySelectorAll('.pcBatchLineChecked[data-pc-doc="'+j+'"]')];
     const required=d.__reviewRows instanceof Set?d.__reviewRows:new Set((d.lineas||[]).map((_,n)=>n));
     if(lineChecks.length!==(d.lineas||[]).length||lineChecks.some(c=>required.has(Number(c.dataset.pcRow))&&!c.checked)){
      alert("Antes de importar el pedido, comprueba las líneas corregidas o no certificadas.");return;
     }
     if(!d||!Array.isArray(d.lineas)||!d.lineas.length)return;
     const form=$("pcCreate");if(!form){alert("No tienes permisos para crear pedidos");return;}
     $("pcNumber").value=d.numero||"";
     $("pcSupplier").value=d.proveedor||"";
     if(/^\d{4}-\d{2}-\d{2}$/.test(d.fecha||""))$("pcDate").value=d.fecha;
     $("pcProject").value=d.codigo_proyecto||"";
     $("pcLines").value=d.lineas.map(l=>[
      String(l.referencia||"").replace(/\|/g,"/"),
      String(l.descripcion||"").replace(/\|/g,"/"),
      l.cantidad??"",
      String(l.unidad||"ud").replace(/\|/g,"/"),
      l.precio_unitario??""
     ].join(" | ")).join("\n");
     pedidoOrigenFormulario="PDF";
     pedidoArchivoPdfBase64=d.pdf_separado_b64||null;
     form.scrollIntoView({behavior:"smooth",block:"start"});
     $("pcNumber").focus();
     alert("Datos cargados para revisión. No se han guardado. Al guardar, se archivará el PDF individual en un bucket privado si la separación fue válida; comprueba referencias, cantidades, precios y obra.");
    });
   });
   // Una sola subida: DAFRICA audita todos los documentos automáticamente, máximo dos en paralelo.
   const indices=output.documentos.map((_,i)=>i);
   const workers=Array.from({length:Math.min(2,indices.length)},async()=>{
     while(indices.length)await verify(indices.shift());
   });
   await Promise.allSettled(workers);
  }catch(e){s.textContent="No se pudo completar el lote: "+(e?.message||String(e));}
  finally{ready();}
 });
}


// La coincidencia de artículos es exacta: no se crean referencias nuevas ni se registra en STEL.
async function pcBindBatchDeliveryMatches(documents){
 let orders=[],lines=[];
 try{
  [orders,lines]=await Promise.all([
   sb("/rest/v1/pedidos_compra?estado=neq.CERRADO&select=id,numero,proveedor,codigo_proyecto&limit=300"),
   sb("/rest/v1/pedido_lineas?select=id,pedido_id,referencia,descripcion,unidad&limit=1500")
  ]);
 }catch{return;}
 const norm=v=>String(v??"").trim().toUpperCase();
 for(let i=0;i<documents.length;i++){
  const d=documents[i],host=$("pcBatchMatch"+i);
  if(!host||d.tipo!=="ALBARAN")continue;
  const candidate=orders.filter(o=>
    (d.numero_pedido_mencionado&&norm(o.numero)===norm(d.numero_pedido_mencionado))||
    (d.codigo_proyecto&&norm(o.codigo_proyecto)===norm(d.codigo_proyecto))
  );
  host.innerHTML='<p class="muted"><b>Vincular albarán a pedido abierto:</b> selecciona el pedido y revisa las coincidencias exactas de artículos antes de registrar las unidades. No se modificarán albaranes de STEL.</p>'+
   '<select id="pcBatchOrder'+i+'"><option value="">Selecciona pedido…</option>'+
   orders.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.numero+" · "+o.proveedor+(o.codigo_proyecto?" · "+o.codigo_proyecto:"")+
   (candidate.some(c=>c.id===o.id)?" · CANDIDATO":""))+'</option>').join("")+'</select>'+
   '<div id="pcBatchChecks'+i+'"></div>';
  $("pcBatchOrder"+i).addEventListener("change",()=>{
   const id=$("pcBatchOrder"+i).value,area=$("pcBatchChecks"+i);
   area.innerHTML="";if(!id)return;
   const order=orders.find(x=>x.id===id),validLines=lines.filter(x=>x.pedido_id===id);
   const problems=[],matched=[],used=new Set();
   if(!d.__audit||d.__audit.estado!=="DOBLE_COINCIDENCIA")
    problems.push("BLOQUEADO: pendiente de dos lecturas independientes coincidentes.");
   const allLineChecks=[...document.querySelectorAll('.pcBatchLineChecked[data-pc-doc="'+i+'"]')];
   const rowsToReview=d.__reviewRows instanceof Set?d.__reviewRows:new Set((d.lineas||[]).map((_,j)=>j));
   if(allLineChecks.length!==(d.lineas||[]).length||allLineChecks.some(x=>rowsToReview.has(Number(x.dataset.pcRow))&&!x.checked))
    problems.push("Revisa las líneas corregidas o no certificadas: las tres lecturas no bastaron para aceptarlas sin comprobación.");
   if(d.codigo_proyecto&&norm(order.codigo_proyecto)&&norm(d.codigo_proyecto)!==norm(order.codigo_proyecto))
    problems.push("El código PRY del PDF no coincide con el proyecto registrado en este pedido.");
   for(const item of (d.lineas||[])){
    const ref=norm(item.referencia);
    const exact=ref?validLines.filter(x=>norm(x.referencia)===ref):[];
    if(exact.length!==1){
     problems.push("Referencia "+(item.referencia||"SIN CÓDIGO")+" no coincide de forma única con el pedido.");
     continue;
    }
    const selected=exact[0],qty=Number(item.cantidad),price=item.precio_unitario;
    if(used.has(selected.id)){problems.push("Artículo "+ref+" repetido: agrupa cantidades y revisa manualmente.");continue;}
    if(!Number.isFinite(qty)||qty<=0){problems.push("Cantidad no verificada para "+ref);continue;}
    if(price!==null&&price!==undefined&&(!Number.isFinite(Number(price))||Number(price)<0)){
     problems.push("Precio no verificado para "+ref);continue;
    }
    used.add(selected.id);
    matched.push({pedido_linea_id:selected.id,cantidad:qty,precio_unitario:price===null||price===undefined?null:Number(price)});
   }
   if(!d.numero||!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha||"")))
    problems.push("Número o fecha de albarán incorrectos.");
   if(!(d.lineas||[]).length)problems.push("No se han detectado materiales.");
   area.innerHTML='<p class="muted"><b>Coincidencia:</b> '+matched.length+'/'+(d.lineas||[]).length+
    ' líneas · Pedido seleccionado: '+esc(order.numero)+'</p>'+
    problems.map(p=>'<p class="error">'+esc(p)+'</p>').join("")+
    '<label style="display:flex;align-items:flex-start;gap:8px"><input type="checkbox" style="width:auto" id="pcBatchConfirm'+i+'">'+
    '<span>He verificado el albarán original, proveedor, código de obra, todas las referencias y cantidades. Confirmo que la entrega no está ya registrada.</span></label>'+
    '<button type="button" class="btn" id="pcBatchSave'+i+'"'+(problems.length?" disabled":"")+'>'+
    'Registrar '+matched.length+' línea(s) como entrega en DAFRICA</button>';
   const button=$("pcBatchSave"+i);
   if(button)button.addEventListener("click",async()=>{
    if(!d.__audit||d.__audit.estado!=="DOBLE_COINCIDENCIA"){
     alert("Importación bloqueada: se requiere segunda lectura idéntica.");return;
    }
    const confirmations=[...document.querySelectorAll('.pcBatchLineChecked[data-pc-doc="'+i+'"]')];
    const needed=d.__reviewRows instanceof Set?d.__reviewRows:new Set((d.lineas||[]).map((_,j)=>j));
    if(confirmations.length!==(d.lineas||[]).length||confirmations.some(x=>needed.has(Number(x.dataset.pcRow))&&!x.checked)){
     alert("Comprueba visualmente las filas corregidas antes de registrar.");return;
    }
    if(!$("pcBatchConfirm"+i).checked){alert("Confirma primero la revisión del albarán");return;}
    if(!confirm("Registrar "+matched.length+" líneas en el pedido "+order.numero+" desde el albarán "+d.numero+"? No se escribirá nada en STEL."))return;
    button.disabled=true;
    try{
     await sb("/rest/v1/rpc/pedido_registrar_albaran_pdf",{
      method:"POST",body:JSON.stringify({
       p_pedido_id:id,p_numero:String(d.numero).trim(),p_fecha:d.fecha,p_lineas:matched,p_auditoria_id:d.__audit.auditoria_id
      })
     });
     pedidoActualId=id;
     await renderPedidosCompras();
     alert("Entregas registradas internamente. Revisa el resumen del pedido y las cantidades pendientes.");
    }catch(err){button.disabled=false;alert("No se pudieron registrar entregas: "+(err?.message||err));}
   });
  });
 }
}
