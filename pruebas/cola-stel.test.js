"use strict";
// Orden para STEL de cada albarán leído (Fase 2). Datos ficticios.
const test=require("node:test"),assert=require("node:assert/strict");
const C=require("../albaranes/cola-stel.js");

const ok=(valor,extra={})=>({valor,literal:String(valor),estado:"OK",confianza:0.99,...extra});
function doc(cambios={}){
 const r={
  proveedor:{nombre:"SUMINISTROS FICTICIOS SL",estado:"OK",account_id:9001},
  numero:ok("123.456"),fecha:ok("2026-10-22"),
  manuscritos:{obra:ok("PRY09999")},
  lineas:[{pagina:1,referencia:ok("REF-001"),descripcion:ok("TUBO FICTICIO 20MM"),cantidad:ok(4),unidad:ok("UD"),
   precio:ok(2.5),descuento:{porcentajes:[10]},importe:ok(9)}],
  totales:{total:ok(10.89)},
  ...cambios.resultado};
 return {archivo:"ficticio.pdf",paginas:[1],estado_documento:"AUTO_OK",...cambios,resultado:r};
}
const catalogo={articulos_completo:true,obras_completo:true,proveedores:[{id:9001,nombre:"SUMINISTROS FICTICIOS, S.L."}],
 obras:[{id:555,codigo:"PRY09999",nombre:"OBRA FICTICIA"}],
 articulos:[{id:777,referencia:"REF-001",descripcion:"TUBO FICTICIO 20MM"},{id:778,referencia:"OTRA-9",descripcion:"CODO FICTICIO"}]};

test("albarán AUTO_OK con todo resuelto: pendiente de crear", ()=>{
 const o=C.orden(doc(),catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.clave,"9001|123456|2026-10-22");
 assert.equal(o.plan.fecha,"22/10/2026");
 assert.deepEqual(o.plan.obra,{codigo:"PRY09999",stel_id:555,nombre:"OBRA FICTICIA"});
 assert.equal(o.plan.proveedor.nombre_stel,"SUMINISTROS FICTICIOS, S.L.");
 assert.equal(o.plan.lineas[0].articulo.item_id,777);
 assert.deepEqual(o.plan.lineas[0].descuentos,[10]);
 assert.equal(o.plan.aviso_precio,null);
});

test("el lector no lo da por bueno: REVISAR, nunca automático", ()=>{
 const o=C.orden(doc({estado_documento:"REVISAR"}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.match(o.motivos.join(),/no lo da por bueno/);
});

test("sin obra validada o sin proyecto único en STEL: REVISAR", ()=>{
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:{valor:"PRY09999",estado:"REVISAR"}}}}),catalogo).estado,"REVISAR");
 const sinProyecto=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY01111")}}}),catalogo);
 assert.equal(sinProyecto.estado,"REVISAR");assert.match(sinProyecto.motivos.join(),/no encontrada/);
 const repetida=C.orden(doc(),{...catalogo,obras:[...catalogo.obras,{id:556,codigo:"PRY09999",nombre:"OTRA"}]});
 assert.equal(repetida.estado,"REVISAR");assert.match(repetida.motivos.join(),/repetida/);
});

