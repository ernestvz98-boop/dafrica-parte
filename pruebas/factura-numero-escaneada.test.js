"use strict";
/*
 * Número de una factura ESCANEADA (banco real de facturas escaneadas, 2026-11-27: 15 de 194 con el número mal y aceptado al 0,95).
 * - El número del albarán de la primera fila de la tabla («ALBARAN | DESCRIPCION…» y debajo «2600222 | PIEZA…»): extraer.js lo deja
 *   en duda («No está tras «Nº factura»») y la relectura de la casilla no puede quitar esa duda (confirma las cifras, no el sitio).
 * - El título «FACTURA» suelto y, debajo, «… CLIENTE | 430000111»: el código del cliente nunca es el número de la factura.
 * Datos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {extraerEscaneado}=require("../albaranes/escaneado.js");

// Motor con relecturas por recorte: cada relectura de una casilla devuelve «recorte» (las mismas cifras, como el OCR real).
function motor(palabras,recorte){
 return [{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({region=null}={}){
   if(!region)return palabras;
   const [x,y,ww,h]=region;
   if(ww<595&&recorte)return [{texto:recorte,conf:95,x0:2,x1:40,y0:2,y1:10}];
   return palabras.filter(p=>p.x0>=x&&p.x1<=x+ww&&p.y0>=y&&p.y1<=y+h).map(p=>({...p,x0:p.x0-x,x1:p.x1-x,y0:p.y0-y,y1:p.y1-y}));
  }}];
}

test("factura escaneada: el número del albarán de la tabla no se acepta aunque todas las relecturas de su casilla lo lean igual",async()=>{
 const pag=[...cabeceraDoc(),...fila(100,["FACTURA",300,95,{ancho:60}]),...fila(160,["2600111-F",420,95,{ancho:50}]),
  ...fila(200,["ALBARAN",60],["DESCRIPCION",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]),
  ...fila(212,["2600222",60],["PIEZA",120],["FICTICIA",150],["1",420],["11,386",462],["11,39",560]),
  ...fila(700,["BASE",60],["IMPONIBLE",90],["11,39",560])];
 const r=await extraerEscaneado(motor(pag,"2600222"),{registro:registroCon(),hoy:HOY,numeroDeFactura:true,unSoloDocumento:true});
 assert.ok(!(r.numero.estado==="OK"&&r.numero.valor==="2600222"),JSON.stringify(r.numero));
 assert.notEqual(r.numero.resolucion?.metodo,"relectura_dirigida");
});

test("título «FACTURA» suelto encima de «FACTURA 14.999 FECHA … CLIENTE 430000111»: el número es 14.999, nunca el código del cliente",()=>{
 const celda=(t,x,ancho)=>[t,x,95,{ancho}];
 const pag=[...cabeceraDoc(),...fila(100,celda("FACTURA",300,60)),
  ...fila(112,celda("FACTURA",60,40),celda("14.999",105,30),celda("FECHA.",150,30),celda("10/09/2026",185,50),celda("CLIENTE",255,35),
   celda("430000111",300,45),celda("N.I.F./C.I.F.",360,55),celda("ESB00000000",420,55))];
 const r=extraerDePaginas([pagina(pag)],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
 assert.equal(r.numero.valor,"14.999",JSON.stringify(r.numero));
 assert.equal(r.numero.estado,"OK");
});

const leerFactura=palabras=>extraerDePaginas([pagina([...cabeceraDoc(),...palabras])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});
const celda=(t,x,ancho)=>[t,x,95,{ancho}];

test("número partido en dos casillas («NUM. FACTURA | 115 | 4999 | FECHA …»): no se acepta solo la primera parte",()=>{
 const r=leerFactura(fila(100,celda("NUM.",60,22),celda("FACTURA",85,40),celda("115",130,16),celda("4999",156,22),celda("FECHA:",200,30),celda("29/06/2026",235,50)));
 assert.ok(!(r.numero.estado==="OK"&&r.numero.valor==="115"),JSON.stringify(r.numero));
 assert.match(r.numero.motivos.join(" "),/Número partido/);
});

test("una fecha con el mes en letra («26-feb-2026» bajo «Factura») nunca es el número de la factura",()=>{
 const r=leerFactura([...fila(100,celda("TIPO",300,20),celda("DE",325,12),celda("DOCUMENTO",340,50),celda("Factura",400,35)),
  ...fila(112,celda("FECHA",300,30),celda("26-feb-2026",400,50))]);
 assert.notEqual(r.numero.valor,"26-feb-2026",JSON.stringify(r.numero));
});

test("letra O junto a cifras («HO12/26», por «H012/26»): el número queda en revisión",()=>{
 const r=leerFactura(fila(100,celda("Nº FACTURA",60,50),celda("HO12/26",120,40),celda("FECHA",200,30),celda("15/03/2026",235,50)));
 assert.equal(r.numero.valor,"HO12/26");
 assert.notEqual(r.numero.estado,"OK");
 assert.match(r.numero.motivos.join(" "),/puede ser un cero/);
 const bien=leerFactura(fila(100,celda("Nº FACTURA",60,50),celda("H012/26",120,40),celda("FECHA",200,30),celda("15/03/2026",235,50)));
 assert.equal(bien.numero.valor,"H012/26");assert.equal(bien.numero.estado,"OK");
});

test("factura escaneada: la fecha del vencimiento («Vto: 15-07-26») no se acepta como fecha de la factura aunque las relecturas la lean igual",async()=>{
 const pag=[...cabeceraDoc(),...fila(100,["FACTURA",300,95,{ancho:60}]),...fila(112,["Nº",60],["FACTURA",80],["F-1234",140]),
  ...fila(200,["CÓDIGO",60],["DESCRIPCIÓN",120],["CANTIDAD",400],["PRECIO",460],["IMPORTE",545]),
  ...fila(212,["A1",60],["PIEZA",120],["FICTICIA",150],["1",420],["10,000",462],["10,00",560]),
  ...fila(650,["DIAS",60],["F.FRA.",90]),...fila(662,["Vto:",60],["15-07-26",85],["12,10",160]),
  ...fila(700,["BASE",60],["IMPONIBLE",90],["10,00",560])];
 const r=await extraerEscaneado(motor(pag,"15-07-26"),{registro:registroCon(),hoy:HOY,numeroDeFactura:true,unSoloDocumento:true});
 assert.ok(!(r.fecha.estado==="OK"&&r.fecha.valor==="2026-07-15"),JSON.stringify(r.fecha));
});
