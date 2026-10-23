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

test("tarifa: código único con descripción compatible se valida; dos códigos equivalentes O/0, no",()=>{
 const C=require("../albaranes/confirmadas.js");
 const det=()=>({proveedor:{estado:"OK",id:"FICTICIO"},lineas:[{referencia:{literal:"AB0123",valor:"AB0123",estado:"REVISAR",confianza:0.6},descripcion:{valor:"TUBO FICTICIO 20MM"}}]});
 const a=det();
 assert.equal(C.aplicar(a,[{proveedor_clave:"perfil:FICTICIO",referencia:"ABO123",descripcion:"TUBO FICTICIO 20MM",origen:"tarifa"}]),1);
 assert.equal(a.lineas[0].referencia.valor,"ABO123");assert.equal(a.lineas[0].referencia.resolucion.metodo,"referencia_tarifa");
 const b=det();
 assert.equal(C.aplicar(b,[{proveedor_clave:"perfil:FICTICIO",referencia:"ABO123",descripcion:"TUBO FICTICIO 20MM",origen:"tarifa"},
  {proveedor_clave:"perfil:FICTICIO",referencia:"AB0123",descripcion:"TUBO FICTICIO 20MM",origen:"tarifa"}]),0);
 // Descripción con otra medida: no.
 const c=det();
 assert.equal(C.aplicar(c,[{proveedor_clave:"perfil:FICTICIO",referencia:"ABO123",descripcion:"TUBO FICTICIO 25MM",origen:"tarifa"}]),0);
 assert.deepEqual(C.necesarias([{resultado:det()}]),{"perfil:FICTICIO":["A80123"]});
});

// Fallo real (2026-10-23): se confirmaron códigos con el principio de la descripción pegado, con un
// espacio en medio y un importe leído en la columna del código. No deben validar nada.
test("código confirmado sin forma de código (texto pegado, comillas, importe, formato del proveedor): no se usa",()=>{
 const {codigoValido}=require("../albaranes/confirmadas.js");
 const perfil={formato_referencia:"^\\d{3}[A-Z0-9]{10}$"};
 assert.equal(codigoValido("900X0Y1234567",perfil),true);
 assert.equal(codigoValido("900X0Y1234567 “ Tubo",perfil),false);
 assert.equal(codigoValido("900X0Y 1234567",perfil),false);
 assert.equal(codigoValido("1.234,5600"),false);assert.equal(codigoValido("12,50"),false);
 assert.equal(codigoValido("¨TUBO"),false);
 // Sin formato declarado, un código con espacios o barras sigue valiendo.
 assert.equal(codigoValido("CUT TUBO1/2 (5M)"),true);
 // Aplicar: lo inválido no valida ni cuenta como segundo candidato.
 const r=doc();assert.equal(aplicar(r,[conf("120OP001 “ TUBO")]),0);
 const s=doc();assert.equal(aplicar(s,[conf("1.200,0001")]),0);
 const t=doc();assert.equal(aplicar(t,[conf("120OP001"),conf("120OP001 ¨TUBO")]),1);assert.equal(t.lineas[0].referencia.valor,"120OP001");
});

// Fallo real (2026-10-23): un código en dos renglones se confirmó con un espacio en la unión, que puso
// el lector, cuando el papel lleva guion; la confirmación habría aceptado un código erróneo. Para esos
// códigos solo vale una confirmación posterior al aviso de la pantalla (lector27) o la tarifa.
test("código en dos renglones: no vale una confirmación anterior al aviso; sí una posterior o la tarifa",()=>{
 const det=()=>({proveedor:{estado:"OK",id:"FICTICIO"},lineas:[{referencia:{literal:"CUT TUBO1/2 (5M) (MARCA)",valor:"CUT TUBO1/2 (5M) (MARCA)",estado:"REVISAR",confianza:0.5,
  motivos:["Código en dos renglones: se ha unido el segundo («(MARCA)»)"]},descripcion:{valor:"TUBO FICTICIO 20MM"}}]});
 const c=(referencia,confirmado_en,origen="persona")=>({proveedor_clave:"perfil:FICTICIO",referencia,descripcion:"TUBO FICTICIO 20MM",origen,confirmado_en});
 const antes=c("CUT TUBO1/2 (5M) (MARCA)","2026-10-23T07:18:52.300049+00:00"),despues=c("CUT TUBO1/2 (5M)-(MARCA)","2026-10-24T10:00:00+00:00");
 assert.equal(aplicar(det(),[antes]),0);
 const a=det();assert.equal(aplicar(a,[despues]),1);assert.equal(a.lineas[0].referencia.valor,"CUT TUBO1/2 (5M)-(MARCA)");
 // La anterior no cuenta como segundo candidato: la posterior se aplica.
 const b=det();assert.equal(aplicar(b,[antes,despues]),1);assert.equal(b.lineas[0].referencia.valor,"CUT TUBO1/2 (5M)-(MARCA)");
 const t=det();assert.equal(aplicar(t,[c("CUT TUBO1/2 (5M)-(MARCA)",null,"tarifa")]),1);
 // Un código de un solo renglón confirmado antes del aviso sigue valiendo.
 const u=det();u.lineas[0].referencia={literal:"CUT9TUBO",valor:"CUT9TUBO",estado:"REVISAR",confianza:0.5,motivos:[]};
 assert.equal(aplicar(u,[c("CUT9TUBO","2026-10-21T10:00:00+00:00")]),1);
 // «?» (unión sin escribir) no es un código.
 const {codigoValido}=require("../albaranes/confirmadas.js");assert.equal(codigoValido("CUT TUBO1/2 (5M)?(MARCA)"),false);
});
