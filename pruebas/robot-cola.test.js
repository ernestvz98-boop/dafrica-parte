"use strict";
// Puerta del robot a la cola (supabase/functions/robot-cola). Supabase simulado en memoria, datos ficticios.
const test=require("node:test"),assert=require("node:assert/strict");
const ID="11111111-2222-3333-4444-555555555555",ID2="66666666-7777-8888-9999-aaaaaaaaaaaa";
const OP="99999999-8888-7777-6666-555555555555";
const LLAVE="a".repeat(48);
const PLAN={numero:"F-1",lineas:[{cantidad:2}],pdf:{individual:true,sha256:"f".repeat(64)}};

async function cargar(){return import("../supabase/functions/robot-cola/handler.mjs");}
/** BD en memoria: stel_cola, stel_autorizaciones, stel_sync_log y robot_llaves. */
async function simulado({fila={},autorizacion={}}={}){
 const {huella,canonico}=await cargar();
 const llaveValida=await huella(LLAVE);
 const cola=[{id:ID,clave:"9001|1|2026-10-22",estado:"PENDIENTE",plan:PLAN,pdf_ruta:"f".repeat(64)+".pdf",pdf_sha256:"f".repeat(64),intentos:0,creado_en:"1",...fila},
  {id:ID2,clave:"9001|2|2026-10-22",estado:"PENDIENTE",plan:{numero:"F-2",lineas:[]},pdf_ruta:"e".repeat(64)+".pdf",pdf_sha256:"e".repeat(64),intentos:0,creado_en:"2"}];
 const aut=[{cola_id:ID,operacion_id:OP,estado:"VIGENTE",huella_plan:await huella(canonico(PLAN)),pdf_sha256:"f".repeat(64),autorizado_por:"u",autorizado_en:"t",...autorizacion}];
 const log=[],llamadas=[];
 const filtro=(u,lista)=>lista.filter(x=>[...u.searchParams].every(([k,v])=>{
  if(["select","order","limit"].includes(k)||k.includes("."))return true;
  const [op,val]=[v.slice(0,v.indexOf(".")),v.slice(v.indexOf(".")+1)];
  return op==="eq"?String(x[k])===val:op==="gt"?String(x[k])>val:true;
 }));
 const fetcher=async(url,op={})=>{
  const u=new URL(url),m=op.method||"GET";llamadas.push(m+" "+u.pathname);
  const t=u.pathname.split("/").pop();
  if(t==="robot_llaves")return new Response(JSON.stringify(u.searchParams.get("huella")==="eq."+llaveValida?[{huella:llaveValida}]:[]));
  if(u.pathname.includes("/storage/v1/object/albaranes-stel/"))return new Response(new Uint8Array([37,80,68,70]));
  if(t==="stel_sync_log"){log.push(JSON.parse(op.body));return new Response("",{status:201});}
  const tabla={stel_cola:cola,stel_autorizaciones:aut}[t];
  if(!tabla)return new Response("[]");
  const sel=filtro(u,tabla);
  if(m==="PATCH"){const c=JSON.parse(op.body);sel.forEach(x=>Object.assign(x,c));return new Response(JSON.stringify(sel));}
  if(t==="stel_cola"&&(u.searchParams.get("select")||"").includes("stel_autorizaciones!inner"))
   return new Response(JSON.stringify(sel.map(x=>({...x,stel_autorizaciones:aut.filter(a=>a.cola_id===x.id&&a.estado==="VIGENTE")})).filter(x=>x.stel_autorizaciones.length)));
  return new Response(JSON.stringify(sel));
 };
 return {fetcher,llamadas,log,cola,aut};
}
const env=k=>({SUPABASE_URL:"https://ficticio.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"servicio-ficticio"})[k];
const pedir=(cuerpo,llave=LLAVE)=>new Request("https://x/robot-cola",{method:"POST",headers:{"x-robot-llave":llave},body:JSON.stringify(cuerpo)});
const llamar=async(s,cuerpo,llave)=>{const {handler}=await cargar();const r=await handler(pedir(cuerpo,llave),{env,fetcher:s.fetcher});return {status:r.status,json:await r.json()};};

test("sin llave, con llave mal formada o caducada: 401", async()=>{
 const {handler}=await cargar();const s=await simulado();
 assert.equal((await handler(new Request("https://x",{method:"POST",body:"{}"}),{env,fetcher:s.fetcher})).status,401);
 assert.equal((await llamar(s,{accion:"pendientes"},"corta")).status,401);
 assert.equal((await llamar(s,{accion:"pendientes"},"b".repeat(48))).status,401);
});

test("pendientes: solo los PENDIENTE con autorización vigente de su plan y PDF exactos", async()=>{
 const s=await simulado();
 const r=(await llamar(s,{accion:"pendientes"})).json;
 assert.deepEqual(r.pendientes.map(x=>x.id),[ID]);
 assert.equal(r.pendientes[0].autorizacion.operacion_id,OP);
 assert.equal(r.pendientes[0].stel_autorizaciones,undefined);
 // Plan cambiado después de autorizar: no se entrega y queda anotado.
 const s2=await simulado({fila:{plan:{...PLAN,numero:"F-1B"}}});
 const r2=(await llamar(s2,{accion:"pendientes"})).json;
 assert.deepEqual(r2.pendientes,[]);assert.equal(r2.descartados[0].motivo,"El plan no es el autorizado");
 assert.equal(s2.log[0].estado,"DESCARTADO");
 const s3=await simulado({autorizacion:{pdf_sha256:"0".repeat(64)}});
 assert.equal((await llamar(s3,{accion:"pendientes"})).json.descartados[0].motivo,"El PDF no es el autorizado");
});

test("empezar consume la autorización una vez; la misma operación no se toma dos veces", async()=>{
 const s=await simulado();
 assert.equal((await llamar(s,{accion:"empezar",id:ID})).status,400);
 const r=(await llamar(s,{accion:"empezar",id:ID,operacion_id:OP})).json;
 assert.deepEqual(r,{tomado:true,registro:true});
 assert.equal(s.aut[0].estado,"USADA");assert.equal(s.cola[0].estado,"PROCESANDO");assert.equal(s.cola[0].intentos,1);
 assert.deepEqual((await llamar(s,{accion:"empezar",id:ID,operacion_id:OP})).json,{tomado:false,motivo:"Sin autorización vigente"});
 assert.equal((await llamar(s,{accion:"empezar",id:ID2,operacion_id:OP})).json.tomado,false);
 const e=s.log.find(x=>x.tipo_sync==="ROBOT_EMPEZAR"&&x.estado==="PROCESANDO");
 assert.deepEqual([e.cola_id,e.detalle.estado_anterior,e.detalle.estado_nuevo,e.detalle.operacion_id,e.detalle.intentos],[ID,"PENDIENTE","PROCESANDO",OP,1]);
});

test("terminar: solo desde PROCESANDO, y el registro guarda estado anterior y nuevo, operación e identificador de STEL", async()=>{
 const s=await simulado();
 await llamar(s,{accion:"empezar",id:ID,operacion_id:OP});
 const t=(await llamar(s,{accion:"terminar",id:ID,estado:"CREADO",operacion_id:OP,resultado:{motivo:null,revisado_por:"Persona Ficticia"},stel_id:123,stel_referencia:"ABP09999"})).json;
 assert.deepEqual(t,{anotado:true,registro:true});
 assert.equal(s.cola[0].estado,"CREADO");assert.equal(s.cola[0].stel_id,123);
 const l=s.log.find(x=>x.tipo_sync==="ROBOT_TERMINAR");
 assert.deepEqual([l.estado,l.detalle.estado_anterior,l.detalle.estado_nuevo,l.detalle.stel_id,l.detalle.operacion_id,l.detalle.revisado_por],["CREADO","PROCESANDO","CREADO",123,OP,"Persona Ficticia"]);
 // Repetir «terminar» no cambia nada (ya no está PROCESANDO).
 assert.equal((await llamar(s,{accion:"terminar",id:ID,estado:"ERROR",resultado:{}})).json.anotado,false);
 assert.equal(s.cola[0].estado,"CREADO");
});

test("en_proceso y registrar: interrumpidos para comprobar en STEL y eventos del robot", async()=>{
 const s=await simulado({fila:{estado:"PROCESANDO"}});
 assert.deepEqual((await llamar(s,{accion:"en_proceso"})).json.en_proceso.map(x=>x.id),[ID]);
 assert.deepEqual((await llamar(s,{accion:"registrar",evento:"SESION_STEL_CADUCADA",detalle:{equipo:"robot"}})).json,{anotado:true});
 assert.equal((await llamar(s,{accion:"registrar",evento:"BORRAR_TODO"})).status,400);
 assert.equal((await llamar(s,{accion:"registrar",evento:"INICIO",detalle:{x:"z".repeat(5000)}})).status,413);
});

test("estado final no permitido, identificador raro o acción desconocida: rechazado; nunca borra", async()=>{
 const s=await simulado();
 assert.equal((await llamar(s,{accion:"terminar",id:ID,estado:"PENDIENTE"})).status,400);
 assert.equal((await llamar(s,{accion:"pdf",id:"../../otra"})).status,400);
 assert.equal((await llamar(s,{accion:"borrar",id:ID})).status,400);
 assert.ok(!s.llamadas.some(l=>l.startsWith("DELETE")));
});

test("PDF de un albarán ya creado o con ruta rara: no se entrega", async()=>{
 for(const fila of [{estado:"CREADO"},{estado:"PENDIENTE",pdf_ruta:"../secreto.pdf"}]){
  const s=await simulado({fila});
  assert.equal((await llamar(s,{accion:"pdf",id:ID})).status,404);
 }
 const s=await simulado();
 assert.equal(Buffer.from((await llamar(s,{accion:"pdf",id:ID})).json.pdf,"base64").toString(),"%PDF");
});

test("la huella canónica es la misma que la de la aplicación y el robot", async()=>{
 const {canonico}=await cargar();
 assert.equal(canonico({b:1,a:{d:[1,{z:1,y:null}],c:"ñ"}}),'{"a":{"c":"ñ","d":[1,{"y":null,"z":1}]},"b":1}');
});
