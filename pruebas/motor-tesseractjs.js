"use strict";
/*
 * Motor OCR para pruebas con tesseract.js: el MISMO motor (WebAssembly) y el MISMO modelo
 * de español (vendor/tesseract/lang) que usa la web. Sirve para medir la precisión que
 * tendrá el navegador. Las imágenes salen de pdftoppm, igual que en motor-tesseract.js.
 */
const fs=require("fs"),path=require("path");
const {crearPaginas}=require("./motor-comun.js");
const {palabrasDesdeTesseractJs}=require("../albaranes/ocr.js");

const DPI=300;
const LANG=path.join(__dirname,"..","vendor","tesseract","lang");
let trabajador=null;
async function worker(){
 if(!trabajador){
  const {createWorker}=require("tesseract.js");
  trabajador=await createWorker("spa",1,{langPath:LANG,gzip:true,cacheMethod:"none"});
 }
 return trabajador;
}
async function cerrar(){if(trabajador){await trabajador.terminate();trabajador=null;}}

async function leer(img,{psm,umbral,lista},json){
 if(!fs.existsSync(json)){
  const w=await worker();
  await w.setParameters({tessedit_pageseg_mode:String(psm),thresholding_method:umbral==="sauvola"?"2":"0",tessedit_char_whitelist:lista||""});
  const {data}=await w.recognize(img,{},{blocks:true,text:false});
  fs.writeFileSync(json,JSON.stringify(palabrasDesdeTesseractJs(data)));
 }
 return JSON.parse(fs.readFileSync(json,"utf8"));
}
/*
 * render: "pdftoppm" (por defecto) o "navegador": imágenes exportadas desde pdf.js en Chromium
 * (cache/navegador/nav-pN.png), para reproducir exactamente lo que lee la web.
 */
const paginasEscaneadas=(pdf,opciones={})=>crearPaginas(pdf,leer,{...opciones,extension:".tjs.json"});

module.exports={paginasEscaneadas,cerrar,DPI};
