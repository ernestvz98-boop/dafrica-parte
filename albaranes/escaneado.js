"use strict";
/*
 * DAFRICA · Albaranes escaneados: varias lecturas OCR y aceptación solo de lo que valida.
 *
 * Cada página se lee varias veces (segmentaciones distintas de la página entera y una
 * relectura de la banda de la tabla). Con cada lectura se ejecuta el mismo extractor que
 * con los PDF digitales y después se combinan:
 *  - se toma como principal la lectura con más campos validados;
 *  - cabecera (CIF, número, fecha): solo se acepta un valor si las lecturas válidas
 *    coinciden; dos lecturas válidas distintas → AMBIGUO;
 *  - líneas: si la principal no cuadra y otra lectura de la MISMA línea cuadra
 *    (cantidad × precio × descuento = importe), se toman sus cifras; si dos lecturas
 *    válidas discrepan en la cantidad o la referencia, la línea queda en revisión.
 * Ningún valor se inventa: solo se elige entre lo leído y lo que supera las validaciones.
 *
 * Motor independiente: páginas [{numero, anchoPx, altoPx, dpi, ocr: async ({psm, region}) => palabras}].
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.escaneado=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const M=k=>req?req("./"+{extraer:"extraer.js",ocr:"ocr.js",normalizar:"normalizar.js",manuscritos:"manuscritos.js",etiquetas:"etiquetas.js"}[k]):root.DafricaAlbaranes[k];
// La binarización adaptativa (Sauvola) rescata rótulos y cifras sobre fondos grises.
const LECTURAS=[{psm:4},{psm:6},{psm:3},{psm:4,umbral:"sauvola"}];

function puntuar(r){
 let s=0;
 if(r.proveedor?.estado==="OK")s+=3;
 if(r.numero?.estado==="OK")s+=2;
 if(r.fecha?.estado==="OK")s+=2;
 // Una fila repartida por posición estimada vale menos que la misma fila con celdas separadas.
 // Una línea que solo cuadra tras reparar la lectura (separador, primera cifra perdida) vale menos que la que cuadra tal cual.
 for(const l of r.lineas||[])s+=(l.cuadre?.estado==="VERIFICADO"?(l.cuadre.reparado?2.5:3):l.estado==="OK"?1:-1)-(l.columnas_estimadas?0.5:0);
 for(const v of r.validaciones||[])if(v.estado==="FALLO")s-=2;
 if(r.totales?.validacion?.estado==="OK")s+=2;
 return s;
}
/*
 * Código de barras EAN-13 / EAN-8 con su dígito de control correcto (fallo real 2026-11-17: referencias EAN bien leídas quedaban
 * en revisión porque las relecturas daban cifras distintas). El dígito de control es una comprobación independiente del OCR: una
 * cifra mal leída casi nunca la cumple.
 */
function eanValido(t){
 const s=String(t??"").trim();
 if(!/^(\d{8}|\d{13})$/.test(s))return false;
 const d=s.split("").map(Number),n=d.length;let suma=0;
 for(let i=0;i<n-1;i++)suma+=d[i]*((n===13?i%2:(i+1)%2)?3:1);
 return (10-suma%10)%10===d[n-1];
}
const claveLinea=l=>M("normalizar").canon(l.referencia?.literal||"")+"|"+M("normalizar").canon(l.descripcion?.literal||"").slice(0,24);
function similitud(a,b){
 const N=M("normalizar");
 let s=0;
 if(N.canon(a.referencia?.literal)&&N.canon(a.referencia?.literal)===N.canon(b.referencia?.literal))s+=2;
 const da=N.canon(a.descripcion?.literal).slice(0,20),db=N.canon(b.descripcion?.literal).slice(0,20);
 if(da&&db&&(da===db||da.slice(0,10)===db.slice(0,10)))s+=1;
 if(a.cantidad?.valor!=null&&a.cantidad.valor===b.cantidad?.valor)s+=0.5;
 return s;
}
// Textos distintos del de la casilla `c` (código o descripción de la línea `l`) en otras lecturas de la página que la leen
// ENTERA y con confianza: palabras de la misma fila física que pisan la casilla, todas con 90 o más, desde su principio hasta
// su final. Una lectura que no la cubre o con alguna palabra dudosa no cuenta (no es una interpretación fiable).
// El texto de cada lectura se compara con el de la lectura principal sacado igual (palabras en bruto de esa zona), no con la
// casilla ya limpia: la limpieza no es una lectura distinta.
function lecturasFiablesDistintas(l,c,lecturas,N,principal){
 const [x0,y,x1,alto]=c.caja;
 if(!(alto>0)||!N.canon(c.literal??c.valor))return [];
 const textoDe=r=>{
  const pg=(r._pags||[]).find(p=>l.pagina==null||p.numero===l.pagina);
  if(!pg)return null;
  const ws=(pg.lineas||[]).flatMap(li=>li.celdas||[])
   .filter(w=>Math.abs(w.y-y)<=0.6*Math.max(alto,w.alto||0)&&w.x1>x0+0.5&&w.x0<x1-0.5)
   .sort((a,b)=>a.x0-b.x0);
  if(!ws.length||ws.some(w=>!(w.conf>=90)))return null;
  if(ws[0].x0>x0+0.6*alto||ws.at(-1).x1<x1-0.6*alto)return null;
  return ws.map(w=>w.texto).join(" ").trim();
 };
 const base=textoDe(principal);
 if(base==null)return [];
 const distintos=new Set();
 for(const r of lecturas){
  if(r===principal)continue;
  const t=textoDe(r);
  if(t!=null&&N.canon(t)&&N.canon(t)!==N.canon(base))distintos.add(t);
 }
 return [...distintos];
}

// Para cada línea de la principal, la línea más parecida de otra lectura (si se parece).
function emparejar(principal,otra){
 const usadas=new Set();
 return principal.map(l=>{
  let mejor=null,ms=0;
  otra.forEach((o,i)=>{if(usadas.has(i))return;const s=similitud(l,o);if(s>ms){ms=s;mejor=i;}});
  if(mejor===null||ms<1)return null;
  usadas.add(mejor);return otra[mejor];
 });
}

function combinarCabecera(principal,lecturas){
 const N=M("normalizar");
 const campos=[
  ["numero",r=>r.numero?.estado==="OK"?N.canon(r.numero.valor):null],
  ["fecha",r=>r.fecha?.estado==="OK"?r.fecha.valor:null],
  ["proveedor",r=>["OK","NIF_NO_REGISTRADO"].includes(r.proveedor?.estado)?r.proveedor.nif:null]
 ];
 for(const [k,valor] of campos){
  const validos=lecturas.map(r=>({r,v:valor(r)})).filter(x=>x.v);
  const distintos=[...new Set(validos.map(x=>x.v))];
  if(distintos.length>1){
   principal[k]={...principal[k],valor:null,nif:k==="proveedor"?null:principal[k]?.nif,estado:"AMBIGUO",
    motivos:["Lecturas OCR válidas distintas: "+distintos.join(" | ")],lecturas:validos.length,
    // El CIF lo puede resolver después el catálogo completo de STEL si solo una de estas lecturas existe (verificacion.js).
    ...(k==="proveedor"?{lecturas_nif:distintos}:{})};
   continue;
  }
  if(distintos.length===1){
   const acuerdo=validos.length;
   if(valor(principal)!==distintos[0])principal[k]={...validos[0].r[k]}; // la principal no lo leyó: se toma de otra
   // Lecturas del mismo motor sobre la misma imagen: coincidir NO aumenta la confianza.
   principal[k].lecturas_coincidentes=acuerdo;
  }
 }
}

