"use strict";
// Fallos reales del 2026-11-25 (lotes de Martínez Bierzo, Decotap y Sonepar), reproducidos con datos FICTICIOS: códigos con basura del
// margen o una «£» por «E», el principio de la descripción en la casilla del código, la línea de dos renglones con el primero leído con
// poca confianza, la cantidad que no se leyó y la devolución dentro de un albarán.
const test=require("node:test"),assert=require("node:assert/strict");
const {fila,cabeceraDoc,leer}=require("./ayudas-ocr.js");
const titulos=(y=200)=>fila(y,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
const articulo=(y,ref,desc,q,p,d,i)=>fila(y,...(ref?[[ref,60,95,{ancho:55}]]:[]),[desc,120,95,{ancho:250}],...(q?[[q,420]]:[]),[p,462],...(d?[[d,510]]:[]),[i,560]);

test("código: basura delante de un EAN-13 válido, «£» por «E» y el principio de la descripción pegado detrás",()=>{
 const r=leer([...cabeceraDoc(),...titulos(),
  ...articulo(220,"añ 8400000000017","CLAVIJA FICTICIA","1,00","10,00","","10,00"),
  ...articulo(232,"ON 8400000000018","CLAVIJA FICTICIA B","1,00","10,00","","10,00"),
  ...articulo(244,"099X£00012345","TORNILLO FICTICIO","1,00","10,00","","10,00"),
  ...articulo(256,"99IMMFICT0030 [Taco clavo","Ficticio MNA 5x30","1,00","10,00","","10,00")]);
 assert.deepEqual(r.lineas.map(l=>l.referencia.valor),["8400000000017","ON 8400000000018","099XE00012345","99IMMFICT0030"]);
 assert.ok(r.lineas[0].referencia.notas.some(n=>/EAN-13/.test(n)));
 // Con un dígito de control que no cuadra, no se toca (puede no ser un EAN).
 assert.equal(r.lineas[3].descripcion.valor,"Taco clavo Ficticio MNA 5x30");
 assert.equal(r.lineas[3].descripcion.estado,"REVISAR");
});

test("línea de dos renglones: el primero, con el código, leído con poca confianza; queda en la línea, en revisión",()=>{
 const r=leer([...cabeceraDoc(),...titulos(),
  ...articulo(220,"1300000001","BROCA FICTICIA","1,00","10,00","","10,00"),
  ...fila(232,["77FICT0001X",60,30],["XPS",120,30],["FICTICIO",140,25],["N-II",185,35],["1250x600",210,30],["300",260,30]),
  ...fila(244,["kPa",120]),
  ...fila(256,["=0.032",120],["W/mk",156],["67,50",420],["4,40",462],["297,00",560])]);
 assert.equal(r.lineas.length,2);
 const l=r.lineas[1];
 assert.equal(l.referencia.valor,"77FICT0001X");assert.equal(l.referencia.estado,"REVISAR");
 assert.equal(l.descripcion.valor,"XPS FICTICIO N-II 1250x600 300 kPa =0.032 W/mk");assert.equal(l.descripcion.estado,"REVISAR");
 assert.equal(r.lineas[0].descripcion.valor,"BROCA FICTICIA","la línea de arriba no se lleva los renglones de la de abajo");
});

test("cantidad sin leer: el cuadre la sugiere (también en negativo, en una devolución), nunca la pone; y la devolución es un abono",()=>{
 const r=leer([...cabeceraDoc(),...titulos(),
  ...articulo(220,"1300000001","TORNILLO FICTICIO","","14,8571","50","-7,43"),
  ...articulo(232,"1300000002","TACO FICTICIO","","14,2400","50","7,12")]);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.cantidad.sugerida]),[[null,-1],[null,1]]);
 assert.equal(r.tipo_documento.valor,"ABONO");
 assert.match(r.tipo_documento.evidencia,/línea 1 .*negativo/);
 // Un albarán normal sigue siendo albarán (también con una cantidad leída en positivo y el importe de un descuento en negativo).
 const n=leer([...cabeceraDoc(),...titulos(),
  ...articulo(220,"1300000001","TORNILLO FICTICIO","2,00","10,00","","20,00"),
  ...articulo(232,"1300000003","DESCUENTO FICTICIO","1,00","5,00","","-5,00")]);
 assert.equal(n.tipo_documento.valor,"ALBARAN");
});
