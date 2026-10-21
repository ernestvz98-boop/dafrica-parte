"use strict";
// Etiquetas de obra con QR (código ficticio).
const test=require("node:test"),assert=require("node:assert/strict");
const E=require("../albaranes/etiquetas.js"),jsQR=require("../albaranes/vendor/jsQR.js"),qrcode=require("../albaranes/vendor/qrcode.js");

// Página en grises (150 ppp aprox.) con un QR de `texto` de ~28 mm en (x, y) y algo de «texto» alrededor.
function pagina(texto,{x=600,y=900,numero=1}={}){
 const ancho=1240,alto=1754,datos=new Uint8Array(ancho*alto).fill(245);
 for(let k=0;k<4000;k++){const i=Math.floor(Math.random()*ancho*alto);datos[i]=40;}
 if(texto){
  const q=qrcode(0,"M");q.addData(texto);q.make();
  const n=q.getModuleCount(),px=Math.floor(165/(n+4));
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))
   for(let dy=0;dy<px;dy++)for(let dx=0;dx<px;dx++)datos[(y+(r+2)*px+dy)*ancho+x+(c+2)*px+dx]=20;
 }
 return {numero,gris:()=>({ancho,alto,datos,dpi:150})};
}
const res=()=>({manuscritos:{obra:{valor:null,literal:"",estado:"VACIO"},stel:{estado:"VACIO"}}});

test("QR de obra en la página: código exacto aceptado",()=>{
 const h=E.detectar([pagina(E.contenido("PRY12345"))],jsQR);
 assert.deepEqual(h,[{pagina:1,codigo:"PRY12345"}]);
 const r=res();assert.equal(E.aplicar(r,h),true);
 assert.equal(r.manuscritos.obra.valor,"PRY12345");assert.equal(r.manuscritos.obra.estado,"OK");assert.equal(r.manuscritos.obra.resolucion.metodo,"etiqueta_qr");
});
test("QR de otra cosa o sin QR: nada",()=>{
 assert.deepEqual(E.detectar([pagina("https://ejemplo.invalid"),pagina(null)],jsQR),[]);
});
test("dos etiquetas distintas o letra a mano validada con otra obra: no se acepta",()=>{
 const a=res();E.aplicar(a,[{pagina:1,codigo:"PRY12345"},{pagina:2,codigo:"PRY12346"}]);
 assert.equal(a.manuscritos.obra.estado,"AMBIGUO");
 const b=res();b.manuscritos.obra={valor:"PRY99999",estado:"OK",confianza:0.95};
 E.aplicar(b,[{pagina:1,codigo:"PRY12345"}]);assert.equal(b.manuscritos.obra.estado,"REVISAR");
});
test("hoja de etiquetas: HTML autónomo con el código y su QR",()=>{
 const h=E.hojaEtiquetas({codigo:"PRY12345",nombre:"OBRA <FICTICIA>",copias:3},qrcode);
 assert.equal((h.match(/<svg/g)||[]).length,3);assert.ok(h.includes("PRY12345")&&h.includes("OBRA &lt;FICTICIA&gt;"));
 assert.throws(()=>E.hojaEtiquetas({codigo:"PRY123"},qrcode));
});
