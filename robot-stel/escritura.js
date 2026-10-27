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
 *  - el adjunto: UNA subida del PDF de la orden y UNA petición que lo enlaza a ESE albarán (con su id y el
 *    nombre del fichero), después de crearlo.
 * Todo lo demás (otra operación, otro valor, un reintento) se cancela. Nunca se modifica ni se borra
 * nada que ya existiera en STEL.
 */
const nuevo=v=>v==null||["","0","-1","null","undefined"].includes(String(v).trim());
const num=v=>{const n=Number(String(v??"").trim().replace(/\./g,"").replace(",","."));return Number.isFinite(n)?n:NaN;};
const numPunto=v=>{const s=String(v??"").trim();return /^-?\d+(\.\d+)?$/.test(s)?Number(s):num(s);};
const igual=(a,b)=>Math.abs(a-b)<0.0005;

/*
 * Descuento de la línea en la ÚNICA casilla de STEL. Varios descuentos en cascada (60 + 10) se combinan
 * (1 − 0,40 × 0,90 = 64 %) solo si el resultado es exacto con 2 decimales y, con precio e importe del
 * papel, la línea cuadra (±0,01). Si no, null: el albarán se para (nunca se redondea un descuento).
 */
function descuentoLinea(l){
 const d=(l.descuentos||[]).filter(Number.isFinite);
 if(!d.length)return 0;
 if(d.some(x=>x<0||x>=100))return null;
 const total=(1-d.reduce((f,x)=>f*(1-x/100),1))*100;
 if(Math.abs(total*100-Math.round(total*100))>1e-6)return null;
 const dto=Math.round(total*100)/100;
 if(Number.isFinite(l.precio)&&Number.isFinite(l.importe)&&Number.isFinite(l.cantidad)&&Math.abs(l.cantidad*l.precio*(1-dto/100)-l.importe)>0.01)return null;
 return dto;
}

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
  const descuento=descuentoLinea(l);
  if(descuento==null)throw Error("Descuento no representable en STEL: "+l.referencia);
  return {id:String(id),unidades:l.cantidad,precio,descuento};
 });
 const {productos}=soloProductos(plan);
 return {albaran:{idCliente:String(plan.proveedor.account_id),fecha:plan.fecha,titulo:titulo(plan),referenciaDocumentoExtra:plan.numero,
  stringIdsProyectos:String(plan.obra.stel_id),lineas},productos,adjunto:fichero?{fichero}:null};
}

// Solo las altas de artículos de la orden (antes de rellenar el albarán, cuando aún no se sabe el id de la obra).
function soloProductos(plan){
 const productos={};
 for(const l of plan.lineas)if(l.articulo?.estado==="crear")productos[l.articulo.propuesta.referencia]=l.articulo.propuesta.descripcion;
 return {albaran:null,productos,adjunto:null};
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
   if(!A)return [false,"la orden aún no autoriza el albarán (primero los artículos)",diag];
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
    // Descuento: si la línea trae casilla de descuento, ha de ser el de la orden; sin casilla, solo vale sin descuento.
    // Solo el porcentaje («porcentajeDescuento»): «precioDescuento» es un precio, no un descuento.
    const dtos=Object.entries(x||{}).filter(([k])=>/porcentaje.*descuento|^descuento$/i.test(k)).map(([,v])=>numPunto(v)).filter(Number.isFinite);
    const dtoOk=e=>dtos.length?dtos.some(v=>igual(v,e.descuento)):e.descuento===0;
    const l=libres.find(e=>!e.usada&&e.id===String(x?.idObjetoCatalogo)&&igual(numPunto(x?.unidades),e.unidades)&&precios.some(p=>igual(p,e.precio))&&dtoOk(e));
    if(!l)return [false,"línea distinta de la orden (artículo "+String(x?.idObjetoCatalogo)+")",diag];
    l.usada=true;
   }
   gastado.albaran=true;return [true,"ok",diag];
  }
  // Adjunto en dos pasos (medido en el ensayo de 2026-10-27): 1) la subida del fichero
  // (FileUploadServlet, solo el fichero, sin el albarán); 2) la petición que lo enlaza al albarán.
  if(op==="adjunto"){
   const diag={multipart:!!extra.multipart};
   if(!esp.adjunto)return [false,"la orden no lleva adjunto",diag];
   if(gastado.adjunto)return [false,"adjunto ya subido (reintento o repetido)",diag];
   if(!idCreado)return [false,"el albarán aún no está creado",diag];
   if(!extra.multipart||!String(extra.cuerpoTexto||"").includes(esp.adjunto.fichero))return [false,"subida distinta (otro fichero)",diag];
   gastado.adjunto=true;return [true,"ok",diag];
  }
  if(op==="enlazarAdjunto"){
   const diag={operacion:String(extra.operacion||"")};
   if(!gastado.adjunto)return [false,"no hay fichero subido que enlazar",diag];
   if(gastado.enlace)return [false,"adjunto ya enlazado (reintento o repetido)",diag];
   if(/eliminar|borrar|cambiarEstado|guardarDocumentoComercial|guardarProducto/i.test(diag.operacion))return [false,"operación que no es un enlace de adjunto",diag];
   const t=String(extra.cuerpoTexto||"");
   if(!t.includes(String(idCreado))||!t.includes(esp.adjunto.fichero))return [false,"enlace distinto (otro albarán u otro fichero)",diag];
   gastado.enlace=true;return [true,"ok",diag];
  }
  return [false,"operación de escritura no autorizada",{}];
 }
 return {autorizar,gastado,idAlbaran:id=>{idCreado=id==null?null:String(id);}};
}

module.exports={esperado,soloProductos,crearAutorizador,titulo,descuentoLinea};
