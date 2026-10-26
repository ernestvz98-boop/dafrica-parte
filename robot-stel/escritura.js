"use strict";
/*
 * DAFRICA · Autorizador de escrituras del robot de STEL (Fase 2, aprobada por el usuario el 2026-10-26).
 *
 * Toda petición del navegador del robot pasa por guardia.js (solo lectura). Las ÚNICAS escrituras que
 * pueden salir son las de UN albarán de la cola, y solo si coinciden con su orden (plan):
 *  - guardarProducto: un artículo NUEVO (serie MANUAL) de los que la orden manda crear, con la
 *    referencia y el nombre del lector; una vez cada uno.
 *  - guardarDocumentoComercial: un albarán de proveedor NUEVO, no generado desde otro documento, con el
 *    proveedor, la fecha, el título, la Ref. Documento Proveedor, la obra y exactamente las líneas de
 *    la orden (artículo, unidades y precio); una vez.
 *  - el adjunto: UNA subida de fichero, después de crear el albarán, con el nombre del PDF de la orden.
 * Todo lo demás (otra operación, otro valor, un reintento) se cancela. Nunca se modifica ni se borra
 * nada que ya existiera en STEL.
 */
const nuevo=v=>v==null||["","0","-1","null","undefined"].includes(String(v).trim());
const num=v=>{const n=Number(String(v??"").trim().replace(/\./g,"").replace(",","."));return Number.isFinite(n)?n:NaN;};
const numPunto=v=>{const s=String(v??"").trim();return /^-?\d+(\.\d+)?$/.test(s)?Number(s):num(s);};
const igual=(a,b)=>Math.abs(a-b)<0.0005;

/*
 * Lo que se espera escribir para un albarán. plan: la orden de la cola (albaranes/cola-stel.js).
 * ids: {referencia → id de STEL} de los artículos (existentes o recién creados).
 * Devuelve {albaran:{idCliente,fecha,titulo,referenciaDocumentoExtra,stringIdsProyectos,lineas:[{id,unidades,precio}]},
 *           productos:{referencia → nombre}, adjunto:{fichero}|null}.
 */
function esperado(plan,{ids={},fichero=null}={}){
 if(!plan?.proveedor?.account_id||!plan.fecha||!plan.numero||!plan.obra?.stel_id)throw Error("Orden incompleta");
 const lineas=plan.lineas.map(l=>{
  const id=l.articulo?.item_id??ids[l.referencia];
  if(id==null)throw Error("Artículo sin id de STEL: "+l.referencia);
  // Sin precio: el del pedido (lo pone el robot en la orden) o 0,00 con el aviso PRECIO PENDIENTE.
  const precio=Number.isFinite(l.precio)?l.precio:Number.isFinite(l.precio_pedido)?l.precio_pedido:0;
  return {id:String(id),unidades:l.cantidad,precio};
 });
 const productos={};
 for(const l of plan.lineas)if(l.articulo?.estado==="crear")productos[l.articulo.propuesta.referencia]=l.articulo.propuesta.descripcion;
 return {albaran:{idCliente:String(plan.proveedor.account_id),fecha:plan.fecha,titulo:titulo(plan),referenciaDocumentoExtra:plan.numero,
  stringIdsProyectos:String(plan.obra.stel_id),lineas},productos,adjunto:fichero?{fichero}:null};
}

// Título del albarán en STEL: «número fecha obra» (como los que escribe la oficina) y el pedido si lo hay.
function titulo(plan){
 return [plan.numero,plan.fecha,plan.obra?.nombre||plan.obra?.codigo,plan.pedido?"· "+plan.pedido.codigo:""].filter(Boolean).join(" ").slice(0,150);
}

/*
 * Autorizador de UN albarán. autorizar(op, campos, extra) → [permitida, motivo, diagnóstico sin precios].
 * campos: URLSearchParams del cuerpo (o null en una subida de fichero); extra: {multipart, cuerpoTexto}.
 * idAlbaran(id): una vez creado el albarán, su id (para aceptar el adjunto solo en él).
 */
