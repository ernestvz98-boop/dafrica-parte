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
 *   filas de esa cuenta); si STEL lo ignora, se usa la lista sin filtro. En los dos casos se lee
 *   desde el FINAL de la lista (STEL pagina del más antiguo al más nuevo), de una consulta en una.
 * 2026-10-21: v4 (modo buscar). Versiones anteriores: solo fullReference.
 * 2026-10-22: v5. Con el filtro, cada proveedor se lee desde el final de su lista (fallo real: un
 *   proveedor con más de 2.000 albaranes agotaba el límite de páginas leyendo desde el principio).
 *   v6: el final se acota a una página (no al albarán exacto): unas 7 consultas menos por lista.
 * 2026-10-23: v7. Páginas solapadas en un albarán con comprobación de continuidad: si la lista
 *   cambia durante la lectura, la búsqueda queda incompleta («lista_cambiada»), nunca con huecos.
 *   Página con menos filas de las pedidas: fin de la lista solo si después no hay nada; con un tope
 *   fijo de STEL se sigue con ese tamaño; si no, incompleta («pagina_recortada»).
 * 2026-10-26: v8. Modo {pedidos: {codigos: ["PAP01234", …]}}: pedidos a proveedor por referencia,
 *   con sus artículos y unidades, sin precios (validar un «PAP» escrito a mano).
 */
