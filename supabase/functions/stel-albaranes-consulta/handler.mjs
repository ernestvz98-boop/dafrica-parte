/*
 * DAFRICA · Consulta de SOLO LECTURA de albaranes de compra de STEL. Exige sesión con permiso
 * costes.ver. Solo GET a STEL; no guarda nada y no devuelve precios ni importes.
 *
 * Dos modos:
 * - {fullReference: "ABP26-1234"}: el albarán con esa referencia (validar un código manuscrito).
 * - {buscar: {cuentas: [id STEL del proveedor…], desde: "AAAA-MM-DD", hasta: "AAAA-MM-DD", pista}}:
 *   los albaranes de compra de esos proveedores con fecha en el intervalo. En STEL su título
 *   lleva el número del albarán del proveedor, la fecha y la obra («123.456 03/03/2026 OBRA FICTICIA»),
 *   así que el navegador encuentra el ABP de un albarán leído sin depender de la letra a mano.
 *   Primero se prueba el filtro por cuenta de STEL y se COMPRUEBA que se ha aplicado (todas las
 *   filas de esa cuenta); si STEL lo ignora, se leen los albaranes más recientes desde el final de
 *   la lista (STEL pagina del más antiguo al más nuevo), de una consulta en una.
 * 2026-10-21: v4 (modo buscar). Versiones anteriores: solo fullReference.
 */
