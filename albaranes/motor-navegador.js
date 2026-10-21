"use strict";
/*
 * DAFRICA · Motor OCR del navegador para albaranes escaneados.
 * pdf.js renderiza cada página a 300 ppp en un lienzo y tesseract.js (servido desde
 * vendor/tesseract, sin servicios externos) lee la página entera o un recorte.
 * Misma interfaz que pruebas/motor-tesseract.js, para albaranes/escaneado.js:
 *   paginas: [{numero, anchoPx, altoPx, dpi, ocr({psm, region, umbral}) → palabras}]
 * El PDF y las lecturas solo existen en memoria del navegador: no se envían ni se guardan.
 */
(function(root){
const DPI=300;
const BASE=(()=>{try{return new URL("vendor/tesseract/",document.baseURI).href;}catch(e){return "vendor/tesseract/";}})();
let trabajador=null;

async function worker(){
 if(!trabajador){
  if(!root.Tesseract)throw Error("No se ha cargado el motor OCR (vendor/tesseract)");
  trabajador=root.Tesseract.createWorker("spa",1,{
   workerPath:BASE+"worker.min.js",corePath:BASE+"core",langPath:BASE+"lang",
   gzip:true,workerBlobURL:false
  }).catch(e=>{trabajador=null;throw e;});
 }
 return trabajador;
}
async function cerrar(){
 if(trabajador){const w=await trabajador.catch(()=>null);trabajador=null;if(w)await w.terminate();}
}

// Cola: tesseract.js tiene un solo trabajador y los parámetros (psm, umbral) son globales.
let cola=Promise.resolve();
function enCola(tarea){const r=cola.then(tarea,tarea);cola=r.catch(()=>{});return r;}

async function renderizar(pdf,numero){
 const pagina=await pdf.getPage(numero);
 const vista=pagina.getViewport({scale:DPI/72});
 const lienzo=document.createElement("canvas");
 lienzo.width=Math.ceil(vista.width);lienzo.height=Math.ceil(vista.height);
 const ctx=lienzo.getContext("2d",{alpha:false,willReadFrequently:true});
 ctx.fillStyle="#fff";ctx.fillRect(0,0,lienzo.width,lienzo.height);
 await pagina.render({canvasContext:ctx,viewport:vista}).promise;
 pagina.cleanup();
 return lienzo;
}
// Lienzo girado «grados» en sentido horario (90, 180, 270).
function girar(lienzo,grados){
 const c=document.createElement("canvas"),lado=grados%180!==0;
 c.width=lado?lienzo.height:lienzo.width;c.height=lado?lienzo.width:lienzo.height;
 const x=c.getContext("2d",{alpha:false});
 x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);
 x.translate(c.width/2,c.height/2);x.rotate(grados*Math.PI/180);
 x.drawImage(lienzo,-lienzo.width/2,-lienzo.height/2);
 return c;
}
// Banda oscura con texto claro (títulos de tabla): contraste, inversión, binarizado, borrado de
// las rayas de la tabla y margen blanco. Misma receta que pruebas/motor-comun.js.
const MARGEN_INVERTIDA=30;
function invertirBanda(lienzo){
 const w=lienzo.width,h=lienzo.height,ctx=lienzo.getContext("2d",{willReadFrequently:true});
 const d=ctx.getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
 for(let i=0;i<w*h;i++)g[i]=Math.round(0.299*d[4*i]+0.587*d[4*i+1]+0.114*d[4*i+2]);
 const orden=Array.from(g).sort((a,b)=>a-b),lo=orden[Math.floor(0.02*g.length)],hi=orden[Math.floor(0.98*g.length)]||255;
 const b=new Uint8Array(w*h);
 for(let i=0;i<w*h;i++){const v=hi>lo?(g[i]-lo)*255/(hi-lo):g[i];b[i]=255-Math.max(0,Math.min(255,v))>140?255:0;}
 for(let y=0;y<h;y++){let n=0;for(let x=0;x<w;x++)if(!b[y*w+x])n++;if(n>0.5*w)for(let x=0;x<w;x++)b[y*w+x]=255;}
 for(let x=0;x<w;x++){let n=0;for(let y=0;y<h;y++)if(!b[y*w+x])n++;if(n>0.6*h)for(let y=0;y<h;y++)b[y*w+x]=255;}
 const c=document.createElement("canvas");c.width=w+2*MARGEN_INVERTIDA;c.height=h+2*MARGEN_INVERTIDA;
 const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);
 const img=x.createImageData(w,h);
 for(let i=0;i<w*h;i++){img.data[4*i]=img.data[4*i+1]=img.data[4*i+2]=b[i];img.data[4*i+3]=255;}
 x.putImageData(img,MARGEN_INVERTIDA,MARGEN_INVERTIDA);
 return c;
}
// Bandas oscuras: filas con más del 35 % de píxeles oscuros, tramos a ≤ 15 px unidos, de 12 a 150 px.
function bandasOscuras(lienzo){
 const w=lienzo.width,h=lienzo.height,d=lienzo.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data;
 const filas=[];
 for(let y=0;y<h;y++){let n=0,t=0;for(let x=0;x<w;x+=4){const i=4*(y*w+x);if(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]<110)n++;t++;}filas.push(n/t);}
 const tramos=[];
 for(let y=0;y<h;y++)if(filas[y]>0.35){const y0=y;while(y<h&&filas[y]>0.35)y++;tramos.push([y0,y]);}
 const unidos=[];
 for(const t of tramos){if(unidos.length&&t[0]-unidos.at(-1)[1]<=15)unidos.at(-1)[1]=t[1];else unidos.push(t);}
 return unidos.filter(t=>t[1]-t[0]>=12&&t[1]-t[0]<=150);
}
function recortar(lienzo,[x,y,w,h]){
 const c=document.createElement("canvas");c.width=w;c.height=h;
 c.getContext("2d",{alpha:false}).drawImage(lienzo,x,y,w,h,0,0,w,h);
 return c;
}

