"use strict";
/*
 * DAFRICA · PDF individual de cada albarán (prueba real del 2026-10-28: 32 albaranes de un PDF de 40
 * páginas quedaban enlazados al MISMO PDF completo).
 *
 *  - `separar` crea el PDF de un albarán con solo sus páginas del original, siempre igual para las mismas
 *    páginas del mismo PDF (fechas y productor fijos): la misma huella SHA-256 en cada lectura, así que
 *    volver a leer no duplica ficheros ni filas.
 *  - `comprobar` verifica un PDF recibido (huella y número de páginas) antes de usarlo: el robot nunca
 *    adjunta un fichero que no sea exactamente el del albarán.
 *  - `referencia` describe el vínculo verificable entre el PDF individual y el original del lote.
 * Recibe PDFLib (pdf-lib 1.17.1: albaranes/vendor/pdf-lib.min.js en el navegador, npm en Node).
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports)module.exports=api;
 else{root.DafricaAlbaranes=root.DafricaAlbaranes||{};root.DafricaAlbaranes.archivoPdf=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
const FECHA_FIJA=new Date(0);

async function huella(bytes){
 const c=globalThis.crypto?.subtle;
 if(!c)throw Error("Sin SHA-256 disponible");
 const d=await c.digest("SHA-256",bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));
 return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

/** PDF con solo `paginas` (1 = primera) del original. Error si alguna página no existe. */
async function separar(PDFLib,bytes,paginas){
 if(!PDFLib?.PDFDocument)throw Error("pdf-lib no disponible");
 const lista=(paginas||[]).map(Number);
 if(!lista.length||lista.some(n=>!Number.isInteger(n)||n<1))throw Error("Páginas no válidas: "+JSON.stringify(paginas));
 const origen=await PDFLib.PDFDocument.load(bytes,{ignoreEncryption:false,updateMetadata:false});
 const total=origen.getPageCount();
 if(lista.some(n=>n>total))throw Error("El PDF tiene "+total+" páginas; se pidieron "+lista.join(","));
 const nuevo=await PDFLib.PDFDocument.create({updateMetadata:false});
 nuevo.setCreationDate(FECHA_FIJA);nuevo.setModificationDate(FECHA_FIJA);nuevo.setProducer("DAFRICA");nuevo.setCreator("DAFRICA");
 for(const p of await nuevo.copyPages(origen,lista.map(n=>n-1)))nuevo.addPage(p);
 return new Uint8Array(await nuevo.save({useObjectStreams:false}));
}

/** {ok, motivo, sha256, paginas}: la huella y el número de páginas han de ser los esperados. */
async function comprobar(PDFLib,bytes,{sha256=null,paginas=null}={}){
 let h;
 try{h=await huella(bytes);}catch(e){return {ok:false,motivo:String(e?.message||e)};}
 if(sha256&&h!==sha256)return {ok:false,motivo:"La huella del PDF no coincide con la registrada",sha256:h};
 let n=null;
 if(paginas!=null){
  try{n=(await PDFLib.PDFDocument.load(bytes,{updateMetadata:false})).getPageCount();}
  catch(e){return {ok:false,motivo:"PDF ilegible: "+String(e?.message||e).slice(0,120),sha256:h};}
  if(n!==paginas)return {ok:false,motivo:"El PDF tiene "+n+" páginas y el albarán "+paginas,sha256:h,paginas:n};
 }
 return {ok:true,sha256:h,paginas:n};
}

/** Vínculo PDF individual ↔ original, para el plan de la cola. */
function referencia({sha256,paginasOriginales,original}){
 return {individual:true,sha256,paginas:paginasOriginales.length,
  original:{sha256:original.sha256,nombre:original.nombre||null,paginas:paginasOriginales.slice(),total_paginas:original.total_paginas??null}};
}

return {huella,separar,comprobar,referencia};
});
