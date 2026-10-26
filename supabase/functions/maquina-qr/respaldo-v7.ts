// RESPALDO de la versión 7 desplegada de maquina-qr (copia del 2026-10-26, revisión de seguridad).
// No se despliega. Para restaurarla, sustituir CLAVE_ANONIMA_PUBLICA por la clave anónima (legacy)
// del proyecto (Supabase → Settings → API) y desplegar con verify_jwt desactivado.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve((_req: Request) => {
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DAFRICA · Maquinaria</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#17202a;background:#f4f6f8}
*{box-sizing:border-box}
body{margin:0;background:#f4f6f8;padding:14px}
.wrap{max-width:780px;margin:0 auto}
.card{background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 4px 18px rgba(0,0,0,.05)}
h1,h2{margin:0 0 9px} h1{font-size:23px} h2{font-size:17px}
.muted{color:#667085;font-size:13px}.err{color:#b42318}.ok{color:#147a3d}
.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#eef2f6;font-weight:700;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.kv{padding:10px;border:1px solid #e7ebef;border-radius:10px}.kv b{display:block;font-size:12px;color:#667085;margin-bottom:4px}
input,select,textarea,button{font:inherit}
input,select,textarea{width:100%;padding:10px;border:1px solid #cfd6dd;border-radius:9px;margin:4px 0 10px;background:#fff}
button{border:0;border-radius:9px;padding:10px 13px;background:#17202a;color:#fff;cursor:pointer;margin:4px 5px 4px 0}
button.secondary{background:#eef2f6;color:#17202a} button.warn{background:#8a5a00} button.danger{background:#a52a2a}
.hidden{display:none!important}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.item{border-top:1px solid #eef1f4;padding:10px 0}
@media(max-width:600px){.grid{grid-template-columns:1fr}body{padding:9px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="muted">DAFRICA · MAQUINARIA</div>
    <div id="publicInfo"><h1>Cargando máquina…</h1><div class="muted">Conectando con DAFRICA Control</div></div>
  </div>

  <div id="loginCard" class="card">
    <h2>Acceso interno</h2>
    <div class="muted" style="margin-bottom:10px">Inicia sesión para ver documentos, historial y registrar movimientos.</div>
    <label>Correo</label><input id="email" type="email" autocomplete="username">
    <label>Contraseña</label><input id="password" type="password" autocomplete="current-password">
    <button onclick="login()">Entrar</button>
    <div id="loginMsg" class="muted"></div>
  </div>

  <div id="privateArea" class="hidden">
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <h2>Ficha completa</h2><button class="secondary" onclick="logout()">Cerrar sesión</button>
      </div>
      <div id="machineDetail" class="grid"></div>
    </div>

    <div class="card">
      <h2>Movimiento rápido</h2>
      <div class="grid">
        <div><label>Obra destino</label><select id="obraDestino"><option value="">Sin obra</option></select></div>
        <div><label>Responsable</label><input id="responsable"></div>
        <div><label>Ubicación</label><input id="ubicacion"></div>
        <div><label>Observaciones</label><input id="observaciones"></div>
      </div>
      <div class="row">
        <button onclick="move('ASIGNACION')">Asignar / trasladar</button>
        <button class="secondary" onclick="move('DEVOLUCION')">Devolver</button>
        <button class="warn" onclick="move('MANTENIMIENTO')">Mantenimiento</button>
        <button class="danger" onclick="move('AVERIA')">Avería</button>
        <button class="secondary" onclick="move('REPARACION')">Reparada</button>
      </div>
      <div id="moveMsg" class="muted"></div>
    </div>

    <div class="card"><h2>Documentos</h2><div id="documents">Cargando…</div></div>
    <div class="card"><h2>Historial</h2><div id="history">Cargando…</div></div>
  </div>
</div>

<script>
const SUPABASE_URL='https://sbocfjxamjmwabmqbeyw.supabase.co';
const ANON='CLAVE_ANONIMA_PUBLICA';
const TOKEN=new URLSearchParams(location.search).get('token')||'';
let accessToken=sessionStorage.getItem('dafrica_qr_access')||'';
let machine=null;
let obraLegacyActual='';

function h(auth=true){
  const out={'apikey':ANON,'Content-Type':'application/json'};
  out.Authorization='Bearer '+(auth&&accessToken?accessToken:ANON);
  return out;
}
function e(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
async function req(path,opt={}){
  const r=await fetch(SUPABASE_URL+path,{...opt,headers:{...h(true),...(opt.headers||{})}});
  const txt=await r.text(); let d=null; try{d=txt?JSON.parse(txt):null}catch{d=txt}
  if(!r.ok) throw new Error(d?.message||d?.hint||d?.msg||d?.error_description||('HTTP '+r.status));
  return d;
}
async function loadPublic(){
  const box=document.getElementById('publicInfo');
  if(!TOKEN){box.innerHTML='<h1>QR no válido</h1><div class="err">Falta el identificador de la máquina.</div>';return;}
  try{
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/maquina_qr_publica',{method:'POST',headers:{apikey:ANON,Authorization:'Bearer '+ANON,'Content-Type':'application/json'},body:JSON.stringify({p_token:TOKEN})});
    const d=await r.json();
    const m=Array.isArray(d)?d[0]:d;
    if(!r.ok||!m){box.innerHTML='<h1>Máquina no encontrada</h1><div class="err">Este QR no corresponde a una máquina activa.</div>';return;}
    box.innerHTML='<div class="row" style="justify-content:space-between"><div><h1>'+e(m.nombre||m.legacy_id)+'</h1><div class="muted">'+e(m.legacy_id||'')+' · '+e([m.marca,m.modelo].filter(Boolean).join(' '))+'</div></div><span class="badge">'+e(m.estado||'')+'</span></div><div class="grid" style="margin-top:12px"><div class="kv"><b>Tipo</b>'+e(m.tipo||'—')+'</div><div class="kv"><b>Obra</b>'+e(m.obra_nombre||'Sin obra asignada')+'</div></div>';
  }catch(err){box.innerHTML='<h1>DAFRICA · Maquinaria</h1><div class="err">No se pudo cargar la ficha. Comprueba la conexión a Internet.</div>';}
}
async function login(){
  const msg=document.getElementById('loginMsg'); msg.textContent='Entrando…'; msg.className='muted';
  try{
    const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value})});
    const d=await r.json();
    if(!r.ok) throw new Error(d?.error_description||d?.msg||'No se pudo iniciar sesión.');
    accessToken=d.access_token; sessionStorage.setItem('dafrica_qr_access',accessToken);
    await loadPrivate(); msg.textContent='';
  }catch(err){msg.textContent=err.message;msg.className='err';}
}
function logout(){sessionStorage.removeItem('dafrica_qr_access');accessToken='';document.getElementById('privateArea').classList.add('hidden');document.getElementById('loginCard').classList.remove('hidden');}
async function loadPrivate(){
  const rows=await req('/rest/v1/machines?qr_token=eq.'+encodeURIComponent(TOKEN)+'&select=id,legacy_id,nombre,machine_type,manufacturer,model,serial,location,operational_status,notes,obra_id,responsable,beacon_id,stel_id,updated_at');
  machine=rows?.[0]; if(!machine) throw new Error('No tienes acceso a esta máquina.');
  document.getElementById('loginCard').classList.add('hidden');document.getElementById('privateArea').classList.remove('hidden');
  const vals=[['ID',machine.legacy_id],['Nombre',machine.nombre],['Tipo',machine.machine_type],['Marca / modelo',[machine.manufacturer,machine.model].filter(Boolean).join(' ')],['Nº serie',machine.serial],['Estado',machine.operational_status],['Responsable',machine.responsable],['Ubicación',machine.location],['Beacon ID',machine.beacon_id],['STEL ID',machine.stel_id],['Observaciones',machine.notes],['Actualizado',machine.updated_at?new Date(machine.updated_at).toLocaleString():'']];
  document.getElementById('machineDetail').innerHTML=vals.map(([k,v])=>'<div class="kv"><b>'+e(k)+'</b>'+e(v||'—')+'</div>').join('');
  document.getElementById('responsable').value=machine.responsable||'';document.getElementById('ubicacion').value=machine.location||'';
  const obras=await req('/rest/v1/obras?activo=eq.true&select=id,legacy_id,nombre,municipio&order=nombre.asc');
  const sel=document.getElementById('obraDestino');sel.innerHTML='<option value="">Sin obra</option>'+obras.map(o=>'<option value="'+e(o.legacy_id)+'">'+e(o.nombre)+(o.municipio?' · '+e(o.municipio):'')+'</option>').join('');
  if(machine.obra_id){const ob=obras.find(o=>o.id===machine.obra_id);if(ob){obraLegacyActual=ob.legacy_id||'';sel.value=obraLegacyActual;}}
  await Promise.all([loadDocs(),loadHistory()]);
}
async function move(tipo){
  const msg=document.getElementById('moveMsg');msg.textContent='Guardando…';msg.className='muted';
  try{
    let obra=document.getElementById('obraDestino').value||null;
    if(['AVERIA','MANTENIMIENTO','REPARACION'].includes(tipo)) obra=obraLegacyActual||obra;
    if(tipo==='DEVOLUCION') obra=null;
    await req('/rest/v1/rpc/registrar_movimiento_recurso',{method:'POST',body:JSON.stringify({p_tipo_recurso:'maquinaria',p_recurso_clave:machine.legacy_id,p_tipo_movimiento:tipo,p_fecha_movimiento:new Date().toISOString(),p_obra_clave:obra,p_responsable:document.getElementById('responsable').value.trim()||null,p_ubicacion:document.getElementById('ubicacion').value.trim()||null,p_observaciones:document.getElementById('observaciones').value.trim(),p_movimiento_local_id:null,p_origen:'QR_MOVIL'})});
    msg.textContent='Movimiento guardado correctamente.';msg.className='ok';await loadPrivate();
  }catch(err){msg.textContent=err.message;msg.className='err';}
}
async function loadDocs(){
  const box=document.getElementById('documents');
  try{
    const docs=await req('/rest/v1/documents?kind=eq.machine&entity_legacy_id=eq.'+encodeURIComponent(machine.legacy_id)+'&active=eq.true&select=id,file_name,file_type,storage_bucket,storage_path&order=created_at.desc');
    if(!docs.length){box.innerHTML='<div class="muted">Sin documentos registrados.</div>';return;}
    window.__docs=docs;box.innerHTML=docs.map((d,i)=>'<div class="item"><b>'+e(d.file_name||'Documento')+'</b><br><button class="secondary" onclick="openDoc('+i+')">Abrir</button></div>').join('');
  }catch(err){box.innerHTML='<div class="err">'+e(err.message)+'</div>';}
}
async function openDoc(i){
  const d=window.__docs?.[i];if(!d?.storage_path)return;
  const p=d.storage_path.split('/').map(encodeURIComponent).join('/');
  const r=await fetch(SUPABASE_URL+'/storage/v1/object/authenticated/'+encodeURIComponent(d.storage_bucket||'documentos-control')+'/'+p,{headers:h(true)});
  if(!r.ok){alert('No se pudo abrir el documento.');return;}
  const blob=await r.blob();const u=URL.createObjectURL(blob);location.href=u;
}
async function loadHistory(){
  const box=document.getElementById('history');
  try{
    const hst=await req('/rest/v1/movimientos_recursos?maquina_id=eq.'+machine.id+'&select=tipo_movimiento,fecha_movimiento,obra_nueva_legacy_id,ubicacion_nueva,estado_nuevo,observaciones&order=fecha_movimiento.desc&limit=30');
    if(!hst.length){box.innerHTML='<div class="muted">Sin movimientos registrados.</div>';return;}
    box.innerHTML=hst.map(x=>'<div class="item"><b>'+e(x.tipo_movimiento)+'</b> · '+e(new Date(x.fecha_movimiento).toLocaleString())+'<br><span class="muted">'+e(x.estado_nuevo||'')+(x.obra_nueva_legacy_id?' · '+e(x.obra_nueva_legacy_id):'')+(x.ubicacion_nueva?' · '+e(x.ubicacion_nueva):'')+'</span>'+(x.observaciones?'<br>'+e(x.observaciones):'')+'</div>').join('');
  }catch(err){box.innerHTML='<div class="err">'+e(err.message)+'</div>';}
}
loadPublic();
if(accessToken){loadPrivate().catch(()=>logout());}
</script>
</body></html>`;

  return new Response(html,{
    status:200,
    headers:{
      "Content-Type":"text/html; charset=utf-8",
      "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff"
    }
  });
});
