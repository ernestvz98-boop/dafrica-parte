/*
 * DAFRICA · Puerta del robot de STEL a la cola de albaranes (Fase 2, aprobada por el usuario el
 * 2026-10-26). No es para el navegador: sin CORS. Exige la cabecera «x-robot-llave» con una llave
 * temporal cuya huella SHA-256 está en robot_llaves y no ha caducado (la llave solo existe en el
 * entorno privado del robot). Con la clave de servicio, y solo esto:
 *  - {accion:"pendientes"}: hasta 20 albaranes PENDIENTE con una AUTORIZACIÓN VIGENTE de una persona
 *    (stel_autorizaciones) cuyo plan y PDF son exactamente los autorizados (huella SHA-256 del plan en
 *    forma canónica y del PDF). Los que no cuadran no se entregan (`descartados`, con el motivo).
 *  - {accion:"pdf", id}: el PDF del albarán (base64), solo si está PENDIENTE o PROCESANDO.
 *  - {accion:"empezar", id, operacion_id}: consume la autorización (una vez) y pasa PENDIENTE → PROCESANDO.
 *  - {accion:"terminar", id, estado, resultado, stel_id?, stel_referencia?, operacion_id?}: PROCESANDO →
 *    CREADO, PARADO o ERROR.
 *  - {accion:"en_proceso"}: los PROCESANDO (una ejecución interrumpida): el robot comprueba en STEL qué pasó
 *    antes de nada; nunca los vuelve a crear solo por haber expirado un tiempo de espera.
 *  - {accion:"registrar", evento, detalle?, id?}: anota en stel_sync_log lo que hace el robot.
 * Cada cambio de estado queda en stel_sync_log (estado anterior y nuevo, operación, resultado).
 * Nunca borra ni cambia la orden (plan) ni toca otras tablas.
 */
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const RE_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINALES=["CREADO","PARADO","ERROR"];
const EVENTOS=["INICIO","FIN","SESION_STEL_CADUCADA","SIN_CONEXION","STEL_NO_RESPONDE","RECUPERACION","DESCARTADO","PREPARACION","ERROR"];

export async function huella(texto){
 const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(texto));
 return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
