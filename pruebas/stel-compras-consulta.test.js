'use strict';
// Función Edge stel-albaranes-consulta (solo lectura): búsqueda de albaranes de compra por proveedor y fechas.
const test=require('node:test'),assert=require('node:assert/strict');
const mod=()=>import('../supabase/functions/stel-albaranes-consulta/handler.mjs');
const response=(v,status=200)=>new Response(JSON.stringify(v),{status});
const env=k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'servicio-ficticio',STEL_API_KEY:'clave-ficticia'})[k];
const req=(body,auth=true)=>new Request('https://test.invalid',{method:'POST',headers:auth?{authorization:'Bearer ficticio','Content-Type':'application/json'}:{},body:JSON.stringify(body)});
// 350 albaranes ficticios, del más antiguo al más nuevo: cuentas 1, 2, 3 alternas; un día cada 3.
const dia=i=>new Date(Date.UTC(2026,6,1)+Math.floor(i/3)*864e5).toISOString().slice(0,10);
const NOTAS=Array.from({length:350},(_,i)=>({id:i+1,'full-reference':'ABP26'+String(1000+i),'account-id':1+i%3,date:dia(i)+'T00:00:00+0000','creation-date':dia(i)+'T09:00:00+0000',
 title:'99.'+String(100+i)+' '+dia(i)+' OBRA FICTICIA','total-amount':123.45,lines:[{'item-base-price':9.99}]}));
const stel=(filtra,consultas=[])=>async(url,op)=>{
 if(url.endsWith('/user'))return response({id:'u'});
 if(url.endsWith('/mis_permisos'))return response([{codigo:'costes.ver'}]);
 assert.equal(op.method,'GET');consultas.push(url);
 const u=new URL(url),start=Number(u.searchParams.get('start')||0),limit=Number(u.searchParams.get('limit')||100),cuenta=u.searchParams.get('account-id');
 const lista=filtra&&cuenta?NOTAS.filter(n=>String(n['account-id'])===cuenta):NOTAS;
 return response(lista.slice(start,start+limit));
};
test('con filtro por cuenta aplicado: solo esa cuenta y ese intervalo, sin importes',async()=>{
 const {buscarNotas}=await mod();
 const r=await buscarNotas(stel(true),'k',{cuentas:[2],desde:'2026-07-10',hasta:'2026-07-12',dormir:async()=>{}});
 assert.equal(r.metodo,'filtro_cuenta');assert.equal(r.completo,true);
 assert.ok(r.notas.length>0&&r.notas.every(n=>n.accountId===2&&n.date.slice(0,10)>='2026-07-10'&&n.date.slice(0,10)<='2026-07-12'));
 assert.ok(!JSON.stringify(r).includes('123.45')&&!JSON.stringify(r).includes('9.99'));
});
test('si STEL ignora el filtro: lee desde el final hacia atrás y para al llegar a fechas anteriores',async()=>{
 const {buscarNotas}=await mod(),consultas=[];
 const r=await buscarNotas(stel(false,consultas),'k',{cuentas:[1,3],desde:'2026-10-20',hasta:'2026-10-30',dormir:async()=>{}});
 assert.equal(r.metodo,'recientes');assert.equal(r.completo,true);assert.equal(r.total,350);
 const esperadas=NOTAS.filter(n=>[1,3].includes(n['account-id'])&&n.date.slice(0,10)>='2026-10-20'&&n.date.slice(0,10)<='2026-10-30').map(n=>n.id).sort();
 assert.deepEqual(r.notas.map(n=>n.id).sort(),esperadas);
 // Con la pista del total anterior hacen falta menos consultas.
 const otra=[];await buscarNotas(stel(false,otra),'k',{cuentas:[1],desde:'2026-10-20',hasta:'2026-10-30',pista:340,dormir:async()=>{}});
 assert.ok(otra.length<consultas.length,otra.length+' / '+consultas.length);
});
test('el handler valida la búsqueda y exige sesión con permiso',async()=>{
 const {handler}=await mod();
 assert.equal((await handler(req({buscar:{cuentas:[1],desde:'2026-10-01',hasta:'2026-10-02'}},false),{env,fetcher:stel(true)})).status,401);
 for(const malo of [{cuentas:['x'],desde:'2026-10-01',hasta:'2026-10-02'},{cuentas:[1],desde:'ayer',hasta:'2026-10-02'},{cuentas:[1],desde:'2026-10-05',hasta:'2026-10-02'}])
  assert.equal((await handler(req({buscar:malo}),{env,fetcher:stel(true)})).status,400);
 const r=await handler(req({buscar:{cuentas:[1],desde:'2026-07-01',hasta:'2026-07-03'}}),{env,fetcher:stel(true)});
 assert.equal(r.status,200);const d=await r.json();assert.equal(d.solo_lectura,true);assert.ok(d.notas.length>0);
 assert.ok(d.notas[0].title.includes('OBRA FICTICIA'));
});
test('consulta por referencia completa: sigue funcionando igual',async()=>{
 const {handler}=await mod();
 const r=await handler(req({fullReference:'ABP261005'}),{env,fetcher:async(url,op)=>{
  if(!url.includes('stelorder'))return stel(true)(url,op);
  return response(NOTAS.filter(n=>n['full-reference']===new URL(url).searchParams.get('full-reference')));}});
 const d=await r.json();assert.equal(d.exactMatch,true);assert.equal(d.documents[0].accountId,3);
});

