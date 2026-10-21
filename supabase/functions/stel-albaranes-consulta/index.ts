import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/*
 * DAFRICA · Consulta de SOLO LECTURA de un albarán de compra de STEL por su referencia completa
 * («ABP26-1234»). Exige sesión con permiso costes.ver. Solo GET a STEL; no guarda nada.
 * 2026-10-21: añadido diagnóstico (sin coincidencia exacta: cuántos albaranes devolvió STEL y el
 * formato de las primeras referencias), para saber si STEL aplica el filtro.
 */
const cors={
  "Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const headers={...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function reply(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(req.method!=="POST")return reply({error:"Método no permitido"},405);
  try{
    const token=req.headers.get("Authorization")||"";
    if(!token.startsWith("Bearer "))return reply({error:"Identificación requerida"},401);
    const base=Deno.env.get("SUPABASE_URL")||"";
    const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const stelKey=Deno.env.get("STEL_API_KEY")||"";
    if(!base||!serviceKey)return reply({error:"Configuración de Supabase incompleta"},503);
    const u=await fetch(base+"/auth/v1/user",{headers:{Authorization:token,apikey:serviceKey},signal:AbortSignal.timeout(10000)});
    if(!u.ok)return reply({error:"Sesión no autorizada"},401);
    const p=await fetch(base+"/rest/v1/rpc/mis_permisos",{
      method:"POST",headers:{Authorization:token,apikey:serviceKey,"Content-Type":"application/json"},
      body:"{}",signal:AbortSignal.timeout(10000)
    });
    if(!p.ok)return reply({error:"No se pudieron comprobar los permisos"},403);
    const permissions=await p.json();
    if(!Array.isArray(permissions)||!permissions.some((x:any)=>x.codigo==="costes.ver"))
      return reply({error:"Sin permiso de consulta de albaranes"},403);
    if(!stelKey)return reply({error:"STEL_API_KEY no está configurada"},503);
    const body=await req.json().catch(()=>({}));
    const fullReference=String(body.fullReference||"").trim().toUpperCase();
    if(!/^[A-Z0-9._\/-]{3,42}$/.test(fullReference))
      return reply({error:"Introduce una referencia STEL válida, por ejemplo ABP241999"},400);
    const url=new URL("https://app.stelorder.com/app/purchaseDeliveryNotes");
    url.searchParams.set("full-reference",fullReference);
    url.searchParams.set("limit","100");
    const response=await fetch(url,{
      headers:{APIKEY:stelKey,Accept:"application/json; charset=utf-8"},
      signal:AbortSignal.timeout(18000)
    });
    if(!response.ok)return reply({error:"No se pudo consultar STEL",stelStatus:response.status},502);
    const raw=await response.json();
    if(!Array.isArray(raw))return reply({error:"Formato de respuesta inesperado desde STEL"},502);
    const normalized=(v:unknown)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    const match=raw.filter((x:any)=>{
      const full=String(x["full-reference"]||x.fullReference||"").trim();
      if(full)return normalized(full)===normalized(fullReference);
      return false;
    });
    const documents=match.slice(0,30).map((x:any)=>({
      id:Number.isSafeInteger(Number(x.id))?Number(x.id):null,
      fullReference:String(x["full-reference"]||x.fullReference||""),
      reference:String(x.reference||""),
      date:String(x.date||""),
      title:String(x.title||""),
      supplier:String(x["account-name"]||x["supplier-name"]||x.account?.name||""),
      extraReference:String(x["extra-reference"]||x.extraReference||""),
      state:String(x["document-state"]||x.status||"")
    }));
    // Diagnóstico sin coincidencia: formato de las primeras referencias y campos disponibles.
    const diagnostico=documents.length?null:{
      muestra:raw.slice(0,5).map((x:any)=>({fullReference:String(x["full-reference"]??x.fullReference??""),reference:String(x.reference??""),date:String(x.date??"")})),
      campos:raw.length?Object.keys(raw[0]).filter(k=>!/price|amount|total|tax|discount|cost|iban|email|phone/i.test(k)).slice(0,40):[]
    };
    return reply({
      documents,
      checkedReference:fullReference,
      checkedCount:raw.length,
      exactMatch:documents.length>0,
      exhaustive:false,
      diagnostico,
      note:documents.length?"Albarán encontrado por referencia exacta":"No se encontró coincidencia en la respuesta filtrada. Esto no acredita por sí solo la inexistencia del albarán."
    });
  }catch{
    return reply({error:"La consulta no pudo completarse. Revisa la conexión con STEL."},502);
  }
});
