"use strict";
/*
 * Motor OCR para pruebas con tesseract.js: el MISMO motor (WebAssembly) y el MISMO modelo
 * de español (vendor/tesseract/lang) que usa la web. Sirve para medir la precisión que
 * tendrá el navegador. Las imágenes salen de pdftoppm, igual que en motor-tesseract.js.
 */
const {execFileSync}=require("child_process");
const fs=require("fs"),path=require("path"),crypto=require("crypto");
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

function tamPng(archivo){const b=fs.readFileSync(archivo);return {ancho:b.readUInt32BE(16),alto:b.readUInt32BE(20)};}
function numeroPaginas(pdf){return +String(execFileSync("pdfinfo",[pdf])).match(/Pages:\s+(\d+)/)[1];}

/*
 * render: "pdftoppm" (por defecto) o "navegador": imágenes exportadas desde pdf.js en Chromium
 * (cache/navegador/nav-pN.png), para reproducir exactamente lo que lee la web.
 */
function paginasEscaneadas(pdf,{cache=path.join(path.dirname(pdf),".cache"),render="pdftoppm"}={}){
 fs.mkdirSync(cache,{recursive:true});
 const huella=crypto.createHash("sha256").update(fs.readFileSync(pdf)).digest("hex").slice(0,16)+(render==="navegador"?"-nav":"");
 const total=numeroPaginas(pdf),paginas=[];
 for(let n=1;n<=total;n++){
  const png=render==="navegador"?path.join(cache,"navegador","nav-p"+n+".png"):path.join(cache,`${huella}-p${n}.png`);
  if(render==="navegador"&&!fs.existsSync(png))throw Error("Falta "+png+": exporta antes las páginas desde el navegador");
  if(!fs.existsSync(png))execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",pdf,png.replace(/\.png$/,"")]);
  const {ancho,alto}=tamPng(png);
  paginas.push({numero:n,anchoPx:ancho,altoPx:alto,dpi:DPI,
   async ocr({psm=4,region=null,umbral=null}={}){
    const id=`${huella}-p${n}-psm${psm}`+(region?"-"+region.join("_"):"")+(umbral?"-"+umbral:"");
    const json=path.join(cache,id+".tjs.json");
    if(!fs.existsSync(json)){
     let img=png;
     if(region){
      img=path.join(cache,`${huella}-p${n}-psm${psm}-`+region.join("_")+".png");
      if(!fs.existsSync(img)&&render==="navegador"){
       const [x,y,w,h]=region;
       execFileSync("python3",["-c","import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).crop(tuple(map(int,sys.argv[3:7]))).save(sys.argv[2])",
        png,img,String(x),String(y),String(x+w),String(y+h)]);
      }
      if(!fs.existsSync(img)){
       const [x,y,w,h]=region;
       execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",
        "-x",String(x),"-y",String(y),"-W",String(w),"-H",String(h),pdf,img.replace(/\.png$/,"")]);
      }
     }
     const w=await worker();
     await w.setParameters({tessedit_pageseg_mode:String(psm),thresholding_method:umbral==="sauvola"?"2":"0"});
     const {data}=await w.recognize(img,{},{blocks:true,text:false});
     fs.writeFileSync(json,JSON.stringify(palabrasDesdeTesseractJs(data)));
    }
    return JSON.parse(fs.readFileSync(json,"utf8"));
   }});
 }
 return paginas;
}

module.exports={paginasEscaneadas,cerrar,DPI};
