"use strict";
/*
 * DAFRICA · Fase 2 (aprobada por el usuario el 2026-10-26): de cada albarán leído, la ORDEN para crear
 * su albarán de compra en STEL. La web la guarda en la cola privada de Supabase (`stel_cola`) con el PDF;
 * el robot (robot-stel/procesar-cola.js) la ejecuta. Aquí no se escribe nada: solo se decide.
 *
 * Decisiones del usuario (2026-10-26):
 *  - Automático solo si el lector lo da por bueno (AUTO_OK) y todo lo necesario para STEL está
 *    resuelto con evidencia: proveedor (cuenta de STEL), número, fecha, obra con su proyecto de STEL y
 *    cada artículo. Lo demás queda en REVISAR con sus motivos (nunca se adivina).
 *  - Sin precio en el albarán: con pedido (PAP), el del pedido (lo pone el robot al leerlo); sin
 *    pedido, 0,00 con el aviso «PRECIO PENDIENTE». Nunca un precio estimado.
 *  - Artículo que no existe en STEL: se crea solo si el catálogo está completo y no hay ninguno
 *    parecido (articulos.js, comprobación anti-duplicados); si hay candidatos, REVISAR.
 *  - Si el lector encontró ya el albarán en STEL (ABP), no se crea otro: YA_EXISTE.
 *
 * Prueba real del 2026-10-28 (40 páginas): ningún documento puede desaparecer de la cola. Un albarán sin
 * proveedor de STEL, número o fecha también se guarda, en REVISAR, con una clave provisional
 * (`claveProvisional`, por la huella de su PDF individual) y el motivo; un abono o rectificativo nunca
 * queda PENDIENTE (el robot no los crea); y lo que no se pudo comprobar (catálogo o búsqueda de STEL sin
 * respuesta) queda anotado en `comprobaciones_pendientes` para repetir solo esa comprobación.
 */
