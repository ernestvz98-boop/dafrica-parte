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

test("verbos de consulta por los dos canales; nunca con palabra de escritura; «cargar» no",()=>{
 const g=require("../robot-stel/guardia.js");
 for(const U of ["https://app.stelorder.com/app/ControladorMultiempresa","https://app.stelorder.com/app/FrontController"]){
  for(const op of ["obtenerParametrosConfiguracion","listarProyectos","buscarAlbaranesCompra","consultarDocumento","getProjects"])assert.equal(g.permitido("POST",U,"lectura","operacion="+op),true,op);
  for(const op of ["obtenerYGuardarDocumento","listarParaEliminar","cargarFichero","obtenerx","verificarYModificar","guardarProyecto","set"])assert.equal(g.permitido("POST",U,"lectura","operacion="+op),false,op);
 }
 assert.equal(g.permitido("POST","https://app.stelorder.com/app/OtroControlador","lectura","operacion=obtenerTodo"),false);
});

test("tablas paginadas: la operación en la dirección pasa por las mismas reglas",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/FrontController?operacion=";
 assert.equal(g.permitido("POST",U+"listarProyectosPaginado","lectura","sEcho=1&iDisplayStart=0"),true);
 assert.equal(g.permitido("POST",U+"eliminarProyecto","lectura","sEcho=1"),false);
 assert.equal(g.permitido("POST","https://app.stelorder.com/app/FrontController","lectura","sEcho=1"),false);
});

test("bloquear documentos no pasa; ListarProyectos sí (lista cerrada)",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/FrontController";
 assert.equal(g.permitido("POST",U,"lectura","operacion=ListarProyectos"),true);
 for(const op of ["obtenerYBloquearDocumento","bloquearDocumento","desbloquearDocumento"])assert.equal(g.permitido("POST",U,"lectura","operacion="+op),false,op);
});

test("ListarTipoUnidadFeMEX (lista de tipos de unidad del formulario de producto) pasa; su parecido de escritura no",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/FrontController";
 assert.equal(g.permitido("POST",U,"lectura","operacion=ListarTipoUnidadFeMEX"),true);
 for(const op of ["GuardarTipoUnidadFeMEX","ListarTipoUnidadFeMEXyGuardar","crearTipoUnidad"])assert.equal(g.permitido("POST",U,"lectura","operacion="+op),false,op);
});

test("isDocumentoComercialCerrado (¿está cerrado el pedido?) pasa; cerrar o abrir documentos no",()=>{
 const g=require("../robot-stel/guardia.js"),U="https://app.stelorder.com/app/FrontController";
 assert.equal(g.permitido("POST",U,"lectura","operacion=isDocumentoComercialCerrado&idDocumentoComercial=1"),true);
 for(const op of ["cerrarDocumentoComercial","isDocumentoComercialCerradoYGuardar","generarAlbaranDesdePedido"])assert.equal(g.permitido("POST",U,"lectura","operacion="+op),false,op);
});

test("guardia: un GET/HEAD a STEL con una operación de escritura se cancela (fallo real 2026-10-27)", ()=>{
 const G=require("../robot-stel/guardia.js");
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FrontController?operacion=guardarDocumentoComercial&id="),false);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/guardarAlbaran.do?x=1"),false);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FrontController"),false,"canal sin operación de lectura");
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FileUploadServlet"),false);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/stelorder/lib/altas/nuevoCalendario.js"),true,"ficheros de la web");
 assert.equal(G.permitido("HEAD","https://app.stelorder.com/app/FrontController?operacion=eliminarDocumentosComerciales"),false);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FrontController?operacion=listarProyectosPaginado"),true);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/js/principal.js"),true);
 assert.equal(G.permitido("GET","https://otra.example.com/guardar.js"),true);
});

test("guardia: una petición cancelada hacia STEL recibe un 204 local (STEL no la reenvía); fuera de STEL, abort", async()=>{
 const G=require("../robot-stel/guardia.js");const hechos=[];
 const ruta=url=>({request:()=>({url:()=>url}),fulfill:o=>hechos.push(["fulfill",o.status]),abort:()=>hechos.push(["abort"])});
 await G.cancelar(ruta("https://app.stelorder.com/app/FrontController"));
 await G.cancelar(ruta("https://www.google.com/x"));
 assert.deepEqual(hechos,[["fulfill",204],["abort"]]);
});

test("guardia: lecturas de STEL con mayúscula inicial pasan; escrituras con mayúscula no", ()=>{
 const G=require("../robot-stel/guardia.js");
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FrontController?operacion=ListarClientesPredictivo&q=x"),true);
 assert.equal(G.permitido("POST","https://app.stelorder.com/app/FrontController","lectura","operacion=ListarObjetosCatalogo"),true);
 assert.equal(G.permitido("GET","https://app.stelorder.com/app/FrontController?operacion=GuardarCliente"),false);
 assert.equal(G.permitido("POST","https://app.stelorder.com/app/FrontController","lectura","operacion=ListarYGuardar"),false);
});
