"use strict";
// Piloto de clasificación de PDFs por lotes. La IA no escribe en STEL.
function renderComprasLotePilot(){
 const container=$("pcBatch");
 if(!container||!has("costes.ver"))return;
 container.innerHTML='<div class="card">'+
  '<h3>PDF por lotes · Pedidos, albaranes y facturas</h3>'+
  '<p>Sube un PDF escaneado con varios documentos. La IA indica qué páginas corresponden a cada pedido, albarán o factura. En un pedido puedes trasladar sus materiales al formulario editable para guardarlo después de revisarlos.</p>'+
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
   s.textContent="Análisis de "+output.paginas_pdf+" página(s). "+output.documentos.length+" documento(s) propuesto(s). Revisa la separación.";
   res.innerHTML='<div class="module-note sensitive-note"><b>Separación propuesta por IA:</b> los números de página y datos deben contrastarse con el PDF original. No se ha guardado el PDF ni se han creado pedidos.</div>'+
    (output.advertencias||[]).map(x=>'<p class="error">'+esc(x)+'</p>').join("")+
    output.documentos.map((d,i)=>{
     const lines=Array.isArray(d.lineas)?d.lineas:[];
     const lineRows=lines.map(l=>'<tr><td>'+esc(l.referencia||"—")+'</td><td>'+esc(l.descripcion||"—")+'</td>'+
      '<td>'+esc(l.cantidad??"—")+'</td><td>'+esc(l.unidad||"—")+'</td><td>'+esc(l.precio_unitario===null?"Sin precio":l.precio_unitario)+'</td></tr>').join("");
     return '<div class="card" style="margin-top:12px"><h4>Documento '+(i+1)+' · '+esc(d.tipo)+' · '+esc(d.numero||"Número sin identificar")+'</h4>'+
      '<p><b>Página(s) del PDF:</b> '+esc((d.paginas||[]).join(", ")||"Revisar")+
      ' · <b>Proveedor:</b> '+esc(d.proveedor||"—")+
      ' · <b>Fecha:</b> '+esc(d.fecha_literal||d.fecha||"—")+'</p>'+
      '<p><b>Proyecto manuscrito:</b> '+esc(d.codigo_proyecto_literal||"No identificado")+
      ' · <b>Obra impresa:</b> '+esc(d.obra_impresa||"—")+'</p>'+
      (d.numero_pedido_mencionado?'<p><b>Pedido citado:</b> '+esc(d.numero_pedido_mencionado)+'</p>':"")+
      (d.albaranes_mencionados?.length?'<p><b>Albaranes citados:</b> '+esc(d.albaranes_mencionados.join(", "))+'</p>':"")+
      '<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Concepto</th><th>Cantidad</th><th>Unidad</th><th>Precio</th></tr></thead><tbody>'+
      (lineRows||'<tr><td colspan="5">Sin líneas detectadas.</td></tr>')+'</tbody></table></div>'+
      (d.dudas||[]).map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")+
      (d.tipo==="PEDIDO"&&has("costes.editar")?'<button class="btn secondary" type="button" data-pc-load-order="'+i+'">Cargar pedido en formulario para revisar</button>':"")+
      '</div>';
    }).join("")+
    '<p class="muted">Las facturas y albaranes quedan clasificados pero todavía requieren vinculación con un pedido y comprobación de duplicados. Los originales no quedan guardados.</p>';
   document.querySelectorAll("[data-pc-load-order]").forEach(el=>{
    el.addEventListener("click",()=>{
     const d=output.documentos[Number(el.dataset.pcLoadOrder)];
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
     form.scrollIntoView({behavior:"smooth",block:"start"});
     $("pcNumber").focus();
     alert("Datos cargados en el formulario, pero todavía NO se han guardado. Comprueba todas las referencias, cantidades, precios y obra antes de pulsar Guardar pedido.");
    });
   });
  }catch(e){s.textContent="No se pudo completar el lote: "+(e?.message||String(e));}
  finally{ready();}
 });
}