function combinarLineas(principal,lecturas){
 const otras=lecturas.filter(r=>r!==principal&&r.lineas?.length);
 const parejas=otras.map(r=>emparejar(principal.lineas,r.lineas));
 principal.lineas.forEach((l,i)=>{
  const alternativas=parejas.map(p=>p[i]).filter(Boolean);
  const a=l.cantidad?.caja;
  if(l.referencia)l.referencia.alternativas_ocr=[...new Set(alternativas.filter(o=>{
   const b=o.cantidad?.caja;
   return a&&b&&l.pagina===o.pagina&&Math.abs(a[1]-b[1])<=0.6*Math.min(a[3],b[3]);
  }).map(o=>o.referencia?.literal).filter(Boolean))];
  l.lecturas_coincidentes=1+alternativas.filter(o=>claveLinea(o)===claveLinea(l)&&o.cantidad?.valor===l.cantidad?.valor).length;
  // Unidad impresa que esta lectura no ve («ml» leído «mi») y otras lecturas de la MISMA fila física
  // (misma cantidad, misma altura) sí: se toma si todas las que la leen coinciden. Nunca se deduce.
  if(l.unidad?.estado==="VACIO"&&l.cantidad?.valor!=null&&a){
   const vistas=alternativas.filter(o=>o.unidad?.estado==="OK"&&o.unidad.valor&&o.cantidad?.valor===l.cantidad.valor&&o.pagina===l.pagina&&
    o.cantidad?.caja&&Math.abs(a[1]-o.cantidad.caja[1])<=0.6*Math.min(a[3],o.cantidad.caja[3]));
   const distintas=[...new Set(vistas.map(o=>String(o.unidad.valor).toLowerCase()))];
   if(distintas.length===1)l.unidad={...vistas[0].unidad,notas:[...(vistas[0].unidad.notas||[]),"Unidad leída en otra lectura OCR de la misma fila ("+vistas.length+")"]};
  }
  // Cifras que cuadran en otra lectura de la misma línea.
  if(l.cuadre?.estado!=="VERIFICADO"){
   const mismaFilaParaDescuento=o=>{
    // Un código O/0 dudoso no debe impedir recuperar un descuento IMPRESO de
    // la misma fila física. No se corrige ese código ni se eleva su confianza.
    const a=l.cantidad?.caja,b=o.cantidad?.caja;
    return l.descuento?.estado==="VACIO"&&a&&b&&l.pagina===o.pagina&&
     Math.abs(a[1]-b[1])<=0.6*Math.min(a[3],b[3])&&
     M("normalizar").canon(l.descripcion?.literal)===M("normalizar").canon(o.descripcion?.literal)&&
     ["cantidad","precio","importe"].every(k=>l[k]?.valor!=null&&l[k].valor===o[k]?.valor);
   };
   // Solo de la MISMA fila física: misma página y misma altura (fallo real 2026-11-18: un presupuesto con la misma referencia en
   // dos páginas y cantidades distintas; la fila sin cuadre tomaba las cifras de la otra página, «3 × 35,11» en vez de «4 × 35,11»).
   // La altura se compara en la MISMA casilla de las dos lecturas (foto real 2026-11-23: en una foto inclinada las cifras de la
   // derecha quedan más altas que el código de la izquierda; comparar el código de una con la cantidad de la otra descartaba la
   // fila buena). Sin ninguna casilla con posición en las dos, no es la misma fila.
   const mismaFila=o=>{
    if(l.pagina!==o.pagina)return false;
    const k=["cantidad","referencia","descripcion","precio","importe"].find(c=>l[c]?.caja&&o[c]?.caja);
    if(!k)return false;
    const ya=l[k].caja,yb=o[k].caja;
    return Math.abs(ya[1]-yb[1])<=0.6*Math.min(ya[3],yb[3]);
   };
   const verificada=alternativas.find(o=>o.cuadre?.estado==="VERIFICADO"&&mismaFila(o)&&
    (!M("normalizar").canon(l.referencia?.literal)||M("normalizar").canon(o.referencia?.literal)===M("normalizar").canon(l.referencia?.literal)||mismaFilaParaDescuento(o)));
   if(verificada){
    for(const k of ["cantidad","precio","descuento","subtotal","importe","cuadre"])l[k]=verificada[k];
    if(l.referencia?.estado==="VACIO"&&verificada.referencia?.estado!=="VACIO")l.referencia=verificada.referencia;
    l.motivos=l.motivos.filter(m=>!/^(Descuadre|Cuadre incompleto|Cantidad|precio|importe|descuento|Columnas separadas)/i.test(m));
    l.notas=[...(l.notas||[]),"Cifras tomadas de otra lectura OCR de la misma línea, confirmadas por el cuadre"];
   }
  }
  // Dos lecturas válidas que discrepan en cantidad o referencia: revisión.
  const conflicto=alternativas.find(o=>o.cantidad?.estado!=="AMBIGUO"&&o.cantidad?.valor!=null&&l.cantidad?.valor!=null&&
   o.cantidad.valor!==l.cantidad.valor&&o.cuadre?.estado!=="VERIFICADO"&&l.cuadre?.estado!=="VERIFICADO");
  if(conflicto&&!l.motivos.includes("Las lecturas OCR discrepan en la cantidad"))l.motivos.push("Las lecturas OCR discrepan en la cantidad");
  l.estado=l.motivos.length?"REVISAR":"OK";
 });
}

// Totales: si la principal no los verifica y otra lectura sí (base + cuota = total), se toman
// de esa; si dos lecturas verifican totales distintos, quedan en revisión.
function combinarTotales(principal,lecturas){
 // Cifras del pie vistas por cualquier lectura: completarTotales solo acepta la que exige el
 // cálculo (p. ej. «21,00 %» cuando base × 21 % = cuota), así que sumar lecturas no la relaja.
 if(principal._ctx)principal._ctx.cifrasPie=[principal,...lecturas].flatMap(r=>r._ctx?.cifrasPie||[]);
 if(principal.totales?.validacion?.estado==="OK")return;
 const ok=lecturas.filter(r=>r.totales?.validacion?.estado==="OK"&&r.totales.total?.estado==="VERIFICADO");
 const distintos=[...new Map(ok.map(r=>[[r.totales.base_imponible.valor,r.totales.cuota_iva.valor,r.totales.total.valor].join("|"),r])).values()];
 if(distintos.length===1){
  const t=distintos[0].totales;
  principal.totales={...t,notas:["Totales tomados de la lectura "+distintos[0]._lectura+", confirmados por base + IVA = total"]};
 }else if(distintos.length>1){
  principal.totales.validacion={estado:"FALLO",detalle:"Lecturas OCR con totales verificados distintos"};
 }else if(principal.totales&&principal.totales.total?.estado==="VACIO"){
  // Solo el total, sin base ni cuota legibles: se toma si todas las lecturas que lo ven coinciden.
  // Después se contrasta con la suma de las líneas (finalizar).
  const vistos=lecturas.map(r=>r.totales?.total).filter(x=>["OK","VERIFICADO"].includes(x?.estado));
  const valores=[...new Set(vistos.map(x=>x.valor))];
  if(valores.length===1)principal.totales.total={...vistos[0],estado:"OK",notas:[...(vistos[0].notas||[]),"Total tomado de otra lectura OCR"]};
  else if(valores.length>1)principal.totales.total={...principal.totales.total,estado:"AMBIGUO",motivos:["Lecturas OCR con totales distintos: "+valores.join(" | ")]};
 }
}

/*
 * SEGUNDA FASE · campos sin aceptar o con confianza < 0,9 (número, fecha, código, descripción).
 * Se relee SOLO la caja del campo con varias estrategias (línea/palabra, ampliado, binarización
 * adaptativa, lista de caracteres). Se acepta un valor si TODAS las relecturas que dan un valor
 * válido coinciden, al menos 4 lo dan, su confianza OCR es ≥ 90 y supera la validación del campo
 * (formato del proveedor, fecha válida…). Si dan dos valores válidos distintos, no se resuelve.
 * Cada resolución guarda método, estrategias y evidencias.
 */
