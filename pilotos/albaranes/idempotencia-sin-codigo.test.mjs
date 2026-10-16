// Regression test for compras-auto-v3 preflight idempotency.
// Run with: node --test pilotos/albaranes/idempotencia-sin-codigo.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
const canon = v=>String(v??"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9]/g,"");
const normalizedRow=v=>{
 const reference=String(v?.referencia??v?.codigo_articulo??"").trim();
 const quantity=Number(v?.cantidad);
 return JSON.stringify(reference
  ? ["REFERENCIA",canon(reference),quantity]
  : ["SIN_CODIGO",canon(v?.descripcion),quantity]);
};
const validPhysicalRows=(rows,allowNoCode)=>Array.isArray(rows)&&rows.length>0&&rows.length<=50&&rows.every(x=>
 Number.isFinite(Number(x?.cantidad))&&Number(x?.cantidad)>0&&!!canon(x?.descripcion)&&
 (!!String(x?.referencia||"").trim()||allowNoCode));
const cases=[
 {num:"26/02749",extracted:{referencia:"",descripcion:"mostrador de recepción accesible",cantidad:1},stored:{codigo_articulo:"",descripcion:"-mostrador de recepción accesible",cantidad:1}},
 {num:"26/02685",extracted:{referencia:"",descripcion:"puerta de paso lacada blanca",cantidad:3},stored:{codigo_articulo:"",descripcion:"puerta de paso lacada blanca",cantidad:3}}
];
for(const c of cases){
 test("reconoce albarán archivado sin código: "+c.num,()=>{
  assert.equal(validPhysicalRows([c.extracted],true),true);
  assert.equal(normalizedRow(c.extracted),normalizedRow(c.stored));
  assert.notEqual(normalizedRow({...c.extracted,cantidad:999}),normalizedRow(c.stored));
  assert.notEqual(normalizedRow({...c.extracted,descripcion:"ARTICULO DISTINTO"}),normalizedRow(c.stored));
  assert.equal(validPhysicalRows([c.extracted],false),false);
 });
}
test("artículos con código solo coinciden con referencia y cantidad exactas",()=>{
 const a={referencia:"0550100007",descripcion:"TERMOMETRO 120 GRADOS",cantidad:2};
 const b={codigo_articulo:"0550100007",descripcion:"TERMOMETRO 120C",cantidad:2};
 assert.equal(normalizedRow(a),normalizedRow(b));
 assert.notEqual(normalizedRow(a),normalizedRow({...b,codigo_articulo:"0550100008"}));
 assert.notEqual(normalizedRow(a),normalizedRow({...b,cantidad:3}));
});
