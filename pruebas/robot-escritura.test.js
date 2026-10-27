"use strict";
// Autorizador de escrituras del robot (Fase 2). Datos ficticios.
const test=require("node:test"),assert=require("node:assert/strict");
const E=require("../robot-stel/escritura.js");

const plan={proveedor:{account_id:9001},numero:"123.456",fecha:"22/10/2026",obra:{codigo:"PRY09999",stel_id:555,nombre:"OBRA FICTICIA"},pedido:null,
 lineas:[{referencia:"REF-001",cantidad:4,precio:2.5,articulo:{estado:"existente",item_id:777}},
  {referencia:"ZZ-1",cantidad:1,precio:null,articulo:{estado:"crear",item_id:null,propuesta:{referencia:"ZZ-1",descripcion:"VALVULA FICTICIA"}}}]};
const esp=()=>E.esperado(plan,{ids:{"ZZ-1":888},fichero:"albaran-123456.pdf"});
const q=o=>new URLSearchParams(Object.entries(o).map(([k,v])=>[k,typeof v==="string"?v:JSON.stringify(v)]));
const albaran=(cambios={})=>q({id:"",tipo:"ALBARANDEPROVEEDOR",idCliente:"9001",fecha:"22/10/2026",titulo:"123.456 22/10/2026 OBRA FICTICIA",
 referenciaDocumentoExtra:"123.456",stringIdsProyectos:"555",idDocumentoComercialPadre:"",
 lineasDocumentoComercial:[{id:"",idObjetoCatalogo:"777",unidades:"4",precioBaseTarifa:"2.5"},{id:"",idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}],...cambios});

test("el albarán exacto de la orden se autoriza una sola vez", ()=>{
 const a=E.crearAutorizador(esp());
 assert.deepEqual(a.autorizar("guardarDocumentoComercial",albaran()).slice(0,2),[true,"ok"]);
 assert.equal(a.autorizar("guardarDocumentoComercial",albaran())[0],false);
});

test("sin precio y sin pedido: la línea va a 0,00", ()=>{
 const e=esp();assert.equal(e.albaran.lineas[1].precio,0);
 const conPedido=E.esperado({...plan,lineas:[{...plan.lineas[1],precio_pedido:12.3}]},{ids:{"ZZ-1":888}});
 assert.equal(conPedido.albaran.lineas[0].precio,12.3);
});