const ESTRATEGIAS=[{psm:7},{psm:8},{psm:7,escala:2},{psm:13,escala:2},{psm:7,escala:2,umbral:"sauvola"},{psm:6,escala:2}];
const LISTAS={numero:"0123456789./-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",fecha:"0123456789/-.",referencia:null,descripcion:null,descuento:"0123456789,.%+"};
const limpiarBordes=t=>String(t||"").replace(/^[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ(]+|[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ)%]+$/g,"");
async function releerCaja(p,caja,lista){
 const k=p.dpi/72,[x0,y,x1,alto]=caja;
 const rx0=Math.max(0,Math.floor((x0-0.6*alto)*k)),rx1=Math.min(p.anchoPx,Math.ceil((x1+0.6*alto)*k));
 const ry0=Math.max(0,Math.floor((y-1.3*alto)*k)),ry1=Math.min(p.altoPx,Math.ceil((y+0.45*alto)*k));
 if(rx1-rx0<8||ry1-ry0<8)return [];
 const salida=[];
 for(const e of ESTRATEGIAS)for(const l of lista?[null,lista]:[null]){
  // Signos sueltos (rayas de la tabla, comillas) no cuentan ni en el texto ni en la confianza.
  const palabras=(await p.ocr({...e,region:[rx0,ry0,rx1-rx0,ry1-ry0],lista:l})).filter(w=>!/^[|¦—–_\-'"`´‘’.,:;!¡¿?()\[\]{}<>«»=~*+#°º\\/]+$/.test(String(w.texto).trim()));
  if(!palabras.length)continue;
  salida.push({estrategia:"psm"+e.psm+(e.escala>1?"·x"+e.escala:"")+(e.umbral?"·"+e.umbral:"")+(l?"·lista":""),
   palabras,texto:palabras.map(w=>w.texto).join(" "),conf:Math.min(...palabras.map(w=>w.conf))});
 }
 return salida;
}
// Valor candidato de una relectura según el campo; null si no es válido.
function candidatoDe(campo,texto,ctx){
 const {perfil,opcionesFecha}=ctx;
 const N=M("normalizar");
 const tokens=String(texto).split(/\s+/).map(limpiarBordes).filter(Boolean);
 // Descuento: un único porcentaje entre 0 y 100 en la casilla («20,00%», «20», «20+5»).
 if(campo==="descuento"){
  const v=tokens.map(t=>N.descuento(t,ctx.opcionesNumero||{})).filter(d=>d.estado==="OK"&&d.valor>0&&d.valor<100);
  return v.length===1?String(v[0].literal):null;
 }
 if(campo==="numero"){
  const re=perfil?.formato_numero?new RegExp(perfil.formato_numero):/^[A-Z0-9][A-Z0-9\/\-.]{2,24}$/i;
  // También dos fichas separadas solo por el espacio junto a «/», «-» o «.» («2026 /9294»).
  const crudos=String(texto).split(/\s+/).filter(Boolean);
  const pegadas=crudos.slice(0,-1).map((t,i)=>/[\/.\-]$/.test(t)||/^[\/.\-]/.test(crudos[i+1])?limpiarBordes(t+crudos[i+1]):null).filter(Boolean);
  const v=[...new Set([...tokens,...tokens.slice(0,-1).map((t,i)=>t+" "+tokens[i+1]),...pegadas])].filter(t=>re.test(t)&&/\d/.test(t)&&N.fecha(t).estado!=="OK");
  return v.length===1?v[0]:null;
 }
 if(campo==="fecha"){
  const v=tokens.map(t=>N.fecha(t,opcionesFecha)).filter(f=>f.estado==="OK");
  return v.length===1?v[0].valor:null;
 }
 // Código: si el recorte alcanza la fila vecina y trae varios, el más parecido a la lectura inicial.
 if(campo==="referencia"&&ctx.literal&&!/\s/.test(ctx.literal)&&tokens.length>1){
  const d=(a,b)=>{const m=a.length,n=b.length,D=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);
   for(let j=1;j<=n;j++)D[0][j]=j;
   for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)D[i][j]=Math.min(D[i-1][j]+1,D[i][j-1]+1,D[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
   return D[m][n];};
  const orden=[...tokens].sort((a,b)=>d(a,ctx.literal)-d(b,ctx.literal));
  return d(orden[0],ctx.literal)<d(orden[1],ctx.literal)?orden[0]:null;
 }
 const t=campo==="descripcion"?M("extraer").restituirGlifos(tokens.join(" "),perfil):tokens.join(" ");
 return t||null;
}
/*
 * ¿La lectura de visión del recorte coincide con UNA de las lecturas OCR de la casilla?
 * Devuelve {candidato, valor, regla} o null. Nunca acepta un texto que ningún OCR haya leído:
 * - número/fecha: el texto de la visión se valida como el OCR (formato del proveedor, fecha).
 * - código: igualdad exacta; si no, igualdad sin puntuación siempre que sea única.
 * - descripción: igualdad exacta; si no, mismas letras y cifras salvo espacios y signos sueltos al
 *   principio o al final («[CODO 92 M-H LATON2» / «CODO 92 M-H LATON 2»): se toma el texto de la visión.
 */
function coincidenciaVision(campo,candidatos,v,ctx={}){
 const N=M("normalizar");
 const cands=[...new Set((candidatos||[]).map(c=>String(c??"")))].filter(c=>c.trim());
 if(v==null||!String(v).trim())return null;
 const unica=(lista,regla,valor=x=>x)=>lista.length===1?{candidato:lista[0],valor:valor(lista[0]),regla}:null;
 if(campo==="numero"||campo==="fecha"){
  const cv=candidatoDe(campo,v,ctx);if(!cv)return null;
  const exactos=cands.filter(c=>c===cv);
  if(exactos.length)return unica(exactos,"exacta");
  return unica(cands.filter(c=>campo==="numero"&&N.canon(c)===N.canon(cv)),"sin_puntuacion");
 }
 if(campo==="referencia"){
  const exactos=cands.filter(c=>c.trim()===String(v).trim());
  if(exactos.length)return unica(exactos,"exacta");
  return unica(cands.filter(c=>N.canon(c)!==""&&N.canon(c)===N.canon(v)),"sin_puntuacion");
 }
 const esp=t=>String(t).replace(/\s+/g," ").trim();
 const exactos=cands.filter(c=>esp(c)===esp(v));
 if(exactos.length)return unica(exactos,"exacta");
 const letras=t=>String(t).replace(/^[^\p{L}\p{N}Ø]+|[^\p{L}\p{N}Ø.)%]+$/gu,"").replace(/\s+/g,"");
 return letras(v)?unica(cands.filter(c=>letras(c)===letras(v)),"espacios",()=>esp(v)):null;
}
async function resolverCampo(p,campo,cajas,ctx){
 const validas=[];
 for(const caja of cajas){
  for(const r of await releerCaja(p,caja,LISTAS[campo])){
   const v=candidatoDe(campo,r.texto,ctx);
   if(!v)continue;
   // La palabra con un símbolo que el OCR no conoce (Ø) tiene confianza baja por definición:
   // si el perfil del proveedor lo explica, su confianza no cuenta (el resto de palabras sí).
   let conf=r.conf;
   if(campo==="descripcion"&&ctx.perfil?.glifos_ocr&&r.palabras){
    const R=M("extraer").restituirGlifos;
    const otras=r.palabras.filter((w,i)=>R((i?r.palabras[i-1].texto+" ":"")+w.texto,ctx.perfil)===(i?r.palabras[i-1].texto+" ":"")+w.texto);
    if(otras.length&&otras.length<r.palabras.length)conf=Math.min(...otras.map(w=>w.conf));
   }
   validas.push({...r,conf,valor:v,caja});
  }
 }

 // Consenso de las relecturas FIABLES (confianza ≥ 80): las de confianza ínfima no votan.
 const fiables=validas.filter(v=>v.conf>=80),distF=[...new Set(fiables.map(v=>v.valor))];
 const resultado=(lista,conf)=>({valor:lista[0].valor,caja:lista[0].caja,conf,estrategias:lista.map(v=>v.estrategia),
  textos:[...new Set(lista.map(v=>v.texto))],descartadas:validas.filter(v=>!lista.includes(v)).map(v=>v.estrategia+"=«"+v.valor+"»")});
 if(distF.length>1)return {conflicto:distF};
 if(fiables.length>=3)return resultado(fiables,Math.min(...fiables.map(v=>v.conf)));
 // Pocas relecturas fiables: unanimidad amplia (≥ 8) cuando el campo tiene validación estructural
 // independiente del OCR (formato de número del proveedor, fecha válida).
 const distintos=[...new Set(validas.map(v=>v.valor))];
 if(distintos.length>1)return {conflicto:distintos};
 const mediana=[...validas.map(v=>v.conf)].sort((a,b)=>a-b)[Math.floor(validas.length/2)];
 // Referencia solo de cifras con el formato del proveedor: unanimidad de las 6 estrategias.
 const formatoRef=campo==="referencia"&&ctx.perfil?.formato_referencia&&new RegExp(ctx.perfil.formato_referencia).test(distintos[0]||"")&&/^\d+$/.test(distintos[0]||"");
 if((ctx.validacionEstructural&&validas.length>=8||formatoRef&&validas.length>=6)&&mediana>=40)return resultado(validas,mediana);
 return null;
}
/*
 * Cifras perdidas por el OCR de página (foto real de un albarán, 2026-11-23: en 6 de 7 filas no salían cantidad, precio,
 * descuento ni importe; las rayas verticales de la tabla y los trazos a mano sobre la columna de precios estorban al leer
 * la fila entera). Con las columnas probadas por al menos DOS filas que cuadran en la misma página, cada casilla vacía de
 * una fila se relee por separado (recorte entre las rayas, solo cifras) y se buscan las combinaciones de cantidad, precio,
 * descuento e importe con el formato de esas filas (mismos decimales). Solo si UNA combinación hace cuadrar la fila
 * (cantidad × precio × (1 − dto) = importe) se acepta: el cuadre es la evidencia; con dos o ninguna, nada cambia.
 * Lo que ya leyó el OCR de página no se cambia (es el único candidato de su casilla). Nunca se deduce una cifra.
 */
async function cifrasPorCasillas(principal,paginas,ctx,perfil){
 const N=M("normalizar"),X=M("extraer"),hechos=[];
 const ok=c=>c&&["OK","VERIFICADO"].includes(c.estado);
 const NUM=["cantidad","precio","importe"];
 const precioPor=ctx.precioPor||perfil?.precio_por||1;
 const soluciones=[];
 for(const pg of paginas){
  const lineas=principal.lineas.filter(l=>(l.pagina??pg.numero)===pg.numero);
  const ver=lineas.filter(l=>l.cuadre?.estado==="VERIFICADO"&&NUM.every(k=>ok(l[k])&&l[k].caja));
  if(ver.length<2)continue;
  const caja0=o=>[o.referencia,o.descripcion].map(c=>c?.caja).find(Boolean);
  // Columnas (x en puntos) y formato de cada cifra según las filas que cuadran.
  const col={},dec={},sep={};
  for(const k of ["cantidad","precio","descuento","importe"]){
   const cs=ver.map(o=>o[k]?.caja).filter(Boolean);
   if(cs.length)col[k]={x0:Math.min(...cs.map(c=>c[0])),x1:Math.max(...cs.map(c=>c[2])),h:Math.max(...cs.map(c=>c[3]))};
   if(k!=="descuento"){
    const ds=[...new Set(ver.map(o=>(String(o[k].literal||"").match(/[.,](\d+)$/)||[])[1]?.length??0))];
    const ss=[...new Set(ver.map(o=>(String(o[k].literal||"").match(/([.,])\d+$/)||[])[1]||""))];
    if(ds.length===1&&ss.length===1&&ss[0]){dec[k]=ds[0];sep[k]=ss[0];}
   }
  }
  if(!NUM.every(k=>col[k]&&dec[k]!=null))continue;
  const orden=["cantidad","precio","descuento","importe"].filter(k=>col[k]).sort((a,b)=>col[a].x0-col[b].x0);
  const h=Math.max(...orden.map(k=>col[k].h)),k=pg.dpi/72;
  // Bandas: desde la mitad del hueco con la columna anterior (o 2,5 alturas antes) hasta 0,6 alturas tras la cifra más a
  // la derecha (las cifras van alineadas a la derecha); así el recorte no llega a la raya de la columna siguiente.
  const banda={};
  orden.forEach((c,i)=>{
   const izq=i?(col[orden[i-1]].x1+col[c].x0)/2+0.2*h:col[c].x0-2.5*h;
   banda[c]=[izq,col[c].x1+0.6*h];
  });
  // Desplazamiento vertical de las cifras respecto al código de su fila (mediana de las filas que cuadran).
  const dys=ver.map(o=>caja0(o)?o.importe.caja[1]-caja0(o)[1]:null).filter(v=>v!=null).sort((a,b)=>a-b);
  const dy=dys.length?dys[Math.floor(dys.length/2)]:0;
  for(const l of lineas){
   if(l.cuadre?.estado==="VERIFICADO"||NUM.every(c=>ok(l[c])))continue;
   const numerica=NUM.map(c=>l[c]).find(c=>ok(c)&&c.caja);
   const base=numerica?numerica.caja[1]:caja0(l)?caja0(l)[1]+dy:null;
   if(base==null)continue;
   const cand={},centro={};
   for(const c of orden){
    if(ok(l[c])){cand[c]=[{literal:l[c].literal,valor:l[c].valor}];continue;}
    const [a,b]=banda[c];
    const rx0=Math.max(0,Math.floor(a*k)),rx1=Math.min(pg.anchoPx,Math.ceil(b*k));
    const ry0=Math.max(0,Math.floor((base-1.4*h)*k)),ry1=Math.min(pg.altoPx,Math.ceil((base+0.6*h)*k));
    if(rx1-rx0<6||ry1-ry0<6){cand[c]=[];continue;}
    const textos=[];
    for(const e of [{psm:7},{psm:7,escala:2},{psm:8,escala:2}]){
     // (El OCR de una línea da la altura entera del recorte: la fila vecina se descarta después, por la solución repetida.)
     const ws=(await pg.ocr({...e,region:[rx0,ry0,rx1-rx0,ry1-ry0],lista:c==="descuento"?"0123456789,.%+":"0123456789,."}))
      .filter(w=>/\d/.test(w.texto));
     if(ws.length)textos.push(ws.map(w=>w.texto).join(" "));
    }
    const vistos=new Map();
    if(c==="descuento"){
     for(const t of textos){
      const tk=t.split(/[\s+%]+/).filter(x=>/^\d{1,2}([.,]\d{1,2})?$/.test(x));
      const lits=tk.length===1?[tk[0]]:tk.length===2?[tk.join("+")]:[];
      // Descuento en cascada leído sin el espacio («45 5» → «455»): más de 100 no es un descuento; se prueban sus cortes
      // («45+5», «4+55») y solo el cuadre decide.
      for(const x of t.split(/[\s%]+/))if(/^\d{3,4}$/.test(x)&&Number(x)>=100)
       for(let i=1;i<x.length;i++){const a=x.slice(0,i),b=x.slice(i);if(a.length<=2&&b.length<=2&&!/^0/.test(b))lits.push(a+"+"+b);}
      for(const lit of lits){const d=N.descuento(lit,ctx.opcionesNumero||{});if(d.estado==="OK"&&d.valor>0&&d.valor<100)vistos.set(lit,{literal:lit,valor:d.valor,factor:d.factor,porcentajes:d.porcentajes});}
     }
     if(!textos.length)vistos.set("",{literal:"",valor:null,vacio:true});
    }else{
     // El OCR confunde la coma y el punto decimales («12.50» por «12,50»): vale cualquiera de los dos con los decimales de
     // la columna; el valor se lee como el de las filas que cuadran.
     const re=new RegExp("^\\d{1,5}[.,]\\d{"+dec[c]+"}$");
     for(const t of textos)for(const tok of t.split(/\s+/))
      for(let i=0;i<tok.length;i++)for(let j=i+1;j<=tok.length;j++){
       const s=tok.slice(i,j);
       if(!re.test(s)||/^0\d/.test(s))continue;
       // El valor sale del formato de la columna (sus decimales), no del separador: «40,000» con 3 decimales es 40, no 40.000.
       const lit=s.replace(/[.,](?=\d+$)/,sep[c]),valor=Number(s.replace(/[.,](?=\d+$)/,"."));
       // Cero nunca: los trozos «0,000» y «0,00» de una cifra harían cuadrar una fila con todo a cero.
       if(Number.isFinite(valor)&&valor>0)vistos.set(lit,{literal:lit,valor,decimales:dec[c]});
      }
    }
    cand[c]=[...vistos.values()];centro[c]=textos;
   }
   if(!NUM.every(c=>cand[c]?.length))continue;
   const sols=[];
   for(const q of cand.cantidad)for(const pr of cand.precio)for(const im of cand.importe)for(const d of cand.descuento||[{vacio:true}]){
    const prueba={...l,subtotal:l.subtotal||{estado:"VACIO"},cantidad:{...q,estado:"OK"},precio:{...pr,estado:"OK"},importe:{...im,estado:"OK",decimales:dec.importe},
     descuento:d.vacio?(ok(l.descuento)?{...l.descuento,estado:"OK"}:{estado:"VACIO"}):{...d,estado:"OK"}};
    const cu=X.cuadre(prueba,precioPor);
    if(cu.estado==="VERIFICADO")sols.push({q,pr,im,d:d.vacio?null:d,cu});
   }
   const distintas=[...new Map(sols.map(s=>[[s.q.valor,s.pr.valor,s.im.valor,s.d?.valor??0].join("|"),s])).values()];
   if(distintas.length===1)soluciones.push({l,s:distintas[0],base,h,banda,textos:centro});
   else if(distintas.length>1)l.motivos=[...(l.motivos||[]),"Relectura por casillas: "+distintas.length+" combinaciones cuadran; no se resuelve"];
  }
 }
 // Dos filas muy juntas con la misma solución (un trozo de la fila de al lado leído como otra fila): no se da a ninguna,
 // salvo que una sea solo un fragmento sin descripción (la foto real partió la primera fila en «585» y la fila de verdad):
 // entonces es de la que tiene descripción.
 const clave=x=>[x.s.q.valor,x.s.pr.valor,x.s.im.valor,x.s.d?.valor??0].join("|");
 const conDescripcion=x=>String(x.l.descripcion?.valor??x.l.descripcion?.literal??"").trim().length>=3;
 for(const x of soluciones){
  const gemelas=soluciones.filter(o=>o!==x&&o.l.pagina===x.l.pagina&&clave(o)===clave(x)&&Math.abs(o.base-x.base)<2.5*x.h);
  if(gemelas.length&&!(conDescripcion(x)&&gemelas.every(o=>!conDescripcion(o)))){
   x.l.motivos=[...(x.l.motivos||[]),"Relectura por casillas: la misma combinación sale en la fila de al lado; no se resuelve"];continue;
  }
  const {l,s}=x;
  const evid=(c,v)=>"Casilla de "+c+" releída sola ("+((x.textos[c]||[]).map(t=>"«"+t+"»").join(", ")||"lectura de página")+") → "+v;
  const poner=(c,v,extra={})=>{
   if(ok(l[c]))return {...l[c],estado:"VERIFICADO",motivos:(l[c].motivos||[]).filter(m=>m!=="El cuadre de la línea no se cumple")};
   const [a,b]=x.banda[c]||[0,0];
   return {...(l[c]||{}),...extra,literal:v.literal,valor:v.valor,estado:"VERIFICADO",motivos:[],caja:[a,x.base,b,x.h],
    resolucion:{metodo:"relectura_casillas_cuadre",confianza:0.95,evidencias:[evid(c,v.literal),"Con esas cifras la línea cuadra: "+s.cu.detalle,
     "Única combinación con el formato de las filas que cuadran que hace cuadrar la línea"]}};
  };
  l.cantidad=poner("cantidad",s.q);l.precio=poner("precio",s.pr);l.importe=poner("importe",s.im,{decimales:s.im.literal.split(/[.,]/)[1]?.length});
  if(s.d)l.descuento=poner("descuento",s.d,{factor:s.d.factor,porcentajes:s.d.porcentajes});
  // Los avisos de la fila sobre esas cifras (vacías, cuadre incompleto) ya no son ciertos.
  l.cuadre=s.cu;l.motivos=(l.motivos||[]).filter(m=>!/^(Descuadre|Cuadre incompleto|Cuadre|Sin precios|Cantidad|Precio|Importe|Descuento)\b[^:]*:/i.test(m));
  // El estado de la fila sale de sus motivos (igual que al construirla).
  l.estado=l.motivos.length?"REVISAR":"OK";
  hechos.push("linea "+l.fila+" cifras (relectura por casillas y cuadre)");
 }
 return hechos;
}

/*
 * Títulos de código y descripción ilegibles (foto real, 2026-11-23: «CSbIdO» y «CUNCSNELDAS»): con CANTIDAD y dos títulos
 * económicos leídos, el lector deduce esas columnas por su posición y deja códigos y descripciones en revisión. Se releen
 * SOLO esos títulos (recorte de cada uno, las 6 estrategias de la relectura dirigida). La deducción queda confirmada si en
 * cada título al menos dos relecturas dan el título deducido (CÓDIGO, REFERENCIA o ARTÍCULO para el código; DESCRIPCIÓN,
 * CONCEPTO o DENOMINACIÓN para la descripción) y ninguna da otro. Solo se quita ese motivo: lo demás queda como estaba.
 */
async function titulosPorRelectura(principal,paginas){
 const MOTIVO="Títulos de columna deducidos por posición",MOT_CAMPO="Título de la columna ilegible: columna deducida por su posición";
 const afectadas=principal.lineas.filter(l=>(l.motivos||[]).includes(MOTIVO));
 if(!afectadas.length)return [];
 const X=M("extraer"),N=M("normalizar"),hechos=[];
 // Título leído: el reconocimiento normal o, para confirmar SOLO estas dos columnas, una letra cambiada en un título de
 // 6 letras o más («CUDIGO» por «CODIGO»; el reconocimiento normal lo admite desde 7).
 const TITULOS={CODIGO:"referencia",REFERENCIA:"referencia",ARTICULO:"referencia",DESCRIPCION:"descripcion",CONCEPTO:"descripcion",DENOMINACION:"descripcion"};
 const d1=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0;while(i<a.length&&a[i]===b[i])i++;
  return a.slice(i+1)===b.slice(i+1)||a.slice(i+1)===b.slice(i)||a.slice(i)===b.slice(i+1);};
 const tituloDe=t=>{
  const d=X.campoDe(t);if(d)return d.campo;
  const encontrados=new Set();
  for(const p of String(t||"").split(/\s+/)){
   const c=X.campoDe(p)?.campo;if(c){encontrados.add(c);continue;}
   const k=N.canon(p).replace(/[^A-Z]/g,"");
   if(k.length>=6)for(const [titulo,campo] of Object.entries(TITULOS))if(d1(k,titulo))encontrados.add(campo);
  }
  return encontrados.size===1?[...encontrados][0]:null;
 };
 for(const pg of paginas){
  const lineas=afectadas.filter(l=>(l.pagina??pg.numero)===pg.numero);
  const pag=(principal._pags||[]).find(p=>p.numero===pg.numero);
  if(!lineas.length||!pag)continue;
  const tabla=(principal.tablas||[]).find(t=>t.pagina===pg.numero);
  const conCantidad=pag.lineas.filter(l=>l.celdas.some(c=>X.campoDe(c.texto)?.campo==="cantidad"));
  const cab=conCantidad.sort((a,b)=>Math.abs(a.y-(tabla?.y_cabecera??a.y))-Math.abs(b.y-(tabla?.y_cabecera??b.y)))[0];
  if(!cab)continue;
  const cant=cab.celdas.find(c=>X.campoDe(c.texto)?.campo==="cantidad");
  // Las mismas celdas que la cabecera dedujo: títulos no reconocidos a la izquierda de CANTIDAD.
  const izquierda=cab.celdas.filter(c=>c.x1<=cant.x0&&!X.campoDe(c.texto)&&N.canon(c.texto).length>2).sort((a,b)=>a.x0-b.x0);
  if(izquierda.length!==1&&izquierda.length!==2)continue;
  const esperados=izquierda.length===2?["referencia","descripcion"]:["descripcion"];
  const evidencias=[];let confirmado=true;
  const k=pg.dpi/72;
  for(const [i,c] of izquierda.entries()){
   // Recorte algo más amplio que el de la relectura de casillas: la altura del título leída por el OCR se queda corta.
   const h=c.alto||cab.alto,lecturas=[];
   const rx0=Math.max(0,Math.floor((c.x0-h)*k)),rx1=Math.min(pg.anchoPx,Math.ceil((c.x1+h)*k));
   const ry0=Math.max(0,Math.floor((c.y-1.8*h)*k)),ry1=Math.min(pg.altoPx,Math.ceil((c.y+0.6*h)*k));
   if(rx1-rx0<8||ry1-ry0<8){confirmado=false;break;}
   for(const e of ESTRATEGIAS){
    const ws=await pg.ocr({...e,region:[rx0,ry0,rx1-rx0,ry1-ry0]});
    if(ws.length)lecturas.push({texto:ws.map(w=>w.texto).join(" ")});
   }
   const campos=lecturas.map(r=>({campo:tituloDe(r.texto),texto:r.texto})).filter(x=>x.campo);
   const buenos=campos.filter(x=>x.campo===esperados[i]),otros=campos.filter(x=>x.campo!==esperados[i]);
   if(buenos.length<2||otros.length){confirmado=false;break;}
   evidencias.push("«"+c.texto+"» releído como «"+buenos[0].texto+"» ("+buenos.length+" relecturas)");
  }
  if(!confirmado)continue;
  for(const l of lineas){
   for(const k of ["referencia","descripcion"]){
    const f=l[k];
    if(!f||!(f.motivos||[]).includes(MOT_CAMPO))continue;
    const motivos=f.motivos.filter(m=>m!==MOT_CAMPO);
    l[k]={...f,motivos,estado:motivos.length?f.estado:"OK",notas:[...(f.notas||[]),"Título de la columna confirmado por relectura: "+evidencias.join("; ")]};
   }
   l.motivos=(l.motivos||[]).filter(m=>m!==MOTIVO&&!m.endsWith(MOT_CAMPO));
   l.estado=l.motivos.length?"REVISAR":"OK";
  }
  hechos.push("títulos de columna confirmados por relectura (página "+pg.numero+")");
 }
 return hechos;
}

