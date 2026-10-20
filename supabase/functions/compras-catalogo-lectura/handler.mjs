// Consulta privada de SOLO LECTURA. No recibe PDF, no almacena datos ni crea artículos.
const cors={"Access-Control-Allow-Origin":"https://ernestvz98-boop.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
export async function leerPaginas(fetcher,ruta,clave,{maxPaginas=50}={}){
 const filas=[],ids=new Set();let inicio=0;
 try{
  for(let i=0;i<maxPaginas;i++){
   const url=new URL('https://app.stelorder.com/app/'+ruta);url.searchParams.set('limit','100');url.searchParams.set('start',String(inicio));
   const r=await fetcher(url.href,{method:'GET',headers:{APIKEY:clave,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error('Consulta STEL no disponible');
   const lote=await r.json();if(!Array.isArray(lote))throw Error('Catálogo inválido');
   // Incluso una página corta se sigue paginando: STEL puede limitar el tamaño.
   if(!lote.length)return {filas,completo:true};
   for(const x of lote){
    if(!x||x.id==null||ids.has(String(x.id)))throw Error('Paginación repetida o inválida');
    ids.add(String(x.id));filas.push(x);
   }
   inicio+=lote.length;
  }
 }catch{}
 return {filas,completo:false};
}
export async function handler(req,{fetcher=fetch,env}={}){
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 const jwt=req.headers.get('authorization')||'';
 if(!jwt.startsWith('Bearer '))return json({error:'Sesión requerida'},401);
 const base=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),stel=env('STEL_API_KEY');
 if(!base||!anon||!stel)return json({error:'Comprobación de catálogo no disponible'},503);
 try{
  const headers={authorization:jwt,apikey:anon};
  const user=await fetcher(base+'/auth/v1/user',{method:'GET',headers,signal:AbortSignal.timeout(10000)});
  if(!user.ok)return json({error:'Sesión no autorizada'},401);
  const permisos=await fetcher(base+'/rest/v1/rpc/mis_permisos',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  if(!permisos.ok)return json({error:'Permiso no comprobado'},403);
  const p=await permisos.json();
  if(!Array.isArray(p)||!p.some(x=>x.codigo==='costes.ver'))return json({error:'Sin permiso de lectura de costes'},403);
  const input=await req.json().catch(()=>null);
  if(!input||Object.keys(input).length)return json({error:'Esta consulta no recibe archivos ni documentos'},400);
  const [s,a]=await Promise.all([leerPaginas(fetcher,'suppliers',stel,{maxPaginas:20}),leerPaginas(fetcher,'products',stel)]);
  const activo=x=>x.deleted!==true&&x.inactive!==true;
  return json({solo_lectura:true,persistido:false,escritura_supabase:false,escritura_stel:false,
   proveedores_completo:s.completo,articulos_completo:a.completo,
   proveedores:s.filas.filter(activo).map(x=>({id:x.id,nombre:String(x.name||x['fiscal-name']||''),nif:String(x['tax-identification-number']||'')})),
   articulos:a.filas.filter(activo).map(x=>({id:x.id,referencia:String(x.reference||''),descripcion:String(x.name||'')}))});
 }catch{return json({error:'Consulta de catálogo no disponible',persistido:false},502);}
}
