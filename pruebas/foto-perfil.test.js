"use strict";
/*
 * Regresión: foto real de un albarán (2026-11-23) leída con el lector unificado (web + aplicación de administración). Dos mejoras
 * del lector, pensadas para escaneos, estropeaban la foto (10 filas en vez de 7 y 3 cuadradas en vez de 7):
 *  - las columnas del perfil del proveedor (posiciones de un escaneo A4) se usaban aunque los títulos leídos dijeran otra cosa,
 *    y una cabecera sacada del perfil impedía probar los títulos leídos en otra lectura;
 *  - «misma fila física» comparaba la altura de casillas distintas (el código de una lectura con la cantidad de otra): en una
 *    foto inclinada, las cifras de la derecha quedan más altas que el código de la izquierda.
 * Todos los códigos, importes y posiciones son inventados.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {HOY,registroCon,fila,cabeceraDoc,leer}=require("./ayudas-ocr.js");
const {extraerEscaneado,combinarLineas}=require("../albaranes/escaneado.js");

const COLUMNAS=[["referencia",55,110],["descripcion",111,395],["cantidad",396,445],["precio",446,500],["descuento",501,540],["importe",541,595]];
const reg=()=>registroCon({columnas:COLUMNAS,formato_referencia:"^\\d{10}$"});
const etiquetas=()=>[...fila(120,["ALBARÁN",60],["Nº",105],["600.111",120]),...fila(120,["FECHA",300],["15/10/26",340])];
// La tabla de una foto: el papel no ocupa las posiciones de un escaneo (todo unos 60 puntos más a la izquierda).
const filaFoto=(y,ref)=>fila(y,[ref,30],["TUBO",80],["MULTICAPA",110],["2,00",345],["10,000",392],["50",440],["10,00",480]);
const titulosFoto=()=>fila(200,["CÓDIGO",30],["CONCEPTO",80],["CANTIDAD",330],["PRECIO",390]);

test("columnas del perfil: se usan si los títulos leídos casan con ellas; si los contradicen (foto), no",()=>{
 // Títulos sin IMPORTE (perdido por el OCR) en las posiciones de un escaneo: valen las del perfil, y la cabecera queda marcada.
 const escaneo=leer([...cabeceraDoc(),...etiquetas(),...fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460]),
  ...fila(218,["1300000001",60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560])],{registro:reg()});
 assert.equal(escaneo.tablas[0].cabecera_perfil,true);
 // Los mismos títulos en la foto: CANTIDAD lejos de su columna del perfil. Se lee igual que sin columnas en el perfil.
 const palabras=[...cabeceraDoc(),...etiquetas(),...titulosFoto(),...filaFoto(218,"1300000001")];
 const foto=leer(palabras,{registro:reg()}),sinPerfil=leer(palabras,{registro:registroCon({formato_referencia:"^\\d{10}$"})});
 assert.ok(!foto.tablas[0]?.cabecera_perfil);
 const valores=r=>r.lineas.map(l=>["referencia","descripcion","cantidad","precio","importe"].map(k=>[l[k]?.valor,l[k]?.estado]));
 assert.deepEqual(valores(foto),valores(sinPerfil));
});

test("lectura sin títulos con la cabecera del perfil: también se prueba con los títulos leídos en otra lectura",async()=>{
 const filaPrecio=(y,ref)=>fila(y,[ref,60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,000",462],["50",510],["10,00",560]);
 const cuerpo=[...cabeceraDoc(),...etiquetas(),...filaPrecio(218,"1300000001"),...filaPrecio(232,"1300000002")];
 const titulos=()=>fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]);
 // Solo la lectura psm 4 ve los títulos; las demás los pierden y sacan la cabecera de las posiciones del perfil.
 const motor=[{numero:1,anchoPx:595,altoPx:842,dpi:72,
  async ocr({psm,region=null}={}){
   if(region)return [];
   return psm===4?[...cuerpo,...titulos()]:cuerpo;
  }}];
 const r=await extraerEscaneado(motor,{registro:reg(),hoy:HOY});
 assert.ok(r.lecturas_ocr.some(x=>/\+cabecera_pagina_psm4$/.test(x.lectura)),r.lecturas_ocr.map(x=>x.lectura).join(", "));
});

const C=(literal,valor,caja)=>({literal,valor,estado:"OK",confianza:0.95,caja});
const V=()=>({literal:"",valor:null,estado:"VACIO",confianza:0});
const sinCifras=yRef=>({fila:1,pagina:1,estado:"REVISAR",motivos:["Cantidad: celda vacía"],cuadre:{estado:"SIN_PRECIOS"},
 referencia:C("1300000001","1300000001",[60,yRef,105,4.8]),descripcion:C("TUBO FICTICIO","TUBO FICTICIO",[114,yRef,200,4.8]),
 cantidad:V(),precio:V(),descuento:V(),importe:V(),subtotal:V()});
const conCifras=(yRef,yCifras)=>({fila:1,pagina:1,estado:"OK",motivos:[],cuadre:{estado:"VERIFICADO",detalle:"1 × 10,000 = 10,00"},
 referencia:C("1300000001","1300000001",[60,yRef,105,4.8]),descripcion:C("TUBO FICTICIO","TUBO FICTICIO",[114,yRef,200,4.8]),
 cantidad:C("1,00",1,[395,yCifras,407,5.3]),precio:C("10,000",10,[430,yCifras,451,5.5]),descuento:V(),importe:C("10,00",10,[516,yCifras,533,5.5]),subtotal:V()});

test("cifras de otra lectura: misma fila física comparando la MISMA casilla (foto inclinada)",()=>{
 // Las cifras 3 puntos más arriba que el código de su fila: es la misma fila (su código está a la misma altura).
 const p={lineas:[sinCifras(119.4)]};
 combinarLineas(p,[p,{lineas:[conCifras(119.4,116.4)]}]);
 assert.equal(p.lineas[0].cuadre.estado,"VERIFICADO");
 assert.equal(p.lineas[0].importe.valor,10);
 // El mismo código una fila más abajo, con sus cifras a la altura del código de esta: es otra fila, no se toman.
 const q={lineas:[sinCifras(119.4)]};
 combinarLineas(q,[q,{lineas:[conCifras(131,119.4)]}]);
 assert.equal(q.lineas[0].cuadre.estado,"SIN_PRECIOS");
 assert.equal(q.lineas[0].importe.valor,null);
});
