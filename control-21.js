"use strict";
// Control privado de pedidos y conciliación, independiente de escrituras en STEL.
let pedidoActualId=null;
let pedidoOrigenFormulario="MANUAL";
let pedidoArchivoPdfBase64=null;
const pcNum=v=>Number(String(v??"").replace(",","."))||0;
const pcMoney=v=>v===null||v===undefined?"Pendiente":Number(v).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:4})+" €";
const pcFmt=v=>Number(v||0).toLocaleString("es-ES",{maximumFractionDigits:3});
const pcToday=()=>new Date().toISOString().slice(0,10);
function pcError(e){alert(e?.message||String(e));}
async function renderPedidosCompras(){
 if(!has("costes.ver"))return;
 setTopbar("Pedidos y conciliación","Entregas parciales · Facturas · Alertas de precios");
 loading("Cargando pedidos…");
 let orders=[],summary=[],alerts=[];
 try{
  [orders,summary,alerts]=await Promise.all([
   sb("/rest/v1/pedidos_compra?select=*&order=creado_en.desc&limit=300"),
   sb("/rest/v1/pedido_resumen_lineas?select=*&limit=1500"),
   sb("/rest/v1/pedido_alertas?estado=eq.ABIERTA&select=*&order=creado_en.desc&limit=300")
  ]);
 }catch(e){setContent('<div class="card"><h3>No se pueden cargar pedidos</h3><p class="error">'+esc(e.message)+'</p></div>');return;}
 const active=orders.filter(o=>o.estado!=="CERRADO");
 const byOrder=new Map();
 summary.forEach(l=>{const a=byOrder.get(l.pedido_id)||[];a.push(l);byOrder.set(l.pedido_id,a);});
 const byAlert=new Map();
 alerts.forEach(a=>byAlert.set(a.pedido_id,(byAlert.get(a.pedido_id)||0)+1));
 const kpis='<div class="grid cards">'+
  '<div class="card"><div class="metric-label">Pedidos abiertos</div><div class="metric">'+active.length+'</div></div>'+
  '<div class="card"><div class="metric-label">Alertas sin resolver</div><div class="metric">'+alerts.length+'</div></div>'+
  '<div class="card"><div class="metric-label">Con entregas pendientes</div><div class="metric">'+active.filter(o=>(byOrder.get(o.id)||[]).some(l=>pcNum(l.cantidad_pendiente)>0)).length+'</div></div>'+
 '</div>';
 const rows=orders.map((o,i)=>{
  const ls=byOrder.get(o.id)||[],delivered=ls.filter(l=>pcNum(l.cantidad_recibida)>=pcNum(l.cantidad_pedida)).length;
  const alertCount=byAlert.get(o.id)||0,allComplete=ls.length&&delivered===ls.length;
  return '<tr><td><b>'+esc(o.numero)+'</b></td><td>'+esc(o.proveedor)+'</td>'+
   '<td>'+esc(o.fecha||"—")+'</td><td>'+esc(o.codigo_proyecto||"—")+'</td>'+
   '<td>'+delivered+'/'+ls.length+' líneas completas</td>'+
   '<td>'+(alertCount?'<b style="color:#b45309">'+alertCount+' alerta(s)</b>':'Sin alertas')+'</td>'+
   '<td>'+esc(o.estado==="CERRADO"?"CERRADO":allComplete?"ENTREGADO · VERIFICAR FACTURA":"ABIERTO")+'</td>'+
   '<td><button type="button" class="btn secondary" data-pc-open="'+esc(o.id)+'">Abrir</button></td></tr>';
 }).join("");
 const canWrite=has("costes.editar");
 setContent(
  '<div class="module-note sensitive-note"><b>Control interno de DAFRICA.</b> Los pedidos, entregas y facturas de este módulo NO modifican STEL Order. Los precios de albaranes sin precio permanecen pendientes; cualquier diferencia de factura genera incidencia.</div>'+
  kpis+
  (canWrite?'<div class="card"><h3>Crear pedido</h3><p class="muted">Introduce las líneas manualmente. Precio opcional: déjalo vacío si no consta.</p>'+
   '<form id="pcCreate"><div class="form-grid">'+
   '<div><label>N.º pedido *</label><input id="pcNumber" required maxlength="120" placeholder="PED-2026-001"></div>'+
   '<div><label>Proveedor *</label><input id="pcSupplier" required maxlength="200" placeholder="Nombre del proveedor"></div>'+
   '<div><label>Fecha</label><input id="pcDate" type="date" value="'+pcToday()+'"></div>'+
   '<div><label>Código de obra / proyecto</label><input id="pcProject" maxlength="50" placeholder="PRY00127"></div></div>'+
   '<label>Líneas: una por fila · referencia | descripción | cantidad | unidad | precio neto opcional</label>'+
   '<textarea id="pcLines" rows="5" required placeholder="0190090281 | Bandeja condensados | 1 | ud |&#10;1255007092 | Codo de latón | 4 | ud | 12,50"></textarea>'+
   '<div class="toolbar"><button type="submit" class="btn" id="pcCreateBtn">Guardar pedido abierto</button></div>'+
   '<p class="muted">No se cerrará automáticamente por el hecho de subir un documento.</p></form></div>':'')+
  '<div class="card"><div class="section-head"><div><h3>Todos los pedidos</h3><p>Pulsa «Abrir» para consultar unidades entregadas, pendientes, facturas e incidencias.</p></div></div>'+
   '<div class="table-wrap"><table><thead><tr><th>Número</th><th>Proveedor</th><th>Fecha</th><th>Obra</th><th>Recepción</th><th>Alertas</th><th>Estado</th><th></th></tr></thead><tbody>'+
   (rows||'<tr><td colspan="8">No hay pedidos registrados todavía.</td></tr>')+'</tbody></table></div></div>'+
  '<div id="pcBatch"></div><div id="pcDetail"></div>'
 );
 if(canWrite)$("pcCreate")?.addEventListener("submit",async e=>{
  e.preventDefault();
  try{
   const str=String($("pcLines").value||"").trim().split(/\r?\n/).filter(x=>x.trim());
   if(!str.length||str.length>100)throw Error("Introduce entre 1 y 100 líneas");
   const lines=str.map((s,i)=>{
    const fields=s.includes("|")?s.split("|"):s.split("\t");
    if(fields.length<3)throw Error("Línea "+(i+1)+": usa referencia | descripción | cantidad | unidad | precio");
    const ref=fields[0].trim(),desc=(fields[1]||"").trim();
    const qty=pcNum(fields[2]),unit=(fields[3]||"ud").trim()||"ud";
    const price=String(fields[4]||"").trim();
    if(!desc||!Number.isFinite(qty)||qty<=0)throw Error("Descripción/cantidad incorrecta en línea "+(i+1));
    if(price&&(!Number.isFinite(Number(price.replace(",",".")))||Number(price.replace(",","."))<0))throw Error("Precio incorrecto en línea "+(i+1));
    return {referencia:ref,descripcion:desc,cantidad:qty,unidad:unit,precio:price?Number(price.replace(",",".")):null};
   });
   const btn=$("pcCreateBtn");btn.disabled=true;
   const id=await sb("/rest/v1/rpc/pedido_crear_con_lineas",{method:"POST",body:JSON.stringify({
    p_numero:$("pcNumber").value.trim(),p_proveedor:$("pcSupplier").value.trim(),
    p_fecha:$("pcDate").value||null,p_codigo_proyecto:$("pcProject").value.trim(),
    p_lineas:lines,p_origen:pedidoOrigenFormulario
   })});
   let uploadWarning="";
   if(pedidoOrigenFormulario==="PDF"&&pedidoArchivoPdfBase64){
    try{
     const binary=atob(pedidoArchivoPdfBase64);
     const buffer=new Uint8Array(binary.length);
     for(let j=0;j<binary.length;j++)buffer[j]=binary.charCodeAt(j);
     const location="pedidos/"+encodeURIComponent(id)+"/original.pdf";
     await sb("/storage/v1/object/documentos-contables/"+location,{
      method:"POST",headers:{"Content-Type":"application/pdf","x-upsert":"false"},body:buffer
     });
     await sb("/rest/v1/pedidos_compra?id=eq."+encodeURIComponent(id),{
      method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({archivo_pdf_path:location})
     });
    }catch(error){uploadWarning="El pedido se ha guardado, pero no se pudo archivar el PDF privado: "+(error?.message||String(error));}
   }
   pedidoOrigenFormulario="MANUAL";pedidoArchivoPdfBase64=null;pedidoActualId=id;
   await renderPedidosCompras();
   if(uploadWarning)alert(uploadWarning);
  }catch(err){pcError(err);$("pcCreateBtn").disabled=false;}
 });
 document.querySelectorAll("[data-pc-open]").forEach(b=>b.addEventListener("click",()=>pcShowOrder(b.dataset.pcOpen)));
 if(typeof renderComprasLotePilot==="function")renderComprasLotePilot();
 if(pedidoActualId&&orders.some(x=>x.id===pedidoActualId))await pcShowOrder(pedidoActualId);
}
async function pcShowOrder(id){
 pedidoActualId=id;
 const root=$("pcDetail");if(!root)return;
 root.innerHTML='<div class="card"><p class="muted">Cargando detalle…</p></div>';
 try{
  const [orderRows,lines,receipts,invoices,invLines,alerts]=await Promise.all([
   sb("/rest/v1/pedidos_compra?id=eq."+encodeURIComponent(id)+"&select=*&limit=1"),
   sb("/rest/v1/pedido_resumen_lineas?pedido_id=eq."+encodeURIComponent(id)+"&select=*&order=posicion.asc"),
   sb("/rest/v1/pedido_entregas?select=*&pedido_linea_id=in.("+encodeURIComponent((await sb("/rest/v1/pedido_lineas?pedido_id=eq."+encodeURIComponent(id)+"&select=id")).map(x=>x.id).join(","))+")&order=fecha.desc").catch(()=>[]),
   sb("/rest/v1/pedido_facturas?pedido_id=eq."+encodeURIComponent(id)+"&select=*&order=fecha.desc"),
   sb("/rest/v1/pedido_factura_lineas?select=*,pedido_facturas!inner(pedido_id)&pedido_facturas.pedido_id=eq."+encodeURIComponent(id)).catch(()=>[]),
   sb("/rest/v1/pedido_alertas?pedido_id=eq."+encodeURIComponent(id)+"&select=*&order=creado_en.desc")
  ]);
  const order=orderRows[0];
  if(!order)throw Error("Pedido no encontrado");
  const canWrite=has("costes.editar")&&order.estado!=="CERRADO";
  const currency=v=>pcMoney(v);
  const receiptsMap=new Map(), invoicesMap=new Map(),byAlert=new Map();
  receipts.forEach(d=>{const a=receiptsMap.get(d.pedido_linea_id)||[];a.push(d);receiptsMap.set(d.pedido_linea_id,a);});
  invLines.forEach(d=>{const a=invoicesMap.get(d.pedido_linea_id)||[];a.push(d);invoicesMap.set(d.pedido_linea_id,a);});
  alerts.filter(a=>a.estado==="ABIERTA").forEach(a=>byAlert.set(a.pedido_linea_id,(byAlert.get(a.pedido_linea_id)||0)+1));
  const complete=lines.length&&lines.every(l=>pcNum(l.cantidad_recibida)===pcNum(l.cantidad_pedida));
  const invoiced=lines.length&&lines.every(l=>pcNum(l.cantidad_facturada)===pcNum(l.cantidad_recibida));
  const openAlerts=alerts.filter(a=>a.estado==="ABIERTA");
  const canClose=complete&&invoiced&&!openAlerts.length&&canWrite;
  const rows=lines.map(l=>{
   const full=pcNum(l.cantidad_pendiente)===0,excess=pcNum(l.cantidad_recibida)>pcNum(l.cantidad_pedida);
   return '<tr><td>'+(full&&!excess?'<s>'+esc(l.referencia||"—")+'</s>':esc(l.referencia||"—"))+'</td>'+
    '<td>'+(full&&!excess?'<s>'+esc(l.descripcion)+'</s>':esc(l.descripcion))+'</td>'+
    '<td>'+pcFmt(l.cantidad_pedida)+' '+esc(l.unidad)+'</td>'+
    '<td>'+pcFmt(l.cantidad_recibida)+'</td><td><b>'+pcFmt(l.cantidad_pendiente)+'</b></td>'+
    '<td>'+pcFmt(l.cantidad_facturada)+'</td><td>'+currency(l.precio_pactado)+'</td>'+
    '<td>'+(excess?'<b class="error">Exceso de entrega</b>':full?'Entregado':'Pendiente')+
       (byAlert.get(l.id)?' · <b class="error">'+byAlert.get(l.id)+' alerta(s)</b>':'')+'</td></tr>';
  }).join("");
  const deliveryRows=receipts.map(d=>{
   const l=lines.find(x=>x.id===d.pedido_linea_id);
   return '<tr><td>'+esc(d.numero_albaran)+'</td><td>'+esc(d.fecha)+'</td><td>'+esc(l?.descripcion||"—")+'</td>'+
    '<td>'+pcFmt(d.cantidad)+'</td><td>'+esc(d.origen)+'</td>'+
    '<td>'+(d.facturado?'<b>Bloqueado · facturado</b>':canWrite?'<button type="button" class="btn secondary" data-pc-lock="'+esc(d.id)+'">Marcar facturado</button>':'Pendiente')+'</td></tr>';
  }).join("");
  const invoiceRows=invoices.map(f=>'<tr><td>'+esc(f.numero_factura)+'</td><td>'+esc(f.fecha)+'</td>'+
   '<td>'+invLines.filter(x=>x.factura_id===f.id).length+' línea(s)</td></tr>').join("");
  const issueRows=alerts.map(a=>{
   const l=lines.find(x=>x.id===a.pedido_linea_id);
   return '<tr><td>'+esc(a.tipo)+'</td><td>'+esc(l?.referencia||"—")+'</td><td>'+esc(a.mensaje)+'</td>'+
     '<td>'+currency(a.precio_base)+' → '+currency(a.precio_detectado)+'</td><td>'+esc(a.estado)+'</td><td>'+
     (canWrite&&a.estado==="ABIERTA"?'<button class="btn secondary" type="button" data-pc-resolve="'+esc(a.id)+'">Marcar resuelta</button>':'')+'</td></tr>';
  }).join("");
  const options=lines.map(l=>'<option value="'+esc(l.id)+'">'+esc((l.referencia||"S/Ref")+" · "+l.descripcion)+'</option>').join("");
  const creation=canWrite?'<div class="grid two">'+
    '<div class="card"><h3>Registrar entrega</h3><p class="muted">El precio del albarán es opcional. Las unidades se descuentan del pedido.</p>'+
    '<form id="pcDelivery"><label>Material del pedido</label><select id="pcDeliveryLine">'+options+'</select>'+
    '<div class="form-grid"><div><label>N.º albarán *</label><input id="pcDeliveryNum" required></div>'+
    '<div><label>Fecha *</label><input id="pcDeliveryDate" type="date" value="'+pcToday()+'" required></div>'+
    '<div><label>Unidades entregadas *</label><input id="pcDeliveryQty" type="number" min="0.001" step="0.001" required></div>'+
    '<div><label>Precio unitario (opcional)</label><input id="pcDeliveryPrice" type="number" min="0" step="0.0001"></div></div>'+
    '<button class="btn" type="submit">Registrar entrega parcial</button></form></div>'+
    '<div class="card"><h3>Registrar factura</h3><p class="muted">Compara el precio neto (sin IVA) con pedido e histórico y abre alertas.</p>'+
    '<form id="pcInvoice"><label>Material facturado</label><select id="pcInvoiceLine">'+options+'</select>'+
    '<div class="form-grid"><div><label>N.º factura *</label><input id="pcInvoiceNum" required></div>'+
    '<div><label>Fecha *</label><input id="pcInvoiceDate" type="date" value="'+pcToday()+'" required></div>'+
    '<div><label>Cantidad facturada *</label><input id="pcInvoiceQty" type="number" min="0.001" step="0.001" required></div>'+
    '<div><label>Precio unitario antes de descuento *</label><input id="pcInvoicePrice" type="number" min="0" step="0.0001" required></div>'+
    '<div><label>Descuento (%)</label><input id="pcInvoiceDiscount" type="number" min="0" max="100" step="0.001" value="0"></div></div>'+
    '<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" style="width:auto" id="pcInvoiceCreateDelivery">No existió albarán previo: registrar entrega interna a partir de esta factura (NO en STEL)</label>'+
    '<button class="btn" type="submit">Registrar factura y comprobar precios</button></form></div></div>':'';
  root.innerHTML='<div class="card" style="margin-top:16px"><div class="section-head"><div><h3>Pedido '+esc(order.numero)+'</h3>'+
   '<p>'+esc(order.proveedor)+' · '+esc(order.codigo_proyecto||"Sin proyecto")+' · '+esc(order.estado)+'</p></div>'+
   (canWrite?'<button type="button" class="btn" id="pcClose"'+(canClose?'':' disabled')+'>Cerrar pedido</button>':'')+'</div>'+
   '<p class="muted">Entrega: '+(complete?'Completa':'Pendiente / exceso')+' · Facturación: '+(invoiced?'Cuadrada':'Pendiente')+
   ' · Alertas abiertas: '+openAlerts.length+'. Solo se puede cerrar con todas las unidades recibidas, facturadas y sin incidencias.</p>'+
   '<h4>Materiales · se tachan al completar la entrega</h4>'+
   '<div class="table-wrap"><table><thead><tr><th>Referencia</th><th>Material</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Facturado</th><th>Precio pactado</th><th>Estado</th></tr></thead><tbody>'+
   (rows||'<tr><td colspan="8">Sin materiales</td></tr>')+'</tbody></table></div></div>'+
   creation+
   '<div class="card"><h3>Entregas vinculadas al pedido</h3><div class="table-wrap"><table><thead><tr><th>Albarán</th><th>Fecha</th><th>Material</th><th>Unidades</th><th>Origen</th><th>Protección</th></tr></thead><tbody>'+
   (deliveryRows||'<tr><td colspan="6">Sin entregas</td></tr>')+'</tbody></table></div></div>'+
   '<div class="card"><h3>Facturas relacionadas</h3><div class="table-wrap"><table><thead><tr><th>Factura</th><th>Fecha</th><th>Líneas</th></tr></thead><tbody>'+
   (invoiceRows||'<tr><td colspan="3">Sin facturas</td></tr>')+'</tbody></table></div></div>'+
   '<div class="card"><h3>Alertas e incidencias ('+openAlerts.length+' abiertas)</h3>'+
   '<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Material</th><th>Incidencia</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody>'+
   (issueRows||'<tr><td colspan="6">Sin incidencias</td></tr>')+'</tbody></table></div></div>';
  if(canWrite){
   $("pcDelivery")?.addEventListener("submit",async ev=>{
    ev.preventDefault();
    try{
     const qty=pcNum($("pcDeliveryQty").value),l=lines.find(x=>x.id===$("pcDeliveryLine").value);
     if(!l||qty<=0)throw Error("Indica material y cantidad");
     if(qty>pcNum(l.cantidad_pendiente)){
      if(!confirm("La cantidad supera la pendiente del pedido. ¿Registrar entrega con exceso e incidencia?"))return;
     }
     await sb("/rest/v1/pedido_entregas",{method:"POST",headers:{"Prefer":"return=minimal"},body:JSON.stringify({
      pedido_linea_id:l.id,numero_albaran:$("pcDeliveryNum").value.trim(),
      fecha:$("pcDeliveryDate").value,cantidad:qty,origen:"ALBARAN",
      precio_albaran:$("pcDeliveryPrice").value===""?null:pcNum($("pcDeliveryPrice").value)
     })});
     await renderPedidosCompras();
    }catch(e){pcError(e);}
   });
   $("pcInvoice")?.addEventListener("submit",async ev=>{
    ev.preventDefault();
    try{
     const derived=$("pcInvoiceCreateDelivery").checked;
     if(derived&&!confirm("Confirma que NO existió albarán previo. Se registrará una entrega interna bloqueada desde la factura, SIN escribir en STEL."))return;
     await sb("/rest/v1/rpc/pedido_registrar_factura_linea",{method:"POST",body:JSON.stringify({
      p_pedido_id:id,p_numero_factura:$("pcInvoiceNum").value.trim(),
      p_fecha:$("pcInvoiceDate").value,p_pedido_linea_id:$("pcInvoiceLine").value,
      p_cantidad:pcNum($("pcInvoiceQty").value),p_precio:pcNum($("pcInvoicePrice").value),
      p_descuento:pcNum($("pcInvoiceDiscount").value),p_crear_entrega:derived
     })});
     await renderPedidosCompras();
    }catch(e){pcError(e);}
   });
   $("pcClose")?.addEventListener("click",async()=>{
    if(!confirm("¿Cerrar definitivamente el pedido conciliado?"))return;
    try{await sb("/rest/v1/pedidos_compra?id=eq."+encodeURIComponent(id),{
      method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({estado:"CERRADO"})
     });pedidoActualId=null;await renderPedidosCompras();}catch(e){pcError(e);}
   });
   document.querySelectorAll("[data-pc-lock]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Confirma que esta entrega está FACTURADA en STEL. No podrá modificarse después."))return;
    try{await sb("/rest/v1/rpc/pedido_marcar_entrega_facturada",{method:"POST",body:JSON.stringify({p_entrega_id:b.dataset.pcLock})});await renderPedidosCompras();}
    catch(e){pcError(e);}
   }));
   document.querySelectorAll("[data-pc-resolve]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("¿Has comprobado y resuelto la diferencia con el proveedor? Se conservará el histórico de la alerta."))return;
    try{await sb("/rest/v1/pedido_alertas?id=eq."+encodeURIComponent(b.dataset.pcResolve),{
      method:"PATCH",headers:{"Prefer":"return=minimal"},body:JSON.stringify({estado:"RESUELTA",resuelta_por:state.user?.id||null,resuelta_en:new Date().toISOString()})
     });await renderPedidosCompras();}catch(e){pcError(e);}
   }));
  }
 }catch(e){root.innerHTML='<div class="card"><p class="error">'+esc(e.message)+'</p></div>';}
}
