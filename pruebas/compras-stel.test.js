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