/** JSON con las claves ordenadas: la misma forma que la aplicación y el robot (robot-dafrica.js). */
export function canonico(v){
 if(Array.isArray(v))return "["+v.map(canonico).join(",")+"]";
 if(v&&typeof v==="object")return "{"+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+":"+canonico(v[k])).join(",")+"}";
 return JSON.stringify(v===undefined?null:v);
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
 // Registro de sincronizaciones: si no se puede anotar, la respuesta lo dice (registro:false).
 const registrar=async(tipo,estado,cola,detalle,error=null)=>{
  try{await db("stel_sync_log",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({tipo_sync:tipo,estado,cola_id:cola||null,
   detalle:detalle||null,error:error?String(error).slice(0,500):null,finalizado_en:new Date().toISOString()})});return true;}
  catch{return false;}
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
   const filas=await db("stel_cola?select=id,clave,plan,pdf_ruta,pdf_sha256,intentos,stel_autorizaciones!inner(operacion_id,huella_plan,pdf_sha256,autorizado_por,autorizado_en)"+
    "&estado=eq.PENDIENTE&stel_autorizaciones.estado=eq.VIGENTE&order=creado_en.asc&limit=20");
   const pendientes=[],descartados=[];
   for(const f of filas||[]){
    const a=Array.isArray(f.stel_autorizaciones)?f.stel_autorizaciones:[];
    const {stel_autorizaciones:_,...fila}=f;
    let motivo=null;
    if(a.length!==1)motivo="Sin una única autorización vigente";
    else if(await huella(canonico(f.plan))!==a[0].huella_plan)motivo="El plan no es el autorizado";
    else if(!f.pdf_sha256||a[0].pdf_sha256!==f.pdf_sha256)motivo="El PDF no es el autorizado";
    if(motivo){descartados.push({id:f.id,motivo});await registrar("ROBOT","DESCARTADO",f.id,{motivo});continue;}
    pendientes.push({...fila,autorizacion:{operacion_id:a[0].operacion_id,autorizado_por:a[0].autorizado_por,autorizado_en:a[0].autorizado_en}});
   }
   return reply({pendientes,descartados});
  }
  if(b.accion==="en_proceso"){
   const filas=await db("stel_cola?select=id,clave,plan,pdf_ruta,pdf_sha256,intentos,actualizado_en&estado=eq.PROCESANDO&order=actualizado_en.asc&limit=50");
   return reply({en_proceso:filas||[]});
  }
  if(b.accion==="registrar"){
   if(!EVENTOS.includes(b.evento))return reply({error:"Evento no válido"},400);
   if(b.id!=null&&!RE_ID.test(String(b.id)))return reply({error:"Identificador no válido"},400);
   const detalle=b.detalle&&typeof b.detalle==="object"?b.detalle:null;
   if(detalle&&JSON.stringify(detalle).length>4000)return reply({error:"Detalle demasiado grande"},413);
   return reply({anotado:await registrar("ROBOT",b.evento,b.id||null,detalle)});
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
   if(!RE_ID.test(String(b.operacion_id||"")))return reply({error:"Operación no válida"},400);
   // 1) La autorización se consume (una sola vez): una segunda ejecución con la misma operación no toma nada.
   const ahora=new Date().toISOString();
   const a=await db("stel_autorizaciones?operacion_id=eq."+b.operacion_id+"&cola_id=eq."+b.id+"&estado=eq.VIGENTE&select=operacion_id",
    {method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({estado:"USADA",usada_en:ahora})});
   if(!Array.isArray(a)||a.length!==1){await registrar("ROBOT_EMPEZAR","SIN_AUTORIZACION",b.id,{operacion_id:b.operacion_id});return reply({tomado:false,motivo:"Sin autorización vigente"});}
   // 2) PENDIENTE → PROCESANDO, con el número de intentos.
   const actual=(await db("stel_cola?select=intentos,estado&id=eq."+b.id))?.[0];
   const f=actual?.estado==="PENDIENTE"?await db("stel_cola?id=eq."+b.id+"&estado=eq.PENDIENTE&select=id,intentos",{method:"PATCH",headers:{Prefer:"return=representation"},
    body:JSON.stringify({estado:"PROCESANDO",intentos:(actual.intentos||0)+1,actualizado_en:ahora})}):[];
   const tomado=Array.isArray(f)&&f.length===1;
   const registro=await registrar("ROBOT_EMPEZAR",tomado?"PROCESANDO":"NO_TOMADO",b.id,
    {operacion_id:b.operacion_id,estado_anterior:actual?.estado||null,estado_nuevo:tomado?"PROCESANDO":actual?.estado||null,intentos:tomado?f[0].intentos:actual?.intentos??null});
   return reply({tomado,registro});
  }
  if(b.accion==="terminar"){
   if(!FINALES.includes(b.estado))return reply({error:"Estado no válido"},400);
   const res=JSON.stringify(b.resultado??null);
   if(res.length>100000)return reply({error:"Resultado demasiado grande"},413);
   const cambio={estado:b.estado,resultado:b.resultado??null,actualizado_en:new Date().toISOString(),
    stel_id:Number.isSafeInteger(b.stel_id)?b.stel_id:null,stel_referencia:typeof b.stel_referencia==="string"?b.stel_referencia.slice(0,40):null};
   const f=await db("stel_cola?id=eq."+b.id+"&estado=eq.PROCESANDO&select=id,intentos",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(cambio)});
   const anotado=Array.isArray(f)&&f.length===1;
   const registro=await registrar("ROBOT_TERMINAR",anotado?b.estado:"NO_ANOTADO",b.id,{operacion_id:RE_ID.test(String(b.operacion_id||""))?b.operacion_id:null,
    estado_anterior:"PROCESANDO",estado_nuevo:anotado?b.estado:null,stel_id:cambio.stel_id,stel_referencia:cambio.stel_referencia,intentos:anotado?f[0].intentos:null,
    motivo:typeof b.resultado?.motivo==="string"?b.resultado.motivo.slice(0,300):null,revisado_por:typeof b.resultado?.revisado_por==="string"?b.resultado.revisado_por.slice(0,120):null,
    escrituras:Array.isArray(b.resultado?.escrituras)?b.resultado.escrituras.slice(0,20):null},b.estado==="ERROR"?b.resultado?.motivo:null);
   return reply({anotado,registro});
  }
  return reply({error:"Acción no permitida"},400);
 }catch(e){return reply({error:"No se pudo completar"},e?.status||502);}
}
