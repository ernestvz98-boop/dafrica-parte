"use strict";
/*
 * Regresión: foto real de un albarán (2026-11-24). La lectura de la página con psm 4 y 6 daba la descripción sin su última
 * letra con confianza 92 y la de psm 4 con umbral Sauvola, entera con 91. Se aceptaba la
 * incompleta solo por su confianza. Con dos lecturas fiables distintas de la misma casilla, no se acepta ninguna.
 * Todos los códigos, textos e importes son inventados.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {HOY,registroCon,fila,cabeceraDoc}=require("./ayudas-ocr.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");

const etiquetas=()=>[...fila(120,["ALBARÁN",60],["Nº",105],["600.111",120]),...fila(120,["FECHA",300],["15/10/26",340])];
const titulos=()=>fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]);
const linea=(ultima,conf=95)=>fila(218,["1300000001",60],["TASA",120],["FICTICIA",150],[ultima,195,conf],["2,00",420],["10,000",462],["20,00",560]);
// Motor de pruebas: cada lectura de la página (psm y umbral) devuelve sus palabras; las relecturas de zonas, nada.
const motor=porLectura=>[{numero:1,anchoPx:595,altoPx:842,dpi:72,
 async ocr({psm,region=null,umbral=null}={}){
  if(region)return [];
  return [...cabeceraDoc(),...etiquetas(),...titulos(),...porLectura(psm,umbral)];
 }}];
const leer=async porLectura=>(await extraerEscaneado(motor(porLectura),{registro:registroCon({formato_referencia:"^\\d{10}$"}),hoy:HOY})).lineas[0];

test("descripción: dos lecturas fiables distintas de la misma casilla → en revisión, con las dos",async()=>{
 const l=await leer((psm,umbral)=>linea(umbral==="sauvola"?"COMPLETAS":"COMPLETA",umbral==="sauvola"?91:92));
 assert.equal(l.cuadre.estado,"VERIFICADO");
 assert.notEqual(l.descripcion.estado,"OK");
 assert.ok(l.descripcion.confianza<0.9,String(l.descripcion.confianza));
 assert.ok(l.descripcion.motivos.some(m=>/Lecturas OCR fiables distintas: .*COMPLETAS?\b.*\|/.test(m)),l.descripcion.motivos.join(" / "));
 assert.equal(l.estado,"REVISAR");
});

test("descripción: todas las lecturas iguales, o la distinta con una palabra dudosa → se acepta como antes",async()=>{
 const iguales=await leer(()=>linea("COMPLETA",92));
 assert.equal(iguales.descripcion.valor,"TASA FICTICIA COMPLETA");
 assert.ok(iguales.descripcion.confianza>=0.9);
 // La otra lectura no es fiable (su última palabra con 60): no es una interpretación que cuente.
 const dudosa=await leer((psm,umbral)=>linea(umbral==="sauvola"?"COMPLETAS":"COMPLETA",umbral==="sauvola"?60:92));
 assert.equal(dudosa.descripcion.valor,"TASA FICTICIA COMPLETA");
 assert.ok(dudosa.descripcion.confianza>=0.9);
});

test("código: dos lecturas fiables distintas (una cifra) → en revisión",async()=>{
 const l=await leer((psm,umbral)=>{
  const ws=linea("COMPLETA",92);
  if(umbral==="sauvola")ws[0]={...ws[0],texto:"1300000007"};
  return ws;
 });
 assert.ok(l.referencia.confianza<0.9,String(l.referencia.confianza));
 assert.ok(l.referencia.motivos.some(m=>/1300000001 \| 1300000007/.test(m)),l.referencia.motivos.join(" / "));
});
