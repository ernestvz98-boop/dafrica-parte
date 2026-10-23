"use strict";
// Albarán de compra de STEL por número del proveedor en su título (datos ficticios).
const test=require("node:test"),assert=require("node:assert/strict");
const C=require("../albaranes/compras-stel.js");
const ok=(valor,c=0.95)=>({valor,estado:"OK",confianza:c});
const doc=({numero=ok("123456"),fecha=ok("2026-03-03"),cuenta=7,stel=null}={})=>({resultado:{proveedor:{estado:"OK",account_id:cuenta,nombre:"PROVEEDOR FICTICIO"},numero,fecha,
 manuscritos:{obra:{valor:null,estado:"VACIO"},stel:stel||{valor:null,literal:"",estado:"VACIO"}}}});
const nota=(ref,titulo,{cuenta=7,fecha="2026-03-03"}={})=>({fullReference:ref,title:titulo,accountId:cuenta,date:fecha+"T00:00:00+0000",id:1});

test("número en el título de un único albarán de la cuenta y misma fecha: ABP aceptado sin leer la letra a mano",()=>{
 const d=doc();
 const r=C.resolver([d],[nota("ABP261111","123.456 03/03/2026 OBRA FICTICIA"),nota("ABP261112","999.999 03/03/2026 OTRA"),nota("ABP261113","123.456 03/03/2026 X",{cuenta:8})]);
 assert.equal(r.resueltos,1);
 const s=d.resultado.manuscritos.stel;
 assert.equal(s.valor,"ABP26-1111");assert.equal(s.estado,"OK");assert.equal(s.resolucion.metodo,"albaran_stel_por_numero");
 assert.equal(d.resultado.albaran_stel.obra,"OBRA FICTICIA");
});
test("fecha distinta, dos albaranes con el mismo número o cuenta sin verificar: no se acepta",()=>{
 const a=doc();C.resolver([a],[nota("ABP261111","123.456 04/03/2026 X",{fecha:"2026-03-04"})]);
 assert.notEqual(a.resultado.manuscritos.stel.estado,"OK");
 const b=doc();C.resolver([b],[nota("ABP261111","123456 03/03/2026 X"),nota("ABP261112","123456 03/03/2026 Y")]);
 assert.notEqual(b.resultado.manuscritos.stel.estado,"OK");
 const c=doc();c.resultado.proveedor.estado="REVISAR";C.resolver([c],[nota("ABP261111","123456 03/03/2026 X")]);
 assert.notEqual(c.resultado.manuscritos.stel.estado,"OK");
 // Número como parte de otra palabra («1234567»): no es el mismo número.
 const d=doc();C.resolver([d],[nota("ABP261111","1234567 03/03/2026 X")]);
 assert.notEqual(d.resultado.manuscritos.stel.estado,"OK");
});
test("fecha del título cuando la del albarán de STEL es otra (alta posterior)",()=>{
 const d=doc();C.resolver([d],[nota("ABP261111","123456 03/03/2026 X",{fecha:"2026-03-05"})]);
 assert.equal(d.resultado.manuscritos.stel.estado,"OK");
});
test("dos albaranes leídos con el mismo albarán de STEL: ninguno",()=>{
 const a=doc(),b=doc();const r=C.resolver([a,b],[nota("ABP261111","123456 03/03/2026 X")]);
 assert.equal(r.resueltos,0);assert.equal(r.conflictos,2);
 assert.notEqual(a.resultado.manuscritos.stel.estado,"OK");
});
test("la letra a mano validada dice otro ABP: a revisión, sin elegir",()=>{
 const d=doc({stel:{valor:"ABP26-2222",literal:"ABP26 2222",estado:"OK",confianza:0.95,resolucion:{metodo:"vision_recorte_validada",evidencias:[]}}});
 C.resolver([d],[nota("ABP261111","123456 03/03/2026 X")]);
 assert.equal(d.resultado.manuscritos.stel.estado,"REVISAR");assert.equal(d.resultado.albaran_stel.estado,"CONFLICTO");
});
test("número del papel en revisión: si coincide así con STEL, queda confirmado",()=>{
 const d=doc({numero:{valor:"123456",estado:"REVISAR",confianza:0.6}});
 const r=C.resolver([d],[nota("ABP261111","123.456 03/03/2026 X")]);
 assert.equal(r.numeros,1);assert.equal(d.resultado.numero.estado,"OK");assert.equal(d.resultado.numero.resolucion.metodo,"albaran_stel_titulo");
});
test("consulta: cuentas verificadas y fechas con margen",()=>{
 const q=C.consulta([doc(),doc({cuenta:9,fecha:ok("2026-02-01")}),doc({fecha:{valor:"2026-01-01",estado:"REVISAR",confianza:0.5}})]);
 assert.deepEqual(q.cuentas.sort(),[7,9]);assert.equal(q.desde,"2026-01-22");assert.equal(q.hasta,"2026-03-13");
});
// Fallo real (2026-10-22): las compras de un proveedor estaban en una cuenta de STEL SIN CIF y la
// cuenta de su CIF no tenía ninguna; el albarán de compra no se encontraba.
test("cuenta de STEL sin CIF: sin ninguno en la cuenta del CIF, el único albarán con ese número largo y misma fecha",()=>{
 const sinCif=new Set(["70"]);
 const d=doc();
 const r=C.resolver([d],[nota("ABP261111","123.456 03/03/2026 OBRA FICTICIA",{cuenta:70})],{cuentasSinCif:sinCif});
 assert.equal(r.resueltos,1);assert.equal(r.sin_cif,1);
 assert.equal(d.resultado.manuscritos.stel.valor,"ABP26-1111");assert.match(d.resultado.albaran_stel.evidencias[0],/sin CIF/);
 // Sin la lista de cuentas sin CIF, no.
 const e=doc();C.resolver([e],[nota("ABP261111","123.456 03/03/2026 X",{cuenta:70})]);
 assert.notEqual(e.resultado.manuscritos.stel.estado,"OK");
 // Cuenta con otro CIF (no está en la lista): no.
 const f=doc();C.resolver([f],[nota("ABP261111","123.456 03/03/2026 X",{cuenta:71})],{cuentasSinCif:sinCif});
 assert.notEqual(f.resultado.manuscritos.stel.estado,"OK");
 // Otro albarán de STEL, de cualquier cuenta, con el mismo número en el título: no.
 const g=doc();C.resolver([g],[nota("ABP261111","123.456 03/03/2026 X",{cuenta:70}),nota("ABP261119","123456 01/02/2026 Y",{cuenta:71,fecha:"2026-02-01"})],{cuentasSinCif:sinCif});
 assert.notEqual(g.resultado.manuscritos.stel.estado,"OK");
 // Número corto (4 caracteres) u otra fecha: no.
 const h=doc({numero:ok("1234")});C.resolver([h],[nota("ABP261111","1234 03/03/2026 X",{cuenta:70})],{cuentasSinCif:sinCif});
 assert.notEqual(h.resultado.manuscritos.stel.estado,"OK");
 const i=doc();C.resolver([i],[nota("ABP261111","123456 04/03/2026 X",{cuenta:70,fecha:"2026-03-04"})],{cuentasSinCif:sinCif});
 assert.notEqual(i.resultado.manuscritos.stel.estado,"OK");
 // Con el albarán en la cuenta del CIF, se usa ese.
 const j=doc();C.resolver([j],[nota("ABP261111","123456 03/03/2026 X"),nota("ABP261112","123456 03/03/2026 Y",{cuenta:70})],{cuentasSinCif:sinCif});
 assert.equal(j.resultado.manuscritos.stel.valor,"ABP26-1111");
 // Proveedor sin cuenta de STEL con su CIF: también por la cuenta sin CIF.
 const k=doc({cuenta:null});C.resolver([k],[nota("ABP261111","123456 03/03/2026 X",{cuenta:70})],{cuentasSinCif:sinCif});
 assert.equal(k.resultado.manuscritos.stel.estado,"OK");
});
test("cuentas sin CIF demostradas: las de los albaranes resueltos en ellas, por proveedor",()=>{
 const sinCif=new Set(["70"]);
 const a=doc(),b=doc({numero:ok("654321")});a.resultado.proveedor.id="P1";b.resultado.proveedor.id="P1";
 C.resolver([a,b],[nota("ABP261111","123456 03/03/2026 X",{cuenta:70})],{cuentasSinCif:sinCif});
 assert.equal(a.resultado.albaran_stel.cuenta,70);assert.equal(a.resultado.albaran_stel.sin_cif,true);
 const m=C.cuentasSinCifPorProveedor([a,b]);
 assert.deepEqual([...m.get("id:P1")],["70"]);
 // Resuelto en la cuenta del CIF: no cuenta como cuenta sin CIF.
 const c=doc();c.resultado.proveedor.id="P2";C.resolver([c],[nota("ABP261111","123456 03/03/2026 X")],{cuentasSinCif:sinCif});
 assert.equal(C.cuentasSinCifPorProveedor([c]).size,0);
});
test("consulta: también con un proveedor sin cuenta de STEL por su CIF (la búsqueda es en todas las cuentas)",()=>{
 const q=C.consulta([doc({cuenta:null})]);
 assert.deepEqual(q.cuentas,[]);assert.equal(q.desde,"2026-02-21");assert.equal(q.hasta,"2026-03-13");
 assert.equal(C.consulta([doc({fecha:{valor:"2026-03-03",estado:"REVISAR",confianza:0.5}})]),null);
});
// Fallo real (2026-10-23): STEL corta con «403» tras muchas consultas seguidas y al rato vuelve a
// responder. Un único reintento tras la espera; si sigue sin responder, «sin cupo» (sin más consultas).
test("búsqueda de la lectura: con «403», un reintento tras la espera; si sigue, sin cupo; por cuenta solo si es larga",async()=>{
 const q={cuentas:[7,8],desde:"2026-02-21",hasta:"2026-03-13"};
 const bien={metodo:"recientes",completo:true,notas:[],consultas:9},corte={metodo:"error",completo:false,notas:[],consultas:1,motivo:"STEL 403"};
 const con=(...respuestas)=>{const pedidas=[];return {pedidas,buscar:async b=>{pedidas.push(b);return respuestas.shift();}};};
 const esperas=[],esperar=async ms=>{esperas.push(ms);};
 let s=con(bien),r=await C.buscarNotasLectura(s.buscar,q,{esperar});
 assert.equal(r.resp.completo,true);assert.equal(r.todas,true);assert.equal(r.sin_cupo,false);assert.equal(s.pedidas.length,1);assert.deepEqual(s.pedidas[0].cuentas,[]);
 s=con(corte,bien);r=await C.buscarNotasLectura(s.buscar,q,{esperar});
 assert.equal(r.resp.completo,true);assert.equal(r.sin_cupo,false);assert.equal(s.pedidas.length,2);assert.deepEqual(esperas,[60000]);assert.equal(r.intentos.length,2);
 s=con(corte,{...corte,motivo:"STEL 429"});r=await C.buscarNotasLectura(s.buscar,q,{esperar});
 assert.equal(r.sin_cupo,true);assert.equal(s.pedidas.length,2);
 // Detenida durante la espera: no se vuelve a preguntar.
 let parar=false;s=con(corte,bien);r=await C.buscarNotasLectura(s.buscar,q,{esperar:async()=>{parar=true;},detenido:()=>parar});
 assert.equal(s.pedidas.length,1);assert.equal(r.sin_cupo,true);
 // Búsqueda larga (límite de páginas): por cuenta, sin espera.
 s=con({...corte,motivo:"limite_paginas"},bien);r=await C.buscarNotasLectura(s.buscar,q,{esperar:async()=>{throw Error("no debe esperar");}});
 assert.equal(r.todas,false);assert.deepEqual(s.pedidas[1].cuentas,[7,8]);assert.equal(r.resp.completo,true);
});

