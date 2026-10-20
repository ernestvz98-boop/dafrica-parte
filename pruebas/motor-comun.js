"use strict";
/*
 * Base común de los motores OCR de pruebas (Tesseract nativo y tesseract.js): páginas a
 * 300 ppp desde pdftoppm, recortes y páginas giradas. Todo se guarda en la caché junto al PDF
 * (carpeta excluida de git). Interfaz para albaranes/escaneado.js:
 *   {numero, anchoPx, altoPx, dpi, rotacion, ocr({psm, region, umbral}), rotada(grados)}
 */
const {execFileSync}=require("child_process");
const fs=require("fs"),path=require("path"),crypto=require("crypto");

const DPI=300;
const PIL_GIRAR="import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).rotate(-int(sys.argv[3]),expand=True,fillcolor=255).save(sys.argv[2])";
const PIL_RECORTAR="import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).crop(tuple(map(int,sys.argv[3:7]))).save(sys.argv[2])";
const PIL_ESCALAR="import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]);f=float(sys.argv[3]);im.resize((round(im.width*f),round(im.height*f)),Image.LANCZOS).save(sys.argv[2])";
// Banda oscura con texto claro (títulos de tabla): contraste, inversión, binarizado y borrado de
// las rayas de la tabla, con margen blanco. Misma receta que albaranes/motor-navegador.js.
const PIL_INVERTIR=`import sys
from PIL import Image, ImageOps
a=ImageOps.autocontrast(Image.open(sys.argv[1]).convert('L'),cutoff=2)
a=ImageOps.invert(a).point(lambda v:255 if v>140 else 0)
w,h=a.size;px=a.load()
for y in range(h):
  if sum(1 for x in range(w) if px[x,y]<128)>0.5*w:
    for x in range(w):px[x,y]=255
for x in range(w):
  if sum(1 for y in range(h) if px[x,y]<128)>0.6*h:
    for y in range(h):px[x,y]=255
ImageOps.expand(a,border=30,fill=255).save(sys.argv[2])`;
// Bandas oscuras: filas consecutivas con más de la mitad de píxeles oscuros (entre 12 y 150 px).
const PIL_BANDAS=`import sys,json
from PIL import Image
a=Image.open(sys.argv[1]).convert('L');w,h=a.size
d=a.resize((w//4,h)).load();W=w//4
filas=[sum(1 for x in range(W) if d[x,y]<110)/W for y in range(h)]
tramos=[];y=0
while y<h:
  if filas[y]>0.35:
    y0=y
    while y<h and filas[y]>0.35:y+=1
    tramos.append([y0,y])
  y+=1
unidos=[]
for t in tramos:
  if unidos and t[0]-unidos[-1][1]<=15:unidos[-1][1]=t[1]
  else:unidos.append(t)
print(json.dumps([t for t in unidos if 12<=t[1]-t[0]<=150]))`;
function tamPng(archivo){const b=fs.readFileSync(archivo);return {ancho:b.readUInt32BE(16),alto:b.readUInt32BE(20)};}
function numeroPaginas(pdf){return +String(execFileSync("pdfinfo",[pdf])).match(/Pages:\s+(\d+)/)[1];}

/*
 * leer(imagenPng, {psm, umbral}, archivoCache) → palabras (lo implementa cada motor).
 * render: "pdftoppm" o "navegador" (páginas exportadas desde pdf.js en Chromium).
 */
