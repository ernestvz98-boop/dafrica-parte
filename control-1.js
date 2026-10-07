"use strict";

const SUPABASE_URL = "https://sbocfjxamjmwabmqbeyw.supabase.co";
const SUPABASE_KEY = "sb_publishable_fb3jW4X72iBoPs_bfUA6Dw_y5_z06r0";
const SESSION_KEY = "dafrica_web_session";

const state = {
  session: null,
  user: null,
  profile: null,
  roles: [],
  permissions: new Set(),
  module: "inicio",
  qrToken: "",
  machines: [],
  machineDocs: [],
  sidebarOpen: false
};

const $ = (id) => document.getElementById(id);

const modules = [
  {id:"inicio", label:"Inicio", icon:"⌂", always:true},
  {id:"maquinaria", label:"Maquinaria", icon:"⚙", permission:"maquinaria.ver"},
  {id:"mantenimiento", label:"Mantenimientos", icon:"🛠", permission:"mantenimiento.ver"},
  {id:"partes", label:"Partes", icon:"📝", any:["partes.ver","partes.crear","partes.editar"]},
  {id:"obras", label:"Obras", icon:"🏗", permission:"obras.ver"},
  {id:"vehiculos", label:"Vehículos", icon:"🚚", permission:"vehiculos.ver"},
  {id:"trabajadores", label:"Trabajadores", icon:"👷", permission:"trabajadores.ver"},
  {id:"epis", label:"EPIs", icon:"🦺", permission:"epis.ver"},
  {id:"localizacion", label:"Localización", icon:"⌖", permission:"localizacion.ver"},
  {id:"costes", label:"Costes / Consumos", icon:"€", permission:"costes.ver"},
  {id:"historial", label:"Historial", icon:"🕘", permission:"auditoria.ver"},
  {id:"administracion", label:"Administración", icon:"🔐", any:["usuarios.ver","usuarios.gestionar","configuracion.gestionar"]}
];

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function has(permission){
  return state.permissions.has(permission);
}

function allowed(mod){
  if(mod.always) return true;
  if(mod.permission) return has(mod.permission);
  if(mod.any) return mod.any.some(has);
  return false;
}

function getStoredSession(){
  try{
    const x = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    return x && x.access_token ? x : null;
  }catch{
    return null;
  }
}

function storeSession(s){
  if(!s){
    localStorage.removeItem(SESSION_KEY);
    state.session = null;
    return;
  }
  const obj = {
    access_token:s.access_token,
    refresh_token:s.refresh_token || state.session?.refresh_token || "",
    expires_at:s.expires_at || (Date.now() + ((s.expires_in || 3600) * 1000))
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  state.session = obj;
}

async function rawFetch(url, options={}){
  return fetch(url, options);
}

async function refreshSession(){
  const current = state.session || getStoredSession();
  if(!current?.refresh_token) return null;
  try{
    const r = await rawFetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method:"POST",
      headers:{"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({refresh_token:current.refresh_token})
    });
    if(!r.ok) return null;
    const d = await r.json();
    storeSession({
      access_token:d.access_token,
      refresh_token:d.refresh_token || current.refresh_token,
      expires_in:d.expires_in || 3600
    });
    return state.session;
  }catch{
    return null;
  }
}

async function authFetch(url, options={}, retry=true){
  if(!state.session) state.session = getStoredSession();
  if(!state.session?.access_token) throw new Error("AUTH_REQUIRED");

  if((state.session.expires_at || 0) < Date.now() + 45000){
    const renewed = await refreshSession();
    if(!renewed) throw new Error("AUTH_REQUIRED");
  }

  const headers = new Headers(options.headers || {});
  headers.set("apikey", SUPABASE_KEY);
  headers.set("Authorization", "Bearer " + state.session.access_token);
  if(options.body && !headers.has("Content-Type")) headers.set("Content-Type","application/json");

  const r = await rawFetch(url, {...options,headers});

  if(r.status === 401 && retry){
    const renewed = await refreshSession();
    if(!renewed) throw new Error("AUTH_REQUIRED");
    return authFetch(url, options, false);
  }

  return r;
}

async function sb(path, options={}){
  const r = await authFetch(SUPABASE_URL + path, options);
  const text = await r.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }

  if(!r.ok){
    const msg = data?.message || data?.hint || data?.error_description || data?.msg || ("HTTP " + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

async function login(email, password){
  const r = await rawFetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method:"POST",
    headers:{"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({email,password})
  });
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error_description || d.msg || "No se pudo iniciar sesión.");
  storeSession({
    access_token:d.access_token,
    refresh_token:d.refresh_token,
    expires_in:d.expires_in || 3600
  });
}

