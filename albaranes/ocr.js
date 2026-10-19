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
 const fragmentos=[];
 for(const p of palabras){
  const texto=String(p.texto||"").trim();
  if(!texto)continue;
  if(BASURA.test(texto)){descartadas.push(texto);continue;}
  // Texto girado de los márgenes (avisos legales verticales): basura de baja confianza en el borde.
  if(anchoPx&&(p.x1<0.08*anchoPx||p.x0>0.97*anchoPx)&&Number.isFinite(p.conf)&&p.conf<75){descartadas.push(texto);continue;}
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
  lineas,avisos:descartadas.length?[descartadas.length+" signos sueltos del OCR descartados"]:[]
 };
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
  out.push({texto,x0:x,y0:y,x1:x+w,y1:y+h,conf:+c[i("conf")]});
 }
 return out;
}

return {paginaDesdePalabras,palabrasDesdeTsv};
});
