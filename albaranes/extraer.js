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
const clave=t=>N().sinAcentos(t).replace(/\.(?=[A-Z0-9])/g,"").replace(/[.:€()\/_|¦\[\]]/g," ").replace(/\s+/g," ").trim();
const caja=c=>c?[Math.round(c.x0*10)/10,Math.round(c.y*10)/10,Math.round(c.x1*10)/10,Math.round(c.alto*10)/10]:null;

/* ---------------------------- Cabecera de tabla ---------------------------- */
const COLUMNAS=[
 ["referencia",/^(REF|REFERENCIA|REF ARTICULO|COD|CODIGO|COD ART|CODIGO ARTICULO|COD ARTICULO|ART|ARTICULO)$/],
 // En inglés («Description | Qty | Unit price | Tax | Amount», facturas de suscripciones de otros países de la UE, 2026-11-26).
 ["descripcion",/^(DESCRIPCION|CONCEPTO|CONCEPTOS|DENOMINACION|DESIGNACION|DETALLE|PRODUCTO|DESCRIPCION ARTICULO|DESCRIPCION DEL PRODUCTO|DESCRIPCION DEL ARTICULO|DESCRIPCION DEL|DESCRIPCION DE|DESCRIPCION EQUIPOS ALQUILADOS|DESCRIPCION EQUIPOS|EQUIPOS ALQUILADOS|DESCRIPCION SERVICIO|DESCRIPCION SERVICIOS|DESCRIPTION)$/],
 // «UNID» (factura real escaneada 2026-11-23: «Unid. | Imp. Uni.» con las cantidades debajo). Si una tabla la usa para la unidad de
 // medida («UD», «KG»), esas casillas no son números y la línea queda sin cantidad (a revisión), nunca con una cantidad falsa.
 ["cantidad",/^(CANTIDAD|CANT|UDS|UNIDADES|UNDS|UNID|CTDAD|CANT SERVIDA|CANTIDAD SERVIDA|KILOS|KGS|QTY|QUANTITY)$/],
 ["unidad",/^(UD|UN|U M|UM|UNIDAD|MEDIDA)$/],
 // «IMP. UNI.» = importe unitario (misma factura real del 2026-11-23).
 ["precio",/^(PRECIO|PRECIO ?UNIDAD|PRECIO ?UNITARIO|PRECIO ?UNIT|P UNIT|P UNITARIO|PUNITARIO|PUNIT|PVP|PRECIO ?UD|PRECIO ?UNID|P UNID|PRECIO DIA|PRECIO DIARIO|PRECIO ALQUILER|PRECIO NETO|PRECIO NETO U|PRECIO NETO UD|PRECIO NETO UNIT|PRECIO NETO UNITARIO|TARIFA|PRECIO 100|PRECIO X 100|PRECIO 1000|PRECIO X 1000|IMP ?UNI|IMP ?UNIT|IMP ?UNITARIO|IMPORTE ?UNITARIO|IMPORTE ?UNIDAD|IMP ?UNIDAD|UNIT PRICE)$/],
 ["subtotal",/^(SUBTOTAL|BRUTO|IMPORTE BRUTO)$/],
 ["descuento",/^(DTO|DTOS|DESC|DESCUENTO|DTO %|% DTO|%DTO|DTO%|% DESC|DESC %|DTO ?[123]|DESC ?[123]|% ?DTO ?[123]|DTO ?[123] ?%)$/],
 // «CARGOS»: importe de cada concepto en una factura de servicios (gestoría, 2026-11-24: «FECHA | DESCRIPCION | CARGOS | ABONOS»).
 ["importe",/^(IMPORTE|IMPORTE NETO|TOTAL|NETO|TOTAL LINEA|IMPORTE TOTAL|IMPORTE EUR|CARGOS|AMOUNT)$/]
];
// Títulos de una palabra que el OCR puede leer con una letra cambiada («Descrinción»).
const TITULOS_OCR={DESCRIPCION:"descripcion",CONCEPTO:"descripcion",DENOMINACION:"descripcion",CANTIDAD:"cantidad",
 REFERENCIA:"referencia",ARTICULO:"referencia",CODIGO:"referencia",IMPORTE:"importe",PRECIO:"precio",DESCUENTO:"descuento"};
function distancia1(a,b){
 if(a===b)return 0;if(Math.abs(a.length-b.length)>1)return 2;
 let i=0;while(i<a.length&&a[i]===b[i])i++;
 const r=(x,y)=>x===y;
 return r(a.slice(i+1),b.slice(i+1))||r(a.slice(i+1),b.slice(i))||r(a.slice(i),b.slice(i+1))?1:2;
}
function campoDe(texto){
 const k=clave(texto);
 for(const [campo,re] of COLUMNAS)if(re.test(k))return {campo,clave:k};
 if(/^[A-Z]{7,}$/.test(k))for(const [t,campo] of Object.entries(TITULOS_OCR))if(distancia1(k,t)===1)return {campo,clave:t};
 return null;
}
/*
 * Palabras de una celda con su posición estimada. Con el texto original
 * (espacios incluidos) la estimación es exacta en fuentes monoespaciadas;
 * en las proporcionales es aproximada y se trata como tal.
 */
