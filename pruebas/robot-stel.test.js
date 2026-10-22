"use strict";
// Robot de STEL Order: la guardia de solo lectura (sin red; URLs ficticias).
const test=require("node:test"),assert=require("node:assert/strict");
const {permitido,rutaSinDatos}=require("../robot-stel/guardia.js");

test("lectura: solo GET, HEAD y OPTIONS; cualquier escritura se cancela",()=>{
 for(const m of ["GET","HEAD","OPTIONS","get"])assert.equal(permitido(m,"https://app.stelorder.com/app/x"),true);
 for(const m of ["POST","PUT","PATCH","DELETE"])assert.equal(permitido(m,"https://app.stelorder.com/app/purchaseDeliveryNotes/1"),false);
 // Ni siquiera un POST de inicio de sesión fuera de la fase de entrada.
 assert.equal(permitido("POST","https://app.stelorder.com/app/login","lectura"),false);
});
test("entrada: solo un POST de inicio de sesión a STEL por https",()=>{
 assert.equal(permitido("POST","https://app.stelorder.com/app/login","entrada"),true);
 assert.equal(permitido("POST","https://app.stelorder.com/api/auth/token","entrada"),true);
 assert.equal(permitido("POST","https://app.stelorder.com/app/purchaseDeliveryNotes","entrada"),false);
 assert.equal(permitido("POST","https://otro.example.invalid/login","entrada"),false);
 assert.equal(permitido("POST","http://app.stelorder.com/app/login","entrada"),false);
 assert.equal(permitido("PUT","https://app.stelorder.com/app/login","entrada"),false);
 assert.equal(permitido("POST","https://app.stelorder.com.example.invalid/login","entrada"),false);
});
test("el informe guarda la ruta sin datos",()=>{
 assert.equal(rutaSinDatos("https://app.stelorder.com/app/projects/123456?x=1"),"app.stelorder.com/app/projects/:id");
});
