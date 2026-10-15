"use strict";
// Piloto DAFRICA: consulta de albaranes existentes por referencia STEL.
// Esta función no crea ni modifica documentos.
function renderBuscarAlbaranesSTEL(){
  if(!has("costes.ver"))return;
  const root=$("content");
  const firstCard=root.querySelector(".card");
  if(!firstCard)return;
  const card=document.createElement("div");
  card.className="card";
  card.innerHTML=
    '<h3>Buscar albarán existente en STEL</h3>'+
    '<p>Antes de crear un documento, comprueba si ya existe. Busca por referencia completa de STEL (no por código de producto).</p>'+
    '<label for="stelAlbaranRef">Referencia STEL del albarán</label>'+
    '<div class="toolbar">'+
      '<input id="stelAlbaranRef" type="text" maxlength="42" value="ABP241999" autocomplete="off" aria-label="Referencia completa del albarán">'+
      '<button id="stelAlbaranFind" type="button" class="btn">Buscar albarán</button>'+
    '</div>'+
    '<p id="stelAlbaranStatus" class="muted" aria-live="polite">Ejemplo: ABP241999 (Saltoki Centro S.A., en tu captura).</p>'+
    '<div id="stelAlbaranResults"></div>'+
    '<p class="muted">Consulta de solo lectura. Buscar no cambia el estado ni la obra de ningún documento.</p>';
  firstCard.before(card);
  const input=$("stelAlbaranRef"),button=$("stelAlbaranFind"),status=$("stelAlbaranStatus"),out=$("stelAlbaranResults");
  const find=async()=>{
    const fullReference=input.value.trim().toUpperCase();
    if(!/^[A-Z0-9._\/-]{3,42}$/.test(fullReference)){
      status.textContent="Introduce una referencia completa válida. Ejemplo: ABP241999.";
      return;
    }
    button.disabled=true;out.innerHTML="";status.textContent="Consultando albaranes existentes en STEL…";
    try{
      const res=await sb("/functions/v1/stel-albaranes-consulta",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({fullReference})
      });
      const docs=Array.isArray(res?.documents)?res.documents:[];
      if(docs.length){
        status.textContent="Documento existente localizado en STEL. No debe crearse otro albarán con esta referencia.";
        out.innerHTML='<div class="table-wrap"><table><thead><tr>'+
          '<th>Referencia STEL</th><th>Fecha</th><th>Título</th><th>Proveedor</th><th>ID interno</th>'+
          '</tr></thead><tbody>'+
          docs.map(d=>'<tr><td><b>'+esc(d.fullReference||"—")+'</b></td>'+
            '<td>'+esc(d.date?String(d.date).slice(0,10):"—")+'</td>'+
            '<td>'+esc(d.title||"—")+'</td>'+
            '<td>'+esc(d.supplier||"No incluido en la respuesta")+'</td>'+
            '<td>'+esc(d.id??"—")+'</td></tr>').join("")+
          '</tbody></table></div>'+
          '<div class="module-note"><b>Revisión pendiente:</b> no hemos confirmado todavía si este documento está vinculado a la obra correcta. La API puede no mostrar esa relación.</div>';
      }else{
        status.textContent="No apareció esa referencia en la respuesta filtrada de STEL.";
        out.innerHTML='<div class="module-note">Resultado no concluyente: no lo consideraremos inexistente ni crearemos duplicados sin comprobarlo en STEL.</div>';
      }
    }catch(e){status.textContent="No se pudo consultar STEL: "+(e?.message||String(e));}
    finally{button.disabled=false;}
  };
  button.addEventListener("click",find);
  input.addEventListener("keydown",e=>{if(e.key==="Enter")find();});
}
