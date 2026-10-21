'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/compras-catalogo-lectura/handler.mjs');
const response=(v,status=200)=>new Response(JSON.stringify(v),{status});
const env=k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon-ficticio',STEL_API_KEY:'clave-ficticia'})[k];
const req=(body={},auth=true)=>new Request('https://test.invalid',{method:'POST',headers:auth?{authorization:'Bearer ficticio','Content-Type':'application/json'}:{},body:JSON.stringify(body)});
test('paginación hasta página vacía, aunque STEL reduzca el tamaño solicitado',async()=>{
 const {leerPaginas}=await mod(),starts=[];
 const r=await leerPaginas(async url=>{const n=Number(new URL(url).searchParams.get('start'));starts.push(n);return response(n<2?[{id:n+1}]:[])},'products','ficticia');
 // Tras la primera página corta se sigue de una en una desde las filas leídas (1, 2).
 assert.deepEqual(starts.slice(-2),[1,2]);assert.equal(r.completo,true);assert.equal(r.filas.length,2);
});
test('catálogo grande: páginas completas en paralelo, sin huecos ni duplicados, hasta la página vacía',async()=>{
 const {leerPaginas}=await mod(),TOTAL=1234;
 const r=await leerPaginas(async url=>{const u=new URL(url),n=Number(u.searchParams.get('start')),l=Number(u.searchParams.get('limit'));
  return response(Array.from({length:Math.max(0,Math.min(l,TOTAL-n))},(_,i)=>({id:n+i+1})));},'products','ficticia');
 assert.equal(r.completo,true);assert.equal(r.filas.length,TOTAL);
 assert.deepEqual(r.filas.map(x=>x.id),Array.from({length:TOTAL},(_,i)=>i+1));
 // Con el límite antiguo (50 páginas) un catálogo mayor queda incompleto y lo dice.
 const corto=await leerPaginas(async url=>{const n=Number(new URL(url).searchParams.get('start'));return response(Array.from({length:100},(_,i)=>({id:n+i+1})));},'products','ficticia',{maxPaginas:50});
 assert.equal(corto.completo,false);assert.equal(corto.motivo,'limite_paginas');
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
test('STEL rechaza un momento (403/429): se reintenta con espera y la lectura sigue de una en una',async()=>{
 const {leerPaginas}=await mod(),llamadas=[];let fallos=2,enVuelo=0,maxEnVuelo=0;
 const r=await leerPaginas(async url=>{
  enVuelo++;maxEnVuelo=Math.max(maxEnVuelo,enVuelo);await new Promise(x=>setTimeout(x,1));enVuelo--;
  const n=Number(new URL(url).searchParams.get('start'));llamadas.push(n);
  if(n===200&&fallos-->0)return response({},403);
  return response(Array.from({length:Math.max(0,Math.min(100,250-n))},(_,i)=>({id:n+i+1})));
 },'products','ficticia',{dormir:async()=>{}});
 assert.equal(r.completo,true);assert.equal(r.filas.length,250);assert.equal(maxEnVuelo,1);
 // Un error que persiste tras los reintentos deja el catálogo incompleto y lo dice.
 const malo=await leerPaginas(async()=>response({},403),'products','ficticia',{dormir:async()=>{}});
 assert.equal(malo.completo,false);assert.match(malo.motivo,/403/);
});
test('lectura reanudable: «desde» continúa en esa fila y devuelve los ids para comprobar el empalme',async()=>{
 const {leerPaginas,handler}=await mod(),TOTAL=350;
 const stel=async url=>{const u=new URL(url),n=Number(u.searchParams.get('start'));return response(Array.from({length:Math.max(0,Math.min(100,TOTAL-n))},(_,i)=>({id:n+i+1})));};
 const corte=await leerPaginas(stel,'products','ficticia',{maxPaginas:2});
 assert.equal(corte.completo,false);assert.equal(corte.siguiente,200);assert.deepEqual(corte.ids_final,Array.from({length:100},(_,i)=>String(101+i)));
 // Se reanuda releyendo la última página ya leída: su primera página debe ser idéntica.
 const sigue=await leerPaginas(stel,'products','ficticia',{desde:corte.siguiente-corte.ids_final.length});
 assert.equal(sigue.completo,true);assert.deepEqual(sigue.ids_inicio,corte.ids_final);assert.equal(sigue.siguiente,TOTAL);
 // La función solo admite {} o {desde: entero ≥ 0}.
 const env=k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'a',STEL_API_KEY:'c'})[k];
 for(const body of [{desde:-1},{desde:'5'},{desde:1,otra:1}]){
  const r=await handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer x','Content-Type':'application/json'},body:JSON.stringify(body)}),
   {env,fetcher:async u=>u.includes('stelorder')?(()=>{throw Error('no')})():response(u.endsWith('/user')?{id:1}:[{codigo:'costes.ver'}])});
  assert.equal(r.status,400);
 }
});