function crearAutorizador(esp){
 const gastado={productos:{},albaran:false,adjunto:false};let idCreado=null;
 const diagLineas=L=>(Array.isArray(L)?L:[]).map(x=>({idObjetoCatalogo:String(x?.idObjetoCatalogo??""),unidades:String(x?.unidades??"")}));
 function autorizar(op,q,extra={}){
  if(op==="guardarProducto"){
   const ref=String(q.get("referencia")||""),diag={referencia:ref,idProducto:q.get("idProducto"),idSerie:q.get("idSerie")};
   if(!(ref in esp.productos))return [false,"artículo fuera de la orden",diag];
   if(gastado.productos[ref])return [false,"ya creado (reintento o repetido)",diag];
   if(!nuevo(q.get("idProducto")))return [false,"no es un artículo nuevo (modificaría uno existente)",diag];
   if(String(q.get("idSerie"))!=="-2")return [false,"serie distinta de MANUAL",diag];
   if(String(q.get("nombre")||"")!==esp.productos[ref])return [false,"nombre distinto del lector",diag];
   gastado.productos[ref]=true;return [true,"ok",diag];
  }
  if(op==="guardarDocumentoComercial"){
   const A=esp.albaran;let L;try{L=JSON.parse(q.get("lineasDocumentoComercial")||"");}catch{L=null;}
   const diag={id:q.get("id"),tipo:q.get("tipo"),idCliente:q.get("idCliente"),titulo:q.get("titulo"),referenciaDocumentoExtra:q.get("referenciaDocumentoExtra"),
    stringIdsProyectos:q.get("stringIdsProyectos"),idDocumentoComercialPadre:q.get("idDocumentoComercialPadre"),lineas:diagLineas(L)};
   if(gastado.albaran)return [false,"ya creado (reintento o repetido)",diag];
   if(!nuevo(q.get("id")))return [false,"no es un albarán nuevo (modificaría uno existente)",diag];
   if(q.get("tipo")!=="ALBARANDEPROVEEDOR")return [false,"tipo de documento distinto",diag];
   if(!nuevo(q.get("idDocumentoComercialPadre")))return [false,"generado desde otro documento",diag];
   for(const k of ["idCliente","titulo","referenciaDocumentoExtra","stringIdsProyectos"])
    if(String(q.get(k)??"").trim()!==String(A[k]))return [false,k+" distinto de la orden",diag];
   if(!String(q.get("fecha")||"").includes(A.fecha))return [false,"fecha distinta de la orden",diag];
   if(!Array.isArray(L)||L.length!==A.lineas.length)return [false,"número de líneas distinto",diag];
   const libres=A.lineas.map(l=>({...l,usada:false}));
   for(const x of L){
    if(!nuevo(x?.id)||!nuevo(x?.idDocumentoPadre))return [false,"línea enlazada a otro documento",diag];
    const precios=Object.entries(x||{}).filter(([k])=>/precio/i.test(k)).map(([,v])=>numPunto(v));
    const l=libres.find(e=>!e.usada&&e.id===String(x?.idObjetoCatalogo)&&igual(numPunto(x?.unidades),e.unidades)&&precios.some(p=>igual(p,e.precio)));
    if(!l)return [false,"línea distinta de la orden (artículo "+String(x?.idObjetoCatalogo)+")",diag];
    l.usada=true;
   }
   gastado.albaran=true;return [true,"ok",diag];
  }
  if(op==="adjunto"){
   const diag={multipart:!!extra.multipart};
   if(!esp.adjunto)return [false,"la orden no lleva adjunto",diag];
   if(gastado.adjunto)return [false,"adjunto ya subido (reintento o repetido)",diag];
   if(!idCreado)return [false,"el albarán aún no está creado",diag];
   const t=String(extra.cuerpoTexto||"");
   if(!extra.multipart||!t.includes(esp.adjunto.fichero)||!t.includes(String(idCreado)))return [false,"subida distinta (otro fichero u otro documento)",diag];
   gastado.adjunto=true;return [true,"ok",diag];
  }
  return [false,"operación de escritura no autorizada",{}];
 }
 return {autorizar,gastado,idAlbaran:id=>{idCreado=id==null?null:String(id);}};
}

module.exports={esperado,crearAutorizador,titulo};
