"use strict";
/*
 * Pie de un albarán escaneado con «I.V.A.» mal leído (mejora diaria 2026-11-27, ferretería del lote del 25/11: la persona tuvo que
 * escribir el total a mano). Fila «Suma Total | Base Imponible | I.V.A. | Importe I.V.A. | Total General» y debajo «base | base | 21 |
 * cuota | total»; el OCR leyó «LV.A.» (la columna del %) e «Importe .V.A.» (sin la I). El 21 se tomaba como cuota y la cuota impresa
 * no se miraba: «Base + IVA no coincide con el total impreso» y el total a revisión. Datos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");
const leer=palabras=>extraerDePaginas([pagina([...cabeceraDoc(),...palabras])],{registro:registroCon(),hoy:HOY});
const celda=(t,x,ancho)=>[t,x,95,{ancho}];
const tot=r=>Object.fromEntries(["base_imponible","iva_porcentaje","cuota_iva","total"].map(k=>[k,[r.totales[k].valor,r.totales[k].estado]]));
const pie=(iva,importeIva)=>[...fila(673,celda("Suma Total",233,40),celda("Base Imponible",307,55),celda(iva,382,16),celda(importeIva,438,50),celda("Total General",508,45)),
 ...fila(693,celda("40,00",255,17),celda("40,00",341,22),celda("21",390,8),celda("8,40",466,17),celda("48,40",528,22))];

test("«LV.A.» es la columna del % y «Importe .V.A.» la cuota: base, %, cuota y total verificados",()=>{
 assert.deepEqual(tot(leer(pie("LV.A.","Importe .V.A."))),{base_imponible:[40,"VERIFICADO"],iva_porcentaje:[21,"VERIFICADO"],
  cuota_iva:[8.4,"VERIFICADO"],total:[48.4,"VERIFICADO"]});
});

test("bien leído («I.V.A.» e «Importe I.V.A.») da lo mismo",()=>{
 assert.deepEqual(tot(leer(pie("I.V.A.","Importe I.V.A."))),{base_imponible:[40,"VERIFICADO"],iva_porcentaje:[21,"VERIFICADO"],
  cuota_iva:[8.4,"VERIFICADO"],total:[48.4,"VERIFICADO"]});
});

test("un total leído con un decimal perdido («48,4» de «48,41») nunca se da por bueno aunque cuadre por el redondeo",()=>{
 // Base 40,00 + cuota 8,40 = 48,40; el papel dice 48,41 (redondeo por líneas) y el OCR lee «48,4»: 48,40 no se acepta.
 const r=leer([...fila(673,celda("Suma Total",233,40),celda("Base Imponible",307,55),celda("LV.A.",382,16),celda("Importe 1.V.A.",438,50),celda("Total General",508,45)),
  ...fila(693,celda("40,00",255,17),celda("40,00",341,22),celda("21",390,8),celda("8,40",466,17),celda("48,4",528,22))]);
 assert.notEqual(r.totales.total.estado,"VERIFICADO");assert.notEqual(r.totales.total.estado,"OK");
});

test("un total impreso que no cuadra sigue a revisión aunque las etiquetas estén mal leídas",()=>{
 const malo=[...fila(673,celda("Suma Total",233,40),celda("Base Imponible",307,55),celda("LV.A.",382,16),celda("Importe .V.A.",438,50),celda("Total General",508,45)),
  ...fila(693,celda("40,00",255,17),celda("40,00",341,22),celda("21",390,8),celda("8,40",466,17),celda("49,40",528,22))];
 assert.notEqual(leer(malo).totales.total.estado,"VERIFICADO");
});
