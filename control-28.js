"use strict";
/*
 * Lectura determinista de PDF digitales en la pantalla «Interpretar albaranes».
 * Se ejecuta en el navegador con pdf.js (sin IA, sin guardar nada). Si el
 * documento queda AUTO_OK no se llama a la IA; en otro caso se muestra junto a
 * la lectura por IA para comparar. Ver albaranes/extraer.js.
 */
async function pcLecturaDeterminista(doc){
 const lib=window.DafricaAlbaranes;
 if(!lib?.extraer)throw Error("Lector determinista no cargado");
 const encoded=String(doc?.pdf_separado_b64||"");
 if(!encoded||encoded.length>9000000)throw Error("PDF separado no disponible");
 const raw=atob(encoded),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const pdfjs=await pcLoadPdfJs();
 return lib.extraer.extraerPdf(pdfjs,bytes,{registro:lib.proveedores.REGISTRO});
}
// PDF escaneado: OCR en el propio navegador (tesseract.js) y el mismo lector determinista.
// No se envía ni se guarda nada; solo se aceptan cifras validadas por el cuadre.
async function pcLecturaOCR(doc,alProgresar){
 const lib=window.DafricaAlbaranes;
 if(!lib?.escaneado||!lib?.motorNavegador)throw Error("Lector OCR no cargado");
 const encoded=String(doc?.pdf_separado_b64||"");
 if(!encoded||encoded.length>9000000)throw Error("PDF separado no disponible");
 const raw=atob(encoded),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const pdfjs=await pcLoadPdfJs();
 const {paginas,liberar}=await lib.motorNavegador.paginasEscaneadas(pdfjs,bytes,{alProgresar});
 try{return await lib.escaneado.extraerEscaneado(paginas,{registro:lib.proveedores.REGISTRO});}
 finally{await liberar();}
}
// La IA a veces copia el destinatario como proveedor: nunca se muestra como emisor.
function pcProveedorMostrable(nombre){
 const valor=String(nombre||"").trim();
 return /DAFRICA/i.test(valor)?"":valor;
}
function pcRenderDeterminista(det){
 if(!det)return "";
 const aceptado=e=>e==="OK"||e==="VERIFICADO";
 const celda=c=>{
  if(!c)return "—";
  const texto=c.literal?esc(c.literal):'<span class="muted">vacío</span>';
  // Por debajo de 0,9 de confianza el valor tampoco se acepta automáticamente.
  const dudosa=typeof c.confianza==="number"&&c.confianza<0.9&&c.estado!=="VACIO";
  const sugerida=c.sugerida!=null?' <span class="muted">(el cuadre indica '+esc(c.sugerida)+'; no se asigna)</span>':"";
  return (aceptado(c.estado)||c.estado==="VACIO")&&!dudosa?texto+sugerida:
   texto+' <b class="error" title="'+esc((c.motivos||[]).join(" · "))+'">['+esc(aceptado(c.estado)?"confianza "+c.confianza:c.estado)+']</b>'+sugerida;
 };
 const p=det.proveedor||{};
 const proveedor=p.nombre?esc(p.nombre)+" · NIF "+esc(p.nif)+(p.estado!=="OK"?' <b class="error">[Proveedor no verificado]</b>':""):
  p.nif?"NIF "+esc(p.nif)+" (no registrado)":"No identificado";
 const filas=(det.lineas||[]).map(l=>'<tr><td>'+esc(l.fila)+'</td><td>'+celda(l.referencia)+'</td><td>'+celda(l.descripcion)+'</td><td>'+
  celda(l.cantidad)+'</td><td>'+celda(l.precio)+'</td><td>'+celda(l.descuento)+'</td><td>'+celda(l.importe)+'</td><td>'+
  esc(l.cuadre?.estado==="VERIFICADO"?"Cuadra":l.cuadre?.estado==="SIN_PRECIOS"?"Sin precios":l.cuadre?.estado||"—")+'</td><td>'+
  (l.estado==="OK"&&l.confianza>=0.9?"Correcta":'<span class="error">'+esc(l.motivos.length?l.motivos.join(" · "):"Confianza insuficiente; no se acepta automáticamente")+'</span>')+'</td></tr>').join("");
 const validaciones=(det.validaciones||[]).filter(v=>v.estado!=="NO_APLICA")
  .map(v=>'<li>'+esc(v.nombre)+': '+(v.estado==="OK"?"correcta":'<b class="error">'+esc(v.estado)+'</b>')+' · '+esc(v.detalle)+'</li>').join("");
 return '<div class="module-note" style="margin:8px 0">'+
  '<p><b>Lectura determinista '+(det.tipo_pdf==="ESCANEADO_OCR"?'con OCR local':'del PDF digital')+'</b> ('+esc(det.tipo_pdf)+', sin IA) · Estado: <b>'+
   esc(det.estado==="AUTO_OK"?"Todos los campos verificados":det.estado==="NO_DIGITAL"?"PDF escaneado: requiere OCR":"Requiere revisión")+'</b></p>'+
  '<p><b>Proveedor:</b> '+proveedor+(p.nif_propio_detectado?' <span class="muted">(NIF de DAFRICA descartado como emisor)</span>':'')+
   ' · <b>Número:</b> '+celda(det.numero)+' · <b>Fecha:</b> '+celda(det.fecha)+(det.fecha?.valor?' ('+esc(det.fecha.valor)+')':'')+'</p>'+
  (filas?'<div class="table-wrap" style="overflow:auto;max-height:600px"><table><thead><tr><th>Fila</th><th>Referencia</th><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Dto.</th><th>Importe</th><th>Cuadre</th><th>Estado</th></tr></thead><tbody>'+filas+'</tbody></table></div>':'')+
  (det.totales&&det.totales.total?.estado!=="VACIO"?'<p><b>Totales:</b> base '+celda(det.totales.base_imponible)+' · IVA % '+celda(det.totales.iva_porcentaje)+
   ' · cuota '+celda(det.totales.cuota_iva)+' · total '+celda(det.totales.total)+'</p>':'')+
  (typeof det.confianza==="number"?'<p class="muted">Confianza del documento: '+esc(det.confianza)+' (se acepta automáticamente desde 0,9)</p>':'')+
  (validaciones?'<ul class="muted">'+validaciones+'</ul>':'')+
  ((det.incidencias||[]).length?'<details><summary>'+esc(det.incidencias.length)+' incidencia(s)</summary>'+det.incidencias.map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")+'</details>':'')+
  '<p class="muted">Los valores se copian literalmente del PDF; los marcados entre corchetes no se aceptan automáticamente.</p>'+
  '</div>';
}
