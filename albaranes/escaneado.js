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

const M=k=>req?req("./"+{extraer:"extraer.js",ocr:"ocr.js",normalizar:"normalizar.js",manuscritos:"manuscritos.js"}[k]):root.DafricaAlbaranes[k];
// La binarización adaptativa (Sauvola) rescata rótulos y cifras sobre fondos grises.
const LECTURAS=[{psm:4},{psm:6},{psm:3},{psm:4,umbral:"sauvola"}];

function puntuar(r){
 let s=0;
 if(r.proveedor?.estado==="OK")s+=3;
 if(r.numero?.estado==="OK")s+=2;
 if(r.fecha?.estado==="OK")s+=2;
 // Una fila repartida por posición estimada vale menos que la misma fila con celdas separadas.
 for(const l of r.lineas||[])s+=(l.cuadre?.estado==="VERIFICADO"?3:l.estado==="OK"?1:-1)-(l.columnas_estimadas?0.5:0);
 for(const v of r.validaciones||[])if(v.estado==="FALLO")s-=2;
 if(r.totales?.validacion?.estado==="OK")s+=2;
 return s;
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
    motivos:["Lecturas OCR válidas distintas: "+distintos.join(" | ")],lecturas:validos.length};
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
   const verificada=alternativas.find(o=>o.cuadre?.estado==="VERIFICADO"&&
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
const LISTAS={numero:"0123456789./-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",fecha:"0123456789/-.",referencia:null,descripcion:null};
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
 if(campo==="numero"){
  const re=perfil?.formato_numero?new RegExp(perfil.formato_numero):/^[A-Z0-9][A-Z0-9\/\-.]{2,24}$/i;
  const v=[...tokens,...tokens.slice(0,-1).map((t,i)=>t+" "+tokens[i+1])].filter(t=>re.test(t)&&/\d/.test(t)&&N.fecha(t).estado!=="OK");
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
 // Líneas: código y descripción leídos con poca confianza (no hay cuadre que los confirme).
 const pendientes=[];
 for(const l of principal.lineas){
  // Código con texto pegado («1300000001 “ Montañte»): no se sabe dónde empieza la descripción.
  // Relectura y visión solo confirman los caracteres DENTRO de la casilla, no sus límites: una
  // descripción recortada («Pladur M48/35…» sin «Montante») se confirmaría. Queda en revisión.
  const frontera=/\s/.test(String(l.referencia?.literal||"").trim());
  for(const campo of ["referencia","descripcion"]){
   const c=l[campo];
   if(!c||c.estado!=="OK"||(c.confianza??1)>=0.9||!c.caja)continue;
   if(frontera){
    const m="Frontera entre código y descripción dudosa (el código lleva texto: «"+l.referencia.literal+"»): no se confirma por relectura ni visión";
    if(!(c.motivos||[]).includes(m))l[campo]={...c,motivos:[...(c.motivos||[]),m]};
    continue;
   }
   const r=await resolverCampo(pag,campo,[c.caja],{perfil,opcionesFecha,literal:c.literal});
   // Sin resolver: candidato a la comprobación por un segundo motor (visión del recorte).
   if(!r||r.conflicto)pendientes.push({l,campo,candidatos:[c.valor??c.literal,...(r?.conflicto||[]),...(campo==="referencia"?c.alternativas_ocr||[]:[])].filter(Boolean)});
   if(!r)continue;
   if(r.conflicto){l[campo]={...c,motivos:[...(c.motivos||[]),"Relecturas fiables distintas: "+r.conflicto.join(" | ")]};continue;}
   // Una referencia no cambia de número de palabras (la relectura no debe arrastrar la celda vecina).
   if(campo==="referencia"&&r.valor.split(/\s+/).length!==String(c.literal).split(/\s+/).length)continue;
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
 if(typeof opciones.vision==="function"&&pendientes.length&&typeof pag.recortePng==="function"){
  const k=pag.dpi/72,recortes=pendientes.map(x=>{
   const [x0,y,x1,alto]=x.l[x.campo].caja;
   const rx0=Math.max(0,Math.floor((x0-0.6*alto)*k)),rx1=Math.min(pag.anchoPx,Math.ceil((x1+0.6*alto)*k));
   const ry0=Math.max(0,Math.floor((y-1.3*alto)*k)),ry1=Math.min(pag.altoPx,Math.ceil((y+0.45*alto)*k));
   return pag.recortePng([rx0,ry0,rx1-rx0,ry1-ry0]);
  });
  const lecturas=[];
  try{for(let i=0;i<recortes.length;i+=8)for(const v of await opciones.vision(recortes.slice(i,i+8),{modo:"impreso"})||[])
   if(Number.isInteger(v.indice))lecturas[i+v.indice]=String(v.texto||"");}
  catch(e){principal.incidencias=[...(principal.incidencias||[]),"Visión de campos dudosos no disponible: "+String(e?.message||e).slice(0,100)];}
  // Registro de cada casilla consultada (candidatos OCR y texto de la visión): permite reproducir y
  // medir las reglas de aceptación sin volver a leer el PDF.
  principal.vision_celdas=pendientes.map((x,i)=>({fila:x.cabecera?"cabecera":x.l.fila,campo:x.campo,candidatos:[...new Set(x.candidatos)],vision:lecturas[i]??null}));
  const igual=(campo,a,b)=>campo==="referencia"?N.canon(a)===N.canon(b)&&N.canon(a)!=="":
   String(a).replace(/\s+/g," ").trim()===String(b).replace(/\s+/g," ").trim()&&String(a).trim()!=="";
  pendientes.forEach((x,i)=>{
   let v=lecturas[i];if(v==null)return;
   if(x.cabecera){
    // Valor de la visión normalizado y validado igual que el OCR; debe ser uno de los candidatos.
    const cv=candidatoDe(x.campo,v,{perfil,opcionesFecha});
    const iguales=[...new Set(x.candidatos)].filter(c=>cv&&(x.campo==="fecha"?c===cv:N.canon(c)===N.canon(cv)));
    if(iguales.length!==1)return;
    const actual=principal[x.campo]||{};
    principal[x.campo]={...actual,valor:x.campo==="fecha"?iguales[0]:String(iguales[0]).replace(/\s*\/\s*/g,"/"),literal:actual.literal||v,estado:"OK",
     motivos:[],caja:x.caja,resolucion:{metodo:"vision_coincide_ocr",confianza:0.95,
      evidencias:["Visión del recorte de la casilla: «"+v+"»","Coincide con una lectura OCR: «"+iguales[0]+"»",
       "Lecturas OCR en conflicto: "+[...new Set(x.candidatos)].join(" | "),
       x.campo==="fecha"?"Fecha válida":perfil?.formato_numero?"Cumple el formato de número del proveedor ("+perfil.formato_numero+")":"Valor con forma de número de albarán"]}};
    resueltos.push(x.campo+" (visión = OCR)");
    return;
   }
   const coincide=[...new Set(x.candidatos)].filter(cand=>igual(x.campo,cand,v));
   if(coincide.length!==1)return;
   const c=x.l[x.campo];
   x.l[x.campo]={...c,literal:coincide[0],valor:coincide[0],motivos:(c.motivos||[]).filter(m=>!/^Relecturas fiables distintas/.test(m)),
    resolucion:{metodo:"vision_coincide_ocr",confianza:0.95,lectura_inicial:c.literal,
     evidencias:["Visión del recorte de la celda: «"+v+"»","Coincide exactamente con una lectura OCR independiente de la misma celda",
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
 const trasladar=(titulosDe,etiqueta)=>{
  for(const r of [...lecturas]){
   if(r.tablas?.[0]?.y_cabecera!=null||r._solo_cabecera||!r._pags)continue;
   const pags=r._pags.map(pg=>{
    const titulos=titulosDe(pg.numero);
    if(!titulos)return pg;
    const lineas=[...pg.lineas.filter(l=>Math.abs(l.y-titulos.y)>0.8*titulos.alto),titulos].sort((a,b)=>a.y-b.y);
    return {...pg,lineas};
   });
   const r2=extraerDePaginas(pags,opciones);r2._lectura=r._lectura+"+cabecera_"+etiqueta;
   Object.defineProperty(r2,"_pags",{value:pags,enumerable:false});
   if(r2.tablas?.[0]?.y_cabecera!=null)lecturas.push(r2);
  }
 };
 const conCabecera=lecturas.find(r=>r.tablas?.[0]?.y_cabecera!=null);
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
   {catalogoObras:opciones.catalogoObras||null,albaranStel:opciones.albaranStel||null});
   M("manuscritos").aplicarEstado(principal);}
  catch(e){principal.manuscritos=null;principal.incidencias=[...(principal.incidencias||[]),"No se han podido leer los manuscritos: "+String(e?.message||e).slice(0,120)];}
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
return {extraerEscaneado,leerCabeceras,LECTURAS};
});