(function(root,factory){
 const api=factory(root);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.colaStel=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
const M=n=>typeof module==="object"&&module.exports?require("./"+({articulos:"articulos.js"}[n])):root.DafricaAlbaranes[n];
const VERSION=1;
const aceptado=c=>c?.estado==="OK"&&(c.confianza??1)>=0.9;
const canon=t=>String(t??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const texto=c=>String(c?.valor??c?.literal??"").trim();

// «2026-10-22» → «22/10/2026» (formato del campo de fecha de STEL).
function fechaStel(iso){
 const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return m?m[3]+"/"+m[2]+"/"+m[1]:null;
}

// Distancia de edición (insertar, borrar o cambiar un carácter).
function distancia(a,b){
 let prev=Array.from({length:b.length+1},(_,j)=>j);
 for(let i=1;i<=a.length;i++){
  const fila=[i];
  for(let j=1;j<=b.length;j++)fila[j]=Math.min(fila[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
  prev=fila;
 }
 return prev[b.length];
}
const palabras=t=>String(t||"").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g,"").split(/[^A-Z0-9]+/).filter(w=>w.length>=2);

/*
 * Antes de un ALTA automática, más estricto que articulos.js: una referencia leída con un carácter de
 * más, de menos o cambiado (el OCR: «REF-0001» por «REF-001») o con las mismas cifras, o una descripción
 * cuyas palabras están todas en las de otro artículo, se parece demasiado a uno existente: REVISAR.
 */
function parecidosParaAlta(ref,desc,catalogo){
 const r=canon(ref),cifras=r.replace(/\D/g,""),pd=new Set(palabras(desc));
 return (catalogo||[]).filter(a=>{
  const ra=canon(a.referencia);
  if(r.length>=4&&ra.length>=4&&distancia(r,ra)<=1)return true;
  if(cifras.length>=5&&ra.replace(/\D/g,"")===cifras)return true;
  const pa=new Set(palabras(a.descripcion));
  const [menor,mayor]=pd.size<=pa.size?[pd,pa]:[pa,pd];
  return menor.size>=3&&[...menor].every(w=>mayor.has(w));
 }).map(a=>a.id).slice(0,10);
}

// Clave única del albarán en la cola: cuenta de STEL + número del proveedor + fecha.
function clave(r){
 const cuenta=r?.proveedor?.account_id,num=canon(texto(r?.numero)),f=texto(r?.fecha);
 return cuenta!=null&&num&&f?String(cuenta)+"|"+num+"|"+f:null;
}

/*
 * doc: {archivo, paginas, estado_documento, resultado} de la lectura.
 * catalogo: {articulos:[{id,referencia,descripcion}], articulos_completo, proveedores:[{id,nombre}],
 *            obras:[{id,codigo,nombre}]} (el de la lectura; sin precios).
 * opciones.busquedaStelCompleta: la búsqueda de albaranes de compra de STEL de esta lectura terminó
 *   completa (sin ella, la falta del ABP escrito a mano sigue impidiendo el automático).
 * Devuelve {clave, estado: PENDIENTE|REVISAR|YA_EXISTE, motivos:[…], plan}.
 */
// En la Fase 2 el ABP lo crea el robot: un albarán nuevo nunca lo trae escrito. Si es lo ÚNICO que
// falta (documento fiable, confianza ≥ 0,9) y la búsqueda del número del proveedor en STEL fue completa
// y no lo encontró, no impide el automático (el robot vuelve a buscar el número antes de crear).
const SOLO_FALTA_ABP=/^Código manuscrito no detectado: STEL \(ABP\); comprueba el papel$/;
function soloFaltaAbp(doc,opciones){
 const r=doc?.resultado;
 return doc?.estado_documento==="REVISAR"&&!!opciones?.busquedaStelCompleta&&r?.fiable===true&&(r.confianza??0)>=0.9&&
  (r.incidencias||[]).length>0&&(r.incidencias||[]).every(i=>SOLO_FALTA_ABP.test(String(i)));
}
// Clave de un documento que no se pudo identificar (sin cuenta de STEL, número o fecha): la huella de su
// PDF individual. Nunca coincide con la de un albarán identificado; el robot no toma nada en REVISAR.
const claveProvisional=sha=>/^[0-9a-f]{64}$/.test(String(sha||""))?"SIN_IDENTIFICAR|"+sha:null;

// Lo que no se pudo comprobar en esta lectura (para repetir solo esa comprobación más tarde).
function comprobacionesPendientes(opciones){
 const p=[];
 if(opciones?.catalogoIncompleto)p.push("catalogo_stel");
 if(opciones?.busquedaStelIncompleta)p.push("albaranes_stel");
 if(opciones?.visionFallida)p.push("vision_manuscritos");
 return p;
}

// Plan mínimo de un documento sin lectura (error de la página): se guarda igual, en REVISAR.
function planSinLectura(doc){
 return {version:VERSION,archivo:doc?.archivo||null,paginas:Array.isArray(doc?.paginas)?doc.paginas.slice():[],tipo:null,
  proveedor:{account_id:null,nombre_stel:null,nombre_leido:null},numero:null,fecha:null,obra:null,pedido:null,ya_en_stel:null,lineas:[],total:null,
  aviso_precio:null,error_lectura:String(doc?.error||"Documento sin lectura").slice(0,300)};
}

function orden(doc,catalogo,opciones={}){
 const r=doc?.resultado,motivos=[];
 if(!r)return {clave:null,estado:"REVISAR",motivos:["Documento sin lectura"+(doc?.error?": "+String(doc.error).slice(0,160):"")],plan:planSinLectura(doc)};
 const cat=catalogo||{};
 if(doc.estado_documento!=="AUTO_OK"&&!soloFaltaAbp(doc,opciones))motivos.push("El lector no lo da por bueno ("+(doc.estado_documento||"sin estado")+")");
 // Abono o rectificativo (impreso o con cantidades negativas): nunca automático.
 const tipo=r.tipo_documento?.valor==="ABONO"?"ABONO":"ALBARAN";
 if(tipo==="ABONO")motivos.push("Abono o rectificativo: no se crea automáticamente en STEL ("+(r.tipo_documento?.evidencia||"cantidades negativas")+")");
 // Proveedor: la cuenta de STEL verificada por el lector.
 const p=r.proveedor||{},cuenta=p.account_id??null;
 const provStel=cuenta!=null?(cat.proveedores||[]).find(x=>String(x.id)===String(cuenta)):null;
 if(cuenta==null||p.estado!=="OK")motivos.push("Proveedor sin cuenta de STEL verificada");
 else if(!provStel)motivos.push("La cuenta del proveedor no está en el catálogo de STEL leído");
 // Número y fecha.
 const numero=texto(r.numero),fecha=fechaStel(texto(r.fecha));
 if(!aceptado(r.numero)||!numero)motivos.push("Número del albarán sin confirmar");
 if(!aceptado(r.fecha)||!fecha)motivos.push("Fecha sin confirmar");
 // Obra: el código validado y su proyecto en STEL (código único en el catálogo de obras).
 const ob=r.manuscritos?.obra,codObra=ob?.estado==="OK"?canon(ob.valor):"";
 let obra=null;
 if(!codObra)motivos.push("Obra (PRY) sin validar");
 else if(!cat.obras_completo){
  // Sin la lista de proyectos de STEL en esta lectura: el robot elige en STEL el proyecto cuyo nombre
  // termina en «(código)», solo si es uno (o se para).
  obra={codigo:codObra,stel_id:null,nombre:null};
 }else{
  const cands=(cat.obras||[]).filter(o=>canon(o.codigo)===codObra);
  if(cands.length!==1)motivos.push(cands.length?"Obra "+codObra+" repetida en STEL":"Obra "+codObra+" no encontrada en los proyectos de STEL");
  else obra={codigo:codObra,stel_id:cands[0].id,nombre:String(cands[0].nombre||"").slice(0,150)};
 }
 // Pedido a proveedor: solo validado (uno leído y sin validar ya impide AUTO_OK).
 const pe=r.manuscritos?.pedido,pedido=pe?.estado==="OK"&&/^PAP\d{5}$/.test(canon(pe.valor))?{codigo:canon(pe.valor)}:null;
 if(pe&&pe.estado!=="OK"&&texto(pe))motivos.push("Pedido (PAP) leído y sin validar");
 // Ya existe en STEL: no se crea otro.
 const abp=r.albaran_stel?.estado==="OK"?r.albaran_stel:(r.manuscritos?.stel?.estado==="OK"?{referencia:r.manuscritos.stel.valor}:null);
 // Líneas: artículo de STEL (existente, o alta tras la comprobación anti-duplicados).
 const artCat=(cat.articulos||[]).map(a=>({id:a.id,reference:a.referencia,name:a.descripcion}));
 const lineas=(r.lineas||[]).map((l,i)=>{
  const ref=texto(l.referencia),desc=texto(l.descripcion),cant=l.cantidad?.valor;
  if(!Number.isFinite(cant)||cant<=0)motivos.push("Línea "+(i+1)+": cantidad sin confirmar");
  const precio=Number.isFinite(l.precio?.valor)?l.precio.valor:null;
  const resId=l.referencia?.resolucion?.item_id??l.descripcion?.resolucion?.item_id??null;
  let articulo;
  if(resId!=null)articulo={estado:"existente",item_id:resId,via:"lector"};
  else{
   const a=M("articulos").resolverArticulo({referencia:ref,descripcion:desc,unidad:texto(l.unidad)},{account_id:cuenta},
    {catalogo:artCat,catalogo_completo:!!cat.articulos_completo,mapeos:[]});
   const parecidos=a.estado==="crear"?parecidosParaAlta(ref,desc,cat.articulos):[];
   articulo=a.estado==="crear"&&!parecidos.length?{estado:"crear",item_id:null,via:a.via,propuesta:{referencia:a.propuesta_alta.reference,descripcion:a.propuesta_alta.name}}:
    a.estado==="crear"?{estado:"revisar",item_id:null,via:"anti_duplicados_alta",candidatos:parecidos,motivo:"se parece a "+parecidos.length+" artículo(s) de STEL"}:
    a.item_id!=null&&a.estado!=="revision_articulo"?{estado:"existente",item_id:a.item_id,via:a.via}:
    // Catálogo leído a medias: el robot busca la referencia exacta en STEL (una fila) o, si no existe,
    // artículos parecidos en STEL antes de crearlo (si hay alguno, se para).
    a.via==="catalogo_incompleto"&&ref&&desc?{estado:"buscar",item_id:null,via:"robot_stel",propuesta:{referencia:ref,descripcion:desc}}:
    {estado:"revisar",item_id:null,via:a.via,motivo:a.motivo};
  }
  if(articulo.estado==="revisar")motivos.push("Línea "+(i+1)+": artículo dudoso en STEL ("+(articulo.motivo||articulo.via)+")");
  return {fila:i+1,pagina:l.pagina??null,referencia:ref,descripcion:desc,cantidad:Number.isFinite(cant)?cant:null,unidad:texto(l.unidad)||null,
   precio,precio_pendiente:precio==null,descuentos:Array.isArray(l.descuento?.porcentajes)?l.descuento.porcentajes.filter(Number.isFinite):[],
   importe:Number.isFinite(l.importe?.valor)?l.importe.valor:null,articulo};
 });
 if(!lineas.length)motivos.push("Sin líneas de artículo");
 const plan={version:VERSION,archivo:doc.archivo||null,paginas:Array.isArray(doc.paginas)?doc.paginas.slice():[],
  proveedor:{account_id:cuenta,nombre_stel:provStel?String(provStel.nombre||""):null,nombre_leido:p.nombre||null},
  tipo,numero,fecha,obra,pedido,ya_en_stel:abp?{referencia:String(abp.referencia||abp.fullReference||""),id:abp.id??null}:null,
  // Solo un total aceptado por el lector (nunca uno en revisión: prueba real 2026-10-28).
  lineas,total:Number.isFinite(r.totales?.total?.valor)&&["OK","VERIFICADO"].includes(r.totales.total.estado)?r.totales.total.valor:null,
  aviso_precio:!pedido&&lineas.some(l=>l.precio_pendiente)?"PRECIO PENDIENTE":null,
  comprobaciones_pendientes:comprobacionesPendientes(opciones)};
  // Solo informativo: las reglas de arriba ya dejan en REVISAR lo que dependa de esas comprobaciones
  // (y el robot vuelve a buscar en STEL antes de crear).
 const estado=abp?"YA_EXISTE":motivos.length?"REVISAR":"PENDIENTE";
 return {clave:clave(r),estado,motivos,plan};
}

return {VERSION,orden,clave,claveProvisional,planSinLectura,fechaStel,soloFaltaAbp,parecidosParaAlta,palabras};
});