test('identidad ABP: un mismo albarán de compra de STEL para dos albaranes leídos → ninguno aceptado',()=>{
 const {conflictosIdentidad}=require('../albaranes/compras-stel.js');
 const doc=(num,stel,man)=>({resultado:{numero:{valor:num,estado:'OK',confianza:1},albaran_stel:stel,manuscritos:man?{stel:man}:null}});
 const docs=[
  doc('11.111',{id:7,abp:'ABP26-0001',estado:'OK'},null),
  doc('22.222',null,{valor:'ABP26-0001',estado:'OK',confianza:0.95,resolucion:{}}), // letra a mano, el mismo ABP
  doc('33.333',{id:9,abp:'ABP26-0003',estado:'OK'},{valor:'ABP26-0003',estado:'OK',confianza:0.95,resolucion:{id_stel:9}}), // el suyo, coherente
 ];
 assert.equal(conflictosIdentidad(docs),2);
 assert.equal(docs[0].resultado.albaran_stel.estado,'CONFLICTO');
 assert.equal(docs[1].resultado.manuscritos.stel.estado,'REVISAR');
 assert.match(docs[1].resultado.manuscritos.stel.motivos.at(-1),/11\.111/);
 assert.equal(docs[2].resultado.albaran_stel.estado,'OK');assert.equal(docs[2].resultado.manuscritos.stel.estado,'OK');
 // El mismo id con otro formato de referencia también es conflicto.
 const d2=[doc('1',{id:5,abp:'ABP26-0005',estado:'OK'}),doc('2',null,{valor:'ABP26-0050',estado:'OK',confianza:0.95,resolucion:{id_stel:5}})];
 assert.equal(conflictosIdentidad(d2),2);
});

test("número en el título pero la referencia externa de STEL dice otro número del proveedor: contradicción, no se elige",()=>{
 const d=doc();
 const r=C.resolver([d],[{...nota("ABP261111","123.456 03/03/2026 X"),extraReference:"999.999"}]);
 assert.equal(r.resueltos,0);assert.equal(r.conflictos,1);
 assert.notEqual(d.resultado.manuscritos.stel.estado,"OK");assert.equal(d.resultado.albaran_stel,undefined);
 // La misma referencia externa (otro formato): sí.
 const e=doc();assert.equal(C.resolver([e],[{...nota("ABP261111","123.456 03/03/2026 X"),extraReference:"123456"}]).resueltos,1);
});