async function segundaFase(principal,paginas,lecturas,opciones){
 const ctx=principal._ctx||{},perfil=ctx.perfil;
 const pag=paginas.find(p=>p.numero===(principal.tablas?.[0]?.pagina??paginas[0].numero))||paginas[0];
 const opcionesFecha={hoy:opciones.hoy,orden:perfil?.orden_fecha||"DMY"};
 const N=M("normalizar");
 const resueltos=[];
 // Cabecera: número y fecha. Cajas: las de todas las lecturas que vieron algo en ese campo.
 const pendientesCabecera=[];
 for(const campo of ["numero","fecha"]){
  const actual=principal[campo];
  if(actual?.estado==="OK"&&(actual.confianza??0)>=0.9)continue;
  const conCaja=[actual,...lecturas.map(r=>r[campo])].filter(c=>c?.caja&&c.literal).map(c=>c.caja);
  // Número con formato de proveedor conocido: también las celdas que CONTIENEN ese formato
  // («600.1237»: un trazo de firma añadido), aunque su etiqueta no se haya leído.
  if(campo==="numero"&&perfil?.formato_numero){
   const re=new RegExp(perfil.formato_numero.replace(/^\^/,"").replace(/\$$/,""));
   for(const r of lecturas)for(const pg of r._pags||[])for(const l of pg.lineas)for(const c of l.celdas)
    if(re.test(c.texto)&&N.fecha(c.texto).estado!=="OK")conCaja.push([c.x0,c.y,c.x1,c.alto]);
  }
  const cajas=[...new Map(conCaja.map(c=>[c.map(v=>Math.round(v/4)).join(","),c])).values()].slice(0,4);
  if(!cajas.length)continue;
  const r=await resolverCampo(pag,campo,cajas,{perfil,opcionesFecha,validacionEstructural:campo==="fecha"||!!perfil?.formato_numero});
  const valida=v=>v!=null&&v!=="";
  if(!r||r.conflicto){
   if(r?.conflicto)actual.motivos=[...(actual.motivos||[]),"Relecturas con valores distintos: "+r.conflicto.join(" | ")];
   const cand=[actual?.estado==="OK"?actual.valor:null,...(r?.conflicto||[])].filter(valida);
   if(cand.length)pendientesCabecera.push({campo,candidatos:cand,caja:actual?.caja||cajas[0]});
   continue;
  }
  if(actual?.estado==="OK"&&N.canon(actual.valor)!==N.canon(r.valor)){
   actual.motivos=[...(actual.motivos||[]),"La relectura dirigida da «"+r.valor+"»"];
   pendientesCabecera.push({campo,candidatos:[actual.valor,r.valor],caja:actual.caja||cajas[0]});
   continue;
  }
  const valor=campo==="fecha"?r.valor:r.valor.replace(/\s*\/\s*/g,"/");
  principal[campo]={...(actual||{}),literal:r.textos[0],valor,estado:"OK",caja:r.caja,motivos:[],
   notas:[...((actual?.notas)||[]),"Resuelto en la segunda fase por relectura dirigida de la casilla"],
   resolucion:{metodo:"relectura_dirigida",confianza:0.95,estrategias:r.estrategias,conf_ocr_min:r.conf,
    evidencias:["Mismo valor en "+r.estrategias.length+" relecturas independientes de la casilla",
     campo==="numero"&&perfil?.formato_numero?"Cumple el formato de número del proveedor ("+perfil.formato_numero+")":campo==="fecha"?"Fecha válida":"Valor con forma de número de albarán"]}};
  resueltos.push(campo);
 }
 // Línea que no cuadra con el descuento vacío, y otras líneas con descuento leído: el OCR pudo
 // perder el descuento impreso (fallo real 2026-10-23: descuento no leído; cantidad, precio e importe
 // quedaban en revisión). Se relee la casilla (columna de los descuentos leídos en la misma página,
 // fila de la línea) y solo se acepta si con ese descuento la línea cuadra:
 // cantidad × precio × (1 − dto) = importe.
 for(const l of principal.lineas){
  if(l.cuadre?.estado!=="DESCUADRE"||l.descuento?.estado!=="VACIO")continue;
  const pg=paginas.find(p=>p.numero===l.pagina);
  const cajasDto=principal.lineas.filter(o=>o.pagina===l.pagina&&o.descuento?.caja).map(o=>o.descuento.caja);
  const fila=[l.importe,l.precio,l.cantidad].map(c=>c?.caja).find(Boolean);
  if(!pg||!cajasDto.length||!fila)continue;
  const caja=[Math.min(...cajasDto.map(c=>c[0])),fila[1],Math.max(...cajasDto.map(c=>c[2])),fila[3]];
  const r=await resolverCampo(pg,"descuento",[caja],{perfil,opcionesFecha,opcionesNumero:ctx.opcionesNumero});
  if(!r||r.conflicto)continue;
  const dto=N.descuento(r.valor,ctx.opcionesNumero||{});
  const comoOK=c=>({...c,estado:"OK"});
  const prueba={...l,cantidad:comoOK(l.cantidad),precio:comoOK(l.precio),importe:comoOK(l.importe),descuento:{...dto,estado:"OK"}};
  const c=M("extraer").cuadre(prueba,ctx.precioPor||perfil?.precio_por||1);
  if(c.estado!=="VERIFICADO")continue;
  const sinDescuadre=x=>({...x,estado:"VERIFICADO",motivos:(x.motivos||[]).filter(m=>m!=="El cuadre de la línea no se cumple")});
  for(const k of ["cantidad","precio","importe"])l[k]=sinDescuadre(l[k]);
  l.descuento={...l.descuento,...dto,estado:"VERIFICADO",caja,motivos:[],
   resolucion:{metodo:"relectura_dirigida_cuadre",confianza:0.97,estrategias:r.estrategias,
    evidencias:["Relectura de la casilla del descuento: «"+r.textos[0]+"» ("+r.estrategias.length+" relecturas)","Con ese descuento la línea cuadra: "+c.detalle]}};
  l.cuadre=c;l.motivos=(l.motivos||[]).filter(m=>!/^Descuadre:/.test(m));
  resueltos.push("linea "+l.fila+" descuento (cuadre)");
 }
 resueltos.push(...await cifrasPorCasillas(principal,paginas,ctx,perfil));
 resueltos.push(...await titulosPorRelectura(principal,paginas));
 // Código o descripción aceptados solo por la confianza del OCR que otra lectura de la página, también fiable, lee distinto
 // en la misma fila: dos interpretaciones plausibles, no se acepta ninguna (foto real 2026-11-24: la descripción de una tasa
 // con 92 en psm 4 y 6, sin su última letra, y entera con 91 en psm 4 Sauvola; se aceptaba la incompleta).
 for(const l of principal.lineas){
  for(const campo of ["referencia","descripcion"]){
   const c=l[campo];
   if(!c||c.estado!=="OK"||c.resolucion||(c.confianza??0)<0.9||!c.caja)continue;
   const otras=lecturasFiablesDistintas(l,c,lecturas,N,principal);
   if(!otras.length)continue;
   const m="Lecturas OCR fiables distintas: "+[c.literal,...otras].join(" | ");
   l[campo]={...c,estado:"REVISAR",confianza:0.5,motivos:[...(c.motivos||[]),m]};
   l.motivos=[...(l.motivos||[]),(campo==="referencia"?"Código: ":"Descripción: ")+m];
   l.estado="REVISAR";
  }
 }
 // Líneas: código y descripción leídos con poca confianza (no hay cuadre que los confirme).
 const pendientes=[];
 for(const l of principal.lineas){
  // Código con texto pegado («1300000001 “ Montañte»): no se sabe dónde empieza la descripción.
  // Relectura y visión solo confirman los caracteres DENTRO de la casilla, no sus límites: una
  // descripción recortada («Pladur M48/35…» sin «Montante») se confirmaría. Queda en revisión.
  const frontera=/\s/.test(String(l.referencia?.literal||"").trim());
  // La relectura y el recorte, en la página de la línea (fallo real 2026-10-23: en un albarán de dos
  // páginas, la línea de la segunda se releyó en la primera y tomó el texto de la línea de al lado).
  const pg=paginas.find(p=>p.numero===l.pagina)||pag;
  for(const campo of ["referencia","descripcion"]){
   const c=l[campo];
   if(!c||c.estado!=="OK"||(c.confianza??1)>=0.9||!c.caja)continue;
   if(frontera){
    const m="Frontera entre código y descripción dudosa (el código lleva texto: «"+l.referencia.literal+"»): no se confirma por relectura ni visión";
    if(!(c.motivos||[]).includes(m))l[campo]={...c,motivos:[...(c.motivos||[]),m]};
    continue;
   }
   const r=await resolverCampo(pg,campo,[c.caja],{perfil,opcionesFecha,literal:c.literal});
   // EAN con su dígito de control (eanValido) cuando las relecturas NO lo resuelven (no hay unanimidad o se contradicen): si
   // ninguna otra lectura también cumple el dígito de control, la lectura es la buena. Si la relectura lo resuelve, como siempre.
   if(campo==="referencia"&&(!r||r.conflicto)&&eanValido(c.valor)){
    const otros=[...(r?.conflicto||[]),...(c.alternativas_ocr||[])].map(x=>String(x??"").trim()).filter(x=>x&&x!==String(c.valor).trim()&&eanValido(x));
    if(!otros.length){
     const p=pendientes.findIndex(x=>x.l===l&&x.campo===campo);if(p>=0)pendientes.splice(p,1);
     l[campo]={...c,motivos:(c.motivos||[]).filter(t=>!/^Relecturas fiables distintas|confunde/.test(t)),
      notas:[...(c.notas||[]),"Código de barras EAN con su dígito de control correcto"],
      resolucion:{metodo:"ean_digito_control",confianza:0.93,lectura_inicial:c.literal,
       evidencias:["Código de barras EAN-"+String(c.valor).length+" con su dígito de control correcto",
        ...(r?.conflicto?.length?["Ninguna de las relecturas distintas («"+r.conflicto.join(" | ")+"») cumple el dígito de control"]:[])]}};
     resueltos.push("linea "+l.fila+" "+campo+" (EAN)");
     continue;
    }
   }
   // Sin resolver: candidato a la comprobación por un segundo motor (visión del recorte).
   if(!r||r.conflicto)pendientes.push({l,campo,pg,candidatos:[c.valor??c.literal,...(r?.conflicto||[]),...(campo==="referencia"?c.alternativas_ocr||[]:[])].filter(Boolean)});
   // Código con S/5, Z/2, B/8 o G/6 (sin O/0 ni I/1/l): las relecturas del OCR confunden igual esos
   // pares; aunque concuerden, solo la visión (otro motor) puede confirmarlo.
   else if(campo==="referencia"&&/[A-Z]/i.test(r.valor)&&/\d/.test(r.valor)&&/[S5B8Z2G6]/.test(r.valor)&&!/[O0I1l]/.test(r.valor))
    pendientes.push({l,campo,pg,candidatos:[r.valor,c.valor??c.literal,...(c.alternativas_ocr||[])].filter(Boolean)});
   if(!r)continue;
   if(r.conflicto){l[campo]={...c,motivos:[...(c.motivos||[]),"Relecturas fiables distintas: "+r.conflicto.join(" | ")]};continue;}
   // Una referencia no cambia de número de palabras (la relectura no debe arrastrar la celda vecina).
   if(campo==="referencia"&&r.valor.split(/\s+/).length!==String(c.literal).split(/\s+/).length)continue;
   // Una descripción releída no gana cifras de importe ni «NETO» (prueba real 2026-10-28: la relectura
   // arrastró cantidad, precio y «NETO» de las columnas de cantidad, precio y descuento).
   if(campo==="descripcion"){
    const antes=new Set(String(c.literal).split(/\s+/));
    const nuevas=r.valor.split(/\s+/).filter(t=>!antes.has(t));
    if(nuevas.some(t=>/^\d{1,3}(\.\d{3})*,\d{2,4}$|^NETO$/i.test(t))){
     const m="La relectura de la descripción arrastra cifras de otras columnas («"+r.valor+"»): no se confirma";
     l[campo]={...c,estado:"REVISAR",motivos:[...(c.motivos||[]),m]};l.motivos=[...(l.motivos||[]),m];l.estado="REVISAR";continue;
    }
   }
   const corregido=N.canon(r.valor)!==N.canon(c.literal);
   l[campo]={...c,literal:r.valor,valor:r.valor,
    notas:[...(c.notas||[]),...(corregido?["Corregido por relectura dirigida (lectura inicial «"+c.literal+"»)"]:[])],
    resolucion:{metodo:"relectura_dirigida",confianza:0.93,estrategias:r.estrategias,conf_ocr_min:r.conf,lectura_inicial:c.literal,
     evidencias:[r.conf>=80?"Mismo texto en "+r.estrategias.length+" relecturas fiables (confianza ≥ 80) de la celda":
       "Unanimidad de las "+r.estrategias.length+" relecturas de la celda y formato de referencia del proveedor ("+perfil?.formato_referencia+")",
      ...(r.descartadas.length?["Relecturas de baja confianza ignoradas: "+r.descartadas.join(", ")]:[])]}};
   resueltos.push("linea "+l.fila+" "+campo+(corregido?" (corregido)":""));
  }
 }
 // Segundo motor independiente (visión del RECORTE de la celda, nunca la página): se acepta un
 // texto solo si coincide exactamente con alguna lectura OCR de esa celda. Nunca cifras
 // económicas; nunca una variante O/0, S/5… que el OCR no haya visto.
 // Número y fecha en conflicto (p. ej. «3504» / «3904»): la visión del recorte decide solo entre
 // los candidatos del OCR y su lectura debe cumplir el formato del proveedor o ser una fecha válida.
 for(const x of pendientesCabecera)pendientes.push({...x,cabecera:true,l:{[x.campo]:{caja:x.caja},fila:"cabecera"}});
 if(typeof opciones.vision==="function"&&pendientes.length&&pendientes.every(x=>typeof (x.pg||pag).recortePng==="function")){
  const recortes=pendientes.map(x=>{
   const pp=x.pg||pag,k=pp.dpi/72,[x0,y,x1,alto]=x.l[x.campo].caja;
   const rx0=Math.max(0,Math.floor((x0-0.6*alto)*k)),rx1=Math.min(pp.anchoPx,Math.ceil((x1+0.6*alto)*k));
   const ry0=Math.max(0,Math.floor((y-1.3*alto)*k)),ry1=Math.min(pp.altoPx,Math.ceil((y+0.45*alto)*k));
   return pp.recortePng([rx0,ry0,rx1-rx0,ry1-ry0]);
  });
  const lecturas=[];
  try{for(let i=0;i<recortes.length;i+=8)for(const v of await opciones.vision(recortes.slice(i,i+8),{modo:"impreso"})||[])
   if(Number.isInteger(v.indice))lecturas[i+v.indice]=String(v.texto||"");}
  catch(e){principal.incidencias=[...(principal.incidencias||[]),"Visión de campos dudosos no disponible: "+String(e?.message||e).slice(0,100)];}
  // Registro de cada casilla consultada (candidatos OCR y texto de la visión): permite reproducir y
  // medir las reglas de aceptación sin volver a leer el PDF.
  principal.vision_celdas=pendientes.map((x,i)=>({fila:x.cabecera?"cabecera":x.l.fila,campo:x.campo,candidatos:[...new Set(x.candidatos)],vision:lecturas[i]??null}));
  pendientes.forEach((x,i)=>{
   let v=lecturas[i];if(v==null)return;
   const m=coincidenciaVision(x.campo,x.candidatos,v,{perfil,opcionesFecha});
   if(!m)return;
   if(x.cabecera){
    // Valor de la visión normalizado y validado igual que el OCR; debe ser uno de los candidatos.
    const actual=principal[x.campo]||{};
    principal[x.campo]={...actual,valor:x.campo==="fecha"?m.candidato:String(m.candidato).replace(/\s*\/\s*/g,"/"),literal:actual.literal||v,estado:"OK",
     motivos:[],caja:x.caja,resolucion:{metodo:"vision_coincide_ocr",confianza:0.95,
      evidencias:["Visión del recorte de la casilla: «"+v+"»","Coincide con una lectura OCR: «"+m.candidato+"»",
       "Lecturas OCR en conflicto: "+[...new Set(x.candidatos)].join(" | "),
       x.campo==="fecha"?"Fecha válida":perfil?.formato_numero?"Cumple el formato de número del proveedor ("+perfil.formato_numero+")":"Valor con forma de número de albarán"]}};
    resueltos.push(x.campo+" (visión = OCR)");
    return;
   }
   const c=x.l[x.campo];
   x.l[x.campo]={...c,literal:m.valor,valor:m.valor,motivos:(c.motivos||[]).filter(t=>!/^Relecturas fiables distintas/.test(t)),
    resolucion:{metodo:"vision_coincide_ocr",confianza:0.95,lectura_inicial:c.literal,
     evidencias:["Visión del recorte de la celda: «"+v+"»",m.regla==="espacios"?"Mismas letras y cifras que una lectura OCR de la celda («"+m.candidato+"»), salvo espacios":
      "Coincide "+(m.regla==="exacta"?"exactamente ":"(sin puntuación) ")+"con una lectura OCR independiente de la misma celda",
      ...(x.candidatos.length>1?["Lecturas OCR consideradas: "+[...new Set(x.candidatos)].join(" | ")]:[])]}};
   resueltos.push("linea "+x.l.fila+" "+x.campo+" (visión = OCR)");
  });
 }
 return resueltos;
}

