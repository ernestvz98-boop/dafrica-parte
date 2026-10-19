"use strict";
/*
 * DAFRICA · Lector determinista de albaranes en PDF digital (P0).
 *
 * Entrada: el PDF original. Salida: cabecera, líneas y validaciones, con el
 * texto LITERAL de cada campo, su valor normalizado y su estado:
 *   VERIFICADO  valor leído y confirmado por un cuadre aritmético
 *   OK          valor leído sin ambigüedad (sin cuadre disponible)
 *   REVISAR     valor leído pero una comprobación no cuadra
 *   AMBIGUO     el texto admite varias interpretaciones: valor=null
 *   INVALIDO    el texto no es un valor válido: valor=null
 *   VACIO       la celda está en blanco: valor=null
 * El documento queda AUTO_OK solo si todos los campos obligatorios están en
 * VERIFICADO/OK y todas las validaciones se cumplen; si no, REVISAR.
 * Los PDF escaneados devuelven NO_DIGITAL sin inventar ningún dato.
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.extraer=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const VERSION="determinista-p0-1";
const mod=(clave,archivo)=>req?req(archivo):root.DafricaAlbaranes[clave];
const N=()=>mod("normalizar","./normalizar.js");
const NIF=()=>mod("nif","./nif.js");
const TEXTO=()=>mod("textoPdf","./texto-pdf.js");
const PROV=()=>mod("proveedores","./proveedores.js");

// «P.V.P.» → «PVP», «Cant.» → «CANT», «P. Unit» → «P UNIT».
const clave=t=>N().sinAcentos(t).replace(/\.(?=[A-Z0-9])/g,"").replace(/[.:€()\/_]/g," ").replace(/\s+/g," ").trim();
const caja=c=>c?[Math.round(c.x0*10)/10,Math.round(c.y*10)/10,Math.round(c.x1*10)/10,Math.round(c.alto*10)/10]:null;

/* ---------------------------- Cabecera de tabla ---------------------------- */
const COLUMNAS=[
 ["referencia",/^(REF|REFERENCIA|REF ARTICULO|COD|CODIGO|COD ART|CODIGO ARTICULO|COD ARTICULO|ART|ARTICULO)$/],
 ["descripcion",/^(DESCRIPCION|CONCEPTO|DENOMINACION|DESIGNACION|DETALLE|PRODUCTO|DESCRIPCION ARTICULO)$/],
 ["cantidad",/^(CANTIDAD|CANT|UDS|UNIDADES|UNDS|CTDAD|CANT SERVIDA|CANTIDAD SERVIDA)$/],
 ["unidad",/^(UD|U M|UM|UNIDAD|MEDIDA)$/],
 ["precio",/^(PRECIO|PRECIO UNIDAD|PRECIO UNITARIO|PRECIO UNIT|P UNIT|P UNITARIO|PVP|PRECIO UD|PRECIO NETO|TARIFA|PRECIO 100|PRECIO X 100|PRECIO 1000|PRECIO X 1000)$/],
 ["subtotal",/^(SUBTOTAL|BRUTO|IMPORTE BRUTO)$/],
 ["descuento",/^(DTO|DTOS|DESC|DESCUENTO|DTO %|% DTO|%DTO|DTO%|% DESC|DESC %|DTO ?[123]|DESC ?[123]|% ?DTO ?[123]|DTO ?[123] ?%)$/],
 ["importe",/^(IMPORTE|IMPORTE NETO|TOTAL|NETO|TOTAL LINEA|IMPORTE TOTAL|IMPORTE EUR)$/]
];
function campoDe(texto){
 const k=clave(texto);
 for(const [campo,re] of COLUMNAS)if(re.test(k))return {campo,clave:k};
 return null;
}
/*
 * Palabras de una celda con su posición estimada. Con el texto original
 * (espacios incluidos) la estimación es exacta en fuentes monoespaciadas;
 * en las proporcionales es aproximada y se trata como tal.
 */
function palabrasConPosicion(celda){
 const base=celda.crudo&&celda.crudo.trim()?celda.crudo:celda.texto,total=base.length||1,ancho=celda.x1-celda.x0;
 return [...base.matchAll(/\S+/g)].map(m=>({texto:m[0],x0:celda.x0+ancho*m.index/total,x1:celda.x0+ancho*(m.index+m[0].length)/total,alto:celda.alto}));
}
/* Una celda de cabecera puede contener varios títulos («CANTIDAD PRECIO DTO»).
   Los títulos desconocidos (Lote, % IVA…) se conservan como columnas «otra». */
function camposDeCelda(celda){
 const directo=campoDe(celda.texto);
 if(directo)return [{...directo,x0:celda.x0,x1:celda.x1}];
 const palabras=palabrasConPosicion(celda),salida=[];
 let i=0;
 while(i<palabras.length){
  let hallado=null;
  for(let j=palabras.length;j>i;j--){
   const r=campoDe(palabras.slice(i,j).map(p=>p.texto).join(" "));
   if(r){hallado={...r,fin:j};break;}
  }
  if(hallado){
   salida.push({campo:hallado.campo,clave:hallado.clave,x0:palabras[i].x0,x1:palabras[hallado.fin-1].x1});
   i=hallado.fin;
  }else{
   const previa=salida[salida.length-1];
   if(previa&&previa.campo==="otra"){previa.x1=palabras[i].x1;previa.clave+=" "+clave(palabras[i].texto);}
   else salida.push({campo:"otra",clave:clave(palabras[i].texto),x0:palabras[i].x0,x1:palabras[i].x1});
   i++;
  }
 }
 return salida;
}
function evaluarCabecera(celdas){
 // Una celda que mezcla títulos con palabras ajenas («ARTÍCULO SIN CANTIDAD»)
 // es texto, no cabecera; salvo que sea toda la línea (cabecera en un solo texto).
 const todas=celdas.flatMap(c=>{
  const r=camposDeCelda(c);
  const mezcla=r.some(x=>x.campo==="otra")&&r.some(x=>x.campo!=="otra");
  return mezcla&&celdas.length>1?[{campo:"otra",clave:clave(c.texto),x0:c.x0,x1:c.x1}]:r;
 });
 const ajenas=todas.filter(c=>c.campo==="otra").length;
 const columnas=todas;
 const campos=new Set(columnas.map(c=>c.campo));
 if(campos.has("referencia")&&!campos.has("descripcion")){
  // «ARTÍCULO» sin columna de descripción es la descripción.
  const art=columnas.find(c=>c.campo==="referencia"&&/^ART/.test(c.clave));
  if(art&&columnas.filter(c=>c.campo==="referencia").length>1){art.campo="descripcion";}
  else if(art&&!columnas.some(c=>c.campo==="referencia"&&c!==art)){art.campo="descripcion";}
 }
 const finales=new Set(columnas.map(c=>c.campo).filter(c=>c!=="otra"));
 const valida=finales.has("cantidad")&&(finales.has("descripcion")||finales.has("referencia"))&&finales.size>=3&&ajenas<=3;
 return {valida,columnas:columnas.sort((a,b)=>a.x0-b.x0),ajenas};
}
function buscarCabeceraTabla(lineas,desde=0){
 for(let i=desde;i<lineas.length;i++){
  let r=evaluarCabecera(lineas[i].celdas);
  if(r.valida){
   // Un título que el OCR deja medio renglón arriba o abajo («CÓDIGO») se incorpora.
   for(const j of [i-1,i+1]){
    const v=lineas[j];
    if(!v||Math.abs(v.y-lineas[i].y)>1.2*lineas[i].alto)continue;
    if(!v.celdas.every(c=>camposDeCelda(c).every(x=>x.campo!=="otra")))continue;
    const r2=evaluarCabecera([...lineas[i].celdas,...v.celdas]);
    if(r2.valida&&r2.columnas.length>r.columnas.length)return {indice:Math.max(i,j),hasta:Math.max(i,j),...r2};
   }
   return {indice:i,hasta:i,...r};
  }
  // Títulos en dos renglones («PRECIO» / «UNIDAD»).
  const sig=lineas[i+1];
  if(sig&&sig.y-lineas[i].y<2.2*lineas[i].alto){
   r=evaluarCabecera(fusionarTitulos(lineas[i].celdas,sig.celdas));
   if(r.valida)return {indice:i,hasta:i+1,...r};
  }
 }
 return null;
}
function fusionarTitulos(arriba,abajo){
 const salida=arriba.map(c=>({...c}));
 for(const c of abajo){
  const encima=salida.find(a=>Math.min(a.x1,c.x1)-Math.max(a.x0,c.x0)>0.3*Math.min(a.x1-a.x0,c.x1-c.x0));
  if(encima){encima.texto+=" "+c.texto;encima.x0=Math.min(encima.x0,c.x0);encima.x1=Math.max(encima.x1,c.x1);}
  else salida.push({...c});
 }
 return salida;
}
function intervalos(columnas){
 const orden=[...columnas].sort((a,b)=>(a.x0+a.x1)-(b.x0+b.x1));
 const usados=new Map();
 return orden.map((c,i)=>{
  const ini=i===0?-Infinity:(orden[i-1].x1+c.x0)/2;
  const fin=i===orden.length-1?Infinity:(c.x1+orden[i+1].x0)/2;
  // Columnas repetidas: una segunda de descuento se suma en cascada; las demás se ignoran.
  const veces=usados.get(c.campo)||0;usados.set(c.campo,veces+1);
  const campo=!veces||c.campo==="otra"?c.campo:c.campo==="descuento"&&veces===1?"descuento2":"otra";
  return {campo,clave:c.clave,ini,fin};
 });
}
// «(4,00)» es un número negativo; «100)» suelto es texto (p. ej. «(BOLSA 100)»).
const RE_CANTIDAD_UNIDAD=/^([-−]?[\d.,]+)\s*([A-Za-zÁÉÍÓÚáéíóú]{1,4}[23]?\.?)$/;
const pareceNumero=t=>/^(\(\s*[\d.,]+\s*\)|[-−+]?\s*[\d.,]+\s*(\+\s*[\d.,]+\s*)*[−-]?\s*%?)$/.test(String(t).trim());
function columnaDe(celda,cols){
 const x=pareceNumero(celda.texto)?(celda.x0+celda.x1)/2:celda.x0+0.01;
 return cols.find(c=>x>=c.ini&&x<c.fin)||null;
}

