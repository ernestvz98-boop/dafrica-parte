"use strict";
// Puerta del robot a la cola (supabase/functions/robot-cola). Supabase simulado, datos ficticios.
const test=require("node:test"),assert=require("node:assert/strict");
const ID="11111111-2222-3333-4444-555555555555";
const LLAVE="a".repeat(48);

async function cargar(){return import("../supabase/functions/robot-cola/handler.mjs");}
function simulado(huellaValida,{fila={estado:"PENDIENTE",pdf_ruta:"f".repeat(64)+".pdf"}}={}){
 const llamadas=[];
 const fetcher=async(url,op={})=>{
  llamadas.push({url,metodo:op.method||"GET",cuerpo:op.body||null});
  if(url.includes("/rest/v1/robot_llaves"))return new Response(JSON.stringify(url.includes("huella=eq."+huellaValida)?[{huella:huellaValida}]:[]));
  if(url.includes("/rest/v1/stel_cola?select=id,clave"))return new Response(JSON.stringify([{id:ID,clave:"9001|1|2026-10-22",plan:{}}]));
  if(url.includes("/rest/v1/stel_cola?select=pdf_ruta"))return new Response(JSON.stringify([fila]));
  if(url.includes("/rest/v1/stel_cola?id=eq."))return new Response(JSON.stringify([{id:ID}]));
  if(url.includes("/storage/v1/object/albaranes-stel/"))return new Response(new Uint8Array([37,80,68,70]));
  return new Response("[]");
 };
 return {fetcher,llamadas};
}
const env=k=>({SUPABASE_URL:"https://ficticio.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"servicio-ficticio"})[k];
const pedir=(cuerpo,llave=LLAVE)=>new Request("https://x/robot-cola",{method:"POST",headers:{"x-robot-llave":llave},body:JSON.stringify(cuerpo)});

test("sin llave, con llave mal formada o caducada: 401", async()=>{
 const {handler,huella}=await cargar();const s=simulado(await huella(LLAVE));
 assert.equal((await handler(new Request("https://x",{method:"POST",body:"{}"}),{env,fetcher:s.fetcher})).status,401);
 assert.equal((await handler(pedir({accion:"pendientes"},"corta"),{env,fetcher:s.fetcher})).status,401);
 assert.equal((await handler(pedir({accion:"pendientes"},"b".repeat(48)),{env,fetcher:s.fetcher})).status,401);
});

test("con llave válida: pendientes, pdf, empezar y terminar", async()=>{
 const {handler,huella}=await cargar();const s=simulado(await huella(LLAVE));
 const p=await (await handler(pedir({accion:"pendientes"}),{env,fetcher:s.fetcher})).json();
 assert.equal(p.pendientes.length,1);
 const pdf=await (await handler(pedir({accion:"pdf",id:ID}),{env,fetcher:s.fetcher})).json();
 assert.equal(Buffer.from(pdf.pdf,"base64").toString(),"%PDF");
 assert.deepEqual(await (await handler(pedir({accion:"empezar",id:ID}),{env,fetcher:s.fetcher})).json(),{tomado:true});
 const t=await handler(pedir({accion:"terminar",id:ID,estado:"CREADO",resultado:{ok:true},stel_id:123,stel_referencia:"ABP09999"}),{env,fetcher:s.fetcher});
 assert.deepEqual(await t.json(),{anotado:true});
 const parche=s.llamadas.filter(l=>l.metodo==="PATCH");
 assert.match(parche[0].url,/estado=eq\.PENDIENTE/);assert.match(parche[1].url,/estado=eq\.PROCESANDO/);
 assert.equal(JSON.parse(parche[1].cuerpo).estado,"CREADO");
});

test("estado final no permitido, identificador raro o acción desconocida: rechazado", async()=>{
 const {handler,huella}=await cargar();const s=simulado(await huella(LLAVE));
 assert.equal((await handler(pedir({accion:"terminar",id:ID,estado:"PENDIENTE"}),{env,fetcher:s.fetcher})).status,400);
 assert.equal((await handler(pedir({accion:"pdf",id:"../../otra"}),{env,fetcher:s.fetcher})).status,400);
 assert.equal((await handler(pedir({accion:"borrar",id:ID}),{env,fetcher:s.fetcher})).status,400);
 assert.ok(!s.llamadas.some(l=>l.metodo==="DELETE"));
});

test("PDF de un albarán ya creado o con ruta rara: no se entrega", async()=>{
 const {handler,huella}=await cargar();
 for(const fila of [{estado:"CREADO",pdf_ruta:"f".repeat(64)+".pdf"},{estado:"PENDIENTE",pdf_ruta:"../secreto.pdf"}]){
  const s=simulado(await huella(LLAVE),{fila});
  assert.equal((await handler(pedir({accion:"pdf",id:ID}),{env,fetcher:s.fetcher})).status,404);
 }
});
