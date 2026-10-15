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
    const d=result.extraction||{};
    const lines=Array.isArray(d.lineas)?d.lineas:[];
    const doubts=Array.isArray(d.dudas)?d.dudas:[];
    const validation=result.dateValidation||{};
    const alertText=Array.isArray(result.validationAlerts)?result.validationAlerts:[];
    const warning='<div class="module-note sensitive-note"><b>Extracción sin aprobar.</b> Verifica la fecha y todas las líneas con el papel antes de confirmar. No se creará ningún documento en STEL.</div>';
    const diagnostics=alertText.map(x=>'<p class="error">'+esc(x)+'</p>').join("");
    const value=(v)=>esc(v===null||v===undefined?"":v);
    const editField=(label,key,v)=>'<div class="kv"><label for="albReview_'+key+'">'+esc(label)+'</label>'+
      '<input id="albReview_'+key+'" data-review="'+key+'" type="text" maxlength="220" value="'+value(v)+'"></div>';
    const printDate=validation.printed||d.fecha_literal||"No extraída";
    // Si la IA ha devuelto una conversión incorrecta, no precargamos una fecha errónea.
    const initialDate=validation.consistent===true?String(d.fecha||""):"";
    output.innerHTML=warning+diagnostics+
      '<h4>Datos extraídos · revisa y corrige</h4>'+
      '<p class="muted">Fecha literal impresa: <b>'+esc(printDate)+'</b>. Interpretación IA: <b>'+esc(d.fecha||"sin identificar")+'</b>. Verifica el año antes de continuar.</p>'+
      '<div class="form-grid">'+
       editField("Proveedor","proveedor",d.proveedor)+
       editField("N.º albarán proveedor","numero_albaran",d.numero_albaran)+
       '<div><label for="albReviewDate">Fecha comprobada con el original</label>'+
       '<input id="albReviewDate" type="date" value="'+esc(initialDate)+'" required></div>'+
       '<div><label for="albReviewType">Tipo de documento</label>'+
       '<select id="albReviewType"><option value="DESCONOCIDO">Revisar tipo</option>'+
       '<option value="COMPRA"'+(d.tipo_documento==="COMPRA"?" selected":"")+'>Compra</option>'+
       '<option value="ABONO"'+(d.tipo_documento==="ABONO"?" selected":"")+'>Abono</option></select></div>'+
       editField("Obra escrita en el papel","obra_texto",d.obra_texto)+
       editField("Título sugerido","titulo_sugerido",d.titulo_sugerido)+
      '</div>'+
      '<h4>Materiales ('+lines.length+') · revisa descripciones y cantidades</h4>'+
      '<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Descripción editable</th><th>Unidades</th><th>Precio leído</th><th>Obra de línea</th></tr></thead><tbody>'+
      (lines.map((x,i)=>'<tr>'+
       '<td><input class="albLineRef" data-row="'+i+'" style="min-width:115px" value="'+value(x.referencia)+'"></td>'+
       '<td><input class="albLineDesc" data-row="'+i+'" style="min-width:250px" value="'+value(x.descripcion)+'"></td>'+
       '<td><input class="albLineQty" data-row="'+i+'" type="number" step="0.001" style="min-width:80px" value="'+value(x.cantidad)+'"></td>'+
       '<td>'+esc(amount(x.precio_unitario))+'</td>'+
       '<td><input class="albLineWork" data-row="'+i+'" style="min-width:180px" value="'+value(x.obra_texto)+'"></td>'+
      '</tr>').join("")||'<tr><td colspan="5">No se identificaron líneas.</td></tr>')+
      '</tbody></table></div>'+
      '<h4>Advertencias y dudas</h4>'+
      (doubts.map(x=>'<p class="muted">• '+esc(x)+'</p>').join("")||'<p class="muted">La IA no ha declarado dudas, pero esto NO certifica su exactitud.</p>')+
      '<div class="module-note">Se requiere verificar también las letras de las descripciones (por ejemplo, LOCA frente a JOCA), las cantidades y las referencias de producto. Obra reconocida no equivale a proyecto STEL vinculado.</div>'+
      '<label style="display:flex;align-items:flex-start;gap:8px;margin:12px 0">'+
        '<input type="checkbox" id="albReviewConfirmed" style="width:auto;margin-top:3px">'+
        '<span>He comparado los datos editados con el albarán original. Comprendo que esta prueba no consulta ni modifica el albarán real de STEL.</span>'+
      '</label>'+
      '<button id="albConfirmReview" class="btn" type="button">Confirmar revisión y preparar JSON</button>'+
      '<p class="muted" id="albReviewStatus" aria-live="polite"></p>'+
      '<div id="albReviewPrepared"></div>';
    $("albConfirmReview").addEventListener("click",()=>{
      const date=$("albReviewDate").value;
      const type=$("albReviewType").value;
      const confirmed=$("albReviewConfirmed").checked;
      const info=$("albReviewStatus"), prepared=$("albReviewPrepared");
      const rvalue=k=>String($("albReview_"+k)?.value||"").trim();
      const dateObj=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+"T00:00:00Z"):null;
      if(!confirmed){info.textContent="Marca primero que has contrastado los datos con el papel.";return;}
      if(!dateObj||Number.isNaN(dateObj.valueOf())||dateObj.toISOString().slice(0,10)!==date){
        info.textContent="Introduce una fecha válida comprobada con el documento.";return;
      }
      if(type==="DESCONOCIDO"){info.textContent="Confirma si es compra o abono.";return;}
      if(!rvalue("proveedor")||!rvalue("numero_albaran")||!rvalue("obra_texto")){
        info.textContent="Confirma proveedor, número de albarán y obra.";return;
      }
      const revisedLines=lines.map((x,i)=>{
        const field=cls=>document.querySelector('.'+cls+'[data-row="'+i+'"]')?.value?.trim()||"";
        const q=field("albLineQty");
        return {...x,referencia:field("albLineRef"),descripcion:field("albLineDesc"),
          cantidad:q===""?null:Number(q),obra_texto:field("albLineWork")};
      });
      if(!revisedLines.length||revisedLines.some(x=>!x.referencia||!x.descripcion||x.cantidad===null||!Number.isFinite(x.cantidad)||x.cantidad<=0)){
        info.textContent="Revisa referencias, descripciones y cantidades de todas las líneas.";return;
      }
      const proposedTitle=rvalue("titulo_sugerido");
      const reviewed={
        proveedor:rvalue("proveedor"),numero_albaran:rvalue("numero_albaran"),fecha:date,
        fecha_literal:String(d.fecha_literal||""),tipo_documento:type,
        obra_texto:rvalue("obra_texto"),titulo_sugerido:proposedTitle,
        lineas:revisedLines,estado:"REVISADO_LOCALMENTE_SIN_ENVIO_STEL"
      };
      prepared.innerHTML='<p><b>Revisión preparada. No se ha enviado nada a STEL.</b> Comprueba el JSON si quieres utilizarlo en la siguiente fase.</p>'+
        '<textarea id="albReviewJSON" rows="12" readonly></textarea>';
      $("albReviewJSON").value=JSON.stringify(reviewed,null,2);
      info.textContent="Datos revisados localmente. Pendiente: localizar IDs reales y comprobar si el albarán ya existe en STEL.";
    });
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
