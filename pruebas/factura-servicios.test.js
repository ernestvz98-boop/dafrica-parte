"use strict";
/*
 * Factura de servicios (2026-11-24; factura real escaneada de una gestoría): «FECHA | DESCRIPCION | CARGOS | ABONOS» sin cantidad ni
 * precio, y un cuadro «GASTOS | HONORARIOS | % | I.V.A. | TOTAL FACTURA» con los suplidos fuera de la base. Usuario: «cantidad 1».
 * Palabras de OCR construidas a mano, 72 ppp; proveedor, NIF e importes FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {extraerDePaginas}=require("../albaranes/extraer.js");
const {HOY,registroCon,fila,cabeceraDoc,pagina}=require("./ayudas-ocr.js");

const etiquetas=()=>[...fila(120,["FACTURA",60],["Nº",105],["9/1234",120]),...fila(120,["FECHA",300],["17/11/26",340])];
const tabla=()=>fila(200,["FECHA",40],["DESCRIPCION",112],["CARGOS",441],["ABONOS",505]);
const conceptos=(a="10,00",b="20,00",c="30,00")=>[
 ...fila(222,["12/11/26",40],["SUPLIDOS",93],["TASA",140],["FICTICIA.",165],[a,450]),
 ...fila(234,["13/11/26",40],["SUPLIDOS",93],["TRAMITE",140],["FICTICIO",180],[b,447]),
 ...fila(246,["DOCUMENTACION",93],["FICTICIA.",165]),
 ...fila(258,["17/11/26",40],["HONORARIOS",93],["Y",150],["GESTIONES",158],[c,447])];
const cuadro=(gastos="30,00",honorarios="30,00",pct="21",iva="6,30",total="66,30")=>[
 ...fila(550,["GASTOS",75],["HONORARIOS",153],["%",242],["I.V.A.",284],["TOTAL FACTURA",345,95,{ancho:60}],["PROV.FONDOS",454]),
 ...fila(564,[gastos,80],[honorarios,168],[pct,240],[iva,287],[total,368])];
const leer=palabras=>extraerDePaginas([pagina([...cabeceraDoc(),...etiquetas(),...palabras])],{registro:registroCon(),hoy:HOY,numeroDeFactura:true});

test("conceptos sin cantidad: cantidad 1 y precio = importe; con los totales cuadrados, verificados y con su IVA (suplidos sin IVA)",()=>{
 const r=leer([...tabla(),...conceptos(),...cuadro()]);
 assert.equal(r.totales.validacion.estado,"OK");
 assert.deepEqual([r.totales.base_imponible.valor,r.totales.exento.valor,r.totales.iva_porcentaje.valor,r.totales.cuota_iva.valor,r.totales.total.valor],[30,30,21,6.3,66.3]);
 assert.equal(r.lineas.length,3);
 assert.deepEqual(r.lineas.map(l=>[l.cantidad.valor,l.precio.valor,l.importe.valor,l.cantidad.estado,l.importe.estado,l.iva.valor]),
  [[1,10,10,"VERIFICADO","VERIFICADO",0],[1,20,20,"VERIFICADO","VERIFICADO",0],[1,30,30,"VERIFICADO","VERIFICADO",21]]);
 assert.ok(r.lineas.every(l=>l.servicio&&l.cantidad.confianza>=0.9&&l.importe.confianza>=0.9));
 assert.match(r.lineas[1].descripcion.valor,/SUPLIDOS TRAMITE FICTICIO DOCUMENTACION FICTICIA\./);
});
test("sin cuadrar con los totales (o sin totales), la cantidad 1 y el precio quedan en revisión y sin IVA por concepto",()=>{
 // Los suplidos impresos (30,00) no son la suma de los conceptos suplidos (10,00 + 25,00).
 const mal=leer([...tabla(),...conceptos("10,00","25,00"),...cuadro()]);
 assert.equal(mal.lineas.length,3);
 for(const l of mal.lineas){assert.equal(l.cantidad.estado,"REVISAR");assert.equal(l.precio.estado,"REVISAR");assert.ok(!(l.cantidad.confianza>=0.9));assert.equal(l.iva,undefined);}
 assert.notEqual(mal.estado,"AUTO_OK");
 const sinTotales=leer([...tabla(),...conceptos()]);
 assert.ok(sinTotales.lineas.every(l=>l.cantidad.estado==="REVISAR"&&l.iva===undefined));
});
test("la fila de títulos del cuadro dentro de la tabla no es un concepto; «A INGRESAR» vale como total si cuadra",()=>{
 const r=leer([...tabla(),...conceptos(),...cuadro("30,00","30,00","21","6,30","86,30"),...fila(600,["A",470],["INGRESAR",480]),...fila(612,["66,30",478])]);
 assert.equal(r.lineas.length,3);
 assert.equal(r.totales.total.valor,66.3);
 assert.equal(r.totales.validacion.estado,"OK");
 assert.ok(r.lineas.every(l=>l.importe.estado==="VERIFICADO"));
});
test("«CARGOS» con columna de cantidad es una tabla de albarán como siempre (sin conceptos de servicios)",()=>{
 const r=leer([...fila(200,["CODIGO",60],["DESCRIPCION",120],["CANTIDAD",330],["PRECIO",390],["CARGOS",500]),
  ...fila(222,["4300099900",60],["CODO",120],["2,00",340],["10,00",392],["20,00",505])]);
 assert.equal(r.lineas.length,1);
 assert.ok(!r.lineas[0].servicio);
 assert.deepEqual([r.lineas[0].cantidad.valor,r.lineas[0].precio.valor,r.lineas[0].importe.valor,r.lineas[0].cuadre.estado],[2,10,20,"VERIFICADO"]);
});
