"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ESTADOS,FUENTES,estadoInicial,resolverPrecios,validarParaFactura}=require("../albaranes/precios.js");

const AHORA="2026-10-19T12:00:00.000Z";
const linea=(referencia,cantidad,precio,extra={})=>({referencia,cantidad,...extra,
 precio_estado:estadoInicial({precio:precio===null?{literal:"",valor:null,estado:"VACIO"}:{literal:String(precio),valor:precio,estado:"VERIFICADO"}})});

test("una línea sin precio queda precio_pendiente y conserva el original",()=>{
 const e=estadoInicial({precio:{literal:"",valor:null,estado:"VACIO"}});
 assert.equal(e.estado_precio,ESTADOS.PENDIENTE);assert.equal(e.precio_original,null);assert.equal(e.precio_utilizado,null);
 const r=estadoInicial({precio:{literal:"12,5",valor:12.5,estado:"REVISAR"}});
 assert.equal(r.estado_precio,ESTADOS.PENDIENTE,"un precio impreso que no cuadra no se usa");
 assert.equal(r.precio_original,12.5);
});

test("prioridad 1: el pedido con precio definitivo gana al artículo",()=>{
 const [l]=resolverPrecios([linea("A-1",10,null)],{
  pedido:{id:"PED-9",definitivo:true,lineas:[{referencia:"A-1",precio:2.5}]},
  articulos:[{referencia:"A-1",precio:3,valido:true}]},{ahora:AHORA});
 assert.equal(l.precio_estado.estado_precio,ESTADOS.RESUELTO);
 assert.equal(l.precio_estado.precio_utilizado,2.5);assert.equal(l.precio_estado.fuente_precio,FUENTES.PEDIDO);
 assert.equal(l.precio_estado.fuente_documento,"PED-9");assert.equal(l.precio_estado.fecha_resolucion_precio,AHORA);
 assert.equal(l.precio_estado.precio_original,null);
});

test("prioridad 2: sin pedido definitivo se usa el precio válido del artículo",()=>{
 const [l]=resolverPrecios([linea("A-1",10,null)],{
  pedido:{id:"PED-9",definitivo:false,lineas:[{referencia:"A-1",precio:2.5}]},
  articulos:[{referencia:"A-1",precio:3,valido:false},{item_id:77,referencia:"OTRA",precio:3.1,valido:true}]},{ahora:AHORA});
 assert.equal(l.precio_estado.estado_precio,ESTADOS.PENDIENTE,"artículo no válido y pedido no definitivo");
 const [m]=resolverPrecios([linea("A-1",10,null,{item_id:77})],{articulos:[{item_id:77,referencia:"OTRA",precio:3.1,valido:true}]},{ahora:AHORA});
 assert.equal(m.precio_estado.precio_utilizado,3.1);assert.equal(m.precio_estado.coincidencia,"item_id");
});

test("prioridad 3: la factura original solo se usa al procesar una factura recibida",()=>{
 const fuentes={factura:{id:"FAC-1",lineas:[{referencia:"A-1",precio:4}]}};
 assert.equal(resolverPrecios([linea("A-1",1,null)],fuentes,{modo:"albaran"})[0].precio_estado.estado_precio,ESTADOS.PENDIENTE);
 const [l]=resolverPrecios([linea("A-1",1,null)],fuentes,{modo:"factura_recibida",ahora:AHORA});
 assert.equal(l.precio_estado.fuente_precio,FUENTES.FACTURA);assert.equal(l.precio_estado.precio_utilizado,4);
});

test("nunca se estima: precios contradictorios o ceros no resuelven",()=>{
 const [a]=resolverPrecios([linea("A-1",1,null)],{articulos:[{referencia:"A-1",precio:3,valido:true},{referencia:"A-1",precio:3.2,valido:true}]});
 assert.equal(a.precio_estado.estado_precio,ESTADOS.PENDIENTE);assert.match(a.precio_estado.motivo,/varios precios/);
 const [b]=resolverPrecios([linea("A-1",1,null)],{articulos:[{referencia:"A-1",precio:0,valido:true}]});
 assert.equal(b.precio_estado.estado_precio,ESTADOS.PENDIENTE);
 // Un pedido contradictorio no se salta para usar el artículo.
 const [c]=resolverPrecios([linea("A-1",1,null)],{pedido:{id:"P",definitivo:true,lineas:[{referencia:"A-1",precio:1},{referencia:"A-1",precio:2}]},
  articulos:[{referencia:"A-1",precio:3,valido:true}]});
 assert.equal(c.precio_estado.estado_precio,ESTADOS.PENDIENTE);
});

test("descuento impreso distinto del de la fuente: revisión",()=>{
 const [l]=resolverPrecios([linea("A-1",1,null,{descuento:20})],{pedido:{id:"P",definitivo:true,lineas:[{referencia:"A-1",precio:5,descuento:10}]}});
 assert.equal(l.precio_estado.estado_precio,ESTADOS.PENDIENTE);assert.match(l.precio_estado.motivo,/descuento/);
});

test("los precios confirmados del documento no se tocan",()=>{
 const [l]=resolverPrecios([linea("A-1",2,9)],{pedido:{id:"P",definitivo:true,lineas:[{referencia:"A-1",precio:1}]}});
 assert.equal(l.precio_estado.estado_precio,ESTADOS.CONFIRMADO);assert.equal(l.precio_estado.precio_utilizado,9);
 assert.equal(l.precio_estado.fuente_precio,FUENTES.DOCUMENTO);
});

test("no se factura con líneas pendientes; con todo resuelto se valida la base",()=>{
 const pendientes=resolverPrecios([linea("A-1",2,9),linea("B-2",1,null)],{});
 const v=validarParaFactura(pendientes);
 assert.equal(v.puede_facturar,false);assert.equal(v.estado,"REVISION");assert.match(v.problemas[0],/B-2/);
 const resueltas=resolverPrecios([linea("A-1",2,9),linea("B-2",4,null)],{pedido:{id:"P",definitivo:true,lineas:[{referencia:"B-2",precio:2.5,descuento:10}]}});
 const ok=validarParaFactura(resueltas,{base_factura:27});
 assert.equal(ok.puede_facturar,true);assert.equal(ok.base_calculada,27); // 2×9 + 4×2,5×0,9
 assert.equal(validarParaFactura(resueltas,{base_factura:30}).puede_facturar,false);
});