test("proveedor sin cuenta de STEL verificada: REVISAR", ()=>{
 const o=C.orden(doc({resultado:{proveedor:{nombre:"X",estado:"REVISAR",account_id:null}}}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.equal(o.clave,null);
});

test("número o fecha sin confirmar: REVISAR", ()=>{
 assert.equal(C.orden(doc({resultado:{numero:{valor:"123.456",estado:"REVISAR",confianza:0.6}}}),catalogo).estado,"REVISAR");
 assert.equal(C.orden(doc({resultado:{fecha:{valor:"2026-10-22",estado:"OK",confianza:0.5}}}),catalogo).estado,"REVISAR");
});

test("sin precio y sin pedido: 0,00 con aviso PRECIO PENDIENTE (nunca un precio estimado)", ()=>{
 const d=doc();d.resultado.lineas[0].precio={valor:null,estado:"VACIO"};
 const o=C.orden(d,catalogo);
 assert.equal(o.estado,"PENDIENTE");
 assert.equal(o.plan.lineas[0].precio,null);assert.equal(o.plan.lineas[0].precio_pendiente,true);
 assert.equal(o.plan.aviso_precio,"PRECIO PENDIENTE");
});

test("sin precio con pedido validado: sin aviso (el robot toma el precio del pedido)", ()=>{
 const d=doc({resultado:{manuscritos:{obra:ok("PRY09999"),pedido:ok("PAP09001")}}});d.resultado.lineas[0].precio={valor:null,estado:"VACIO"};
 const o=C.orden(d,catalogo);
 assert.equal(o.estado,"PENDIENTE");assert.deepEqual(o.plan.pedido,{codigo:"PAP09001"});assert.equal(o.plan.aviso_precio,null);
});

test("pedido leído y sin validar: REVISAR", ()=>{
 const o=C.orden(doc({resultado:{manuscritos:{obra:ok("PRY09999"),pedido:{valor:"PAP09001",estado:"REVISAR"}}}}),catalogo);
 assert.equal(o.estado,"REVISAR");assert.match(o.motivos.join(),/PAP/);
});

test("artículo nuevo sin parecidos: se propone crearlo; con parecidos: REVISAR; con catálogo incompleto lo busca el robot", ()=>{
 const nuevo=doc();nuevo.resultado.lineas[0].referencia=ok("ZZ-12345");nuevo.resultado.lineas[0].descripcion=ok("VALVULA FICTICIA ESFERA");
 const o=C.orden(nuevo,catalogo);
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.lineas[0].articulo.estado,"crear");
 assert.equal(o.plan.lineas[0].articulo.propuesta.referencia,"ZZ-12345");
 const parecido=doc();parecido.resultado.lineas[0].referencia=ok("REF-0001");parecido.resultado.lineas[0].descripcion=ok("TUBO FICTICIO 20MM GRIS");
 const p=C.orden(parecido,catalogo);
 assert.equal(p.estado,"REVISAR");assert.equal(p.plan.lineas[0].articulo.estado,"revisar");
 assert.equal(C.orden(nuevo,{...catalogo,articulos_completo:false}).plan.lineas[0].articulo.estado,"buscar");
});

test("ya está en STEL (ABP encontrado por el lector): YA_EXISTE, no se crea otro", ()=>{
 const o=C.orden(doc({resultado:{albaran_stel:{estado:"OK",referencia:"ABP09999",id:42}}}),catalogo);
 assert.equal(o.estado,"YA_EXISTE");assert.equal(o.plan.ya_en_stel.id,42);
});

test("cantidad sin confirmar o sin líneas: REVISAR", ()=>{
 const d=doc();d.resultado.lineas[0].cantidad={valor:null,estado:"REVISAR"};
 assert.equal(C.orden(d,catalogo).estado,"REVISAR");
 assert.equal(C.orden(doc({resultado:{lineas:[]}}),catalogo).estado,"REVISAR");
});

test("fecha en formato de STEL", ()=>{
 assert.equal(C.fechaStel("2026-01-05"),"05/01/2026");assert.equal(C.fechaStel("5/1/2026"),null);
});

test("alta automática más estricta: una referencia a un carácter o con las mismas cifras de otra, o la misma descripción con palabras de más: REVISAR", ()=>{
 const con=(ref,desc)=>{const d=doc();d.resultado.lineas[0].referencia=ok(ref);d.resultado.lineas[0].descripcion=ok(desc);return C.orden(d,catalogo);};
 assert.equal(con("REF-0001","PIEZA DISTINTA DEL TODO").estado,"REVISAR");
 assert.equal(con("XREF001","PIEZA DISTINTA DEL TODO").estado,"REVISAR");
 const cifras={...catalogo,articulos:[...catalogo.articulos,{id:779,referencia:"AB12345",descripcion:"MANGUITO FICTICIO"}]};
 const d=doc();d.resultado.lineas[0].referencia=ok("12345");d.resultado.lineas[0].descripcion=ok("PIEZA DISTINTA DEL TODO");
 assert.equal(C.orden(d,cifras).estado,"REVISAR");
 assert.equal(con("ZZ-777","TUBO FICTICIO 20MM GRIS CLARO").estado,"REVISAR");
 assert.equal(con("ZZ-12345","VALVULA FICTICIA ESFERA").estado,"PENDIENTE");
});

test("Fase 2: la falta del ABP escrito no impide el automático si es lo único y la búsqueda en STEL fue completa", ()=>{
 const d=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(d,catalogo,{busquedaStelCompleta:true}).estado,"PENDIENTE");
 assert.equal(C.orden(d,catalogo,{busquedaStelCompleta:false}).estado,"REVISAR","sin búsqueda completa");
 const otra=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel","Confianza del documento 0.75 < 0.9: requiere revisión"]}});
 assert.equal(C.orden(otra,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","otra incidencia");
 const obra=doc({estado_documento:"REVISAR",resultado:{fiable:true,confianza:0.95,incidencias:["Código manuscrito no detectado: obra (PRY), STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(obra,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","falta también la obra");
 const baja=doc({estado_documento:"REVISAR",resultado:{fiable:false,confianza:0.75,incidencias:["Código manuscrito no detectado: STEL (ABP); comprueba el papel"]}});
 assert.equal(C.orden(baja,catalogo,{busquedaStelCompleta:true}).estado,"REVISAR","documento poco fiable");
});

test("sin la lista de proyectos de STEL: la obra validada va sin id (la elige el robot); con lista completa sin ella, REVISAR", ()=>{
 const o=C.orden(doc(),{...catalogo,obras:[],obras_completo:false});
 assert.equal(o.estado,"PENDIENTE");assert.deepEqual(o.plan.obra,{codigo:"PRY09999",stel_id:null,nombre:null});
 assert.equal(C.orden(doc({resultado:{manuscritos:{obra:ok("PRY01111")}}}),{...catalogo,obras_completo:true}).estado,"REVISAR");
});

test("catálogo leído a medias: el artículo no encontrado lo busca el robot en STEL", ()=>{
 const d=doc();d.resultado.lineas[0].referencia=ok("ZZ-12345");d.resultado.lineas[0].descripcion=ok("VALVULA FICTICIA ESFERA");
 const o=C.orden(d,{...catalogo,articulos_completo:false});
 assert.equal(o.estado,"PENDIENTE",o.motivos.join("; "));
 assert.equal(o.plan.lineas[0].articulo.estado,"buscar");
 assert.equal(o.plan.lineas[0].articulo.item_id,null);
});