/* --------------------------- Etiquetas de cabecera -------------------------- */
const RE_NUMERO=/^(N[ºO°]?\s?(DE\s)?ALBARAN|NUM(ERO)?\s(DE\s)?ALBARAN|ALBARAN(\s(DE\s)?(ENTREGA|VENTA|SALIDA))?(\sN[ºO°]?)?|N[ºO°]\s?DOC(UMENTO)?|NUM(ERO)?\sDOC(UMENTO)?|DOCUMENTO)(\b|$)/;
const EXCLUIR_NUMERO=/CLIENTE|PEDIDO|PROVEEDOR|TELEF|FAX|PAGINA|OBRA|CIF|NIF|FACTURA|PRESUPUESTO|CUENTA|IBAN/;
const RE_FECHA=/^(FECHA(\s(ALBARAN|DOCUMENTO|EMISION|DE\sEMISION|EXPEDICION|DEL\sALBARAN))?|F\sEMISION)(\b|$)/;
const EXCLUIR_FECHA=/ENTREGA|VENCIMIENTO|PEDIDO|NACIMIENTO|CADUCIDAD|PREVISTA|SERVICIO|PAGO/;
// Quita separadores y restos de etiqueta («º 77812», «Nº: 123», «nº. 45»).
const limpiarValor=v=>String(v||"").replace(/^[\s:#\-–.º°]+/,"").replace(/^N[ºo°O]?\.?(?=[\s:.]|$)/i,"").replace(/^[\s:#\-–.º°]+/,"").trim();

function valoresEtiquetados(lineas,reEtiqueta,reExcluir,aceptar){
 const hallados=[];
 lineas.forEach((linea,li)=>linea.celdas.forEach((celda,ci)=>{
  const k=N().sinAcentos(celda.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
  const m=k.match(reEtiqueta);
  if(!m||reExcluir.test(k))return;
  const candidatos=[];
  const resto=limpiarValor(celda.texto.slice(Math.min(celda.texto.length,m[0].length)));
  if(resto)candidatos.push({texto:resto,celda});
  // A la derecha, saltando restos de la etiqueta («N.», «Nº», «:»).
  const derecha=linea.celdas.slice(ci+1).filter(c=>c.x0>=celda.x1-1).find(c=>limpiarValor(c.texto));
  if(derecha)candidatos.push({texto:limpiarValor(derecha.texto),celda:derecha});
  for(const abajo of lineas.slice(li+1,li+3)){
   if(abajo.y-linea.y>2.6*linea.alto)break;
   // El valor de la casilla: la celda inferior más próxima en horizontal (puede estar
   // centrada, alineada a la izquierda o a la derecha de su etiqueta).
   const centro=(celda.x0+celda.x1)/2,anchoEt=celda.x1-celda.x0;
   const c=[...abajo.celdas].map(c=>({c,d:Math.min(c.x1,celda.x1)-Math.max(c.x0,celda.x0)>0?0:Math.abs((c.x0+c.x1)/2-centro)}))
    .filter(x=>x.d<=Math.max(1.5*anchoEt,3*celda.alto)).sort((a,b)=>a.d-b.d)[0]?.c;
   if(c){candidatos.push({texto:limpiarValor(c.texto),celda:c});break;}
  }
  const valido=candidatos.find(c=>aceptar(c.texto));
  if(valido)hallados.push({...valido,etiqueta:celda.texto});
 }));
 return hallados;
}

// Etiqueta genérica («Nº:», «Número:») solo si no hay ninguna que diga «albarán».
const RE_NUMERO_GENERICO=/^(N[ºO°]|NUM|NUMERO)(\b|$)/;
const EXCLUIR_GENERICO=/CLIENTE|PEDIDO|PROVEEDOR|TELEF|TLF|FAX|PAGINA|PAG|OBRA|CIF|NIF|FACTURA|PRESUPUESTO|CUENTA|IBAN|SERIE|LOTE|BULTOS|MATRICULA|REGISTRO|TOMO|FOLIO|HOJA|INSCRIPCION/;
function leerNumero(lineas){
 const r={literal:"",valor:null,estado:"VACIO",motivos:[],notas:[],caja:null};
 const aceptar=t=>/^[A-Z0-9][A-Z0-9\/\-.]{2,24}$/i.test(t)&&/\d/.test(t)&&N().fecha(t).estado!=="OK";
 let hallados=valoresEtiquetados(lineas,RE_NUMERO,EXCLUIR_NUMERO,aceptar);
 if(!hallados.length){
  hallados=valoresEtiquetados(lineas,RE_NUMERO_GENERICO,EXCLUIR_GENERICO,aceptar);
  if(hallados.length)r.notas.push("Número tomado de una etiqueta genérica («Nº»/«Número»)");
 }
 const distintos=[...new Map(hallados.map(h=>[N().canon(h.texto),h])).values()];
 if(!distintos.length){r.motivos.push("No se encontró el número de albarán junto a su etiqueta");return r;}
 if(distintos.length>1){
  r.estado="AMBIGUO";r.literal=distintos.map(h=>h.texto).join(" | ");
  r.motivos.push("Varios números etiquetados: "+r.literal);return r;
 }
 r.literal=distintos[0].texto;r.valor=distintos[0].texto;r.estado="OK";r.caja=caja(distintos[0].celda);r.conf_ocr=distintos[0].celda?.conf??null;
 return r;
}

function leerFecha(lineas,opciones){
 const F=N().fecha;
 const r={literal:"",valor:null,estado:"VACIO",motivos:[],notas:[],caja:null};
 // Se aceptan también fechas con forma de fecha pero inexistentes (31/02): quedan INVALIDO.
 let hallados=valoresEtiquetados(lineas,RE_FECHA,EXCLUIR_FECHA,
  t=>/\d/.test(t)&&(F(t,opciones).estado==="OK"||/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(t)));
 let etiquetada=true;
 if(!hallados.length){
  etiquetada=false;
  hallados=[];
  for(const l of lineas)for(const c of l.celdas){
   const f=F(c.texto,opciones);
   if(f.estado==="OK")hallados.push({texto:c.texto,celda:c});
  }
 }
 const distintos=[...new Map(hallados.map(h=>[F(h.texto,opciones).valor||h.texto,h])).values()];
 if(!distintos.length){r.motivos.push("No se encontró la fecha del albarán");return r;}
 if(distintos.length>1){
  r.estado="AMBIGUO";r.literal=distintos.map(h=>h.texto).join(" | ");
  r.motivos.push((etiquetada?"Varias fechas etiquetadas: ":"Varias fechas sin etiqueta: ")+r.literal);return r;
 }
 const f=F(distintos[0].texto,opciones);
 Object.assign(r,{literal:f.literal,valor:f.valor,estado:f.estado,motivos:[...f.motivos],notas:[...f.notas],caja:caja(distintos[0].celda),conf_ocr:distintos[0].celda?.conf??null});
 // Una fecha sin etiqueta puede ser la de pedido o entrega: se propone, no se acepta.
 if(!etiquetada&&f.estado==="OK"){r.estado="REVISAR";r.motivos.push("Fecha sin etiqueta «Fecha»: es la única fecha del encabezado, pero no se acepta automáticamente");}
 if(f.estado==="OK"){
  const hoy=opciones.hoy?new Date(opciones.hoy+"T00:00:00Z"):new Date();
  const dias=(Date.parse(f.valor+"T00:00:00Z")-hoy.getTime())/864e5;
  if(dias>7||dias<-730){
   r.estado="REVISAR";
   r.motivos.push("Fecha fuera del rango esperado ("+(dias>0?"futura":"más de dos años")+")");
  }
 }
 return r;
}

/* -------------------------------- Proveedor -------------------------------- */
// Título del recuadro del cliente (sin cifras: «Nº cliente 4300» no es un recuadro).
const RE_CLIENTE=/^(DATOS DEL |DATOS )?(CLIENTE|DESTINATARIO|FACTURAR A|ENVIAR A|DIRECCION DE ENTREGA|LUGAR DE ENTREGA|CONSIGNATARIO|ENTREGAR EN)\b[^0-9]*$/;
// limiteCabecera: y de la cabecera de la tabla en la 1.ª página (el emisor está por encima).
function identificarProveedor(paginas,registro,limiteCabecera=null){
 const propios=new Set((registro.empresa_propia?.nifs||[]).map(n=>NIF().normalizar(n)));
 const nombresPropios=(registro.empresa_propia?.nombres||[]).map(n=>N().canon(n)).filter(Boolean);
 const encontrados=[];
 for(const pagina of paginas){
  const anchoZona=0.3*pagina.ancho;
  pagina.lineas.forEach((linea,li)=>{
   const vistos=new Set();
   const registrar=(n,celda)=>{
    if(vistos.has(n.nif))return;vistos.add(n.nif);
    const cerca=pagina.lineas.slice(Math.max(0,li-8),li+5).flatMap(l=>l.celdas.map(c=>({c,l})))
     .filter(({c})=>Math.abs(c.x0-celda.x0)<anchoZona||Math.min(c.x1,celda.x1)>Math.max(c.x0,celda.x0));
    const nombrePropio=cerca.some(({c,l})=>Math.abs(l.indice-li)<=4&&nombresPropios.some(p=>N().canon(c.texto).includes(p)));
    const etiquetaCliente=cerca.some(({c,l})=>l.indice<=li&&RE_CLIENTE.test(N().sinAcentos(c.texto)));
    // Con el NIF de DAFRICA configurado basta la comparación exacta; las pistas
    // por nombre o recuadro de cliente solo se usan mientras no esté configurado.
    const propio=propios.size?propios.has(n.nif):(nombrePropio||etiquetaCliente);
    const enCabecera=pagina.numero===paginas[0].numero&&linea.y<(limiteCabecera??0.3*pagina.alto);
    encontrados.push({nif:n.nif,literal:n.literal,pagina:pagina.numero,caja:caja(celda),conf:celda.conf??null,propio,enCabecera,
     motivo_propio:propios.has(n.nif)?"NIF de la empresa propia":nombrePropio?"Junto al nombre de DAFRICA":etiquetaCliente?"En el bloque del cliente/destinatario":""});
   };
   for(const celda of linea.celdas)for(const n of NIF().buscar(celda.texto))registrar(n,celda);
   for(const n of NIF().buscar(linea.texto))registrar(n,linea.celdas[0]);
  });
 }
 const r={nif:null,id:null,nombre:null,estado:"VACIO",motivos:[],notas:[],candidatos:[],nif_propio_detectado:null,caja:null};
 const propio=encontrados.find(e=>e.propio);
 if(propio)r.nif_propio_detectado=propio.nif;
 const ajenos=[...new Map(encontrados.filter(e=>!e.propio).map(e=>[e.nif,e])).values()];
 r.candidatos=ajenos.map(e=>e.nif);
 // Nombres de proveedores registrados impresos en la primera página.
 const textoPagina=N().canon(paginas[0]?.lineas.map(l=>l.texto).join(" ")||"");
 const porNombre=(registro.proveedores||[]).filter(pr=>{
  const n=N().canon(pr.nombre).replace(/(SLU|SL|SA)$/,"");
  return n.length>=8&&textoPagina.includes(n);
 });
 if(!ajenos.length){
  if(porNombre.length===1&&(porNombre[0].nifs||[]).length===1){
   // El CIF impreso no se ha podido leer (OCR): se identifica por el nombre registrado.
   const pr=porNombre[0];
   Object.assign(r,{nif:pr.nifs[0],id:pr.id,nombre:pr.nombre,estado:"OK",via:"nombre_registrado",
    notas:["CIF impreso no legible: proveedor identificado por su nombre registrado; el CIF procede del registro"]});
   return r;
  }
  r.motivos.push(propio?"Solo aparece el NIF del destinatario (DAFRICA): el emisor no se puede identificar":"No aparece ningún NIF/CIF válido del emisor");
  return r;
 }
 let elegido=ajenos.length===1?ajenos[0]:null;
 if(!elegido){
  // El emisor figura sobre la tabla de la primera página. Que un NIF esté
  // registrado NO decide (un transportista también puede ser proveedor).
  const arriba=ajenos.filter(e=>e.enCabecera);
  if(arriba.length===1){elegido=arriba[0];r.notas.push("Otros NIF fuera del encabezado: "+ajenos.filter(e=>e!==elegido).map(e=>e.nif).join(", "));}
  else{r.estado="AMBIGUO";r.motivos.push("Varios NIF posibles del emisor: "+r.candidatos.join(", "));return r;}
 }
 r.nif=elegido.nif;r.caja=elegido.caja;r.conf_ocr=elegido.conf??null;
 const ficha=PROV().buscarPorNif(elegido.nif,registro);
 // Un CIF válido que contradice el nombre registrado impreso: no se decide.
 if(porNombre.length===1&&(!ficha||ficha.id!==porNombre[0].id)){
  r.estado="AMBIGUO";r.nif=null;r.motivos.push("El CIF leído ("+elegido.nif+") no corresponde al proveedor cuyo nombre aparece impreso ("+porNombre[0].nombre+")");
  return r;
 }
 if(ficha){r.id=ficha.id;r.nombre=ficha.nombre;r.estado="OK";r.via="nif";}
 else{r.estado="NIF_NO_REGISTRADO";r.motivos.push("NIF "+elegido.nif+" leído correctamente pero no registrado como proveedor");}
 return r;
}

/* ---------------------------------- Tabla ---------------------------------- */
const RE_PIE=/^(TOTAL(ES)?|SUMA|BASE IMPONIBLE|BASE|IMPORTE TOTAL|TOTAL ALBARAN|TOTAL LINEAS|N[ºO°]? LINEAS|OBSERVACIONES|FORMA DE PAGO|RECIBI|CONFORME|FIRMA|SUBTOTAL|I V A|IVA|SUMA Y SIGUE)\b/;
const RE_ANOTACION=/^(RETIRADO POR|RECOGIDO POR|PEDIDO POR|ENTREGA EN|ENTREGAR EN|CONTACTO|OBRA|S ?REF|SU REF|REF CLIENTE|ATENCION|OBSERVACIONES)\b/;
const RE_PIE_CUALQUIERA=/^(BASE IMPONIBLE|TOTAL LINEAS|SUMA Y SIGUE|TOTAL ALBARAN|N[ºO°]? LINEAS)\b/;

function leerTablaPagina(pagina){
 const cab=buscarCabeceraTabla(pagina.lineas);
 if(!cab)return null;
 const cols=intervalos(cab.columnas);
 const filas=[],ignoradas=[],pie=[],dudosasTrasFin=[];
 const NUMERICAS=new Set(["cantidad","precio","descuento","descuento2","subtotal","importe"]);
 // Una celda que cruza columnas (ERP que escribe la fila como un solo texto)
 // se reparte por la posición estimada de cada palabra. Un texto no numérico
 // nunca se coloca en una columna numérica.
 const partir=c=>{
  if(!/\s/.test(c.texto))return [c];
  const grupos=[];
  for(const p of palabrasConPosicion(c)){
   let campo=columnaDe(p,cols)?.campo||"otra";
   const ultimo=grupos[grupos.length-1];
   if(NUMERICAS.has(campo)&&!pareceNumero(p.texto)&&ultimo)campo=ultimo.campo;
   if(ultimo&&ultimo.campo===campo){ultimo.texto+=" "+p.texto;ultimo.x1=p.x1;}
   else grupos.push({campo,texto:p.texto,x0:p.x0,x1:p.x1,alto:c.alto,y:c.y});
  }
  if(grupos.length<2)return [c];
  return grupos.map(g=>({texto:g.texto,x0:g.x0,x1:g.x1,alto:g.alto,y:g.y,partida:true,campoPartida:g.campo}));
 };
 const asignar=linea=>{
  const celdas={},conflictos=[];let partida=false;
  let ultimoTexto=null;
  for(const c of linea.celdas.filter(c=>c.x1>=xMinTabla).flatMap(partir)){
   if(c.partida)partida=true;
   let campo=c.campoPartida||columnaDe(c,cols)?.campo||"otra";
   // Un texto no numérico no pertenece a una columna numérica: es la
   // continuación de la columna de texto anterior («… (BOLSA 100)»).
   if(NUMERICAS.has(campo)&&!pareceNumero(c.texto)&&!RE_CANTIDAD_UNIDAD.test(c.texto.trim())&&ultimoTexto)campo=ultimoTexto;
   if(!NUMERICAS.has(campo))ultimoTexto=campo;
   if(celdas[campo]){
    if(["referencia","descripcion","unidad","otra"].includes(campo)){celdas[campo].texto+=" "+c.texto;celdas[campo].x1=c.x1;}
    // Varias cifras en la columna de descuento («60» «5») = descuentos en cascada.
    else if(/^descuento2?$/.test(campo)&&pareceNumero(c.texto)&&pareceNumero(celdas[campo].texto)){
     celdas[campo].texto+=" "+c.texto;celdas[campo].x1=c.x1;
     if(c.conf!=null)celdas[campo].conf=Math.min(celdas[campo].conf??c.conf,c.conf);
    }
    else conflictos.push(campo);
   }else celdas[campo]={...c};
  }
  return {celdas,conflictos,partida};
 };
 const altoFila=pagina.lineas[cab.indice].alto;
 // Lo que queda claramente a la izquierda de la primera columna no pertenece a la tabla.
 const xMinTabla=Math.min(...cab.columnas.map(c=>c.x0))-3*altoFila;
 let actual=null,fin=false,yAnterior=pagina.lineas[cab.hasta].y;
 for(const linea of pagina.lineas.slice(cab.hasta+1)){
  if(fin){
   // Red de seguridad: algo con forma de artículo después del final de la tabla.
   const {celdas}=asignar(linea);
   if(celdas.cantidad&&pareceNumero(celdas.cantidad.texto)&&(celdas.referencia||celdas.precio||celdas.importe)&&
     !RE_PIE.test(clave(linea.celdas[0]?.texto||"")))dudosasTrasFin.push(linea.texto);
   pie.push(linea);continue;
  }
  const primera=clave(linea.celdas[0]?.texto||"");
  // Fin de tabla: rótulo de pie o un hueco vertical grande tras la última fila.
  const separacion=filas.length?linea.y-yAnterior:0;
  if(RE_PIE.test(primera)||linea.celdas.some(c=>RE_PIE_CUALQUIERA.test(clave(c.texto)))||separacion>3.2*altoFila+16){
   fin=true;pie.push(linea);
   if(!RE_PIE.test(primera)){
    const {celdas}=asignar(linea);
    if(celdas.cantidad&&pareceNumero(celdas.cantidad.texto)&&(celdas.referencia||celdas.precio||celdas.importe))dudosasTrasFin.push(linea.texto);
   }
   continue;
  }
  if(evaluarCabecera(linea.celdas).valida){ // cabecera repetida: se registra, nunca se pierde en silencio
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Cabecera de tabla repetida"});
   yAnterior=linea.y;continue;
  }
  const {celdas,conflictos,partida}=asignar(linea);
  const tieneCantidad=!!celdas.cantidad,tieneRef=!!celdas.referencia;
  const tieneImportes=!!(celdas.precio||celdas.importe);
  // Anotaciones del proveedor dentro de la tabla («Entrega en:», «Contacto:», «OBRA: …»,
  // «Retirado por: …»): sin cantidad no son artículos ni continúan la descripción.
  const textoLinea=clave(Object.values(celdas).map(c=>c.texto).join(" "));
  if(!tieneCantidad&&(RE_ANOTACION.test(textoLinea)||/:$/.test(String(celdas.referencia?.texto||"").trim()))){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Anotación del proveedor, no es un artículo"});
   yAnterior=linea.y;continue;
  }
  // Toda línea con referencia, cantidad o importe es una fila: si falta un dato
  // queda en REVISAR, nunca se descarta en silencio.
  // Ruido (manuscritos, marcas): sin referencia ni descripción y sin ninguna cifra válida.
  const soloRuido=!tieneRef&&!celdas.descripcion&&
   Object.entries(celdas).every(([k,c])=>!NUMERICAS.has(k)||!pareceNumero(c.texto));
  if(soloRuido){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Texto sin artículo ni cifras válidas (posible manuscrito o marca)"});
   continue;
  }
  if(tieneCantidad||tieneRef||tieneImportes){
   actual={pagina:pagina.numero,celdas,conflictos,partida,continuaciones:[],y:linea.y};
   filas.push(actual);
  }else{
   const soloTexto=Object.keys(celdas).every(k=>["descripcion","referencia","otra","unidad"].includes(k));
   if(actual&&soloTexto&&celdas.descripcion&&!celdas.referencia&&linea.y-yAnterior<=1.8*linea.alto&&
     !RE_ANOTACION.test(clave(celdas.descripcion.texto))){
    actual.continuaciones.push(celdas.descripcion.texto);
   }else ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Línea sin cantidad dentro de la tabla"});
  }
  yAnterior=linea.y;
 }
 const precio=cols.find(c=>c.campo==="precio");
 const precioPor=precio&&/1000|MIL/.test(precio.clave)?1000:precio&&/100/.test(precio.clave)?100:1;
 return {cabecera:cab.columnas.map(c=>c.campo),filas,ignoradas,pie,indiceCabecera:cab.indice,precioPor,dudosasTrasFin};
}

function valorPie(lineas,re,opcionesNumero){
 for(const [li,linea] of lineas.entries())for(const [ci,celda] of linea.celdas.entries()){
  const k=clave(celda.texto);const m=k.match(re);
  if(!m)continue;
  const resto=celda.texto.slice(m[0].length).replace(/^[\s:€]+/,"").trim();
  const opciones=[resto,...linea.celdas.slice(ci+1).map(c=>c.texto)];
  const abajo=lineas[li+1]?.celdas.find(c=>Math.min(c.x1,celda.x1)-Math.max(c.x0,celda.x0)>0);
  if(abajo)opciones.push(abajo.texto);
  for(const t of opciones){
   const n=N().numero(String(t||"").replace(/€/g,""),opcionesNumero);
   if(n.estado!=="VACIO"&&n.estado!=="INVALIDO")return {...n,etiqueta:celda.texto,caja:caja(celda)};
  }
 }
 return null;
}

/*
 * Totales del pie: base imponible, % IVA, cuota de IVA y total. Se recogen TODOS los
 * candidatos de cada etiqueta y solo se acepta una combinación que cuadre
 * (base + cuota = total; base × % = cuota si hay porcentaje). Sin combinación que cuadre,
 * los valores se devuelven en REVISAR; con varias combinaciones distintas, AMBIGUO.
 */
const ETIQ_TOTALES={
 base:/^(BASE IMPONIBLE|BASE|SUMA NETO|NETO|TOTAL NETO|IMPORTE NETO|SUMA IMPORTES)\b/,
 pct:/^(% ?IVA|IVA ?%|TIPO IVA|TIPO|IVA)\b/,
 cuota:/^(CUOTA IVA|TOTAL IVA|IMPORTE IVA|I V A|IVA)\b/,
 total:/^(TOTAL A PAGAR|TOTAL ALBARAN|IMPORTE TOTAL|TOTAL EUR|TOTAL)\b/
};
const EXCLUIR_TOTAL=/^TOTAL (LINEAS|IVA|RE|NETO|BRUTO)\b/;
function candidatos(lineas,re,opcionesNumero,{excluir=null,porcentaje=false}={}){
 const out=[];
 lineas.forEach((linea,li)=>linea.celdas.forEach((celda,ci)=>{
  const k=clave(celda.texto);const m=k.match(re);
  if(!m||(excluir&&excluir.test(k)))return;
  const resto=celda.texto.slice(m[0].length).replace(/^[\s:€]+/,"").trim();
  const textos=[resto,...linea.celdas.slice(ci+1,ci+4).map(c=>c.texto)];
  const abajo=lineas[li+1]?.celdas.find(c=>Math.min(c.x1,celda.x1)-Math.max(c.x0,celda.x0)>0);
  if(abajo)textos.push(abajo.texto);
  for(const bruto of textos){
   for(const parte of String(bruto||"").split(/\s+(?=\d)/)){
    const t=parte.replace(/€|EUR/gi,"").trim();
    if(!t)continue;
    const esPct=/%/.test(t);
    if(porcentaje!==esPct&&!(porcentaje&&/^\d{1,2}([.,]0+)?$/.test(t)))continue;
    const n=N().numero(t,{...opcionesNumero,porcentaje});
    if(n.estado==="OK"&&(!porcentaje||(n.valor>=0&&n.valor<=30)))out.push({...n,etiqueta:celda.texto,caja:caja(celda)});
   }
  }
 }));
 return out;
}
function leerTotales(lineas,opcionesNumero){
 const vacio=()=>({literal:"",valor:null,estado:"VACIO",motivos:[]});
 const res={base_imponible:vacio(),iva_porcentaje:vacio(),cuota_iva:vacio(),total:vacio(),validacion:null};
 const B=candidatos(lineas,ETIQ_TOTALES.base,opcionesNumero),P=candidatos(lineas,ETIQ_TOTALES.pct,opcionesNumero,{porcentaje:true});
 const C=candidatos(lineas,ETIQ_TOTALES.cuota,opcionesNumero),T=candidatos(lineas,ETIQ_TOTALES.total,opcionesNumero,{excluir:EXCLUIR_TOTAL});
 const unicos=a=>[...new Map(a.map(x=>[x.valor,x])).values()];
 const combos=[];
 for(const b of unicos(B))for(const c of unicos(C))for(const t of unicos(T))
  if(Math.abs(b.valor+c.valor-t.valor)<=0.021&&t.valor>0)combos.push({b,c,t});
 const conPct=combos.flatMap(x=>unicos(P).filter(p=>Math.abs(x.b.valor*p.valor/100-x.c.valor)<=0.021).map(p=>({...x,p})));
 const elegidos=conPct.length?conPct:combos;
 const distintos=[...new Map(elegidos.map(x=>[[x.b.valor,x.c.valor,x.t.valor].join("|"),x])).values()];
 const marcar=(x,estado,motivo)=>({...x,estado,motivos:motivo?[motivo]:[]});
 if(distintos.length===1){
  const x=distintos[0];
  res.base_imponible=marcar(x.b,"VERIFICADO");res.cuota_iva=marcar(x.c,"VERIFICADO");res.total=marcar(x.t,"VERIFICADO");
  if(x.p)res.iva_porcentaje=marcar(x.p,"VERIFICADO");
  else if(unicos(P).length===1)res.iva_porcentaje=marcar(unicos(P)[0],"OK");
  res.validacion={estado:"OK",detalle:"Base "+x.b.literal+" + IVA "+x.c.literal+" = total "+x.t.literal+(x.p?" (IVA "+x.p.valor+" %)":"")};
  return res;
 }
 if(distintos.length>1){
  for(const k of ["base_imponible","cuota_iva","total"])res[k]={...vacio(),estado:"AMBIGUO",motivos:["Varias combinaciones de totales posibles"]};
  res.validacion={estado:"FALLO",detalle:"Varias combinaciones de base, IVA y total"};
  return res;
 }
 // Sin combinación que cuadre. Si están los tres importes, se contradicen: REVISAR.
 // Si falta alguno, no hay contraste posible: lo leído queda como OK (no verificado).
 const completos=B.length&&C.length&&T.length;
 const uno=(a,k)=>{const u=unicos(a);
  if(u.length===1)res[k]=completos?marcar(u[0],"REVISAR","Los totales no cuadran entre sí"):marcar(u[0],"OK");
  else if(u.length>1)res[k]={...vacio(),estado:"AMBIGUO",motivos:["Varios valores: "+u.map(x=>x.literal).join(" | ")]};};
 uno(B,"base_imponible");uno(P,"iva_porcentaje");uno(C,"cuota_iva");uno(T,"total");
 if(completos)res.validacion={estado:"FALLO",detalle:"Base + IVA no coincide con el total impreso"};
 else if(B.length||C.length||T.length)res.validacion={estado:"NO_APLICA",detalle:"Faltan importes para contrastar base + IVA = total"};
 return res;
}

/* --------------------------- Campos y comprobaciones ------------------------ */
function campoTexto(celda){
 const literal=N().limpiar(celda?.texto||"");
 return {literal,valor:literal||null,estado:literal?"OK":"VACIO",motivos:[],caja:caja(celda),conf_ocr:celda?.conf??null};
}
function campoNumero(celda,opciones){
 const r=N().numero(celda?.texto||"",opciones);
 return {...r,caja:caja(celda),conf_ocr:celda?.conf??null};
}
function campoDescuento(celda,opciones){
 const literal=N().limpiar(celda?.texto||"");
 // «60 5» (Saltoki) = descuentos en cascada 60 % + 5 %; el cuadre de la línea lo confirma.
 const cascadaConEspacios=/^\d{1,3}([.,]\d+)?(\s+\d{1,3}([.,]\d+)?)+$/.test(literal);
 const r=N().descuento(cascadaConEspacios?literal.replace(/\s+/g,"+"):literal,opciones);
 if(cascadaConEspacios)r.notas=[...(r.notas||[]),"Descuentos separados por espacios interpretados en cascada"];
 return {...r,literal,caja:caja(celda),conf_ocr:celda?.conf??null,cascada_por_espacios:cascadaConEspacios};
}
const redondear=(x,d=2)=>Math.round((x+Math.sign(x)*1e-9)*10**d)/10**d;
function cuadre(f,precioPor){
 const ok=x=>x.estado==="OK";
 if(f.precio.estado==="VACIO"&&f.importe.estado==="VACIO"&&f.subtotal.estado==="VACIO")
  return {estado:"SIN_PRECIOS",detalle:"Albarán sin precios en esta línea"};
 if(!ok(f.cantidad)||!ok(f.precio)||!ok(f.importe)||(f.descuento.estado!=="OK"&&f.descuento.estado!=="VACIO"))
  return {estado:"INCOMPLETO",detalle:"Falta un valor válido de cantidad, precio, descuento o importe"};
 const factor=f.descuento.estado==="OK"?f.descuento.factor:1;
 const decImporte=f.importe.decimales||2;
 const tol=Math.max(0.011,1.1*10**-decImporte);
 const cumple=por=>{
  const bruto=f.cantidad.valor*f.precio.valor/por;
  const q=f.cantidad.valor,p=f.precio.valor/por;
  // Variantes de redondeo habituales: sobre el bruto o sobre el precio neto unitario.
  const variantes=[bruto*factor,redondear(bruto)*factor,redondear(redondear(bruto)*factor),
   q*redondear(p*factor,4),q*redondear(p*factor,2),redondear(q*redondear(p*factor,4))];
  const subOK=!ok(f.subtotal)||Math.abs(redondear(bruto)-f.subtotal.valor)<=tol;
  return subOK&&variantes.some(v=>Math.abs(v-f.importe.valor)<=tol);
 };
 if(cumple(precioPor))return {estado:"VERIFICADO",detalle:"cantidad × precio"+(precioPor>1?" / "+precioPor:"")+(factor!==1?" × (1 − dto)":"")+" = importe"};
 const hipotesis=[];
 for(const por of [100,1000])if(por!==precioPor&&cumple(por))hipotesis.push("el precio parece expresado por "+por+" unidades");
 if(factor!==1&&Math.abs(f.cantidad.valor*f.precio.valor/precioPor-f.importe.valor)<=tol)hipotesis.push("el importe no aplica el descuento impreso");
 return {estado:"DESCUADRE",detalle:"cantidad × precio × (1 − dto) no coincide con el importe impreso",hipotesis};
}

/*
 * OCR: el separador decimal a veces se lee como punto («4.0000») o se pierde («43126»).
 * Se prueban solo esas hipótesis sobre cantidad, precio e importe leídos por OCR y se
 * aceptan si UNA única combinación hace cuadrar la línea. Si no, nada cambia.
 */
function hipotesisOCR(campo,opcionesNumero){
 const lit=String(campo?.literal||"").replace(/\s+/g,"");
 const out=[];
 if(["OK","VERIFICADO"].includes(campo?.estado))out.push({valor:campo.valor,reparado:null});
 if(campo?.conf_ocr==null||!lit)return out;
 const pon=t=>{const n=N().numero(t,{...opcionesNumero,formatoConfirmado:true});if(n.estado==="OK"&&!out.some(o=>o.valor===n.valor))out.push({valor:n.valor,reparado:t,decimales:n.decimales});};
 if(/^\d+\.\d{2,4}$/.test(lit)&&!/^\d{1,3}\.\d{3}$/.test(lit))pon(lit.replace(".",","));
 if(/^\d{1,3}(\.\d{3})*\.\d{2,4}$/.test(lit))pon(lit.replace(/\.(\d{2,4})$/,",$1"));
 if(/^\d{3,}$/.test(lit))for(const d of [opcionesNumero.decimales,2,4].filter((x,i,a)=>x&&a.indexOf(x)===i))
  if(lit.length>d)pon(lit.slice(0,-d)+","+lit.slice(-d));
 return out;
}
function repararSeparadoresOCR(f,opcionesNumero,precioPor){
 const campos=["cantidad","precio","importe"];
 const opciones=campos.map(k=>hipotesisOCR(f[k],opcionesNumero));
 if(opciones.some(o=>!o.length)||!opciones.some(o=>o.some(x=>x.reparado)))return;
 const validas=[];
 for(const q of opciones[0])for(const p of opciones[1])for(const i of opciones[2]){
  if(!q.reparado&&!p.reparado&&!i.reparado)continue;
  const prueba={...f,cantidad:{...f.cantidad,valor:q.valor,estado:"OK"},precio:{...f.precio,valor:p.valor,estado:"OK"},
   importe:{...f.importe,valor:i.valor,estado:"OK",decimales:i.decimales??f.importe.decimales}};
  if(cuadre(prueba,precioPor).estado==="VERIFICADO")validas.push([q,p,i]);
 }
 const distintas=[...new Map(validas.map(v=>[v.map(x=>x.valor).join("|"),v])).values()];
 if(distintas.length!==1)return;
 distintas[0].forEach((h,j)=>{
  const k=campos[j];
  if(!h.reparado)return;
  f[k]={...f[k],valor:h.valor,estado:"OK",motivos:[],decimales:h.decimales??f[k].decimales,
   notas:[...(f[k].notas||[]),"Separador decimal del OCR corregido («"+f[k].literal+"» → «"+h.reparado+"») y confirmado por el cuadre"]};
 });
 f.cuadre=cuadre(f,precioPor);
}

function construirFila(cruda,n,opcionesNumero,perfil,precioPor){
 const c=cruda.celdas;
 const f={
  fila:n,pagina:cruda.pagina,
  referencia:campoTexto(c.referencia),
  descripcion:campoTexto(c.descripcion),
  cantidad:campoNumero(c.cantidad,opcionesNumero),
  unidad:campoTexto(c.unidad),
  precio:{...campoNumero(c.precio,opcionesNumero),por:precioPor},
  descuento:campoDescuento(c.descuento2?{...c.descuento2,...(c.descuento||{}),
   texto:[c.descuento?.texto,c.descuento2.texto].map(t=>String(t||"").trim()).filter(Boolean).join("+")}:c.descuento,opcionesNumero),
  subtotal:campoNumero(c.subtotal,opcionesNumero),
  importe:campoNumero(c.importe,opcionesNumero),
  motivos:[],notas:[]
 };
 // Cantidad con la unidad pegada («8,00 UD», «20 SAC», «3,5 M2»).
 if(f.cantidad.estado==="INVALIDO"){
  const m=f.cantidad.literal.match(RE_CANTIDAD_UNIDAD);
  if(m){
   const n=N().numero(m[1],opcionesNumero);
   f.cantidad={...n,literal:f.cantidad.literal,caja:f.cantidad.caja,notas:[...n.notas,"Unidad impresa junto a la cantidad: "+m[2]]};
   if(f.unidad.estado==="VACIO")f.unidad={...f.unidad,literal:m[2],valor:m[2],estado:"OK"};
  }
 }
 // Cantidad y precio pegados en el original («1,00001.890,0000»): se separan solo si
 // ambas cifras tienen los decimales que usa el documento; el cuadre debe confirmarlo.
 for(const [k,otro] of [["cantidad","precio"],["precio","cantidad"]]){
  if(f[k].estado!=="INVALIDO"||f[otro].estado!=="VACIO"||!opcionesNumero.decimales)continue;
  const d=opcionesNumero.decimales;
  const m=f[k].literal.replace(/\s+/g,"").match(new RegExp("^(\\d{1,3}(?:\\.\\d{3})*,\\d{"+d+"})(\\d{1,3}(?:\\.\\d{3})*,\\d{"+d+"})$"));
  if(!m)continue;
  const q=N().numero(m[1],opcionesNumero),p=N().numero(m[2],opcionesNumero);
  if(q.estado!=="OK"||p.estado!=="OK")continue;
  f.cantidad={...q,caja:f[k].caja,notas:["Cifra separada de «"+f[k].literal+"»"]};
  f.precio={...p,caja:f[k].caja,por:precioPor,notas:["Cifra separada de «"+f[k].literal+"»"]};
  cruda.partida=true;
 }
 if(c.descuento2)f.notas.push("Dos columnas de descuento aplicadas en cascada");
 if(cruda.continuaciones.length){
  f.descripcion.literal=[f.descripcion.literal,...cruda.continuaciones].filter(Boolean).join(" ");
  f.descripcion.valor=f.descripcion.literal||null;f.descripcion.estado=f.descripcion.literal?"OK":"VACIO";
  f.notas.push("Descripción en "+(cruda.continuaciones.length+1)+" renglones");
 }
 for(const campo of cruda.conflictos){
  f[campo]={...f[campo],valor:null,estado:"AMBIGUO",motivos:[...(f[campo].motivos||[]),"Varias cifras en la misma columna"]};
 }
 f.cuadre=cuadre(f,precioPor);
 if(f.cuadre.estado!=="VERIFICADO")repararSeparadoresOCR(f,opcionesNumero,precioPor);
 const numericos=["cantidad","precio","descuento","importe","subtotal"];
 if(f.cuadre.estado==="VERIFICADO"){
  for(const k of numericos)if(f[k].estado==="OK")f[k].estado="VERIFICADO";
 }else if(f.cuadre.estado==="DESCUADRE"){
  for(const k of numericos)if(f[k].estado==="OK"){
   f[k].estado="REVISAR";f[k].motivos=[...f[k].motivos,"El cuadre de la línea no se cumple"];
  }
  f.motivos.push("Descuadre: "+f.cuadre.detalle+(f.cuadre.hipotesis.length?" ("+f.cuadre.hipotesis.join("; ")+")":""));
 }else if(f.cuadre.estado==="INCOMPLETO"&&(f.precio.estado!=="VACIO"||f.importe.estado!=="VACIO")){
  f.motivos.push("Cuadre incompleto: "+f.cuadre.detalle);
 }
 if(f.referencia.estado==="VACIO"&&!perfil?.permite_sin_referencia)f.motivos.push("Línea sin referencia");
 if(cruda.partida&&f.cuadre.estado!=="VERIFICADO"){
  f.motivos.push("Columnas separadas por posición estimada y sin cuadre que lo confirme");
  for(const k of ["referencia","descripcion","cantidad","unidad","precio","descuento","importe"])
   if(f[k].estado==="OK")f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"Posición de columna estimada"]};
 }
 if(f.cantidad.valor===0)f.motivos.push("Cantidad 0 (posible pendiente de servir)");
 if(["AMBIGUO","INVALIDO","VACIO"].includes(f.cantidad.estado))
  f.motivos.push("Cantidad: "+(f.cantidad.motivos[0]||"celda vacía"));
 for(const k of ["precio","descuento","importe","subtotal"])
  if(["AMBIGUO","INVALIDO"].includes(f[k].estado))f.motivos.push(k+": "+(f[k].motivos[0]||f[k].estado));
 f.estado=f.motivos.length?"REVISAR":"OK";
 return f;
}

/* -------------------------------- Confianza -------------------------------- */
/*
 * Confianza 0–1 por campo, línea y documento. Fiable: ≥ UMBRAL_FIABLE.
 *  - VERIFICADO (cuadre aritmético, CIF con dígito de control y registrado, totales que cuadran): 0,99
 *  - OK: 0,96 si viene de texto digital; con OCR, según la confianza de la palabra leída
 *  - REVISAR 0,5 · AMBIGUO / INVALIDO 0,15
 *  - VACIO: campo obligatorio 0; opcional (sin precio, sin descuento) 0,97 digital / 0,90 OCR
 */
const UMBRAL_FIABLE=0.9;
function confianzaCampo(c,{obligatorio=false}={}){
 if(!c)return obligatorio?0:null;
 const e=c.estado;
 if(e==="VERIFICADO")return 0.99;
 if(e==="REVISAR")return 0.5;
 if(e==="AMBIGUO"||e==="INVALIDO")return 0.15;
 if(e==="VACIO"||e==="NIF_NO_REGISTRADO"&&!c.nif)return obligatorio?0:(c.conf_ocr===undefined||c.conf_ocr===null?0.97:0.9);
 const ocr=c.conf_ocr;
 if(ocr===null||ocr===undefined)return 0.96;
 // Sin verificación independiente, solo una lectura OCR muy segura se considera fiable.
 return ocr>=90?0.95:ocr>=80?0.85:ocr>=60?0.75:0.6;
}
function aplicarConfianza(salida,perfil){
 const r2=x=>Math.round(x*100)/100;
 const p=salida.proveedor;
 if(p){p.confianza=p.estado==="OK"?(p.via==="nombre_registrado"?0.92:0.99):p.estado==="NIF_NO_REGISTRADO"?0.85:confianzaCampo(p,{obligatorio:true});}
 for(const k of ["numero","fecha"])if(salida[k])salida[k].confianza=r2(confianzaCampo(salida[k],{obligatorio:true}));
 const sinRefPermitida=!!perfil?.permite_sin_referencia;
 for(const l of salida.lineas){
  const partes={
   referencia:confianzaCampo(l.referencia,{obligatorio:!sinRefPermitida}),
   descripcion:confianzaCampo(l.descripcion,{obligatorio:true}),
   cantidad:confianzaCampo(l.cantidad,{obligatorio:true}),
   precio:confianzaCampo(l.precio),descuento:confianzaCampo(l.descuento),importe:confianzaCampo(l.importe)
  };
  for(const [k,v] of Object.entries(partes))if(l[k]&&v!==null)l[k].confianza=r2(v);
  l.confianza=r2(Math.min(...Object.values(partes).filter(v=>v!==null)));
  if(l.estado!=="OK")l.confianza=Math.min(l.confianza,0.5);
  l.fiable=l.confianza>=UMBRAL_FIABLE;
 }
 for(const t of Object.values(salida.totales||{}))if(t&&typeof t==="object"&&"estado" in t)t.confianza=r2(confianzaCampo(t)??0);
 const criticos=[p?.confianza??0,salida.numero?.confianza??0,salida.fecha?.confianza??0,...salida.lineas.map(l=>l.confianza)];
 if(!salida.lineas.length)criticos.push(0);
 if(salida.validaciones.some(v=>v.estado==="FALLO"))criticos.push(0.5);
 salida.confianza=r2(Math.min(...criticos));
 salida.fiable=salida.confianza>=UMBRAL_FIABLE;
}

/* ------------------------------ Documento entero ---------------------------- */
function extraerDePaginas(paginas,opciones={}){
 const registro=opciones.registro||PROV().REGISTRO;
 const incidencias=[];
 const salida={version:VERSION,motor:"pdfjs-capa-de-texto",
  paginas:paginas.map(p=>({numero:p.numero,tipo:p.tipo,caracteres:p.caracteres,fraccion_imagen:p.fraccion_imagen,avisos:p.avisos})),
  tipo_pdf:paginas.every(p=>p.tipo==="ESCANEADO")?"ESCANEADO":paginas.every(p=>p.tipo==="OCR")?"ESCANEADO_OCR":paginas.some(p=>p.tipo!=="DIGITAL")?"MIXTO":"DIGITAL",
  proveedor:null,numero:null,fecha:null,formato_numeros:null,lineas:[],lineas_ignoradas:[],pie:{},validaciones:[],estado:"REVISAR",incidencias};
 if(salida.tipo_pdf==="ESCANEADO"){
  salida.estado="NO_DIGITAL";
  incidencias.push("PDF escaneado sin capa de texto: requiere OCR (fase P1). No se ha extraído ningún dato.");
  return salida;
 }
 if(salida.tipo_pdf==="MIXTO")incidencias.push("Alguna página es un escaneo o no tiene texto: los datos requieren revisión.");
 const digitales=paginas.filter(p=>p.tipo!=="ESCANEADO");
 // Cabecera: zona sobre la tabla de la primera página (o la página entera si no hay tabla).
 const tablas=digitales.map(p=>({p,t:leerTablaPagina(p)}));
 const primera=tablas[0];
 salida.proveedor=identificarProveedor(digitales,registro,primera.t?primera.p.lineas[primera.t.indiceCabecera].y:null);
 const perfil=salida.proveedor.id?registro.proveedores.find(p=>p.id===salida.proveedor.id):null;
 const opcionesFecha={hoy:opciones.hoy,orden:perfil?.orden_fecha||"DMY"};
 const zona=primera.t?primera.p.lineas.slice(0,primera.t.indiceCabecera):primera.p.lineas;
 salida.numero=leerNumero(zona);
 salida.fecha=leerFecha(zona,opcionesFecha);
 // Algunos proveedores (Saltoki) imprimen número y fecha al pie: se busca en toda la página.
 if(salida.numero.estado==="VACIO"&&primera.t){const n=leerNumero(primera.p.lineas);if(n.estado!=="VACIO")salida.numero=n;}
 if(salida.fecha.estado==="VACIO"&&primera.t){const f=leerFecha(primera.p.lineas,opcionesFecha);if(f.estado!=="VACIO")salida.fecha=f;}
 // Formato numérico: perfil confirmado o pruebas en las cifras del propio documento.
 const crudas=tablas.flatMap(x=>x.t?x.t.filas:[]);
 const literales=crudas.flatMap(f=>["cantidad","precio","subtotal","importe"].map(k=>f.celdas[k]?.texto).filter(Boolean));
 const deducido=N().deducirFormato(literales);
 salida.formato_numeros=perfil?.formato_confirmado?{formato:perfil.formato_numeros,confirmado:true,origen:"perfil del proveedor"}:
  {formato:deducido.formato,confirmado:deducido.confirmado,origen:deducido.confirmado?"cifras del propio documento ("+deducido.pruebas+")":"sin pruebas"+(deducido.conflicto?" (formatos contradictorios)":"")};
 const decimalesVistos=literales.map(t=>(String(t).match(/,(\d+)$/)||[])[1]?.length).filter(Boolean);
 const decimales=decimalesVistos.length?[...decimalesVistos].sort((a,b)=>decimalesVistos.filter(x=>x===b).length-decimalesVistos.filter(x=>x===a).length)[0]:null;
 const opcionesNumero={formato:salida.formato_numeros.formato,formatoConfirmado:salida.formato_numeros.confirmado,decimales};
 const cabeceraPrecio=tablas.map(x=>x.t?.cabecera).find(Boolean);
 const precioPor=perfil?.precio_por||tablas.map(x=>x.t?.precioPor).find(Boolean)||1;
 const noArticulo=(perfil?.anotaciones_no_articulo||["RETIRADO POR","RECOGIDO POR","PEDIDO POR"]).map(t=>N().canon(t));
 let n=0;
 for(const cruda of crudas){
  const texto=N().canon((cruda.celdas.referencia?.texto||"")+(cruda.celdas.descripcion?.texto||""));
  const sinPrecio=!cruda.celdas.precio&&!cruda.celdas.importe;
  if(sinPrecio&&noArticulo.some(p=>texto.startsWith(p))){
   salida.lineas_ignoradas.push({pagina:cruda.pagina,texto:Object.values(cruda.celdas).map(c=>c.texto).join(" "),motivo:"Anotación de recogida, no es un artículo"});
   continue;
  }
  salida.lineas.push(construirFila(cruda,++n,opcionesNumero,perfil,precioPor));
 }
 for(const x of tablas)if(x.t)salida.lineas_ignoradas.push(...x.t.ignoradas);
 // Pie: totales impresos.
 const pie=tablas.flatMap(x=>x.t?x.t.pie:x.p.lineas);
 const leido=valorPie(pie,/^(TOTAL LINEAS|N[ºO°]? ?(DE )?LINEAS)/,opcionesNumero);
 // «Total líneas: 21,77» (Saltoki) es la suma de importes, no un recuento.
 const totalLineas=leido&&leido.estado==="OK"&&Number.isInteger(leido.valor)&&!/,/.test(leido.literal)?leido:null;
 const sumaLineasImpresa=leido&&leido.estado==="OK"&&!totalLineas?leido:null;
 salida.totales=leerTotales(pie,opcionesNumero);
 const base=salida.totales.base_imponible.estado!=="VACIO"&&salida.totales.base_imponible.valor!==null?salida.totales.base_imponible:sumaLineasImpresa;
 salida.pie={total_lineas:totalLineas,suma_lineas_impresa:sumaLineasImpresa,base_imponible:base};
 // Geometría de las tablas (para relecturas por zonas en documentos escaneados).
 salida.tablas=tablas.map(x=>x.t?{pagina:x.p.numero,y_cabecera:x.p.lineas[x.t.indiceCabecera].y-x.p.lineas[x.t.indiceCabecera].alto,
  y_fin:x.t.pie.length?x.t.pie[0].y:(x.p.lineas.at(-1)?.y??x.p.alto),ancho:x.p.ancho,alto:x.p.alto}:{pagina:x.p.numero,y_cabecera:null});
 Object.defineProperty(salida,"_ctx",{enumerable:false,writable:true,value:{
  perfil,totalLineas,base,hayTabla:tablas.some(x=>x.t),columnas:primera.t?.cabecera||[],
  dudosas:tablas.flatMap(x=>x.t?x.t.dudosasTrasFin:[]),incidenciasBase:[...incidencias],
  sinPrecio:!!(cabeceraPrecio&&!cabeceraPrecio.includes("precio"))}});
 return finalizar(salida);
}

/* Validaciones de documento, confianza y estado. Se puede repetir tras combinar lecturas. */
function finalizar(salida){
 const ctx=salida._ctx,incidencias=[...ctx.incidenciasBase];
 salida.validaciones=[];salida.incidencias=incidencias;
 const v=(nombre,estado,detalle)=>salida.validaciones.push({nombre,estado,detalle});
 if(!ctx.hayTabla)v("tabla","FALLO","No se encontró la cabecera de la tabla de artículos");
 else v("tabla","OK","Columnas: "+ctx.columnas.join(", "));
 v("lineas",salida.lineas.length?"OK":"FALLO",salida.lineas.length+" líneas de artículo");
 const totalLineas=ctx.totalLineas,base=ctx.base;
 if(totalLineas?.estado==="OK"){
  v("total_lineas",totalLineas.valor===salida.lineas.length?"OK":"FALLO","Impreso "+totalLineas.literal+" / leídas "+salida.lineas.length);
 }else v("total_lineas","NO_APLICA","El documento no imprime el número de líneas");
 const conImporte=salida.lineas.filter(l=>["VERIFICADO","OK"].includes(l.importe.estado));
 if(base&&["OK","VERIFICADO"].includes(base.estado)&&conImporte.length&&conImporte.length===salida.lineas.length){
  const suma=redondear(conImporte.reduce((s,l)=>s+l.importe.valor,0));
  v("suma_importes",Math.abs(suma-base.valor)<=0.02?"OK":"FALLO","Suma de líneas "+suma+" / impreso «"+base.literal+"»");
 }else v("suma_importes","NO_APLICA",base?"No todas las líneas tienen importe válido":"No hay base imponible impresa");
 if(salida.lineas.some(l=>l.cuadre.estado==="DESCUADRE"))v("cuadre_lineas","FALLO","Hay líneas cuyo importe no cuadra");
 const t=salida.totales;
 if(t?.validacion)v("totales",t.validacion.estado,t.validacion.detalle);
 if(ctx.dudosas.length)v("fin_de_tabla","FALLO","Posibles artículos después del final detectado de la tabla: "+ctx.dudosas.map(t=>"«"+t+"»").join("; "));
 for(const x of salida.validaciones_extra||[])salida.validaciones.push(x);
 // Estado final.
 const camposCabecera=[["proveedor",salida.proveedor],["numero",salida.numero],["fecha",salida.fecha]];
 for(const [k,c] of camposCabecera)if(c.estado!=="OK")incidencias.push(k+": "+(c.motivos[0]||c.estado));
 const filasRevisar=salida.lineas.filter(l=>l.estado!=="OK");
 if(filasRevisar.length)incidencias.push(filasRevisar.length+" línea(s) requieren revisión: "+filasRevisar.map(l=>l.fila).join(", "));
 for(const x of salida.validaciones)if(x.estado==="FALLO")incidencias.push("Validación "+x.nombre+": "+x.detalle);
 aplicarConfianza(salida,ctx.perfil);
 const todoOK=camposCabecera.every(([,c])=>c.estado==="OK")&&salida.lineas.length>0&&!filasRevisar.length&&
  !salida.validaciones.some(x=>x.estado==="FALLO")&&["DIGITAL","ESCANEADO_OCR"].includes(salida.tipo_pdf)&&
  salida.confianza>=UMBRAL_FIABLE;
 salida.estado=todoOK?"AUTO_OK":"REVISAR";
 if(!todoOK&&salida.confianza<UMBRAL_FIABLE&&salida.tipo_pdf==="ESCANEADO_OCR")
  incidencias.push("Confianza del documento "+salida.confianza+" < "+UMBRAL_FIABLE+": requiere revisión");
 if(ctx.sinPrecio&&salida.lineas.length)salida.notas=["La tabla no tiene columna de precio"];
 return salida;
}

async function extraerPdf(pdfjs,datos,opciones={}){
 const paginas=await TEXTO().leerDocumento(pdfjs,datos);
 return extraerDePaginas(paginas,opciones);
}

return {VERSION,UMBRAL_FIABLE,extraerPdf,extraerDePaginas,finalizar,leerTablaPagina,identificarProveedor,cuadre};
});
