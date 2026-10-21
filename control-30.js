'use strict';
/* Registro de licitaciones independiente: solo SELECT con la sesión actual.
 * El informe completo permanece privado en Supabase; no se incluye en este repositorio.
 */
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
  function badge(value){
    const cls=['COMPLETADO','ESTUDIAR'].includes(value)?'ok':['FALLIDO','DESCARTAR'].includes(value)?'danger':'warn';
    return '<span class="badge '+cls+'">'+esc(etiquetas[value]||value||'Sin confirmar')+'</span>';
  }
  function enlace(value,label){const u=url(value);return u?'<a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(label||'Abrir fuente')+'</a>':'<span class="muted">Enlace pendiente de verificar</span>';}
  function puntos(values,vacio='Sin datos registrados'){
    const rows=lista(values);return rows.length?'<ul>'+rows.map(v=>'<li>'+esc(v)+'</li>').join('')+'</ul>':'<p class="muted">'+esc(vacio)+'</p>';
  }
  function kv(label,value){return '<div class="kv"><b>'+esc(label)+'</b><span>'+esc(value??'Pendiente')+'</span></div>';}
  function fuentes(rows){
    return '<ul class="li-sources">'+lista(rows).map(f=>'<li>'+enlace(f.url,f.nombre||f.url)+' · '+esc(f.estado||'Sin estado')+' · '+esc(fecha(f.comprobada_en))+(f.detalle?' — '+esc(f.detalle):'')+'</li>').join('')+'</ul>';
  }
  function oportunidad(o){
    const e=o.estimacion||{};
    const escenarios=lista(e.escenarios);
    const partidas=lista(e.partidas);
    return '<details class="card li-opportunity"><summary>'+esc(o.objeto||'Objeto pendiente')+' '+badge(o.recomendacion)+'</summary><div class="li-detail">'+
      '<p>'+esc(o.organo||'Órgano pendiente')+' · '+esc(o.expediente||'Expediente pendiente')+' · Lote: '+esc(o.lote??'Sin lote confirmado')+'</p>'+
      '<div class="li-grid">'+kv('Lugar',o.ubicacion)+kv('Estado de la licitación',o.estado)+kv('Presentación · hora peninsular',fecha(o.presentacion_limite))+
      kv('Presupuesto sin IVA',dinero(o.presupuesto_sin_iva,o.moneda))+kv('Presupuesto con IVA',dinero(o.presupuesto_con_iva,o.moneda))+kv('Valor estimado',dinero(o.valor_estimado,o.moneda))+'</div>'+
      '<p>'+enlace(o.url,'Anuncio oficial')+'</p><h4>Por qué interesa o se descarta</h4>'+puntos(o.motivos)+'<h4>Viabilidad</h4><div class="li-grid">'+
      ['administrativa','tecnica','economica','tesoreria'].map(k=>kv({administrativa:'Administrativa',tecnica:'Técnica',economica:'Económica',tesoreria:'Tesorería'}[k],o.viabilidad?.[k])).join('')+'</div>'+
      '<h4>Requisitos y plazo de ejecución</h4><p>'+esc(o.plazo_ejecucion||'Plazo pendiente de confirmar')+'</p>'+puntos(o.requisitos)+
      '<h4>Riesgos</h4>'+puntos(o.riesgos)+'<h4>Estimación orientativa</h4><p><b>Cobertura: '+esc(e.cobertura||'NO_ESTIMABLE')+'</b></p><p>'+esc(e.resumen||'Faltan datos suficientes para estimar el coste.')+'</p>'+
      (escenarios.length?'<div class="table-wrap"><table><thead><tr><th>Escenario</th><th>Coste sin IVA</th><th>Oferta sin IVA</th><th>Beneficio sin IVA</th><th>Margen sobre venta</th></tr></thead><tbody>'+escenarios.map(s=>{const n=M.resultadoEscenario(s,e.cobertura);return '<tr><td>'+esc(s.nombre)+'</td><td>'+esc(dinero(s.coste_total_sin_iva,o.moneda))+'</td><td>'+esc(dinero(s.oferta_sin_iva,o.moneda))+'</td><td>'+esc(dinero(n.beneficio,o.moneda))+'</td><td>'+esc(n.margen===null?'Pendiente':n.margen+' %')+'</td></tr>';}).join('')+'</tbody></table></div>':'')+
      (partidas.length?'<h4>Costes y procedencia de precios</h4><div class="table-wrap"><table><thead><tr><th>Partida</th><th>Cantidad / unidad</th><th>Precio unitario</th><th>Importe sin IVA</th><th>Origen y fecha</th><th>Evidencia / supuesto</th></tr></thead><tbody>'+partidas.map(p=>'<tr><td>'+esc(p.concepto)+'</td><td>'+esc(p.cantidad??'Pendiente')+' '+esc(p.unidad||'Unidad pendiente')+'</td><td>'+esc(dinero(p.precio_unitario,o.moneda))+'</td><td>'+esc(dinero(p.importe,o.moneda))+'</td><td>'+esc(p.origen||'Sin confirmar')+' · '+esc(fecha(p.fecha_precio))+'</td><td>'+esc(p.hipotesis||'')+' '+(p.fuente?enlace(p.fuente,'Fuente'):'')+'</td></tr>').join('')+'</tbody></table></div>':'')+
      '<h4>Supuestos y datos pendientes</h4>'+puntos([...lista(e.supuestos),...lista(e.faltantes),...lista(e.partidas_sin_precio)])+
      '<h4>Fuentes de esta oportunidad</h4>'+fuentes(o.fuentes)+'</div></details>';
  }
  async function abrir(){
    if(!has('costes.ver')){setContent('<div class="error">No tienes permiso para consultar estos informes.</div>');return;}
    setTopbar('Licitaciones','Informes diarios · Ponferrada, El Bierzo y León');
    setContent('<div id="liRegistro" class="li-stack"><div class="card li-head"><div><h2>Licitaciones para DAFRICA</h2><div class="muted">Inicio previsto de la revisión: 06:00 · hora peninsular · todos los días.</div></div><button id="liActualizar" class="btn secondary" type="button">Actualizar informes</button></div><p class="li-note">La revisión puede tardar. Cada informe indica sus fuentes y limitaciones. Las estimaciones orientan la decisión; los presupuestos oficiales se preparan en STEL Order.</p><div id="liAviso" role="status" aria-live="polite"></div><div id="liHistory"></div><div id="liDetail"></div></div>');
    const root=$('liRegistro'),history=root.querySelector('#liHistory'),detail=root.querySelector('#liDetail'),status=root.querySelector('#liAviso');
    let offset=0,lectura=0,listaVersion=0;
    const vigente=()=>root.isConnected&&state.module===modulo.id&&has('costes.ver');
    const fallo=e=>'<div class="error" role="alert">No se pudo leer el registro. '+esc(e.message||e)+'. No se ha comprobado si hay novedades.</div>';
    async function cargarDetalle(id){
      const request=++lectura;detail.innerHTML='<div class="loader">Cargando informe…</div>';
      try{
        const rows=await sb('/rest/v1/licitaciones_ejecuciones?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1');
        if(!vigente()||request!==lectura)return;
        const r=rows?.[0];if(!r){detail.innerHTML='<div class="empty">Informe no disponible con los permisos actuales.</div>';return;}
        const nota=aviso(r);
        detail.innerHTML='<div class="card li-stack"><div class="li-head"><h3>Informe del '+esc(fecha(r.fecha_local))+'</h3>'+badge(r.estado)+'</div>'+
          '<div class="li-state">Inicio: '+esc(fecha(r.iniciada_en))+' · Finalización: '+esc(r.finalizada_en?fecha(r.finalizada_en):'Todavía sin finalizar')+'</div>'+
          (nota?'<div class="module-note sensitive-note">'+esc(nota)+'</div>':'')+'<p class="li-plain">'+esc(r.resumen||'Informe todavía sin resumen.')+'</p>'+
          '<details><summary>Fuentes y cobertura de la revisión</summary>'+fuentes(r.fuentes)+'<h4>Limitaciones</h4>'+puntos(r.limitaciones,'No se han registrado limitaciones adicionales. La cobertura se describe en las fuentes.')+'</details></div>'+
          '<div class="card"><div class="li-filters"><div><label for="liBuscar">Buscar por obra, lugar, órgano o expediente</label><input id="liBuscar" type="search" placeholder="Buscar en este informe"></div><div><label for="liDecision">Recomendación</label><select id="liDecision"><option value="">Todas</option value="ESTUDIAR">Estudiar</option><option value="PENDIENTE_DE_DATOS">Pendiente de datos</option><option value="DESCARTAR">Descartar</option></select></div></div><p id="liCount" class="li-search-count" role="status"></p></div><div id="liItems" class="li-stack"></div>'+
          '<details class="card"><summary>Leer informe completo</summary><div class="li-report">'+esc(r.informe||'No hay un informe final registrado.')+'</div></details>';
        const items=detail.querySelector('#liItems'),count=detail.querySelector('#liCount');
        function pintar(){
          const filtered=filtrar(r.oportunidades,detail.querySelector('#liBuscar').value,detail.querySelector('#liDecision').value);
          count.textContent=filtered.length+' de '+lista(r.oportunidades).length+' oportunidades registradas en este informe.';
          items.innerHTML=filtered.length?filtered.map(oportunidad).join(''):'<div class="card empty">'+(lista(r.oportunidades).length?'No hay coincidencias con estos filtros.':'No hay oportunidades registradas. Consulta las fuentes y el estado de la revisión antes de concluir que no hay licitaciones.')+'</div>';
        }
        detail.querySelector('#liBuscar').oninput=pintar;detail.querySelector('#liDecision').onchange=pintar;pintar();
      }catch(e){if(vigente()&&request===lectura)detail.innerHTML=fallo(e);}
    }
    async function cargarHistorial(){
      const request=++listaVersion;++lectura;
      history.innerHTML='<div class="loader">Leyendo historial…</div>';detail.innerHTML='';status.textContent='';
      try{
        const rows=await sb('/rest/v1/licitaciones_ejecuciones?select=id,fecha_local,estado,iniciada_en,finalizada_en,resumen&order=fecha_local.desc,iniciada_en.desc,id.desc&limit=21&offset='+offset);
        if(!vigente()||request!==listaVersion)return;
        const page=lista(rows).slice(0,20);
        if(!page.length){
          history.innerHTML='<div class="card">'+esc(offset?'No hay más informes.':aviso(null))+(offset?'<p><button id="liVolver" class="btn secondary" type="button">Volver al inicio</button></p>':'')+'</div>';
          if(offset)history.querySelector('#liVolver').onclick=()=>{offset=0;cargarHistorial();};return;
        }
        status.textContent=offset?'Estás consultando informes anteriores.':aviso(page[0]);status.className=status.textContent?'module-note sensitive-note':'';
        history.innerHTML='<div class="card"><label for="liInforme">Historial de revisiones</label><select id="liInforme">'+page.map(r=>'<option value="'+esc(r.id)+'">'+esc(fecha(r.fecha_local))+' · '+esc(etiquetas[r.estado]||r.estado)+'</option>').join('')+'</select><p class="li-note muted">Se conservan los informes anteriores para comparar novedades, cambios y estimaciones.</p><div class="li-pager"><button class="btn secondary" id="liPrev" type="button" '+(offset?'':'disabled')+'>Más recientes</button><span>Informes '+(offset+1)+'–'+(offset+page.length)+'</span><button class="btn secondary" id="liNext" type="button" '+(rows.length>20?'':'disabled')+'>Más antiguos</button></div></div>';
        history.querySelector('#liInforme').onchange=e=>cargarDetalle(e.target.value);
        history.querySelector('#liPrev').onclick=()=>{offset=Math.max(0,offset-20);cargarHistorial();};
        history.querySelector('#liNext').onclick=()=>{offset+=20;cargarHistorial();};
        await cargarDetalle(page[0].id);
      }catch(e){if(vigente()&&request===listaVersion)history.innerHTML=fallo(e);}
    }
    root.querySelector('#liActualizar').onclick=()=>{offset=0;cargarHistorial();};
    await cargarHistorial();
  }
})();
