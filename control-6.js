async function renderCostes(){
  setTopbar("Costes / Consumos","Información económica restringida");
  loading("Cargando costes…");
  const docs = await sb("/rest/v1/coste_documentos?select=id,tipo,numero_documento,proveedor_nombre,fecha_documento,total,moneda,estado,ia_estado&order=fecha_documento.desc.nullslast,created_at.desc&limit=100");
  const total = (docs||[]).reduce((s,d)=>s+(Number(d.total)||0),0);
  const html = (docs||[]).map(d=>`<tr><td>${esc(d.fecha_documento||"—")}</td><td>${esc(d.tipo||"—")}</td><td><b>${esc(d.numero_documento||"—")}</b></td><td>${esc(d.proveedor_nombre||"—")}</td><td>${Number(d.total||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} ${esc(d.moneda||"EUR")}</td><td>${statusBadge(d.estado||d.ia_estado||"—")}</td></tr>`).join("");
  setContent(`
    <div class="module-note sensitive-note"><b>Acceso económico restringido.</b> Este módulo solo aparece para usuarios con <code>costes.ver</code>.</div>
    <div class="grid cards"><div class="card"><div class="metric-label">Documentos mostrados</div><div class="metric">${(docs||[]).length}</div></div><div class="card"><div class="metric-label">Total de la selección</div><div class="metric">${total.toLocaleString("es-ES",{maximumFractionDigits:2})} €</div></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Número</th><th>Proveedor</th><th>Total</th><th>Estado</th></tr></thead><tbody>${html || '<tr><td colspan="6" class="empty">Sin documentos de costes.</td></tr>'}</tbody></table></div>
  `);
}

async function renderHistorial(){
  setTopbar("Historial","Auditoría general");
  loading("Cargando auditoría…");
  const rows = await sb("/rest/v1/auditoria_sistema?select=*&order=creado_en.desc&limit=100").catch(()=>[]);
  if(!(rows||[]).length){
    setContent('<div class="card"><h2>Historial</h2><div class="muted">No hay registros disponibles o tu política de acceso no permite consultarlos.</div></div>');
    return;
  }
  const keys = Object.keys(rows[0] || {});
  const timeKey = keys.find(k=>/created_at|fecha|timestamp/i.test(k)) || keys[0];
  const actionKey = keys.find(k=>/accion|action|evento|tipo/i.test(k)) || keys[1];
  const entityKey = keys.find(k=>/entidad|tabla|entity|recurso/i.test(k)) || keys[2];
  const html = rows.map(r=>`<tr><td>${esc(r[timeKey] ? new Date(r[timeKey]).toLocaleString() : "—")}</td><td>${esc(r[actionKey]||"—")}</td><td>${esc(r[entityKey]||"—")}</td></tr>`).join("");
  setContent(`<div class="section-head"><div><h2>Auditoría</h2><p>Últimos 100 eventos.</p></div></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th></tr></thead><tbody>${html}</tbody></table></div>`);
}

async function bootstrap(){
  const loginForm = $("loginForm");
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("loginButton");
    btn.disabled = true;
    $("loginMsg").textContent = "Validando acceso…";
    $("loginMsg").className = "muted";
    try{
      await login($("loginEmail").value.trim(), $("loginPassword").value);
      $("loginPassword").value = "";
      await dosPasos();
      await loadIdentity();
      await enterApp();
    }catch(err){
      cerrarSesionPendiente();
      $("loginMsg").textContent = err.message === "AUTH_REQUIRED" ? "Sesión no válida." :
        err.message === "MFA_CANCELADO" ? "Entrada cancelada." : err.message;
      $("loginMsg").className = "error";
    }finally{
      btn.disabled = false;
    }
  });

  $("logoutButton").addEventListener("click",logout);
  $("mobileMenu").addEventListener("click",()=>state.sidebarOpen?closeSidebar():openSidebar());

  state.session = getStoredSession();
  if(state.session){
    try{
      await dosPasos();
      await loadIdentity();
      await enterApp();
      return;
    }catch{
      cerrarSesionPendiente();
    }
  }
  showLogin();
}

// Entrada sin terminar (código no puesto, cancelada o caducada): se cierra también en el servidor.
function cerrarSesionPendiente(){
  if(state.session?.access_token)
    rawFetch(SUPABASE_URL + "/auth/v1/logout", {method:"POST", headers:{apikey:SUPABASE_KEY, Authorization:"Bearer " + state.session.access_token}}).catch(()=>{});
  storeSession(null);
}

async function enterApp(){
  const params = new URLSearchParams(location.search);
  state.qrToken = params.get("token") || "";
  const requested = params.get("mod") || (state.qrToken ? "maquinaria" : "inicio");
  const mod = modules.find(m=>m.id===requested);
  state.module = mod && allowed(mod) ? requested : "inicio";

  if(state.qrToken && !has("maquinaria.ver")){
    state.module = "inicio";
    state.qrToken = "";
  }

  showApp();
  renderNav();
  await renderModule();

  if(state.qrToken && state.module === "maquinaria"){
    const p = new URLSearchParams(location.search);
    p.set("mod","maquinaria");
    history.replaceState(null,"","./?"+p.toString());
  }
}

document.addEventListener("DOMContentLoaded",bootstrap);
