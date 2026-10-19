"use strict";
/*
 * Pruebas de mutación del evaluador: si se altera un valor de una lectura
 * correcta, el informe DEBE detectarlo. Así un 0 % de fallos críticos
 * significa algo.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {evaluarSinteticos}=require("./evaluar.js");
const {DOCUMENTOS}=require("./sinteticos.js");
const {comparar}=require("./comparar.js");

let base,esperado;
test.before(async()=>{
 const datos=await evaluarSinteticos();
 base=datos.informes.find(i=>i.id.startsWith("S01")).resultado;
 esperado=DOCUMENTOS.find(d=>d.id.startsWith("S01")).esperado;
});
const copia=()=>structuredClone(base);

test("la lectura original es correcta y AUTO_OK",()=>{
 const c=comparar(base,esperado);
 assert.equal(base.estado,"AUTO_OK");assert.equal(c.criticos,0);assert.equal(c.auto_ok_falso,false);
});

test("una cantidad cambiada y aceptada es un fallo crítico",()=>{
 const r=copia();r.lineas[0].cantidad.valor=9;
 const c=comparar(r,esperado);
 assert.equal(c.campos.find(x=>x.campo==="lineas.1.cantidad").categoria,"INCORRECTO_NO_MARCADO");
 assert.equal(c.criticos,1);assert.equal(c.auto_ok_falso,true);
});

test("un valor erróneo pero marcado no es crítico",()=>{
 const r=copia();r.lineas[1].precio.valor=0.98;r.lineas[1].precio.estado="REVISAR";r.estado="REVISAR";
 const c=comparar(r,esperado);
 assert.equal(c.campos.find(x=>x.campo==="lineas.2.precio").categoria,"INCORRECTO_MARCADO");
 assert.equal(c.criticos,0);
});

test("proveedor, fecha y descuento alterados se detectan",()=>{
 const r=copia();
 r.proveedor.nif="B24000002";r.fecha.valor="2026-15-10";r.lineas[0].descuento.porcentajes=[25];
 const c=comparar(r,esperado);
 for(const campo of ["cabecera.proveedor_nif","cabecera.fecha","lineas.1.descuento"])
  assert.equal(c.campos.find(x=>x.campo===campo).categoria,"INCORRECTO_NO_MARCADO",campo);
});

test("una línea perdida en un AUTO_OK es crítica y no desplaza las demás",()=>{
 const r=copia();r.lineas.splice(1,1);
 const c=comparar(r,esperado);
 assert.deepEqual(c.lineas.map(l=>l.categoria),["LINEA_PERDIDA"]);
 assert.equal(c.lineas[0].fila_esperada,2);
 assert.ok(c.criticos>=1);
 assert.equal(c.campos.find(x=>x.campo==="lineas.3.cantidad").categoria,"CORRECTO");
});

test("un campo que debía marcarse y se aceptó es crítico",()=>{
 const r=copia();
 const c=comparar(r,{...esperado,marcados:["lineas.1.importe"]});
 assert.equal(c.campos.find(x=>x.campo==="lineas.1.importe").categoria,"FALTA_MARCA");
});
