'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {parseHTML}=require('linkedom');
const {fixture}=require('../licitaciones.fixture.cjs');
const repo=path.resolve(__dirname,'../..');

async function boot(options={}){
  const dom=parseHTML('<!doctype html><html><body><main id="content"></main></body></html>');
  const calls=[],downloads=[],timers=[];
  const rows=options.rows||fixture();let allowed=options.denied!==true;
  const ctx={document:dom.document,modules:[],state:{module:'licitaciones'},has:()=>allowed,
    renderModule:async()=>{},setTopbar:()=>{},setContent:s=>dom.document.getElementById('content').innerHTML=s,
    $:id=>dom.document.getElementById(id),
    sb:async q=>{calls.push(q);if(options.fail)throw Error('Fallo sintético');return q.includes('id=eq.')?rows.filter(r=>q.includes('id=eq.'+r.id)):rows;},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},Intl,Date,Blob,
    URL:class extends URL {static createObjectURL(){downloads.push('blob-sintetico');return 'blob:prueba';}static revokeObjectURL(){}},
  };
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(repo,'licitaciones/modelo.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(repo,'control-30.js'),'utf8'),ctx);
  await ctx.renderModule();
  const doc=dom.document;
  // Linkedom no reproduce la selección nativa del navegador: suministramos su valor al controlador real.
  function select(id,value){const el=doc.getElementById(id);assert.ok([...el.querySelectorAll('option')].some(o=>o.value===value));Object.defineProperty(el,'value',{configurable:true,value});el.onchange({target:el});}
  return {doc,calls,downloads,timers,ctx,select,revoke:()=>{allowed=false;}};
}

test('DOM: filtros reales, enlaces, resultado recalculado, datos pendientes y texto seguro',async()=>{
  const ui=await boot(),d=ui.doc;
  assert.deepEqual([...d.querySelectorAll('#liDecision option')].map(o=>o.value),['','ESTUDIAR','PENDIENTE_DE_DATOS','DESCARTAR']);
  assert.equal(d.querySelectorAll('.li-opportunity').length,2);
  assert.match(d.getElementById('liComparison').textContent,/-10,00/);
  assert.match(d.getElementById('liComparison').textContent,/simulación/);
  assert.match(d.getElementById('liComparison').textContent,/Sin cálculo defendible/);
  assert.equal(d.querySelectorAll('a[href="https://example.org/pliego"]').length,2);
  assert.equal(d.querySelectorAll('a[href="https://example.org/ppt"]').length,2);
  assert.equal(d.querySelectorAll('#liItems img, #liDetail script').length,0);
  assert.equal(ui.ctx.__xss,undefined);
  ui.select('liDecision','ESTUDIAR');assert.equal(d.querySelectorAll('.li-opportunity').length,1);
  ui.select('liDecision','');ui.select('liEconomia','SIN_MODELO');assert.equal(d.querySelectorAll('.li-opportunity').length,1);
  assert.match(d.getElementById('liItems').textContent,/Sin cálculo defendible/);
  ui.select('liEconomia','PERDIDA_BASE');assert.equal(d.querySelectorAll('.li-opportunity').length,1);
  assert.match(d.getElementById('liItems').textContent,/Simulación con supuestos/);
  assert.ok(ui.calls.every(q=>q.startsWith('/rest/v1/licitaciones_ejecuciones?')));
  assert.equal(ui.calls.length,2);
});

test('DOM: el historial diferencia informes y conserva un resultado final mientras hay revisión en curso',async()=>{
  const rows=fixture();rows.unshift({...rows[0],id:'en-curso',estado:'EN_CURSO',finalizada_en:null,oportunidades:[],resumen:''});
  const ui=await boot({rows});
  assert.match(ui.doc.getElementById('liAviso').textContent,/último informe finalizado/);
  assert.match(ui.doc.getElementById('liDetail').textContent,/Informe ficticio de navegador/);
  const labels=[...ui.doc.querySelectorAll('#liInforme option')].map(o=>o.textContent);
  assert.ok(labels.some(t=>t.includes('Estudio complementario')));assert.ok(labels.some(t=>t.includes('Revisión diaria')));
  const only=await boot({rows:[rows[0]]});
  assert.match(only.doc.getElementById('liDetail').textContent,/Resultado todavía no disponible/);
  assert.equal(only.doc.querySelectorAll('.li-kpi').length,0);
});

test('DOM: no consulta sin permiso, distingue fallo de búsqueda vacía y revalida exportación',async()=>{
  const denied=await boot({denied:true});assert.equal(denied.calls.length,0);assert.match(denied.doc.body.textContent,/No tienes permiso/);
  const failed=await boot({fail:true});assert.match(failed.doc.querySelector('[role="alert"]').textContent,/No se ha comprobado si hay novedades/);
  const empty=await boot({rows:[]});assert.match(empty.doc.getElementById('liHistory').textContent,/no significa/);
  const ui=await boot();ui.revoke();ui.doc.getElementById('liDescargar').onclick();assert.equal(ui.downloads.length,0);
});
