"use strict";
/*
 * Segundo motor (visión del recorte de una celda impresa dudosa): solo se acepta un texto
 * idéntico a alguna lectura OCR de la misma celda. Motor de visión simulado; datos ficticios.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {HOY,registroCon,fila,cabeceraDoc}=require("./ayudas-ocr.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");
const {motorSupabase}=require("../albaranes/vision.js");

const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const etiquetas=()=>[...fila(120,["ALBARÁN",60],["Nº",105],["600.111",120]),...fila(120,["FECHA",300],["15/10/26",340])];
// Celda de descripción con confianza baja; cada estrategia de relectura da una variante distinta.
function motor(variantes,ref="1300000001"){
 const pag=[...cabeceraDoc(),...etiquetas(),...titulos(),...fila(218,[ref,60],["ESPUMA",120,60],["PU",160,60],["750ml",180,60],["2,00",420],["10,000",462],["50",510],["10,00",560])];
 let n=0;
 const recortes=[];
 return {recortes,paginas:[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  recortePng:caja=>{recortes.push(caja);return "data:image/png;base64,AAAA";},
  async ocr({region=null}={}){
   if(!region)return pag;
   const [x,y,ww,h]=region;
   if(ww<595&&x>100&&x<200){const t=variantes[(n++)%variantes.length];return [{texto:t,conf:85,x0:2,x1:80,y0:2,y1:10}];}
   return pag.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}]};
}

test("visión del recorte que coincide con una de las lecturas OCR en conflicto: se acepta con su evidencia",async()=>{
 const m=motor(["ESPUMA PU 750ml","ESPUMA PU 750m1"]);
 const vision=async(recortes,{modo})=>{assert.equal(modo,"impreso");return recortes.map((_,i)=>({indice:i,texto:"ESPUMA PU 750ml"}));};
 const r=await extraerEscaneado(m.paginas,{registro:registroCon(),hoy:HOY,vision});
 const d=r.lineas[0].descripcion;
 assert.equal(d.valor,"ESPUMA PU 750ml");assert.ok(d.confianza>=0.9);
 assert.equal(d.resolucion.metodo,"vision_coincide_ocr");
 // Solo se envía el recorte de la celda, nunca la página.
 assert.ok(m.recortes.every(([,,w,h])=>w<300&&h<40));
});

test("visión que propone un texto que ningún OCR leyó (p. ej. S en vez de 5): no se acepta",async()=>{
 const m=motor(["ESPUMA PU 750ml","ESPUMA PU 750m1"]);
 const vision=async recortes=>recortes.map((_,i)=>({indice:i,texto:"ESPUMA PU 75Oml"}));
 const r=await extraerEscaneado(m.paginas,{registro:registroCon(),hoy:HOY,vision});
 assert.ok(r.lineas[0].descripcion.confianza<0.9);
});

test("si la visión no está disponible, el lector sigue y lo deja anotado",async()=>{
 const m=motor(["ESPUMA PU 750ml","ESPUMA PU 750m1"]);
 const vision=async()=>{throw Error("HTTP 503");};
 const r=await extraerEscaneado(m.paginas,{registro:registroCon(),hoy:HOY,vision});
 assert.ok(r.lineas[0].descripcion.confianza<0.9);
 assert.ok(r.incidencias.some(x=>/Visión de campos dudosos no disponible/.test(x)));
});

test("cliente de la función: envía solo los recortes y el modo, con la sesión",async()=>{
 let enviado=null;
 const v=motorSupabase({url:"https://ejemplo.invalid/fn",token:async()=>"jwt",fetchImpl:async(url,o)=>{enviado={url,o};return {ok:true,json:async()=>({recortes:[{indice:0,texto:"X"}]})};}});
 const r=await v(["data:image/png;base64,AAAA"],{modo:"impreso"});
 assert.deepEqual(r,[{indice:0,texto:"X"}]);
 assert.deepEqual(JSON.parse(enviado.o.body),{recortes:["data:image/png;base64,AAAA"],modo:"impreso"});
 assert.equal(enviado.o.headers.Authorization,"Bearer jwt");
});
