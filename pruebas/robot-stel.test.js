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

test("canal único de STEL: solo operaciones de la lista cerrada de lectura; nunca un nombre de escritura",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/ControladorMultiempresa";
 assert.equal(g.permitido("POST",U,"lectura","operacion=comprobarLogin&language=es"),true);
 for(const op of ["guardarAlbaran","crearProyecto","eliminarDocumento","modificarCliente","operacionDesconocida",""])
  assert.equal(g.permitido("POST",U,"lectura","operacion="+op),false,op);
 // Aunque alguien añadiera por error una operación de escritura a la lista, no pasa.
 g.OPERACIONES_LECTURA.add("guardarAlbaran");
 assert.equal(g.permitido("POST",U,"lectura","operacion=guardarAlbaran"),false);
 g.OPERACIONES_LECTURA.delete("guardarAlbaran");
 // Otro dominio u otra ruta: no.
 assert.equal(g.permitido("POST","https://otro.example.invalid/app/ControladorMultiempresa","lectura","operacion=comprobarLogin"),false);
});

test("plantillas de pantalla: solo id=<ruta>.html, sin más campos",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/Html";
 assert.equal(g.permitido("POST",U,"lectura","id=backend%2FpaginaLogin.html"),true);
 for(const c of ["id=backend%2Fx.html&operacion=guardar","id=..%2Fsecreto.html","id=x.php","",'datos=1'])assert.equal(g.permitido("POST",U,"lectura",c),false,c);
});

test("realizarLogin solo durante la entrada",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/ControladorMultiempresa";
 assert.equal(g.permitido("POST",U,"entrada","operacion=realizarLogin&x=1"),true);
 assert.equal(g.permitido("POST",U,"lectura","operacion=realizarLogin&x=1"),false);
});

test("código de verificación: solo en la entrada y nunca con nombre de escritura",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/ControladorMultiempresa";
 assert.equal(g.permitido("POST",U,"entrada","operacion=comprobarCodigoVerificacion"),true);
 assert.equal(g.permitido("POST",U,"lectura","operacion=comprobarCodigoVerificacion"),false);
 assert.equal(g.permitido("POST",U,"entrada","operacion=guardarCodigoVerificacion"),false);
});