/*
 * Página OCR sobre un lienzo ya renderizado. Las lecturas se guardan en memoria mientras la
 * página está abierta (releer un albarán de varias páginas no repite el OCR).
 */
function paginaOcr(n,lienzos,clave,rotacion,alProgresar,contador,base){
 const lienzo=lienzos.get(clave),cache=new Map();
 const yo={numero:n,anchoPx:lienzo.width,altoPx:lienzo.height,dpi:DPI,rotacion,
  bandasOscuras:()=>bandasOscuras(lienzos.get(clave)),
  // Imagen en grises reducida (detección de manuscritos): {ancho, alto, datos}.
  gris:(factor=4)=>{
   const l=lienzos.get(clave),w=Math.floor(l.width/factor),h=Math.floor(l.height/factor);
   const c=document.createElement("canvas");c.width=w;c.height=h;
   const x=c.getContext("2d",{alpha:false,willReadFrequently:true});x.drawImage(l,0,0,w,h);
   const d=x.getImageData(0,0,w,h).data,g=new Uint8Array(w*h);
   for(let i=0;i<w*h;i++)g[i]=Math.round(0.299*d[4*i]+0.587*d[4*i+1]+0.114*d[4*i+2]);
   c.width=0;c.height=0;
   return {ancho:w,alto:h,datos:g,dpi:DPI/factor};
  },
  // Recorte en PNG (data URL) para el motor de visión de manuscritos.
  recortePng:([x0,y0,w,h])=>{const c=recortar(lienzos.get(clave),[x0,y0,w,h]);const url=c.toDataURL("image/png");c.width=0;c.height=0;return url;},
  ocr:({psm=4,region=null,umbral=null,escala=1,lista=null,tratamiento=null}={})=>{
   const k=JSON.stringify([psm,region,umbral,escala,lista,tratamiento]);
   if(!cache.has(k))cache.set(k,enCola(async()=>{
    const w=await worker();
    alProgresar?.("Página "+n+" · lectura OCR "+(++contador.n)+(region?" (zona)":""));
    await w.setParameters({tessedit_pageseg_mode:String(psm),thresholding_method:umbral==="sauvola"?"2":"0",tessedit_char_whitelist:lista||""});
    let imagen=region?recortar(lienzos.get(clave),region):lienzos.get(clave);
    if(tratamiento==="invertir"){
     const t=invertirBanda(imagen);if(region){imagen.width=0;imagen.height=0;}
     const {data}=await w.recognize(t,{},{blocks:true,text:false});t.width=0;t.height=0;
     return root.DafricaAlbaranes.ocr.palabrasDesdeTesseractJs(data).map(p=>({...p,x0:p.x0-MARGEN_INVERTIDA,x1:p.x1-MARGEN_INVERTIDA,y0:p.y0-MARGEN_INVERTIDA,y1:p.y1-MARGEN_INVERTIDA}));
    }
    if(escala!==1){
     const c=document.createElement("canvas");c.width=Math.round(imagen.width*escala);c.height=Math.round(imagen.height*escala);
     const x=c.getContext("2d",{alpha:false});x.imageSmoothingQuality="high";x.drawImage(imagen,0,0,c.width,c.height);
     if(region){imagen.width=0;imagen.height=0;}
     imagen=c;
    }
    const {data}=await w.recognize(imagen,{},{blocks:true,text:false});
    if(region||escala!==1){imagen.width=0;imagen.height=0;}
    const palabras=root.DafricaAlbaranes.ocr.palabrasDesdeTesseractJs(data);
    return escala===1?palabras:palabras.map(p=>({...p,x0:p.x0/escala,x1:p.x1/escala,y0:p.y0/escala,y1:p.y1/escala}));
   }));
   return cache.get(k);
  },
  // Página escaneada de lado o del revés: misma página girada en sentido horario.
  rotada(grados){
   const g=((grados%360)+360)%360;
   if(!g)return base();
   const kk=n+"@"+g;
   if(!lienzos.has(kk))lienzos.set(kk,girar(lienzos.get(n),g));
   return paginaOcr(n,lienzos,kk,g,alProgresar,contador,base);
  }};
 return yo;
}