async function logout(){
  try{
    if(state.session?.access_token){
      await authFetch(SUPABASE_URL + "/auth/v1/logout", {method:"POST"}, false);
    }
  }catch{}
  storeSession(null);
  state.user = null;
  state.profile = null;
  state.roles = [];
  state.permissions = new Set();
  location.replace("./");
}

async function loadIdentity(){
  const userResp = await authFetch(SUPABASE_URL + "/auth/v1/user");
  if(!userResp.ok) throw new Error("AUTH_REQUIRED");
  state.user = await userResp.json();

  const [permRows, roleRows, profileRows] = await Promise.all([
    sb("/rest/v1/rpc/mis_permisos", {method:"POST",body:"{}"}),
    sb("/rest/v1/usuario_roles?select=roles(codigo,nombre)"),
    sb("/rest/v1/profiles?id=eq." + encodeURIComponent(state.user.id) + "&select=full_name,email,role&limit=1")
  ]);

  state.permissions = new Set((permRows || []).map(x => x.codigo));
  state.roles = (roleRows || []).map(x => x.roles).filter(Boolean);
  state.profile = (profileRows || [])[0] || null;
}

function showLogin(message=""){
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  $("loginMsg").textContent = message;
  $("loginMsg").className = message ? "error" : "";
}

function showApp(){
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}

function renderNav(){
  const nav = $("nav");
  nav.innerHTML = "";
  modules.filter(allowed).forEach(mod => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.module = mod.id;
    b.textContent = mod.icon + "  " + mod.label;
    if(mod.id === state.module) b.classList.add("active");
    b.addEventListener("click", () => navigate(mod.id));
    nav.appendChild(b);
  });

  const name = state.profile?.full_name || state.user?.email || "Usuario";
  $("sideUserName").textContent = name;
  $("sideUserEmail").textContent = state.user?.email || "";
  $("sideUserRoles").textContent = state.roles.map(r => r.nombre || r.codigo).join(" · ") || "Sin rol";
}

function setTopbar(title, subtitle=""){
  $("pageTitle").textContent = title;
  $("pageSubtitle").textContent = subtitle;
}

function setContent(html){
  $("content").innerHTML = html;
}

function loading(label="Cargando…"){
  setContent('<div class="loader">' + esc(label) + '</div>');
}

function navigate(id, options={}){
  const mod = modules.find(m => m.id === id);
  if(!mod || !allowed(mod)) id = "inicio";
  state.module = id;

  const params = new URLSearchParams(location.search);
  params.set("mod", id);
  if(id !== "maquinaria" || !options.keepToken){
    params.delete("token");
    state.qrToken = "";
  }
  history.replaceState(null, "", "./?" + params.toString());
  renderNav();
  renderModule().catch(handleModuleError);
  if(window.innerWidth <= 760) closeSidebar();
}

function openSidebar(){
  $("sidebar").classList.add("open");
  state.sidebarOpen = true;
}
function closeSidebar(){
  $("sidebar").classList.remove("open");
  state.sidebarOpen = false;
}

function handleModuleError(err){
  if(err?.message === "AUTH_REQUIRED" || err?.status === 401){
    showLogin("Tu sesión ha caducado. Inicia sesión de nuevo.");
    return;
  }
  setContent('<div class="card"><h2>No se pudo cargar</h2><div class="error">' + esc(err?.message || String(err)) + '</div></div>');
}

async function renderModule(){
  switch(state.module){
    case "maquinaria": return renderMachines();
    case "mantenimiento": return renderMaintenance();
    case "partes": return renderPartes();
    case "obras": return renderObras();
    case "vehiculos": return renderVehiculos();
    case "trabajadores": return renderWorkers();
    case "epis": return renderEpis();
    case "localizacion": return renderLocalizacion();
    case "costes": return renderCostes();
    case "historial": return renderHistorial();
    case "administracion": return renderAdministracion();
    default: return renderHome();
  }
}

async function countRows(table, permission){
  if(permission && !has(permission)) return null;
  try{
    const r = await authFetch(
      SUPABASE_URL + "/rest/v1/" + table + "?select=id&limit=1",
      {headers:{"Prefer":"count=exact","Range":"0-0"}}
    );
    if(!r.ok) return null;
    const range = r.headers.get("content-range") || "";
    const total = range.includes("/") ? Number(range.split("/").pop()) : null;
    return Number.isFinite(total) ? total : null;
  }catch{
    return null;
  }
}

