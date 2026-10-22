"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {atacar,catalogoFicticio}=require("./prueba-fuerza-obras.js");

test("prueba de fuerza: ninguna lectura falsa realista de un código de obra se acepta (catálogo denso con palabras comunes)",()=>{
 const t=atacar(catalogoFicticio(),{vias:["escrita"]});
 for(const [k,f] of Object.entries(t))assert.equal(f.falsas,0,k+": "+f.ejemplos.join(" | "));
 // No es una prueba vacía: las lecturas buenas se aceptan y la regla del nombre corrige lecturas a una cifra.
 assert.ok(t.control.buenas>t.control.pruebas/2,"control "+t.control.buenas+"/"+t.control.pruebas);
 assert.ok(t["una cifra"].buenas>0);
});
