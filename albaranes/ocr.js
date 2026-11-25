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
 const fragmentos=[],girados=[];
 // Signo corto de confianza ínfima DENTRO de una línea impresa (palabras fiables de su altura a los
 // dos lados): no es un trazo de bolígrafo, es texto impreso mal leído (fallo real 2026-10-23:
 // «Ø40» leído «M40» con confianza 24 se descartaba y la descripción, sin «Ø40», se aceptaba). Se
 // conserva: su baja confianza deja la casilla en revisión.
 const porLineaOcr=new Map();
 for(const p of palabras)if(p.linea!=null){if(!porLineaOcr.has(p.linea))porLineaOcr.set(p.linea,[]);porLineaOcr.get(p.linea).push(p);}
 const dentroDeTexto=p=>{
  const h=p.y1-p.y0,parecida=q=>Math.abs((q.y1-q.y0)-h)<=0.5*Math.max(h,q.y1-q.y0);
  const ws=(porLineaOcr.get(p.linea)||[]).filter(q=>q!==p&&q.conf>=60&&/\w{2,}/.test(String(q.texto||""))&&parecida(q));
  return ws.some(q=>q.x1<=p.x0+2&&p.x0-q.x1<3*h)&&ws.some(q=>q.x0>=p.x1-2&&q.x0-p.x1<3*h);
 };
 for(const p of palabras){
  // Rayas verticales de la tabla pegadas a la palabra («1301097020|»): no forman parte del texto.
  // Tampoco una cola de rayas largas («JERRAP25LN-—», la tinta de un subrayado); «1,00-» se conserva.
  const texto=String(p.texto||"").trim().replace(/^[|¦]+|[|¦]+$/g,"").replace(/[-—–]*[—–][-—–]*$/,"").trim();
  if(!texto)continue;
  if(BASURA.test(texto)){descartadas.push(texto);continue;}
  // Trazos de bolígrafo (círculos, subrayados) leídos como 1–3 caracteres de confianza ínfima.
  if(texto.length<=3&&Number.isFinite(p.conf)&&p.conf<30&&!/^\d+([.,]\d+)?%?$/.test(texto)&&!dentroDeTexto(p)){descartadas.push(texto);continue;}
  // Texto girado de los márgenes (avisos legales verticales): basura de baja confianza en el borde.
  // Los fragmentos cortos del texto girado salen con confianza media («25», «Ep:»): umbral mayor.
  // Fragmentos de 1–3 caracteres en el margen exterior: letras sueltas del texto vertical
  // (aviso legal), aunque el OCR les dé confianza alta; ningún dato de la tabla está ahí solo.
  if(anchoPx&&(p.x1<0.08*anchoPx||p.x0>0.97*anchoPx)&&(texto.length<=3||(Number.isFinite(p.conf)&&p.conf<75))){descartadas.push(texto);continue;}
  // Palabra girada (aviso legal vertical leído entero, «personaldatostratamiento.»): su caja es
  // estrecha y alta, imposible para texto horizontal (cada carácter mide al menos ~0,35 de alto),
  // aunque el OCR le dé confianza alta. No es un dato de la tabla: va aparte (`lineas_giradas`),
  // donde solo se busca el CIF del emisor (algunos lo imprimen únicamente en ese aviso).
  if(texto.length>=4&&(p.x1-p.x0)<0.15*(p.y1-p.y0)*texto.length){girados.push({...p,texto});continue;}
  const alto=(p.y1-p.y0)*k;
  if(alto<=0)continue;
  fragmentos.push({texto,crudo:null,x0:(p.x0+dx)*k,x1:(p.x1+dx)*k,y:(p.y1+dy)*k,alto,conf:Number.isFinite(p.conf)?p.conf:null});
 }
 const lineas=TEXTO().agruparLineas(fragmentos);
 // Texto girado: una línea por línea del OCR, en su orden de lectura.
 const porLinea=new Map();
 for(const p of girados){const id=p.linea??"g"+porLinea.size;if(!porLinea.has(id))porLinea.set(id,[]);porLinea.get(id).push(p);}
 const lineas_giradas=[...porLinea.values()].map(g=>({texto:g.map(p=>p.texto).join(" "),
  celdas:g.map(p=>({texto:p.texto,x0:(p.x0+dx)*k,x1:(p.x1+dx)*k,y:(p.y1+dy)*k,alto:(p.y1-p.y0)*k,conf:Number.isFinite(p.conf)?p.conf:null}))}));
 const confs=fragmentos.map(f=>f.conf).filter(c=>c!=null);
 return {
  numero,tipo:"OCR",ancho:anchoPagina??(anchoPx*k),alto:altoPagina??(altoPx*k),
  caracteres:fragmentos.reduce((n,f)=>n+f.texto.length,0),fraccion_imagen:1,
  conf_media:confs.length?Math.round(confs.reduce((a,b)=>a+b,0)/confs.length):null,
  lineas,lineas_giradas,inclinacion,avisos:[...(descartadas.length?[descartadas.length+" signos sueltos del OCR descartados"]:[]),
   ...(inclinacion?["Escaneo inclinado "+(Math.atan(inclinacion)*180/Math.PI).toFixed(2)+"°: posiciones enderezadas"]:[])]
 };
}

