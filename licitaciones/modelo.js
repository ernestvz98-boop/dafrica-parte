(function(root){
  'use strict';
  function lista(value){ return Array.isArray(value) ? value : []; }
  function esc(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function url(value){
    try { const parsed=new URL(value); return parsed.protocol==='https:' && !parsed.username && !parsed.password ? parsed.href : null; }
    catch { return null; }
  }
  function numero(value){
    if(!['number','string'].includes(typeof value) || (typeof value==='string' && !value.trim()))return null;
    const n=Number(value); return Number.isFinite(n) ? n : null;
  }
  function dinero(value,moneda){
    const n=numero(value); if(n===null)return 'Pendiente';
    if(!/^[A-Z]{3}$/.test(moneda||''))return new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(n)+' (moneda sin confirmar)';
    try { return new Intl.NumberFormat('es-ES',{style:'currency',currency:moneda}).format(n); }
    catch { return String(n)+' '+moneda; }
  }
  function fecha(value){
    if(!value)return 'Sin confirmar';
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.split('-').reverse().join('/');
    // Un vencimiento sin zona horaria no es una hora confirmada.
    if(!/(Z|[+-]\d{2}:\d{2})$/.test(value))return String(value)+' (zona horaria sin confirmar)';
    const d=new Date(value); if(!Number.isFinite(d.getTime()))return 'Sin confirmar';
    return new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(d);
  }
  function hoy(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const get=t=>parts.find(p=>p.type===t).value;return get('year')+'-'+get('month')+'-'+get('day');
  }
  function aviso(ejecucion,now=new Date()){
    if(!ejecucion)return 'Todavía no hay revisiones registradas. Esto no significa que no existan licitaciones.';
    if(ejecucion.estado==='EN_CURSO')return now-new Date(ejecucion.iniciada_en)>7200000 ? 'Esta revisión lleva más de dos horas sin finalizar. No hay un resultado confirmado.' : 'Revisión iniciada. El informe todavía no está terminado.';
    if(ejecucion.fecha_local!==hoy(now))return 'Último informe de un día anterior. No confirma la revisión de hoy.';
    if(ejecucion.estado==='FALLIDO')return 'La revisión ha fallado. Consulta las limitaciones; no equivale a ausencia de oportunidades.';
    if(ejecucion.estado==='PARCIAL')return 'Revisión parcial. Hay fuentes o datos que no se han podido comprobar.';
    return '';
  }
  function clave(o){return [o.organo,o.expediente,o.lote??''].map(v=>String(v??'').trim()).join('|');}
  const familiasCoste=['materiales','mano_obra','maquinaria','subcontratas','desplazamientos','residuos','seguridad','indirectos','contingencia','financiacion','garantias'];
  function modeloSimulable(e){
    const m=e?.modelo_economico,base=lista(e?.escenarios).find(s=>s?.nombre==='BASE');
    if(m?.alcance!=='TODAS_LAS_FAMILIAS_MODELADAS'||m?.oferta_hipotetica!==true||!base)return false;
    const escenarios=lista(e.escenarios);
    if(escenarios.length!==3||new Set(escenarios.map(s=>s?.nombre)).size!==3||!['PESIMISTA','BASE','OPTIMISTA'].every(n=>escenarios.some(s=>s?.nombre===n)))return false;
    const oferta=numero(base.oferta_sin_iva);
    if(oferta===null||oferta<=0||escenarios.some(s=>numero(s.coste_total_sin_iva)===null||numero(s.coste_total_sin_iva)<=0||numero(s.oferta_sin_iva)!==oferta))return false;
    if(!familiasCoste.every(k=>['INCLUIDA_EN_PARTIDAS','PROVISIONADA'].includes(m.familias?.[k])))return false;
    const partes=lista(e.partidas);
    if(!partes.length||partes.some(p=>numero(p?.importe)===null||numero(p.importe)<0))return false;
    const suma=partes.reduce((a,p)=>a+numero(p.importe),0),coste=numero(base.coste_total_sin_iva);
    return coste!==null&&coste>0&&Math.abs(suma-coste)<=0.02;
  }
  function resultadoEscenario(s,cobertura,estimacion){
    const coste=numero(s.coste_total_sin_iva),oferta=numero(s.oferta_sin_iva);
    if((cobertura!=='COMPLETA'&&!modeloSimulable(estimacion))||coste===null||coste<0||oferta===null||oferta<=0)return {beneficio:null,margen:null};
    return {beneficio:Number((oferta-coste).toFixed(2)),margen:Number(((oferta-coste)/oferta*100).toFixed(2))};
  }
  function fuente(f){
    if(typeof f==='string')return {url:url(f),nombre:f,estado:'',detalle:'',comprobada_en:null};
    return {url:url(f?.url),nombre:String(f?.nombre||f?.url||'Fuente sin identificar'),estado:String(f?.estado||''),detalle:String(f?.detalle||''),comprobada_en:f?.comprobada_en||null};
  }
  function fechaCalendario(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;
  }
  function plazo(o,now=new Date()){
    const exacto=typeof o?.presentacion_limite==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(o.presentacion_limite)&&Number.isFinite(new Date(o.presentacion_limite).getTime());
    const dia=exacto?hoy(new Date(o.presentacion_limite)):fechaCalendario(o?.presentacion_fecha);
    const texto=exacto?fecha(o.presentacion_limite):String(o?.presentacion_texto||'Fecha y hora pendientes de confirmar');
    if(!dia)return {texto,dias:null,urgencia:'SIN_FECHA',instante:null};
    const dias=Math.round((new Date(dia+'T12:00:00Z')-new Date(hoy(now)+'T12:00:00Z'))/86400000);
    const vencida=exacto?new Date(o.presentacion_limite)<now:dias<0;
    return {texto,dias,urgencia:vencida?'VENCIDA':dias<=3?'URGENTE':'EN_PLAZO',instante:exacto?new Date(o.presentacion_limite).getTime():null};
  }
  function abierta(o){return o?.estado==='ABIERTA';}
  function baseEconomica(o){
    const e=o?.estimacion||{},s=lista(e.escenarios).find(x=>x?.nombre==='BASE');
    const resultado=s?resultadoEscenario(s,e.cobertura,e):{beneficio:null,margen:null};
    const sim=modeloSimulable(e);
    return {...resultado,coste:numero(s?.coste_total_sin_iva),oferta:numero(s?.oferta_sin_iva),tipo:sim?'SIMULACION':e.cobertura==='COMPLETA'&&resultado.beneficio!==null?'ESTIMACION':'SIN_ESTIMACION'};
  }
  function umbrales(o){
    const u=o?.estimacion?.umbrales_economicos,oferta=numero(u?.oferta_hipotetica_sin_iva);
    if(oferta===null||oferta<=0)return [];
    return lista(u.margenes_objetivo_pct).map(numero).filter(n=>n!==null&&n>0&&n<100).map(margen=>({oferta,margen,costeMaximo:Number((oferta*(1-margen/100)).toFixed(2)),supuesto:String(u.supuesto||'Objetivo hipotético de gestión; no es beneficio previsto.')}));
  }
  function resumen(items,now=new Date()){
    const unicas=new Map();for(const o of lista(items))if(o&&typeof o==='object'&&!unicas.has(clave(o)))unicas.set(clave(o),o);
    const abiertas=[...unicas.values()].filter(abierta),econ=abiertas.map(baseEconomica);
    return {total:unicas.size,abiertas:abiertas.length,estudiar:abiertas.filter(o=>o.recomendacion==='ESTUDIAR').length,
      conModelo:econ.filter(e=>e.beneficio!==null).length,sinModelo:econ.filter(e=>e.beneficio===null).length,
      perdidasBase:econ.filter(e=>e.beneficio!==null&&e.beneficio<0).length,
      urgentes:abiertas.filter(o=>plazo(o,now).urgencia==='URGENTE').length};
  }
  function etiquetaInforme(r){
    const tipo=String(r?.clave_ejecucion||'').startsWith('licitaciones-diarias:')?'Revisión diaria':String(r?.clave_ejecucion||'').startsWith('licitaciones-estudio:')?'Estudio complementario':'Informe';
    return fecha(r?.fecha_local)+' · '+tipo+' · '+fecha(r?.iniciada_en)+' · '+({PARCIAL:'Parcial',FALLIDO:'Fallido',COMPLETADO:'Completado',EN_CURSO:'En curso'}[r?.estado]||'Sin estado');
  }
  function filtrar(items,texto='',decision='',economia='',now=new Date()){
    const q=texto.trim().toLocaleLowerCase('es');
    return lista(items).filter(o=>{
      if(!o||typeof o!=='object')return false;
      const e=baseEconomica(o);
      const match=!economia||economia==='CON_MODELO'&&e.beneficio!==null||economia==='SIN_MODELO'&&e.beneficio===null||economia==='PERDIDA_BASE'&&e.beneficio!==null&&e.beneficio<0||economia==='URGENTE'&&abierta(o)&&plazo(o,now).urgencia==='URGENTE';
      return match&&(!decision||o.recomendacion===decision)&&(!q||[o.objeto,o.organo,o.expediente,o.ubicacion,o.lote].join(' ').toLocaleLowerCase('es').includes(q));
    });
  }
  const api={lista,esc,url,numero,dinero,fecha,hoy,aviso,clave,resultadoEscenario,filtrar,fuente,plazo,resumen,baseEconomica,umbrales,modeloSimulable,familiasCoste,etiquetaInforme};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DafricaLicitaciones=api;
})(typeof window==='object'?window:globalThis);
