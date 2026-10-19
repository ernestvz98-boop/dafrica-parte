"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const N=require("../albaranes/normalizar.js");
const NIF=require("../albaranes/nif.js");

test("números en formato español conservan el literal",()=>{
 const casos=[["1.234,56",1234.56],["8,00",8],["1,0000",1],["0,0300",0.03],["12",12],["12,50-",-12.5],["-3,5",-3.5],["(4,00)",-4],["520,0000 €",520]];
 for(const [literal,valor] of casos){
  const r=N.numero(literal,{formatoConfirmado:true});
  assert.equal(r.estado,"OK",literal);assert.equal(r.valor,valor,literal);assert.equal(r.literal,literal);
 }
});

test("«1.000» es ambiguo si el formato no está demostrado, y nunca se rellena",()=>{
 const r=N.numero("1.000");
 assert.equal(r.estado,"AMBIGUO");assert.equal(r.valor,null);
 assert.equal(r.valor_propuesto,1000);assert.equal(r.valor_alternativo,1);
 assert.equal(N.numero("1.000",{formatoConfirmado:true}).valor,1000);
 assert.equal(N.numero("1.000",{formato:"en",formatoConfirmado:true}).valor,1);
});

test("separadores incorrectos no se convierten",()=>{
 assert.equal(N.numero("12.5").estado,"AMBIGUO");
 assert.equal(N.numero("12.5").valor,null);
 for(const x of ["1.23.4","1,2,3","abc","12a","1.2345,00"])assert.equal(N.numero(x).estado,"INVALIDO",x);
 assert.equal(N.numero("").estado,"VACIO");assert.equal(N.numero("   ").valor,null);
});

test("formato inglés",()=>{
 const r=N.numero("1,234.56",{formato:"en",formatoConfirmado:true});
 assert.equal(r.valor,1234.56);
});

test("descuentos simples, en cascada, vacíos e inválidos",()=>{
 const c=N.descuento("20+5");
 assert.deepEqual(c.porcentajes,[20,5]);assert.equal(c.valor,24);assert.ok(Math.abs(c.factor-0.76)<1e-12);
 assert.deepEqual(N.descuento("20%").porcentajes,[20]);
 assert.deepEqual(N.descuento("12,50").porcentajes,[12.5]);
 for(const x of ["","-","NETO"]){const r=N.descuento(x);assert.equal(r.estado,"VACIO",x);assert.equal(r.factor,1);}
 for(const x of ["120","20+x","+5"])assert.equal(N.descuento(x).estado,"INVALIDO",x);
});

test("fechas españolas: día/mes/año y textos",()=>{
 const casos=[["15/10/2026","2026-10-15"],["15-10-26","2026-10-15"],["15.10.2026","2026-10-15"],["2026-10-15","2026-10-15"],
  ["16 de octubre de 2026","2026-10-16"],["15-oct-26","2026-10-15"],["1/2/2026","2026-02-01"],["29/02/2028","2028-02-29"]];
 for(const [l,v] of casos){const r=N.fecha(l);assert.equal(r.estado,"OK",l);assert.equal(r.valor,v,l);}
 assert.equal(N.fecha("03/04/2026",{orden:"MDY"}).valor,"2026-03-04");
 for(const x of ["31/02/2026","13/13/2026","29/02/2027","hoy","15/10"])assert.equal(N.fecha(x).estado,"INVALIDO",x);
 assert.ok(N.fecha("15-10-26").notas.some(n=>/dos cifras/.test(n)));
});

test("el formato numérico se deduce de las cifras del documento",()=>{
 assert.deepEqual(N.deducirFormato(["8,00","1.500,00"]).formato,"es");
 assert.equal(N.deducirFormato(["8,00"]).confirmado,true);
 assert.equal(N.deducirFormato(["1.000","5"]).confirmado,false);
 assert.equal(N.deducirFormato(["8,00","3.50"]).conflicto,true);
});

test("NIF, NIE y CIF con control válido",()=>{
 for(const v of ["12345678Z","X1234567L","B24123457","A24777773","B-24.123.457","ES B24123457"])
  assert.equal(NIF.validar(v).valido,true,v);
 for(const v of ["12345678A","X1234567A","B24123456","A2477777C","B2412345"])
  assert.equal(NIF.validar(v).valido,false,v);
 const hallados=NIF.buscar("SUMINISTROS · CIF: B-24.123.457 · Tel 987000000 · NIF 12345678Z · falso B24123456");
 assert.deepEqual(hallados.map(h=>h.nif),["B24123457","12345678Z"]);
});
