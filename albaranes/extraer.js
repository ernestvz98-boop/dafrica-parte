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
 ["descripcion",/^(DESCRIPCION|CONCEPTO|CONCEPTOS|DENOMINACION|DESIGNACION|DETALLE|PRODUCTO|DESCRIPCION ARTICULO|DESCRIPCION DEL PRODUCTO|DESCRIPCION DEL ARTICULO|DESCRIPCION DEL|DESCRIPCION DE)$/],
 ["cantidad",/^(CANTIDAD|CANT|UDS|UNIDADES|UNDS|CTDAD|CANT SERVIDA|CANTIDAD SERVIDA|KILOS|KGS)$/],
 ["unidad",/^(UD|U M|UM|UNIDAD|MEDIDA)$/],
 ["precio",/^(PRECIO|PRECIO ?UNIDAD|PRECIO ?UNITARIO|PRECIO ?UNIT|P UNIT|P UNITARIO|PUNITARIO|PUNIT|PVP|PRECIO ?UD|PRECIO NETO|TARIFA|PRECIO 100|PRECIO X 100|PRECIO 1000|PRECIO X 1000)$/],
 ["subtotal",/^(SUBTOTAL|BRUTO|IMPORTE BRUTO)$/],
 ["descuento",/^(DTO|DTOS|DESC|DESCUENTO|DTO %|% DTO|%DTO|DTO%|% DESC|DESC %|DTO ?[123]|DESC ?[123]|% ?DTO ?[123]|DTO ?[123] ?%)$/],
 ["importe",/^(IMPORTE|IMPORTE NETO|TOTAL|NETO|TOTAL LINEA|IMPORTE TOTAL|IMPORTE EUR)$/]
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
 const columnas=todas;
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
 const ajenasFinal=columnas.filter(c=>c.campo==="otra").length;
 const valida=finales.has("cantidad")&&(finales.has("descripcion")||finales.has("referencia"))&&finales.size>=3&&ajenasFinal<=3;
 return {valida,columnas:columnas.sort((a,b)=>a.x0-b.x0),ajenas:ajenasFinal};
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
const pareceNumero=t=>/^(\(\s*[\d.,]+\s*\)|[-−+]?\s*[\d.,]+\s*(\+\s*[\d.,]+\s*)*[−-]?\s*%?)$/.test(String(t).trim());
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
 // El OCR separa «2026 /1234» en celdas: aceptar solo «2026» confundiría
 // la serie/año con el número. Unir únicamente el sufijo impreso contiguo.
 hallados=hallados.map(h=>{
  if(!/^\d{2,4}$/.test(h.texto))return h;
  const linea=lineas.find(l=>l.celdas.includes(h.celda)),i=linea?.celdas.indexOf(h.celda);
  const siguiente=linea?.celdas[i+1];
  if(!siguiente||!/^\/\s*\d{2,10}$/.test(siguiente.texto.trim())||
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
 const unicos=x=>[...new Map(x.map(c=>[c.valor.replace(/\s+/g,""),c])).values()];
 const elegidos=unicos(enLinea.length?enLinea:(perfil.numero_sin_etiqueta?candidatos:[]));
 if(elegidos.length!==1)return null;
 const c=elegidos[0];
 const metodo=enLinea.length?"tras la serie impresa junto a la etiqueta («"+leido.literal+"»)":"sin etiqueta: único valor con el formato del proveedor";
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
 // Una fecha sin etiqueta puede ser la de pedido o entrega: se propone, no se acepta. Excepción:
 // la única fecha va en la misma línea que el rótulo del albarán («ALBARÁN CARGO 16/10/2026»).
 const lineaFecha=lineas.find(l=>l.celdas.includes(distintos[0].celda));
 const celdaF=distintos[0].celda;
 const junto=lineaFecha&&lineaFecha.celdas.some(c=>{
  const k=N().sinAcentos(c.texto).replace(/[.:]/g," ").replace(/\s+/g," ").trim();
  // Título del documento sin cifras («ALBARÁN CARGO») y la fecha pegada a su derecha.
  return /^ALBARAN( [A-Z]+)?$/.test(k)&&celdaF.x0>=c.x1&&celdaF.x0-c.x1<=Math.max(c.x1-c.x0,4*c.alto);
 });
 if(!etiquetada&&f.estado==="OK"&&junto)r.notas.push("Fecha en la misma línea que el rótulo del albarán");
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
const RE_PIE=/^(TOTAL(ES)?|SUMA|BASE IMPONIBLE|BASE|IMPORTE TOTAL|TOTAL ALBARAN|TOTAL LINEAS|N[ºO°]? LINEAS|OBSERVACIONES|FORMA DE PAGO|RECIBI|CONFORME|FIRMA|SUBTOTAL|I V A|IVA|SUMA Y SIGUE)\b/;
const RE_ANOTACION=/^(RETIRADO POR|RECOGIDO POR|PEDIDO POR|ENTREGA EN|ENTREGAR EN|ENTREGADO A|CONTACTO|OBRA|S ?REF|SU REF|REF CLIENTE|ATENCION|OBSERVACIONES|DE PEDIDO|PEDIDO DE CLIENTE|SU PEDIDO|EN ALMACEN|TRANSPORTISTA|SUMA Y SIGUE)\b/;
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
 const codigos=siguientes.flatMap(l=>l.celdas.filter(c=>c.x1<desc.x0-0.5*l.alto&&/^[A-Z0-9][A-Z0-9.\/-]{3,}$/i.test(c.texto.trim())&&/\d/.test(c.texto)));
 if(!codigos.length)return;
 const x0=Math.min(...codigos.map(c=>c.x0)),x1=Math.max(...codigos.map(c=>c.x1));
 cab.columnas.unshift({campo:"referencia",clave:"(inferida)",x0,x1,inferida:true});
 // El título de la descripción suele ir centrado: su columna empieza justo después de los códigos.
 desc.x0=Math.min(desc.x0,x1+pagina.lineas[cab.indice].alto);
}
function leerTablaPagina(pagina){
 const cab=buscarCabeceraTabla(pagina.lineas);
 if(!cab)return null;
 inferirColumnaCodigo(pagina,cab);
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
  // Con las cajas reales de las palabras (OCR) el reparto no es una estimación.
  const exacto=c.palabras?.length>1;
  return grupos.map(g=>({texto:g.texto,x0:g.x0,x1:g.x1,alto:g.alto,y:g.y,conf:c.conf,partida:!exacto,repartida:true,campoPartida:g.campo}));
 };
 const asignar=linea=>{
  const celdas={},conflictos=[];let partida=false,textoEstimado=false;
  let ultimoTexto=null;
  for(const c of linea.celdas.filter(c=>c.x1>=xMinTabla).flatMap(partir)){
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
    else conflictos.push(campo);
   }else celdas[campo]={...c};
  }
  return {celdas,conflictos,partida,textoEstimado};
 };
 const altoFila=pagina.lineas[cab.indice].alto;
 // Lo que queda claramente a la izquierda de la primera columna no pertenece a la tabla.
 const xMinTabla=Math.min(...cab.columnas.map(c=>c.x0))-3*altoFila;
 let actual=null,fin=false,anotacion=false,yAnterior=pagina.lineas[cab.hasta].y;
 for(const linea of pagina.lineas.slice(cab.hasta+1)){
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
  if(RE_PIE.test(primera)||linea.celdas.some(c=>RE_PIE_CUALQUIERA.test(clave(c.texto)))||separacion>3.2*altoFila+16){
   fin=true;pie.push(linea);
   if(!RE_PIE.test(primera)){
    const {celdas}=asignar(linea);
    if(!esManuscrita(linea)&&celdas.cantidad&&pareceNumero(celdas.cantidad.texto)&&(celdas.referencia||celdas.descripcion)&&
      (celdas.referencia||celdas.precio||celdas.importe)&&linea.texto.split(/\s+/).length<=14)dudosasTrasFin.push(linea.texto);
   }
   continue;
  }
  if(evaluarCabecera(linea.celdas).valida){ // cabecera repetida: se registra, nunca se pierde en silencio
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Cabecera de tabla repetida"});
   yAnterior=linea.y;continue;
  }
  // Manuscritos sobre el escaneo: el OCR los lee como palabras de confianza muy baja.
  // Una línea compuesta casi solo de ese texto no es un artículo impreso.
  if(esManuscrita(linea)){
   // Renglón de texto débil (tachado, rodeado a bolígrafo) justo bajo una línea y dentro de la
   // columna de descripción: puede ser su continuación. Se añade, pero la descripción queda en revisión.
   const desc=cols.find(x=>x.campo==="descripcion");
   // Si a su altura hay una anotación («Retirado por: VICTOR …»), es parte de ella, no de la descripción.
   const junto=pagina.lineas.some(l=>l!==linea&&Math.abs(l.y-linea.y)<=1.2*Math.max(linea.alto,l.alto)&&RE_ANOTACION.test(clave(l.texto)));
   if(actual&&desc&&!junto&&linea.celdas.every(c=>c.x0>=desc.ini&&c.x1<=desc.fin)&&linea.y-yAnterior<=2*Math.max(linea.alto,altoFila)){
    actual.continuacionesDudosas=[...(actual.continuacionesDudosas||[]),linea.texto];
    yAnterior=linea.y;continue;
   }
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Texto de baja confianza OCR (posible manuscrito o sello)"});
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
  if((!tieneCantidad&&RE_ANOTACION.test(textoLinea))||(refRotulo&&!tieneImportes)){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Anotación del proveedor, no es un artículo"});
   yAnterior=linea.y;anotacion=true;continue;
  }
  // Toda línea con referencia, cantidad o importe es una fila: si falta un dato
  // queda en REVISAR, nunca se descarta en silencio.
  // Ruido (manuscritos, marcas): sin referencia ni descripción y sin ninguna cifra válida.
  // OCR: tampoco es un artículo una cifra suelta, sin código, descripción ni cantidad, leída con
  // confianza baja (trazo de un manuscrito que cae en una columna de importes).
  const soloRuido=!tieneRef&&!celdas.descripcion&&
   (Object.entries(celdas).every(([k,c])=>!NUMERICAS.has(k)||!pareceNumero(c.texto))||
    (!tieneCantidad&&Object.values(celdas).every(c=>c.conf!=null&&c.conf<90)));
  if(soloRuido){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Texto sin artículo ni cifras válidas (posible manuscrito o marca)"});
   continue;
  }
  // Segundo renglón de una anotación («Retirado por: JUAN» / «PÉREZ»).
  const soloTextoLinea=Object.keys(celdas).every(k=>["descripcion","referencia","otra","unidad"].includes(k));
  if(anotacion&&!tieneCantidad&&!tieneImportes&&(soloTextoLinea||!tieneRef)&&linea.y-yAnterior<=2*Math.max(linea.alto,altoFila)){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Continuación de una anotación del proveedor"});
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
   yAnterior=linea.y;continue;
  }
  const soloPalabra=tieneRef&&!tieneCantidad&&!tieneImportes&&!celdas.descripcion&&!/\d/.test(celdas.referencia.texto);
  if(soloPalabra){
   ignoradas.push({pagina:pagina.numero,texto:linea.texto,motivo:"Palabra suelta en la columna de código (posible obra o anotación)",anotacion:true});
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
   // El OCR puede partir un mismo renglón en dos («Suministro» / «y montaje»): orden por posición.
   if(previas.length)actual.textoPrevio=previas.sort((a,b)=>a._x-b._x).map(v=>v._texto).filter(Boolean).join(" ");
   filas.push(actual);
  }else{
   const soloTexto=Object.keys(celdas).every(k=>["descripcion","referencia","otra","unidad"].includes(k));
   if(actual&&soloTexto&&celdas.descripcion&&!celdas.referencia&&linea.y-yAnterior<=1.8*linea.alto&&
     !RE_ANOTACION.test(clave(celdas.descripcion.texto))){
    actual.continuaciones.push(celdas.descripcion.texto);
   }else{
    const ig={pagina:pagina.numero,texto:linea.texto,motivo:"Línea sin cantidad dentro de la tabla"};
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
 cuota:/^(CUOTA ?[IL1]VA|TOTAL ?[IL1]VA|IMPORTE IVA|I V A|IVA)\b/,
 total:/^(TOTAL A PAGAR|TOTAL ALBARAN|IMPORTE TOTAL|TOTAL EUR|TOTAL)\b/
};
const EXCLUIR_TOTAL=/^TOTAL ?(LINEAS|[IL1]VA|RE|NETO|BRUTO)\b/;
function candidatos(lineas,re,opcionesNumero,{excluir=null,porcentaje=false}={}){
 const out=[];
 lineas.forEach((linea,li)=>{let saltar=-1;linea.celdas.forEach((celda0,ci)=>{
  if(ci<=saltar)return;
  // Etiqueta partida en dos celdas por el OCR («Base» «Imponible», «Cuota» «IVA»).
  const sig=linea.celdas[ci+1];
  let celda=celda0,usadas=0;
  if(sig&&sig.x0-celda0.x1<1.5*celda0.alto){
   const k2=clave(celda0.texto+" "+sig.texto);
   if(re.test(k2)&&k2.match(re)[0].length>(clave(celda0.texto).match(re)?.[0].length||0)){
    celda={...celda0,texto:celda0.texto+" "+sig.texto,x1:sig.x1};usadas=1;
   }
  }
  const k=clave(celda.texto);const m=k.match(re);
  if(!m||(excluir&&excluir.test(k)))return;
  saltar=ci+usadas;
  const resto=celda.texto.slice(m[0].length).replace(/^[\s:€]+/,"").trim();
  const textos=[resto,...linea.celdas.slice(ci+1+usadas,ci+4+usadas).map(c=>c.texto)];
  // Valor debajo: la primera celda solapada en horizontal en los tres renglones siguientes.
  for(const l2 of lineas.slice(li+1,li+4)){
   if(l2.y-linea.y>4.5*Math.max(linea.alto,celda.alto))break;
   const abajo=l2.celdas.find(c=>Math.min(c.x1,celda.x1)-Math.max(c.x0,celda.x0)>0);
   if(abajo&&/\d/.test(abajo.texto)){textos.push(abajo.texto);break;}
   if(abajo)break;
  }
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
 });});
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
 // Base y cuota se imprimen a veces con 4 y con 2 decimales (48,0000 y 48,00): al céntimo
 // son la misma combinación; se conserva la que tiene los importes en céntimos.
 const cent=v=>Math.round(v*100);
 const decs=x=>[x.b,x.c].reduce((n,y)=>n+((String(y.literal).match(/,(\d+)/)||[,""])[1].length>2?1:0),0);
 const grupos=new Map();
 for(const x of elegidos){const k=[cent(x.b.valor),cent(x.c.valor),cent(x.t.valor)].join("|");const y=grupos.get(k);if(!y||decs(x)<decs(y))grupos.set(k,x);}
 const distintos=[...grupos.values()];
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
  if(q<=0)continue;
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
 if(cruda.continuaciones.length){
  f.descripcion.literal=[f.descripcion.literal,...cruda.continuaciones].filter(Boolean).join(" ");
  f.descripcion.valor=f.descripcion.literal||null;f.descripcion.estado=f.descripcion.literal?"OK":"VACIO";
  f.notas.push("Descripción en "+(cruda.continuaciones.length+1)+" renglones");
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
 if(cruda.textoPrevio){
  f.descripcion.estado=f.descripcion.estado==="VACIO"?"VACIO":"REVISAR";
  f.descripcion.texto_previo=cruda.textoPrevio;
  f.descripcion.motivos=[...(f.descripcion.motivos||[]),"Texto justo encima de la línea: «"+cruda.textoPrevio+"» (¿primer renglón de la descripción o anotación?)"];
 }
 for(const campo of cruda.conflictos){
  f[campo]={...f[campo],valor:null,estado:"AMBIGUO",motivos:[...(f[campo].motivos||[]),"Varias cifras en la misma columna"]};
 }
 importeEnColumnaDescuento(f,opcionesNumero,precioPor);
 f.cuadre=cuadre(f,precioPor);
 if(f.cuadre.estado!=="VERIFICADO")repararSeparadoresOCR(f,opcionesNumero,precioPor);
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
 const perfil=salida.proveedor.id?registro.proveedores.find(p=>p.id===salida.proveedor.id):null;
 const opcionesFecha={hoy:opciones.hoy,orden:perfil?.orden_fecha||"DMY"};
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
 // Número sin etiqueta o tras una serie («L26-01234 01/10/2026», «ALBARÁN AB26 001234»): con el
 // formato propio del proveedor se busca en la primera página; solo se acepta si hay uno solo.
 if(perfil?.formato_numero&&!(salida.numero.estado==="OK"&&new RegExp(perfil.formato_numero).test(salida.numero.valor))){
  const r=numeroPorFormato(primera.p,perfil,salida.numero,opcionesFecha);
  if(r){
   salida.numero=r.numero;
   if(r.fecha&&(salida.fecha.estado!=="OK"))salida.fecha=r.fecha;
  }
 }
 // Formato de número propio del proveedor (comprobado en sus albaranes reales): un número que
 // no lo cumple («26101234» por «26/01234») no se acepta.
 if(perfil?.formato_numero&&salida.numero.estado==="OK"&&!new RegExp(perfil.formato_numero).test(salida.numero.valor)){
  salida.numero={...salida.numero,estado:"REVISAR",motivos:[...salida.numero.motivos,"No tiene el formato de número habitual del proveedor"]};
 }
 const sinEtiqueta=f=>f.motivos.some(m=>/sin etiqueta/i.test(m));
 if((salida.fecha.estado==="VACIO"||sinEtiqueta(salida.fecha))&&primera.t){
  const f=leerFecha(primera.p.lineas,opcionesFecha);
  // Una fecha etiquetada en el pie prevalece sobre una sin etiqueta del encabezado.
  if(salida.fecha.estado==="VACIO"?f.estado!=="VACIO":f.estado!=="VACIO"&&!sinEtiqueta(f)&&f.estado!=="AMBIGUO")salida.fecha=f;
 }
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
  const fila=construirFila(cruda,++n,opcionesNumero,perfil,precioPor);
  if(salida.tipo_pdf==="ESCANEADO_OCR"&&fila.descripcion.valor){
   const v=restituirGlifos(fila.descripcion.valor,perfil);
   if(v!==fila.descripcion.valor){fila.descripcion={...fila.descripcion,valor:v,notas:[...(fila.descripcion.notas||[]),"Símbolo restituido según el formato del proveedor (el OCR no lo reconoce)"]};}
  }
  salida.lineas.push(fila);
 }
 // Fila sin código pegada debajo de otra y en la columna de descripción («LATON 2» separado de
 // «CODO 92 M-H» por un trazo a mano): puede ser el final de la descripción anterior, que entonces
 // estaría cortada. La anterior no se acepta sin revisión.
 if(!perfil?.permite_sin_referencia)salida.lineas.forEach((l,i)=>{
  const ant=salida.lineas[i-1],a=ant?.descripcion?.caja,b=l.descripcion?.caja;
  if(!ant||l.referencia.estado!=="VACIO"||!a||!b||l.pagina!==ant.pagina||ant.descripcion.estado!=="OK")return;
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
 salida.totales=leerTotales(pie,opcionesNumero);
 const base=salida.totales.base_imponible.estado!=="VACIO"&&salida.totales.base_imponible.valor!==null?salida.totales.base_imponible:sumaLineasImpresa;
 salida.pie={total_lineas:totalLineas,suma_lineas_impresa:sumaLineasImpresa,base_imponible:base};
 // Geometría de las tablas (para relecturas por zonas en documentos escaneados).
 salida.tablas=tablas.map(x=>x.t?{pagina:x.p.numero,y_cabecera:x.p.lineas[x.t.indiceCabecera].y-x.p.lineas[x.t.indiceCabecera].alto,
  y_fin:x.t.pie.length?x.t.pie[0].y:(x.p.lineas.at(-1)?.y??x.p.alto),ancho:x.p.ancho,alto:x.p.alto}:{pagina:x.p.numero,y_cabecera:null});
 // Tipo de documento impreso: «ABONO» o «DEVOLUCIÓN» (sello o título) frente a albarán.
 const textoDoc=clave(paginas.flatMap(p=>p.lineas.map(l=>l.texto)).join(" "));
 const tipoImpreso=/\bABONO\b/.test(textoDoc)?"ABONO":/\bDEVOLUCION\b/.test(textoDoc)?"DEVOLUCION":null;
 Object.defineProperty(salida,"_ctx",{enumerable:false,writable:true,value:{
  perfil,totalLineas,base,tipoImpreso,hayTabla:tablas.some(x=>x.t),columnas:primera.t?.cabecera||[],opcionesNumero,precioPor,
  // Cifras impresas en el pie (para completar totales cuya etiqueta no se ha leído).
  cifrasPie:pie.flatMap(l=>l.celdas.flatMap(c=>String(c.texto).split(/\s+/).map(t=>t.replace(/[€%]/g,"").trim()).filter(t=>/\d/.test(t))
   .map(t=>({literal:t,...N().numero(t,opcionesNumero),caja:caja(c),conf:c.conf??null})).filter(x=>x.estado==="OK"))),
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
 const impreso=(valor,{porcentaje=false}={})=>{
  const x=cifras.filter(c=>Math.abs(c.valor-valor)<0.006&&(porcentaje||/[.,]\d{2}$/.test(c.literal)));
  const lits=[...new Set(x.map(c=>c.valor))];
  return lits.length===1?x[0]:null;
 };
 const poner=(k,c,evidencia)=>{T[k]={literal:c.literal,valor:c.valor,estado:"VERIFICADO",motivos:[],notas:["Etiqueta no legible: "+evidencia],caja:c.caja,
  resolucion:{metodo:"cifra_impresa_validada",evidencias:[evidencia,"Impreso «"+c.literal+"» en el pie"]}};};
 // Base = suma de líneas verificadas, si esa suma está impresa.
 const lineas=salida.lineas;
 if(!ok(T.base_imponible)&&lineas.length&&lineas.every(l=>l.cuadre?.estado==="VERIFICADO")){
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

/* Validaciones de documento, confianza y estado. Se puede repetir tras combinar lecturas. */
function finalizar(salida){
 const ctx=salida._ctx,incidencias=[...ctx.incidenciasBase];
 // Tipo: impreso («ABONO») o deducido de importes y cantidades negativos (devolución).
 const negativos=salida.lineas.length>0&&salida.lineas.every(l=>l.cantidad.valor<0||l.importe.valor<0);
 salida.tipo_documento=ctx.tipoImpreso?{valor:"ABONO",evidencia:"Impreso «"+ctx.tipoImpreso+"» en el documento"}:
  negativos?{valor:"ABONO",evidencia:"Todas las líneas tienen cantidad o importe negativo"}:{valor:"ALBARAN",evidencia:null};
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
 completarTotales(salida,ctx);
 const t=salida.totales;
 if(t?.validacion)v("totales",t.validacion.estado,t.validacion.detalle);
 // Sin base + IVA = total comprobado (p. ej. rótulos del pie ilegibles), el total se contrasta
 // con las líneas: suma de importes × (1 + IVA) para los tipos españoles 21, 10, 4 y 0 %.
 // Si no cuadra con ninguno, pueden faltar líneas o haber otros cargos: el total queda en revisión.
 const lineasConImporte=salida.lineas.filter(l=>["VERIFICADO","OK"].includes(l.importe.estado));
 if(t&&t.validacion?.estado!=="OK"&&["OK","VERIFICADO"].includes(t.total?.estado)&&salida.lineas.length&&lineasConImporte.length===salida.lineas.length){
  const suma=redondear(lineasConImporte.reduce((n,l)=>n+l.importe.valor,0));
  const tipo=[21,10,4,0].find(x=>Math.abs(redondear(suma+redondear(suma*x/100))-t.total.valor)<=0.021);
  if(tipo!==undefined){
   t.total={...t.total,estado:"VERIFICADO",notas:[...(t.total.notas||[]),"Total = suma de líneas "+suma+" + IVA "+tipo+" %"]};
   v("total_con_lineas","OK","Suma de líneas "+suma+" + IVA "+tipo+" % = total «"+t.total.literal+"»");
  }else{
   t.total={...t.total,estado:"REVISAR",motivos:[...(t.total.motivos||[]),"No coincide con la suma de líneas a ningún tipo de IVA (¿líneas sin leer u otros cargos?)"]};
   v("total_con_lineas","FALLO","Suma de líneas "+suma+" sin tipo de IVA que dé el total «"+t.total.literal+"»");
  }
 }
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

return {VERSION,UMBRAL_FIABLE,restituirGlifos,extraerPdf,extraerDePaginas,finalizar,leerTablaPagina,identificarProveedor,cuadre,celdasEtiqueta};
});