test('proveedor con miles de albaranes: con el filtro se lee desde el final de su lista y termina completo (fallo real)',async()=>{
 const {buscarNotas}=await mod();
 // 3.000 albaranes de la cuenta 5, del más antiguo (2018) al más nuevo (octubre de 2026), y 40 de la cuenta 6.
 const muchas=Array.from({length:3000},(_,i)=>{const f=new Date(Date.UTC(2018,0,1)+Math.floor(i*1.0)*864e5).toISOString().slice(0,10);
  return {id:i+1,'full-reference':'ABP'+i,'account-id':5,date:f+'T00:00:00+0000','creation-date':f+'T09:00:00+0000',title:String(i)};});
 const ultimo=muchas.at(-1).date.slice(0,10);
 const otras=Array.from({length:40},(_,i)=>({id:5000+i,'full-reference':'ABQ'+i,'account-id':6,date:ultimo+'T00:00:00+0000','creation-date':ultimo,title:'x'}));
 const todas=[...otras,...muchas],consultas=[];
 const r=await buscarNotas(async(url,op)=>{consultas.push(url);const u=new URL(url),s=Number(u.searchParams.get('start')),l=Number(u.searchParams.get('limit')),c=u.searchParams.get('account-id');
  const lista=c?todas.filter(n=>String(n['account-id'])===c):todas;return response(lista.slice(s,s+l));},'k',
  {cuentas:[5,6],desde:new Date(Date.parse(ultimo)-20*864e5).toISOString().slice(0,10),hasta:ultimo,dormir:async()=>{}});
 assert.equal(r.metodo,'filtro_cuenta');assert.equal(r.completo,true,JSON.stringify({...r,notas:r.notas.length}));
 assert.equal(r.notas.filter(n=>n.accountId===5).length,21);assert.equal(r.notas.filter(n=>n.accountId===6).length,40);
 assert.ok(consultas.length<40,'consultas: '+consultas.length);
});

test('la lista cambia durante la lectura (un albarán borrado): búsqueda incompleta, nunca con huecos',async()=>{
 const {buscarNotas}=await mod();
 let lista=NOTAS.slice(),leidas=0;
 const r=await buscarNotas(async url=>{
  const u=new URL(url),s=Number(u.searchParams.get('start')),l=Number(u.searchParams.get('limit'));
  const pagina=lista.slice(s,s+l);
  // Sondeo de la cuenta (1.ª lectura de página) y primera página del final (2.ª); después, un borrado.
  if(l>1&&++leidas===2)lista=lista.filter(n=>n.id!==200);
  return response(pagina);
 },'k',{cuentas:[1],desde:'2026-07-20',hasta:'2026-10-30',dormir:async()=>{}});
 assert.equal(r.completo,false);assert.equal(r.motivo,'lista_cambiada');assert.equal(r.notas.length,0);
});
test('páginas solapadas: sin cambios, la lectura hacia atrás no pierde ni repite albaranes',async()=>{
 const {buscarNotas}=await mod();
 const r=await buscarNotas(stel(false),'k',{cuentas:[1,2,3],desde:'2026-07-15',hasta:'2026-10-30',tam:40,dormir:async()=>{}});
 assert.equal(r.completo,true);
 const esperadas=NOTAS.filter(n=>n.date.slice(0,10)>='2026-07-15').map(n=>n.id);
 assert.deepEqual(r.notas.map(n=>n.id).sort((a,b)=>a-b),esperadas);
});
