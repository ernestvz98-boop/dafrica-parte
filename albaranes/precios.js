"use strict";
/*
 * DAFRICA · Resolución de precios pendientes antes de facturar.
 *
 * Reglas obligatorias:
 *  - Un albarán puede registrarse con líneas sin precio: quedan «precio_pendiente».
 *  - Antes de crear una factura se revisan TODAS las líneas. El precio de una línea
 *    pendiente se toma, por este orden:
 *      1. pedido de compra asociado (precio definitivo)
 *      2. precio válido del artículo/proveedor en STEL
 *      3. factura original (solo si se está procesando una factura recibida)
 *      4. si no hay fuente fiable: no se factura automáticamente → revisión.
 *  - Nunca se inventa ni se estima un precio: sin medias, sin «último precio parecido».
 *    Una fuente con varios precios distintos para el mismo artículo no es fiable.
 *  - Trazabilidad por línea: precio_original, precio_utilizado, fuente_precio,
 *    fecha_resolucion_precio.
 * Funciones puras: no leen ni escriben en STEL ni en Supabase.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.precios=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const N=()=>req?req("./normalizar.js"):root.DafricaAlbaranes.normalizar;

const ESTADOS={CONFIRMADO:"precio_confirmado",RESUELTO:"precio_resuelto",PENDIENTE:"precio_pendiente"};
const FUENTES={DOCUMENTO:"documento",PEDIDO:"pedido_compra",ARTICULO:"articulo_stel",FACTURA:"factura_original"};
const precioValido=p=>typeof p==="number"&&Number.isFinite(p)&&p>0;
const redondear=(x,d=2)=>Math.round((x+Math.sign(x)*1e-9)*10**d)/10**d;

/*
 * Estado inicial de una línea al registrar el albarán, a partir del lector
 * (albaranes/extraer.js). Solo un precio leído sin ambigüedad cuenta como confirmado;
 * un precio impreso que no cuadra se conserva como original pero queda pendiente.
 */
function estadoInicial(linea){
 const p=linea?.precio||{};
 const original=p.valor??null;
 const aceptado=(p.estado==="VERIFICADO"||p.estado==="OK")&&precioValido(original);
 return {
  estado_precio:aceptado?ESTADOS.CONFIRMADO:ESTADOS.PENDIENTE,
  precio_original:original,
  precio_original_literal:p.literal||"",
  precio_utilizado:aceptado?original:null,
  fuente_precio:aceptado?FUENTES.DOCUMENTO:null,
  fecha_resolucion_precio:null,
  motivo:aceptado?"":p.estado==="VACIO"?"Albarán sin precio impreso":"Precio impreso no fiable ("+(p.estado||"sin estado")+")"
 };
}

/* Busca el precio de un artículo en una lista de candidatos de UNA fuente. */
function buscar(linea,candidatos,{exigir}={}){
 const itemId=linea.item_id??null;
 const ref=N().canon(linea.referencia||"");
 let coinciden=itemId!=null?candidatos.filter(c=>c.item_id!=null&&String(c.item_id)===String(itemId)):[];
 let via="item_id";
 if(!coinciden.length&&ref){coinciden=candidatos.filter(c=>N().canon(c.referencia||"")===ref);via="referencia";}
 coinciden=coinciden.filter(c=>!exigir||exigir(c));
 if(!coinciden.length)return {encontrado:false,motivo:"sin coincidencia"};
 const precios=[...new Set(coinciden.map(c=>c.precio).filter(precioValido).map(p=>redondear(p,6)))];
 const descuentos=[...new Set(coinciden.map(c=>c.descuento??0))];
 if(!precios.length)return {encontrado:false,motivo:"coincidencia sin precio válido"};
 if(precios.length>1)return {encontrado:false,ambiguo:true,motivo:"varios precios distintos ("+precios.join(", ")+")"};
 if(descuentos.length>1)return {encontrado:false,ambiguo:true,motivo:"varios descuentos distintos"};
 return {encontrado:true,precio:precios[0],descuento:descuentos[0]??0,via,origen:coinciden[0].origen??null};
}

/*
 * Resuelve las líneas pendientes.
 *  lineas: [{referencia, item_id?, cantidad, descuento? (% impreso), precio_estado (de estadoInicial)}]
 *  fuentes: {
 *    pedido:   {id, definitivo:boolean, lineas:[{item_id?, referencia, precio, descuento?}]} | null,
 *    articulos:[{item_id?, referencia, precio, descuento?, valido:boolean}],   // STEL
 *    factura:  {id, lineas:[{item_id?, referencia, precio, descuento?}]} | null // solo factura recibida
 *  }
 *  opciones: {modo:"albaran"|"factura_recibida", ahora:ISO}
 */