/*
 * paginas: [{numero, anchoPx, altoPx, dpi, ocr}] · opciones: las de extraerDePaginas.
 * Devuelve el resultado combinado con `lecturas_ocr` (resumen de cada lectura).
 */
/*
 * Orientación: páginas escaneadas giradas 90°, 180° o 270°. Si la lectura tal cual es pobre
 * (pocas palabras fiables), se prueban los otros giros y se elige el que da más palabras
 * fiables. Una página derecha no cuesta lecturas adicionales.
 */
const PALABRA_FIABLE=/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}|\d{2,}/;
const calidadOCR=palabras=>palabras.filter(w=>w.conf>=80&&PALABRA_FIABLE.test(w.texto)).length;
async function orientar(p){
 if(typeof p.rotada!=="function")return {pagina:p,grados:0};
 const q0=calidadOCR(await p.ocr({psm:4}));
 if(q0>=30)return {pagina:p,grados:0,calidad:q0};
 let mejor={pagina:p,grados:0,calidad:q0};
 for(const g of [90,270,180]){
  const pg=p.rotada(g),q=calidadOCR(await pg.ocr({psm:4}));
  if(q>mejor.calidad)mejor={pagina:pg,grados:g,calidad:q};
  if(q>=30&&q>=2*q0)break;
 }
 // Solo se gira con una mejora clara; si no, se lee tal cual (y el resultado irá a revisión).
 return mejor.grados&&mejor.calidad>=Math.max(15,2*q0)?mejor:{pagina:p,grados:0,calidad:q0};
}

