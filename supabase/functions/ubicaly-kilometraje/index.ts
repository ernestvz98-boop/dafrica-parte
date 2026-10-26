import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const projectUrl = Deno.env.get("SUPABASE_URL") || "https://sbocfjxamjmwabmqbeyw.supabase.co";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const responseHeaders = { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info" };
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:responseHeaders});}
function ymRange(ym:string){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error("Mes inválido: utiliza AAAA-MM");
 const [y,m]=ym.split("-").map(Number);
 const first=Date.UTC(y,m-1,1)-2*60*60*1000;
 const last=Date.UTC(y,m,1)+24*60*60*1000;
 return {from:first,to:last};
}
async function ub(path:string){
 const key=Deno.env.get("UBICALY_API_KEY");
 const base=(Deno.env.get("UBICALY_API_BASE_URL")||"").replace(/\/$/,"");
 if(!key || !base) throw new Error("UBICALY_NOT_CONFIGURED");
 const url=new URL(path,base+"/");
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),25000);
 try {
  const r=await fetch(url,{headers:{Authorization:"Bearer "+key,Accept:"application/json"},signal:controller.signal});
  if(!r.ok)throw new Error("Ubicaly HTTP "+r.status);
  return await r.json();
 }finally{clearTimeout(timeout);}
}
async function authorized(req:Request){
 const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!jwt||!anonKey)return false;
 const h={apikey:anonKey,authorization:"Bearer "+jwt};
 const me=await fetch(projectUrl+"/auth/v1/user",{headers:h});
 if(!me.ok)return false;
 const pr=await fetch(projectUrl+"/rest/v1/rpc/mis_permisos",{method:"POST",headers:{...h,"Content-Type":"application/json"},body:"{}"});
 if(!pr.ok)return false;
 const rows=await pr.json();
 return Array.isArray(rows)&&rows.some((p:any)=>p.codigo==="vehiculos.ver");
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:responseHeaders});
 if(req.method!=="POST")return json({error:"Método no permitido"},405);
 try {
  if(!await authorized(req))return json({error:"Acceso no autorizado al módulo Vehículos"},403);
  const body=await req.json().catch(()=>({}));
  const month=String(body.month||"");
  const {from,to}=ymRange(month);
  const vehicles=await ub("/v3/company/vehicles");
  if(!Array.isArray(vehicles))throw new Error("La lista de vehículos no tiene el formato esperado");
  const results=[] as any[];
  for(const v of vehicles.slice(0,200)){
   const vehicleId=v.vehicleId??v.id;
   if(vehicleId==null)continue;
   try{
    const qs=new URLSearchParams({from_ts:String(from),to_ts:String(to)});
    const tracks=await ub("/v3/company/vehicles/id/"+encodeURIComponent(String(vehicleId))+"/historical/tracks?"+qs);
    if(!Array.isArray(tracks))throw new Error("Formato inesperado de recorridos");
    const seen=new Set<string>();let meters=0, trips=0;let earliest=Infinity,latest=-Infinity;
    for(const t of tracks){
     const id=String(t.trackId??"");if(!id||seen.has(id))continue;seen.add(id);
     const ts=Number(t.startTs);const d=Number(t.distance);
     if(!Number.isFinite(ts)||ts<from||ts>=to||!Number.isFinite(d)||d<0)continue;
     meters+=d;trips++;earliest=Math.min(earliest,ts);latest=Math.max(latest,Number(t.endTs||ts));
    }
    results.push({vehicleId,name:v.name||"",plate:v.plate||"",month,km:Math.round(meters/10)/100,trips,firstTrip:trips?new Date(earliest).toISOString():null,lastTrip:trips?new Date(latest).toISOString():null,status:trips?"registrado_no_verificado":"sin_trayectos",warning:"Verificar cobertura histórica y límites de mes. La distancia procede de recorridos por fecha de inicio."});
   }catch(e){results.push({vehicleId,name:v.name||"",plate:v.plate||"",month,km:null,trips:0,status:"error",error:e instanceof Error?e.message:"Error de consulta"});}
  }
  return json({month,vehicles:results,source:"Ubicaly AIKO",unit:"km",note:"No se almacenan rutas. Totales provisionales basados en fechas de inicio de trayectos; revisar cobertura del período."});
 }catch(e){
  const m=e instanceof Error?e.message:"Error desconocido";
  return json({error:m==="UBICALY_NOT_CONFIGURED"?"Pendiente configurar UBICALY_API_BASE_URL y UBICALY_API_KEY en Supabase":m},m==="UBICALY_NOT_CONFIGURED"?503:400);
 }
});
