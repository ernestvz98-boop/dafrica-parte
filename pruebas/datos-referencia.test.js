"use strict";
// Importación de listas de obras y tarifas (datos ficticios): nunca se toman precios.
const test=require("node:test"),assert=require("node:assert/strict");
const D=require("../albaranes/datos-referencia.js");

test("CSV con «;», comillas y cabecera tras unas líneas de título",()=>{
 const t='Listado de proyectos\n\nCódigo;Nombre;Presupuesto\nPRY 12345;"ALAMEDA; FICTICIA";1000\npry-12346;PISCINA FICTICIA;5\nXX;SIN CODIGO;1\n';
 const f=D.parseCsv(t);
 const r=D.filasObras(f);
 assert.deepEqual(r.filas,[{codigo:"PRY12345",nombre:"ALAMEDA; FICTICIA"},{codigo:"PRY12346",nombre:"PISCINA FICTICIA"}]);
 assert.equal(r.descartadas,1);
});
test("obras: un código con dos nombres distintos no se importa",()=>{
 const r=D.filasObras([["Código","Nombre"],["PRY12345","OBRA A"],["PRY12345","OBRA B"],["PRY12346","OBRA C"]]);
 assert.deepEqual(r.filas.map(x=>x.codigo),["PRY12346"]);assert.equal(r.repetidas,1);
});
test("tarifa: solo código y descripción; la columna de precio nunca se toma",()=>{
 const r=D.filasTarifa([["Referencia","Descripción","PVP","Dto"],["AB-0123","TUBO FICTICIO 20MM","9,99","30"],["","SIN CODIGO","1","0"]],"perfil:FICTICIO");
 assert.deepEqual(r.filas,[{proveedor_clave:"perfil:FICTICIO",referencia:"AB-0123",descripcion:"TUBO FICTICIO 20MM",origen:"tarifa"}]);
 assert.ok(!JSON.stringify(r).includes("9,99"));
 // Si la única columna «código» es la de precio, no hay columnas reconocidas.
 assert.ok(D.filasTarifa([["Precio","Descripción"],["1","X"]],"perfil:X").error);
});

test("obras: también códigos PRYMP, tal cual (nunca se convierten en otro PRY)",()=>{
 const r=D.filasObras([["Código","Nombre"],["PRYMP0012","MANTENIMIENTO FICTICIO"],["prymp 0013","OTRO FICTICIO"],["PRYM0012","MAL"],["PRY12345","OBRA FICTICIA"]]);
 assert.deepEqual(r.filas,[{codigo:"PRYMP0012",nombre:"MANTENIMIENTO FICTICIO"},{codigo:"PRYMP0013",nombre:"OTRO FICTICIO"},{codigo:"PRY12345",nombre:"OBRA FICTICIA"}]);
 assert.equal(r.descartadas,1);
});