async function extraerEscaneado(paginas,opciones={}){
 const {extraerDePaginas,finalizar}=M("extraer"),{paginaDesdePalabras}=M("ocr");
 const lecturas=[],resumen=[],orientacion=[];
 const orientadas=[];
 for(const p of paginas){const o=await orientar(p);orientadas.push(o.pagina);orientacion.push({pagina:p.numero,grados:o.grados});}
 paginas=orientadas;
 for(const conf of LECTURAS){
  const pags=[];
  for(const p of paginas)pags.push(paginaDesdePalabras(await p.ocr({psm:conf.psm,umbral:conf.umbral}),{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi}));
  const r=extraerDePaginas(pags,opciones);r._lectura="pagina_psm"+conf.psm+(conf.umbral?"_"+conf.umbral:"");
  Object.defineProperty(r,"_pags",{value:pags,enumerable:false});
  lecturas.push(r);
 }
 // CIF de DAFRICA reconocido en alguna lectura (junto a su nombre o en el bloque del cliente):
 // se descarta como emisor en todas las lecturas de este albarán.
 const propios=[...new Set(lecturas.map(r=>r.proveedor?.nif_propio_detectado).filter(n=>n&&/^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$/.test(n)))];
 if(propios.length){
  opciones={...opciones,nifsPropios:propios};
  lecturas.forEach((r,i)=>{
   if(!r._pags||!(r.proveedor?.candidatos||[]).some(n=>propios.includes(n)))return;
   const r2=M("extraer").extraerDePaginas(r._pags,opciones);r2._lectura=r._lectura;
   Object.defineProperty(r2,"_pags",{value:r._pags,enumerable:false});
   lecturas[i]=r2;
  });
 }
 // Cabecera de tabla ilegible en una lectura (banda gris) pero leída en otra: se trasladan
 // los títulos (posición incluida) a la lectura que no la tiene y se vuelve a extraer.
 const {leerTablaPagina}=M("extraer");
 // titulosDe(numeroPagina) → línea de títulos (o null); se insertan en las lecturas sin cabecera.
 // Una cabecera sacada de las posiciones del perfil del proveedor (sin títulos leídos) no impide probar los títulos leídos en
 // otra lectura (foto real 2026-11-23: el papel fotografiado no está en las posiciones de un escaneo; con el perfil, 6 filas y
 // ninguna cuadrada; con los títulos de otra lectura, 7 y 2 cuadradas). Quedan las dos lecturas y gana la mejor puntuada.
 const titulosLeidos=r=>r.tablas?.[0]?.y_cabecera!=null&&!r.tablas[0].cabecera_perfil;
 const trasladar=(titulosDe,etiqueta)=>{
  for(const r of [...lecturas]){
   if(titulosLeidos(r)||r._solo_cabecera||!r._pags)continue;
   const dePerfil=r.tablas?.[0]?.y_cabecera!=null;
   const pags=r._pags.map(pg=>{
    const titulos=titulosDe(pg.numero);
    if(!titulos)return pg;
    const lineas=[...pg.lineas.filter(l=>Math.abs(l.y-titulos.y)>0.8*titulos.alto),titulos].sort((a,b)=>a.y-b.y);
    return {...pg,lineas};
   });
   const r2=extraerDePaginas(pags,opciones);r2._lectura=r._lectura+"+cabecera_"+etiqueta;
   Object.defineProperty(r2,"_pags",{value:pags,enumerable:false});
   if(dePerfil?titulosLeidos(r2):r2.tablas?.[0]?.y_cabecera!=null)lecturas.push(r2);
  }
 };
 const conCabecera=lecturas.find(titulosLeidos);
 if(conCabecera)trasladar(n=>{
  const origen=conCabecera._pags.find(x=>x.numero===n),t=origen&&leerTablaPagina(origen);
  return t?origen.lineas[t.indiceCabecera]:null;
 },conCabecera._lectura);
 // Ninguna lectura ve los títulos: si están en blanco sobre una banda oscura, se leen invertidos.
 if(!lecturas.some(r=>r.tablas?.[0]?.y_cabecera!=null)){
  const titulos=new Map();
  for(const p of paginas){
   for(const [y0,y1] of (typeof p.bandasOscuras==="function"?await p.bandasOscuras():[]).slice(0,6)){
    const ry=Math.max(0,y0-8),rh=Math.min(p.altoPx-ry,y1-y0+16);
    const palabras=await p.ocr({psm:11,region:[0,ry,p.anchoPx,rh],tratamiento:"invertir"});
    const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,ry]});
    const t=leerTablaPagina(pag);
    if(t){titulos.set(p.numero,{...pag.lineas[t.indiceCabecera],invertida:true});break;}
   }
  }
  if(titulos.size)trasladar(n=>titulos.get(n)||null,"banda_oscura_invertida");
 }
 let principal=[...lecturas].sort((a,b)=>puntuar(b)-puntuar(a))[0];
 // Relectura de la banda de la tabla (la zona con más cifras) con la geometría de la principal.
 const geo=principal.tablas?.[0];
 if(geo&&geo.y_cabecera!=null){
  const p=paginas.find(x=>x.numero===geo.pagina);
  const k=p.dpi/72,margen=14;
  const y0=Math.max(0,Math.floor((geo.y_cabecera-margen)*k)),y1=Math.min(p.altoPx,Math.ceil((geo.y_fin+margen)*k));
  const region=[0,y0,p.anchoPx,y1-y0];
  const palabras=await p.ocr({psm:6,region});
  const banda=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
  const r=extraerDePaginas([banda],opciones);r._lectura="banda_tabla_psm6";
  lecturas.push(r);
  // pdf.js puede rasterizar una cifra pequeña de forma distinta a Poppler.
  // Si falta un descuento y la fila no cuadra, releer la tinta ampliada;
  // nunca deducir ni asignar el porcentaje a partir del importe.
  if(principal.lineas.some(l=>l.cuadre?.estado==="DESCUADRE"&&l.descuento?.estado==="VACIO")){
   const palabras2=await p.ocr({psm:6,region,escala:2});
   const ampliada=paginaDesdePalabras(palabras2,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
   const r2=extraerDePaginas([ampliada],opciones);r2._lectura="banda_tabla_psm6_x2";
   lecturas.push(r2);
  }
 }
 // Relecturas de cabecera (sobre la tabla) y pie (bajo la tabla): ahí están CIF, número y
 // fecha; leídos por zonas, el OCR no se mezcla con el resto de la página.
 if(geo&&geo.y_cabecera!=null){
  const p=paginas.find(x=>x.numero===geo.pagina),k=p.dpi/72;
  const zonas=[["cabecera",0,Math.ceil(geo.y_cabecera*k)],["pie",Math.floor(geo.y_fin*k),p.altoPx]];
  for(const [nombre,y0,y1] of zonas){
   if(y1-y0<40)continue;
   for(const [psm,umbral] of [[6,null],[11,null],[6,"sauvola"]]){
    const palabras=await p.ocr({psm,umbral,region:[0,y0,p.anchoPx,y1-y0]});
    const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[0,y0]});
    const r=extraerDePaginas([pag],opciones);r._lectura=nombre+"_psm"+psm+(umbral?"_"+umbral:"");r._solo_cabecera=true;
    Object.defineProperty(r,"_pags",{value:[pag],enumerable:false});
    lecturas.push(r);
   }
  }
 }
 // Pie en casillas con borde («BASE IMPONIBLE | % IVA | TOTAL» y las cifras debajo): el OCR de
 // página no ve las cifras encerradas. Si ninguna lectura cuadra los totales, se relee cada
 // casilla bajo su título y se extrae de nuevo con los títulos y las cifras releídas.
 if(geo&&geo.y_cabecera!=null&&!lecturas.some(r=>r.totales?.validacion?.estado==="OK")){
  const p=paginas.find(x=>x.numero===geo.pagina),k=p.dpi/72;
  const titulo=t=>/BASE|TOTAL|I\.?V\.?A|IMPORTE|SUMA/.test(String(t).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase());
  let fila=null;
  for(const r of lecturas)for(const pb of r._pags||[]){
   if(fila||pb.numero!==p.numero)continue;
   fila=pb.lineas.find(l=>l.y>=geo.y_fin-1&&l.celdas.filter(c=>titulo(c.texto)).length>=3&&!l.celdas.some(c=>/\d[.,]\d/.test(c.texto)))||null;
  }
  if(fila){
   const celdas=fila.celdas.filter(c=>!/^[|¦\[\]]+$/.test(c.texto));
   const palabras=celdas.map(c=>({texto:c.texto,x0:c.x0*k,x1:c.x1*k,y0:(fila.y-fila.alto)*k,y1:fila.y*k,conf:95}));
   const zonas=[];
   celdas.forEach((c,i)=>{
    if(!titulo(c.texto))return;
    // La casilla abarca el título y un 30 % del hueco con sus vecinos: sin llegar a las rayas
    // verticales que separan las casillas (con ellas dentro, el OCR de línea falla).
    const izq=i?c.x0-0.3*(c.x0-celdas[i-1].x1):c.x0-2*fila.alto,der=i<celdas.length-1?c.x1+0.3*(celdas[i+1].x0-c.x1):c.x1+3*fila.alto;
    zonas.push({izq,der});
   });
   const lecturasCasilla=[];
   for(const z of zonas){
    const x0=Math.max(0,Math.floor(z.izq*k)),x1=Math.min(p.anchoPx,Math.ceil(z.der*k));
    const y0=Math.ceil((fila.y+0.4*fila.alto)*k),y1=Math.min(p.altoPx,Math.floor((fila.y+5.5*fila.alto)*k));
    if(x1-x0<10||y1-y0<10)continue;
    const ws=(await p.ocr({psm:7,region:[x0,y0,x1-x0,y1-y0]})).filter(w=>/\d/.test(w.texto));
    lecturasCasilla.push(...ws.map(w=>({...w,x0:w.x0+x0,x1:w.x1+x0,y0:w.y0+y0,y1:w.y1+y0})));
   }
   if(lecturasCasilla.length){
    const pag=paginaDesdePalabras([...palabras,...lecturasCasilla],{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi});
    const r=extraerDePaginas([pag],opciones);r._lectura="casillas_pie_psm7";r._solo_cabecera=true;
    for(const otro of ["fecha","numero","proveedor"])r[otro]=null;
    Object.defineProperty(r,"_pags",{value:[pag],enumerable:false});
    lecturas.push(r);
   }
  }
 }
 // Casillas de fecha y número que ninguna lectura resolvió (una firma o un sello las cruza):
 // se recorta solo la casilla, junto a su etiqueta, y se vuelve a leer.
 for(const campo of ["fecha","numero"]){
  // Se relee también si las lecturas dan valores válidos distintos.
  const validos=new Set(lecturas.filter(r=>r[campo]?.estado==="OK").map(r=>M("normalizar").canon(r[campo].valor)));
  if(validos.size===1)continue;
  const {celdasEtiqueta}=M("extraer");
  // La etiqueta se busca en todas las lecturas de página (una sola puede no verla).
  const etiquetas=[],vistas=new Set();
  for(const r of lecturas)for(const pb of r._pags||[]){
   for(const et of celdasEtiqueta(pb,campo)){
    const clave=pb.numero+":"+Math.round(et.x0/20)+":"+Math.round(et.y/20);
    if(!vistas.has(clave)){vistas.add(clave);etiquetas.push([pb,et]);}
   }
  }
  for(const [pb,et] of etiquetas.slice(0,3)){
   const p=paginas.find(x=>x.numero===pb.numero),k=p.dpi/72;
   {
    // Dos anchos de recorte: el estrecho deja fuera los trazos que invaden la casilla vecina.
    const a=Math.max(et.alto,6),ancho=et.x1-et.x0;
    for(const factor of [4,6]){
     const x0=Math.max(0,Math.floor((et.x0-3*a)*k)),x1=Math.min(p.anchoPx,Math.ceil((et.x1+factor*Math.max(ancho,2*a))*k));
     const y0=Math.max(0,Math.floor((et.y-2*a)*k)),y1=Math.min(p.altoPx,Math.ceil((et.y+3*a)*k));
     if(x1-x0<20||y1-y0<20)continue;
     const palabras=await p.ocr({psm:6,region:[x0,y0,x1-x0,y1-y0]});
     const pag=paginaDesdePalabras(palabras,{numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi,desplazamiento:[x0,y0]});
     const r=extraerDePaginas([pag],opciones);r._lectura="casilla_"+campo+"_x"+factor;r._solo_cabecera=true;
     // De esta lectura solo cuenta el campo releído.
     for(const otro of ["fecha","numero","proveedor"])if(otro!==campo)r[otro]=null;
     lecturas.push(r);
    }
   }
  }
 }
 // Tabla sin cifras: con líneas y sin cantidades ni importes, el OCR de la página entera ha perdido el lado derecho (fallo real
 // 2026-10-30: marca de agua y rayas verticales; recortado, se lee bien). Se relee ese lado y se junta con el izquierdo.
 const sinCifras=l=>l.cantidad?.valor==null&&l.importe?.valor==null;
 if(principal.lineas.length&&2*principal.lineas.filter(sinCifras).length>=principal.lineas.length){
  const pags=[];
  for(const p of paginas){
   const g=principal.tablas?.find(x=>x.pagina===p.numero&&x.y_cabecera!=null),k=p.dpi/72,datos={numero:p.numero,anchoPx:p.anchoPx,altoPx:p.altoPx,dpi:p.dpi};
   const base=await p.ocr({psm:LECTURAS[0].psm});
   if(!g){pags.push(paginaDesdePalabras(base,datos));continue;}
   // Por debajo de los títulos: esa fila se queda como la leyó la página entera.
   const x0=Math.floor(p.anchoPx*0.47),y0=Math.max(0,Math.floor((g.y_cabecera+12)*k)),y1=Math.min(p.altoPx,Math.ceil((g.y_fin+14)*k));
   const derecha=(await p.ocr({psm:6,region:[x0,y0,p.anchoPx-x0,y1-y0]})).map(w=>({...w,x0:w.x0+x0,x1:w.x1+x0,y0:w.y0+y0,y1:w.y1+y0}));
   pags.push(paginaDesdePalabras([...base.filter(w=>(w.x0+w.x1)/2<x0||w.y1<y0||w.y0>y1),...derecha],datos));
  }
  // El proveedor puede venir de otra lectura (su CIF, en vertical, solo sale en alguna).
  const r=extraerDePaginas(pags,{...opciones,proveedorId:lecturas.map(x=>x.proveedor?.id).find(Boolean)});r._lectura="tabla_lado_derecho";
  Object.defineProperty(r,"_pags",{value:pags,enumerable:false});
  lecturas.push(r);
  const conCifras=x=>x.lineas.filter(l=>!sinCifras(l)).length;
  if(conCifras(r)>conCifras(principal))principal=r;
 }
 for(const r of lecturas)resumen.push({lectura:r._lectura,puntuacion:puntuar(r),lineas:r.lineas.length,
  proveedor:r.proveedor?.nif||null,numero:r.numero?.valor||null,fecha:r.fecha?.valor||null,
  lineas_cuadran:r.lineas.filter(l=>l.cuadre?.estado==="VERIFICADO").length,totales:r.totales?.validacion?.estado||null});
 combinarCabecera(principal,lecturas.filter(r=>!r._lectura.startsWith("banda")));
 combinarLineas(principal,lecturas.filter(r=>!r._solo_cabecera));
 combinarTotales(principal,lecturas);
 // Recuento de líneas: la banda de la tabla es la lectura más fiable de las filas.
 const banda=lecturas.find(r=>r._lectura.startsWith("banda"));
 principal.validaciones_extra=[];
 if(banda&&banda.lineas.length&&banda.lineas.length!==principal.lineas.length)
  principal.validaciones_extra.push({nombre:"recuento_lecturas",estado:"FALLO",
   detalle:"La lectura principal tiene "+principal.lineas.length+" líneas y la relectura de la tabla "+banda.lineas.length});
 finalizar(principal);
 // Segunda fase: relectura dirigida de los campos dudosos; después se recalculan estado y confianza.
 const resueltos=await segundaFase(principal,paginas,lecturas,opciones);
 if(resueltos.length){principal.validaciones_extra=principal.validaciones_extra||[];finalizar(principal);}
 principal.segunda_fase=resueltos;
 // Anotaciones manuscritas (códigos de obra y de STEL): solo con un motor de visión de recortes.
 if(opciones.vision){
  try{principal.manuscritos=await M("manuscritos").leerManuscritos(paginas,principal,opciones.vision,
   {catalogoObras:opciones.catalogoObras||null,catalogoObrasCompleto:opciones.catalogoObrasCompleto,albaranStel:opciones.albaranStel||null,compararModelos:opciones.compararModelos||null});
   M("manuscritos").aplicarEstado(principal);}
  catch(e){M("manuscritos").sinComprobar(principal,e);}
 }
 // Etiqueta de obra con QR pegada en el albarán (código exacto, impreso): con jsQR disponible.
 if(typeof opciones.qr==="function"){
  try{
   const h=M("etiquetas").detectar(paginas,opciones.qr);
   if(M("etiquetas").aplicar(principal,h)&&principal.manuscritos)M("manuscritos").aplicarEstado(principal);
  }catch(e){principal.incidencias=[...(principal.incidencias||[]),"No se han podido leer las etiquetas QR: "+String(e?.message||e).slice(0,120)];}
 }
 principal.orientacion=orientacion;
 const giradas=orientacion.filter(o=>o.grados);
 if(giradas.length)principal.incidencias.push("Página(s) escaneada(s) girada(s) y enderezada(s): "+giradas.map(o=>o.pagina+" ("+o.grados+"°)").join(", "));
 principal.lecturas_ocr=resumen;
 principal.lectura_principal=principal._lectura;
 return principal;
}

// Prelectura de cabecera para comprobar agrupaciones multipágina del separador.
// No acepta documentos ni sustituye las lecturas completas de extraerEscaneado.
async function leerCabeceras(paginas,opciones={}){
 const {extraerDePaginas}=M("extraer"),{paginaDesdePalabras}=M("ocr"),out=[];
 for(const p of paginas){
  const o=await orientar(p),pg=o.pagina;
  const pagina=paginaDesdePalabras(await pg.ocr({psm:4}),{numero:p.numero,anchoPx:pg.anchoPx,altoPx:pg.altoPx,dpi:pg.dpi});
  const r=extraerDePaginas([pagina],opciones);
  out.push({pagina:p.numero,numero:r.numero,fecha:r.fecha,proveedor:r.proveedor,
   titulo:pagina.lineas.some(l=>/ALBAR[AÁ]N/i.test(l.texto))});
 }
 return out;
}
return {eanValido,extraerEscaneado,leerCabeceras,coincidenciaVision,cifrasPorCasillas,combinarLineas,LECTURAS};
});