test("cualquier diferencia con la orden cancela el albarán", ()=>{
 const casos={
  "modifica uno existente":{id:"12345"},"otro proveedor":{idCliente:"9002"},"otra obra":{stringIdsProyectos:"556"},
  "otro título":{titulo:"OTRO"},"otra ref. del proveedor":{referenciaDocumentoExtra:"123.457"},"otra fecha":{fecha:"23/10/2026"},
  "generado desde el pedido":{idDocumentoComercialPadre:"999"},"otro tipo":{tipo:"FACTURADEPROVEEDOR"},
  "otra cantidad":{lineasDocumentoComercial:[{idObjetoCatalogo:"777",unidades:"5",precioBaseTarifa:"2.5"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}]},
  "otro precio":{lineasDocumentoComercial:[{idObjetoCatalogo:"777",unidades:"4",precioBaseTarifa:"2.6"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}]},
  "otro artículo":{lineasDocumentoComercial:[{idObjetoCatalogo:"778",unidades:"4",precioBaseTarifa:"2.5"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}]},
  "una línea de más":{lineasDocumentoComercial:[{idObjetoCatalogo:"777",unidades:"4",precioBaseTarifa:"2.5"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}]},
  "línea enlazada":{lineasDocumentoComercial:[{id:"5",idObjetoCatalogo:"777",unidades:"4",precioBaseTarifa:"2.5"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0"}]}};
 for(const [nombre,c] of Object.entries(casos)){
  const a=E.crearAutorizador(esp());
  assert.equal(a.autorizar("guardarDocumentoComercial",albaran(c))[0],false,nombre);
 }
});

test("precios con coma o con punto decimal", ()=>{
 const a=E.crearAutorizador(esp());
 assert.equal(a.autorizar("guardarDocumentoComercial",albaran({lineasDocumentoComercial:[{idObjetoCatalogo:"777",unidades:"4,00",precioBaseTarifa:"2,50"},{idObjetoCatalogo:"888",unidades:"1",precioBaseTarifa:"0,00"}]}))[0],true);
});

test("artículos: solo los nuevos de la orden, serie MANUAL, nombre del lector, una vez", ()=>{
 const a=E.crearAutorizador(esp());
 const p=o=>q({idProducto:"",idSerie:"-2",referencia:"ZZ-1",nombre:"VALVULA FICTICIA",...o});
 assert.equal(a.autorizar("guardarProducto",p({referencia:"REF-001"}))[0],false);
 assert.equal(a.autorizar("guardarProducto",p({idProducto:"777"}))[0],false);
 assert.equal(a.autorizar("guardarProducto",p({idSerie:"5"}))[0],false);
 assert.equal(a.autorizar("guardarProducto",p({nombre:"OTRO NOMBRE"}))[0],false);
 assert.equal(a.autorizar("guardarProducto",p())[0],true);
 assert.equal(a.autorizar("guardarProducto",p())[0],false);
});

test("adjunto: subida del PDF de la orden y enlace a ESE albarán, una vez cada uno y después de crearlo", ()=>{
 const a=E.crearAutorizador(esp());
 const sub=(t,m=true)=>a.autorizar("adjunto",null,{multipart:m,cuerpoTexto:t});
 const enl=(t,op="guardarDocumentoAdjunto")=>a.autorizar("enlazarAdjunto",null,{operacion:op,cuerpoTexto:t});
 assert.equal(sub('name="file-1"; filename="albaran-123456.pdf"')[0],false,"antes de crear el albarán");
 a.idAlbaran(42);
 assert.equal(enl("idDocumento=42&nombre=albaran-123456.pdf")[0],false,"enlace sin subida");
 assert.equal(sub('filename="otro.pdf"')[0],false);
 assert.equal(sub('filename="albaran-123456.pdf"',false)[0],false);
 assert.equal(sub('name="file-1"; filename="albaran-123456.pdf"')[0],true);
 assert.equal(sub('name="file-1"; filename="albaran-123456.pdf"')[0],false,"segunda subida");
 assert.equal(enl("idDocumento=43&nombre=albaran-123456.pdf")[0],false,"otro albarán");
 assert.equal(enl("idDocumento=42&nombre=otro.pdf")[0],false,"otro fichero");
 assert.equal(enl("idsDocumentosComerciales=42&nombre=albaran-123456.pdf","eliminarDocumentosComerciales")[0],false,"borrar nunca");
 assert.equal(enl("idDocumento=42&nombre=albaran-123456.pdf")[0],true);
 assert.equal(enl("idDocumento=42&nombre=albaran-123456.pdf")[0],false,"segundo enlace");
});

test("otras escrituras nunca", ()=>{
 const a=E.crearAutorizador(esp());
 for(const op of ["eliminarDocumentosComerciales","guardarCliente","cambiarEstado",""])assert.equal(a.autorizar(op,q({}))[0],false,op);
});

test("orden incompleta: no se prepara ninguna escritura", ()=>{
 assert.throws(()=>E.esperado({...plan,obra:null}));
 assert.throws(()=>E.esperado(plan,{ids:{}}),/sin id/);
});

test("título como los de la oficina, con el pedido si lo hay", ()=>{
 assert.equal(E.titulo(plan),"123.456 22/10/2026 OBRA FICTICIA");
 assert.equal(E.titulo({...plan,pedido:{codigo:"PAP09001"}}),"123.456 22/10/2026 OBRA FICTICIA · PAP09001");
});