function palabrasConPosicion(celda){
 if(celda.palabras?.length>1)return celda.palabras.map(p=>({...p,alto:celda.alto}));
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
 // Motas del OCR sobre la banda de títulos («ÉS», «ó»): no son columnas.
 celdas=celdas.filter(c=>clave(c.texto).replace(/[^A-Z0-9%]/g,"").length>2||campoDe(c.texto));
 const todas=celdas.flatMap(c=>{
  const r=camposDeCelda(c);
  const mezcla=r.some(x=>x.campo==="otra")&&r.some(x=>x.campo!=="otra");
  return mezcla&&celdas.length>1?[{campo:"otra",clave:clave(c.texto),x0:c.x0,x1:c.x1}]:r;
 });
 // Un título de dos palabras que el OCR parte en dos celdas («IMPORTE» | «NETO», «PRECIO» | «UNID.»; fallo real 2026-11-18: la
 // segunda se tomaba por otra columna de importe y se ignoraba, y las cifras, centradas bajo ella, se perdían). Dos títulos
 // pegados (hueco menor que 1,5 altos) que juntos son un título conocido del mismo campo que el primero se unen.
 // También dos trozos que solos no son títulos y juntos sí («Imp.» | «Uni.» = precio; factura real escaneada del 2026-11-23).
 const altoTit=Math.max(0,...celdas.map(c=>c.alto||0))||10;
 const columnas=[];
 for(const c of [...todas].sort((a,b)=>a.x0-b.x0)){
  const prev=columnas[columnas.length-1];
  const junto=prev&&c.x0-prev.x1<=1.5*altoTit&&(prev.campo!=="otra"||c.campo==="otra")?campoDe(prev.clave+" "+c.clave):null;
  if(junto&&(junto.campo===prev.campo||(prev.campo==="otra"&&c.campo==="otra"))){prev.campo=junto.campo;prev.clave=junto.clave;prev.x1=Math.max(prev.x1,c.x1);continue;}
  columnas.push({...c});
 }
 // «UNID» junto a otra columna de cantidad («Cant. | Unid.») es la unidad de medida.
 if(columnas.filter(c=>c.campo==="cantidad").length>1)for(const c of columnas)if(c.campo==="cantidad"&&c.clave==="UNID")c.campo="unidad";
 const campos=new Set(columnas.map(c=>c.campo));
 if(campos.has("referencia")&&!campos.has("descripcion")){
  // «ARTÍCULO» sin columna de descripción es la descripción.
  const art=columnas.find(c=>c.campo==="referencia"&&/^ART/.test(c.clave));
  if(art&&columnas.filter(c=>c.campo==="referencia").length>1){art.campo="descripcion";}
  else if(art&&!columnas.some(c=>c.campo==="referencia"&&c!==art)){art.campo="descripcion";}
 }
 let finales=new Set(columnas.map(c=>c.campo).filter(c=>c!=="otra"));
 // OCR sobre banda gris: los títulos de texto pueden salir ilegibles («ARTO», «ESCMPIÓN»)
 // mientras CANTIDAD y los económicos se leen. Con cantidad y al menos dos títulos económicos,
 // los títulos ilegibles a su izquierda se asignan por posición: código y descripción.
 // Esas columnas quedan marcadas como inferidas (el cuadre no las confirma).
 const cant=columnas.find(c=>c.campo==="cantidad");
 const economicos=["precio","subtotal","descuento","importe"].filter(k=>finales.has(k)).length;
 if(cant&&economicos>=2&&!finales.has("descripcion")&&!finales.has("referencia")){
  const izquierda=columnas.filter(c=>c.campo==="otra"&&c.x1<=cant.x0).sort((a,b)=>a.x0-b.x0);
  if(izquierda.length===1||izquierda.length===2){
   const campos=izquierda.length===2?["referencia","descripcion"]:["descripcion"];
   izquierda.forEach((c,i)=>{c.campo=campos[i];c.inferida=true;});
   finales=new Set(columnas.map(c=>c.campo).filter(c=>c!=="otra"));
  }
 }
 // Factura de servicios con la base y el IVA de cada concepto («Descripción | Cuota IVA | Base Imponible (€)», 2026-11-26: prevención de
 // riesgos laborales): el importe de cada concepto es su base y su tipo, el de la columna del IVA («21,00 %» o «EXENTO»). Solo con esa
 // forma exacta: en otras facturas «Base imponible | % IVA | Cuota» es el desglose de los totales, no las líneas.
 const conBase=columnas.length===3&&columnas.filter(c=>c.campo==="descripcion").length===1&&columnas.some(c=>c.campo==="otra"&&c.clave.trim()==="BASE IMPONIBLE")&&
  columnas.some(c=>c.campo==="otra"&&/^(CUOTA IVA|% IVA|TIPO IVA)$/.test(c.clave.trim()));
 if(conBase){
  for(const c of columnas)if(c.campo==="otra"){c.clave=c.clave.trim();c.campo=c.clave==="BASE IMPONIBLE"?"importe":"iva";}
  finales=new Set(columnas.map(c=>c.campo).filter(c=>c!=="otra"));
 }
 const ajenasFinal=columnas.filter(c=>c.campo==="otra").length;
 // Títulos en inglés (2026-11-26): solo la tabla de las facturas de suscripciones («Description | Qty | Unit price | Tax | Amount»): un
 // solo precio, el importe en «Amount» y como mucho una columna ajena, la del impuesto. Las demás tablas en inglés (tiendas en línea con
 // dos precios, «Net | VAT | Total») se siguen leyendo por su pie, como antes (banco de facturas: con la tabla, sus totales se perdían).
 if(columnas.some(c=>/^(DESCRIPTION|QTY|QUANTITY|UNIT PRICE|AMOUNT)$/.test(c.clave))){
  const ajenas=columnas.filter(c=>c.campo==="otra");
  const forma=columnas.filter(c=>c.campo==="precio").length===1&&columnas.filter(c=>c.campo==="importe").length===1&&columnas.some(c=>c.campo==="importe"&&c.clave==="AMOUNT")&&
   ajenas.length<=1&&ajenas.every(c=>/^(TAX|VAT|VAT RATE|TAX RATE)$/.test(c.clave));
  if(!forma)return {valida:false,columnas:columnas.sort((a,b)=>a.x0-b.x0),ajenas:ajenasFinal};
 }
 // Factura de servicios (gestoría, 2026-11-24): conceptos con su importe en «CARGOS», sin cantidad ni precio. Vale como tabla; cada
 // concepto lleva cantidad 1 y precio = importe (usuario: «cantidad 1»), confirmados solo con los totales impresos (verificarServicios).
 const servicios=conBase||(!finales.has("cantidad")&&!finales.has("precio")&&finales.has("descripcion")&&columnas.some(c=>c.campo==="importe"&&c.clave==="CARGOS")&&ajenasFinal<=3);
 const valida=(finales.has("cantidad")&&(finales.has("descripcion")||finales.has("referencia"))&&finales.size>=3&&ajenasFinal<=3)||servicios;
 return {valida,...(servicios?{servicios:true}:{}),...(conBase?{conBase:true}:{}),columnas:columnas.sort((a,b)=>a.x0-b.x0),ajenas:ajenasFinal};
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
  // Si el renglón siguiente ya es una cabecera por sí solo, el actual es un título ajeno («ALBARÁN»).
  if(sig&&sig.y-lineas[i].y<2.2*lineas[i].alto&&!evaluarCabecera(sig.celdas).valida){
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
 // «P.V.P.» y «PRECIO NETO» en la misma tabla: el precio de la línea es el neto (el otro es la tarifa, sin el descuento).
 const netos=orden.filter(c=>c.campo==="precio"&&/NETO/.test(c.clave||""));
 if(netos.length===1)for(const c of orden)if(c.campo==="precio"&&c!==netos[0])c.campo="otra";
 const usados=new Map();
 return orden.map((c,i)=>{
  const ini=i===0?-Infinity:(orden[i-1].x1+c.x0)/2;
  const fin=i===orden.length-1?Infinity:(c.x1+orden[i+1].x0)/2;
  // Columnas repetidas: una segunda de descuento se suma en cascada; las demás se ignoran.
  const veces=usados.get(c.campo)||0;usados.set(c.campo,veces+1);
  const campo=!veces||c.campo==="otra"?c.campo:c.campo==="descuento"&&veces===1?"descuento2":"otra";
  return {campo,clave:c.clave,ini,fin,x0:c.x0,x1:c.x1};
 });
}
// «(4,00)» es un número negativo; «100)» suelto es texto (p. ej. «(BOLSA 100)»).
// Solo unidades conocidas: «2op» (manuscrito leído por el OCR) no es «2 op».
const UNIDADES="UD|UDS|UN|UNI|UND|UNDS|U|M|ML|MT|MTS|M2|M3|KG|KGS|G|GR|L|LT|LTS|SAC|SACO|SACOS|PZ|PZA|PZAS|PCE|PCS|PAQ|CJ|CAJ|CAJA|CAJAS|ROL|RL|BOL|BL|H|HR|HRS|TN|T|PAR|JGO|JG|BID|PAL|PLT|BAR|ENV|MIL|CT|CTO";
// Tras la unidad puede quedar pegada la raya de la tabla leída como «j», «l», «I» o «!» («1,00 Cajaj»).
// La unidad admite mayúsculas y minúsculas, pero el resto de raya NO: «2,00 mi» no es «2,00 m»
// (es un «ml» mal leído); por eso no se usa el indicador «i» en toda la expresión.
const UNIDADES_AMBOS=UNIDADES.split("|").map(u=>u.split("").map(c=>/[A-Z]/.test(c)?"["+c+c.toLowerCase()+"]":c).join("")).join("|");
const RE_CANTIDAD_UNIDAD=new RegExp("^([-−]?[\\d.,]+)\\s*(("+UNIDADES_AMBOS+")\\.?)[|jI!\\]]?$");
const RE_UNIDAD_SOLA=new RegExp("^(("+UNIDADES_AMBOS+")\\.?)$");
// Con el símbolo «€» delante o detrás («12,34 €», «€23.45»: facturas de 2026-11-25, el precio y el importe acababan pegados a la
// descripción) también es una cifra; con la palabra «EUR», no (2026-11-25: «12,00 EUR» con los descuentos en cascada «40,00-%20,00-%…»,
// que aún no se leen, dejaba la línea sin cuadrar).
const pareceCifraSola=t=>/^(\(\s*[\d.,]+\s*\)|[-−+]?\s*[\d.,]+\s*(\+\s*[\d.,]+\s*)*[−-]?\s*%?)$/.test(String(t).trim());
const pareceNumero=t=>pareceCifraSola(String(t).trim().replace(/^€\s?(?=[-−+]?\d)|(?<=\d)\s?€$/,""));
// Solo para OCR (celdas con confianza): menos del 40 % de los caracteres con confianza ≥ 50
// (la escritura a mano sale casi siempre por debajo de 40; el impreso borroso, entre 50 y 70).
function esManuscrita(linea){
 const celdas=linea.celdas.filter(c=>c.conf!=null);
 if(!celdas.length||celdas.length<linea.celdas.length)return false;
 // Una cifra bien formada no se descarta nunca: la línea sigue y, si es dudosa, queda en revisión.
 if(celdas.some(c=>/\d,\d/.test(c.texto)&&c.conf>=40))return false;
 const largo=c=>String(c.texto).replace(/\s/g,"").length;
 const total=celdas.reduce((n,c)=>n+largo(c),0);
 const buenos=celdas.filter(c=>c.conf>=50).reduce((n,c)=>n+largo(c),0);
 return total>=3?buenos/total<0.4:celdas.every(c=>c.conf<60);
}
function columnaDe(celda,cols){
 const x=pareceNumero(celda.texto)?(celda.x0+celda.x1)/2:celda.x0+0.01;
 return cols.find(c=>x>=c.ini&&x<c.fin)||null;
}

/* --------------------------- Etiquetas de cabecera -------------------------- */
// «Nº de Albarán» con el «º» leído «*» o «?» por el OCR (fallo real 2026-11-23: «N* de Albarán» sin número).
const RE_NUMERO=/^(N[ºO°*?]?\s?(DE\s)?ALBARAN|NUM(ERO)?\s(DE\s)?ALBARAN|ALBARAN(\s(DE\s)?(ENTREGA|VENTA|SALIDA))?(\sN[ºO°]?)?|N[ºO°]\s?DOC(UMENTO)?|NUM(ERO)?\sDOC(UMENTO)?|DOCUMENTO)(\b|$)/;
const EXCLUIR_NUMERO=/CLIENTE|PEDIDO|PROVEEDOR|TELEF|FAX|PAGINA|OBRA|CIF|NIF|FACTURA|PRESUPUESTO|CUENTA|IBAN/;
const RE_FECHA=/^(FECHA(\s(ALBARAN|DOCUMENTO|EMISION|DE\sEMISION|EXPEDICION|DEL\sALBARAN))?|F\sEMISION)(\b|$)/;
// «Fecha Venc.», «F. Vto.» (factura real 2026-11-24: la fecha de vencimiento de una tabla al pie se aceptaba como la de la factura).
const EXCLUIR_FECHA=/ENTREGA|VENCIMIENTO|\bVENC\b|\bVTO\b|\bVCTO\b|PEDIDO|NACIMIENTO|CADUCIDAD|PREVISTA|SERVICIO|PAGO/;
// Quita separadores y restos de etiqueta («º 77812», «Nº: 123», «nº. 45»).
// También la raya larga («Factura #— AB202611-12345», 2026-11-25).
const limpiarValor=v=>String(v||"").replace(/^[\s:#\-–—.º°]+/,"").replace(/^N[ºo°O]?\.?(?=[\s:.]|$)/i,"").replace(/^[\s:#\-–—.º°]+/,"").trim();

// huecoDerecha (en altos de la etiqueta): el valor a la derecha ha de estar a esa distancia como mucho (otra columna no vale).
// unirDerecha: debajo de la etiqueta, si la celda más próxima no vale, se prueba unida a la celda pegada a su derecha.
/*
 * Matrícula del vehículo bajo (o junto a) la etiqueta «Matrícula» de la cabecera (factura de taller, 2026-11-26): solo con la forma de
 * las matrículas actuales (4 cifras y 3 consonantes, o con la «E» de vehículo especial); con poca confianza OCR, en revisión.
 */
function matriculaDeCabecera(lineas){
 const RE=/^(E-?)?(\d{4})[\s-]?([BCDFGHJKLMNPRSTVWXYZ]{3})$/;
 for(const [i,l] of lineas.entries())for(const c of l.celdas||[]){
  if(clave(c.texto||"").replace(/[^A-Z]/g,"")!=="MATRICULA")continue;
  const alto=c.alto||l.alto||10;
  const cands=[...(l.celdas||[]).filter(d=>d.x0>c.x1&&d.x0-c.x1<4*alto).slice(0,1),
   ...lineas.slice(i+1,i+4).filter(m=>m.y-l.y<=4*alto).flatMap(m=>(m.celdas||[]).filter(d=>Math.min(d.x1,c.x1)-Math.max(d.x0,c.x0)>0))];
  for(const d of cands){
   const m=String(d.texto||"").trim().toUpperCase().match(RE);
   if(m)return {literal:d.texto,valor:(m[1]?"E":"")+m[2]+m[3],estado:d.conf==null||d.conf>=80?"OK":"REVISAR",motivos:d.conf==null||d.conf>=80?[]:["Matrícula leída con poca confianza OCR"],caja:caja(d)};
  }
 }
 // Sin la etiqueta leída (escaneo: «Matrícula» en blanco sobre una banda oscura), en una cabecera de taller («Bastidor», «Kilómetros»):
 // la ÚNICA casilla con forma de matrícula de la página.
 const taller=lineas.some(l=>(l.celdas||[]).some(c=>/^(BASTIDOR|KILOMETROS|KMS)$/.test(clave(c.texto||"").replace(/[^A-Z]/g,""))));
 if(taller){
  const halladas=[];
  for(const l of lineas)for(const d of l.celdas||[]){const m=String(d.texto||"").trim().toUpperCase().match(RE);if(m)halladas.push({d,v:(m[1]?"E":"")+m[2]+m[3]});}
  if(halladas.length&&halladas.every(h=>h.v===halladas[0].v)){
   const {d,v}=halladas[0],ok=d.conf==null||d.conf>=80;
   return {literal:d.texto,valor:v,estado:ok?"OK":"REVISAR",motivos:ok?[]:["Matrícula leída con poca confianza OCR"],notas:["Única matrícula de la cabecera de un taller (sin la etiqueta leída)"],caja:caja(d)};
  }
 }
 return null;
}
function valoresEtiquetados(lineas,reEtiqueta,reExcluir,aceptar,{huecoDerecha=Infinity,unirDerecha=false,parClaveValor=false}={}){
 const hallados=[];
 lineas.forEach((linea,li)=>linea.celdas.forEach((celda,ci)=>{
  const k=N().sinAcentos(celda.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
  const m=k.match(reEtiqueta);
  if(!m||reExcluir.test(k))return;
  const candidatos=[];
  const resto=limpiarValor(celda.texto.slice(Math.min(celda.texto.length,m[0].length)));
  if(resto)candidatos.push({texto:resto,celda});
  // A la derecha, saltando restos de la etiqueta («N.», «Nº», «:»).
  // Sin el resto de la etiqueta que el OCR deja en su propia celda («Nº» leído «N?», «No»; fallo real 2026-11-12: «Albarán | N? |
  // 1009999999» se quedaba sin número).
  const derecha=linea.celdas.slice(ci+1).filter(c=>c.x0>=celda.x1-1&&c.x0-celda.x1<=huecoDerecha*(celda.alto||10)).find(c=>limpiarValor(c.texto)&&!/^N[ºo°O]?[^A-Za-z0-9]?$/i.test(c.texto.trim()));
  if(derecha)candidatos.push({texto:limpiarValor(derecha.texto),celda:derecha});
  // Renglón «etiqueta | valor» a dos columnas (factura real 2026-11-24: el número a 9 alturas de su etiqueta): con parClaveValor, la
  // ÚNICA celda con texto a la derecha de la etiqueta en su renglón, aunque esté lejos (lo demás lo decide «aceptar»).
  // Con varias (2026-11-25: «Factura | 1100000111 | CLIENTE, S.L.», la otra es la columna del cliente), la primera si
  // es la columna de valores de un bloque «etiqueta | valor»: en un renglón cercano, otra etiqueta en la misma x con su valor en la
  // misma x («Fecha | 15.10.2026»). Nunca el código postal de la dirección de al lado («FACTURA | 24999 | POBLACIÓN»).
  else if(parClaveValor){const der=linea.celdas.slice(ci+1).filter(c=>c.x0>=celda.x1-1&&limpiarValor(c.texto));
   const bloque=v=>lineas.slice(Math.max(0,li-3),li+4).some(l2=>l2!==linea&&l2.celdas.some((x,xi)=>xi>0&&Math.abs(x.x0-v.x0)<=3&&Math.abs(l2.celdas[xi-1].x0-celda.x0)<=5));
   if(der.length===1||(der.length>1&&bloque(der[0])))candidatos.push({texto:limpiarValor(der[0].texto),celda:der[0]});}
  // El OCR puede partir la fila de valores en varias líneas (bases distintas): se miran hasta
  // tres líneas y se sigue bajando si la celda hallada no tiene forma de valor válido.
  for(const abajo of lineas.slice(li+1,li+4)){
   if(abajo.y-linea.y>3.2*linea.alto)break;
   // El valor de la casilla: la celda inferior más próxima en horizontal (puede estar
   // centrada, alineada a la izquierda o a la derecha de su etiqueta).
   const centro=(celda.x0+celda.x1)/2,anchoEt=celda.x1-celda.x0;
   // Distancia: hueco horizontal entre ambas cajas (0 si se solapan); a igualdad, la más centrada.
   const c=[...abajo.celdas].map(c=>({c,d:Math.max(0,c.x0-celda.x1,celda.x0-c.x1),dc:Math.abs((c.x0+c.x1)/2-centro)}))
    .filter(x=>x.d<=Math.max(anchoEt,2*celda.alto)).sort((a,b)=>a.d-b.d||a.dc-b.dc)[0]?.c;
   if(c){candidatos.push({texto:limpiarValor(c.texto),celda:c});if(aceptar(limpiarValor(c.texto)))break;}
   // Serie y número en dos celdas («SERIE» | «2600001», fallo real 2026-11-18): con unirDerecha, la celda pegada a su derecha.
   if(c&&unirDerecha){
    const sig=abajo.celdas.filter(x=>x!==c&&x.x0>=c.x1-1&&x.x0-c.x1<=2*(c.alto||celda.alto||10)).sort((a,b)=>a.x0-b.x0)[0];
    const junto=sig&&limpiarValor(c.texto+" "+sig.texto);
    if(junto){candidatos.push({texto:junto,celda:{...c,texto:c.texto+" "+sig.texto,x1:sig.x1}});if(aceptar(junto))break;}
   }
  }
  const valido=candidatos.find(c=>aceptar(c.texto));
  // La casilla de la etiqueta y su renglón (para saber si encabeza una columna de la tabla).
  if(valido)hallados.push({...valido,etiqueta:celda.texto,celdaEtiqueta:celda,indiceLinea:li});
 }));
 return hallados;
}

// Etiqueta genérica («Nº:», «Número:») solo si no hay ninguna que diga «albarán».
// «№» (el signo de número) pegado a las cifras («№.12345678901», factura de 2026-11-25) también; nunca «№ de envío» ni «№ cliente».
const RE_NUMERO_GENERICO=/^(N[ºO°]|NUM|NUMERO)(\b|$)|^№(?= ?\d)/;
const EXCLUIR_GENERICO=/CLIENTE|PEDIDO|PROVEEDOR|TELEF|TLF|FAX|PAGINA|PAG|OBRA|CIF|NIF|FACTURA|PRESUPUESTO|CUENTA|IBAN|SERIE|LOTE|BULTOS|MATRICULA|REGISTRO|TOMO|FOLIO|HOJA|INSCRIPCION/;
function leerNumero(lineas){
 const r={literal:"",valor:null,estado:"VACIO",motivos:[],notas:[],caja:null};
 // Prueba real 2026-10-28: un número impreso con coma («600,111», ficticio) se leía «600». La coma solo se
 // admite entre cifras; el formato del proveedor decide después (extraerDePaginas).
 const aceptar=t=>(/^[A-Z0-9][A-Z0-9\/\-.]{2,24}$/i.test(t)||/^\d{1,3}(,\d{3})+$/.test(t))&&/\d/.test(t)&&N().fecha(t).estado!=="OK";
 let hallados=valoresEtiquetados(lineas,RE_NUMERO,EXCLUIR_NUMERO,aceptar);
 if(!hallados.length){
  hallados=valoresEtiquetados(lineas,RE_NUMERO_GENERICO,EXCLUIR_GENERICO,aceptar);
  if(hallados.length)r.notas.push("Número tomado de una etiqueta genérica («Nº»/«Número»)");
 }
 // El OCR separa «2026 /1234» en celdas: aceptar solo «2026» confundiría
 // la serie/año con el número. Unir únicamente el sufijo impreso contiguo.
 hallados=hallados.map(h=>{
  if(!/^\d{2,4}$/.test(h.texto))return h;
  const linea=lineas.find(l=>l.celdas.includes(h.celda)),i=linea?.celdas.indexOf(h.celda);
  const siguiente=linea?.celdas[i+1];
  if(!siguiente||!/^(\/\s*\d{2,10}|[.,]\d{3})$/.test(siguiente.texto.trim())||
     siguiente.x0-h.celda.x1>3*h.celda.alto)return h;
  return {...h,texto:h.texto+siguiente.texto.replace(/\s/g,""),
   celda:{...h.celda,x1:siguiente.x1,conf:h.celda.conf==null?siguiente.conf:
    siguiente.conf==null?h.celda.conf:Math.min(h.celda.conf,siguiente.conf)}};
 });
 const distintos=[...new Map(hallados.map(h=>[N().canon(h.texto),h])).values()];
 if(!distintos.length){r.motivos.push("No se encontró el número de albarán junto a su etiqueta");return r;}
 if(distintos.length>1){
  r.estado="AMBIGUO";r.literal=distintos.map(h=>h.texto).join(" | ");
  r.motivos.push("Varios números etiquetados: "+r.literal);return r;
 }
 r.literal=distintos[0].texto;r.valor=distintos[0].texto;r.estado="OK";r.caja=caja(distintos[0].celda);r.conf_ocr=distintos[0].celda?.conf??null;
 return r;
}

/*
 * Número por el formato del proveedor. Candidatos: celdas (o pares de palabras, «2026 /1234»)
 * que cumplen el formato. Si el número leído junto a su etiqueta era la serie («AB26»), se
 * prefiere el candidato de su misma línea. Con «numero_sin_etiqueta», una fecha en la misma
 * línea, justo a la derecha del número, es la fecha del albarán.
 */
function numeroPorFormato(pagina,perfil,leido,opcionesFecha){
 const re=new RegExp(perfil.formato_numero);
 const candidatos=[];
 for(const l of pagina.lineas){
  const palabras=l.celdas.flatMap(c=>String(c.texto).split(/\s+/).map((t,i,a)=>({t,c})));
  palabras.forEach((w,i)=>{
   for(const t of [w.t,i+1<palabras.length?w.t+" "+palabras[i+1].t:null,i+1<palabras.length?w.t+palabras[i+1].t:null]){
    const v=limpiarValor(t||"");
    if(t&&re.test(v)&&N().fecha(v).estado!=="OK")candidatos.push({valor:v,linea:l,celda:w.c});
   }
  });
 }
 const enLinea=leido?.caja?candidatos.filter(c=>Math.abs(c.linea.y-leido.caja[1])<=1.2*c.linea.alto):[];
 // Bajo un título «ALBARÁN» con una letra mal leída («SLBARÁN», fallo real 2026-11-26: albarán de mostrador con la casilla «CLIENTE | ALBARÁN |
 // FECHA» al pie; sin etiqueta reconocida, el número salía del código postal del cliente bajo «NO UTILIZAR»). Solo con el formato del
 // proveedor y un único valor con ese formato en la casilla de debajo (como mucho tres renglones).
 const etiquetas=pagina.lineas.flatMap(l=>l.celdas.filter(c=>{const k=N().sinAcentos(String(c.texto)).toUpperCase().replace(/[^A-Z]/g,"");
  return k.length>=6&&k.length<=8&&distancia1(k,"ALBARAN")===1;}).map(c=>({c,l})));
 const bajoEtiqueta=candidatos.filter(x=>etiquetas.some(({c,l})=>{const dy=x.linea.y-l.y,ancho=c.x1-c.x0,cx=(x.celda.x0+x.celda.x1)/2;
  return dy>0&&dy<=3.2*(l.alto||10)&&cx>=c.x0-ancho&&cx<=c.x1+ancho;}));
 const unicos=x=>[...new Map(x.map(c=>[c.valor.replace(/\s+/g,""),c])).values()];
 const elegidos=unicos(enLinea.length?enLinea:bajoEtiqueta.length?bajoEtiqueta:(perfil.numero_sin_etiqueta?candidatos:[]));
 if(elegidos.length!==1)return null;
 const c=elegidos[0];
 const etiquetaLeida=!enLinea.length&&bajoEtiqueta.length?etiquetas.find(({c:e,l})=>bajoEtiqueta.includes(c)&&c.linea.y>l.y)?.c.texto:null;
 const metodo=enLinea.length?"tras la serie impresa junto a la etiqueta («"+leido.literal+"»)":
  etiquetaLeida?"bajo la etiqueta «"+etiquetaLeida+"» (ALBARÁN con una letra mal leída): único valor con el formato del proveedor":
  "sin etiqueta: único valor con el formato del proveedor";
 const numero={literal:c.valor,valor:c.valor.replace(/\s*\/\s*/g,"/"),estado:"OK",motivos:[],notas:["Número "+metodo],caja:caja(c.celda),conf_ocr:c.celda.conf??null,
  resolucion:{metodo:"formato_proveedor",evidencias:["Formato "+perfil.formato_numero,metodo]}};
 let fecha=null;
 if(perfil.numero_sin_etiqueta){
  const derecha=c.linea.celdas.filter(x=>x.x0>=c.celda.x0).flatMap(x=>String(x.texto).split(/\s+/).map(t=>({t,x})));
  const hallada=derecha.map(({t,x})=>({f:N().fecha(t,opcionesFecha),x})).find(({f})=>f.estado==="OK");
  const f=hallada?.f,celdaF=hallada?.x;
  if(f)fecha={...f,motivos:[],notas:["Fecha impresa junto al número de albarán (formato del proveedor sin etiquetas)"],caja:caja(celdaF),conf_ocr:celdaF.conf??null,
   resolucion:{metodo:"posicion_formato_proveedor",evidencias:["Misma línea que el número «"+c.valor+"»"]}};
 }
 return {numero,fecha};
}

function leerFecha(lineas,opciones){
 const F=N().fecha;
 const r={literal:"",valor:null,estado:"VACIO",motivos:[],notas:[],caja:null};
 const factura=!!opciones.factura;
 // Factura (banco de facturas, 2026-11-25): «31/03/2026 09:42» tras «Fecha/Hora doc.» es una fecha con su hora.
 const sinHora=t=>factura?String(t||"").replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/,""):t;
 // Se aceptan también fechas con forma de fecha pero inexistentes (31/02): quedan INVALIDO.
 let hallados=valoresEtiquetados(lineas,RE_FECHA,EXCLUIR_FECHA,
  t=>{t=sinHora(t);return /\d/.test(t)&&(F(t,opciones).estado==="OK"||/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(t));});
 // Factura: la fecha de un albarán que cita («Fecha albarán: …», un renglón que empieza por «Albarán …») o la de recepción (taller:
 // «Fecha recepción» del vehículo) nunca es la suya (banco de facturas, 2026-11-25: se aceptaban); «DE FECHA» («Nº FACTURA/CARTA DE
 // FECHA», pegado «DEFECHA») también es su etiqueta.
 const claveF=t=>N().sinAcentos(String(t||"")).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
 // «Alb nº 1XXX / 111 | REF. S/PEDIDO | de fecha | 20/02/2026» (abreviado): también es un albarán citado.
 const filaDeAlbaran=l=>/^ALB(ARAN)?\b/.test(claveF(l?.celdas?.[0]?.texto));
 // Etiqueta partida en dos renglones con la fecha debajo («Fecha de | Envio:», factura de 2026-11-25: la fecha de envío competía
 // con la de la factura): el trozo de debajo, en la misma columna, la completa y cuenta para sus exclusiones.
 const etiquetaCompleta=h=>{
  const et=h.celdaEtiqueta,l=lineas[h.indiceLinea];
  if(!et||!l||!/ DE$/.test(claveF(et.texto))||h.celda?.y==null||h.celda.y-l.y<=0.5*(l.alto||10))return claveF(h.etiqueta);
  const sig=lineas[h.indiceLinea+1];
  if(!sig||sig.y-l.y>1.6*(l.alto||10)||sig.celdas.includes(h.celda))return claveF(h.etiqueta);
  const debajo=sig.celdas.find(c=>Math.min(c.x1,et.x1)-Math.max(c.x0,et.x0)>0);
  return claveF(et.texto+" "+(debajo?.texto||""));
 };
 hallados=hallados.filter(h=>{const t=etiquetaCompleta(h);return !EXCLUIR_FECHA.test(t)&&!(factura&&/ENVIO/.test(t));});
 if(factura){
  // «DE FECHA» solo en el renglón de la factura («Nº FACTURA/CARTA | DE FECHA»).
  hallados.push(...valoresEtiquetados(lineas,/^DE ?FECHA$/,EXCLUIR_FECHA,t=>F(sinHora(t),opciones).estado==="OK")
   .filter(h=>/FACTURA/.test(claveF(lineas[h.indiceLinea]?.texto))));
  hallados=hallados.filter(h=>!/ALBARAN|RECEP|MATRICULA|\bEST\b/.test(claveF(h.etiqueta))&&!filaDeAlbaran(lineas[h.indiceLinea])).map(h=>({...h,texto:sinHora(h.texto)}));
 }
 // «FECHA» que encabeza una columna con dos o más fechas distintas en los renglones de debajo, alineadas (fallo real 2026-11-23:
 // factura de una gestoría con «FECHA | DESCRIPCION | CARGOS» y la fecha de cada cargo; la primera se tomaba como la de la factura):
 // es la fecha de cada línea, no la del documento.
 const encabezaColumna=h=>{
  const et=h.celdaEtiqueta;if(!et||h.indiceLinea==null)return false;
  const alto=et.alto||10,fechas=new Map(),enColumna=c=>c.x1>=et.x0-2*alto&&c.x0<=et.x1+2*alto;
  for(const l of lineas.slice(h.indiceLinea+1,h.indiceLinea+5)){
   // Otra etiqueta de fecha en la columna («FECHA ENTREGA»): lo de debajo es de ella, no una columna de fechas.
   if(l.celdas.some(c=>enColumna(c)&&RE_FECHA.test(N().sinAcentos(c.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim())))break;
   for(const c of l.celdas){
    if(!enColumna(c))continue;
    const f=F(c.texto,opciones);if(f.estado==="OK"&&!fechas.has(f.valor))fechas.set(f.valor,c.x0);
   }
  }
  const xs=[...fechas.values()];
  return xs.length>=2&&Math.max(...xs)-Math.min(...xs)<=alto;
 };
 hallados=hallados.filter(h=>!encabezaColumna(h));
 let etiquetada=true;
 if(!hallados.length){
  etiquetada=false;
  hallados=[];
  for(const l of lineas)for(const [i,c] of l.celdas.entries()){
   const f=F(sinHora(c.texto),opciones);
   // Factura: tampoco sin etiqueta la de un albarán citado, ni la que lleva a su izquierda otra etiqueta de fecha (vencimiento…).
   if(factura&&(filaDeAlbaran(l)||(i>0&&/ALBARAN|RECEP|MATRICULA|\bEST\b/.test(claveF(l.celdas[i-1].texto))||(i>0&&RE_FECHA.test(claveF(l.celdas[i-1].texto))&&EXCLUIR_FECHA.test(claveF(l.celdas[i-1].texto))))))continue;
   if(f.estado==="OK")hallados.push({texto:sinHora(c.texto),celda:c});
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
 // Una fecha sin etiqueta puede ser la de pedido o entrega: se propone, no se acepta. Excepción:
 // la única fecha va en la misma línea que el rótulo del albarán («ALBARÁN CARGO 16/10/2026»).
 const lineaFecha=lineas.find(l=>l.celdas.includes(distintos[0].celda));
 const celdaF=distintos[0].celda;
 const junto=lineaFecha&&lineaFecha.celdas.some(c=>{
  const k=N().sinAcentos(c.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
  // Título del documento sin cifras («ALBARÁN CARGO») y la fecha pegada a su derecha.
  return /^ALBARAN( [A-Z]+)?$/.test(k)&&celdaF.x0>=c.x1&&celdaF.x0-c.x1<=Math.max(c.x1-c.x0,4*c.alto)||
   // Factura: el título «FACTURA» y, en su renglón, la única fecha (2026-11-25: «FACTURA | 30/06/2026 | 2000 | Página 1 de 1»).
   factura&&/^FACTURA( N\S{0,3})?$/.test(k)&&celdaF.x0>=c.x1;
 });
 if(!etiquetada&&f.estado==="OK"&&junto)r.notas.push(factura?"Fecha en la misma línea que el título de la factura":"Fecha en la misma línea que el rótulo del albarán");
 else if(!etiquetada&&f.estado==="OK"){r.estado="REVISAR";r.motivos.push("Fecha sin etiqueta «Fecha»: es la única fecha del encabezado, pero no se acepta automáticamente");}
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
/*
 * ¿El CIF está impreso junto al nombre del proveedor (debajo o al lado, como en su membrete) o en
 * el texto legal del pie («Inscrita en el Registro Mercantil… C.I.F.»)? Sin NIF en el registro es
 * la única forma de no confundirlo con el CIF del cliente (DAFRICA), impreso en otro recuadro.
 */
function cifJuntoAlNombre(pagina,perfil,elegido){
 if(!pagina||!elegido.caja)return false;
 const [ex0,ey,ex1]=elegido.caja;
 const nombres=[perfil.nombre,...(perfil.nombres||[])].map(n=>N().canon(n).replace(/(SLU|SAU|SL|SA)$/,"")).filter(n=>n.length>=5);
 for(const l of pagina.lineas){
  const t=N().canon(l.texto);
  const esLegal=/(REGISTRO|INSCRITA|MERCANTIL)/.test(t)&&NIF().buscar(l.texto).some(n=>n.nif===elegido.nif);
  if(esLegal)return true;
  // El nombre puede venir en varias celdas («PROVEEDOR» «FICTICIO, S.L.»): se busca en la línea.
  // Caja: solo las celdas consecutivas que forman el nombre (no el resto de la línea).
  let caja=null;
  for(let i=0;i<l.celdas.length&&!caja;i++){
   let t="";
   for(let j=i;j<l.celdas.length&&j<i+5;j++){
    t+=N().canon(l.celdas[j].texto);
    if(nombres.some(n=>t.includes(n.slice(0,Math.min(n.length,12))))){caja=[l.celdas[i].x0,l.celdas[j].x1];break;}
   }
  }
  if(!caja)continue;
  const [cx0,cx1]=caja;
  const alto=l.alto||8,dy=ey-l.y;
  const solapeX=Math.min(ex1,cx1+0.15*pagina.ancho)-Math.max(ex0,cx0-0.15*pagina.ancho);
  if(dy>=-2*alto&&dy<=7*alto&&solapeX>0)return true;
 }
 return false;
}
function identificarProveedor(paginas,registro,limiteCabecera=null){
 const propios=new Set((registro.empresa_propia?.nifs||[]).map(n=>NIF().normalizar(n)));
 // NIF de DAFRICA en claro (pruebas, otras lecturas) o por su huella (perfiles públicos).
 const esPropioNif=n=>propios.has(n)||PROV().esPropio(n,registro);
 const hayPropios=propios.size>0||(registro.empresa_propia?.huellas_nif||[]).length>0;
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
    const propio=hayPropios?esPropioNif(n.nif):(nombrePropio||etiquetaCliente);
    const enCabecera=pagina.numero===paginas[0].numero&&linea.y<(limiteCabecera??0.3*pagina.alto);
    encontrados.push({nif:n.nif,literal:n.literal,pagina:pagina.numero,caja:caja(celda),conf:celda.conf??null,propio,enCabecera,
     motivo_propio:esPropioNif(n.nif)?"NIF de la empresa propia":nombrePropio?"Junto al nombre de DAFRICA":etiquetaCliente?"En el bloque del cliente/destinatario":""});
   };
   for(const celda of linea.celdas)for(const n of NIF().buscar(celda.texto))registrar(n,celda);
   for(const n of NIF().buscar(linea.texto))registrar(n,linea.celdas[0]);
  });
  // Aviso legal girado del margen (fuera de las líneas de la página): solo aporta su CIF, sin
  // contexto de posición (ni cabecera ni recuadro del cliente). DAFRICA se reconoce por su NIF.
  for(const linea of pagina.lineas_giradas||[]){
   const vistos=new Set();
   for(const celda of linea.celdas)for(const n of [...NIF().buscar(celda.texto),...NIF().buscar(linea.texto)]){
    if(vistos.has(n.nif))continue;vistos.add(n.nif);
    encontrados.push({nif:n.nif,literal:n.literal,pagina:pagina.numero,caja:caja(celda),conf:celda.conf??null,propio:esPropioNif(n.nif),enCabecera:false,girado:true,
     motivo_propio:esPropioNif(n.nif)?"NIF de la empresa propia":""});
   }
  }
 }
 const r={nif:null,id:null,nombre:null,estado:"VACIO",motivos:[],notas:[],candidatos:[],nif_propio_detectado:null,caja:null};
 const propio=encontrados.find(e=>e.propio);
 if(propio)r.nif_propio_detectado=propio.nif;
 let ajenos=[...new Map(encontrados.filter(e=>!e.propio).map(e=>[e.nif,e])).values()];
 // Un NIF personal (DNI/NIE) dentro de la tabla o en una anotación («Retirado por … NIF: …»)
 // es de quien recoge el material, no del emisor. Solo se considera si está en el encabezado
 // y no hay ningún CIF de empresa.
 const esPersona=e=>/^(\d{8}[A-Z]|[XYZKLM]\d{7}[A-Z])$/.test(e.nif);
 const descartadas=ajenos.filter(e=>esPersona(e)&&(!e.enCabecera||ajenos.some(x=>!esPersona(x))));
 if(descartadas.length){r.notas.push("NIF personales descartados como emisor: "+descartadas.map(e=>e.nif).join(", "));ajenos=ajenos.filter(e=>!descartadas.includes(e));}
 r.candidatos=ajenos.map(e=>e.nif);
 // Nombres de proveedores registrados impresos en la primera página.
 const textoPagina=N().canon(paginas[0]?.lineas.map(l=>l.texto).join(" ")||"");
 // Nombres registrados: el fiscal y, si los tiene, otros impresos («nombres»: marca, logotipo).
 const porNombre=(registro.proveedores||[]).filter(pr=>[pr.nombre,...(pr.nombres||[])].some(nombre=>{
  const n=N().canon(nombre).replace(/(SLU|SAU|SL|SA)$/,"");
  return n.length>=8&&textoPagina.includes(n);
 }));
 if(!ajenos.length){
  if(porNombre.length===1&&PROV().tieneIdentificador(porNombre[0])){
   // El CIF impreso no se ha podido leer (OCR): se identifica por el nombre registrado.
   const pr=porNombre[0];
   // Con solo la huella del NIF no se puede escribir el CIF: proveedor identificado, NIF a revisar.
   if((pr.nifs||[]).length!==1){
    Object.assign(r,{nif:null,id:pr.id,nombre:pr.nombre,estado:"REVISAR",via:"nombre_registrado",
     motivos:["CIF impreso no legible: proveedor identificado por su nombre; el CIF debe completarse"]});
    return r;
   }
   Object.assign(r,{nif:pr.nifs[0],id:pr.id,nombre:pr.nombre,estado:"OK",via:"nombre_registrado",
    notas:["CIF impreso no legible: proveedor identificado por su nombre registrado; el CIF procede del registro"]});
   return r;
  }
  // Proveedor de otro país (facturas de suscripciones de otros países de la UE, 2026-11-26: «IE VAT IE…», «Número de registro de IVA:
  // IE…»): su NIF-IVA, en un renglón con una etiqueta de IVA de la primera página, si es UNO. Sin letra de control: queda por
  // comprobar (NIF_NO_REGISTRADO) y solo se identifica si está exacto y una sola vez en el catálogo de STEL (verificacion.js).
  const ue=[...new Set((paginas[0]?.lineas||[]).filter(l=>/\b(VAT|IVA|TVA|UST|BTW|NIF|TAX ?ID)\b/.test(clave(l.texto)))
   .flatMap(l=>NIF().buscarIntracomunitario?NIF().buscarIntracomunitario(l.texto).map(x=>x.nif):[]))];
  if(ue.length===1){
   Object.assign(r,{nif:ue[0],estado:"NIF_NO_REGISTRADO",via:"iva_intracomunitario",intracomunitario:true,candidatos:ue,
    motivos:["NIF-IVA de otro país ("+ue[0]+"): el proveedor se busca por él en el catálogo de STEL"]});
   return r;
  }
  if(ue.length>1){r.estado="AMBIGUO";r.motivos.push("Varios NIF-IVA de otros países: "+ue.join(", "));return r;}
  r.motivos.push(propio?"Solo aparece el NIF del destinatario (DAFRICA): el emisor no se puede identificar":"No aparece ningún NIF/CIF válido del emisor");
  return r;
 }
 let elegido=ajenos.length===1?ajenos[0]:null;
 if(!elegido){
  // El emisor figura sobre la tabla de la primera página. Que un NIF esté
  // registrado NO decide (un transportista también puede ser proveedor).
  const arriba=ajenos.filter(e=>e.enCabecera);
  // Varios en el encabezado: el que está junto al nombre impreso del proveedor (su membrete).
  const junto=porNombre.length===1?arriba.filter(e=>cifJuntoAlNombre(paginas[0],porNombre[0],e)):[];
  if(arriba.length>1&&junto.length===1){elegido=junto[0];r.notas.push("CIF elegido por estar junto al nombre del proveedor; otros NIF: "+ajenos.filter(e=>e!==elegido).map(e=>e.nif).join(", "));}
  else if(arriba.length===1){elegido=arriba[0];r.notas.push("Otros NIF fuera del encabezado: "+ajenos.filter(e=>e!==elegido).map(e=>e.nif).join(", "));}
  else{r.estado="AMBIGUO";r.motivos.push("Varios NIF posibles del emisor: "+r.candidatos.join(", "));return r;}
 }
 r.nif=elegido.nif;r.caja=elegido.caja;r.conf_ocr=elegido.conf??null;
 const ficha=PROV().buscarPorNif(elegido.nif,registro);
 // Un CIF válido que contradice el nombre registrado impreso: no se decide.
 // Contradicción: el CIF es de otro proveedor, o el perfil tiene su NIF (o huella) y no es este.
 if(porNombre.length===1&&((ficha&&ficha.id!==porNombre[0].id)||(!ficha&&PROV().tieneIdentificador(porNombre[0])))){
  r.estado="AMBIGUO";r.nif=null;r.motivos.push("El CIF leído ("+elegido.nif+") no corresponde al proveedor cuyo nombre aparece impreso ("+porNombre[0].nombre+")");
  return r;
 }
 if(ficha){r.id=ficha.id;r.nombre=ficha.nombre;r.estado="OK";r.via="nif";}
 else{
  r.estado="NIF_NO_REGISTRADO";
  // Un perfil público sin NIF no contradice el CIF impreso. Permite leer su
  // formato de tabla/número, pero NO verifica la identidad ni permite AUTO_OK.
  if(porNombre.length===1){r.id=porNombre[0].id;r.nombre=porNombre[0].nombre;r.via="perfil_nombre_no_verificado";}
  r.motivos.push("NIF "+elegido.nif+" leído correctamente pero no registrado como proveedor");
 }
 return r;
}

/* ---------------------------------- Tabla ---------------------------------- */
const RE_PIE=/^(TOTAL(ES)?|PESO (BRUTO|NETO|TOTAL)|SUMA|BASE IMPONIBLE|BASE|IMPORTE TOTAL|TOTAL ALBARAN|TOTAL LINEAS|N[ºO°]? LINEAS|OBSERVACIONES|FORMA DE PAGO|RECIBI|CONFORME|FIRMA|SUBTOTAL|I V A|IVA|SUMA Y SIGUE)\b/;
const RE_ANOTACION=/^(RETIRADO POR|RECOGIDO POR|PEDIDO POR|ENTREGA EN|ENTREGAR EN|ENTREGADO A|CONTACTO|OBRA|S ?REF|SU REF|REF CLIENTE|ATENCION|OBSERVACIONES|DE PEDIDO|PEDIDO DE CLIENTE|SU PEDIDO|EN ALMACEN|TRANSPORTISTA|SUMA Y SIGUE)\b/;
const RE_ROTULO_REPARTO=/^[^A-Z0-9]*[A-Z]?(ZONA|ZONAS|PLANTA|SALA|ESTANCIA|VESTUARIOS?|CAPITULO|APARTADO)\b/;
const RE_PIE_CUALQUIERA=/^(BASE IMPONIBLE|TOTAL LINEAS|SUMA Y SIGUE|TOTAL ALBARAN|N[ºO°]? LINEAS)\b/;

/*
 * Título «Código» ilegible (tapado por un círculo de bolígrafo) pero con códigos impresos a la
 * izquierda de la descripción: se añade la columna de código por posición, marcada como inferida.
 */
function inferirColumnaCodigo(pagina,cab){
 const campos=cab.columnas.map(c=>c.campo);
 if(campos.includes("referencia"))return;
 const desc=cab.columnas.find(c=>c.campo==="descripcion");
 if(!desc)return;
 const siguientes=pagina.lineas.slice(cab.hasta+1,cab.hasta+12);
 // Columna «Nº» con códigos de artículo (fallo real 2026-11-18: «Nº | Descripción | Cantidad | Un.» con «MODELOX» debajo): es el
 // código si lo que hay debajo son códigos con letras, nunca números de línea («1», «2»…).
 // (El título «Nº» no llega a ser columna: tan corto, se toma por una mota; se busca en el renglón de títulos.)
 const lt=pagina.lineas[cab.indice];
 const num=pagina.lineas.filter(l=>Math.abs(l.y-lt.y)<=1.2*Math.max(lt.alto,l.alto)).flatMap(l=>l.celdas||[]).find(c=>/^N\s?[O0º°]?\.?$/i.test(String(c.texto||"").trim())&&c.x1<=desc.x0);
 if(num){
  const ancho=Math.max(num.x1-num.x0,10),bajo=siguientes.flatMap(l=>l.celdas.filter(c=>c.x0<desc.x0-0.5*l.alto&&c.x1>num.x0-ancho&&c.x0<num.x1+3*ancho));
  if(bajo.length&&bajo.every(c=>/^[A-Z0-9][A-Z0-9.\/-]{2,}$/i.test(c.texto.trim())&&/[A-Z]/i.test(c.texto)&&!/^\d+$/.test(c.texto.trim()))){
   const x0=Math.min(num.x0,...bajo.map(c=>c.x0)),x1=Math.max(num.x1,...bajo.map(c=>c.x1));
   cab.columnas.unshift({campo:"referencia",clave:"(Nº)",x0,x1,inferida:true});
   desc.x0=Math.min(desc.x0,x1+pagina.lineas[cab.indice].alto);
   return;
  }
 }
 // Un código solo de letras (un modelo, «MODELOX»; fallo real 2026-11-18, el título «Nº» perdido por el OCR) vale si la misma
 // palabra está también en la descripción de su fila (prueba de que es el modelo, no una palabra suelta).
 const enSuDescripcion=(l,c)=>{const w=c.texto.trim().toUpperCase();
  return /^[A-Z]{4,}$/.test(w)&&l.celdas.some(o=>o!==c&&o.x0>=desc.x0-0.5*l.alto&&new RegExp("(^|[^A-Z])"+w+"([^A-Z]|$)").test(String(o.texto||"").toUpperCase()));};
 const codigos=siguientes.flatMap(l=>l.celdas.filter(c=>c.x1<desc.x0-0.5*l.alto&&/^[A-Z0-9][A-Z0-9.\/-]{3,}$/i.test(c.texto.trim())&&(/\d/.test(c.texto)||enSuDescripcion(l,c))));
 if(!codigos.length)return;
 const x0=Math.min(...codigos.map(c=>c.x0)),x1=Math.max(...codigos.map(c=>c.x1));
 cab.columnas.unshift({campo:"referencia",clave:"(inferida)",x0,x1,inferida:true});
 // El título de la descripción suele ir centrado: su columna empieza justo después de los códigos.
 desc.x0=Math.min(desc.x0,x1+pagina.lineas[cab.indice].alto);
}
/*
 * Cabecera con las columnas del perfil del proveedor, si el OCR perdió la fila de títulos o sus títulos de la derecha (fallo
 * real 2026-10-30: tabla bien leída y descartada por no ver «CÓDIGO»). La tabla empieza en su fila de títulos o, sin ella, en
 * la primera fila cuyo código tiene el formato del proveedor. Nunca se inventa un valor: solo se decide a qué columna va cada cifra.
 */
function cabeceraDePerfil(pagina,perfil,cab){
 let indice=cab?.indice;
 if(indice==null){
  const re=perfil.formato_referencia?new RegExp(perfil.formato_referencia):null;
  const i=re?pagina.lineas.findIndex(l=>re.test(String(l.celdas?.[0]?.texto||"").trim().split(/\s+/)[0])):-1;
  if(i>=1)indice=i-1;
  else{
   indice=pagina.lineas.findIndex(l=>/\b(CODIGO|C[OÓ]DIGO|DESCRIPCI[OÓ]N|CONCEPTO)\b/i.test(l.texto||""));
   if(indice<0)return null;
  }
 }
 const k=(pagina.ancho||595)/595;
 // de_perfil: las posiciones son las del perfil, no las de unos títulos leídos (otra lectura con títulos puede ser mejor).
 return {indice,hasta:indice,valida:true,ajenas:0,de_perfil:true,columnas:perfil.columnas.map(([campo,x0,x1])=>({campo,clave:campo.toUpperCase(),x0:x0*k,x1:x1*k}))};
}
/*
 * ¿Casan las columnas del perfil con los títulos que SÍ se leyeron? (foto real 2026-11-23: en una foto el papel no ocupa las
 * posiciones de un escaneo; con las del perfil, la tabla salía en 10 filas en vez de 7 y las cifras en columnas ajenas). Cada
 * título leído de un campo del perfil ha de tener su centro dentro de la columna de ese campo (con un cuarto de su anchura de
 * margen). Sin títulos leídos no hay nada que lo contradiga.
 */
function perfilCasaConTitulos(pagina,perfil,cab){
 if(!cab)return true;
 const k=(pagina.ancho||595)/595;
 return cab.columnas.every(c=>{
  const p=perfil.columnas.find(([campo])=>campo===c.campo);
  if(!p||c.x0==null||c.x1==null)return true;
  const x0=p[1]*k,x1=p[2]*k,m=0.25*(x1-x0),centro=(c.x0+c.x1)/2;
  return centro>=x0-m&&centro<=x1+m;
 });
}
function leerTablaPagina(pagina,perfil=null){
 let cab=buscarCabeceraTabla(pagina.lineas);
 if(perfil?.columnas&&(perfil.columnas_fijas||((!cab||!cab.columnas.some(c=>c.campo==="importe"))&&perfilCasaConTitulos(pagina,perfil,cab))))
  cab=cabeceraDePerfil(pagina,perfil,cab)||cab;
 if(!cab)return null;
 inferirColumnaCodigo(pagina,cab);
 const cols=intervalos(cab.columnas);
 const filas=[],ignoradas=[],pie=[],dudosasTrasFin=[];
 const NUMERICAS=new Set(["cantidad","precio","descuento","descuento2","subtotal","importe"]);
 // Un código completo con el formato del proveedor no sigue en una palabra con letras que lo rompe: esa palabra es el
 // principio de la descripción (fallo real 2026-11-12, Saltoki escaneado: «código + ABRAZADERA» como código porque la
 // descripción empezaba 3 puntos antes del límite de columna del perfil). Solo decide la columna; no cambia ningún carácter.
 const reFormatoCodigo=perfil?.formato_referencia?new RegExp(perfil.formato_referencia):null;
 // ¿Tiene forma de código de artículo? Con el formato del proveedor, ese; sin él, 4 o más letras y cifras (con alguna cifra)
 // sin signos ajenos («4)», «T. M» no lo son).
 const pareceCodigoFila=t=>{
  const p=String(t||"").trim().split(/\s+/)[0]||"";
  if(!p)return false;
  return reFormatoCodigo?reFormatoCodigo.test(p):/\d/.test(p)&&/^[A-Z0-9][A-Z0-9.\-\/]{3,}$/i.test(p);
 };
 const sinCifras=c=>!["cantidad","precio","importe","descuento","descuento2","subtotal"].some(k=>c[k]&&pareceNumero(c[k].texto));
 const fueraDelCodigo=(codigo,palabra)=>{
  const a=String(codigo||"").trim(),b=String(palabra||"").trim().split(/\s+/)[0]||"";
  return !!reFormatoCodigo&&cols.some(x=>x.campo==="descripcion")&&reFormatoCodigo.test(a)&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(b)&&!reFormatoCodigo.test(a+b);
 };
 // Una celda que cruza columnas (ERP que escribe la fila como un solo texto)
 // se reparte por la posición estimada de cada palabra. Un texto no numérico
 // nunca se coloca en una columna numérica.
 const partir=c=>{
  if(!/\s/.test(c.texto))return [c];
  const grupos=[];
  for(const p of palabrasConPosicion(c)){
   let campo=columnaDe(p,cols)?.campo||"otra";
   const ultimo=grupos[grupos.length-1];
   if(campo==="referencia"&&ultimo?.campo==="referencia"&&fueraDelCodigo(ultimo.texto,p.texto))campo="descripcion";
   // Cifra de una columna numérica seguida, en el mismo texto, del principio de la descripción (fallo real 2026-11-20, factura
   // digital: «1,00 RTH» de CANTIDAD | DESCRIPCIÓN en un solo trozo; la posición estimada de «RTH» caía en la cantidad): la palabra
   // que no es cifra ni unidad va a la columna de texto siguiente. Solo decide la columna.
   const sigTexto=NUMERICAS.has(campo)&&ultimo?.campo===campo&&pareceNumero(ultimo.texto)&&!pareceNumero(p.texto)&&!RE_UNIDAD_SOLA.test(p.texto.trim())
    ?cols.find(x=>["descripcion","referencia"].includes(x.campo)&&x.ini>=(columnaDe(p,cols)?.fin??Infinity)):null;
   if(sigTexto)campo=sigTexto.campo;
   else if(NUMERICAS.has(campo)&&!pareceNumero(p.texto)&&ultimo)campo=ultimo.campo;
   // La columna del IVA de un concepto solo lleva su tipo («21,00 %» o «EXENTO»; 2026-11-26): una descripción larga que llega hasta
   // ella sigue en la descripción.
   else if(campo==="iva"&&ultimo&&!/^(\d{1,2}([.,]\d{1,2})?%?|%|EXENT[OA]S?)$/.test(clave(p.texto).replace(/ /g,"")))campo=ultimo.campo;
   if(ultimo&&ultimo.campo===campo){ultimo.texto+=" "+p.texto;ultimo.x1=p.x1;}
   else grupos.push({campo,texto:p.texto,x0:p.x0,x1:p.x1,alto:c.alto,y:c.y});
  }
  if(grupos.length<2)return [c];
  // Con las cajas reales de las palabras (OCR) el reparto no es una estimación.
  const exacto=c.palabras?.length>1;
  return grupos.map(g=>({texto:g.texto,x0:g.x0,x1:g.x1,alto:g.alto,y:g.y,conf:c.conf,partida:!exacto,repartida:true,campoPartida:g.campo}));
 };
 const asignar=linea=>{
  const celdas={},conflictos=[];let partida=false,textoEstimado=false;
  let ultimoTexto=null;
  for(const c of linea.celdas.filter(c=>c.x1>=xMinTabla&&!ruidoMargen(c)).flatMap(partir)){
   if(c.partida)partida=true;
   if(c.partida&&["referencia","descripcion"].includes(c.campoPartida))textoEstimado=true;
   let campo=c.campoPartida||columnaDe(c,cols)?.campo||"otra";
   // Un texto no numérico no pertenece a una columna numérica: es la
   // continuación de la columna de texto anterior («… (BOLSA 100)»).
   // Unidad impresa en la columna de cantidad, separada de la cifra («3,00 Ud», «140,00 ml», «1,00 Caja»).
   if(campo!=="unidad"&&celdas.cantidad&&!celdas.cantidad._unidad&&RE_UNIDAD_SOLA.test(c.texto.trim())&&c.x0-celdas.cantidad.x1<2.5*(c.alto||altoFila)&&c.x0>=celdas.cantidad.x0){
    celdas.cantidad={...celdas.cantidad,texto:celdas.cantidad.texto+" "+c.texto.trim(),x1:c.x1,_unidad:true};continue;
   }
   if(NUMERICAS.has(campo)&&!pareceNumero(c.texto)&&!RE_CANTIDAD_UNIDAD.test(c.texto.trim())&&ultimoTexto)campo=ultimoTexto;
   // Sin texto previo en la fila (la cantidad es la primera columna, «Cantidad | Concepto…»):
   // el texto pertenece a la primera columna de texto a su derecha.
   else if(NUMERICAS.has(campo)&&!pareceNumero(c.texto)&&!RE_CANTIDAD_UNIDAD.test(c.texto.trim())&&!RE_UNIDAD_SOLA.test(c.texto.trim())){
    const texto=cols.find(x=>["descripcion","referencia"].includes(x.campo)&&x.ini>=columnaDe(c,cols)?.ini);
    if(texto)campo=texto.campo;
   }
   // Una cifra que termina muy a la izquierda de su título no es de esa columna: forma parte
   // del texto anterior («Tablero 2,44 x 1,22 x 19 mm»).
   const col=cols.find(x=>x.campo===campo);
   if(NUMERICAS.has(campo)&&col?.x0!=null&&c.x1<col.x0-2*(c.alto||altoFila)&&ultimoTexto)campo=ultimoTexto;
   if(campo==="referencia"&&celdas.referencia&&!celdas.descripcion&&fueraDelCodigo(celdas.referencia.texto,c.texto))campo="descripcion";
   if(!NUMERICAS.has(campo))ultimoTexto=campo;
   if(celdas[campo]){
    // Código separado de la descripción por un hueco amplio (título de descripción centrado
    // que deja el inicio del texto dentro del intervalo de la referencia).
    if(campo==="referencia"&&!celdas.descripcion&&cols.some(x=>x.campo==="descripcion")&&c.x0-celdas.referencia.x1>2.5*(c.alto||altoFila))
     celdas.descripcion={...c};
    else if(["referencia","descripcion","unidad","otra"].includes(campo)){
     celdas[campo].texto+=" "+c.texto;celdas[campo].x1=c.x1;
     // La confianza del campo es la de su parte menos segura (OCR).
     if(c.conf!=null)celdas[campo].conf=Math.min(celdas[campo].conf??c.conf,c.conf);
    }
    // Varias cifras en la columna de descuento («60» «5») = descuentos en cascada.
    else if(/^descuento2?$/.test(campo)&&pareceNumero(c.texto)&&pareceNumero(celdas[campo].texto)){
     celdas[campo].texto+=" "+c.texto;celdas[campo].x1=c.x1;
     if(c.conf!=null)celdas[campo].conf=Math.min(celdas[campo].conf??c.conf,c.conf);
    }
    // Descuento sin título bajo el del precio (fallo real 2026-11-17: «PRECIO 7,63 50,00» con el importe 3,81): sin columna de
    // descuento, la segunda cifra a la derecha del precio se PRUEBA como descuento; solo vale si la línea cuadra con su importe
    // (si no, vuelve a ser «varias cifras en la misma columna»: ver _sinTitulo tras el cuadre).
    else if(campo==="precio"&&!celdas.descuento&&!cols.some(x=>/^descuento/.test(x.campo))&&pareceNumero(c.texto)&&pareceNumero(celdas.precio.texto)&&c.x0>celdas.precio.x1)
     celdas.descuento={...c,_sinTitulo:true};
    else{
     // Cifras de más en la columna del importe (fallo real 2026-11-20: el «7» de «55+7» o el «52» del descuento caían ahí): se
     // guardan para probarlas como descuentos tras el cuadre (descuentoEnColumnaImporte); si no cuadran, sigue el conflicto.
     if(campo==="importe"&&pareceNumero(c.texto))(celdas.importe._otras||=[]).push({texto:c.texto,x0:c.x0,x1:c.x1,conf:c.conf});
     conflictos.push(campo);
    }
   }else celdas[campo]={...c};
  }
  return {celdas,conflictos,partida,textoEstimado};
 };
 const altoFila=pagina.lineas[cab.indice].alto;
 // Título de la descripción centrado y descripciones alineadas a la izquierda, mucho antes del límite a medio camino entre
 // títulos (fallo real 2026-11-18, presupuesto: «DF-47 NARROW», «REJILLA 31-1», «INJERTO CON» tomados como código). Inicio
 // real de la columna: donde empieza el texto tras un código en la mayoría de las filas (≥ 3 filas y ≥ 60 % dentro de un alto).
 // Solo mueve el límite hacia la izquierda y nunca dentro del título de la referencia. Las palabras con su caja del OCR deciden.
 {
  const iRef=cols.findIndex(c=>c.campo==="referencia"),iDesc=cols.findIndex(c=>c.campo==="descripcion");
  if(iRef>=0&&iDesc===iRef+1){
   const inicios=[];
   for(const l of pagina.lineas.slice(cab.hasta+1,cab.hasta+80)){
    const pal=l.celdas.flatMap(c=>palabrasConPosicion(c)).sort((a,b)=>a.x0-b.x0);
    if(pal.length<2||!pareceCodigoFila(pal[0].texto)||columnaDe(pal[0],cols)?.campo!=="referencia")continue;
    if(pal[1].x0-pal[0].x1>1.5*(l.alto||altoFila)&&!pareceNumero(pal[1].texto))inicios.push(pal[1].x0);
   }
   if(inicios.length>=3){
    const orden=[...inicios].sort((a,b)=>a-b),med=orden[Math.floor(orden.length/2)];
    const cerca=inicios.filter(x=>Math.abs(x-med)<=altoFila).length;
    const limite=med-0.5*altoFila;
    if(cerca>=0.6*inicios.length&&limite<cols[iDesc].ini&&limite>cols[iRef].x1){cols[iRef].fin=limite;cols[iDesc].ini=limite;}
   }
  }
 }
 // Lo que queda claramente a la izquierda de la primera columna no pertenece a la tabla.
 const xMinTabla=Math.min(...cab.columnas.map(c=>c.x0))-3*altoFila;
 // Texto vertical del margen (foto real, 2026-11-23: trozos «585» y «255» leídos justo antes del código, que se quedaban
 // como referencia y mandaban el código real a la descripción, y una fila fantasma). Es ruido solo si TODO se cumple: está
 // a la izquierda de todos los títulos de la tabla, termina claramente antes de donde empiezan los códigos de las filas
 // (mediana de al menos 3 filas) y es corto (4 caracteres como mucho). Una columna con título (nº de línea) no se toca.
 const xIniTabla=Math.min(...cab.columnas.map(c=>c.x0));
 const iniciosCodigo=pagina.lineas.slice(cab.hasta+1,cab.hasta+40)
  .map(l=>l.celdas.find(c=>{const t=String(c.texto).trim().split(/\s+/)[0];return c.x1>=xMinTabla&&/^[A-Z0-9][A-Z0-9.\/-]{3,}$/i.test(t)&&/\d/.test(t);})?.x0)
  .filter(v=>v!=null).sort((a,b)=>a-b);
 const xCodigo=iniciosCodigo.length>=3?iniciosCodigo[Math.floor(iniciosCodigo.length/2)]:null;
 function ruidoMargen(c){
  return xCodigo!=null&&c.x1<xIniTabla-0.5*altoFila&&c.x1<xCodigo-1.5*altoFila&&String(c.texto).trim().length<=4;
 }
 let actual=null,fin=false,anotacion=false,yAnterior=pagina.lineas[cab.hasta].y;
 const resto=pagina.lineas.slice(cab.hasta+1);
 // «OBSERVACIONES» como fila DENTRO de la tabla (fallo real 2026-11-18, presupuesto: «OBSERVACIONES  DEFINIR COLOR …» entre
 // dos artículos; la tabla acababa ahí y se perdían 12 líneas). No es el pie si la fila no lleva ninguna cifra y la siguiente
 // impresa, a distancia de fila, es un artículo completo: código con forma de código, cantidad y precio o importe.
 const observacionEnTabla=(linea,k)=>{
  if(!/^OBSERVACION(ES)?\b/.test(clave(linea.celdas[0]?.texto||""))||!sinCifras(asignar(linea).celdas))return false;
  const sig=resto.slice(k+1).find(l=>!esManuscrita(l));
  if(!sig||sig.y-linea.y>2.5*Math.max(linea.alto,altoFila))return false;
  const c=asignar(sig).celdas;
  return !!(c.referencia&&pareceCodigoFila(c.referencia.texto)&&c.cantidad&&pareceNumero(c.cantidad.texto)&&
   ((c.precio&&pareceNumero(c.precio.texto))||(c.importe&&pareceNumero(c.importe.texto))));
 };
 for(const [k,linea] of resto.entries()){
  if(fin){
   // Red de seguridad: algo con forma de artículo después del final de la tabla.
   const {celdas}=asignar(linea);
   // Un artículo siempre lleva texto (código o descripción); una fila solo de cifras es de totales.
   if(!esManuscrita(linea)&&celdas.cantidad&&pareceNumero(celdas.cantidad.texto)&&(celdas.referencia||celdas.descripcion)&&
     (celdas.referencia||celdas.precio||celdas.importe)&&linea.texto.split(/\s+/).length<=14&&
     !RE_PIE.test(clave(linea.celdas[0]?.texto||"")))dudosasTrasFin.push(linea.texto);
   pie.push(linea);continue;
  }
  const primera=clave(linea.celdas[0]?.texto||"");
  // Fin de tabla: rótulo de pie o un hueco vertical grande tras la última fila.
  const separacion=filas.length?linea.y-yAnterior:0;
  if(filas.length&&observacionEnTabla(linea,k)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Observación dentro de la tabla (no es un artículo)"});
   yAnterior=linea.y;continue;
  }
  // Duración de un alquiler bajo su línea (fallo real 2026-11-20, factura de alquiler: «Total 00010 Días  Ref.Contrato: …»): no es
  // el total del documento ni un artículo; la tabla sigue.
  if(filas.length&&/^TOTAL\s+\d+\s+(DIAS?|HORAS?|SEMANAS?|MESES|MES|JORNADAS?)\b/.test(clave(linea.texto||""))){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Duración del alquiler (no es el total ni un artículo)"});
   yAnterior=linea.y;continue;
  }
  // Suma de la hoja anterior al principio de una hoja de continuación (2026-11-25: «SUMA ANTERIOR ........> 100,00» cortaba la
  // tabla de la 2.ª hoja y su línea se perdía): ni el final de la tabla ni un artículo; la tabla sigue.
  if(/^SUMA ANTERIOR\b/.test(clave(linea.texto||""))){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Suma de la hoja anterior (no es el final de la tabla ni un artículo)"});
   yAnterior=linea.y;continue;
  }
  if(RE_PIE.test(primera)||/^PESO (BRUTO|NETO|TOTAL)\b/.test(clave(linea.texto||""))||linea.celdas.some(c=>RE_PIE_CUALQUIERA.test(clave(c.texto)))||separacion>3.2*altoFila+16){
   fin=true;pie.push(linea);
   if(!RE_PIE.test(primera)){
    const {celdas}=asignar(linea);
    if(!esManuscrita(linea)&&celdas.cantidad&&pareceNumero(celdas.cantidad.texto)&&(celdas.referencia||celdas.descripcion)&&
      (celdas.referencia||celdas.precio||celdas.importe)&&linea.texto.split(/\s+/).length<=14)dudosasTrasFin.push(linea.texto);
   }
   continue;
  }
  // Renglón que solo es ruido del margen: se registra y no es una fila.
  if(linea.celdas.length&&linea.celdas.every(ruidoMargen)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Texto del margen, fuera de la tabla"});
   continue;
  }
  if(evaluarCabecera(linea.celdas).valida){ // cabecera repetida: se registra, nunca se pierde en silencio
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Cabecera de tabla repetida"});
   yAnterior=linea.y;continue;
  }
  // Manuscritos sobre el escaneo: el OCR los lee como palabras de confianza muy baja.
  // Una línea compuesta casi solo de ese texto no es un artículo impreso.
  if(esManuscrita(linea)){
   // Renglón de texto débil (tachado, rodeado a bolígrafo) justo bajo una línea y dentro de la
   // columna de descripción: puede ser su continuación. Se añade, pero la descripción queda en revisión.
   const desc=cols.find(x=>x.campo==="descripcion");
   // Si a su altura hay una anotación («Retirado por: NOMBRE …»), es parte de ella, no de la descripción.
   const junto=pagina.lineas.some(l=>l!==linea&&Math.abs(l.y-linea.y)<=1.2*Math.max(linea.alto,l.alto)&&RE_ANOTACION.test(clave(l.texto)));
   if(actual&&desc&&!junto&&linea.celdas.every(c=>c.x0>=desc.ini&&c.x1<=desc.fin)&&linea.y-yAnterior<=2*Math.max(linea.alto,altoFila)){
    actual.continuacionesDudosas=[...(actual.continuacionesDudosas||[]),linea.texto];actual.yUltima=linea.y;
    yAnterior=linea.y;continue;
   }
   // Primer renglón de un artículo, impreso pero leído con poca confianza (fallo real 2026-11-25: «código  TEXTO … 300» con las
   // cifras en el renglón de debajo, que quedaba sin código y con media descripción): un código con forma de código en su columna,
   // texto en la de la descripción y ni precio ni importe. Se guarda para la línea de debajo si esta no trae código (en revisión).
   {const a=asignar(linea).celdas;
    if(a.referencia&&pareceCodigoFila(a.referencia.texto)&&a.descripcion&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(a.descripcion.texto)&&!a.precio&&!a.importe){
     // Todo el renglón es código y descripción (sin precio ni importe): la descripción, lo que sigue al código (también una cifra suelta
     // del texto, «… 300» de «300 kPa», que el reparto por columnas no da a la descripción). La altura de la tabla no avanza: los
     // renglones que siguen se juntan con la línea de debajo, no con la de arriba.
     const codigo=String(a.referencia.texto).trim().split(/\s+/)[0],texto=String(linea.texto).trim();
     const ig={pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Primer renglón de un artículo, leído con poca confianza OCR"};
     Object.defineProperties(ig,{_sinCantidad:{value:true},_fila:{value:filas.length},_y:{value:linea.y},_x:{value:linea.celdas[0]?.x0??0},_texto:{value:linea.texto},
      _primerRenglon:{value:{referencia:codigo,descripcion:texto.startsWith(codigo)?texto.slice(codigo.length).trim():a.descripcion.texto.trim()}}});
     ignoradas.push(ig);continue;
    }}
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Texto de baja confianza OCR (posible manuscrito o sello)"});
   continue;
  }
  const {celdas,conflictos,partida,textoEstimado}=asignar(linea);
  const tieneCantidad=!!celdas.cantidad&&(pareceNumero(celdas.cantidad.texto)||RE_CANTIDAD_UNIDAD.test(celdas.cantidad.texto.trim())),tieneRef=!!celdas.referencia;
  const tieneImportes=!!(celdas.precio||celdas.importe);
  // Anotaciones del proveedor dentro de la tabla («Entrega en:», «Contacto:», «OBRA: …»,
  // «Retirado por: …»): sin cantidad no son artículos ni continúan la descripción.
  const textoLinea=clave(Object.values(celdas).map(c=>c.texto).join(" "));
  // Un código terminado en «:» («Entrega en:») nunca es un artículo, aunque la dirección
  // deje una cifra en la columna de cantidad («18 SECTOR 1»); sí lo sería si tuviera precio o importe.
  const refRotulo=/:$/.test(String(celdas.referencia?.texto||"").trim());
  // Rótulos de reparto entre las líneas («ZONA PISCINA», «PLANTA 2», «SALA …»; usuario 2026-11-18: «se ve claramente que no
  // es nada, más bien una distribución»): sin cantidad ni cifras, no son artículos. Admite una viñeta leída como letra («AZONA»).
  if(!tieneCantidad&&!tieneImportes&&RE_ROTULO_REPARTO.test(textoLinea)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Rótulo de reparto (zona, planta…), no es un artículo"});
   yAnterior=linea.y;continue;
  }
  if((!tieneCantidad&&RE_ANOTACION.test(textoLinea))||(refRotulo&&!tieneImportes)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Anotación del proveedor, no es un artículo"});
   yAnterior=linea.y;anotacion=true;continue;
  }
  // Toda línea con referencia, cantidad o importe es una fila: si falta un dato
  // queda en REVISAR, nunca se descarta en silencio.
  // Ruido (manuscritos, marcas): sin referencia ni descripción y sin ninguna cifra válida.
  // OCR: tampoco es un artículo una cifra suelta, sin código, descripción ni cantidad, leída con
  // confianza baja (trazo de un manuscrito que cae en una columna de importes).
  // Una fila sin código ni descripción con solo cifras con «€» (las filas vacías «0,00 €» de una plantilla o la suma suelta de la
  // columna al final, factura de 2026-11-25) tampoco es un artículo: queda fuera, como antes de admitir el «€» en las cifras.
  const soloRuido=!tieneRef&&!celdas.descripcion&&
   (Object.entries(celdas).every(([k,c])=>!NUMERICAS.has(k)||!pareceCifraSola(c.texto))||
    (!tieneCantidad&&Object.values(celdas).every(c=>c.conf!=null&&c.conf<90)));
  if(soloRuido){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Texto sin artículo ni cifras válidas (posible manuscrito o marca)"});
   continue;
  }
  // Palabras en la columna de la cantidad, sin código ni descripción (fallo real 2026-11-18: la firma digital impresa «NOMBRE
  // APELLIDO - DNI» junto a la tabla daba una línea con cantidad «NOMBRE-» y el DNI como precio): no es un artículo.
  if(!tieneRef&&!celdas.descripcion&&celdas.cantidad&&!tieneCantidad&&/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(celdas.cantidad.texto)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Texto en la columna de la cantidad sin código ni descripción (posible firma o sello)"});
   continue;
  }
  // Segundo renglón de una anotación («Retirado por: JUAN» / «PÉREZ»).
  const soloTextoLinea=Object.keys(celdas).every(k=>["descripcion","referencia","otra","unidad"].includes(k));
  if(anotacion&&!tieneCantidad&&!tieneImportes&&(soloTextoLinea||!tieneRef)&&linea.y-yAnterior<=2*Math.max(linea.alto,altoFila)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Continuación de una anotación del proveedor"});
   yAnterior=linea.y;continue;
  }
  anotacion=false;
  // Una palabra sin cifras sola en la columna de código («Vegas», «Nave») no es un artículo:
  // suele ser la obra o una anotación del proveedor. Se conserva como anotación.
  // Código y descripción que siguen en un segundo renglón sin cantidad ni importes, pegado a la
  // línea anterior («PEDOBLAM1/4X3/8» / «(20M)-(COASOL)»): es continuación, no otro artículo.
  if(actual&&tieneRef&&!tieneCantidad&&!tieneImportes&&actual.celdas.cantidad&&linea.y-yAnterior<=1.8*Math.max(linea.alto,altoFila)&&
    !RE_ANOTACION.test(textoLinea)&&/^[(\-\/.]/.test(celdas.referencia.texto.trim())){
   actual.continuacionRef=[...(actual.continuacionRef||[]),celdas.referencia.texto.trim()];
   if(celdas.descripcion)actual.continuaciones.push(celdas.descripcion.texto);
   actual.yUltima=linea.y;yAnterior=linea.y;continue;
  }
  const soloPalabra=tieneRef&&!tieneCantidad&&!tieneImportes&&!celdas.descripcion&&!/\d/.test(celdas.referencia.texto);
  if(soloPalabra){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Palabra suelta en la columna de código (posible obra o anotación)",anotacion:true});
   yAnterior=linea.y;continue;
  }
  // Descripción en dos renglones con las cifras en el SEGUNDO (fallo real 2026-11-13: «código  DESCRIPCIÓN … (CAJA» /
  // «4)  1,00  precio  dto  importe»): la fila anterior tiene código y descripción y ninguna cifra, y esta tiene cantidad y
  // nada con forma de código, pegada debajo. Es la misma línea: su texto sigue la descripción y sus cifras son las de la línea.
  if(actual&&tieneCantidad&&actual.celdas.referencia&&actual.celdas.descripcion&&!actual.continuacionRef&&sinCifras(actual.celdas)&&
    pareceCodigoFila(actual.celdas.referencia.texto)&&!pareceCodigoFila(celdas.referencia?.texto)&&
    // Lo de la columna del código empieza a la derecha del código de arriba (texto sangrado, no otro código corto: «R-2»).
    (!celdas.referencia||celdas.referencia.x0>actual.celdas.referencia.x1)&&
    linea.y-yAnterior<=1.8*Math.max(linea.alto,altoFila)&&!RE_ANOTACION.test(textoLinea)){
   const texto=[celdas.referencia?.texto,celdas.descripcion?.texto].filter(Boolean).join(" ").trim();
   if(texto)actual.continuaciones.push(texto);
   for(const [k,c] of Object.entries(celdas))if(!["referencia","descripcion"].includes(k))actual.celdas[k]=c;
   actual.conflictos=[...actual.conflictos,...conflictos];actual.partida=actual.partida||partida;actual.textoEstimado=actual.textoEstimado||textoEstimado;
   actual.cifrasEnSegundoRenglon=true;actual.yUltima=linea.y;
   yAnterior=linea.y;continue;
  }
  // «Albarán: 26/0001  Fecha: …» dentro de la tabla de una factura (fallo real 2026-11-23): es la cabecera de las líneas de ese
  // albarán, no un artículo (sin cantidad ni importes). Se guarda con su altura: la aplicación sabe así de qué albarán es cada línea.
  if(!tieneCantidad&&!tieneImportes&&/^ALBARAN\b\s*(N[ºO°]?\s*)?\d/.test(textoLinea)){
   ignoradas.push({pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Albarán citado en la factura (cabecera de sus líneas), no es un artículo"});
   yAnterior=linea.y;continue;
  }
  if(tieneCantidad||tieneRef||tieneImportes){
   actual={pagina:pagina.numero,celdas,conflictos,partida,textoEstimado,continuaciones:[],y:linea.y,
    titulosInferidos:cab.columnas.filter(c=>c.inferida).map(c=>c.campo)};
   // Texto suelto inmediatamente encima (sin otra fila entre medias): puede ser el primer
   // renglón de la descripción o una anotación. No se decide: la descripción queda en revisión.
   const previas=[];
   for(let i=ignoradas.length-1;i>=0;i--){
    const v=ignoradas[i];
    if(!v._sinCantidad||v._fila!==filas.length||linea.y-v._y>3*Math.max(linea.alto,altoFila))break;
    previas.push(v);
   }
   // Con el primer renglón del artículo (con su código) encima y esta línea sin código: el código y el principio de la descripción son
   // de esta línea (construirFila, en revisión); los demás renglones de encima, por orden de altura.
   const p1=!tieneRef?previas.find(v=>v._primerRenglon):null;
   if(p1)actual.primerRenglon={...p1._primerRenglon,resto:previas.filter(v=>v!==p1&&v._y>p1._y).sort((a,b)=>a._y-b._y).map(v=>v._texto).filter(Boolean)};
   // El OCR puede partir un mismo renglón en dos («Suministro» / «y montaje»): orden por posición.
   else if(previas.length)actual.textoPrevio=previas.sort((a,b)=>a._x-b._x).map(v=>v._texto).filter(Boolean).join(" ");
   filas.push(actual);
  }else{
   const soloTexto=Object.keys(celdas).every(k=>["descripcion","referencia","otra","unidad"].includes(k));
   // Con un renglón impreso apartado entre el artículo y este («Ref.Prov: …», «Nº PRODUCTOR …»), este ya no es su descripción (fallo real
   // 2026-11-25: el aviso «Material fuera de stock. No admitiremos su devolución…», dos renglones más abajo, acabó en la descripción y STEL
   // no pudo dar de alta el artículo). No cortan: lo escrito a mano, el ruido del margen y las motas.
   const apartadoEntre=actual&&ignoradas.some(v=>v.pagina===pagina.numero&&v.y>(actual.yUltima??actual.y)&&v.y<linea.y&&
    !/baja confianza|margen|sin artículo ni cifras/.test(v.motivo||""));
   // «ALBARÁN Nº …» dentro de una factura es la cabecera del albarán siguiente, nunca el final de la descripción de arriba (2026-11-23).
   if(actual&&soloTexto&&celdas.descripcion&&!celdas.referencia&&linea.y-yAnterior<=1.8*linea.alto&&!apartadoEntre&&
     !RE_ANOTACION.test(clave(celdas.descripcion.texto))&&!/^ALBARAN\b/.test(clave(celdas.descripcion.texto))){
    actual.continuaciones.push(celdas.descripcion.texto);actual.yUltima=linea.y;
   }else{
    const ig={pagina:pagina.numero,y:linea.y,texto:linea.texto,motivo:"Línea sin cantidad dentro de la tabla"};
    Object.defineProperties(ig,{_sinCantidad:{value:!!celdas.descripcion},_fila:{value:filas.length},_y:{value:linea.y},_x:{value:linea.celdas[0]?.x0??0},
     // Sin los trazos de bolígrafo que el OCR lee con confianza casi nula.
     _texto:{value:linea.celdas.filter(c=>c.conf==null||c.conf>=50).map(c=>c.texto).join(" ")}});
    ignoradas.push(ig);
   }
  }
  yAnterior=linea.y;
 }
 const precio=cols.find(c=>c.campo==="precio");
 const precioPor=precio&&/1000|MIL/.test(precio.clave)?1000:precio&&/100/.test(precio.clave)?100:1;
 return {cabecera:cab.columnas.map(c=>c.campo),columnas:cab.columnas.map(c=>({campo:c.campo,clave:c.clave,x0:c.x0,x1:c.x1})),filas,ignoradas,pie,indiceCabecera:cab.indice,precioPor,dudosasTrasFin,cabeceraPerfil:!!cab.de_perfil,...(cab.servicios?{servicios:true}:{}),...(cab.conBase?{conBase:true}:{})};
}

/*
 * Devolución solo del IVA en una factura en inglés: «Credited subtotal» 0, «Credited total» = la cuota impresa y «Adjusted invoice
 * total» = la base impresa (±0,01), con base + cuota = total. Devuelve {devuelto, queda} (cifras leídas) o null.
 */
function devolucionSoloIva(lineas,totales,opcionesNumero){
 const sub=valorPie(lineas,/^CREDITED SUBTOTAL$/,opcionesNumero),dev=valorPie(lineas,/^CREDITED TOTAL$/,opcionesNumero);
 const queda=valorPie(lineas,/^ADJUSTED (INVOICE )?TOTAL$/,opcionesNumero);
 const ok=x=>x&&x.estado==="OK"&&Number.isFinite(x.valor);
 if(!ok(sub)||!ok(dev)||!ok(queda)||Math.abs(sub.valor)>0.005||!(dev.valor>0)||!(queda.valor>0))return null;
 const b=totales?.base_imponible?.valor,c=totales?.cuota_iva?.valor,t=totales?.total?.valor;
 if(![b,c,t].every(Number.isFinite))return null;
 const cerca=(x,y)=>Math.abs(x-y)<=0.01+1e-9;
 return cerca(dev.valor,c)&&cerca(queda.valor,b)&&cerca(b+c,t)?{devuelto:dev,queda}:null;
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
 // «TOTAL BASE IMPONIBLE», «BASES IMPONIBLES», «BASE IVA» (banco de facturas, 2026-11-25).
 base:/^(BASES? IMPONIBLES?|BASE|BASES|SUMA NETO|NETO|TOTAL NETO|IMPORTE NETO|SUMA IMPORTES|TOTAL BASES?( IMPONIBLES?)?|NET|TOTAL EXCL(UDING|UIDO)?( (TAX|VAT|IVA))?|PRECIO NETO TOTAL)\b|^HONORARIOS$/,
 // El % dentro de la etiqueta también vale («IVA 21%», «IVA21%», «21 % IVA», «Impuesto IVA 21%», «21% sobre la base imponible»).
 pct:/^(% ?IVA|IVA ?%|TIPO IVA|TIPO|IVA|IMPUESTOS?( DE)? IVA|VAT|TAX|VAT RATE|TAX RATE)\b|^%$|^CUOTAS? \d{1,2}([.,]\d+)? ?%|^IVA(?= ?\d)|^\d{1,2}([.,]\d+)? ?% ?(DE )?(IVA|SOBRE)\b/,
 // «Cuota» sola (columna del desglose «Base IVA | % | Cuota») y «Total impuesto(s)»: la combinación decide.
 cuota:/^(CUOTAS? ?(DE )?[IL1] ?V ?A|TOTAL ?(DE )?[ILT1] ?V ?A|IMP(ORTE)? ?(DEL? )?I ?V ?A|I V A|IVA|IMPUESTOS?( DE)? IVA|TOTAL IMPUESTOS?|TOTAL CUOTAS?|VAT|TAX|VAT SUBTOTAL|TOTAL (VAT|TAX))\b|^[L1] ?V ?A$|^CUOTAS?$|^CUOTAS? \d{1,2}([.,]\d+)? ?%|^IVA(?= ?\d)|^\d{1,2}([.,]\d+)? ?% ?(DE )?(IVA|SOBRE)\b/,
 // Gastos suplidos de una gestoría (2026-11-24: «GASTOS | HONORARIOS | % | I.V.A. | TOTAL FACTURA»): fuera de la base, sin IVA.
 // La base exenta (2026-11-26: «Total Base Imponible Exenta (*)», prevención de riesgos laborales, art. 20 de la Ley del IVA): igual, sin IVA.
 exento:/^(GASTOS|SUPLIDOS|GASTOS SUPLIDOS|TOTAL SUPLIDOS)$|^(TOTAL )?BASES? (IMPONIBLES? )?EXENTAS?\b/,
 // «A INGRESAR» (gestoría, 2026-11-24): el total otra vez, en su casilla; solo se toma si cuadra con base, IVA y suplidos.
 // Banco de facturas (2026-11-25): «Importe final», «Importe de la factura», «Importe del abono», «EURO TOTAL», «Importe neto total con
 // impuestos», «Invoice total», «Total payable», «TOTALABONO» (total a abonar = a pagar) y «T O T A L» (letras separadas).
 total:/^(TOTAL A PAGAR|TOTAL ALBARAN|IMPORTE TOTAL|TOTAL EUR|TOTAL|A INGRESAR|IMPORTE FINAL|IMPORTE (DE LA |DEL? )?(FACTURA|ABONO)|EUROS? TOTAL|INVOICE TOTAL|TOTAL PAYABLE|IMPORTE A PAGAR|LIQUIDO A (PAGAR|PERCIBIR)|IMPORTE( NETO)? TOTAL CON (IMPUESTOS?|IVA)|TOTALABONO|AMOUNT DUE|AMOUNT PAID|TOTAL DUE)\b/,
 // Retención (IRPF de un profesional): se resta del total («A deducir IRPF15% 6,00»).
 retencion:/^(A DEDUCIR )?(RETENCION( IRPF)?|RET IRPF|IRPF)\b|^(A DEDUCIR )?IRPF(?= ?\d)/,
 // «SUBTOTAL»: solo como base de una combinación que cuadre, nunca por sí solo.
 subtotal:/^(SUBTOTAL|SUB TOTAL|ITEM SUBTOTAL)\b/
};
// No son el total de la factura: recuentos y medidas («Total m²», «Total posiciones», «Total bultos»), el IVA, la base, lo que se
// descuenta o compensa, el pedido y lo certificado a origen (banco de facturas, 2026-11-25: «Total m²: 543,21» aceptado como total).
const EXCLUIR_TOTAL=/^TOTAL ?(L ?[IÍ1L]? ?N ?E ?A ?S|[IL1] ?[IÍ1L]? ?N ?E ?A ?S|(DE )?[ILT1] ?V ?A|RE|NETO|BRUTO|M ?[23²³]|M|ML|MTS|KGS?|KILOS|PESO|BULTOS|UDS|UNIDADES|PIEZAS|CANTIDAD(ES)?|POSICIONES|PARTIDAS|ARTICULOS|HORAS|LITROS|COMPENSACION|PEDIDO|DTOS?|DESCUENTOS?|PUNTOS|IMPUESTOS?|RECARGO|RETENCION|IRPF|BASES?|(FACTURA )?A ORIGEN|CERTIFICAD[OA]S?|VAT|EXCL(UDING|UIDO)?|CUOTAS?|NET|GROSS|WEIGHT)(?![A-Z0-9])/;
// En una factura, el total de cada albarán que cita no es el de la factura.
const EXCLUIR_TOTAL_FACTURA=new RegExp(EXCLUIR_TOTAL.source+"|^TOTAL (DEL? )?ALBAR[AE]N(ES)?(?![A-Z0-9])");
// Base con impuestos («IMPORTE NETO TOTAL CON IMPUESTOS») o cuota «incluida»: no son base ni cuota.
// La base exenta va aparte (ETIQ_TOTALES.exento).
const EXCLUIR_BASE=/\bCON (IMPUESTOS?|IVA)\b|\bIVA INCL|\bEXENTAS?\b/;
const EXCLUIR_CUOTA=/\bINCLUID|\bINCL\b|\bINC\b/;
// «T O T A L», «I V A»: letras sueltas separadas por espacios, juntas.
const colapsarLetras=t=>t.replace(/\b[A-Z](?: [A-Z]\b){2,}/g,m=>m.replace(/ /g,""));
const claveTotales=t=>colapsarLetras(clave(t));
// Lo que sigue a la etiqueta en la misma casilla: se cuentan sus letras y cifras (la clave quita signos y espacios).
function restoTras(texto,etiqueta){
 const n=(etiqueta.match(/[A-Z0-9%²³]/g)||[]).length,s=N().sinAcentos(String(texto||""));
 let i=0,vistos=0;
 while(i<s.length&&vistos<n){if(/[A-Z0-9%²³]/.test(s[i]))vistos++;i++;}
 return String(texto||"").slice(i).replace(/^[\s:€()]+/,"").trim();
}
// Cifras de una casilla: «1.234,56 €», «21,000 %», «-12,34», «12,34-», «€5.67», «21% ( Euros )».
const piezasNumero=t=>String(t||"").replace(/€|\bEUR(OS)?\b/gi," ").split(/\s+(?=[-\d])/)
 .map(p=>(p.trim().match(/^-?\d[\d.,]*-?(?: ?%)?/)||[""])[0].trim()).filter(Boolean);
// ¿La casilla es una etiqueta (una palabra de tres letras o más, sin contar «EUR» ni «Euros», también pegado: «123,45Eur»)? «de 100,00»
// no lo es.
const esEtiqueta=t=>/[A-ZÑ]{3,}/.test(N().sinAcentos(String(t||"")).replace(/EUR(OS)?\b|€/g,""));
// ¿Solo una cifra en la casilla? (para seguir una columna de cifras hacia abajo).
const soloCifra=t=>{const s=String(t||"").replace(/€|\bEUR(OS)?\b/gi,"").trim();return /^-?\d[\d.,]*-?$/.test(s);};
function candidatos(lineas,re,opcionesNumero,{excluir=null,porcentaje=false,factura=false}={}){
 const out=[];
 lineas.forEach((linea,li)=>{let saltar=-1;linea.celdas.forEach((celda0,ci)=>{
  if(ci<=saltar)return;
  // Etiqueta partida en dos celdas por el OCR («Base» «Imponible», «Cuota» «IVA»).
  const sig=linea.celdas[ci+1];
  let celda=celda0,usadas=0;
  if(sig&&sig.x0-celda0.x1<1.5*celda0.alto){
   const k2=claveTotales(celda0.texto+" "+sig.texto);
   if(re.test(k2)&&k2.match(re)[0].length>(claveTotales(celda0.texto).match(re)?.[0].length||0)){
    celda={...celda0,texto:celda0.texto+" "+sig.texto,x1:sig.x1};usadas=1;
   }
  }
  const k=claveTotales(celda.texto);const m=k.match(re);
  // La exclusión mira también la palabra siguiente («Total» «Iíneas:» del OCR no es el total).
  if(!m||(excluir&&(excluir.test(k)||(sig&&excluir.test(claveTotales(celda0.texto+" "+sig.texto))))))return;
  saltar=ci+usadas;
  // Las cifras de una casilla que es otra etiqueta no son de esta («IVA | R.equiv. | IRPF 0 % | Total factura»: el 0 % es del IRPF).
  const textos=[restoTras(celda.texto,m[0]),...linea.celdas.slice(ci+1+usadas,ci+4+usadas).filter(c=>!esEtiqueta(c.texto)).map(c=>c.texto)];
  // Valor debajo: la primera celda solapada en horizontal en los tres renglones siguientes. Sin ninguna solapada, la de la columna
  // del título, hasta el título siguiente: cifra alineada a la derecha bajo un título a la izquierda (2026-11-25:
  // «BASE IMPONIBLE | % | I.V.A. | % | R. EQUIV. | TOTAL» y debajo «200,00 | 21,00 | 42,00 | 242,00», ninguna solapada).
  const derecha=linea.celdas[ci+1+usadas];
  const enColumna=c=>{const cx=(c.x0+c.x1)/2;return cx>=celda.x0&&cx<(derecha?derecha.x0:Infinity)&&
   !linea.celdas.some(o=>o!==celda0&&!(usadas&&o===sig)&&Math.min(c.x1,o.x1)-Math.max(c.x0,o.x0)>0);};
  // Sin solaparse, solo una cifra: un texto suelto en la columna (una mancha que el OCR lee «e») no para la búsqueda (albarán escaneado,
  // 2026-11-25: la base dejaba de encontrarse).
  const deColumna=l2=>l2.celdas.find(c=>Math.min(c.x1,celda.x1)-Math.max(c.x0,celda.x0)>0)||l2.celdas.find(c=>enColumna(c)&&/\d/.test(c.texto)&&!esEtiqueta(c.texto));
  const siguientes=lineas.slice(li+1);
  let yRef=linea.y;
  for(const [j,l2] of siguientes.slice(0,3).entries()){
   if(l2.y-yRef>4.5*Math.max(linea.alto,celda.alto))break;
   // Una llamada de nota (un «1» pequeño bajo «Tax», factura en inglés 2026-11-25): no es la cifra de la columna.
   if(l2.celdas.length===1&&String(l2.celdas[0].texto).trim().length<=2&&l2.alto<0.75*Math.max(linea.alto,celda.alto))continue;
   const abajo=deColumna(l2);
   // Un renglón que solo precisa los títulos («(excl. VAT)», «(EUR)»: facturas de tiendas en línea, 2026-11-25) no es la cifra: se mira el
   // siguiente, contando desde él. «(incl. VAT)» sí para: lo de debajo lleva el IVA y nunca es una base.
   const precisa=c=>/^\(\D*\)$/.test(String(c.texto).trim());
   if(abajo&&precisa(abajo)&&l2.celdas.every(precisa)){if(/INCL/i.test(abajo.texto))break;yRef=l2.y;continue;}
   if(abajo&&/\d/.test(abajo.texto)&&!esEtiqueta(abajo.texto)){
    textos.push(abajo.texto);
    // Columna de cifras (desglose por tipos de IVA y su fila de totales): también las de debajo, mientras sigan siendo solo cifras.
    let y=l2.y;
    if(soloCifra(abajo.texto))for(const l3 of siguientes.slice(j+1,j+7)){
     if(l3.y-y>2.5*Math.max(l3.alto,linea.alto))break;
     const otra=deColumna(l3);
     if(!otra||!soloCifra(otra.texto))break;
     textos.push(otra.texto);y=l3.y;
    }
    break;
   }
   if(abajo)break;
  }
  // % dentro de la etiqueta («21 % IVA», «IVA 21%»).
  if(porcentaje){const p=m[0].match(/(\d{1,2}(?:[.,]\d+)?) ?%/);if(p){const n=N().numero(p[1],{...opcionesNumero,porcentaje:true});
   if(n.estado==="OK"&&n.valor>0&&n.valor<=30)out.push({...n,etiqueta:celda.texto,caja:caja(celda),fila:li,orden:-1});}}
  let orden=0;
  for(const bruto of textos){
   for(const t of piezasNumero(bruto)){
    const esPct=/%/.test(t);
    if(porcentaje!==esPct&&!(porcentaje&&/^\d{1,2}([.,]0+)?$/.test(t)))continue;
    // Ni «0012» (el IBAN bajo «A ingresar») ni, en una factura, una cifra sin decimales (un año, un código) son importes; sí una casilla
    // que es solo un importe con «€» («€0.0» o «€0» de las facturas de tiendas en línea, 2026-11-25).
    const soloEuros=/^\s*(€\s?-?[\d.,]+|-?[\d.,]+\s?€)\s*$/.test(String(bruto));
    if(!porcentaje&&(/^-?0\d/.test(t)||(factura&&!soloEuros&&!/[.,]\d{2,4}-?$/.test(t))))continue;
    const n=N().numero(porcentaje?t.replace(/ ?%$/,""):t,{...opcionesNumero,porcentaje});
    if(n.estado==="OK"&&(!porcentaje||(n.valor>=0&&n.valor<=30)))out.push({...n,etiqueta:celda.texto,caja:caja(celda),fila:li,orden:orden++});
   }
  }
 });});
 return out;
}
// % de IVA de cada línea en la columna «Tax»/«IVA» de su tabla («0%», «21 %»; facturas en inglés, 2026-11-26: leída la tabla, ese «0%»
// ya no llega al pie). null si alguna línea no lo trae.
function porcentajesDeImpuesto(tablas,lineas){
 const out=[];
 for(const x of tablas){
  if(!x.t)continue;
  const col=(x.t.columnas||[]).find(c=>c.campo==="otra"&&/^(TAX|VAT|IVA|IVA %|% IVA|TIPO IVA|TAX RATE|VAT RATE|IMPUESTO)$/.test(c.clave));
  if(!col)continue;
  const ancho=Math.max(4,col.x1-col.x0);
  for(const l of lineas.filter(l=>l.pagina===x.p.numero&&l.y!=null)){
   const fila=x.p.lineas.find(r=>Math.abs(r.y-l.y)<=Math.max(1,0.5*(r.alto||8)));
   const c=fila?.celdas.find(c=>Math.min(c.x1,col.x1+ancho)-Math.max(c.x0,col.x0-ancho)>0&&/^\d{1,2}(?:[.,]\d+)?\s*%$/.test(String(c.texto).trim()));
   if(!c)return null;
   out.push(Number(String(c.texto).replace(/[^\d.,]/g,"").replace(",",".")));
  }
 }
 return out.length?out:null;
}
function leerTotales(lineas,opcionesNumero,{factura=false,ivaLineas=null}={}){
 const vacio=()=>({literal:"",valor:null,estado:"VACIO",motivos:[]});
 const res={base_imponible:vacio(),iva_porcentaje:vacio(),cuota_iva:vacio(),total:vacio(),validacion:null};
 const o={factura};
 const B=candidatos(lineas,ETIQ_TOTALES.base,opcionesNumero,{...o,excluir:EXCLUIR_BASE}),P=candidatos(lineas,ETIQ_TOTALES.pct,opcionesNumero,{...o,porcentaje:true});
 let C=candidatos(lineas,ETIQ_TOTALES.cuota,opcionesNumero,{...o,excluir:EXCLUIR_CUOTA});
 const T=candidatos(lineas,ETIQ_TOTALES.total,opcionesNumero,{...o,excluir:factura?EXCLUIR_TOTAL_FACTURA:EXCLUIR_TOTAL});
 const E=candidatos(lineas,ETIQ_TOTALES.exento,opcionesNumero,o),R=candidatos(lineas,ETIQ_TOTALES.retencion,opcionesNumero,o);
 const S=candidatos(lineas,ETIQ_TOTALES.subtotal,opcionesNumero,o);
 // Totales impresos en negativo («Importe del abono -12,34»): prueba de abono para quien llama.
 Object.defineProperty(res,"_negativos",{value:T.filter(t=>t.valor<0),enumerable:false});
 // Fila del IVA con su % y dos importes (2026-11-25: «IVA repercutido | 21,000 % | 740,00 | 155,40 EUR»): el primero es la
 // base si base × % = el segundo; si no, las dos cifras siguen como posibles cuotas (y la combinación decide).
 for(const fila of new Set(C.map(x=>x.fila))){
  const deFila=C.filter(x=>x.fila===fila).sort((a,b)=>a.orden-b.orden),pcts=P.filter(p=>p.fila===fila);
  if(deFila.length!==2||!pcts.length)continue;
  const [a,b]=deFila;
  if(pcts.some(p=>Math.abs(redondear(a.valor*p.valor/100)-b.valor)<=0.011)){
   B.push({...a,notas:[...(a.notas||[]),"Base de la fila del IVA («"+a.etiqueta+"»): base × % = cuota"]});C=C.filter(x=>x!==a);
  }
 }
 const unicos=a=>[...new Map(a.map(x=>[x.valor,x])).values()];
 const signo=x=>Math.sign(x.valor);
 // «SUBTOTAL» solo de un renglón con una sola cifra: «SUBTOTAL | base | cuota | con IVA» es el de un grupo de líneas (factura de
 // combustible, 2026-11-25: el grupo al 10 % cuadraba solo y se aceptaba como la factura).
 // La misma cifra repetida en la columna (el desglose y su fila «Total» de las facturas de tiendas en línea, 2026-11-25) cuenta una vez.
 const subtotales=S.filter(s=>new Set(S.filter(x=>x.fila===s.fila).map(x=>x.valor)).size===1);
 const bases=[...unicos(B),...unicos(subtotales).filter(s=>!B.some(b=>b.valor===s.valor))];
 const combos=[];
 // Con gastos suplidos impresos: base + cuota + suplidos = total (la cuota solo de la base). Con retención (IRPF): − retención.
 // Abono con los importes en negativo: los tres del mismo signo.
 // Suplidos o retención a cero («IRPF: 0,00») son lo mismo que ninguno: no son otra combinación.
 for(const e of [null,...unicos(E).filter(x=>x.valor)])for(const r of [null,...unicos(R).filter(x=>x.valor)])for(const b of bases)for(const c of unicos(C))for(const t of unicos(T)){
  // Base 0 solo con suplidos o base exenta (2026-11-26: «Total Base Imponible: 0,00», todo exento).
  if(!t.valor||(b.valor?signo(b)!==signo(t):!e)||(c.valor&&signo(c)!==signo(t))||(r&&t.valor<0))continue;
  if(Math.abs(b.valor+c.valor+(e?.valor||0)-(r?Math.abs(r.valor):0)-t.valor)<=0.021)combos.push({b,c,t,...(e?{e}:{}),...(r?{r}:{})});
 }
 // IVA 0 % impreso y ninguna cuota (inversión del sujeto pasivo, facturas en inglés, 2026-11-25: «Subtotal €23.45 | Tax 0% | Total
 // €23.45»): la base que es el total cuadra con cuota 0. Solo si ningún % impreso es otro (2026-11-25: «21,0% IVA | 0,00» de las
 // líneas de una certificación daba un 0 % falso y se aceptaba la base como total) y con su etiqueta de impuesto (el «0,00%» de
 // «Retenciones / Otros Conceptos | %» no es el IVA).
 // También con el 0 % en la columna «Tax» de TODAS las líneas (leída la tabla, 2026-11-26) y ningún otro % impreso.
 const ceroLineas=!P.length&&Array.isArray(ivaLineas)&&ivaLineas.length>0&&ivaLineas.every(v=>v===0);
 if(!combos.length&&((P.length&&P.every(p=>p.valor===0)&&P.some(p=>/IVA|VAT|TAX|IMPUESTO/.test(claveTotales(p.etiqueta))))||ceroLineas))for(const b of bases)for(const t of unicos(T))
  if(t.valor&&signo(b)===signo(t)&&Math.abs(b.valor-t.valor)<=0.011)
   combos.push({b,c:{literal:"0",valor:0,estado:"OK",motivos:[],notas:[ceroLineas?"IVA 0 % en la columna del impuesto de todas las líneas: cuota 0":"IVA 0 % impreso: cuota 0"]},t,...(ceroLineas?{p0:true}:{})});
 // Base y cuota se imprimen a veces con 4 y con 2 decimales (48,0000 y 48,00): al céntimo
 // son la misma combinación; se conserva la que tiene los importes en céntimos.
 const cent=v=>Math.round(v*100);
 const claveCombo=x=>[cent(x.b.valor),cent(x.c.valor),cent(x.t.valor),x.e?cent(x.e.valor):"",x.r?cent(x.r.valor):""].join("|");
 // Desglose por tipos de IVA (2026-11-25: una fila por tipo y la fila de totales; cada fila sola cuadra y es solo un tipo):
 // vale la combinación que es la suma de todas las demás.
 const todas=[...new Map(combos.map(x=>[claveCombo(x),x])).values()];
 const sumaDe=(xs,k)=>xs.reduce((n,x)=>n+x[k].valor,0);
 const desglose=todas.length>=3?todas.filter(X=>{const otras=todas.filter(y=>y!==X),tol=0.011*otras.length;
  return ["b","c","t"].every(k=>Math.abs(sumaDe(otras,k)-X[k].valor)<=tol);}):[];
 let elegidos;
 if(desglose.length===1)elegidos=[{...desglose[0],desglose:todas.length-1}];
 else{
  const conPct=combos.flatMap(x=>unicos(P).filter(p=>Math.abs(x.b.valor*p.valor/100-x.c.valor)<=0.021).map(p=>({...x,p})));
  elegidos=conPct.length?conPct:combos;
 }
 const decs=x=>[x.b,x.c].reduce((n,y)=>n+((String(y.literal).match(/,(\d+)/)||[,""])[1].length>2?1:0),0);
 const grupos=new Map();
 for(const x of elegidos){const k=claveCombo(x);const y=grupos.get(k);if(!y||decs(x)<decs(y))grupos.set(k,x);}
 const distintos=[...grupos.values()];
 const marcar=(x,estado,motivo)=>({...x,estado,motivos:motivo?[motivo]:[]});
 if(distintos.length===1){
  const x=distintos[0];
  res.base_imponible=marcar(x.b,"VERIFICADO");res.cuota_iva=marcar(x.c,"VERIFICADO");res.total=marcar(x.t,"VERIFICADO");
  if(x.p)res.iva_porcentaje=marcar(x.p,"VERIFICADO");
  else if(unicos(P).length===1)res.iva_porcentaje=marcar(unicos(P)[0],"OK");
  else if(x.p0)res.iva_porcentaje={literal:"0%",valor:0,estado:"VERIFICADO",motivos:[],notas:["IVA 0 % en la columna del impuesto de todas las líneas"]};
  if(x.e)res.exento=marcar(x.e,"VERIFICADO");
  if(x.r)res.retencion=marcar(x.r,"VERIFICADO");
  res.validacion={estado:"OK",detalle:"Base "+x.b.literal+" + IVA "+x.c.literal+(x.e?(/EXENT/.test(claveTotales(x.e.etiqueta||""))?" + exento ":" + suplidos ")+x.e.literal:"")+(x.r?" − retención "+x.r.literal:"")+
   " = total "+x.t.literal+(x.p?" (IVA "+x.p.valor+" %)":"")+(x.desglose?" (suma del desglose de "+x.desglose+" tipos de IVA)":"")};
  return res;
 }
 if(distintos.length>1){
  for(const k of ["base_imponible","cuota_iva","total"])res[k]={...vacio(),estado:"AMBIGUO",motivos:["Varias combinaciones de totales posibles"]};
  res.validacion={estado:"FALLO",detalle:"Varias combinaciones de base, IVA y total"};
  return res;
 }
 // Factura sin combinación por las etiquetas (2026-11-25: cada importe impreso un renglón por debajo de su etiqueta, y la
 // cuota leída como base): base, cuota y total por sus cifras, solo con una única terna impresa con base × % = cuota y
 // base + cuota = total (el % impreso), y si las cifras de las etiquetas son de esa terna.
 if(factura){
  const x=ternaDelPie(lineas,opcionesNumero,unicos(P).map(p=>p.valor)),vals=x?[x.b,x.c,x.t]:[];
  if(x&&[...B,...C,...T].every(y=>vals.some(z=>Math.abs(z.valor-y.valor)<0.006))){
   const nota="Por las cifras impresas: "+x.b.literal+" × "+x.p+" % = "+x.c.literal+" y "+x.b.literal+" + "+x.c.literal+" = "+x.t.literal;
   const poner=z=>({...z,estado:"VERIFICADO",motivos:[],notas:[nota],resolucion:{metodo:"terna_cifras_pie",evidencias:[nota]}});
   res.base_imponible=poner(x.b);res.cuota_iva=poner(x.c);res.total=poner(x.t);
   res.iva_porcentaje={literal:x.p+" %",valor:x.p,estado:"VERIFICADO",motivos:[],notas:[nota]};
   res.validacion={estado:"OK",detalle:nota};
   return res;
  }
 }
 // Sin combinación que cuadre. Si están los tres importes, se contradicen: REVISAR.
 // Si falta alguno, no hay contraste posible: lo leído queda como OK (no verificado; en una factura, a revisión al final).
 const completos=B.length&&C.length&&T.length;
 // Base y total a 0 de las filas vacías de un desglose («0,00 | 21% | 0,00»), si hay otro valor: no cuentan (2026-11-25).
 const uno=(a,k)=>{const u0=unicos(a),u=["base_imponible","total"].includes(k)&&u0.some(x=>x.valor)?u0.filter(x=>x.valor):u0;
  if(u.length===1)res[k]=completos?marcar(u[0],"REVISAR","Los totales no cuadran entre sí"):marcar(u[0],"OK");
  else if(u.length>1)res[k]={...vacio(),estado:"AMBIGUO",motivos:["Varios valores: "+u.map(x=>x.literal).join(" | ")]};};
 uno(B,"base_imponible");uno(P,"iva_porcentaje");uno(C,"cuota_iva");uno(T,"total");
 // Factura con total 0 (2026-11-25: «TOTAL COMPENSACION 0,00» aceptado como total).
 if(factura&&res.total.estado==="OK"&&!res.total.valor)res.total=marcar(res.total,"REVISAR","Total 0");
 if(completos)res.validacion={estado:"FALLO",detalle:"Base + IVA no coincide con el total impreso"};
 else if(B.length||C.length||T.length)res.validacion={estado:"NO_APLICA",detalle:"Faltan importes para contrastar base + IVA = total"};
 return res;
}
/*
 * Terna base, cuota y total por las cifras del pie (solo facturas, sin combinación por etiquetas): importes con dos decimales y un %
 * impreso (21, 10, 5 o 4) con base × % = cuota y base + cuota = total. Solo si hay UNA terna así; con dos (un desglose por tipos,
 * subtotales por albarán), ninguna.
 */
function ternaDelPie(lineas,opcionesNumero,pctsEtiqueta=[]){
 // También el % leído bajo su etiqueta («%» de la casilla del IVA, sin el signo en la cifra: 2026-11-25).
 const montos=[],pcts=new Set(pctsEtiqueta.filter(p=>[21,10,5,4].includes(p)));
 for(const l of lineas)for(const c of l.celdas){
  const txt=String(c.texto||"");
  for(const m of txt.matchAll(/(\d{1,2}(?:[.,]\d{1,3})?) ?%/g)){
   const n=N().numero(m[1],{...opcionesNumero,porcentaje:true});
   if(n.estado==="OK"&&[21,10,5,4].includes(n.valor))pcts.add(n.valor);
  }
  for(const t of piezasNumero(txt)){
   if(/%/.test(t)||!/[.,]\d{2}$/.test(t)||/^-?0\d/.test(t))continue;
   const n=N().numero(t,opcionesNumero);
   if(n.estado==="OK"&&n.valor>0)montos.push({...n,caja:caja(c)});
  }
 }
 const u=[...new Map(montos.map(x=>[Math.round(x.valor*100),x])).values()];
 const ternas=[];
 for(const p of pcts)for(const b of u){
  const q=Math.round(b.valor*p)/100;
  for(const c of u){
   if(c===b||Math.abs(q-c.valor)>0.011)continue;
   for(const t of u)if(t!==b&&t!==c&&Math.abs(b.valor+c.valor-t.valor)<=0.011)ternas.push({b,c,t,p});
  }
 }
 return ternas.length===1?ternas[0]:null;
}
/*
 * Forma de número de factura: serie de letras opcional y cifras («A 000123», «FV26-001234»), con la serie detrás («12345678 RX»), o un
 * código de letras y cifras con dos cifras o más («ES12AB34CDEF»). Nunca una fecha, un año suelto de estos años («2026» encima de
 * «F/000123» o bajo «Período de facturación»: 2026-11-25) ni una matrícula («1234BCD» bajo «FACTURA TALLER»).
 */
function esNumeroDeFactura(t,{espacio=false}={}){
 const s=String(t||"").trim();
 // También trozos de letras y cifras separados por «/» o «-», con dos cifras o más («ES/2026/X1-1234», «AbCdEfGhI-1234567890»:
 // facturas en inglés, 2026-11-25). Con un espacio, solo tras «Invoice number» y con la forma «CÓDIGO CIFRAS» («ABCDEFGH 0012»):
 // con cualquier etiqueta entraban «GIRO A 60 DIAS» o «GESTION COMERCIAL …» y el número bueno quedaba en duda.
 return (/^[A-Z]{0,4}[ \/-]?\d[\d.\/ -]{2,}( ?[A-Z]{1,3})?$/i.test(s)||/^(?=(?:[A-Z]*\d){2})[A-Z0-9]{8,20}$/i.test(s)||
   /^(?=(?:\D*\d){2})[A-Z0-9]{2,20}(?:[\/-][A-Z0-9]{1,20}){1,4}$/i.test(s)||(espacio&&/^[A-Z0-9]{6,12} \d{3,}$/.test(s)))&&
  !/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(s)&&!/^20[1-3]\d$/.test(s)&&!/^\d{4} ?[BCDFGHJKLMNPRSTVWXYZ]{3}$/i.test(s);
}
/*
 * ¿Factura de abono? Título de abono en la parte de arriba de la primera página («Abono», «Factura de abono», «Nota de abono»,
 * «Nota de crédito»), solo o con su número; nunca «abono en cuenta» (forma de pago) ni «TOTAL ABONO» (total a abonar = a pagar).
 * «Factura rectificativa» solo con un total impreso en negativo (una rectificativa también puede subir el importe).
 */
const RE_TITULO_ABONO=/^(ABONO|FACTURA (DE )?ABONO|NOTA (DE )?ABONO|NOTA DE CREDITO|CREDIT NOTE|CREDIT MEMO|REFUND)(?: N\S{0,3})?(?: \S*\d\S*)?$/;
const RE_TITULO_RECTIFICATIVA=/^(FACTURA )?RECTIFICATIVA(?: N\S{0,3})?(?: \S*\d\S*)?$/;
// Casilla suelta en su renglón (sin otra a menos de dos alturas): un título, no una palabra dentro de una frase.
const celdaSuelta=(l,i)=>{const c=l.celdas[i],a=l.celdas[i-1],b=l.celdas[i+1],h=Math.max(c.alto||0,4);
 return (!a||c.x0-a.x1>=2*h)&&(!b||b.x0-c.x1>=2*h);};
// Número del abono o de la rectificativa junto a su título («Abono | RA-26000111», «Factura rectificativa | 1500000111»): en la misma
// casilla o la primera a su derecha con forma de número; arriba (encima de la tabla o en el 40 % de la primera página) y título suelto.
function numeroDeTituloDeAbono(p,yTabla=null){
 if(!p)return null;
 // La casilla es solo el título y el número va en la de su derecha: ni «ABONO DIFERENCIA» (una línea de la factura) ni
 // «ABONO ES000…» bajo «REFERENCIA DEL CLIENTE» (la factura que abona) lo son (2026-11-25).
 const RE=/^(ABONO|FACTURA (DE )?ABONO|NOTA (DE )?ABONO|NOTA DE CREDITO|CREDIT NOTE|(FACTURA )?RECTIFICATIVA)( N\S{0,3})?$/;
 for(const l of p.lineas){
  if(l.y>=(yTabla??0.4*(p.alto||842)))continue;
  for(const [i,c] of l.celdas.entries()){
   if(!RE.test(clave(c.texto))||!celdaSuelta(l,i))continue;
   const der=l.celdas.slice(i+1).find(x=>limpiarValor(x.texto));
   if(der&&esNumeroDeFactura(limpiarValor(der.texto)))return {texto:limpiarValor(der.texto),celda:der,etiqueta:c.texto};
  }
 }
 return null;
}
function abonoImpreso(paginas,T,yTabla=null){
 const p=paginas[0];if(!p)return null;
 // Encima de la tabla de artículos (sin tabla, en el 40 % de arriba), como renglón propio o casilla suelta: nunca una palabra dentro de
 // una frase («***** 15% ABONO MARCA PROMO …» en una factura normal, 2026-11-25).
 // Título bilingüe con barra («Factura de deudor/Credit Note», 2026-11-25): su parte en inglés «Credit note» o «Credit memo» también.
 const bilingue=t=>{const p2=String(t||"").split("/");return p2.length===2?p2.map(clave).filter(k=>/^CREDIT (NOTE|MEMO)$/.test(k)):[];};
 const arriba=p.lineas.filter(l=>l.y<(yTabla??0.4*(p.alto||842)))
  .flatMap(l=>[clave(l.texto),...l.celdas.flatMap((c,i)=>celdaSuelta(l,i)?[clave(c.texto),...bilingue(c.texto)]:[])]).filter(Boolean);
 const abono=arriba.find(k=>RE_TITULO_ABONO.test(k));
 if(abono)return "título impreso «"+abono+"»";
 const negativo=T?._negativos?.[0],rect=arriba.find(k=>RE_TITULO_RECTIFICATIVA.test(k));
 if(rect&&negativo)return "«"+rect+"» con el total impreso en negativo («"+negativo.literal+"»)";
 return null;
}
function ponerEnNegativo(T,evidencia){
 for(const k of ["base_imponible","cuota_iva","total","exento"]){
  const x=T[k];if(!x||x.valor==null||!(x.valor>0))continue;
  T[k]={...x,valor:-x.valor,notas:[...(x.notas||[]),"Abono ("+evidencia+"): importe en negativo"]};
 }
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
/*
 * Importe leído dentro de la columna de descuento («50 3,30» con el importe vacío): el límite
 * entre ambas columnas depende de la lectura OCR. El último valor es el importe solo si tiene
 * forma de importe (dos decimales, sin «%») y la línea cuadra exactamente así; si no, se queda
 * como descuento en cascada (y la línea, sin importe, en revisión).
 */
function importeEnColumnaDescuento(f,opcionesNumero,precioPor){
 if(f.importe.estado!=="VACIO"||!f.descuento.cascada_por_espacios)return;
 const partes=f.descuento.literal.split(/\s+/),ultimo=partes[partes.length-1];
 if(partes.length<2||!/^\d{1,3}(?:[.\s]\d{3})*,\d{2}$|^\d+\.\d{2}$/.test(ultimo))return;
 const importe=N().numero(ultimo,opcionesNumero);
 const descuento=campoDescuento({texto:partes.slice(0,-1).join(" ")},opcionesNumero);
 if(importe.estado!=="OK"||!["OK","VACIO"].includes(descuento.estado))return;
 const prueba={...f,importe:{...importe,estado:"OK"},descuento};
 if(cuadre(prueba,precioPor).estado!=="VERIFICADO")return;
 const caja=f.descuento.caja,nota="Importe leído dentro de la columna de descuento («"+f.descuento.literal+"»): el cuadre de la línea lo confirma";
 f.importe={...importe,caja,conf_ocr:f.descuento.conf_ocr,notas:[...(importe.notas||[]),nota]};
 f.descuento={...descuento,caja,conf_ocr:f.descuento.conf_ocr,notas:[...(descuento.notas||[]),nota]};
}
/*
 * ¿Cuadra la línea? También un abono con la cantidad negativa y el importe impreso en positivo (fallo real 2026-11-20, proveedor
 * escaneado: «-1 × precio − 50 % = importe» con el importe sin signo): el mismo valor con otro signo. Solo para las resoluciones de abajo; el cuadre general no cambia.
 */
function cuadraAunConSigno(f,precioPor){
 if(cuadre(f,precioPor).estado==="VERIFICADO")return true;
 return f.cantidad?.estado==="OK"&&f.cantidad.valor<0&&f.importe?.estado==="OK"&&f.importe.valor>0&&
  cuadre({...f,cantidad:{...f.cantidad,valor:-f.cantidad.valor}},precioPor).estado==="VERIFICADO";
}
/*
 * Descuentos caídos en la columna del importe (fallo real 2026-11-20, albarán escaneado: «55+7» leído «55» y el «7» junto al importe;
 * «52» junto al importe con el descuento vacío): con enteros de 1 o 2 cifras a la izquierda y una cifra con decimales a la derecha,
 * se prueba que los enteros sean descuentos (en cascada tras los leídos) y la última el importe. Solo si la línea cuadra; si no,
 * «varias cifras en la misma columna» como siempre.
 */
function descuentoEnColumnaImporte(f,celda,opcionesNumero,precioPor){
 if(!celda?._otras?.length||!["OK","VACIO"].includes(f.descuento.estado))return false;
 const cel=[celda,...celda._otras].sort((a,b)=>a.x0-b.x0),textos=cel.map(c=>String(c.texto||"").trim());
 const ints=textos.slice(0,-1),ultimo=textos[textos.length-1];
 if(!ints.length||!ints.every(t=>/^\d{1,2}$/.test(t)&&+t>0)||!/[.,]\d{2,4}$/.test(ultimo))return false;
 const importe=N().numero(ultimo,opcionesNumero);
 if(importe.estado!=="OK")return false;
 const previos=f.descuento.estado==="OK"?String(f.descuento.literal||"").trim():"";
 const descuento=campoDescuento({texto:[previos,...ints].filter(Boolean).join(" ")},opcionesNumero);
 if(descuento.estado!=="OK")return false;
 if(!cuadraAunConSigno({...f,importe:{...importe,estado:"OK"},descuento},precioPor))return false;
 const nota="Descuento «"+ints.join(" ")+"» leído en la columna del importe («"+textos.join(" ")+"»): el cuadre de la línea lo confirma";
 const conf=Math.min(...cel.map(c=>c.conf??100));
 f.importe={...importe,caja:f.importe.caja,conf_ocr:conf,notas:[...(importe.notas||[]),nota]};
 f.descuento={...descuento,caja:f.descuento.caja,conf_ocr:f.descuento.conf_ocr,notas:[...(descuento.notas||[]),nota]};
 return true;
}
/*
 * Descuento con un punto detrás («50.», fallo real 2026-11-20): el punto no es un separador decimal (no hay cifras detrás). Se
 * acepta como el entero solo si la línea cuadra con él.
 */
function descuentoConPunto(f,opcionesNumero,precioPor){
 const lit=String(f.descuento.literal||"").trim();
 if(f.descuento.estado!=="AMBIGUO"||!/^\d{1,2}\.$/.test(lit))return;
 const descuento=campoDescuento({texto:lit.slice(0,-1)},opcionesNumero);
 if(descuento.estado!=="OK"||!cuadraAunConSigno({...f,descuento},precioPor))return;
 f.descuento={...descuento,literal:lit,caja:f.descuento.caja,conf_ocr:f.descuento.conf_ocr,notas:[...(descuento.notas||[]),"Descuento «"+lit+"»: el punto final no es decimal; el cuadre de la línea lo confirma"]};
}
/*
 * Cantidad ilegible (tapada por una firma o un sello) con precio, descuento e importe
 * válidos: se calcula qué cantidad haría cuadrar la línea y se ofrece al revisor como
 * sugerencia. NUNCA se asigna como valor: la cantidad queda vacía y la línea en revisión.
 */
function sugerirCantidad(f,precioPor){
 if(!["VACIO","INVALIDO"].includes(f.cantidad.estado)||f.precio.estado!=="OK"||f.importe.estado!=="OK"||!f.precio.valor)return;
 if(f.descuento.estado!=="OK"&&f.descuento.estado!=="VACIO")return;
 const factor=f.descuento.estado==="OK"?f.descuento.factor:1;
 const q0=f.importe.valor/(f.precio.valor/precioPor*factor);
 for(const d of [0,1,2,3]){
  const q=redondear(q0,d);
  // En negativo solo con el importe impreso en negativo: una devolución (fallo real 2026-11-25: «-1,00 Caja» sin leer, importe -7,43).
  if(q===0||(q<0&&!(f.importe.valor<0)))continue;
  if(cuadre({...f,cantidad:{estado:"OK",valor:q}},precioPor).estado==="VERIFICADO"){
   f.cantidad.sugerida=q;
   f.cantidad.motivos=[...(f.cantidad.motivos||[]),"Cantidad no legible; el cuadre de la línea indica "+q+" (sugerencia para el revisor, no se asigna)"];
   return;
  }
 }
}
function cuadre(f,precioPor){
 const ok=x=>x.estado==="OK";
 if(f.precio.estado==="VACIO"&&f.importe.estado==="VACIO"&&f.subtotal.estado==="VACIO")
  return {estado:"SIN_PRECIOS",detalle:"Albarán sin precios en esta línea"};
 if(!ok(f.cantidad)||!ok(f.precio)||!ok(f.importe)||(f.descuento.estado!=="OK"&&f.descuento.estado!=="VACIO"))
  return {estado:"INCOMPLETO",detalle:"Falta un valor válido de cantidad, precio, descuento o importe"};
 const factor=f.descuento.estado==="OK"?f.descuento.factor:1;
 const decImporte=f.importe.decimales||2;
 // Con 3 o 4 decimales impresos la tolerancia es la de esos decimales (0,011 aceptaba un importe con la última cifra mal leída).
 const tol=decImporte>2?1.1*10**-decImporte:0.011;
 // Abono con la cantidad negativa y el importe impreso en positivo (fallo real 2026-11-20): se compara el valor.
 const qv=f.cantidad.valor<0&&f.importe.valor>0?-f.cantidad.valor:f.cantidad.valor;
 const cumple=por=>{
  const bruto=qv*f.precio.valor/por;
  const q=qv,p=f.precio.valor/por;
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
function hipotesisOCR(campo,opcionesNumero,{digitoInicial=false}={}){
 const lit=String(campo?.literal||"").replace(/\s+/g,"");
 const out=[];
 if(["OK","VERIFICADO"].includes(campo?.estado))out.push({valor:campo.valor,reparado:null});
 if(campo?.conf_ocr==null||!lit)return out;
 const pon=t=>{const n=N().numero(t,{...opcionesNumero,formatoConfirmado:true});if(n.estado==="OK"&&!out.some(o=>o.valor===n.valor))out.push({valor:n.valor,reparado:t,decimales:n.decimales});};
 // Importe con la primera cifra perdida («11,4068» leído «1,4068»: unos finos pegados al borde). Solo con 4 o más cifras
 // leídas, que el cuadre tiene que reproducir todas; la cifra perdida la decide el cuadre y solo si una única la explica.
 if(digitoInicial&&/^\d{1,3},\d{2,4}$/.test(lit)&&lit.replace(/\D/g,"").length>=4)for(let d=1;d<=9;d++)pon(d+lit);
 if(/^\d+\.\d{2,4}$/.test(lit)&&!/^\d{1,3}\.\d{3}$/.test(lit))pon(lit.replace(".",","));
 if(/^\d{1,3}(\.\d{3})*\.\d{2,4}$/.test(lit))pon(lit.replace(/\.(\d{2,4})$/,",$1"));
 if(/^\d{3,}$/.test(lit))for(const d of [opcionesNumero.decimales,2,4].filter((x,i,a)=>x&&a.indexOf(x)===i))
  if(lit.length>d)pon(lit.slice(0,-d)+","+lit.slice(-d));
 return out;
}
/*
 * Cuadre con dos escalas (fallo real 2026-11-24, albarán escaneado: precio e importe leídos sin coma en la misma fila, p. ej. «3750» y «075»; el cuadre
 * 0,020 × 3750 = 75 sale igual que 0,020 × 37,50 = 0,75 y las cifras sin coma se aceptaban). Una línea que cuadra tal cual y TAMBIÉN con
 * el separador decimal repuesto en alguna de sus cifras (las mismas hipótesis de hipotesisOCR, solo en OCR) tiene dos lecturas
 * plausibles: devuelve las cifras de la otra (con `reparado` en las que cambian), o null si no hay otra.
 */
function otraEscalaQueCuadra(f,opcionesNumero,precioPor){
 const campos=["cantidad","precio","importe"];
 const opciones=campos.map(k=>hipotesisOCR(f[k],opcionesNumero));
 if(opciones.some(o=>!o.length)||!opciones.some(o=>o.some(x=>x.reparado)))return null;
 for(const q of opciones[0])for(const p of opciones[1])for(const i of opciones[2]){
  if(!q.reparado&&!p.reparado&&!i.reparado)continue;
  const prueba={...f,cantidad:{...f.cantidad,valor:q.valor,estado:"OK"},precio:{...f.precio,valor:p.valor,estado:"OK"},
   importe:{...f.importe,valor:i.valor,estado:"OK",decimales:i.decimales??f.importe.decimales}};
  if(cuadre(prueba,precioPor).estado==="VERIFICADO")return {cantidad:q,precio:p,importe:i};
 }
 return null;
}
function repararSeparadoresOCR(f,opcionesNumero,precioPor){
 const campos=["cantidad","precio","importe"];
 const opciones=campos.map(k=>hipotesisOCR(f[k],opcionesNumero,{digitoInicial:k==="importe"}));
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
   notas:[...(f[k].notas||[]),(h.reparado.replace(/\D/g,"").length>String(f[k].literal).replace(/\D/g,"").length?"Primera cifra perdida por el OCR":"Separador decimal del OCR corregido")+
    " («"+f[k].literal+"» → «"+h.reparado+"») y confirmado por el cuadre"]};
 });
 // Cuadra tras reparar la lectura: al comparar lecturas OCR, vale menos que una que cuadra tal cual (escaneado.js, puntuar).
 f.cuadre={...cuadre(f,precioPor),reparado:true};
}

/*
 * Símbolos que el OCR no conoce y sustituye por letras, solo donde el perfil del proveedor lo
 * declara con su contexto: «PRENSAR Ø54X2» se lee «PRENSAR M54X2» / «Y54X2» / «W54X2» según la
 * lectura. Solo para páginas escaneadas (en un PDF digital el símbolo viene en el texto).
 */
function restituirGlifos(texto,perfil){
 let t=String(texto??"");
 for(const [patron,reemplazo] of perfil?.glifos_ocr||[])t=t.replace(new RegExp(patron,"g"),reemplazo);
 return t;
}
/*
 * Precio sin título de columna (fallo real 2026-11-23: cabecera «Código | Descripción | Unidades | Dto.(%) | Importe Total»
 * sin «Precio» leído; la fila «cantidad | precio | dto | importe» dejaba el precio al final de la descripción y el precio vacío).
 * La última cifra de la descripción pasa a precio solo si no hay casilla de precio, cantidad, descuento e importe son
 * válidos y con ella la línea cuadra. Cantidad 1 sin descuento no es prueba (cualquier cifra igual al importe cuadraría).
 */
function precioAlFinalDeLaDescripcion(f,celdas,opcionesNumero,precioPor){
 if(celdas.precio?.texto||f.precio.estado!=="VACIO"||f.cantidad.estado!=="OK"||f.importe.estado!=="OK")return;
 if(!["OK","VACIO"].includes(f.descuento.estado)||!["OK","REVISAR"].includes(f.descripcion.estado))return;
 const m=String(f.descripcion.literal||"").match(/^(.*[A-Za-zÁÉÍÓÚÑÜáéíóúñü].*?)\s+(\d{1,3}(?:\.\d{3})*,\d{2,4})$/);
 if(!m)return;
 const p=N().numero(m[2],opcionesNumero);
 if(p.estado!=="OK"||!(p.valor>0))return;
 if(Math.abs(f.cantidad.valor)===1&&f.descuento.estado!=="OK")return;
 const precio={...f.precio,...p,literal:m[2],caja:f.descripcion.caja??null,conf_ocr:f.descripcion.conf_ocr??null,por:precioPor,
  notas:[...(p.notas||[]),"Precio leído al final de la descripción (la columna del precio no tiene título) y confirmado por el cuadre"]};
 if(cuadre({...f,precio},precioPor).estado!=="VERIFICADO")return;
 f.precio=precio;
 // La descripción no se acepta sola: el cuadre confirma la cifra, no el texto (caso real: un «º» leído «%» en todas las
 // lecturas del mismo motor; sin la cifra pegada, las relecturas coincidían y se habría aceptado mal).
 f.descripcion={...f.descripcion,literal:m[1].trim(),valor:m[1].trim(),estado:"REVISAR",
  motivos:[...(f.descripcion.motivos||[]),"Descripción leída junto con la cifra del precio (columna sin título): se revisa el texto"],
  notas:[...(f.descripcion.notas||[]),"Precio «"+m[2]+"» separado del final de la descripción"]};
}
/*
 * Concepto de una factura de servicios (gestoría, 2026-11-24; usuario: «cantidad 1»): sin cantidad ni precio impresos, cantidad 1 y precio
 * = su importe. No son lecturas: quedan en revisión hasta que los conceptos cuadran con los totales impresos (verificarServicios).
 */
function conceptoDeServicio(f){
 if(f.cantidad.estado!=="VACIO"||f.precio.estado!=="VACIO"||!["OK","VERIFICADO"].includes(f.importe.estado)||!(f.importe.valor>0))return;
 const nota="Concepto sin cantidad (factura de servicios): cantidad 1 y precio = importe";
 f.cantidad={literal:"",valor:1,estado:"REVISAR",motivos:["Sin cantidad impresa: 1 (se confirma con los totales)"],notas:[nota],implicita:true};
 f.precio={literal:f.importe.literal,valor:f.importe.valor,estado:"REVISAR",motivos:["Precio = importe del concepto (se confirma con los totales)"],notas:[nota],
  por:1,caja:f.importe.caja,conf_ocr:f.importe.conf_ocr};
 f.servicio=true;
 f.cuadre={estado:"NO_APLICA",detalle:"concepto de servicios: se confirma con los totales impresos"};
 f.motivos=f.motivos.filter(m=>!/^(Cantidad|Cuadre incompleto|precio)/i.test(m));
 f.motivos.push("Concepto de servicios: se confirma con los totales impresos");
 f.estado="REVISAR";
}
/*
 * Conceptos de servicios contra los totales impresos (con sus etiquetas, verificados entre sí): los suplidos («SUPLIDOS …») suman los
 * gastos suplidos y los demás la base imponible. Si cuadran los dos, cantidad, precio e importe de cada concepto quedan verificados y
 * cada uno con su IVA: 0 los suplidos, el % impreso los demás. Si no, siguen en revisión. Todas las líneas han de ser conceptos.
 */
function verificarServicios(salida){
 const conceptos=salida.lineas.filter(l=>l.servicio);
 if(!conceptos.length||conceptos.length!==salida.lineas.length)return;
 const T=salida.totales||{},ok=c=>c?.estado==="VERIFICADO"&&c.valor!=null;
 if(!ok(T.base_imponible)||!ok(T.total))return;
 // Exentos (su columna de IVA dice «EXENTO», 2026-11-26) como los suplidos: suman la base exenta impresa, sin IVA.
 const suplido=l=>/^SUPLIDOS?\b/.test(clave(l.descripcion?.valor||""))||l.iva_linea?.exento===true;
 const suma=a=>Math.round(a.reduce((n,l)=>n+(Number(l.importe.valor)||0),0)*100)/100;
 const sup=conceptos.filter(suplido),resto=conceptos.filter(l=>!suplido(l));
 if(sup.length&&!ok(T.exento))return;
 if(Math.abs(suma(sup)-(sup.length?T.exento.valor:0))>0.011||Math.abs(suma(resto)-T.base_imponible.valor)>0.011)return;
 const pct=ok(T.iva_porcentaje)?T.iva_porcentaje.valor:null;
 // Con la columna del IVA, el tipo de cada concepto es el suyo y la cuota impresa ha de ser la de esas bases (si no, nada se confirma).
 const conColumna=resto.some(l=>l.iva_linea);
 if(conColumna){
  if(resto.some(l=>!(l.iva_linea?.valor>0)))return;
  const cuota=Math.round(resto.reduce((n,l)=>n+Number(l.importe.valor)*l.iva_linea.valor/100,0)*100)/100;
  if(!ok(T.cuota_iva)||Math.abs(cuota-T.cuota_iva.valor)>0.011*Math.max(1,resto.length))return;
 }
 for(const l of conceptos){
  const s=suplido(l),ex=l.iva_linea?.exento===true,tipo=s?0:conColumna?l.iva_linea.valor:pct;
  const nota=s?(ex?"Exento: suman la base imponible exenta impresa ("+T.exento.literal+"), sin IVA":"Suplido: suman los gastos suplidos impresos ("+T.exento.literal+"), sin IVA")
   :"Suman la base imponible impresa ("+T.base_imponible.literal+")"+(conColumna?", con el IVA de su columna":"");
  for(const k of ["cantidad","precio","importe"])l[k]={...l[k],estado:"VERIFICADO",motivos:[],notas:[...(l[k].notas||[]).filter(n=>n!==nota),nota]};
  l.iva={valor:tipo,estado:tipo!=null?"VERIFICADO":"VACIO",motivos:[],notas:[nota]};
  l.cuadre={estado:"VERIFICADO",detalle:"concepto de servicios: "+nota};
  l.motivos=l.motivos.filter(m=>!/^Concepto de servicios/.test(m));
  l.estado=l.motivos.length?"REVISAR":"OK";
 }
}
// Dígito de control de un código EAN-13.
function eanValido(t){
 if(!/^\d{13}$/.test(String(t||"")))return false;
 const d=[...String(t)].map(Number),s=d.slice(0,12).reduce((a,x,i)=>a+x*(i%2?3:1),0);
 return (10-s%10)%10===d[12];
}
/*
 * Arreglos de la casilla del código que no dejan dudas sobre lo leído (cambian el literal, no la confianza):
 *  - EAN-13 con 1 a 3 signos sueltos delante (fallo real 2026-11-24/25: «ON 84000…», «añ 84000…»: trozos del
 *    «ALBARÁN» vertical del margen leídos con el código): el código es el EAN, con su dígito de control comprobado.
 *  - «£» o «€» dentro de un código: el OCR lee así la «E» (fallo real 2026-11-25: «0XXD£0001…» por «0XXDE0001…»). Las demás confusiones
 *    de letras y cifras siguen en revisión, como siempre.
 *  - Código con el principio de la descripción pegado detrás tras la raya de la columna («CODIGO0030 [Palabra palabra» y la descripción
 *    «Resto …», fallo real 2026-11-25): el código es el primer trozo; las palabras van delante de la descripción, que queda en
 *    revisión. Solo con ese signo en medio («[», «|» o «(»): sin él, la frontera es dudosa y se queda como estaba (en revisión).
 */
function arreglarReferencia(f){
 const lit=String(f.referencia.literal||"").trim();
 const nota=(t,motivo)=>{f.referencia={...f.referencia,literal:t,valor:t||null,notas:[...(f.referencia.notas||[]),motivo]};};
 let m=lit.match(/^(\S{1,3})\s+(\d{13})$/);
 if(m&&/\D/.test(m[1])&&eanValido(m[2])){nota(m[2],"«"+m[1]+"» delante del código EAN-13 (dígito de control válido) quitado: texto del margen");return;}
 if(/[£€]/.test(lit)&&/^[A-Za-z0-9£€.\/-]{4,}$/.test(lit)){nota(lit.replace(/[£€]/g,"E"),"«£» o «€» leído en lugar de la «E» del código");return;}
 m=lit.match(/^([A-Za-z0-9][A-Za-z0-9.\/-]{3,})\s*[\[|(]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}(?: [A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})*)$/);
 const desc=String(f.descripcion.literal||"").trim();
 if(m&&/\d/.test(m[1])&&desc&&!N().canon(desc).startsWith(N().canon(m[2]))){
  nota(m[1],"Principio de la descripción («"+m[2]+"») separado del código");
  const d=m[2]+" "+desc;
  f.descripcion={...f.descripcion,literal:d,valor:d,estado:"REVISAR",motivos:[...(f.descripcion.motivos||[]),"El principio de la descripción («"+m[2]+"») estaba en la casilla del código"]};
 }
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
 // Tipo de IVA del concepto en su columna («21,00 %» o «EXENTO»; factura de servicios con la base de cada concepto, 2026-11-26).
 if(c.iva){
  const t=String(c.iva.texto||"").trim(),m=t.match(/^(\d{1,2}(?:[.,]\d{1,2})?)\s*%$/);
  f.iva_linea=/^EXENT[OA]S?$/.test(clave(t))?{literal:t,valor:0,exento:true}:m?{literal:t,valor:Number(m[1].replace(",","."))}:{literal:t,valor:null};
 }
 arreglarReferencia(f);
 // Cantidad con la unidad pegada («8,00 UD», «20 SAC», «3,5 M2»).
 if(f.cantidad.estado==="INVALIDO"){
  const m=f.cantidad.literal.match(RE_CANTIDAD_UNIDAD);
  if(m){
   const n=N().numero(m[1],opcionesNumero);
   f.cantidad={...n,literal:f.cantidad.literal,caja:f.cantidad.caja,notas:[...n.notas,"Unidad impresa junto a la cantidad: "+m[2]]};
   if(f.unidad.estado==="VACIO")f.unidad={...f.unidad,literal:m[2],valor:m[2],estado:"OK"};
  }
 }
 // Cantidad y precio pegados en el original («1,00001.250,0000»): se separan solo si
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
 // «NETO» (sin descuento) de la columna del descuento leído al final de la descripción (prueba real
 // 2026-10-28): no es parte de la descripción; el cuadre de la línea decide. También leído «NETO:» o «NETO.» (albarán real
 // 2026-11-25: la descripción acababa en «… NETO:» y la línea no casaba con la de su pedido).
 if(f.descuento.estado==="VACIO"&&!f.descuento.literal&&/\sNETO[:.]?$/.test(f.descripcion.literal||"")&&(c.precio||c.importe)){
  f.descripcion={...f.descripcion,literal:f.descripcion.literal.replace(/\s+NETO[:.]?$/,""),valor:f.descripcion.literal.replace(/\s+NETO[:.]?$/,""),
   notas:[...(f.descripcion.notas||[]),"«NETO» de la columna del descuento separado de la descripción"]};
  f.descuento={...campoDescuento({texto:"NETO"},opcionesNumero),caja:null,conf_ocr:null,notas:["«NETO» impreso: precio neto, sin descuento"]};
 }
 if(cruda.continuaciones.length){
  f.descripcion.literal=[f.descripcion.literal,...cruda.continuaciones].filter(Boolean).join(" ");
  f.descripcion.valor=f.descripcion.literal||null;f.descripcion.estado=f.descripcion.literal?"OK":"VACIO";
  f.notas.push("Descripción en "+(cruda.continuaciones.length+1)+" renglones"+(cruda.cifrasEnSegundoRenglon?"; las cifras van en el último":""));
 }
 if(cruda.continuacionRef?.length){
  f.referencia={...f.referencia,literal:[f.referencia.literal,...cruda.continuacionRef].join(" "),
   estado:"REVISAR",motivos:[...(f.referencia.motivos||[]),"Código en dos renglones: se ha unido el segundo («"+cruda.continuacionRef.join(" ")+"»)"]};
  f.referencia.valor=f.referencia.literal;
  f.motivos.push("Código en dos renglones");
 }
 if(cruda.continuacionesDudosas?.length){
  f.descripcion.literal=[f.descripcion.literal,...cruda.continuacionesDudosas].filter(Boolean).join(" ");
  f.descripcion.valor=f.descripcion.literal||null;f.descripcion.estado="REVISAR";
  f.descripcion.motivos=[...(f.descripcion.motivos||[]),"Continuación leída con baja confianza OCR (texto tachado, rodeado o manuscrito)"];
 }
 // Primer renglón del artículo con su código, leído con poca confianza (fallo real 2026-11-25): su código y el principio de la
 // descripción, en revisión (nunca aceptados: ese renglón se leyó mal).
 if(cruda.primerRenglon&&f.referencia.estado==="VACIO"){
  const p=cruda.primerRenglon,d=[p.descripcion,...(p.resto||[]),f.descripcion.literal].filter(Boolean).join(" ").replace(/\s+/g," ").trim();
  f.referencia={...f.referencia,literal:p.referencia,valor:p.referencia,estado:"REVISAR",motivos:[...(f.referencia.motivos||[]),"Código del primer renglón de la línea, leído con poca confianza OCR"]};
  f.descripcion={...f.descripcion,literal:d,valor:d||null,estado:"REVISAR",motivos:[...(f.descripcion.motivos||[]),"Descripción en varios renglones; el primero, leído con poca confianza OCR"]};
  f.motivos.push("Línea en varios renglones: el primero, con el código, leído con poca confianza");
 }
 if(cruda.textoPrevio){
  f.descripcion.estado=f.descripcion.estado==="VACIO"?"VACIO":"REVISAR";
  f.descripcion.texto_previo=cruda.textoPrevio;
  f.descripcion.motivos=[...(f.descripcion.motivos||[]),"Texto justo encima de la línea: «"+cruda.textoPrevio+"» (¿primer renglón de la descripción o anotación?)"];
 }
 const importeResuelto=cruda.conflictos.includes("importe")&&descuentoEnColumnaImporte(f,cruda.celdas?.importe,opcionesNumero,precioPor);
 for(const campo of cruda.conflictos){
  if(campo==="importe"&&importeResuelto)continue;
  // La columna del IVA de un concepto con dos cifras: sin tipo (el concepto no se confirma).
  if(campo==="iva"){f.iva_linea={literal:String(c.iva?.texto||""),valor:null};continue;}
  if(!f[campo])continue;
  f[campo]={...f[campo],valor:null,estado:"AMBIGUO",motivos:[...(f[campo].motivos||[]),"Varias cifras en la misma columna"]};
 }
 importeEnColumnaDescuento(f,opcionesNumero,precioPor);
 descuentoConPunto(f,opcionesNumero,precioPor);
 precioAlFinalDeLaDescripcion(f,c,opcionesNumero,precioPor);
 f.cuadre=cuadre(f,precioPor);
 // Descuento sin título (asignar, _sinTitulo): solo si con él la línea cuadra con su importe; si no, como antes, dos cifras en
 // la columna del precio y ninguna se acepta.
 if(cruda.celdas.descuento?._sinTitulo){
  if(f.cuadre.estado==="VERIFICADO")f.notas.push("Descuento sin título junto al precio: aceptado porque la línea cuadra con su importe");
  else{
   f.descuento=campoDescuento(undefined,opcionesNumero);
   f.precio={...f.precio,valor:null,estado:"AMBIGUO",motivos:[...(f.precio.motivos||[]),"Varias cifras en la misma columna"]};
   f.cuadre=cuadre(f,precioPor);
  }
 }
 // Cuadra tal cual y también con la coma en otro sitio: dos lecturas plausibles, ninguna se acepta (ni se «repara»: la reparación
 // escogería la otra sin más prueba). Si otra lectura OCR de la misma fila cuadra sin ambigüedad, escaneado.js toma sus cifras.
 const otraEscala=f.cuadre.estado==="VERIFICADO"?otraEscalaQueCuadra(f,opcionesNumero,precioPor):null;
 if(otraEscala){
  const dudas=["cantidad","precio","importe"].filter(k=>otraEscala[k].reparado).map(k=>"«"+f[k].literal+"» o «"+otraEscala[k].reparado+"»").join(", ");
  f.cuadre={estado:"AMBIGUO",detalle:"la línea cuadra con dos lecturas de sus cifras: "+dudas};
  for(const k of ["cantidad","precio","importe","subtotal"])if(f[k]?.estado==="OK")
   f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"La línea cuadra también con la coma en otro sitio ("+dudas+")"]};
  f.motivos.push("Cuadre con dos lecturas posibles: "+dudas+" (¿coma no leída por el OCR?)");
 }
 if(f.cuadre.estado!=="VERIFICADO"&&f.cuadre.estado!=="AMBIGUO")repararSeparadoresOCR(f,opcionesNumero,precioPor);
 sugerirCantidad(f,precioPor);
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
 // Casilla del código con el principio de la descripción («100200 RACOR» por «GF RACOR MANGUERA…»;
 // «Yeso proyectar» en un proveedor sin columna de código): la descripción leída puede estar
 // incompleta, no se acepta sola (fallo real 2026-10-23: 8 descripciones sin su primera palabra
 // aceptadas). Un código con espacios propio («CUT PEDOBLAM1/4X3/8 (20M)») no termina en palabra.
 const tokensRef=String(f.referencia.literal||"").trim().split(/\s+/).filter(Boolean);
 const pegada=tokensRef.length>1&&/^[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{3,}\.?$/.test(tokensRef.at(-1));
 if(f.descripcion.estado==="OK"&&tokensRef.length&&(pegada||perfil?.sin_columna_codigo)){
  f.descripcion={...f.descripcion,estado:"REVISAR",motivos:[...(f.descripcion.motivos||[]),
   pegada?"El código lleva texto pegado («"+tokensRef.at(-1)+"»): puede faltar el principio de la descripción":
    "El proveedor no imprime código: lo leído como código («"+f.referencia.literal+"») puede ser el principio de la descripción"]};
 }
 if(cruda.partida)f.columnas_estimadas=true;
 // Columna cuyo título no se pudo leer: asignada por posición, no se acepta sin revisión.
 for(const k of cruda.titulosInferidos||[])if(f[k]?.estado==="OK"){
  f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"Título de la columna ilegible: columna deducida por su posición"]};
  if(!f.motivos.includes("Títulos de columna deducidos por posición"))f.motivos.push("Títulos de columna deducidos por posición");
 }
 // OCR con la fila en un solo bloque: el cuadre confirma las cifras, pero no dónde acaba el
 // código y empieza la descripción (la posición de cada palabra es estimada).
 const ocr=Object.values(cruda.celdas).some(c=>c?.conf!=null);
 if(cruda.textoEstimado&&ocr&&f.cuadre.estado==="VERIFICADO"){
  for(const k of ["referencia","descripcion"])
   if(f[k].estado==="OK")f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"Frontera entre código y descripción estimada (fila leída en un solo bloque)"]};
  f.motivos.push("Código y descripción separados por posición estimada");
 }
 // «mil» (millar) es una unidad válida, pero el OCR la produce también desde «ml» con una «i»
 // de más; el cuadre no la confirma (no depende de la unidad). Dos lecturas plausibles: revisión.
 if(ocr&&/^mil\.?$/i.test(f.unidad.valor||"")&&f.unidad.estado==="OK"){
  f.unidad={...f.unidad,estado:"REVISAR",motivos:[...(f.unidad.motivos||[]),"«"+f.unidad.literal+"» puede ser «ml» mal leído por el OCR"]};
  f.motivos.push("Unidad «"+f.unidad.literal+"»: posible «ml» mal leído");
 }
 if(cruda.partida&&f.cuadre.estado!=="VERIFICADO"){
  f.motivos.push("Columnas separadas por posición estimada y sin cuadre que lo confirme");
  for(const k of ["referencia","descripcion","cantidad","unidad","precio","descuento","importe"])
   if(f[k].estado==="OK")f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"Posición de columna estimada"]};
 }
 // Fila sin código ni descripción con alguna cifra («7»: trazo de una firma en la columna de la
 // cantidad): no es un artículo seguro y sus cifras no se aceptan solas (fallo real 2026-10-23).
 // Las que cuadran (cantidad × precio = importe) sí son cifras impresas.
 if(f.referencia.estado==="VACIO"&&f.descripcion.estado==="VACIO")
  for(const k of ["cantidad","precio","descuento","subtotal","importe"])if(f[k]?.estado==="OK")
   f[k]={...f[k],estado:"REVISAR",motivos:[...(f[k].motivos||[]),"Fila sin código ni descripción (posible trazo o anotación)"]};
 if(f.cantidad.valor===0)f.motivos.push("Cantidad 0 (posible pendiente de servir)");
 if(["AMBIGUO","INVALIDO","VACIO"].includes(f.cantidad.estado))
  f.motivos.push("Cantidad: "+(f.cantidad.motivos[0]||"celda vacía"));
 for(const k of ["precio","descuento","importe","subtotal"])
  if(["AMBIGUO","INVALIDO"].includes(f[k].estado))f.motivos.push(k+": "+(f[k].motivos[0]||f[k].estado));
 if(f.descripcion.estado==="REVISAR")f.motivos.push("Descripción: "+(f.descripcion.motivos[f.descripcion.motivos.length-1]||"revisar"));
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
 // Campo resuelto en la segunda fase (relectura dirigida y validación): su confianza la fija la resolución.
 if(e==="OK"&&typeof c.resolucion?.confianza==="number")return c.resolucion.confianza;
 if(e==="VERIFICADO")return 0.99;
 if(e==="REVISAR")return 0.5;
 if(e==="AMBIGUO"||e==="INVALIDO")return 0.15;
 if(e==="VACIO"||e==="NIF_NO_REGISTRADO"&&!c.nif)return obligatorio?0:(c.conf_ocr===undefined||c.conf_ocr===null?0.97:0.9);
 const ocr=c.conf_ocr;
 if(ocr===null||ocr===undefined)return 0.96;
 // Sin verificación independiente, solo una lectura OCR muy segura se considera fiable.
 return ocr>=90?0.95:ocr>=80?0.85:ocr>=60?0.75:0.6;
}
// ¿La cantidad de la línea es un entero de 3 o más cifras («400») y alguna otra línea la imprime con decimales («2,00»)?
function comaPerdida(l,lineas){
 const cifra=x=>(String(x?.literal??"").trim().match(/^-?[\d.,]+/)||[""])[0];
 const propia=cifra(l.cantidad);
 if(!/^-?\d{3,}$/.test(propia))return false;
 return lineas.some(o=>o!==l&&/^-?\d+[.,]\d{1,3}$/.test(cifra(o.cantidad)));
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
  // OCR: cantidad entera de 3 o más cifras, sin cuadre que la confirme, entre cantidades impresas con decimales («2,00»):
  // la coma puede no haberse leído (fallo real 2026-11-12, Isolana sin precios: «4,00 UN» leído «400 UN» y aceptado).
  if(salida.tipo_pdf!=="DIGITAL"&&l.cantidad?.estado==="OK"&&partes.cantidad>=0.9&&comaPerdida(l,salida.lineas)){
   partes.cantidad=0.5;
   const m="Cantidad sin decimales entre cantidades con decimales: la coma puede no haberse leído";
   if(!(l.cantidad.motivos||[]).includes(m)){l.cantidad.motivos=[...(l.cantidad.motivos||[]),m];l.motivos=[...(l.motivos||[]),"Cantidad: "+m];}
  }
  // OCR, línea con cifras pero sin cuadre: una cifra vacía puede estar impresa y no leída.
  if(salida.tipo_pdf!=="DIGITAL"&&l.cuadre?.estado==="INCOMPLETO")
   for(const k of ["precio","descuento","importe"])if(l[k]?.estado==="VACIO")partes[k]=Math.min(partes[k]??1,0.5);
  // OCR: un código que mezcla letras y dígitos con caracteres confundibles (O/0, S/5, I/1/l, B/8,
  // Z/2, G/6) no es fiable solo por OCR, ni con relecturas: todas confunden igual esos pares
  // (caso real «12SOP3456» leído «1250P3456» por todas las estrategias).
  // Excepción: la visión del recorte (otro motor) lee exactamente lo mismo que el OCR y el código no
  // tiene O/0 ni I/1/l, los pares que en muchas fuentes son idénticos (S/5, Z/2, B/8, G/6 no lo son).
  const ref=String(l.referencia?.valor||"");
  const confirmadoVision=l.referencia?.resolucion?.metodo==="vision_coincide_ocr"&&!/[O0I1l]/.test(ref);
  if(salida.tipo_pdf!=="DIGITAL"&&/[A-Z]/i.test(ref)&&/\d/.test(ref)&&/[O0S5I1lB8Z2G6]/.test(ref)&&partes.referencia>0.85&&!l.referencia.validado_catalogo&&!l.referencia.validado_confirmada&&!confirmadoVision){
   partes.referencia=0.85;
   const m="Código alfanumérico con caracteres que el OCR confunde (O/0, S/5, I/1, B/8, Z/2, G/6): requiere validación";
   if(!(l.referencia.motivos||[]).includes(m))l.referencia.motivos=[...(l.referencia.motivos||[]),m];
  }
  // Perfil con formato de código: un código que no lo tiene no se acepta por sí solo (fallo real 2026-11-13: la anotación
  // «OBRA *** NOMBRE 1,00» aceptada como artículo «OBRA»). El catálogo o una confirmación sí pueden validarlo.
  const refFormato=perfil?.formato_referencia?new RegExp(perfil.formato_referencia):null;
  if(refFormato&&ref&&!refFormato.test(ref.trim())&&partes.referencia>0.5&&!l.referencia.validado_catalogo&&!l.referencia.validado_confirmada){
   partes.referencia=0.5;
   const m="El código no tiene el formato de código del proveedor";
   if(!(l.referencia.motivos||[]).includes(m))l.referencia.motivos=[...(l.referencia.motivos||[]),m];
  }
  for(const [k,v] of Object.entries(partes))if(l[k]&&v!==null)l[k].confianza=r2(v);
  l.confianza=r2(Math.min(...Object.values(partes).filter(v=>v!==null)));
  if(l.estado!=="OK")l.confianza=Math.min(l.confianza,0.5);
  l.fiable=l.confianza>=UMBRAL_FIABLE;
 }
 for(const t of Object.values(salida.totales||{}))if(t&&typeof t==="object"&&"estado" in t)t.confianza=r2(confianzaCampo(t)??0);
 // OCR: con total impreso, una base o cuota no localizada probablemente existe y no se ha leído
 // no se afirma con confianza alta que falte.
 const T=salida.totales;
 if(T&&salida.tipo_pdf!=="DIGITAL"&&T.total?.estado!=="VACIO")for(const k of ["base_imponible","cuota_iva","iva_porcentaje"])
  if(T[k]?.estado==="VACIO"){
   const m="No localizado aunque el documento tiene total";
   T[k].confianza=0.5;if(!(T[k].motivos||[]).includes(m))T[k].motivos=[...(T[k].motivos||[]),m];
  }
 // OCR: líneas con importes y ningún total localizado → el total existe y no se ha leído.
 if(T&&salida.tipo_pdf!=="DIGITAL"&&T.total?.estado==="VACIO"&&salida.lineas.some(l=>l.importe?.valor!=null)){
  const m="Total no localizado aunque las líneas tienen importes";
  T.total.confianza=0.5;if(!(T.total.motivos||[]).includes(m))T.total.motivos=[...(T.total.motivos||[]),m];
 }
 // Los totales impresos también deciden la aceptación automática del documento.
 const confTotales=T?["base_imponible","iva_porcentaje","cuota_iva","total"].map(k=>T[k]?.confianza).filter(x=>typeof x==="number"):[];
 const criticos=[p?.confianza??0,salida.numero?.confianza??0,salida.fecha?.confianza??0,...salida.lineas.map(l=>l.confianza),...confTotales];
 if(!salida.lineas.length)criticos.push(0);
 if(salida.validaciones.some(v=>v.estado==="FALLO"))criticos.push(0.5);
 salida.confianza=r2(Math.min(...criticos));
 salida.fiable=salida.confianza>=UMBRAL_FIABLE;
}

