"use strict";
/*
 * DAFRICA · Páginas escaneadas: palabras de OCR (con posición y confianza) → la misma
 * estructura de líneas y celdas que produce texto-pdf.js para los PDF digitales.
 * Así un único extractor por coordenadas sirve para PDF digitales y escaneados.
 *
 * Independiente del motor: recibe palabras {texto, x0, y0, x1, y1 (píxeles), conf 0–100}.
 * En pruebas se usa Tesseract nativo; en la web, tesseract.js (mismo motor).
 */
(function(root,factory){
 const req=typeof require==="function"&&typeof module==="object"?require:null;
 const api=factory(root,req);
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.ocr=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(root,req){

const TEXTO=()=>req?req("./texto-pdf.js"):root.DafricaAlbaranes.textoPdf;
// Restos gráficos que el OCR lee como texto: separadores de tabla, rayas, marcas de perforación.
const BASURA=/^[|¦—–_\-'"`´‘’.,:;!¡¿?()\[\]{}<>«»=~*+#°º\\/]+$/;

/*
 * palabras: [{texto, x0, y0, x1, y1, conf}] en píxeles de una imagen de anchoPx × altoPx
 * renderizada a `dpi`. Se convierten a puntos PDF (72 por pulgada).
 * desplazamiento: origen del recorte, en píxeles, si la imagen es un recorte de la página.
 */
function paginaDesdePalabras(palabras,{numero=1,anchoPx,altoPx,dpi=300,desplazamiento=[0,0],anchoPagina=null,altoPagina=null}={}){
 const k=72/dpi,[dx,dy]=desplazamiento;
 const descartadas=[];
 const inclinacion=estimarInclinacion(palabras,anchoPx);
 if(inclinacion){
  // Escaneo torcido: se endereza la página girando las posiciones alrededor del centro.
  const cx=(anchoPx||0)/2;
  palabras=palabras.map(p=>{const d=inclinacion*((p.x0+p.x1)/2-cx);return {...p,y0:p.y0-d,y1:p.y1-d};});
 }
 const fragmentos=[];
 for(const p of palabras){
  const texto=String(p.texto||"").trim();
  if(!texto)continue;
  if(BASURA.test(texto)){descartadas.push(texto);continue;}
  // Texto girado de los márgenes (avisos legales verticales): basura de baja confianza en el borde.
  // Los fragmentos cortos del texto girado salen con confianza media («25», «Ep:»): umbral mayor.
  if(anchoPx&&(p.x1<0.08*anchoPx||p.x0>0.97*anchoPx)&&Number.isFinite(p.conf)&&p.conf<(texto.length<=3?92:75)){descartadas.push(texto);continue;}
  const alto=(p.y1-p.y0)*k;
  if(alto<=0)continue;
  fragmentos.push({texto,crudo:null,x0:(p.x0+dx)*k,x1:(p.x1+dx)*k,y:(p.y1+dy)*k,alto,conf:Number.isFinite(p.conf)?p.conf:null});
 }
 const lineas=TEXTO().agruparLineas(fragmentos);
 const confs=fragmentos.map(f=>f.conf).filter(c=>c!=null);
 return {
  numero,tipo:"OCR",ancho:anchoPagina??(anchoPx*k),alto:altoPagina??(altoPx*k),
  caracteres:fragmentos.reduce((n,f)=>n+f.texto.length,0),fraccion_imagen:1,
  conf_media:confs.length?Math.round(confs.reduce((a,b)=>a+b,0)/confs.length):null,
  lineas,inclinacion,avisos:[...(descartadas.length?[descartadas.length+" signos sueltos del OCR descartados"]:[]),
   ...(inclinacion?["Escaneo inclinado "+(Math.atan(inclinacion)*180/Math.PI).toFixed(2)+"°: posiciones enderezadas"]:[])]
 };
}

/*
 * Pendiente del escaneo (dy/dx) a partir de las líneas que el propio OCR agrupa:
 * mediana de las pendientes de las líneas largas de palabras fiables. 0 si es despreciable
 * o no hay datos (el motor no indica a qué línea pertenece cada palabra).
 */
function estimarInclinacion(palabras,anchoPx){
 const grupos=new Map();
 for(const p of palabras){
  if(p.linea==null||!(p.conf>=70)||!/\w{2,}/.test(String(p.texto||"")))continue;
  if(!grupos.has(p.linea))grupos.set(p.linea,[]);
  grupos.get(p.linea).push(p);
 }
 const pendientes=[];
 for(const g of grupos.values()){
  if(g.length<3)continue;
  const xs=g.map(p=>(p.x0+p.x1)/2),ys=g.map(p=>p.y1);
  const span=Math.max(...xs)-Math.min(...xs);
  if(anchoPx&&span<0.25*anchoPx)continue;
  const mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;
  let num=0,den=0;xs.forEach((x,i)=>{num+=(x-mx)*(ys[i]-my);den+=(x-mx)**2;});
  if(den>0)pendientes.push(num/den);
 }
 if(pendientes.length<3)return 0;
 pendientes.sort((a,b)=>a-b);
 const m=pendientes[Math.floor(pendientes.length/2)];
 return Math.abs(m)>=0.002&&Math.abs(m)<=0.05?m:0;
}

/* Tesseract TSV (nivel 5 = palabra) → palabras. */
function palabrasDesdeTsv(tsv){
 const filas=String(tsv).split(/\r?\n/);
 const cab=filas.shift()?.split("\t")||[];
 const i=n=>cab.indexOf(n);
 const out=[];
 for(const f of filas){
  const c=f.split("\t");
  if(c[i("level")]!=="5")continue;
  const texto=c[i("text")];
  if(!texto||!texto.trim())continue;
  const x=+c[i("left")],y=+c[i("top")],w=+c[i("width")],h=+c[i("height")];
  out.push({texto,x0:x,y0:y,x1:x+w,y1:y+h,conf:+c[i("conf")],linea:[c[i("block_num")],c[i("par_num")],c[i("line_num")]].join("_")});
 }
 return out;
}

/* tesseract.js (salida con {blocks:true}) → palabras; la línea del OCR sirve para el enderezado. */
function palabrasDesdeTesseractJs(data){
 const out=[];
 (data?.blocks||[]).forEach((b,bi)=>(b.paragraphs||[]).forEach((p,pi)=>(p.lines||[]).forEach((l,li)=>(l.words||[]).forEach(w=>{
  const texto=String(w.text||"").trim();
  if(!texto)return;
  out.push({texto,x0:w.bbox.x0,y0:w.bbox.y0,x1:w.bbox.x1,y1:w.bbox.y1,conf:Math.round(w.confidence*1e4)/1e4,linea:bi+"_"+pi+"_"+li});
 }))));
 return out;
}

return {paginaDesdePalabras,palabrasDesdeTsv,palabrasDesdeTesseractJs,estimarInclinacion};
});
