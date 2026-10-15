"use strict";
// Solo lectura: piloto OCR/IA. No crea registros ni archivos persistentes.
function renderAlbaranVisionPilot(){
  if(!has("costes.ver"))return;
  const el=document.createElement("div");
  el.className="card";
  el.innerHTML='<h3>Lectura IA · fotografía o PDF</h3>'+
    '<p>Prueba privada: la IA propone proveedor, fecha, obra y materiales, sin crear documentos en STEL.</p>'+
    '<label for="albFile">Seleccionar foto o escaneo</label>'+
    '<input id="albFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf">'+
    '<p class="muted">JPG, PNG, WebP o PDF · máximo 5 MB · un documento por prueba.</p>'+
    '<label style="display:flex;align-items:flex-start;gap:10px;margin:12px 0">'+
    '<input id="albConsent" type="checkbox" style="width:auto;margin-top:3px">'+
    '<span>Autorizo el envío de este documento al proveedor externo de IA para interpretarlo. El piloto no almacena el original en Supabase.</span></label>'+
    '<div class="toolbar"><button class="btn" id="albAnalyze" type="button" disabled>Analizar albarán</button> '+
    '<button class="btn secondary" id="albClear" type="button">Limpiar</button></div>'+
    '<p class="muted" id="albStatus" aria-live="polite">Selecciona un archivo.</p>'+
    '<div id="albResults"></div>';
  $("content").appendChild(el);
  const file=$("albFile"), consent=$("albConsent"), run=$("albAnalyze"), clear=$("albClear"), status=$("albStatus"), output=$("albResults");
  const enabled=()=>{run.disabled=(!file.files?.length || !consent.checked);};
  file.addEventListener("change",()=>{output.innerHTML="";status.textContent=file.files?.[0]?.name||"Selecciona un archivo.";enabled();});
  consent.addEventListener("change",enabled);
  clear.addEventListener("click",()=>{file.value="";consent.checked=false;output.innerHTML="";status.textContent="Prueba reiniciada.";enabled();});
  const field=(label,value)=>'<tr><th>'+esc(label)+'</th><td>'+esc(value===null||value===undefined||value===""?"No identificado":value)+'</td></tr>';
  const qty=x=>typeof x==="number"?x.toLocaleString("es-ES"):"—";
  const amount=x=>typeof x==="number"?x.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})+" €":"—";
  function show(result){
    const d=result.extraction||{}, lines=Array.isArray(d.lineas)?d.lineas:[], doubts=Array.isArray(d.dudas)?d.dudas:[];
    output.innerHTML=
      '<div class="module-note sensitive-note"><b>Propuesta pendiente de verificar:</b> no se ha vinculado ninguna obra ni creado nada en STEL.</div>'+
      '<div class="table-wrap"><table><tbody>'+
      field("Proveedor",d.proveedor)+field("N.º albarán",d.numero_albaran)+
      field("Fecha leída",d.fecha)+field("Tipo",d.tipo_documento)+
      field("Obra indicada en el papel",d.obra_texto)+
      field("Almacén",d.destino_almacen?"Posible almacén":"No detectado")+
      field("Varias obras",d.varias_obras?"Sí, revisar reparto":"No detectadas")+
      field("Título sugerido",d.titulo_sugerido)+'</tbody></table></div>'+
      '<h4>Líneas leídas ('+lines.length+')</h4>'+
      '<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Material</th><th>Unidades</th><th>Precio</th><th>Obra por línea</th></tr></thead><tbody>'+
      (lines.map(x=>'<tr><td>'+esc(x.referencia||"—")+'</td><td>'+esc(x.descripcion||"—")+'</td><td>'+esc(qty(x.cantidad))+'</td><td>'+esc(amount(x.precio_unitario))+'</td><td>'+esc(x.obra_texto||"—")+'</td></tr>').join("")||'<tr><td colspan="5">No se identificaron líneas.</td></tr>')+
      '</tbody></table></div><h4>Dudas de la IA</h4>'+
      (doubts.map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")||'<p class="muted">Sin dudas declaradas; aun así verifica todos los datos.</p>')+
      '<p class="muted">'+esc(d.observaciones||"")+'</p>'+
      '<div class="module-note">La obra se ha leído del papel; todavía NO se ha encontrado una referencia de proyecto STEL ni asignado un proyecto.</div>';
  }
  run.addEventListener("click",async()=>{
    const f=file.files?.[0];if(!f||!consent.checked)return;
    const mime=f.type||(f.name.toLowerCase().endsWith(".pdf")?"application/pdf":"");
    if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(mime)){status.textContent="Usa una fotografía JPG, PNG, WebP o PDF.";return;}
    if(f.size<100||f.size>5_000_000){status.textContent="Archivo vacío o superior a 5 MB.";return;}
    run.disabled=true;clear.disabled=true;status.textContent="Analizando con IA… puede tardar aproximadamente un minuto.";output.innerHTML="";
    try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(new Error("Error de lectura"));reader.readAsDataURL(f);});
      const result=await sb("/functions/v1/albaranes-vision-piloto",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:f.name,mime,data})});
      show(result);status.textContent="Extracción completada. Verifica manualmente el documento original.";
    }catch(e){status.textContent="No se pudo completar el análisis: "+(e?.message||String(e));}
    finally{clear.disabled=false;enabled();}
  });
}