const cors={"Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const BASE="https://app.stelorder.com/app/purchaseDeliveryNotes";
const BASE_PEDIDOS="https://app.stelorder.com/app/purchaseOrders";
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
function cliente(fetcher,clave,{esperas=[1500,4000],dormir=ms=>new Promise(r=>setTimeout(r,ms)),maxConsultas=110,base=BASE}={}){
 const estado={consultas:0};
 const get=async params=>{
  if(estado.consultas>=maxConsultas)throw Error("limite_consultas");
  const url=new URL(base);for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
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
  // Un albarán de esas fechas no puede haberse creado antes: al leer hacia atrás se para cuando
  // una página entera se creó antes de `desde` (con 2 días de margen).
  const limite=new Date(Date.parse(desde)-2*864e5).toISOString().slice(0,10);
  let paginas=0;
  const hay=async(filtro,n)=>n>=0&&(await get({...filtro,limit:1,start:n})).length>0;
  // Página que llega con menos filas de las pedidas: solo es el final de la lista si después no hay
  // nada. Si hay más, STEL sirve páginas más cortas: con un tope fijo (la primera página de la
  // búsqueda) se sigue con ese tamaño; con páginas recortadas a destiempo, la búsqueda queda
  // incompleta («pagina_recortada»), nunca «completa» con huecos (fallo reproducido 2026-10-23:
  // 50 de 200 albaranes de un proveedor y completo=true).
  let tamFijado=false;
  const corta=async(filtro,inicio,f)=>{
   if(f.length>=tam||!await hay(filtro,inicio+f.length))return false;
   if(!tamFijado&&inicio===0&&f.length>1){tam=f.length;tamFijado=true;return false;}
   throw Error("pagina_recortada");
  };
  // Final de una lista (con o sin filtro): galope desde lo ya conocido y búsqueda binaria; después,
  // páginas hacia atrás hasta las fechas anteriores. `filtro`: parámetros fijos de la consulta.
  const leerDesdeElFinal=async(filtro,{conocido=-1,pista=null,valida=()=>true}={})=>{
   const hay1=n=>hay(filtro,n);
   let lo=conocido,hi;
   if(Number.isInteger(pista)&&pista>0&&pista-1>lo&&await hay1(pista-1)){lo=pista-1;let paso=50;hi=lo+paso;
    while(await hay1(hi)){lo=hi;paso*=2;hi=lo+paso;if(paso>1e6)break;}}
   else{hi=Math.max(1000,2*(lo+1));while(await hay1(hi)){lo=hi;hi*=2;if(hi>2e6)break;}}
   // Basta acotar el final a menos de una página: la primera página leída (desde `lo`) lo contiene.
   while(hi-lo>tam){const m=Math.floor((lo+hi)/2);if(await hay1(m))lo=m;else hi=m;}
   // Las páginas se solapan en un albarán y se comprueba que es el mismo: si la lista cambia
   // mientras se lee (un albarán borrado desplaza las posiciones), se notaría un hueco silencioso
   // (un «no existe» o un «único del día» falsos). Lista cambiada = búsqueda incompleta.
   const filas=[];let total=null,anterior=null;
   for(let inicio=Math.max(0,lo);;inicio=Math.max(0,inicio-(tam-1))){
    if(paginas>=maxPaginas)throw Error("limite_paginas");
    const f=await get({...filtro,limit:tam,start:inicio});paginas++;
    if(!f.every(valida))throw Error("filtro_inconsistente");
    // La primera página (la del final) tiene que llegar entera hasta el final de la lista.
    if(!anterior&&f.length<tam&&await hay1(inicio+f.length))throw Error("pagina_recortada");
    if(anterior&&String(f[anterior.inicio-inicio]?.id)!==String(anterior.id))throw Error("lista_cambiada");
    if(total===null){if(!f.length&&inicio>0)throw Error("lista_cambiada");total=inicio+f.length;}
    filas.push(...f);
    if(inicio===0||!f.length||!f.some(x=>dia(x["creation-date"]||x.date)>=limite))break;
    anterior={inicio,id:f[0].id};
   }
   return {filas,total};
  };
  const unicas=filas=>{const v=new Set();return filas.filter(x=>!v.has(String(x.id))&&v.add(String(x.id)));};
  // 1. Filtro por cuenta, si STEL lo aplica de verdad.
  let aplicado=null;
  for(const c of cuentas){
   const p=await get({"account-id":c,limit:tam,start:0});
   if(!p.length)continue;
   await corta({"account-id":c},0,p);
   // Aplicado de verdad: todas sus filas son de la cuenta y, sin filtro, la lista tiene otras.
   aplicado=p.every(x=>String(x["account-id"])===String(c))&&(await get({limit:tam,start:0})).some(x=>String(x["account-id"])!==String(c));
   if(!aplicado)break;
   const notas=[];
   for(const cuenta of cuentas){
    const valida=x=>String(x["account-id"])===String(cuenta);
    const primera=cuenta===c?p:await get({"account-id":cuenta,limit:tam,start:0});
    if(!primera.every(valida))return fin("filtro_cuenta",false,[],{motivo:"filtro_inconsistente"});
    if(cuenta!==c)await corta({"account-id":cuenta},0,primera);
    // Lista corta: ya está entera. Larga: desde el final.
    const filas=primera.length<tam?primera:(await leerDesdeElFinal({"account-id":cuenta},{conocido:tam-1,valida})).filas;
    notas.push(...unicas(filas).filter(enIntervalo));
   }
   return fin("filtro_cuenta",true,notas);
  }
  // 2. Sin filtro: la lista completa desde el final (antes, el tamaño de página que sirve STEL).
  if(!tamFijado){const p0=await get({limit:tam,start:0});await corta({},0,p0);}
  const {filas,total}=await leerDesdeElFinal({},{pista});
  const notas=unicas(filas).filter(x=>enIntervalo(x)&&(!delasCuentas.size||delasCuentas.has(String(x["account-id"]))));
  return fin("recientes",true,notas,{total});
 }catch(e){return fin("error",false,[],{motivo:String(e?.message||e).slice(0,80)});}
}

/*
 * Pedidos a proveedor por su referencia (validar un «PAP» escrito a mano en el albarán):
 * identificación, proveedor, estado y artículos con sus unidades. Nunca precios ni importes.
 * 2026-10-26: v8. Pendiente de comprobar con STEL real los nombres de los campos de las líneas.
 */
export function resumenPedido(x){
 const lineas=(Array.isArray(x.lines)?x.lines:Array.isArray(x.lineas)?x.lineas:[]).slice(0,200).map(l=>({
  ref:String(l["item-reference"]??l.reference??l["item-full-reference"]??"").slice(0,60),
  idArticulo:l["item-id"]??l.itemId??null,
  unidades:Number.isFinite(Number(l.units??l.quantity))?Number(l.units??l.quantity):null}));
 return {id:Number.isSafeInteger(Number(x.id))?Number(x.id):null,
  fullReference:String(x["full-reference"]||x.fullReference||""),date:String(x.date||""),title:String(x.title||"").slice(0,160),
  accountId:x["account-id"]??x.accountId??x.account?.id??null,extraReference:String(x["extra-reference"]||x.extraReference||""),
  state:String(x["document-state"]||x.status||""),lineas};
}
export async function buscarPedidos(fetcher,clave,codigos,opciones={}){
 const {get,estado}=cliente(fetcher,clave,{...opciones,base:BASE_PEDIDOS});
 const pedidos=[];
 try{
  for(const c of codigos){
   const lista=await get({"full-reference":c,limit:20});
   pedidos.push(...lista.filter(x=>String(x["full-reference"]||x.fullReference||"").toUpperCase().replace(/[^A-Z0-9]/g,"")===c).map(resumenPedido));
  }
  return {completo:true,pedidos,consultas:estado.consultas};
 }catch(e){return {completo:false,pedidos:[],consultas:estado.consultas,motivo:String(e?.message||e).slice(0,80)};}
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
  if(body&&body.pedidos){
   const codigos=[...new Set((Array.isArray(body.pedidos.codigos)?body.pedidos.codigos:[]).map(c=>String(c).toUpperCase()))];
   if(Object.keys(body).length!==1||!codigos.length||codigos.length>20||!codigos.every(c=>/^PAP\d{5}$/.test(c)))
    return reply({error:"Consulta de pedidos no válida"},400);
   const r=await buscarPedidos(fetcher,stelKey,codigos);
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
