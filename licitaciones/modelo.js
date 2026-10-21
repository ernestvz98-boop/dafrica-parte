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
  function resultadoEscenario(s,cobertura){
    const coste=numero(s.coste_total_sin_iva),oferta=numero(s.oferta_sin_iva);
    if(cobertura!=='COMPLETA'||coste===null||coste<0||oferta===null||oferta<=0)return {beneficio:null,margen:null};
    return {beneficio:Number((oferta-coste).toFixed(2)),margen:Number(((oferta-coste)/oferta*100).toFixed(2))};
  }
  function filtrar(items,texto='',decision=''){
    const q=texto.trim().toLocaleLowerCase('es');
    return lista(items).filter(o=>(!decision||o.recomendacion===decision)&&(!q||[o.objeto,o.organo,o.expediente,o.ubicacion,o.lote].join(' ').toLocaleLowerCase('es').includes(q)));
  }
  const api={lista,esc,url,numero,dinero,fecha,hoy,aviso,clave,resultadoEscenario,filtrar};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DafricaLicitaciones=api;
})(typeof window==='object'?window:globalThis);
