/*
 * DAFRICA · Puerta del robot de STEL a la cola de albaranes (Fase 2, aprobada por el usuario el
 * 2026-10-26). No es para el navegador: sin CORS. Exige la cabecera «x-robot-llave» con una llave
 * temporal cuya huella SHA-256 está en robot_llaves y no ha caducado (la llave solo existe en el
 * entorno privado del robot). Con la clave de servicio, y solo esto:
 *  - {accion:"pendientes"}: hasta 20 albaranes PENDIENTE (orden, PDF y páginas).
 *  - {accion:"pdf", id}: el PDF del albarán (base64), solo si está PENDIENTE o PROCESANDO.
 *  - {accion:"empezar", id}: PENDIENTE → PROCESANDO (uno solo lo toma).
 *  - {accion:"terminar", id, estado, resultado, stel_id?, stel_referencia?}: PROCESANDO → CREADO,
 *    PARADO o ERROR.
 * Nunca borra ni cambia la orden (plan) ni toca otras tablas.
 */
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const RE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINALES=["CREADO","PARADO","ERROR"];

export async function huella(texto){
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(texto));
 return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

export async function handler(req,{env,fetcher=fetch}={}){
 if(req.method!=="POST")return reply({error:"Método no permitido"},405);
 const base=env("SUPABASE_URL")||"",servicio=env("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!base||!servicio)return reply({error:"Configuración incompleta"},503);
 const cab={apikey:servicio,Authorization:"Bearer "+servicio,"Content-Type":"application/json"};
 const db=async(ruta,op={})=>{
  const r=await fetcher(base+"/rest/v1/"+ruta,{...op,headers:{...cab,...(op.headers||{})},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Object.assign(new Error("BD "+r.status),{status:503});
  const t=await r.text();return t?JSON.parse(t):null;
 };
 try{
  const llave=req.headers.get("x-robot-llave")||"";
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(llave))return reply({error:"Llave no válida"},401);
  const h=await huella(llave);
  const ok=await db("robot_llaves?select=huella&huella=eq."+h+"&expira=gt."+encodeURIComponent(new Date().toISOString()));
  if(!Array.isArray(ok)||ok.length!==1)return reply({error:"Llave no válida o caducada"},401);
  const b=await req.json().catch(()=>null);
  if(!b||typeof b!=="object")return reply({error:"Petición no válida"},400);
  if(b.accion==="pendientes"){
   const filas=await db("stel_cola?select=id,clave,plan,pdf_ruta,pdf_sha256,intentos&estado=eq.PENDIENTE&order=creado_en.asc&limit=20");
   return reply({pendientes:filas||[]});
  }
  if(!RE_ID.test(String(b.id||"")))return reply({error:"Identificador no válido"},400);
  if(b.accion==="pdf"){
   const f=await db("stel_cola?select=pdf_ruta,estado&id=eq."+b.id);
   const fila=f?.[0];
   if(!fila||!["PENDIENTE","PROCESANDO"].includes(fila.estado)||!/^[0-9a-f]{64}\.pdf$/.test(fila.pdf_ruta||""))return reply({error:"PDF no disponible"},404);
   const r=await fetcher(base+"/storage/v1/object/albaranes-stel/"+fila.pdf_ruta,{headers:{apikey:servicio,Authorization:"Bearer "+servicio},signal:AbortSignal.timeout(30000)});
   if(!r.ok)return reply({error:"PDF no disponible"},404);
   const bytes=new Uint8Array(await r.arrayBuffer());
   let s="";for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return reply({pdf:btoa(s)});
  }
  if(b.accion==="empezar"){
   const f=await db("stel_cola?id=eq."+b.id+"&estado=eq.PENDIENTE&select=id",{method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({estado:"PROCESANDO",actualizado_en:new Date().toISOString()})});
   return reply({tomado:Array.isArray(f)&&f.length===1});
  }
  if(b.accion==="terminar"){
   if(!FINALES.includes(b.estado))return reply({error:"Estado no válido"},400);
   const res=JSON.stringify(b.resultado??null);
   if(res.length>100000)return reply({error:"Resultado demasiado grande"},413);
   const cambio={estado:b.estado,resultado:b.resultado??null,actualizado_en:new Date().toISOString(),
    stel_id:Number.isSafeInteger(b.stel_id)?b.stel_id:null,stel_referencia:typeof b.stel_referencia==="string"?b.stel_referencia.slice(0,40):null};
   const f=await db("stel_cola?id=eq."+b.id+"&estado=eq.PROCESANDO&select=id",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(cambio)});
   return reply({anotado:Array.isArray(f)&&f.length===1});
  }
  return reply({error:"Acción no permitida"},400);
 }catch(e){return reply({error:"No se pudo completar"},e?.status||502);}
}
