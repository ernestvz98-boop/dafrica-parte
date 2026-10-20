'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/compras-catalogo-lectura/handler.mjs');
const response=(v,status=200)=>new Response(JSON.stringify(v),{status});
const env=k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon-ficticio',STEL_API_KEY:'clave-ficticia'})[k];
const req=(body={},auth=true)=>new Request('https://test.invalid',{method:'POST',headers:auth?{authorization:'Bearer ficticio','Content-Type':'application/json'}:{},body:JSON.stringify(body)});
test('paginación hasta página vacía, aunque STEL reduzca el tamaño solicitado',async()=>{
 const {leerPaginas}=await mod(),starts=[];
 const r=await leerPaginas(async url=>{const n=Number(new URL(url).searchParams.get('start'));starts.push(n);return response(n<2?[{id:n+1}]:[])},'products','ficticia');
 assert.deepEqual(starts,[0,1,2]);assert.equal(r.completo,true);assert.equal(r.filas.length,2);
});
test('paginación repetida, interrumpida o al límite nunca se anuncia completa',async()=>{
 const {leerPaginas}=await mod();
 assert.equal((await leerPaginas(async()=>response([{id:1}]),'products','ficticia')).completo,false);
 assert.equal((await leerPaginas(async()=>response({},502),'products','ficticia')).completo,false);
 assert.equal((await leerPaginas(async url=>response([{id:Number(new URL(url).searchParams.get('start'))+1}]),'products','ficticia',{maxPaginas:2})).completo,false);
});
test('sin sesión no consulta catálogos ni ejecuta operaciones',async()=>{
 const {handler}=await mod();let llamadas=0;
 const r=await handler(req({},false),{env,fetcher:async()=>{llamadas++;throw Error('No debería invocarse')}});
 assert.equal(r.status,401);assert.equal(llamadas,0);
});
test('sesión inválida y permiso ausente bloquean toda consulta a STEL',async()=>{
 const {handler}=await mod();
 for(const invalida of [true,false]){let stel=0;const r=await handler(req(),{env,fetcher:async url=>{
  if(url.includes('stelorder')){stel++;throw Error('No debería consultar STEL')}
  return url.endsWith('/user')?response({},invalida?401:200):response([]);
 }});assert.equal(r.status,invalida?401:403);assert.equal(stel,0);}
});
test('consulta autorizada: solo GET en STEL; no devuelve precios, claves ni datos de facturación',async()=>{
 const {handler}=await mod(),llamadas=[];
 const r=await handler(req(),{env,fetcher:async(url,op)=>{
  llamadas.push([url,op.method]);
  if(url.endsWith('/user'))return response({id:'ficticio'});
  if(url.endsWith('/mis_permisos'))return response([{codigo:'costes.ver'}]);
  assert.equal(op.method,'GET');
  const u=new URL(url);if(u.searchParams.get('start')!=='0')return response([]);
  return response(u.pathname.endsWith('/suppliers')?[{id:1,name:'Ficticio','tax-identification-number':'B24123457'}]:[{id:2,reference:'R1',name:'TUBO','purchase-price':999}]);
 }});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.proveedores_completo,true);assert.equal(d.articulos_completo,true);assert.equal(d.escritura_stel,false);
 assert.ok(!JSON.stringify(d).includes('purchase-price'));assert.ok(!JSON.stringify(d).includes('clave-ficticia'));
 assert.equal(llamadas.filter(([u,m])=>m==='POST'&&!u.endsWith('/mis_permisos')).length,0);
});
test('rechaza recibir PDF o cualquier orden de escritura en la consulta de catálogo',async()=>{
 const {handler}=await mod();let stel=0;
 const r=await handler(req({data:'PDF'}),{env,fetcher:async url=>{
  if(url.includes('stelorder'))stel++;
  return response(url.endsWith('/user')?{id:'ficticio'}:[{codigo:'costes.ver'}]);
 }});assert.equal(r.status,400);assert.equal(stel,0);
});
