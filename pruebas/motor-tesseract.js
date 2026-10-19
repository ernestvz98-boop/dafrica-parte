"use strict";
/*
 * Motor OCR para pruebas locales: pdftoppm (Poppler) + Tesseract nativo (idioma «spa»).
 * En la web se usará tesseract.js, el mismo motor compilado a WebAssembly.
 * Las lecturas se guardan en caché junto al PDF (carpeta excluida de git).
 */
const {execFileSync}=require("child_process");
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const {palabrasDesdeTsv}=require("../albaranes/ocr.js");

const DPI=300;
function tamPng(archivo){const b=fs.readFileSync(archivo);return {ancho:b.readUInt32BE(16),alto:b.readUInt32BE(20)};}
function numeroPaginas(pdf){return +String(execFileSync("pdfinfo",[pdf])).match(/Pages:\s+(\d+)/)[1];}

function paginasEscaneadas(pdf,{cache=path.join(path.dirname(pdf),".cache")}={}){
 fs.mkdirSync(cache,{recursive:true});
 const huella=crypto.createHash("sha256").update(fs.readFileSync(pdf)).digest("hex").slice(0,16);
 const total=numeroPaginas(pdf),paginas=[];
 for(let n=1;n<=total;n++){
  const png=path.join(cache,`${huella}-p${n}.png`);
  if(!fs.existsSync(png))execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",pdf,png.replace(/\.png$/,"")]);
  const {ancho,alto}=tamPng(png);
  paginas.push({numero:n,anchoPx:ancho,altoPx:alto,dpi:DPI,
   async ocr({psm=4,region=null}={}){
    const id=`${huella}-p${n}-psm${psm}`+(region?"-"+region.join("_"):"");
    const tsv=path.join(cache,id+".tsv");
    if(!fs.existsSync(tsv)){
     let img=png;
     if(region){
      img=path.join(cache,id+".png");
      const [x,y,w,h]=region;
      execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",
       "-x",String(x),"-y",String(y),"-W",String(w),"-H",String(h),pdf,img.replace(/\.png$/,"")]);
     }
     fs.writeFileSync(tsv,execFileSync("tesseract",[img,"-","-l","spa","--psm",String(psm),"tsv"],{stdio:["ignore","pipe","ignore"],maxBuffer:64*1024*1024}));
    }
    const palabras=palabrasDesdeTsv(fs.readFileSync(tsv,"utf8"));
    // Las coordenadas de un recorte son relativas al recorte: el llamante aplica el desplazamiento.
    return palabras;
   }});
 }
 return paginas;
}

module.exports={paginasEscaneadas,DPI};
