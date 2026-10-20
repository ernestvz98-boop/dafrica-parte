"use strict";
/*
 * Motor OCR para pruebas locales: pdftoppm (Poppler) + Tesseract nativo (idioma «spa»).
 * La web usa tesseract.js (ver motor-tesseractjs.js para medir con ese mismo motor).
 * Las lecturas se guardan en caché junto al PDF (carpeta excluida de git).
 */
const {execFileSync}=require("child_process");
const fs=require("fs");
const {palabrasDesdeTsv}=require("../albaranes/ocr.js");
const {crearPaginas,DPI}=require("./motor-comun.js");

// umbral "sauvola": binarización adaptativa de Tesseract (rótulos sobre bandas grises).
function leer(img,{psm,umbral,lista},tsv){
 if(!fs.existsSync(tsv)){
  const extra=[...(umbral==="sauvola"?["-c","thresholding_method=2"]:[]),...(lista?["-c","tessedit_char_whitelist="+lista]:[])];
  fs.writeFileSync(tsv,execFileSync("tesseract",[img,"-","-l","spa","--psm",String(psm),...extra,"tsv"],{stdio:["ignore","pipe","ignore"],maxBuffer:64*1024*1024}));
 }
 // Las coordenadas de un recorte son relativas al recorte: el llamante aplica el desplazamiento.
 return palabrasDesdeTsv(fs.readFileSync(tsv,"utf8"));
}
const paginasEscaneadas=(pdf,opciones={})=>crearPaginas(pdf,async(...a)=>leer(...a),{...opciones,extension:".tsv"});

module.exports={paginasEscaneadas,DPI};
