"use strict";
/*
 * Pruebas de extremo a extremo sobre el corpus sintético:
 * PDF generado → pdf.js → extractor → comparación con el resultado esperado.
 */
const test=require("node:test"),assert=require("node:assert/strict");
const {evaluarSinteticos}=require("./evaluar.js");
const {NIF}=require("./sinteticos.js");

let datos;
const doc=id=>datos.informes.find(i=>i.id.startsWith(id));
test.before(async()=>{datos=await evaluarSinteticos();});

test("ningún valor erróneo se acepta como bueno",()=>{
 for(const i of datos.informes){
  assert.equal(i.comparacion.criticos,0,i.id+": "+JSON.stringify(i.comparacion.campos.filter(c=>/INCORRECTO_NO|FALTA/.test(c.categoria))));
  assert.equal(i.comparacion.auto_ok_falso,false,i.id);
 }
});

test("cada documento termina en el estado esperado",()=>{
 for(const i of datos.informes)assert.equal(i.resultado.estado,i.comparacion.estado_esperado,i.id);
});

test("todos los campos son correctos o quedan marcados como se esperaba",()=>{
 for(const i of datos.informes)for(const c of i.comparacion.campos)
  assert.ok(["CORRECTO","MARCADO_COMO_ESPERADO"].includes(c.categoria),i.id+" "+c.campo+" "+c.categoria);
 for(const i of datos.informes)assert.deepEqual(i.comparacion.lineas.filter(l=>l.categoria!=="LINEA_PERDIDA_BLOQUEADA"),[],i.id+" líneas perdidas o sobrantes");
});

// Recorre todos los campos {literal, valor, estado} del resultado.
function* campos(x,ruta=""){
 if(!x||typeof x!=="object")return;
 if("literal" in x&&"estado" in x&&"valor" in x)yield [ruta,x];
 for(const [k,v] of Object.entries(x))if(k!=="caja")yield* campos(v,ruta+"."+k);
}
test("nunca se inventa: todo valor procede de un literal impreso",()=>{
 for(const i of datos.informes)for(const [ruta,c] of campos(i.resultado)){
  if(c.valor!==null&&c.valor!==undefined)assert.ok(String(c.literal).trim(),i.id+ruta+" tiene valor sin literal");
  if(["AMBIGUO","INVALIDO","VACIO"].includes(c.estado))assert.equal(c.valor,null,i.id+ruta);
 }
});

test("DAFRICA nunca es el emisor",()=>{
 for(const i of datos.informes){
  assert.notEqual(i.resultado.proveedor?.nif,NIF.PROPIO,i.id);
  assert.ok(!/DAFRICA/i.test(i.resultado.proveedor?.nombre||""),i.id);
 }
 const s06=doc("S06").resultado.proveedor;
 assert.equal(s06.nif,null);assert.equal(s06.nif_propio_detectado,NIF.PROPIO);
});

test("un transportista registrado no sustituye al emisor",()=>{
 assert.equal(doc("S10").resultado.proveedor.nif,NIF.D);
});

test("los literales impresos se conservan tal cual",()=>{
 const l=doc("S01").resultado.lineas;
 assert.equal(l[0].referencia.literal,"0001230045");
 assert.equal(l[0].descuento.literal,"20+5");assert.deepEqual(l[0].descuento.porcentajes,[20,5]);
 assert.equal(l[3].cantidad.literal,"1.500,00");assert.equal(l[3].cantidad.valor,1500);
 assert.equal(doc("S03").resultado.lineas[0].referencia.literal,"8.286,0800");
 assert.equal(doc("S02").resultado.fecha.literal,"17-10-26");
});

test("cantidad ambigua sin precios: marcada y sin valor",()=>{
 const c=doc("S04").resultado.lineas[0].cantidad;
 assert.equal(c.estado,"AMBIGUO");assert.equal(c.valor,null);assert.equal(c.literal,"1.000");
});

test("los descuadres se detectan y proponen hipótesis sin aplicarlas",()=>{
 const l=doc("S05").resultado.lineas;
 assert.equal(l[0].cuadre.estado,"DESCUADRE");
 assert.equal(l[1].cuadre.estado,"VERIFICADO");
 assert.equal(l[2].cuadre.estado,"DESCUADRE");
 assert.ok(l[2].cuadre.hipotesis.some(h=>/100/.test(h)));
 assert.equal(l[2].precio.valor,4.5,"el precio impreso no se modifica");
});

test("la anotación «RETIRADO POR» no se cuenta como artículo",()=>{
 const r=doc("S02").resultado;
 assert.equal(r.lineas.length,2);
 assert.ok(r.lineas_ignoradas.some(x=>/RETIRADO POR/.test(x.texto)));
});

test("fecha sin etiqueta: se propone pero no se acepta",()=>{
 const f=doc("S11").resultado.fecha;
 assert.equal(f.valor,"2026-10-12");assert.equal(f.estado,"REVISAR");
});

test("una fila con referencia y sin cantidad no se descarta",()=>{
 const l=doc("S11").resultado.lineas;
 assert.equal(l.length,3);assert.equal(l[0].estado,"REVISAR");assert.equal(l[0].cantidad.estado,"VACIO");
 assert.equal(l[2].referencia.literal,"PORTES");
});

test("descuento aplicado sobre el precio neto redondeado cuadra",()=>{
 assert.equal(doc("S11").resultado.lineas[1].cuadre.estado,"VERIFICADO");
});

test("un artículo separado tras un hueco bloquea el documento",()=>{
 const r=doc("S12").resultado;
 assert.notEqual(r.estado,"AUTO_OK");
 assert.ok(r.validaciones.some(v=>v.nombre==="fin_de_tabla"&&v.estado==="FALLO"));
});

test("con el NIF de DAFRICA configurado se descarta por coincidencia exacta",async()=>{
 const {DOCUMENTOS,REGISTRO,HOY}=require("./sinteticos.js");
 const {extraerPdf}=require("../albaranes/extraer.js");
 const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
 const registro={...REGISTRO,empresa_propia:{...REGISTRO.empresa_propia,nifs:[NIF.PROPIO]}};
 for(const id of ["S01","S06"]){
  const d=DOCUMENTOS.find(x=>x.id.startsWith(id));
  const r=await extraerPdf(pdfjs,new Uint8Array(await d.construir()),{registro,hoy:HOY});
  assert.equal(r.proveedor.nif,d.esperado.proveedor_nif,id);
  assert.equal(r.proveedor.nif_propio_detectado,NIF.PROPIO,id);
 }
});

test("un PDF escaneado no produce datos",()=>{
 const r=doc("S08").resultado;
 assert.equal(r.estado,"NO_DIGITAL");assert.equal(r.lineas.length,0);assert.equal(r.proveedor,null);
});
