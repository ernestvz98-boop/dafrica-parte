'use strict';
/* Registro privado e independiente: solo SELECT; sin operaciones STEL ni cambios del lector. */
(function(){
  const M=window.DafricaLicitaciones;
  const modulo={id:'licitaciones',label:'Licitaciones',icon:'▤',permission:'costes.ver'};
  if(!modules.some(m=>m.id===modulo.id)){
    const i=modules.findIndex(m=>m.id==='costes');modules.splice(i<0?modules.length:i,0,modulo);
  }
  const anterior=renderModule;
  renderModule=async function(){
    if(state.module===modulo.id)return abrir();
    return anterior();
  };
  const {lista,esc,url,dinero,fecha,aviso,filtrar}=M;
  const etiquetas={EN_CURSO:'En curso',COMPLETADO:'Completado',PARCIAL:'Parcial',FALLIDO:'Fallido',ESTUDIAR:'Estudiar',PENDIENTE_DE_DATOS:'Pendiente de datos',DESCARTAR:'Descartar'};
  function badge(v){
    const cls=v==='COMPLETADO'?'ok':['FALLIDO','DESCARTAR'].includes(v)?'danger':'warn';
    return '<span class="badge '+cls+'">'+esc(etiquetas[v]||v||'Sin confirmar')+'</span>';
  }
  function enlace(v,label){
    const u=url(v);
    return u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label||'Abrir fuente')+'</a>':'<span class="muted">Enlace pendiente de verificar</span>';
  }
  function puntos(v,vacio='Sin datos registrados'){
    const rows=lista(v);return rows.length?'<ul>'+rows.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<p class="muted">'+esc(vacio)+'</p>';
  }
  function kv(label,v){return '<div class="kv"><b>'+esc(label)+'</b><span>'+esc(v??'Pendiente')+'</span></div>';}
  function fuentes(v){
    const rows=lista(v).map(M.fuente);
    return rows.length?'<ul class="li-sources">'+rows.map(f=>'<li>'+enlace(f.url,f.nombre)+(f.estado?' · '+esc(f.estado):'')+(f.comprobada_en?' · '+esc(fecha(f.comprobada_en)):'')+(f.detalle?' — '+esc(f.detalle):'')+'</li>').join('')+'</ul>':'<p class="muted">No hay fuentes registradas en esta ficha.</p>';
  }
  function resultadoTexto(e,moneda){
    return e.beneficio===null?'Sin cálculo defendible':dinero(e.beneficio,moneda)+(e.tipo==='SIMULACION'?' · simulación':' · estimación');
  }
  function oportunidad(o,i){
    const e=o.estimacion||{},escenarios=lista(e.escenarios),partidas=lista(e.partidas);
    const base=M.baseEconomica(o),plazo=M.plazo(o),umbrales=M.umbrales(o);
    return '<details id="liOpportunity'+i+'" class="card li-opportunity"><summary><span>'+esc(o.objeto||'Objeto pendiente')+'</span> '+badge(o.recomendacion)+'<span class="li-summary-result '+(base.beneficio!==null&&base.beneficio<0?'li-negative':'')+'">'+esc(resultadoTexto(base,o.moneda))+'</span></summary><div class="li-detail">'+
      '<p>'+esc(o.organo||'Órgano pendiente')+' · '+esc(o.expediente||'Expediente pendiente')+' · Lote: '+esc(o.lote??'Sin lote confirmado')+'</p>'+
      '<div class="li-grid">'+kv('Lugar',o.ubicacion)+kv('Estado de la licitación',o.estado)+kv('Límite de presentación publicado',plazo.texto)+
      kv('Presupuesto sin IVA',dinero(o.presupuesto_sin_iva,o.moneda))+kv('Presupuesto con IVA',dinero(o.presupuesto_con_iva,o.moneda))+kv('Valor estimado',dinero(o.valor_estimado,o.moneda))+'</div>'+
      '<p>'+enlace(o.url,'Anuncio oficial')+'</p><h4>Por qué interesa o se descarta</h4>'+puntos(o.motivos)+
      '<h4>Viabilidad</h4><div class="li-grid">'+['administrativa','tecnica','economica','tesoreria'].map(k=>kv({administrativa:'Administrativa',tecnica:'Técnica',economica:'Económica',tesoreria:'Tesorería'}[k],o.viabilidad?.[k])).join('')+'</div>'+
      '<h4>Requisitos y plazo de ejecución</h4><p>'+esc(o.plazo_ejecucion||'Plazo pendiente de confirmar')+'</p>'+puntos(o.requisitos)+
      '<h4>Riesgos</h4>'+puntos(o.riesgos)+
      '<h4>Estimación orientativa</h4><p><b>Cobertura documental y comercial: '+esc(e.cobertura||'NO_ESTIMABLE')+'</b></p><p>'+esc(e.resumen||'Faltan datos suficientes para estimar el coste.')+'</p>'+
      (base.tipo==='SIMULACION'?'<p class="module-note sensitive-note"><b>Simulación con supuestos.</b> Se han modelado las familias de coste y comprobado la suma del caso base. Los precios propios siguen pendientes de validación y la oferta es hipotética. Estos resultados no aseguran beneficio ni adjudicación.</p>':'')+
      (escenarios.length?'<div class="table-wrap"><table><thead><tr><th>Escenario</th><th>Coste sin IVA</th><th>Oferta sin IVA</th><th>Resultado estimado sin IVA</th><th>Margen sobre venta</th></tr></thead><tbody>'+escenarios.map(s=>{
        const n=M.resultadoEscenario(s,e.cobertura,e);
        return '<tr><td>'+esc(s.nombre)+'</td><td>'+esc(dinero(s.coste_total_sin_iva,o.moneda))+'</td><td>'+esc(dinero(s.oferta_sin_iva,o.moneda))+'</td><td class="'+(n.beneficio!==null&&n.beneficio<0?'li-negative':'')+'">'+esc(dinero(n.beneficio,o.moneda))+'</td><td>'+esc(n.margen===null?'Pendiente':n.margen+' %')+'</td></tr>';
      }).join('')+'</tbody></table></div>':'')+
      (partidas.length?'<h4>Costes y procedencia de precios</h4><div class="table-wrap"><table><thead><tr><th>Partida</th><th>Cantidad / unidad</th><th>Precio unitario</th><th>Importe sin IVA</th><th>Origen y fecha</th><th>Evidencia / supuesto</th></tr></thead><tbody>'+partidas.map(p=>'<tr><td>'+esc(p.concepto)+'</td><td>'+esc(p.cantidad??'Pendiente')+' '+esc(p.unidad||'Unidad pendiente')+'</td><td>'+esc(dinero(p.precio_unitario,o.moneda))+'</td><td>'+esc(dinero(p.importe,o.moneda))+'</td><td>'+esc(p.origen||'Sin confirmar')+' · '+esc(fecha(p.fecha_precio))+'</td><td>'+esc(p.hipotesis||'')+' '+(p.fuente?enlace(p.fuente,'Fuente'):'')+'</td></tr>').join('')+'</tbody></table></div>':'')+
      (umbrales.length?'<h4>Coste máximo para un margen objetivo</h4><p>'+esc(umbrales[0].supuesto)+' Oferta hipotética sin IVA: '+esc(dinero(umbrales[0].oferta,o.moneda))+'. Estos límites no son una estimación de gasto ni una recomendación de oferta.</p><div class="li-grid">'+umbrales.map(u=>kv('Objetivo '+u.margen+' % sobre venta',dinero(u.costeMaximo,o.moneda)+' de coste total máximo sin IVA')).join('')+'</div>':'')+
      '<h4>Supuestos y datos pendientes</h4>'+puntos([...lista(e.supuestos),...lista(e.faltantes),...lista(e.partidas_sin_precio)])+
      '<h4>Fuentes de esta oportunidad</h4>'+fuentes(o.fuentes)+'</div></details>';
  }
  function panelDecision(r){
    if(r.estado==='EN_CURSO'||r.estado==='FALLIDO'&&!lista(r.oportunidades).length)return '<div class="card"><h3>Resultado todavía no disponible</h3><p>No se muestran contadores como si la revisión hubiera encontrado cero oportunidades. Consulta el último informe finalizado en el historial.</p></div>';
    const s=M.resumen(r.oportunidades),fallos=lista(r.fuentes).filter(f=>M.fuente(f).estado==='FALLIDA').length;
    const kpis=[['Abiertas en el informe',s.abiertas],['Para estudiar',s.estudiar],['Con cálculo condicionado',s.conModelo],['Sin cálculo defendible',s.sinModelo],['Casos base con pérdida',s.perdidasBase],['Vencen en 0–3 días',s.urgentes]];
    return '<div class="card li-stack"><h3>Decisión económica</h3><div class="li-kpis">'+kpis.map(([label,n])=>'<div class="li-kpi"><b>'+esc(n)+'</b><span>'+esc(label)+'</span></div>').join('')+'</div><p class="li-note">Estudiar indica interés para profundizar. No acredita solvencia, disponibilidad ni rentabilidad. El presupuesto de licitación es un límite de ingreso, no el coste de DAFRICA.</p>'+(fallos?'<p class="li-negative">'+esc(fallos)+' fuentes con fallo de acceso. Consulta la cobertura antes de interpretar los resultados.</p>':'')+'</div>';
  }
  function comparativa(rows){
    return '<div class="card"><h3>Comparativa de las fichas visibles</h3><div class="table-wrap"><table class="li-comparison"><thead><tr><th>Obra / expediente</th><th>Decisión de estudio</th><th>Vencimiento publicado</th><th>Oferta hipotética / estimada</th><th>Coste BASE</th><th>Resultado BASE</th><th>Margen</th><th></th></tr></thead><tbody>'+rows.map((o,i)=>{
      const e=M.baseEconomica(o),p=M.plazo(o);
      return '<tr><td><b>'+esc(o.ubicacion||o.objeto)+'</b><small>'+esc(o.expediente)+' · '+esc(o.lote??'Sin lote confirmado')+'</small></td><td>'+badge(o.recomendacion)+'</td><td>'+esc(p.texto)+(p.urgencia==='URGENTE'?'<small class="li-negative">Urgente · '+esc(p.dias)+' días de calendario</small>':'')+'</td><td>'+esc(dinero(e.oferta,o.moneda))+'</td><td>'+esc(dinero(e.coste,o.moneda))+'</td><td class="'+(e.beneficio!==null&&e.beneficio<0?'li-negative':'')+'">'+esc(resultadoTexto(e,o.moneda))+'</td><td>'+esc(e.margen===null?'Pendiente':e.margen+' %')+'</td><td><button type="button" class="btn secondary" data-li-open="'+i+'">Ver ficha</button></td></tr>';
    }).join('')+'</tbody></table></div><p class="li-note">Importes sin IVA y antes del Impuesto sobre Sociedades. Los resultados condicionados no son ofertas oficiales. Revisa los escenarios adversos y la tesorería en cada ficha.</p></div>';
  }
  async function abrir(){
    if(!has('costes.ver')){setContent('<div class="error">No tienes permiso para consultar estos informes.</div>');return;}
    setTopbar('Licitaciones','Informes diarios · Ponferrada, El Bierzo y León');
    setContent('<div id="liRegistro" class="li-stack"><div class="card li-head"><div><h2>Licitaciones para DAFRICA</h2><div class="muted">Inicio previsto: 06:00 · hora peninsular · todos los días.</div></div><button id="liActualizar" class="btn secondary" type="button">Actualizar informes</button></div><p class="li-note">Cada informe indica qué se pudo comprobar. Los estudios orientan la decisión; los presupuestos oficiales se preparan en STEL Order.</p><div id="liAviso" role="status" aria-live="polite"></div><div id="liHistory"></div><div id="liDetail"></div></div>');
    const root=$('liRegistro'),history=root.querySelector('#liHistory'),detail=root.querySelector('#liDetail'),status=root.querySelector('#liAviso');
    let offset=0,lectura=0,listaVersion=0,temporizador=null;
    const vigente=()=>root.isConnected&&state.module===modulo.id&&has('costes.ver');
    const fallo=e=>'<div class="error" role="alert">No se pudo leer el registro. '+esc(e.message||e)+'. No se ha comprobado si hay novedades.</div>';
    async function cargarDetalle(id){
      clearTimeout(temporizador);
      const request=++lectura;detail.innerHTML='<div class="loader">Cargando informe…</div>';
      try{
        const rows=await sb('/rest/v1/licitaciones_ejecuciones?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');
        if(!vigente()||request!==lectura)return;
        const r=rows?.[0];if(!r){detail.innerHTML='<div class="empty">Informe no disponible con los permisos actuales.</div>';return;}
        const nota=aviso(r);
        detail.innerHTML='<div class="card li-stack"><div class="li-head"><h3>'+esc(M.etiquetaInforme(r))+'</h3>'+badge(r.estado)+'</div>'+
          '<div class="li-state">Inicio: '+esc(fecha(r.iniciada_en))+' · Finalización: '+esc(r.finalizada_en?fecha(r.finalizada_en):'Todavía sin finalizar')+'</div>'+
          (nota?'<div class="module-note sensitive-note">'+esc(nota)+'</div>':'')+'<p class="li-plain">'+esc(r.resumen||'Informe todavía sin resumen.')+'</p>'+
          '<details><summary>Fuentes y cobertura de la revisión</summary>'+fuentes(r.fuentes)+'<h4>Limitaciones</h4>'+puntos(r.limitaciones,'No se han registrado limitaciones adicionales. La cobertura se describe en las fuentes.')+'</details><div><button type="button" id="liDescargar" class="btn secondary">Descargar informe privado</button></div></div>'+panelDecision(r)+
          '<div class="card"><div class="li-filters"><div><label for="liBuscar">Buscar por obra, lugar, órgano o expediente</label><input id="liBuscar" type="search" placeholder="Buscar en este informe"></div><div><label for="liDecision">Recomendación</label><select id="liDecision"><option value="">Todas</option><option value="ESTUDIAR">Estudiar</option><option value="PENDIENTE_DE_DATOS">Pendiente de datos</option><option value="DESCARTAR">Descartar</option></select></div><div><label for="liEconomia">Análisis económico y plazo</label><select id="liEconomia"><option value="">Todas las fichas</option><option value="CON_MODELO">Con cálculo condicionado</option><option value="SIN_MODELO">Sin cálculo defendible</option><option value="PERDIDA_BASE">Con pérdida en el caso BASE</option><option value="URGENTE">Vencen en 0–3 días</option></select></div></div><p id="liCount" class="li-search-count" role="status"></p></div><div id="liComparison"></div><div id="liItems" class="li-stack"></div>'+
          '<details class="card"><summary>Leer informe completo</summary><div class="li-report">'+esc(r.informe||'No hay un informe final registrado.')+'</div></details>';
        const items=detail.querySelector('#liItems'),count=detail.querySelector('#liCount');
        function pintar(){
          const filtered=filtrar(r.oportunidades,detail.querySelector('#liBuscar').value,detail.querySelector('#liDecision').value,detail.querySelector('#liEconomia').value);
          count.textContent=filtered.length+' de '+lista(r.oportunidades).length+' oportunidades registradas en este informe.';
          detail.querySelector('#liComparison').innerHTML=filtered.length?comparativa(filtered):'';
          items.innerHTML=filtered.length?filtered.map(oportunidad).join(''):'<div class="card empty">'+(lista(r.oportunidades).length?'No hay coincidencias con estos filtros.':'No hay oportunidades registradas. Consulta las fuentes y el estado de la revisión antes de concluir que no hay licitaciones.')+'</div>';
          detail.querySelectorAll('[data-li-open]').forEach(b=>b.onclick=()=>{const f=items.querySelector('#liOpportunity'+b.dataset.liOpen);if(f){f.open=true;f.scrollIntoView({behavior:'smooth',block:'start'});}});
        }
        detail.querySelector('#liBuscar').oninput=pintar;detail.querySelector('#liDecision').onchange=pintar;detail.querySelector('#liEconomia').onchange=pintar;pintar();
        detail.querySelector('#liDescargar').onclick=()=>{
          if(!vigente())return;
          const texto='DAFRICA · INFORME PRIVADO\n'+M.etiquetaInforme(r)+'\n\n'+(r.resumen||'')+'\n\n'+(r.informe||'Informe sin finalizar.');
          const u=URL.createObjectURL(new Blob([texto],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
          a.href=u;a.download='licitaciones-'+String(r.fecha_local||'').replace(/[^0-9-]/g,'')+'-'+String(r.id||'').replace(/[^a-z0-9-]/gi,'').slice(0,8)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
        };
        if(r.estado==='EN_CURSO'&&Date.now()-new Date(r.iniciada_en)<7200000)temporizador=setTimeout(()=>{if(vigente()&&!document.hidden)cargarDetalle(r.id);},30000);
      }catch(e){if(vigente()&&request===lectura)detail.innerHTML=fallo(e);}
    }
    async function cargarHistorial(){
      clearTimeout(temporizador);
      const request=++listaVersion;++lectura;
      history.innerHTML='<div class="loader">Leyendo historial…</div>';detail.innerHTML='';status.textContent='';
      try{
        const rows=await sb('/rest/v1/licitaciones_ejecuciones?select=id,clave_ejecucion,fecha_local,estado,iniciada_en,finalizada_en,resumen&order=fecha_local.desc,iniciada_en.desc,id.desc&limit=21&offset='+offset);
        if(!vigente()||request!==listaVersion)return;
        const page=lista(rows).slice(0,20);
        if(!page.length){
          history.innerHTML='<div class="card">'+esc(offset?'No hay más informes.':aviso(null))+(offset?'<p><button id="liVolver" class="btn secondary" type="button">Volver al inicio</button></p>':'')+'</div>';
          if(offset)history.querySelector('#liVolver').onclick=()=>{offset=0;cargarHistorial();};return;
        }
        const seleccion=page.find(r=>['COMPLETADO','PARCIAL'].includes(r.estado))||page.find(r=>r.estado!=='EN_CURSO')||page[0];
        status.textContent=offset?'Estás consultando informes anteriores.':aviso(page[0])+(seleccion.id!==page[0].id?' Se muestra el último informe finalizado.':'');status.className=status.textContent?'module-note sensitive-note':'';
        history.innerHTML='<div class="card"><label for="liInforme">Historial de revisiones</label><select id="liInforme">'+page.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===seleccion.id?'selected':'')+'>'+esc(M.etiquetaInforme(r))+'</option>').join('')+'</select><p class="li-note muted">Se conservan los informes anteriores para comparar novedades, cambios y estimaciones.</p><div class="li-pager"><button class="btn secondary" id="liPrev" type="button" '+(offset?'':'disabled')+'>Más recientes</button><span>Informes '+(offset+1)+'–'+(offset+page.length)+'</span><button class="btn secondary" id="liNext" type="button" '+(rows.length>20?'':'disabled')+'>Más antiguos</button></div></div>';
        history.querySelector('#liInforme').onchange=e=>cargarDetalle(e.target.value);
        history.querySelector('#liPrev').onclick=()=>{offset=Math.max(0,offset-20);cargarHistorial();};
        history.querySelector('#liNext').onclick=()=>{offset+=20;cargarHistorial();};
        await cargarDetalle(seleccion.id);
      }catch(e){if(vigente()&&request===listaVersion)history.innerHTML=fallo(e);}
    }
    root.querySelector('#liActualizar').onclick=()=>{offset=0;cargarHistorial();};
    await cargarHistorial();
  }
})();