function resolverPrecios(lineas,fuentes={},opciones={}){
 const ahora=opciones.ahora||new Date().toISOString();
 const orden=[
  {fuente:FUENTES.PEDIDO,disponible:!!fuentes.pedido&&fuentes.pedido.definitivo===true,
   candidatos:(fuentes.pedido?.lineas||[]).map(l=>({...l,origen:fuentes.pedido.id})),
   descartada:fuentes.pedido&&fuentes.pedido.definitivo!==true?"pedido sin precio definitivo":null},
  {fuente:FUENTES.ARTICULO,disponible:Array.isArray(fuentes.articulos),candidatos:fuentes.articulos||[],
   exigir:c=>c.valido===true},
  {fuente:FUENTES.FACTURA,disponible:opciones.modo==="factura_recibida"&&!!fuentes.factura,
   candidatos:(fuentes.factura?.lineas||[]).map(l=>({...l,origen:fuentes.factura.id}))}
 ];
 return lineas.map(linea=>{
  const base={...linea.precio_estado};
  if(base.estado_precio===ESTADOS.CONFIRMADO)return {...linea,precio_estado:base};
  const intentos=[];
  for(const f of orden){
   if(!f.disponible){if(f.descartada)intentos.push(f.fuente+": "+f.descartada);continue;}
   const r=buscar(linea,f.candidatos,{exigir:f.exigir});
   if(!r.encontrado){
    intentos.push(f.fuente+": "+r.motivo);
    if(r.ambiguo)break; // una fuente prioritaria contradictoria no se salta a la siguiente
    continue;
   }
   // Precio y descuento deben salir de la MISMA fuente. Si el albarán imprimió un
   // descuento distinto, hay conflicto: no se decide automáticamente.
   const dtoImpreso=linea.descuento??null;
   if(dtoImpreso!==null&&Math.abs(dtoImpreso-(r.descuento||0))>1e-9){
    intentos.push(f.fuente+": descuento impreso "+dtoImpreso+" % distinto del de la fuente "+(r.descuento||0)+" %");
    break;
   }
   return {...linea,precio_estado:{...base,estado_precio:ESTADOS.RESUELTO,precio_utilizado:r.precio,
    descuento_utilizado:r.descuento||0,fuente_precio:f.fuente,fuente_documento:r.origen,coincidencia:r.via,
    fecha_resolucion_precio:ahora,motivo:""}};
  }
  return {...linea,precio_estado:{...base,estado_precio:ESTADOS.PENDIENTE,
   motivo:"Sin fuente fiable de precio"+(intentos.length?": "+intentos.join("; "):"")}};
 });
}

/*
 * Decide si se puede crear la factura. Exige todas las líneas con precio y valida
 * los importes; si se procesa una factura recibida, la base calculada debe coincidir
 * con la base impresa de la factura.
 */
function validarParaFactura(lineas,{base_factura=null,tolerancia=0.02}={}){
 const problemas=[];let base=0;
 const detalle=lineas.map((l,i)=>{
  const p=l.precio_estado||{};
  if(p.estado_precio===ESTADOS.PENDIENTE||!precioValido(p.precio_utilizado)){
   problemas.push("Línea "+(i+1)+" ("+(l.referencia||"sin referencia")+"): precio pendiente"+(p.motivo?" · "+p.motivo:""));
   return {...l,importe_calculado:null};
  }
  if(typeof l.cantidad!=="number"||!Number.isFinite(l.cantidad)||l.cantidad===0){
   problemas.push("Línea "+(i+1)+": cantidad no válida");return {...l,importe_calculado:null};
  }
  const dto=p.descuento_utilizado??l.descuento??0;
  const importe=redondear(l.cantidad*p.precio_utilizado*(1-dto/100));
  if(typeof l.importe==="number"&&Math.abs(l.importe-importe)>0.011)
   problemas.push("Línea "+(i+1)+": importe impreso "+l.importe+" ≠ calculado "+importe);
  base+=importe;
  return {...l,importe_calculado:importe};
 });
 base=redondear(base);
 if(base_factura!==null&&!problemas.length&&Math.abs(base-base_factura)>tolerancia)
  problemas.push("Base calculada "+base+" ≠ base de la factura "+base_factura);
 return {puede_facturar:!problemas.length,estado:problemas.length?"REVISION":"LISTA_PARA_FACTURAR",
  base_calculada:problemas.length?null:base,problemas,lineas:detalle};
}

return {ESTADOS,FUENTES,estadoInicial,resolverPrecios,validarParaFactura};
});