/* ------------------------------ Documento entero ---------------------------- */
function extraerDePaginas(paginas,opciones={}){
 const registroBase=opciones.registro||PROV().REGISTRO;
 // CIF de DAFRICA reconocido por su contexto en otra lectura del mismo albarán.
 const registro=opciones.nifsPropios?.length?{...registroBase,empresa_propia:{...registroBase.empresa_propia,
  nifs:[...(registroBase.empresa_propia?.nifs||[]),...opciones.nifsPropios]}}:registroBase;
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
 const idPerfil=salida.proveedor.id||opciones.proveedorId;
 const perfil=idPerfil?registro.proveedores.find(p=>p.id===idPerfil):null;
 if(perfil?.columnas)for(const x of tablas)x.t=leerTablaPagina(x.p,perfil);
 const opcionesFecha={hoy:opciones.hoy,orden:perfil?.orden_fecha||"DMY",...(opciones.numeroDeFactura?{factura:true}:{})};
 const zona=primera.t?primera.p.lineas.slice(0,primera.t.indiceCabecera):primera.p.lineas;
 salida.numero=leerNumero(zona);
 salida.fecha=leerFecha(zona,opcionesFecha);
 // Algunos proveedores (Saltoki) imprimen número y fecha al pie: se busca en toda la página.
 if(salida.numero.estado==="VACIO"&&primera.t){const n=leerNumero(primera.p.lineas);if(n.estado!=="VACIO")salida.numero=n;}
 // Etiqueta propia del proveedor para el número («SALIDA 1234» en un talonario).
 if(perfil?.etiqueta_numero&&salida.numero.estado!=="OK"){
  const re=perfil.formato_numero?new RegExp(perfil.formato_numero):/\d/;
  const h=[...new Map(valoresEtiquetados(primera.p.lineas,new RegExp("^("+perfil.etiqueta_numero+")(\\b|$)"),/$^/,t=>re.test(t)).map(x=>[x.texto,x])).values()];
  if(h.length===1)salida.numero={literal:h[0].texto,valor:h[0].texto,estado:"OK",motivos:[],notas:["Número tras la etiqueta propia del proveedor «"+h[0].etiqueta+"»"],
   caja:caja(h[0].celda),conf_ocr:h[0].celda?.conf??null};
 }
 // Confirmación de pedido (opciones.numeroDePedido, usuario 2026-11-17; real: «PRESUPUESTO XXXX 2600000»): el número tras
 // «PRESUPUESTO», «PEDIDO», «OFERTA» o «CONFIRMACIÓN»; solo si hay uno y lleva cifras. Nunca en los albaranes (su «Nº PEDIDO» no
 // es el número del albarán).
 if(opciones.numeroDePedido&&salida.numero.estado!=="OK"){
  const h=[...new Map(valoresEtiquetados(primera.p.lineas,/^(PRESUPUESTO|PEDIDO|OFERTA|CONFIRMACION( DE)? PEDIDO|N(º|O)? ?(DE )?(PEDIDO|PRESUPUESTO|OFERTA))(\b|$)/i,/$^/,t=>/\d{3,}/.test(t),
   // Fallo real 2026-11-18: a la derecha de «PRESUPUESTO», en otra columna, el código postal de DAFRICA; el número iba debajo.
   {huecoDerecha:8,unirDerecha:true}).map(x=>[x.texto,x])).values()];
  if(h.length===1)salida.numero={literal:h[0].texto,valor:h[0].texto,estado:"OK",motivos:[],notas:["Número del pedido tras «"+h[0].etiqueta+"»"],
   caja:caja(h[0].celda),conf_ocr:h[0].celda?.conf??null};
 }
 // Matrícula del vehículo en la cabecera de una factura (taller, 2026-11-26: «Matrícula» con el valor debajo; usuario: «que coja en el
 // título todo, matrículas…»; en STEL las registran como «número fecha matrícula»).
 if(opciones.numeroDeFactura){const m=matriculaDeCabecera(primera.p.lineas);if(m)salida.matricula=m;}
 // Factura de proveedor (opciones.numeroDeFactura, usuario 2026-11-20; real: casilla «NÚMERO» con «A | 000123» debajo y, en las
 // líneas, «ALBARAN Nº …» de cada albarán facturado): el número de la factura tras «NÚMERO», «Nº FACTURA» o «FACTURA», aunque el
 // lector haya tomado otro (los «ALBARÁN Nº» de una factura son los albaranes que cita, no su número). Solo si hay uno.
 if(opciones.numeroDeFactura){
  // Albaranes que cita la factura («Albarán: 26/0001», «ALBARÁN Nº 600.111»): ninguno es el número de la factura (fallo real
  // 2026-11-23: alguna lectura OCR tomaba el del albarán citado bajo la cabecera y el número quedaba AMBIGUO).
  const citados=new Set();
  for(const l of primera.p.lineas)for(const m of N().sinAcentos(l.texto||"").toUpperCase().matchAll(/ALBARAN\s*(?:N[ºO°]?\.?|NUM(?:ERO)?\.?)?\s*[:.]?\s*([0-9A-Z][0-9A-Z.\/-]{2,})/g))
   if(/\d/.test(m[1]))citados.add(N().canon(m[1]));
  // «Número de la factura» (factura real 2026-11-24) y nunca el de la factura ORIGINAL que cita una rectificativa.
  // «Nº documento» (factura de taller, 2026-11-25) también; nunca la factura «corregida», «rectificada» o de «origen» que cita un abono
  // («Nº factura corregida | A-…» se aceptaba como el número del abono).
  // En inglés: «Invoice number», «Invoice No:», «Invoice #» (plataformas en línea), nunca el «Receipt number» ni el del pedido.
  const h=[...new Map([...valoresEtiquetados(primera.p.lineas,/^(N(º|O)? ?(DE )?FACTURA|NUM(ERO)? (DE (LA )?)?FACTURA|FACTURA( N(º|O)?)?|NUMERO|NUM|N(º|O)? ?(DE )?DOCUMENTO|INVOICE (NUMBER|NO|NUM|#))(\b|$|(?<=#))/i,
   /ALBARAN|PEDIDO|CLIENTE|PROVEEDOR|RECTIFICA|ORIGINAL|CORREGID|ABONAD|ANULAD|ORIGEN|PAGINA|CUENTA|IBAN|TELEF|OBRA|CIF|NIF|RECEIPT|ORDER|CUSTOMER/,
   // Forma de número de documento: serie de letras opcional y cifras («A 000123», «FV26-001234»), también con la serie detrás
   // («12345678 RX», factura real 2026-11-24), o un código de letras y cifras con al menos dos cifras («ES12AB34CDEF»); nunca una
   // fecha ni una dirección.
   t=>esNumeroDeFactura(t)&&!citados.has(N().canon(t)),
   {huecoDerecha:8,unirDerecha:true,parClaveValor:true}),
   // Tras «Invoice number» también «CÓDIGO CIFRAS» con un espacio (plataformas en línea).
   ...valoresEtiquetados(primera.p.lineas,/^INVOICE (NUMBER|NO|NUM|#)(\b|$|(?<=#))/i,/RECEIPT|ORDER|CUSTOMER/,
    t=>esNumeroDeFactura(t,{espacio:true})&&!citados.has(N().canon(t)),{huecoDerecha:8,parClaveValor:true})].map(x=>[x.texto,x])).values()];
  // Una palabra «Factura» que empieza una frase («Factura generada para facturar el ticket …», con otra cifra debajo: 2026-11-25) no es
  // la etiqueta del número: con el valor debajo, lo que sigue a la etiqueta (en su casilla o en la de al lado, pegada) no puede ser
  // una palabra en minúsculas.
  const frase=t=>/^[a-zñáéíóú]{3,}/.test(t)&&!/^(n[º°o]|num|n[uú]mero|del?|la|factura|documento)\b/i.test(t);
  for(let i=h.length-1;i>=0;i--){
   const x=h[i],l=primera.p.lineas[x.indiceLinea],j=l?l.celdas.indexOf(x.celdaEtiqueta):-1,sig=j>=0?l.celdas[j+1]:null;
   if(j<0||l.celdas.includes(x.celda))continue;
   // Sin las palabras de la etiqueta («Número factura», «Nº de factura», «Factura nº»).
   const tras=String(x.celdaEtiqueta.texto||"").trim().replace(/^((n[º°o]\.?|n[uú]mero|num\.?|de|la|del|factura|documento)(?![a-zñáéíóú])\s*[:.#]?\s*)+/i,"");
   if(frase(tras)||(sig&&frase(String(sig.texto||"").trim())&&sig.x0-x.celdaEtiqueta.x1<=1.5*(x.celdaEtiqueta.alto||10)))h.splice(i,1);
  }
  // Recibo (título «Receipt» suelto arriba y ningún número de factura: vendedores de tiendas en línea, 2026-11-25): su número es el del recibo.
  if(!h.length&&primera.p.lineas.some(l=>l.y<0.2*(primera.p.alto||842)&&l.celdas.some((c,k)=>clave(c.texto)==="RECEIPT"&&celdaSuelta(l,k))))
   h.push(...valoresEtiquetados(primera.p.lineas,/^RECEIPT (NUMBER|NO|NUM|#)(\b|$|(?<=#))/i,/ORDER|CUSTOMER/,
    t=>esNumeroDeFactura(t,{espacio:true})&&!citados.has(N().canon(t)),{huecoDerecha:8,parClaveValor:true}));
  // Abono o rectificativa (2026-11-25: «Abono | RA-26000111» arriba y, más abajo, «Nº factura corregida | A-…»): su número es
  // el de su título.
  const tabla1=tablas.find(x=>x.t&&x.p===primera.p);
  const delTitulo=numeroDeTituloDeAbono(primera.p,tabla1?tabla1.p.lineas[tabla1.t.indiceCabecera].y-tabla1.p.lineas[tabla1.t.indiceCabecera].alto:null);
  if(delTitulo&&!citados.has(N().canon(delTitulo.texto)))h.splice(0,h.length,delTitulo);
  // El título «FACTURA» encima de la casilla «NÚMERO» da las mismas cifras sin la serie («000123» y «A 000123»): si todas las
  // lecturas son las mismas cifras, vale la más completa.
  const cifras=t=>t.replace(/\D/g,"");
  if(h.length>1&&h.every(x=>cifras(x.texto)===cifras(h[0].texto)))h.sort((a,b)=>b.texto.length-a.texto.length).splice(1);
  // Número partido en dos renglones («ES-1234-2026-» y debajo «1234567890», factura de 2026-11-25) y entero más abajo: una lectura es el
  // principio o el final de otra (con 6 cifras o más): vale la entera.
  if(h.length>1){const sin=t=>t.replace(/\s/g,"").toUpperCase(),larga=[...h].sort((a,b)=>sin(b.texto).length-sin(a.texto).length)[0];
   if(h.every(x=>x===larga||(cifras(x.texto).length>=6&&(sin(larga.texto).startsWith(sin(x.texto))||sin(larga.texto).endsWith(sin(x.texto))))))h.splice(0,h.length,larga);}
  if(h.length===1){
   salida.numero={literal:h[0].texto,valor:h[0].texto,estado:"OK",motivos:[],notas:["Número de la factura tras «"+h[0].etiqueta+"»"],
    caja:caja(h[0].celda),conf_ocr:h[0].celda?.conf??null};
   // Barra leída como «1» (fallo real 2026-11-23: «1/0001» leído «110001» y, en la misma fila, la fecha «dd/mm/aa» leída «dd1mmaa»):
   // si en el renglón del número hay una fecha escrita sin barras que solo es fecha con «/» en el lugar de los «1», el número puede
   // llevar también una barra: no se acepta. La fecha se propone (sin aceptarla) si no hay otra.
   // La fecha con alguna barra leída «1» o perdida (p. ej. «1511026» o «1510/26» por «15/10/26»: las dos formas del fallo real); vale si da una sola
   // fecha posible. Sin ninguna barra («151026») puede ser cualquier número: no cuenta.
   const fechaSinBarras=t=>{
    if(!/^\d[\d\/]{6,9}$/.test(t))return null;const vistas=new Set();
    for(const s1 of ["","1","/"])for(const s2 of ["","1","/"])for(const anio of [2,4]){
     if((s1==="/"&&s2==="/")||(!s1&&!s2)||t.length!==4+s1.length+s2.length+anio)continue;
     const i=2+s1.length,j=i+2+s2.length;
     if(t.slice(2,i)!==s1||t.slice(i+2,j)!==s2)continue;
     const f=N().fecha(t.slice(0,2)+"/"+t.slice(i,i+2)+"/"+t.slice(j),opcionesFecha);if(f.estado==="OK")vistas.add(f.valor);
    }
    return vistas.size===1?[...vistas][0]:null;
   };
   const c0=h[0].celda,fila=primera.p.lineas.find(l=>l.celdas.some(c=>c===c0||(c.x0===c0?.x0&&String(c0?.texto||"").startsWith(c.texto))));
   const sinBarras=(fila?.celdas||[]).filter(c=>c!==c0).map(c=>String(c.texto||"").trim()).find(t=>fechaSinBarras(t));
   if(sinBarras&&/1/.test(h[0].texto)){
    salida.numero.estado="REVISAR";
    salida.numero.motivos.push("En su fila el OCR lee la barra «/» como «1» (fecha «"+sinBarras+"»): el número puede llevar una barra");
    if(salida.fecha?.estado!=="OK")
     salida.fecha={literal:sinBarras,valor:fechaSinBarras(sinBarras),estado:"REVISAR",motivos:["Fecha leída sin barras («"+sinBarras+"»): propuesta, compárala con el papel"],notas:[],caja:null};
   }
  }else if(salida.numero?.valor!=null&&citados.has(N().canon(salida.numero.valor)))
   salida.numero={literal:"",valor:null,estado:"VACIO",motivos:["El número leído es el de un albarán que cita la factura, no el de la factura"],notas:[],caja:null};
  // Sin un solo número tras la etiqueta de la factura, el que tomó el lector por otra etiqueta («Nº doc CRM 26XXXX», factura real
  // 2026-11-24: se aceptaba como número de la factura) nunca se da por bueno.
  else if(salida.numero?.estado==="OK"){
   const lit=String(salida.numero.literal||salida.numero.valor||"").trim(),cj=salida.numero.caja;
   // Su renglón por la posición de la casilla leída; por el texto solo sin posición (2026-11-25: «2026» de «Nº99 | 2026»
   // valía porque «Fecha de la factura— ene 10, 2026» también lo contiene).
   const suya=lit&&(cj?primera.p.lineas.find(l=>Math.abs(l.y-cj[1])<1&&l.celdas.some(c=>Math.abs(c.x0-cj[0])<1)):null)||
    (!cj&&lit?primera.p.lineas.find(l=>String(l.texto||"").includes(lit)):null);
   // O el título «FACTURA» / «INVOICE» suelto justo encima de su renglón («FACTURA» y debajo «№.12345678901 | Fecha: …», factura de
   // 2026-11-25).
   const tituloEncima=suya&&primera.p.lineas.some(l=>l.y<suya.y&&suya.y-l.y<=2*Math.max(suya.alto||10,l.alto||10)&&
    l.celdas.some((c,k)=>/^((FACTURA )?RECTIFICATIVA|FACTURA|INVOICE)$/.test(clave(c.texto))&&celdaSuelta(l,k)));
   if(h.length>1||!suya||!(/FACTURA/.test(N().sinAcentos(suya.texto||"").toUpperCase())||tituloEncima)||!esNumeroDeFactura(lit))
    salida.numero={...salida.numero,estado:"REVISAR",motivos:[...(salida.numero.motivos||[]),h.length>1?"Varios números tras la etiqueta de la factura ("+h.map(x=>x.texto).join(" / ")+")":
     "No está tras «Nº factura»"+(suya?" (está en «"+String(suya.texto).slice(0,40)+"»)":"")+": compruébalo con el papel"]};
  }
 // Fecha de la factura (factura real 2026-11-24: «Fecha de la factura/Fecha de la entrega | 19 noviembre 2026» quedaba fuera por
  // «entrega»; en una rectificativa, también «Fecha de la factura original»): la única tras «Fecha (de la) factura», nunca la de la
  // factura original, el pedido o el vencimiento.
  // En inglés: «Date of issue», «Date issued», «Issue Date», «Invoice date», «Receipt date» (nunca «Date due», «Payment Date» ni «Order date»).
  {const F=N().fecha,ff=[...new Map(valoresEtiquetados(primera.p.lineas,/^(FECHA (DE (LA )?)?FACTURA|DATE OF ISSUE|DATE ISSUED|ISSUE DATE|INVOICE DATE|RECEIPT DATE)(\b|$)/,/ORIGINAL|VENCIMIENTO|PEDIDO|PAGO|\bDUE\b|PAYMENT|ORDER/,
    t=>/\d/.test(t)&&F(t,opcionesFecha).estado==="OK",{huecoDerecha:8,parClaveValor:true}).map(x=>[F(x.texto,opcionesFecha).valor,x])).values()];
   if(ff.length===1&&!(salida.fecha?.estado==="OK"&&salida.fecha.valor===F(ff[0].texto,opcionesFecha).valor)){
    const f=F(ff[0].texto,opcionesFecha);
    salida.fecha={literal:f.literal,valor:f.valor,estado:f.estado,motivos:[...f.motivos],notas:[...f.notas,"Fecha de la factura tras «"+ff[0].etiqueta+"»"],
     caja:caja(ff[0].celda),conf_ocr:ff[0].celda?.conf??null};
   }
   // Varias fechas etiquetadas (2026-11-25: «Factura nº | 12-26 | Fecha | 27 de Octubre del 2026» y, más abajo, «Fecha: 01/10/2026» de
   // un trabajo): vale la única de los renglones del número de la factura (el aceptado o, si no lo hay, los de «Nº factura»).
   const cj=salida.numero?.estado==="OK"?salida.numero.caja:null;
   if(salida.fecha?.estado==="AMBIGUO"){
    const filas=cj?primera.p.lineas.filter(l=>Math.abs(l.y-cj[1])<1&&l.celdas.some(c=>Math.abs(c.x0-cj[0])<1)):
     h.map(x=>primera.p.lineas[x.indiceLinea]).filter(Boolean);
    const deFila=[...new Map(filas.flatMap(l=>l.celdas).map(c=>[F(c.texto,opcionesFecha),c]).filter(([f])=>f.estado==="OK").map(([f,c])=>[f.valor,{f,c}])).values()];
    if(deFila.length===1){const {f,c}=deFila[0];
     salida.fecha={literal:f.literal,valor:f.valor,estado:"OK",motivos:[],notas:[...f.notas,"Varias fechas: la del renglón del número de la factura"],
      caja:caja(c),conf_ocr:c.conf??null};}
   }}
 }
 // El formato de número del perfil es el de sus ALBARANES: no vale para el número de una factura ni de una confirmación de
 // pedido (fallo real 2026-11-20: «A 000123» de una factura quedaba en revisión por no tener la forma de sus albaranes).
 const perfilNumero=opciones.numeroDeFactura||opciones.numeroDePedido?null:perfil;
 // Número sin etiqueta o tras una serie («L26-01234 01/10/2026», «ALBARÁN AB26 001234»): con el
 // formato propio del proveedor se busca en la primera página; solo se acepta si hay uno solo.
 if(perfilNumero?.formato_numero&&!(salida.numero.estado==="OK"&&new RegExp(perfil.formato_numero).test(salida.numero.valor))){
  const r=numeroPorFormato(primera.p,perfil,salida.numero,opcionesFecha);
  if(r){
   salida.numero=r.numero;
   if(r.fecha&&(salida.fecha.estado!=="OK"))salida.fecha=r.fecha;
  }
 }
 // Formato de número propio del proveedor (comprobado en sus albaranes reales): un número que
 // no lo cumple («26101234» por «26/01234») no se acepta.
 if(perfilNumero?.formato_numero&&salida.numero.estado==="OK"&&!new RegExp(perfilNumero.formato_numero).test(salida.numero.valor)){
  salida.numero={...salida.numero,estado:"REVISAR",motivos:[...salida.numero.motivos,"No tiene el formato de número habitual del proveedor"]};
 }
 separadorDelNumero(salida.numero,perfilNumero);
 const sinEtiqueta=f=>f.motivos.some(m=>/sin etiqueta/i.test(m));
 if((salida.fecha.estado==="VACIO"||sinEtiqueta(salida.fecha))&&primera.t){
  const f=leerFecha(primera.p.lineas,opcionesFecha);
  // Una fecha etiquetada en el pie prevalece sobre una sin etiqueta del encabezado.
  if(salida.fecha.estado==="VACIO"?f.estado!=="VACIO":f.estado!=="VACIO"&&!sinEtiqueta(f)&&f.estado!=="AMBIGUO")salida.fecha=f;
 }
 // Formato numérico: perfil confirmado o pruebas en las cifras del propio documento.
 const crudas=tablas.flatMap(x=>x.t?x.t.filas:[]);
 const literales=crudas.flatMap(f=>["cantidad","precio","subtotal","importe"].map(k=>f.celdas[k]?.texto).filter(Boolean));
 let deducido=N().deducirFormato(literales);
 // Factura sin cifras de la tabla que lo digan (facturas en inglés, 2026-11-25: «€23.45» con la tabla sin reconocer): los importes con
 // «€» del propio documento, si todos tienen el mismo formato.
 let origenFormato="cifras del propio documento";
 if(!deducido.confirmado&&opciones.numeroDeFactura){
  // También «EUR» detrás o en la casilla de al lado («100.00 | EUR», factura de 2026-11-25).
  const conEuro=digitales.flatMap(p=>p.lineas.flatMap(l=>l.celdas.flatMap((c,i)=>[...[...String(c.texto).matchAll(/€\s?(-?\d[\d.,]*\d)|(-?\d[\d.,]*\d)\s?(€|EUR\b)/g)].map(m=>m[1]||m[2]),
   ...(/^\s*(EUR|€)\s*$/i.test(l.celdas[i+1]?.texto||"")&&/^\s*-?\d[\d.,]*\d\s*$/.test(c.texto)?[c.texto.trim()]:[])])));
  const porEuro=N().deducirFormato(conEuro);
  if(porEuro.confirmado){deducido=porEuro;origenFormato="importes con «€» del documento";}
 }
 salida.formato_numeros=perfil?.formato_confirmado?{formato:perfil.formato_numeros,confirmado:true,origen:"perfil del proveedor"}:
  {formato:deducido.formato,confirmado:deducido.confirmado,origen:deducido.confirmado?origenFormato+" ("+deducido.pruebas+")":"sin pruebas"+(deducido.conflicto?" (formatos contradictorios)":"")};
 const decimalesVistos=literales.map(t=>(String(t).match(/,(\d+)$/)||[])[1]?.length).filter(Boolean);
 const decimales=decimalesVistos.length?[...decimalesVistos].sort((a,b)=>decimalesVistos.filter(x=>x===b).length-decimalesVistos.filter(x=>x===a).length)[0]:null;
 const opcionesNumero={formato:salida.formato_numeros.formato,formatoConfirmado:salida.formato_numeros.confirmado,decimales};
 const cabeceraPrecio=tablas.map(x=>x.t?.cabecera).find(Boolean);
 const precioPor=perfil?.precio_por||tablas.map(x=>x.t?.precioPor).find(Boolean)||1;
 const noArticulo=(perfil?.anotaciones_no_articulo||["RETIRADO POR","RECOGIDO POR","PEDIDO POR"]).map(t=>N().canon(t));
 let n=0;
 const servicios=tablas.some(x=>x.t?.servicios);
 for(const cruda of crudas){
  const texto=N().canon((cruda.celdas.referencia?.texto||"")+(cruda.celdas.descripcion?.texto||""));
  const sinPrecio=!cruda.celdas.precio&&!cruda.celdas.importe;
  if(sinPrecio&&noArticulo.some(p=>texto.startsWith(p))){
   salida.lineas_ignoradas.push({pagina:cruda.pagina,y:cruda.y,texto:Object.values(cruda.celdas).map(c=>c.texto).join(" "),motivo:"Anotación de recogida, no es un artículo"});
   continue;
  }
  const fila=construirFila(cruda,++n,opcionesNumero,perfil,precioPor);
  // Factura de servicios: una fila sin cantidad ni importe en cifras (los títulos del cuadro de totales leídos como fila) no es un concepto.
  if(servicios&&fila.cantidad.estado==="VACIO"&&fila.importe.valor==null){
   salida.lineas_ignoradas.push({pagina:cruda.pagina,y:cruda.y,texto:Object.values(cruda.celdas).map(c=>c.texto).join(" "),motivo:"Fila sin importe en una factura de servicios"});
   n--;continue;
  }
  if(servicios)conceptoDeServicio(fila);
  if(salida.tipo_pdf==="ESCANEADO_OCR"&&fila.descripcion.valor){
   const v=restituirGlifos(fila.descripcion.valor,perfil);
   if(v!==fila.descripcion.valor){fila.descripcion={...fila.descripcion,valor:v,notas:[...(fila.descripcion.notas||[]),"Símbolo restituido según el formato del proveedor (el OCR no lo reconoce)"]};}
  }
  // Posición de la línea en su página (para saber bajo qué «ALBARÁN Nº» de una factura va; 2026-11-23).
  if(cruda.y!=null&&fila.y==null)fila.y=cruda.y;
  salida.lineas.push(fila);
 }
 // Fila sin código pegada debajo de otra y en la columna de descripción («LATON 2» separado de
 // «CODO 92 M-H» por un trazo a mano): puede ser el final de la descripción anterior, que entonces
 // estaría cortada. La anterior no se acepta sin revisión.
 if(!perfil?.permite_sin_referencia)salida.lineas.forEach((l,i)=>{
  const ant=salida.lineas[i-1],a=ant?.descripcion?.caja,b=l.descripcion?.caja;
  // Dos conceptos de servicios, cada uno con su importe, son dos líneas (2026-11-26).
  if(!ant||l.referencia.estado!=="VACIO"||!a||!b||l.pagina!==ant.pagina||ant.descripcion.estado!=="OK"||(l.servicio&&ant.servicio))return;
  if(b[1]-a[1]>0&&b[1]-a[1]<=2*a[3]&&b[0]>=a[0]-a[3]&&b[0]<=a[2]+a[3]){
   ant.descripcion={...ant.descripcion,estado:"REVISAR",motivos:[...(ant.descripcion.motivos||[]),"La fila siguiente, sin código, puede ser el final de esta descripción («"+l.descripcion.literal+"»)"]};
   ant.motivos.push("Descripción posiblemente cortada: sigue una fila sin código");ant.estado="REVISAR";
  }
 });
 // Fila siguiente cuyo «código» no tiene el formato de código del proveedor («15m2/paquete»,
 // «λ=0.035 W/mk», renglones de una descripción larga de DECOTAP leídos en la columna del código):
 // la descripción anterior puede seguir en ella (fallo real 2026-10-23: aceptada cortada).
 const reFormatoRef=perfil?.formato_referencia?new RegExp(perfil.formato_referencia):null;
 if(reFormatoRef)salida.lineas.forEach((l,i)=>{
  const ant=salida.lineas[i-1];
  // Basta con que la primera palabra tenga la forma, también con caracteres que el OCR confunde
  // («3OOABC765432l Montante» es una fila de artículo; «15m2/paquete», no).
  const t=String(l.referencia.literal||"").trim().split(/\s+/)[0],u=t.toUpperCase();
  const pareceCodigo=[t,u,u.replace(/[OQD]/g,"0").replace(/[IL]/g,"1").replace(/Z/g,"2").replace(/S/g,"5").replace(/B/g,"8").replace(/G/g,"6")].some(x=>reFormatoRef.test(x));
  if(!ant||l.pagina!==ant.pagina||ant.descripcion.estado!=="OK"||l.referencia.estado==="VACIO"||pareceCodigo)return;
  ant.descripcion={...ant.descripcion,estado:"REVISAR",motivos:[...(ant.descripcion.motivos||[]),"La fila siguiente («"+l.referencia.literal+"») no tiene forma de código del proveedor: puede ser el final de esta descripción"]};
  ant.motivos.push("Descripción posiblemente cortada: la fila siguiente no es un código");ant.estado="REVISAR";
 });
 for(const x of tablas)if(x.t)salida.lineas_ignoradas.push(...x.t.ignoradas);
 // Pie: totales impresos.
 const pie=tablas.flatMap(x=>x.t?x.t.pie:x.p.lineas);
 const leido=valorPie(pie,/^(TOTAL LINEAS|N[ºO°]? ?(DE )?LINEAS)/,opcionesNumero);
 // «Total líneas: 21,77» (Saltoki) es la suma de importes, no un recuento.
 const totalLineas=leido&&leido.estado==="OK"&&Number.isInteger(leido.valor)&&!/,/.test(leido.literal)?leido:null;
 const sumaLineasImpresa=leido&&leido.estado==="OK"&&!totalLineas?leido:null;
 salida.totales=leerTotales(pie,opcionesNumero,{factura:!!opciones.numeroDeFactura,ivaLineas:opciones.numeroDeFactura?porcentajesDeImpuesto(tablas,salida.lineas):null});
 // Totales ENCIMA de la tabla (2026-11-26: «TOTALES (€)» arriba y «Descripción | Cuota IVA | Base Imponible (€)» debajo): en la tabla de
 // conceptos con su base, si el pie no da los totales, los renglones de encima de la tabla. Solo si cuadran entre sí.
 const conBase=tablas.filter(x=>x.t?.conBase);
 if(opciones.numeroDeFactura&&conBase.length&&salida.totales.validacion?.estado!=="OK"){
  const arriba=leerTotales(conBase.flatMap(x=>x.p.lineas.slice(0,x.t.indiceCabecera)),opcionesNumero,{factura:true});
  if(arriba.validacion?.estado==="OK")salida.totales=arriba;
 }
 // Factura de abono (banco de facturas, 2026-11-25: «Abono RA-…» o «Abono» con los importes impresos en positivo; en
 // STEL van en negativo): los importes positivos pasan a negativo.
 const tabla1=tablas.find(x=>x.t&&x.p===paginas[0]);
 let abonoFactura=opciones.numeroDeFactura?abonoImpreso(paginas,salida.totales,tabla1?tabla1.p.lineas[tabla1.t.indiceCabecera].y-tabla1.p.lineas[tabla1.t.indiceCabecera].alto:null):null;
 // Devolución SOLO del IVA (factura real 2026-11-26: suscripción de otro país de la UE con el IVA español cobrado y devuelto después:
 // «Credited subtotal» 0 · «Credited total» = el IVA · «Adjusted invoice total» = la base): lo que queda es la factura sin IVA, como las de
 // inversión del sujeto pasivo («Tax 0%»). Solo con las tres cifras impresas y cuadrando con la factura (lo devuelto es su IVA y lo
 // que queda su base): base y total = lo que queda, IVA 0, e `iva_devuelto`. No es un abono.
 const soloIva=abonoFactura&&/REFUND/.test(abonoFactura)?devolucionSoloIva(paginas.flatMap(p=>p.lineas),salida.totales,opcionesNumero):null;
 if(soloIva){
  const v=(valor,literal,motivo)=>({valor,estado:"VERIFICADO",literal,motivos:[motivo],confianza:1});
  const m="Devolución del IVA («Credited total» "+soloIva.devuelto.literal+" = el IVA de la factura): queda «Adjusted invoice total» "+soloIva.queda.literal+" sin IVA";
  Object.assign(salida.totales,{base_imponible:v(soloIva.queda.valor,soloIva.queda.literal,m),iva_porcentaje:v(0,"0%",m),cuota_iva:v(0,"0",m),
   total:v(soloIva.queda.valor,soloIva.queda.literal,m),iva_devuelto:v(soloIva.devuelto.valor,soloIva.devuelto.literal,m),validacion:{estado:"OK",detalle:m}});
  abonoFactura=null;
 }
 // «Refund» (devolución de una factura en inglés, 2026-11-25: se devuelve solo el IVA, «Credited total» distinto del «Total»): lo
 // impreso es la factura devuelta; lo abonado lo comprueba la persona.
 if(abonoFactura&&/REFUND/.test(abonoFactura)){
  for(const k of ["base_imponible","cuota_iva","total"]){const x=salida.totales[k];
   if(x&&x.valor!=null)salida.totales[k]={...x,estado:"REVISAR",motivos:[...(x.motivos||[]),"Devolución («Refund»): lo impreso es la factura devuelta; lo abonado puede ser solo una parte (el IVA)"]};}
  salida.totales.validacion={estado:"FALLO",detalle:"Devolución («Refund»): importes a comprobar"};
 }else if(abonoFactura)ponerEnNegativo(salida.totales,abonoFactura);
 const base=salida.totales.base_imponible.estado!=="VACIO"&&salida.totales.base_imponible.valor!==null?salida.totales.base_imponible:sumaLineasImpresa;
 salida.pie={total_lineas:totalLineas,suma_lineas_impresa:sumaLineasImpresa,base_imponible:base};
 // Geometría de las tablas (para relecturas por zonas en documentos escaneados).
 salida.tablas=tablas.map(x=>x.t?{pagina:x.p.numero,y_cabecera:x.p.lineas[x.t.indiceCabecera].y-x.p.lineas[x.t.indiceCabecera].alto,
  y_fin:x.t.pie.length?x.t.pie[0].y:(x.p.lineas.at(-1)?.y??x.p.alto),ancho:x.p.ancho,alto:x.p.alto,...(x.t.cabeceraPerfil?{cabecera_perfil:true}:{})}:{pagina:x.p.numero,y_cabecera:null});
 // Tipo de documento impreso: «ABONO» o «DEVOLUCIÓN» (sello o título) frente a albarán.
 // Solo como título o sello (renglón corto: «*ABONO*», «ALBARÁN RECTIFICATIVO»), nunca dentro de una frase
 // de las condiciones («No se admitirá su devolución»: prueba real 2026-10-28).
 const renglones=paginas.flatMap(p=>p.lineas.map(l=>clave(l.texto))).filter(t=>t.split(/\s+/).filter(Boolean).length<=4);
 const titulo=re=>renglones.some(t=>re.test(t));
 const tipoImpreso=titulo(/\bABONO\b/)?"ABONO":titulo(/\bRECTIFICATIV[OA]\b/)?"RECTIFICATIVO":titulo(/\bDEVOLUCION\b/)?"DEVOLUCION":null;
 // Clase de documento por su título impreso (usuario, 2026-11-17: «¿cómo diferencia un albarán de un pedido?»): «ALBARÁN» frente
 // a «PEDIDO», «CONFIRMACIÓN DE PEDIDO», «OFERTA», «PRESUPUESTO» o «PROFORMA» como renglón propio (nunca «Su pedido: …» ni una
 // columna con más texto). Solo cuenta si sale uno y no el otro; si no, no se sabe (null).
 // «ALBARÁN» al principio de un renglón, aunque siga el número y la fecha («ALBARÁN Nº 600.111 FECHA …»).
 const empieza=re=>paginas.some(p=>p.lineas.some(l=>re.test(clave(l.texto))));
 const tituloAlbaran=empieza(/^\W*ALBARAN(ES)?\b/i)||empieza(/^\W*NOTA DE ENTREGA\b/i);
 const tituloPedido=titulo(/^\W*(CONFIRMACION( DE)? (PEDIDO|ORDEN)|PEDIDO( DE (CLIENTE|COMPRA|VENTA|PROVEEDOR))?|OFERTA|PRESUPUESTO|(FACTURA )?PROFORMA)(\W+N\W*\S*)?\W*$/i);
 const claseImpresa=tituloPedido&&!tituloAlbaran?"PEDIDO":tituloAlbaran&&!tituloPedido?"ALBARAN":null;
 Object.defineProperty(salida,"_ctx",{enumerable:false,writable:true,value:{
  perfil,perfilNumero,totalLineas,base,tipoImpreso,claseImpresa,hayTabla:tablas.some(x=>x.t),columnas:primera.t?.cabecera||[],opcionesNumero,precioPor,
  factura:!!opciones.numeroDeFactura,abonoFactura,
  // Cifras impresas en el pie (para completar totales cuya etiqueta no se ha leído), con el texto de su renglón.
  cifrasPie:pie.flatMap(l=>l.celdas.flatMap(c=>String(c.texto).split(/\s+/).map(t=>t.replace(/[€%]/g,"").trim()).filter(t=>/\d/.test(t))
   .map(t=>({literal:t,...N().numero(t,opcionesNumero),caja:caja(c),conf:c.conf??null,renglon:clave(l.texto)})).filter(x=>x.estado==="OK"))),
  dudosas:tablas.flatMap(x=>x.t?x.t.dudosasTrasFin:[]),incidenciasBase:[...incidencias],
  sinPrecio:!!(cabeceraPrecio&&!cabeceraPrecio.includes("precio"))}});
 return finalizar(salida);
}

/*
 * Totales sin etiqueta legible: el valor que exigen los demás datos validados (base + cuota = total,
 * base × % = cuota, base = suma de líneas verificadas) solo se acepta si ESE MISMO valor está impreso
 * una única vez entre las cifras del pie. No se calcula ni se rellena nada que no esté impreso.
 */
function completarTotales(salida,ctx){
 const T=salida.totales,cifras=ctx.cifrasPie||[];
 if(!T||!cifras.length)return;
 const ok=c=>["OK","VERIFICADO"].includes(c?.estado)&&c.valor!=null;
 // Nunca una cifra de un renglón que dice lo que es y no es base, IVA ni total (2026-11-25: «A deducir certificaciones
 // anteriores 12.000,00» tomada como cuota porque total − base daba esa cifra).
 const ajeno=/DEDUCIR|DESCONTAR|ANTICIPO|A CUENTA|RETENCION|IRPF|CERTIFICACION|DESCUENTO|PRONTO PAGO|SALDO|PENDIENTE|COMPENSACION|RECARGO|A ORIGEN/;
 const impreso=(valor,{porcentaje=false}={})=>{
  const x=cifras.filter(c=>Math.abs(c.valor-valor)<0.006&&(porcentaje||/[.,]\d{2}$/.test(c.literal))&&!ajeno.test(c.renglon||""));
  const lits=[...new Set(x.map(c=>c.valor))];
  return lits.length===1?x[0]:null;
 };
 const poner=(k,c,evidencia)=>{T[k]={literal:c.literal,valor:c.valor,estado:"VERIFICADO",motivos:[],notas:["Etiqueta no legible: "+evidencia],caja:c.caja,
  resolucion:{metodo:"cifra_impresa_validada",evidencias:[evidencia,"Impreso «"+c.literal+"» en el pie"]}};};
 // Base = suma de líneas verificadas, si esa suma está impresa.
 const lineas=salida.lineas;
 // En una factura, solo sin ninguna base impresa: la suma de las líneas puede ser la de antes de portes o cargos (2026-11-25:
 // «Total Neto 100,00» y el IVA «de 115,00») o la de un solo tipo de IVA (líneas al 21 y al 10 %, con una sin leer).
 const baseLeida=!!ctx.factura&&T.base_imponible?.estado!=="VACIO";
 if(!ok(T.base_imponible)&&!baseLeida&&lineas.length&&lineas.every(l=>l.cuadre?.estado==="VERIFICADO")){
  const suma=Math.round(lineas.reduce((n,l)=>n+l.importe.valor,0)*100)/100;
  const c=impreso(suma);
  if(c)poner("base_imponible",c,"coincide con la suma de las líneas verificadas ("+suma+")");
 }
 for(let i=0;i<2;i++){
  const b=T.base_imponible,q=T.cuota_iva,t=T.total,pct=T.iva_porcentaje;
  if(ok(b)&&ok(t)&&!ok(q)){const c=impreso(Math.round((t.valor-b.valor)*100)/100);if(c)poner("cuota_iva",c,"cumple base + cuota = total");}
  if(ok(b)&&ok(q)&&!ok(t)){const c=impreso(Math.round((b.valor+q.valor)*100)/100);if(c)poner("total",c,"cumple base + cuota = total");}
  if(ok(T.base_imponible)&&ok(T.cuota_iva)&&!ok(pct)&&T.base_imponible.valor){
   const tipo=[21,10,4,5,0].find(x=>Math.abs(T.base_imponible.valor*x/100-T.cuota_iva.valor)<=0.011);
   const c=tipo!=null?cifras.find(c=>Math.abs(c.valor-tipo)<1e-9):null;
   if(c)poner("iva_porcentaje",c,"cumple base × "+tipo+" % = cuota");
  }
 }
 const b=T.base_imponible,q=T.cuota_iva,t=T.total;
 if(ok(b)&&ok(q)&&ok(t)&&Math.abs(b.valor+q.valor-t.valor)<=0.021&&T.validacion?.estado!=="OK"){
  for(const k of ["base_imponible","cuota_iva","total"])if(T[k].estado==="OK")T[k].estado="VERIFICADO";
  T.validacion={estado:"OK",detalle:"Base "+b.literal+" + IVA "+q.literal+" = total "+t.literal};
 }
}

/*
 * «600,111» (ficticio) con el formato del proveedor «ddd.ddd»: las mismas cifras con su separador impreso. Se acepta
 * el número con el separador del formato (las cifras no cambian) y queda anotado. Cualquier otra
 * diferencia no se corrige.
 */
function separadorDelNumero(numero,perfil){
 if(!perfil?.formato_numero||!numero||numero.estado!=="REVISAR"||!/,/.test(String(numero.valor||"")))return;
 const re=new RegExp(perfil.formato_numero),v=String(numero.valor).replace(/,/g,".");
 if(!perfil.formato_numero.includes("\\.")||!re.test(v))return;
 numero.valor=v;numero.estado="OK";
 numero.motivos=numero.motivos.filter(m=>!/formato de número habitual/.test(m));
 numero.notas=[...(numero.notas||[]),"Impreso con coma («"+numero.literal+"»): mismas cifras con el separador del formato del proveedor"];
 numero.resolucion={metodo:"formato_proveedor",evidencias:["Formato "+perfil.formato_numero,"Mismas cifras impresas: «"+numero.literal+"»"]};
}

/* Validaciones de documento, confianza y estado. Se puede repetir tras combinar lecturas. */
// Factura: base, cuota o total leídos sin nada que los cuadre (base + IVA = total, la suma de las líneas o la terna de cifras) no se
// aceptan (banco de facturas, 2026-11-25: 31 de 187 totales así eran de otra cosa: «Total m²», «Total posiciones», el IBAN…).
const SIN_CUADRE="Sin base + IVA = total ni suma de líneas que lo confirme";
function finalizar(salida){
 // Se puede repetir: lo que la vez anterior pasó a revisión por falta de cuadre vuelve a estar como leído.
 if(salida._ctx?.factura&&salida.totales)for(const k of ["base_imponible","cuota_iva","total"]){
  const x=salida.totales[k];
  if(x?.sin_cuadre&&x.estado==="REVISAR"){const {sin_cuadre,...y}=x;salida.totales[k]={...y,estado:"OK",motivos:(y.motivos||[]).filter(m=>m!==SIN_CUADRE)};}
 }
 verificarServicios(salida);
 const ctx=salida._ctx,incidencias=[...ctx.incidenciasBase];
 // Formato de número del proveedor, también tras combinar lecturas OCR (prueba real 2026-10-28: «0.01»,
 // la casilla del descuento junto al título «ALBARÁN» llegó a número aceptado desde otra lectura).
 const perfilNum=ctx.perfilNumero;
 if(perfilNum?.formato_numero&&salida.numero?.estado==="OK"&&!new RegExp(perfilNum.formato_numero).test(salida.numero.valor)){
  const n={...salida.numero,estado:"REVISAR",motivos:[...(salida.numero.motivos||[])]};
  separadorDelNumero(n,perfilNum);
  if(n.estado!=="OK")n.motivos.push("No tiene el formato de número habitual del proveedor");
  salida.numero=n;
 }
 // Albarán sin ningún precio: un total impreso sin base ni IVA que lo cuadren no es fiable (prueba real
 // 2026-10-28: totales sin respaldo en albaranes sin precios). Nunca se acepta un importe así.
 const sinPrecios=salida.lineas.length>0&&salida.lineas.every(l=>l.precio?.valor==null&&l.importe?.valor==null);
 if(sinPrecios&&salida.totales?.total&&salida.totales.total.valor!=null&&salida.totales.validacion?.estado!=="OK"){
  salida.totales.total={...salida.totales.total,estado:"REVISAR",motivos:[...(salida.totales.total.motivos||[]),"Albarán sin precios: total sin base ni IVA que lo respalden"]};
 }
 // Tipo: impreso («ABONO») o deducido de importes y cantidades negativos (devolución).
 const negativos=salida.lineas.length>0&&salida.lineas.every(l=>l.cantidad.valor<0||l.importe.valor<0);
 // Devolución dentro de un albarán (fallo real 2026-11-25: una línea con −1 y su importe −7,43, otra en positivo y el total −0,38 €; la
 // persona lo tuvo que marcar como abono): una línea con la cantidad en negativo, o con el importe en negativo y el precio en positivo
 // (no es un descuento), o el total impreso en negativo. Va como abono a revisión; lo confirma la persona. Las facturas, aparte.
 const devuelta=!ctx.factura?salida.lineas.find(l=>l.cantidad.valor<0||(l.importe.valor<0&&l.precio.valor>0&&!(l.cantidad.valor>0))):null;
 const totalNegativo=!ctx.factura&&salida.totales?.total?.valor<0&&["OK","VERIFICADO"].includes(salida.totales.total.estado);
 salida.clase_impresa=ctx.claseImpresa||null;
 salida.tipo_documento=ctx.abonoFactura?{valor:"ABONO",evidencia:"Factura de abono: "+ctx.abonoFactura}:
  ctx.tipoImpreso?{valor:"ABONO",evidencia:"Impreso «"+ctx.tipoImpreso+"» en el documento"}:
  negativos?{valor:"ABONO",evidencia:"Todas las líneas tienen cantidad o importe negativo"}:
  devuelta?{valor:"ABONO",evidencia:"La línea "+devuelta.fila+" trae "+(devuelta.cantidad.valor<0?"la cantidad":"el importe")+" en negativo (devolución)"}:
  totalNegativo?{valor:"ABONO",evidencia:"Total impreso en negativo ("+salida.totales.total.literal+")"}:{valor:"ALBARAN",evidencia:null};
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
  // Abono con las líneas en positivo y la base ya en negativo: el mismo valor con otro signo.
  const sumaOk=Math.abs(suma-base.valor)<=0.02||(!!ctx.abonoFactura&&Math.abs(suma+base.valor)<=0.02);
  v("suma_importes",sumaOk?"OK":"FALLO","Suma de líneas "+suma+" / impreso «"+base.literal+"»");
  // Factura: la base que suman las líneas está comprobada.
  const bi=salida.totales?.base_imponible;
  if(ctx.factura&&sumaOk&&bi?.estado==="OK"&&Math.abs(bi.valor-base.valor)<0.006)
   salida.totales.base_imponible={...bi,estado:"VERIFICADO",notas:[...(bi.notas||[]),"Base = suma de las líneas ("+suma+")"]};
 }else v("suma_importes","NO_APLICA",base?"No todas las líneas tienen importe válido":"No hay base imponible impresa");
 if(salida.lineas.some(l=>l.cuadre.estado==="DESCUADRE"))v("cuadre_lineas","FALLO","Hay líneas cuyo importe no cuadra");
 completarTotales(salida,ctx);
 const t=salida.totales;
 if(t?.validacion)v("totales",t.validacion.estado,t.validacion.detalle);
 // Sin base + IVA = total comprobado (p. ej. rótulos del pie ilegibles), el total se contrasta
 // con las líneas: suma de importes × (1 + IVA) para los tipos españoles 21, 10, 4 y 0 %.
 // Si no cuadra con ninguno, pueden faltar líneas o haber otros cargos: el total queda en revisión.
 const lineasConImporte=salida.lineas.filter(l=>["VERIFICADO","OK"].includes(l.importe.estado));
 if(t&&t.validacion?.estado!=="OK"&&["OK","VERIFICADO"].includes(t.total?.estado)&&salida.lineas.length&&lineasConImporte.length===salida.lineas.length){
  const suma=redondear(lineasConImporte.reduce((n,l)=>n+l.importe.valor,0));
  const conIva=x=>redondear(suma+redondear(suma*x/100));
  const tipo=[21,10,4,0].find(x=>Math.abs(conIva(x)-t.total.valor)<=0.021||(!!ctx.abonoFactura&&Math.abs(conIva(x)+t.total.valor)<=0.021));
  if(tipo!==undefined){
   t.total={...t.total,estado:"VERIFICADO",notas:[...(t.total.notas||[]),"Total = suma de líneas "+suma+" + IVA "+tipo+" %"]};
   v("total_con_lineas","OK","Suma de líneas "+suma+" + IVA "+tipo+" % = total «"+t.total.literal+"»");
  }else{
   t.total={...t.total,estado:"REVISAR",motivos:[...(t.total.motivos||[]),"No coincide con la suma de líneas a ningún tipo de IVA (¿líneas sin leer u otros cargos?)"]};
   v("total_con_lineas","FALLO","Suma de líneas "+suma+" sin tipo de IVA que dé el total «"+t.total.literal+"»");
  }
 }
 // Cuota de IVA que no es base × % (prueba real 2026-10-28: el «21» de la columna «I.V.A.» leído como
 // cuota en lugar del importe de «Importe I.V.A.»): nunca se acepta.
 const ac=x=>["OK","VERIFICADO"].includes(x?.estado)&&x.valor!=null;
 if(t&&ac(t.base_imponible)&&ac(t.iva_porcentaje)&&ac(t.cuota_iva)&&Math.abs(redondear(t.base_imponible.valor*t.iva_porcentaje.valor/100)-t.cuota_iva.valor)>0.021){
  t.cuota_iva={...t.cuota_iva,estado:"REVISAR",motivos:[...(t.cuota_iva.motivos||[]),"No es base × IVA ("+t.base_imponible.literal+" × "+t.iva_porcentaje.literal+" %)"]};
  v("cuota_iva","FALLO","Cuota «"+t.cuota_iva.literal+"» ≠ base × IVA");
 }
 if(ctx.dudosas.length)v("fin_de_tabla","FALLO","Posibles artículos después del final detectado de la tabla: "+ctx.dudosas.map(t=>"«"+t+"»").join("; "));
 // Factura: lo que sigue sin cuadre, a revisión (se marca para poder repetir la comprobación).
 if(ctx.factura&&t)for(const k of ["base_imponible","cuota_iva","total"]){
  const x=t[k];
  if(x?.estado==="OK"&&x.valor!=null)t[k]={...x,estado:"REVISAR",sin_cuadre:true,motivos:[...(x.motivos||[]).filter(m=>m!==SIN_CUADRE),SIN_CUADRE]};
 }
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

/* Celdas de etiqueta («FECHA», «ALBARÁN Nº») de una página: para releer su casilla por OCR. */
function celdasEtiqueta(pagina,campo){
 const [re,excluir]=campo==="fecha"?[RE_FECHA,EXCLUIR_FECHA]:[RE_NUMERO,EXCLUIR_NUMERO];
 const out=[];
 for(const l of pagina.lineas)for(const c of l.celdas){
  const k=N().sinAcentos(c.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
  if(re.test(k)&&!excluir.test(k))out.push(c);
 }
 return out;
}

return {VERSION,UMBRAL_FIABLE,restituirGlifos,extraerPdf,extraerDePaginas,finalizar,leerTablaPagina,identificarProveedor,cuadre,celdasEtiqueta,campoDe};
});
