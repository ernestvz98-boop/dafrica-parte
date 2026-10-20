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
function recortar(lienzo,[x,y,w,h]){
 const c=document.createElement("canvas");c.width=w;c.height=h;
 c.getContext("2d",{alpha:false}).drawImage(lienzo,x,y,w,h,0,0,w,h);
 return c;
}

/*
 * pdfjs: el módulo de pdf.js ya cargado · bytes: Uint8Array del PDF.
 * alProgresar(texto): opcional, para mostrar el avance (el OCR tarda varios segundos por lectura).
 * Devuelve {paginas, liberar}; llamar a liberar() al terminar.
 */
async function paginasEscaneadas(pdfjs,bytes,{alProgresar=null}={}){
 const pdf=await pdfjs.getDocument({data:bytes,verbosity:0}).promise;
 const {palabrasDesdeTesseractJs}=root.DafricaAlbaranes.ocr;
 const lienzos=new Map(),paginas=[];
 let lecturas=0;
 for(let n=1;n<=pdf.numPages;n++){
  const lienzo=await renderizar(pdf,n);
  lienzos.set(n,lienzo);
  paginas.push({numero:n,anchoPx:lienzo.width,altoPx:lienzo.height,dpi:DPI,
   ocr:({psm=4,region=null,umbral=null}={})=>enCola(async()=>{
    const w=await worker();
    alProgresar?.("Página "+n+" · lectura OCR "+(++lecturas)+(region?" (zona)":""));
    await w.setParameters({tessedit_pageseg_mode:String(psm),thresholding_method:umbral==="sauvola"?"2":"0"});
    const imagen=region?recortar(lienzos.get(n),region):lienzos.get(n);
    const {data}=await w.recognize(imagen,{},{blocks:true,text:false});
    if(region){imagen.width=0;imagen.height=0;}
    return palabrasDesdeTesseractJs(data);
   })});
 }
 return {paginas,liberar:async()=>{
  for(const c of lienzos.values()){c.width=0;c.height=0;}
  lienzos.clear();await pdf.destroy().catch(()=>{});
 }};
}

root.DafricaAlbaranes=root.DafricaAlbaranes||{};
root.DafricaAlbaranes.motorNavegador={paginasEscaneadas,cerrar,DPI};
})(typeof globalThis!=="undefined"?globalThis:this);
