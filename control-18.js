"use strict";
// Piloto de solo lectura: STEL Products, sin crear documentos ni enviar fotografias.
async function renderAlbaranesPiloto(){
  if(!has("costes.ver")){ setContent('<div class="error">No tienes permiso para este piloto.</div>'); return; }
  setTopbar("Consultas STEL · catálogo","Solo consulta de productos y albaranes STEL · sin cambios en STEL");
  setContent(`
    <div class="section-head"><div><h2>Comprobación de productos STEL</h2><p>Busca materiales por referencia o nombre para obtener su ID interno. Solo lectura.</p></div></div>
    <div class="module-note"><b>Solo consulta:</b> aquí puedes buscar productos y albaranes existentes en STEL. Para leer PDF y fotografías utiliza exclusivamente el módulo «Pedidos y alertas», que aplica el lector de filas y comprobaciones automáticas. No introduzcas claves API aquí.</div>
    <div class="card">
      <label for="stelItemRef">Referencia del producto en STEL Order</label>
      <div class="toolbar"><input id="stelItemRef" type="text" maxlength="80" placeholder="Ej.: 1255007092" autocomplete="off"> <button class="btn" type="button" id="stelFindProduct">Buscar producto</button></div>
      <label for="stelItemName">Nombre o descripción del material (opcional)</label>
      <input id="stelItemName" type="text" maxlength="120" placeholder="Ej.: CODO 92 M-H LATON 2" autocomplete="off">
      <p id="stelFindStatus" class="muted" aria-live="polite"></p>
      <div id="stelProductResult"></div>
    </div>
    <div class="card"><h3>Lectura de documentos</h3><p>El lector antiguo de un solo documento se ha retirado porque omitía materiales y podía leer mal códigos PRY y cantidades. Para analizar albaranes, pedidos o facturas abre el lector unificado, que bloquea datos no verificados.</p><button id="stelGoVerifiedReader" type="button" class="btn">Abrir lectura verificada · PDF por lotes</button></div>`);
  if(typeof renderBuscarAlbaranesSTEL==="function") renderBuscarAlbaranesSTEL();
  $("stelGoVerifiedReader")?.addEventListener("click",()=>navigate("pedidos"));
  const button=$("stelFindProduct"), input=$("stelItemRef"), itemName=$("stelItemName"), status=$("stelFindStatus"), result=$("stelProductResult");
  const makeRows=items=>'<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Producto</th><th>ID STEL (verificar)</th></tr></thead><tbody>'+
    items.map(p=>'<tr><td>'+esc(p.reference||"—")+'</td><td>'+esc(p.name||"—")+'</td><td><b>'+esc(p.id)+'</b></td></tr>').join("")+
    '</tbody></table></div>';
  const find=async()=>{
    const reference=input.value.trim(), name=itemName.value.trim();
    if(reference&&!/^[A-Za-z0-9._\/-]{2,80}$/.test(reference)){status.textContent="Introduce una referencia válida.";return;}
    if(name&&name.length<3){status.textContent="Escribe al menos tres caracteres del nombre.";return;}
    if(!reference&&!name){status.textContent="Indica referencia o nombre del material.";return;}
    button.disabled=true;status.textContent="Comprobando filtros y catálogo STEL…";result.innerHTML="";
    try{
      const data=await sb("/functions/v1/stel-productos-piloto",{method:"POST",body:JSON.stringify({reference,name})});
      const items=Array.isArray(data?.products)?data.products:[];
      const candidates=Array.isArray(data?.candidates)?data.candidates:[];
      const d=data?.diagnostic||{};
      if(items.length){
        status.textContent=items.length+" coincidencia(s) de referencia. Verifica el nombre antes de usar el ID.";
        result.innerHTML=makeRows(items);
      }else if(candidates.length){
        status.textContent="Sin coincidencia exacta de referencia; estas son posibles coincidencias por nombre, NO confirmadas.";
        result.innerHTML=makeRows(candidates);
      }else{
        const page=Number.isInteger(d.firstPageCount)?d.firstPageCount:0;
        const filtered=Number.isInteger(d.referenceFilterCount)?d.referenceFilterCount:0;
        status.textContent="Sin coincidencias verificadas en las consultas realizadas.";
        result.innerHTML='<p class="muted">El filtro por referencia devolvió '+filtered+' registros y la primera página del catálogo, '+page+'. No hemos revisado todo el catálogo; por tanto, NO podemos afirmar que el artículo no exista.</p>'+
          '<p class="muted">Prueba a escribir también el nombre impreso en el albarán. No crearemos productos automáticamente mientras pueda tratarse de un duplicado.</p>';
      }
    }catch(e){status.textContent="No se pudo consultar STEL: "+(e?.message||String(e));}
    finally{button.disabled=false;}
  };
  button.addEventListener("click",find);
  input.addEventListener("keydown",e=>{if(e.key==="Enter") find();});
  itemName.addEventListener("keydown",e=>{if(e.key==="Enter") find();});
}
