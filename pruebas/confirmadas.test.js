"use strict";
/*
 * Códigos de proveedor confirmados por una persona (albaranes/confirmadas.js). Datos FICTICIOS.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {aplicar,clave}=require("../albaranes/confirmadas.js");
const {finalizar}=require("../albaranes/extraer.js");
const {NIF,fila,cabeceraDoc,leer,registroCon}=require("./ayudas-ocr.js");

const doc=(ref="120OP001")=>leer([...cabeceraDoc(),...fila(120,["ALBARÁN",60],["009999",120],["FECHA",300],["15/10/2026",340]),
 ...fila(200,["CÓDIGO",60],["CONCEPTO",120],["CANTIDAD",400],["PRECIO",460],["DTO%",500],["IMPORTE",545]),
 ...fila(218,[ref,60],["TUBO",120],["MULTICAPA",150],["2,00",420],["10,00",462],["50",510],["10,00",560])],{registro:registroCon()});
const conf=(referencia,descripcion="TUBO MULTICAPA",prov="perfil:A")=>({proveedor_clave:prov,referencia,descripcion,confirmado_en:"2026-10-21T10:00:00Z"});

test("código con O/0 confirmado antes para este proveedor: se valida y deja de bloquear",()=>{
 const r=doc();
 assert.equal(clave(r.proveedor),"perfil:A");
 assert.ok(r.lineas[0].referencia.confianza<0.9,"precondición: el código con O/0 queda en revisión");
 assert.equal(aplicar(r,[conf("120OP001")]),1);finalizar(r);
 const c=r.lineas[0].referencia;
 assert.equal(c.valor,"120OP001");assert.equal(c.resolucion.metodo,"referencia_confirmada");assert.ok(c.confianza>=0.9);
});

test("lo leído difiere solo en O/0 del único código confirmado equivalente: se toma el confirmado",()=>{
 const r=doc("1200P001");
 assert.equal(aplicar(r,[conf("120OP001")]),1);
 assert.equal(r.lineas[0].referencia.valor,"120OP001");assert.equal(r.lineas[0].referencia.literal_ocr_original,"1200P001");
});

test("no se valida: otro proveedor, descripción distinta, dos confirmados equivalentes o sin descripción confirmada",()=>{
 assert.equal(aplicar(doc(),[conf("120OP001","TUBO MULTICAPA","perfil:OTRO")]),0);
 assert.equal(aplicar(doc(),[conf("120OP001","CODO LATON 22")]),0);
 assert.equal(aplicar(doc("1200P001"),[conf("120OP001"),conf("1200P001","TUBO MULTICAPA 2")]),0);
 assert.equal(aplicar(doc(),[{...conf("120OP001"),descripcion:null}]),0);
});
