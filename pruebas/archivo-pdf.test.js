"use strict";
// PDF individual de cada albarán (2026-10-28). PDF ficticio generado aquí.
const test=require("node:test"),assert=require("node:assert/strict");
const PDFLib=require("pdf-lib");
const A=require("../albaranes/archivo-pdf.js");

async function lote(n){
 const d=await PDFLib.PDFDocument.create(),f=await d.embedFont(PDFLib.StandardFonts.Helvetica);
 for(let i=1;i<=n;i++)d.addPage([200,200]).drawText("PAGINA FICTICIA "+i,{x:10,y:100,size:12,font:f});
 return new Uint8Array(await d.save());
}

test("separar: solo las páginas del albarán, siempre el mismo fichero (misma huella)", async()=>{
 const pdf=await lote(5);
 const a=await A.separar(PDFLib,pdf,[2,3]),b=await A.separar(PDFLib,pdf,[2,3]);
 assert.equal((await PDFLib.PDFDocument.load(a)).getPageCount(),2);
 assert.equal(await A.huella(a),await A.huella(b));
 assert.notEqual(await A.huella(a),await A.huella(await A.separar(PDFLib,pdf,[4])));
 await assert.rejects(A.separar(PDFLib,pdf,[6]),/tiene 5 páginas/);
 await assert.rejects(A.separar(PDFLib,pdf,[]),/Páginas no válidas/);
});

test("comprobar: huella y número de páginas; el lote completo nunca pasa por un albarán de 1 página", async()=>{
 const pdf=await lote(4),uno=await A.separar(PDFLib,pdf,[1]),h=await A.huella(uno);
 assert.equal((await A.comprobar(PDFLib,uno,{sha256:h,paginas:1})).ok,true);
 assert.match((await A.comprobar(PDFLib,pdf,{paginas:1})).motivo,/4 páginas y el albarán 1/);
 assert.match((await A.comprobar(PDFLib,uno,{sha256:"0".repeat(64)})).motivo,/huella/);
 assert.match((await A.comprobar(PDFLib,new Uint8Array([1,2,3]),{paginas:1})).motivo,/ilegible/);
});

test("referencia: vínculo verificable con el original del lote", ()=>{
 const r=A.referencia({sha256:"b".repeat(64),paginasOriginales:[22],original:{sha256:"c".repeat(64),nombre:"lote.pdf",total_paginas:40}});
 assert.deepEqual(r,{individual:true,sha256:"b".repeat(64),paginas:1,original:{sha256:"c".repeat(64),nombre:"lote.pdf",paginas:[22],total_paginas:40}});
});