const cors={"Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const BASE="https://app.stelorder.com/app/purchaseDeliveryNotes";
const dia=v=>String(v||"").slice(0,10);
const RE_DIA=/^\d{4}-\d{2}-\d{2}$/;

// Lo que sale de STEL hacia el navegador: identificación, fecha, proveedor y título (sin importes).
export function resumen(x){
 return {id:Number.isSafeInteger(Number(x.id))?Number(x.id):null,
  fullReference:String(x["full-reference"]||x.fullReference||""),reference:String(x.reference||""),
  date:String(x.date||""),title:String(x.title||"").slice(0,160),
  supplier:String(x["account-name"]||x["supplier-name"]||x.account?.name||""),
  accountId:x["account-id"]??x.accountId??x.account?.id??null,
  extraReference:String(x["extra-reference"]||x.extraReference||""),
  state:String(x["document-state"]||x.status||"")};
}

// GET con reintentos: STEL responde 403/429 cuando se agota su cupo o hay consultas simultáneas.
// maxConsultas: tope por llamada (cupo de STEL y tiempo máximo de la función).
function cliente(fetcher,clave,{esperas=[1500,4000],dormir=ms=>new Promise(r=>setTimeout(r,ms)),maxConsultas=70}={}){
 const estado={consultas:0};
 const get=async params=>{
  if(estado.consultas>=maxConsultas)throw Error("limite_consultas");
  const url=new URL(BASE);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
  let r;
  for(let intento=0;;intento++){
   estado.consultas++;
   r=await fetcher(url.href,{method:"GET",headers:{APIKEY:clave,Accept:"application/json; charset=utf-8"},signal:AbortSignal.timeout(18000)});
   if(r.ok||!(r.status===403||r.status===429||r.status>=500)||intento>=esperas.length)break;
   await dormir(esperas[intento]);
  }
  if(!r.ok)throw Error("STEL "+r.status);
  const lista=await r.json();
  if(!Array.isArray(lista))throw Error("Formato inesperado");
  return lista;
 };
 return {get,estado};
}

/*
 * Albaranes de compra de las cuentas `cuentas` con fecha en [desde, hasta].
 * Devuelve {metodo, completo, notas, consultas, total?, motivo?}.
 */
export async function buscarNotas(fetcher,clave,{cuentas=[],desde,hasta,pista=null,maxPaginas=20,tam=100,...opciones}){
 const {get,estado}=cliente(fetcher,clave,opciones);
 const enIntervalo=x=>dia(x.date)>=desde&&dia(x.date)<=hasta;
 const delasCuentas=new Set(cuentas.map(String));
 const fin=(metodo,completo,notas,extra={})=>({metodo,completo,notas:notas.map(resumen),consultas:estado.consultas,...extra});
 try{
  // 1. Filtro por cuenta, si STEL lo aplica de verdad.
  let aplicado=null;
  for(const c of cuentas){
   const p=await get({"account-id":c,limit:tam,start:0});
   if(!p.length)continue;
   // Aplicado de verdad: todas sus filas son de la cuenta y, sin filtro, la lista tiene otras.
   aplicado=p.every(x=>String(x["account-id"])===String(c))&&(await get({limit:tam,start:0})).some(x=>String(x["account-id"])!==String(c));
   if(!aplicado)break;
   const notas=[];
   for(const cuenta of cuentas){
    let filas=cuenta===c?p:await get({"account-id":cuenta,limit:tam,start:0}),paginas=1;
    if(!filas.every(x=>String(x["account-id"])===String(cuenta)))return fin("filtro_cuenta",false,[],{motivo:"filtro_inconsistente"});
    notas.push(...filas.filter(enIntervalo));
    while(filas.length===tam){
     if(paginas>=maxPaginas)return fin("filtro_cuenta",false,notas,{motivo:"limite_paginas"});
     filas=await get({"account-id":cuenta,limit:tam,start:paginas*tam});paginas++;
     notas.push(...filas.filter(enIntervalo));
    }
   }
   return fin("filtro_cuenta",true,notas);
  }
  // 2. Sin filtro: final de la lista (galope desde la pista y búsqueda binaria) y lectura hacia atrás.
  const hay=async n=>n>=0&&(await get({limit:1,start:n})).length>0;
  let lo,hi;
  if(Number.isInteger(pista)&&pista>0&&await hay(pista-1)){
   lo=pista-1;let paso=50;hi=lo+paso;
   while(await hay(hi)){lo=hi;paso*=2;hi=lo+paso;if(paso>1e6)break;}
  }else{
   lo=-1;hi=1000;
   while(await hay(hi)){lo=hi;hi*=2;if(hi>2e6)break;}
  }
  while(hi-lo>1){const m=Math.floor((lo+hi)/2);if(await hay(m))lo=m;else hi=m;}
  const total=lo+1,notas=[];
  // Un albarán de esas fechas no puede haberse creado antes: se para cuando una página entera
  // se creó antes de `desde` (con 2 días de margen).
  const limite=new Date(Date.parse(desde)-2*864e5).toISOString().slice(0,10);
  let paginas=0;
  for(let inicio=Math.max(0,total-tam);;inicio=Math.max(0,inicio-tam)){
   if(paginas>=maxPaginas)return fin("recientes",false,notas,{total,motivo:"limite_paginas"});
   const filas=await get({limit:tam,start:inicio});paginas++;
   notas.push(...filas.filter(x=>enIntervalo(x)&&(!delasCuentas.size||delasCuentas.has(String(x["account-id"])))));
   const recientes=filas.some(x=>dia(x["creation-date"]||x.date)>=limite);
   if(inicio===0||!recientes)break;
  }
  return fin("recientes",true,notas,{total});
 }catch(e){return fin("error",false,[],{motivo:String(e?.message||e).slice(0,80)});}
}

async function autorizado(req,{fetcher,env}){
 const token=req.headers.get("Authorization")||req.headers.get("authorization")||"";
 if(!token.startsWith("Bearer "))return 401;
 const base=env("SUPABASE_URL")||"",serviceKey=env("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!base||!serviceKey)return 503;
 const u=await fetcher(base+"/auth/v1/user",{method:"GET",headers:{Authorization:token,apikey:serviceKey},signal:AbortSignal.timeout(10000)});
 if(!u.ok)return 401;
 const p=await fetcher(base+"/rest/v1/rpc/mis_permisos",{method:"POST",headers:{Authorization:token,apikey:serviceKey,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(10000)});
 if(!p.ok)return 403;
 const permisos=await p.json();
 return Array.isArray(permisos)&&permisos.some(x=>x.codigo==="costes.ver")?200:403;
}

export async function handler(req,{fetcher=fetch,env}={}){
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return reply({error:"Método no permitido"},405);
 try{
  const a=await autorizado(req,{fetcher,env});
  if(a!==200)return reply({error:{401:"Sesión no autorizada",403:"Sin permiso de consulta de albaranes",503:"Configuración de Supabase incompleta"}[a]},a);
  const stelKey=env("STEL_API_KEY")||"";
  if(!stelKey)return reply({error:"STEL_API_KEY no está configurada"},503);
  const body=await req.json().catch(()=>({}));
  if(body&&body.buscar){
   const b=body.buscar,cuentas=Array.isArray(b.cuentas)?b.cuentas:[];
   if(Object.keys(body).length!==1||cuentas.length>40||!cuentas.every(c=>Number.isSafeInteger(Number(c))&&String(c).length<=20)||
    !RE_DIA.test(b.desde||"")||!RE_DIA.test(b.hasta||"")||b.desde>b.hasta||Date.parse(b.hasta)-Date.parse(b.desde)>400*864e5||
    (b.pista!=null&&!(Number.isInteger(b.pista)&&b.pista>0&&b.pista<1e7)))
    return reply({error:"Búsqueda no válida"},400);
   const r=await buscarNotas(fetcher,stelKey,{cuentas:cuentas.map(Number),desde:b.desde,hasta:b.hasta,pista:b.pista??null});
   return reply({...r,solo_lectura:true});
  }
  const fullReference=String(body.fullReference||"").trim().toUpperCase();
  if(!/^[A-Z0-9._\/-]{3,42}$/.test(fullReference))
   return reply({error:"Introduce una referencia STEL válida, por ejemplo ABP241999"},400);
  const {get}=cliente(fetcher,stelKey,{esperas:[]});
  const raw=await get({"full-reference":fullReference,limit:100}).catch(e=>({error:String(e.message)}));
  if(!Array.isArray(raw))return reply({error:"No se pudo consultar STEL",stelStatus:Number(String(raw.error).replace(/\D/g,""))||null},502);
  const normalized=v=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  const documents=raw.filter(x=>{const full=String(x["full-reference"]||x.fullReference||"").trim();return !!full&&normalized(full)===normalized(fullReference);})
   .slice(0,30).map(resumen);
  // Diagnóstico: formato de las primeras referencias (sin coincidencia) y nombres de los campos
  // que devuelve STEL (sin importes ni datos de contacto).
  const diagnostico={
   muestra:documents.length?[]:raw.slice(0,5).map(x=>({fullReference:String(x["full-reference"]??x.fullReference??""),reference:String(x.reference??""),date:String(x.date??"")})),
   campos:raw.length?Object.keys(raw[0]).filter(k=>!/price|amount|total|tax|discount|cost|iban|email|phone/i.test(k)).slice(0,40):[]
  };
  return reply({documents,checkedReference:fullReference,checkedCount:raw.length,exactMatch:documents.length>0,exhaustive:false,diagnostico,
   note:documents.length?"Albarán encontrado por referencia exacta":"No se encontró coincidencia en la respuesta filtrada. Esto no acredita por sí solo la inexistencia del albarán."});
 }catch{
  return reply({error:"La consulta no pudo completarse. Revisa la conexión con STEL."},502);
 }
}
