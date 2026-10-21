"use strict";
/*
 * Fuente de páginas para albaranes/lector.js en Node (pruebas y evaluación):
 * capa de texto con pdfjs-dist y OCR con el motor de pruebas (Tesseract nativo o tesseract.js).
 */
const fs=require("fs");
const {leerPagina}=require("../albaranes/texto-pdf.js");

async function abrirFuente(ruta,{motor="nativo",render,cache}={}){
 const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const tarea=pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(ruta)),verbosity:0,isEvalSupported:false,useSystemFonts:true});
 const pdf=await tarea.promise;
 let ocr=null;
 const paginasOcr=()=>{
  if(!ocr){
   const {paginasEscaneadas}=require(motor==="nativo"?"./motor-tesseract.js":"./motor-tesseractjs.js");
   ocr=paginasEscaneadas(ruta,{...(render?{render}:{}),...(cache?{cache}:{})});
  }
  return ocr;
 };
 return {
  numPaginas:pdf.numPages,
  async texto(n){const page=await pdf.getPage(n);try{return await leerPagina(pdfjs,page,n);}finally{page.cleanup();}},
  async ocr(n){return paginasOcr()[n-1];},
  liberar(){},
  async cerrar(){await tarea.destroy().catch(()=>{});}
 };
}
module.exports={abrirFuente};
