"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ESTADOS,resolverArticulo,descripcionNormalizada}=require("../albaranes/articulos.js");

const SALTOKI={account_id:227500,categoria_id:2209};
const art=(id,reference,name,extra={})=>({id,reference,name,barcode:"",deleted:false,inactive:false,"product-category-id":2209,...extra});
const CATALOGO=[
 art(1,"1203097119","TUBO MULTICAPA 16X2 ROLLO 100M"),
 art(2,"0551000013","CODO PRESS 16"),
 art(3,"X-200","GRIFO MONOMANDO",{"product-category-id":2255}),
 art(4,"X-200","GRIFO MONOMANDO LAVABO"),
 art(5,"77","CINTA AMERICANA",{barcode:"8412345678905"}),
 art(6,"OTRA","ABRAZADERA ISOFONICA M8"),
 art(7,"999","VALVULA ESFERA 1/2",{"product-category-id":2255}),
 art(8,"OLD","BRIDA",{deleted:true})
];
const datos={mapeos:[{account_id:227500,referencia_canonica:"S123",item_id:2}],catalogo:CATALOGO,catalogo_completo:true};

test("1 · la correspondencia guardada se usa primero",()=>{
 const r=resolverArticulo({referencia:"S-123",descripcion:"lo que sea"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.MAPEADO);assert.equal(r.item_id,2);
});

test("2 · referencia exacta (sin distinguir signos ni mayúsculas)",()=>{
 const r=resolverArticulo({referencia:"1203097119",descripcion:"TUBO"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.EXISTENTE);assert.equal(r.item_id,1);assert.equal(r.via,"referencia");
});

test("2 · referencia repetida: desempata la categoría del proveedor",()=>{
 const r=resolverArticulo({referencia:"x-200",descripcion:"GRIFO"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.EXISTENTE);assert.equal(r.item_id,4);
});

test("2 · referencia que solo existe en la categoría de otro proveedor: revisión",()=>{
 const r=resolverArticulo({referencia:"999",descripcion:"VALVULA"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.REVISION);
});

test("3 · código de barras",()=>{
 const r=resolverArticulo({referencia:"NUEVA-REF",descripcion:"x",barcode:"8412345678905"},SALTOKI,datos);
 assert.equal(r.item_id,5);assert.equal(r.via,"codigo_barras");
});

test("4 · descripción idéntica tras normalizar mayúsculas, acentos, espacios y unidades",()=>{
 const r=resolverArticulo({referencia:"ZZZ-9",descripcion:"Abrazadera  isofónica M8"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.EXISTENTE);assert.equal(r.item_id,6);assert.equal(r.via,"descripcion");
 assert.equal(descripcionNormalizada("Tubo 3 metros Ø32"),descripcionNormalizada("TUBO 3M D 32"));
});

test("anti-duplicados: referencia con ceros o descripción casi igual → revisión, no alta",()=>{
 const a=resolverArticulo({referencia:"00551000013-",descripcion:"OTRO TEXTO"},SALTOKI,{...datos,mapeos:[]});
 assert.equal(a.estado,ESTADOS.REVISION,"un cero de más no es coincidencia exacta: posible duplicado");
 assert.equal(a.via,"anti_duplicados");assert.deepEqual(a.candidatos,[2]);
 const b=resolverArticulo({referencia:"551000013",descripcion:"OTRO TEXTO"},SALTOKI,{...datos,mapeos:[]});
 assert.equal(b.estado,ESTADOS.REVISION);assert.equal(b.via,"anti_duplicados");
 const c=resolverArticulo({referencia:"NUEVO-1",descripcion:"TUBO MULTICAPA 16X2 ROLLO 100 METROS"},SALTOKI,datos);
 assert.equal(c.estado,ESTADOS.EXISTENTE,"100 METROS = 100M tras normalizar");
});

test("sin coincidencias ni parecidos: se propone el alta con sus datos",()=>{
 const r=resolverArticulo({referencia:"NV-777",descripcion:"Sifón botella 1 1/4",unidad:"UD"},SALTOKI,datos);
 assert.equal(r.estado,ESTADOS.CREAR);
 assert.equal(r.propuesta_alta.reference,"NV-777");assert.equal(r.propuesta_alta["product-category-id"],2209);
 assert.equal(r.propuesta_alta.unidad,"UD");
});

test("nunca se crea con el catálogo leído a medias",()=>{
 const r=resolverArticulo({referencia:"NV-777",descripcion:"Sifón botella"},SALTOKI,{...datos,catalogo_completo:false});
 assert.equal(r.estado,ESTADOS.REVISION);assert.equal(r.via,"catalogo_incompleto");
});

test("los artículos borrados no cuentan y un mapeo a un artículo borrado va a revisión",()=>{
 assert.equal(resolverArticulo({referencia:"OLD",descripcion:"BRIDA X"},SALTOKI,datos).estado,ESTADOS.CREAR);
 const r=resolverArticulo({referencia:"S9",descripcion:"x"},SALTOKI,{...datos,mapeos:[{account_id:227500,referencia_canonica:"S9",item_id:8}]});
 assert.equal(r.estado,ESTADOS.REVISION);
});
