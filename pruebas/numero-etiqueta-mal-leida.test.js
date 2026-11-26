"use strict";
/*
 * Número de albarán bajo un título «ALBARÁN» con una letra mal leída (fallo real 2026-11-26: un albarán de mostrador con la casilla
 * «CLIENTE | ALBARÁN | FECHA» al pie, el OCR leyó «SLBARÁN» y el número salía del código postal del cliente, bajo «NO UTILIZAR»).
 * Solo con el formato de número del proveedor y un único valor con ese formato debajo. Datos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {fila,cabeceraDoc,leer,registroCon}=require("./ayudas-ocr.js");
const registro=registroCon({formato_numero:"^\\d{3}\\.\\d{3}$"});
const pie=(titulo,valores=[["111222",40],["123.456",125],["16/10/26",225]])=>[
 ...fila(600,["CLIENTE",40],[titulo,115,30],["FECHA",195]),
 ...fila(612,...valores),
 ...fila(624,["NO",340],["UTILIZAR",355],["OBRA",400]),
 ...fila(636,["24999",340],["POBLACION",368])];

test("«SLBARÁN» (ALBARÁN mal leído) con el número del formato del proveedor debajo: aceptado, nunca el código postal",()=>{
 const r=leer([...cabeceraDoc(),...pie("SLBARÁN")],{registro});
 assert.equal(r.numero.valor,"123.456",JSON.stringify(r.numero));
 assert.equal(r.numero.estado,"OK");
 assert.ok(r.numero.notas.some(n=>/SLBARÁN/.test(n)));
});

test("sin formato del proveedor, o con dos valores con ese formato, no se acepta nada por esa vía",()=>{
 const sinFormato=leer([...cabeceraDoc(),...pie("SLBARÁN")]);
 assert.notEqual(sinFormato.numero.estado==="OK"&&sinFormato.numero.valor==="123.456",true,JSON.stringify(sinFormato.numero));
 // Dos valores con el formato bajo la etiqueta (renglones seguidos): no se sabe cuál es.
 const dos=leer([...cabeceraDoc(),...pie("SLBARÁN"),...fila(618,["654.321",125])],{registro});
 assert.notEqual(dos.numero.estado,"OK",JSON.stringify(dos.numero));
 // Una palabra que no se parece a «ALBARÁN» (dos letras cambiadas) no sirve de etiqueta.
 const otra=leer([...cabeceraDoc(),...pie("SLBERÁN")],{registro});
 assert.notEqual(otra.numero.estado,"OK",JSON.stringify(otra.numero));
});