/*
 * Fuente de páginas para albaranes/lector.js: capa de texto con pdf.js y OCR con
 * tesseract.js. Cada página se renderiza solo si hace falta OCR y se libera al terminar
 * su albarán: el consumo de memoria no depende del número de páginas del PDF.
 */
async function abrirFuente(pdfjs,bytes,{alProgresar=null}={}){
 const pdf=await pdfjs.getDocument({data:bytes,verbosity:0,isEvalSupported:false}).promise;
 const texto=root.DafricaAlbaranes.textoPdf;
 const lienzos=new Map(),paginas=new Map(),contador={n:0};
 return {
  numPaginas:pdf.numPages,
  async texto(n){const page=await pdf.getPage(n);try{return await texto.leerPagina(pdfjs,page,n);}finally{page.cleanup();}},
  async ocr(n){
   if(!paginas.has(n)){
    lienzos.set(n,await renderizar(pdf,n));
    const base=()=>paginas.get(n);
    paginas.set(n,paginaOcr(n,lienzos,n,0,alProgresar,contador,base));
   }
   return paginas.get(n);
  },
  liberar(n){
   for(const [k,c] of [...lienzos])if(k===n||String(k).startsWith(n+"@")){c.width=0;c.height=0;lienzos.delete(k);}
   paginas.delete(n);
  },
  async cerrar(){for(const c of lienzos.values()){c.width=0;c.height=0;}lienzos.clear();paginas.clear();await pdf.destroy().catch(()=>{});}
 };
}

/*
 * Compatibilidad: todas las páginas de un PDF escaneado como páginas OCR (un solo albarán).
 * Devuelve {paginas, liberar}; llamar a liberar() al terminar.
 */
async function paginasEscaneadas(pdfjs,bytes,{alProgresar=null}={}){
 const fuente=await abrirFuente(pdfjs,bytes,{alProgresar}),paginas=[];
 for(let n=1;n<=fuente.numPaginas;n++)paginas.push(await fuente.ocr(n));
 return {paginas,liberar:()=>fuente.cerrar()};
}

root.DafricaAlbaranes=root.DafricaAlbaranes||{};
root.DafricaAlbaranes.motorNavegador={abrirFuente,paginasEscaneadas,cerrar,DPI};
})(typeof globalThis!=="undefined"?globalThis:this);
