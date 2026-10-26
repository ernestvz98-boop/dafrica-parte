"use strict";
// Entregas de un pedido a proveedor: a mano mientras falte algo; la que completa, desde el pedido (datos ficticios).
const test=require("node:test"),assert=require("node:assert/strict");
const {decidirEntrega}=require("../robot-stel/pedidos.js");
const pedido={codigo:"PAP90001",cerrado:false,lineas:[{clave:"A1",cantidad:1},{clave:"B2",cantidad:1},{clave:"LIBRE-DEP",cantidad:2}]};

test("primera entrega parcial: a mano, el pedido sigue abierto con lo que falta",()=>{
 const r=decidirEntrega({pedido,previos:[],albaran:{lineas:[{clave:"A1",cantidad:1},{clave:"B2",cantidad:1}]}});
 assert.equal(r.modo,"a_mano");
 assert.deepEqual(r.pendiente_despues,{"LIBRE-DEP":2});
});
test("la entrega que completa el pedido: generar desde el pedido solo con lo de este papel",()=>{
 const r=decidirEntrega({pedido,previos:[{lineas:[{clave:"A1",cantidad:1},{clave:"B2",cantidad:1}]}],albaran:{lineas:[{clave:"LIBRE-DEP",cantidad:2}]}});
 assert.equal(r.modo,"generar");
 assert.deepEqual(r.generar_lineas,{"LIBRE-DEP":2});
 assert.deepEqual(r.pendiente_despues,{});
});
test("una línea recibida en dos veces: la primera a mano, la última genera con la cantidad que falta",()=>{
 const p={codigo:"PAP90002",lineas:[{clave:"A1",cantidad:3}]};
 assert.equal(decidirEntrega({pedido:p,albaran:{lineas:[{clave:"A1",cantidad:1}]}}).modo,"a_mano");
 const r=decidirEntrega({pedido:p,previos:[{lineas:[{clave:"A1",cantidad:1}]}],albaran:{lineas:[{clave:"A1",cantidad:2}]}});
 assert.equal(r.modo,"generar");assert.deepEqual(r.generar_lineas,{A1:2});
});
test("todo el pedido en un solo albarán: generar desde el pedido",()=>{
 const r=decidirEntrega({pedido,albaran:{lineas:pedido.lineas}});
 assert.equal(r.modo,"generar");
});
test("se para: artículo fuera del pedido, más cantidad de la pendiente, albarán vacío o pedido ya cerrado",()=>{
 assert.equal(decidirEntrega({pedido,albaran:{lineas:[{clave:"Z9",cantidad:1}]}}).modo,"parar");
 const mas=decidirEntrega({pedido,previos:[{lineas:[{clave:"A1",cantidad:1}]}],albaran:{lineas:[{clave:"A1",cantidad:1}]}});
 assert.equal(mas.modo,"parar");assert.match(mas.motivos[0],/solo quedan pendientes 0/);
 assert.equal(decidirEntrega({pedido,albaran:{lineas:[]}}).modo,"parar");
 const cerrado=decidirEntrega({pedido:{...pedido,cerrado:true},albaran:{lineas:pedido.lineas}});
 assert.equal(cerrado.modo,"parar");assert.match(cerrado.motivos[0],/ya está cerrado/);
});
