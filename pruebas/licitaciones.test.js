'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../licitaciones/modelo.js');

test('licitaciones: importe ausente no se transforma en cero',()=>{
  for(const v of [null,undefined,'',false,[],{},'desconocido'])assert.equal(M.dinero(v,'EUR'),'Pendiente');
  assert.match(M.dinero(0,'EUR'),/^0,00/);
  assert.match(M.dinero(125,null),/moneda sin confirmar/);
});
test('licitaciones: bloquea enlaces ejecutables y escapa informes',()=>{
  for(const v of ['javascript:alert(1)','data:text/html,<script>','http://example.org','https://user:secret@example.org',null])assert.equal(M.url(v),null);
  assert.equal(M.url('https://example.org/pliego'),'https://example.org/pliego');
  assert.equal(M.esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('licitaciones: separa fallos y ausencia de novedades, detecta revisiones antiguas',()=>{
  const now=new Date('2026-10-21T06:30:00Z');
  assert.match(M.aviso(null,now),/no significa/);
  assert.match(M.aviso({estado:'FALLIDO',fecha_local:'2026-10-21'},now),/fallado/);
  assert.match(M.aviso({estado:'PARCIAL',fecha_local:'2026-10-21'},now),/parcial/);
  assert.match(M.aviso({estado:'COMPLETADO',fecha_local:'2026-10-20'},now),/día anterior/);
  assert.match(M.aviso({estado:'EN_CURSO',iniciada_en:'2026-10-21T01:00:00Z'},now),/sin finalizar/);
});
test('licitaciones: hora peninsular respeta cambios de horario y zona explícita',()=>{
  assert.equal(M.hoy(new Date('2026-10-21T22:30:00Z')),'2026-10-22');
  assert.match(M.fecha('2026-10-22T04:00:00Z'),/6:00/);
  assert.match(M.fecha('2026-10-26T05:00:00Z'),/6:00/);
  assert.match(M.fecha('2026-10-22T06:00:00'),/zona horaria sin confirmar/);
});
test('licitaciones: los filtros no confunden recomendaciones o lotes',()=>{
  const rows=[{organo:'Organismo ficticio',expediente:'EXP-SINTETICO',objeto:'Reforma',ubicacion:'Localidad ficticia',lote:'1',recomendacion:'ESTUDIAR'},
    {organo:'Organismo ficticio',expediente:'EXP-SINTETICO',objeto:'Reforma',lote:'2',recomendacion:'DESCARTAR'}];
  assert.equal(M.filtrar(rows,'localidad','ESTUDIAR').length,1);
  assert.equal(M.filtrar(rows,'Reforma','PENDIENTE_DE_DATOS').length,0);
  assert.notEqual(M.clave(rows[0]),M.clave(rows[1]));
});
test('licitaciones: no presenta beneficio sin costes completos y contrasta el margen',()=>{
  const s={coste_total_sin_iva:100,oferta_sin_iva:150,beneficio_sin_iva:9999,margen_pct:99};
  assert.deepEqual(M.resultadoEscenario(s,'PARCIAL'),{beneficio:null,margen:null});
  assert.deepEqual(M.resultadoEscenario({...s,coste_total_sin_iva:null},'COMPLETA'),{beneficio:null,margen:null});
  assert.deepEqual(M.resultadoEscenario(s,'COMPLETA'),{beneficio:50,margen:33.33});
  assert.deepEqual(M.resultadoEscenario({...s,oferta_sin_iva:0},'COMPLETA'),{beneficio:null,margen:null});
});