function crearPaginas(pdf,leer,{cache=path.join(path.dirname(pdf),".cache"),render="pdftoppm",extension}){
 fs.mkdirSync(cache,{recursive:true});
 const huella=crypto.createHash("sha256").update(fs.readFileSync(pdf)).digest("hex").slice(0,16)+(render==="navegador"?"-nav":"");
 const paginas=[];
 for(let n=1;n<=numeroPaginas(pdf);n++){
  const png=render==="navegador"?path.join(cache,"navegador","nav-p"+n+".png"):path.join(cache,`${huella}-p${n}.png`);
  if(render==="navegador"&&!fs.existsSync(png))throw Error("Falta "+png+": exporta antes las páginas desde el navegador");
  if(!fs.existsSync(png))execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",pdf,png.replace(/\.png$/,"")]);
  paginas.push(pagina(n,png,`${huella}-p${n}`,0));
 }
 function pagina(n,png,id,rotacion){
  const {ancho,alto}=tamPng(png);
  return {numero:n,anchoPx:ancho,altoPx:alto,dpi:DPI,rotacion,
   // escala: amplía el recorte (relectura de un campo); lista: caracteres permitidos.
   // Las coordenadas devueltas son siempre las del recorte sin ampliar.
   // Bandas oscuras de la página, en píxeles: [[y0, y1], …].
   bandasOscuras(){
    const f=path.join(cache,id+"-bandas.json");
    if(!fs.existsSync(f))fs.writeFileSync(f,execFileSync("python3",["-c",PIL_BANDAS,png]));
    return JSON.parse(fs.readFileSync(f,"utf8"));
   },
   // tratamiento "invertir": texto claro sobre banda oscura (las coordenadas descuentan el margen añadido).
   async ocr({psm=4,region=null,umbral=null,escala=1,lista=null,tratamiento=null}={}){
    // Mismos nombres de caché que la versión anterior para la orientación original.
    const clave=`${id}-psm${psm}`+(region?"-"+region.join("_"):"")+(umbral?"-"+umbral:"")+
     (escala!==1?"-x"+escala:"")+(lista?"-l"+crypto.createHash("md5").update(lista).digest("hex").slice(0,6):"")+(tratamiento?"-"+tratamiento:"");
    const salida=path.join(cache,clave+extension);
    let img=png;
    if(region){
     img=path.join(cache,`${id}-psm${psm}-`+region.join("_")+".png");
     if(!fs.existsSync(img)){
      const [x,y,w,h]=region;
      if(rotacion===0&&render==="pdftoppm")
       execFileSync("pdftoppm",["-r",String(DPI),"-gray","-png","-f",String(n),"-l",String(n),"-singlefile",
        "-x",String(x),"-y",String(y),"-W",String(w),"-H",String(h),pdf,img.replace(/\.png$/,"")]);
      else execFileSync("python3",["-c",PIL_RECORTAR,png,img,String(x),String(y),String(x+w),String(y+h)]);
     }
    }
    if(tratamiento==="invertir"){
     const tratada=img.replace(/\.png$/,"")+"-inv.png";
     if(!fs.existsSync(tratada))execFileSync("python3",["-c",PIL_INVERTIR,img,tratada]);
     const palabras=await leer(tratada,{psm,umbral,lista},salida);
     return palabras.map(w=>({...w,x0:w.x0-30,x1:w.x1-30,y0:w.y0-30,y1:w.y1-30}));
    }
    if(escala!==1){
     const ampliada=img.replace(/\.png$/,"")+"-x"+escala+".png";
     if(!fs.existsSync(ampliada))execFileSync("python3",["-c",PIL_ESCALAR,img,ampliada,String(escala)]);
     const palabras=await leer(ampliada,{psm,umbral,lista},salida);
     return palabras.map(w=>({...w,x0:w.x0/escala,x1:w.x1/escala,y0:w.y0/escala,y1:w.y1/escala}));
    }
    return leer(img,{psm,umbral,lista},salida);
   },
   // Página girada «grados» en sentido horario (90, 180, 270) respecto a la original.
   rotada(grados){
    const g=((grados%360)+360)%360;
    if(g===rotacion)return this;
    const base=paginas[n-1];
    if(g===0)return base;
    const idG=`${id.replace(/-r\d+$/,"")}-r${g}`;
    const pngG=path.join(cache,idG+".png");
    if(!fs.existsSync(pngG))execFileSync("python3",["-c",PIL_GIRAR,paginas[n-1]._png,pngG,String(g)]);
    return pagina(n,pngG,idG,g);
   },
   _png:png};
 }
 return paginas;
}

module.exports={crearPaginas,DPI,tamPng};
