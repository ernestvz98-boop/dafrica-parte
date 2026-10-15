"use strict";
// Piloto de solo lectura: STEL Products, sin crear documentos ni enviar fotografias.
async function renderAlbaranesPiloto(){
  if(!has("costes.ver")){ setContent('<div class="error">No tienes permiso para este piloto.</div>'); return; }
  setTopbar("Albaranes IA · piloto","Comprobación de productos y referencias · sin cambios en STEL");
  setContent(`
    <div class="section-head"><div><h2>Comprobación de productos STEL</h2><p>Etapa 1 del piloto de albaranes: buscar la referencia del material y obtener su ID interno. Solo lectura.</p></div></div>
    <div class="module-note"><b>Importante:</b> este piloto no analiza fotografías todavía y no registra albaranes. Nunca introduzcas tu clave API en esta página.</div>
    <div class="card">
      <label for="stelItemRef">Referencia del producto en STEL Order</label>
      <div class="toolbar"><input id="stelItemRef" type="text" maxlength="80" placeholder="Ej.: 1255007092" autocomplete="off"> <button class="btn" type="button" id="stelFindProduct">Buscar producto</button></div>
      <p id="stelFindStatus" class="muted" aria-live="polite"></p>
      <div id="stelProductResult"></div>
    </div>
    <div class="card">
      <h3>Albarán original · próxima etapa</h3>
      <p>En la siguiente etapa incorporaremos lectura de PDF y fotografías con IA y revisión de obra, fecha y abonos. No subas aquí documentación: este módulo todavía no procesa ni almacena archivos.</p>
    </div>`);
  const button=$("stelFindProduct"), input=$("stelItemRef"), status=$("stelFindStatus"), result=$("stelProductResult");
  const find=async()=>{
    const reference=input.value.trim();
    if(!/^[A-Za-z0-9._\/-]{2,80}$/.test(reference)){status.textContent="Introduce una referencia válida (2–80 caracteres; letras, cifras, guiones, puntos o barras).";return;}
    button.disabled=true;status.textContent="Buscando en STEL Order…";result.innerHTML="";
    try{
      const data=await sb("/functions/v1/stel-productos-piloto",{method:"POST",body:JSON.stringify({reference})});
      const items=Array.isArray(data?.products)?data.products:[];
      if(!items.length){
        const d=data?.diagnostic||{};
        const n=Number.isInteger(d.received)?d.received:null;
        status.textContent=n===0
          ? "Conexión con STEL correcta, pero su API no devolvió artículos para esa referencia."
          : "Conexión con STEL correcta. "+(n===null?"":("La API devolvió "+n+" registros; "))+"ninguno tiene esta referencia exacta en el campo de producto.";
        const sample=Array.isArray(d.sample)?d.sample.filter(x=>x.reference).slice(0,4):[];
        result.innerHTML='<p class="muted">La referencia impresa por el proveedor puede ser distinta de la referencia del catálogo de STEL. Revisa la ficha del artículo en STEL antes de asociarlo. No se inventará ningún ID.</p>'+
           (sample.length?'<p class="muted">Ejemplos de referencias devueltas por la API (no son coincidencias): '+sample.map(x=>esc(x.reference)).join(", ")+'</p>':"");
        return;
      }
      status.textContent=items.length+" coincidencia(s) exacta(s) encontrada(s).";
      result.innerHTML='<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Producto</th><th>ID interno STEL</th></tr></thead><tbody>'+
        items.map(p=>'<tr><td>'+esc(p.reference)+'</td><td>'+esc(p.name)+'</td><td><b>'+esc(p.id)+'</b></td></tr>').join("")+
        '</tbody></table></div>';
    }catch(e){status.textContent="No se pudo consultar STEL: "+(e?.message||String(e))+". Comprueba que se haya configurado STEL_API_KEY en Supabase."; }
    finally{button.disabled=false;}
  };
  button.addEventListener("click",find);
  input.addEventListener("keydown",e=>{if(e.key==="Enter") find();});
}
