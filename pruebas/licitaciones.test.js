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

function modeloSintetico(){
  return {cobertura:'PARCIAL',partidas:[{concepto:'Paquete sintético completo',importe:110}],
    modelo_economico:{alcance:'TODAS_LAS_FAMILIAS_MODELADAS',oferta_hipotetica:true,familias:Object.fromEntries(M.familiasCoste.map(k=>[k,'INCLUIDA_EN_PARTIDAS']))},
    escenarios:['PESIMISTA','BASE','OPTIMISTA'].map((nombre,i)=>({nombre,coste_total_sin_iva:120-i*10,oferta_sin_iva:100,beneficio_sin_iva:9999,margen_pct:99}))};
}
test('licitaciones: simulación completa por familias muestra pérdidas y recalcula cifras, sin cambiar cobertura',()=>{
  const e=modeloSintetico(),base=e.escenarios[1];
  assert.equal(M.modeloSimulable(e),true);
  assert.deepEqual(M.resultadoEscenario(base,'PARCIAL',e),{beneficio:-10,margen:-10});
  assert.equal(M.baseEconomica({estimacion:e}).tipo,'SIMULACION');
  assert.equal(e.cobertura,'PARCIAL');
});
test('licitaciones: no basta una bandera para inventar un margen con partidas sin precio',()=>{
  const e=modeloSintetico();
  for(const cambio of [x=>delete x.modelo_economico.familias.materiales,x=>x.modelo_economico.familias.maquinaria='COTIZACION_PENDIENTE',x=>x.partidas[0].importe=null,x=>x.partidas[0].importe=100,x=>x.modelo_economico.oferta_hipotetica=false,x=>x.escenarios[0].oferta_sin_iva=200,x=>x.escenarios[0].nombre='BASE',x=>x.escenarios[0].coste_total_sin_iva=null]){
    const f=structuredClone(e);cambio(f);assert.equal(M.modeloSimulable(f),false);assert.equal(M.baseEconomica({estimacion:f}).beneficio,null);
  }
});
test('licitaciones: el límite de coste es un objetivo hipotético recalculado, no un beneficio estimado',()=>{
  const o={estimacion:{umbrales_economicos:{oferta_hipotetica_sin_iva:100,margenes_objetivo_pct:[8,10,null,101],supuesto:'Hipótesis sintética'}}};
  assert.deepEqual(M.umbrales(o).map(u=>u.costeMaximo),[92,90]);
  assert.deepEqual(M.umbrales({estimacion:{}}),[]);
  assert.equal(M.baseEconomica(o).beneficio,null);
});
test('licitaciones: fuentes admiten URLs y objetos conservando el bloqueo de protocolos y credenciales',()=>{
  assert.equal(M.fuente('https://example.org/pliego').url,'https://example.org/pliego');
  assert.equal(M.fuente({nombre:'PPT ficticio',url:'https://example.org/ppt'}).nombre,'PPT ficticio');
  for(const f of ['javascript:alert(1)',{url:'https://user:secret@example.org'},null,{}])assert.equal(M.fuente(f).url,null);
});
test('licitaciones: fecha parcial sirve para aviso de calendario sin inventar zona u hora',()=>{
  const now=new Date('2026-10-22T08:00:00Z');
  const p=M.plazo({presentacion_fecha:'2026-10-24',presentacion_texto:'24/10 a las 23:59; zona no indicada'},now);
  assert.equal(p.dias,2);assert.equal(p.urgencia,'URGENTE');assert.equal(p.instante,null);assert.match(p.texto,/zona no indicada/);
  assert.equal(M.plazo({presentacion_fecha:'2026-02-30'},now).urgencia,'SIN_FECHA');
  assert.equal(M.plazo({presentacion_limite:'2026-10-22T07:59:00Z'},now).urgencia,'VENCIDA');
});
test('licitaciones: resumen separa abiertas, modelos, pérdidas e históricos y deduplica lotes',()=>{
  const e=modeloSintetico(),o={organo:'Órgano ficticio',expediente:'EXP-FICTICIO',lote:'1',estado:'ABIERTA',recomendacion:'ESTUDIAR',estimacion:e,presentacion_fecha:'2026-10-24'};
  const rows=[o,o,{...o,lote:'2',estimacion:{}},{...o,lote:'3',estado:'ADJUDICADA'}];
  assert.deepEqual(M.resumen(rows,new Date('2026-10-22T08:00:00Z')),{total:3,abiertas:2,estudiar:2,conModelo:1,sinModelo:1,perdidasBase:1,urgentes:2});
  assert.equal(M.filtrar(rows,'','', 'SIN_MODELO').length,1);
  assert.equal(M.filtrar([o],'','ESTUDIAR','PERDIDA_BASE').length,1);
});
test('licitaciones: historial distingue revisión diaria de estudios del mismo día',()=>{
  const r={fecha_local:'2026-10-22',iniciada_en:'2026-10-22T04:00:00Z',estado:'PARCIAL'};
  assert.match(M.etiquetaInforme({...r,clave_ejecucion:'licitaciones-diarias:2026-10-22'}),/Revisión diaria/);
  assert.match(M.etiquetaInforme({...r,clave_ejecucion:'licitaciones-estudio:2026-10-22:ficticio'}),/Estudio complementario/);
});