/*
 * Pendiente del escaneo (dy/dx) a partir de las líneas que el propio OCR agrupa:
 * mediana de las pendientes de las líneas largas de palabras fiables. 0 si es despreciable
 * o no hay datos (el motor no indica a qué línea pertenece cada palabra). Las posiciones se
 * enderezan así hasta 0,05 (2,9°); una hoja más torcida se endereza girando la imagen antes de
 * leerla (escaneado.js, pendienteDeLineas sin límite), porque los recortes que se vuelven a
 * leer salen de la imagen y con más inclinación quedarían desplazados.
 */
function estimarInclinacion(palabras,anchoPx){
 const m=pendienteDeLineas(palabras,anchoPx);
 return Math.abs(m)>=0.002&&Math.abs(m)<=0.05?m:0;
}
// La mediana de las pendientes de las líneas largas, sin límite (0 sin al menos 3 líneas).
function pendienteDeLineas(palabras,anchoPx){
 const grupos=new Map();
 for(const p of palabras||[]){
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
 return pendientes[Math.floor(pendientes.length/2)];
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

/*
 * Tabla con rayas (lectura sin rayas, 2026-11-24; factura real escaneada del 2026-11-23): lo que queda entre dos rayas horizontales
 * seguidas es UNA fila, aunque el OCR la lea en varios renglones (el texto en dos renglones y las cifras centradas entre ellos, que
 * salían como filas sueltas de descripción). Solo franjas del alto de una fila (de 1,2 a 5 alturas de letra) con 2 a 4 renglones; las
 * demás (una tabla sin rayas por dentro: todas sus filas entre las dos rayas del borde) se dejan como están. En la fila unida, las
 * casillas que se solapan en horizontal (la misma columna) juntan sus textos de arriba abajo. rayas: [{y, x0, x1}] en puntos.
 */
function unirFilasEntreRayas(pagina,rayas){
 const lineas=pagina?.lineas||[];
 if(!lineas.length||!Array.isArray(rayas)||rayas.length<2)return pagina;
 const altos=lineas.map(l=>l.alto).filter(a=>a>0).sort((a,b)=>a-b),alto=altos[Math.floor(altos.length/2)]||10;
 const ys=rayas.map(r=>r.y).sort((a,b)=>a-b),usadas=new Set(),unidas=[];
 for(let i=0;i+1<ys.length;i++){
  const a=ys[i],b=ys[i+1];
  if(b-a<1.2*alto||b-a>5*alto)continue;
  const dentro=lineas.filter(l=>!usadas.has(l)&&l.y-l.alto/2>a&&l.y-l.alto/2<b);
  if(dentro.length<2||dentro.length>4)continue;
  dentro.forEach(l=>usadas.add(l));
  unidas.push(unirLineas(dentro));
 }
 if(!unidas.length)return pagina;
 const todas=[...lineas.filter(l=>!usadas.has(l)),...unidas].sort((x,y)=>x.y-y.y).map((l,i)=>({...l,indice:i}));
 return {...pagina,lineas:todas,avisos:[...(pagina.avisos||[]),unidas.length+" filas de la tabla unidas por sus rayas (varios renglones cada una)"]};
}
function unirLineas(ls){
 const orden=[...ls].sort((a,b)=>a.y-b.y);
 // La altura de la fila: la del renglón con más cifras (el de las cantidades e importes), o el del medio.
 const cifras=l=>l.celdas.filter(c=>/\d/.test(c.texto)).length;
 const base=[...orden].sort((a,b)=>cifras(b)-cifras(a))[0]||orden[Math.floor(orden.length/2)];
 const grupos=[];
 for(const [j,l] of orden.entries())for(const c of l.celdas){
  const g=grupos.find(x=>c.x0<x.x1&&c.x1>x.x0);
  if(g){g.partes.push({c,j});g.x0=Math.min(g.x0,c.x0);g.x1=Math.max(g.x1,c.x1);}
  else grupos.push({x0:c.x0,x1:c.x1,partes:[{c,j}]});
 }
 const celdas=grupos.sort((a,b)=>a.x0-b.x0).map(g=>{
  const partes=g.partes.sort((a,b)=>a.j-b.j||a.c.x0-b.c.x0),una=partes.length===1?partes[0].c:null;
  if(una)return {...una,y:base.y};
  const confs=partes.map(p=>p.c.conf).filter(v=>v!=null);
  return {texto:partes.map(p=>p.c.texto).join(" "),x0:g.x0,x1:g.x1,y:base.y,alto:Math.max(...partes.map(p=>p.c.alto||0)),
   conf:confs.length?Math.min(...confs):null,unida:true};
 });
 return {y:base.y,alto:Math.max(...orden.map(l=>l.alto)),celdas,texto:celdas.map(c=>c.texto).join(" "),unida:orden.length};
}

return {paginaDesdePalabras,palabrasDesdeTsv,palabrasDesdeTesseractJs,estimarInclinacion,pendienteDeLineas,unirFilasEntreRayas};
});
