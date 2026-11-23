// DAFRICA SAT · aplicación del técnico (y entrada a la de oficina). Todo se guarda primero en el teléfono.
import {CONFIG} from "./lib/config.js";
import {rpc, haySesion, entrar, salir, transcribir, descargar, SinConexion, ErrorApi} from "./lib/api.js";
import {kv, partes, archivos, pedirPersistencia, sha256} from "./lib/almacen.js";
import * as Cola from "./lib/cola.js";
import {organizarDictado} from "./lib/dictado.js";
import {contenidoNuevo, normalizar, iguales, problemasParaFirmar, minutosEntre, nuevoId, hoy, ahoraHora, resumenTipo, contenidoRapido,
  horasTexto, minutosDeHoras, TIPOS_VISITA, PENDIENTE_DE, RESULTADOS, MOMENTOS, PRIORIDADES} from "./lib/contenido.js";
import {PanelFirma, comprimirFoto, grabarAudio, extensionAudio} from "./lib/medios.js";
import {articuloPorReferencia, camposDePrecio, descuentoTexto} from "./lib/materiales-albaran.js";
import {generarPdfParte, huellaContenido} from "./lib/pdf.js";
import {esc, $, $$, avisar, dialogo, confirmar, pedirTexto, elegir, fechaHora, fechaCorta, chipEstado, abrirBlob, descargarBlob, compartirBlob} from "./lib/ui.js";

const S = {yo: null, catalogo: {clientes: [], direcciones: [], contactos: [], equipos: [], articulos: [], tecnicos: []}, avisos: [], partesServidor: [],
  urls: [], grabacion: null, momentoFoto: "ANTES", propuesta: null, transcribiendo: new Set(), autoTranscrito: new Set(), leyendo: new Set(), momentoRapido: "DESPUES"};
const app = $("#app");
const UNIDADES = ["ud", "m", "cm", "mm", "l", "kg", "g", "rollo", "caja", "bote", "cartucho", "bolsa", "saco", "par", "h"];
const puede = (p) => Boolean(S.yo?.permisos?.includes(p));

// ------------------------------------------------------------------ arranque
async function iniciar() {
  if ("serviceWorker" in navigator && !CONFIG.local) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!haySesion()) {
    if (CONFIG.local) return pantallaEntrar();
    location.replace(CONFIG.loginProduccion);
    return;
  }
  pedirPersistencia();
  S.yo = await kv.get("yo"); S.catalogo = (await kv.get("catalogo")) || S.catalogo; S.avisos = (await kv.get("avisos")) || [];
  S.partesServidor = (await kv.get("partesServidor")) || [];
  Cola.alCambiar(pintarSync);
  Cola.arrancar();
  window.addEventListener("hashchange", () => render());
  window.addEventListener("sat:codigo", (e) => { const el = $("#codigoParte"); if (el?.dataset.id === e.detail.id) el.textContent = e.detail.codigo; });
  $("#menu").hidden = false;
  await refrescar({silencioso: true});
  setInterval(() => refrescar({silencioso: true}), 60000);
  // Si se cerró la aplicación a mitad de un parte, al abrirla se sigue con él (usuario, 2026-11-23: «por si se le cierra, que no
  // empiece de cero, que quede guardado para seguir»). Todo lo hecho ya está guardado en el teléfono al momento.
  if (!location.hash || location.hash === "#/avisos") {
    const enCurso = await partesEnCurso();
    if (enCurso.length === 1) location.hash = rutaParte(enCurso[0]);
  }
  render();
}

/** Partes empezados en este teléfono y todavía no enviados (lo más reciente primero). */
async function partesEnCurso() {
  return (await partes.todas()).filter((p) => p.estadoLocal !== "ENVIADO").sort((a, b) => (b.creado || 0) - (a.creado || 0));
}
const rutaParte = (p) => `#/parte/${p.id}/${p.contenido?.modo === "RAPIDO" ? "rapido" : "datos"}`;

async function refrescar({silencioso = false} = {}) {
  try {
    const [yo, catalogo, avisos, ps] = await Promise.all([rpc("sat_yo"), rpc("sat_catalogo"), rpc("sat_avisos_listar"), rpc("sat_partes_listar", {p_estado: null})]);
    S.yo = yo; S.catalogo = catalogo; S.partesServidor = ps;
    // Los avisos creados en el teléfono que aún no han subido se conservan.
    const locales = (await kv.get("avisosLocales")) || [];
    const subidos = new Set(avisos.map((a) => a.id));
    const quedan = locales.filter((a) => !subidos.has(a.id));
    await kv.set("avisosLocales", quedan);
    S.avisos = [...quedan, ...avisos];
    await Promise.all([kv.set("yo", yo), kv.set("catalogo", catalogo), kv.set("avisos", S.avisos), kv.set("partesServidor", ps)]);
    await reabrirCorregibles(ps);
    $("#numNotis").hidden = !yo.no_leidas; $("#numNotis").textContent = yo.no_leidas;
    $("#menuAdmin").hidden = !(puede("sat.administrar") || puede("sat.facturar"));
    // El técnico solo hace el parte (albarán de trabajo); las facturas las hace la oficina (usuario, 2026-11-23).
    $("#menuFacturas").hidden = !(puede("sat.administrar") || puede("sat.facturar"));
    return true;
  } catch (e) {
    if (e instanceof ErrorApi && e.estado === 401) { salir(); return CONFIG.local ? pantallaEntrar() : location.replace(CONFIG.loginProduccion); }
    if (!silencioso && !(e instanceof SinConexion)) avisar(e.message, {error: true});
    return false;
  }
}

/** Si administración pide información, el parte enviado vuelve a poder corregirse en el teléfono. */
async function reabrirCorregibles(ps) {
  for (const s of ps) {
    if (s.estado !== "INFO_SOLICITADA") continue;
    const p = await partes.get(s.id);
    if (p && p.estadoLocal === "ENVIADO") {
      let nota = "";
      try { nota = (await rpc("sat_parte_detalle", {p_id: s.id})).decision_nota || ""; } catch { /* sin conexión */ }
      await partes.modificar(s.id, (x) => { Object.assign(x, {estadoLocal: "BORRADOR", envio: null, estadoServidor: "INFO_SOLICITADA", decisionNota: nota}); });
    }
  }
}

function pintarSync(e) {
  const el = $("#estadoSync");
  if (!el) return;
  if (e.sinConexion) { el.className = "sync off"; el.textContent = e.pendientes ? `Sin conexión · ${e.pendientes} por subir` : "Sin conexión"; }
  else if (e.errores?.length) { el.className = "sync err"; el.textContent = `${e.errores.length} con error`; }
  else if (e.pendientes) { el.className = "sync pend"; el.textContent = `${e.enMarcha ? "Subiendo" : "Por subir"} · ${e.pendientes}`; }
  else { el.className = "sync ok"; el.textContent = "✓ Todo subido"; }
  el.onclick = () => verCola(e);
}
async function verCola(e) {
  const t = e.tareas || [];
  const nombres = {ALTA: "Alta de cliente/dirección/equipo", AVISO: "Aviso", GUARDAR: "Guardar parte", ARCHIVO: "Foto, audio, firma o PDF", FIRMA: "Firma", ENVIAR: "Envío a administración"};
  const r = await dialogo(`<h2>Pendiente de subir</h2>${t.length ? `<ul>${t.map((x) => `<li>${esc(nombres[x.tipo] || x.tipo)}${x.error
    ? ` · <b style="color:var(--rojo)">${esc(x.error)}</b> <button type="button" class="boton mini sec" data-descartar="${x.n}">Descartar</button>` : ""}</li>`).join("")}</ul>`
    : "<p>Todo está subido.</p>"}${e.sinConexion ? `<p class="alerta ambar">Sin conexión: se subirá solo al recuperarla. No borres los datos de la aplicación.</p>` : ""}`,
  [{texto: "Cerrar", valor: null}, {texto: "Reintentar ahora", valor: "reintentar"}], {alAbrir: (d) => {
    d.querySelectorAll("[data-descartar]").forEach((b) => b.addEventListener("click", async () => {
      if (await confirmar("¿Descartar esta tarea? Lo que no se haya subido no llegará a la oficina.", "Descartar", "No", "peligro")) { await Cola.descartar(Number(b.dataset.descartar)); d.close(); }
    }));
  }});
  if (r === "reintentar") Cola.reintentarTodo();
}

function pantallaEntrar() {
  $("#menu").hidden = true;
  app.innerHTML = `<div class="tarjeta"><h1>Entrar</h1>${CONFIG.local ? `<p class="alerta azul">Entorno de PRUEBAS local (emulador): datos ficticios, nada llega a producción.</p>` : ""}
    <form id="fEntrar"><label for="eCorreo">Correo</label><input id="eCorreo" type="email" autocomplete="username" required>
    <label for="eClave">Contraseña</label><input id="eClave" type="password" autocomplete="current-password" required>
    <p id="eError" class="suave"></p><button class="boton ancho">Entrar</button></form></div>`;
  $("#fEntrar").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try { await entrar($("#eCorreo").value.trim(), $("#eClave").value); location.hash = "#/avisos"; location.reload(); }
    catch (e) { $("#eError").textContent = e.message; }
  });
}

// ------------------------------------------------------------------ rutas
async function render() {
  // Volver a pintar la MISMA pantalla (un toque en una opción) no la sube arriba del todo.
  const misma = S.ultimaVista === location.hash, y = window.scrollY;
  S.ultimaVista = location.hash;
  await pintarVista();
  if (misma) window.scrollTo(0, y);
}
async function pintarVista() {
  for (const u of S.urls.splice(0)) URL.revokeObjectURL(u);
  const [ruta, a, b] = (location.hash.replace(/^#\/?/, "") || "avisos").split("/");
  $$(".menu a").forEach((x) => x.classList.toggle("activo", x.dataset.ruta === ruta || (ruta === "parte" && x.dataset.ruta === "avisos")));
  if (!S.yo) { app.innerHTML = `<div class="alerta ambar">Sin conexión y sin datos guardados todavía: conéctate una vez para descargar tus avisos.</div>`; return; }
  if (!S.yo.permisos?.length) { app.innerHTML = `<div class="alerta rojo">Tu usuario no tiene permisos de SAT. Pide a administración el rol «Técnico de mantenimiento».</div>`; return; }
  try {
    if (ruta === "avisos") return await vistaAvisos();
    if (ruta === "aviso") return await vistaNuevoAviso();
    if (ruta === "nuevo") return await vistaNuevoParte();
    if (ruta === "parte") return await vistaParte(a, b || "datos");
    if (ruta === "bandeja") { if (!esOficina() && !(S.yo?.permisos || []).includes("sat.facturar")) { location.hash = "#/avisos"; return; } return await vistaBandeja(); }
    if (ruta === "notificaciones") return await vistaNotificaciones();
    if (ruta === "cuenta") return vistaCuenta();
    if (ruta === "admin") { const m = await import("./admin.js"); return await m.vistaAdmin(app, a, b, {S, refrescar, render}); }
    location.hash = "#/avisos";
  } catch (e) {
    app.innerHTML = `<div class="alerta rojo">${esc(e instanceof SinConexion ? "Esta pantalla necesita conexión." : e.message)}</div>`;
  }
}

// ------------------------------------------------------------------ avisos
// El técnico ve solo lo imprescindible (usuario, 2026-11-23: «que sea lo más sencillo de trabajar para él»); los atajos de
// oficina (aviso con todos los datos, modo detallado) solo con permiso de administración.
const esOficina = () => (S.yo?.permisos || []).includes("sat.administrar");

async function vistaAvisos() {
  const locales = await partes.todas();
  const porAviso = new Map();
  for (const p of locales) if (!porAviso.has(p.aviso_id) || p.estadoLocal !== "ENVIADO") porAviso.set(p.aviso_id, p);
  const servidorPorId = new Map(S.partesServidor.map((p) => [p.id, p]));
  const abiertos = S.avisos.filter((a) => !["CERRADO", "ANULADO"].includes(a.estado) && (a.tecnico_id === S.yo.id || !a.tecnico_id && a.origen === "LLAMADA_TECNICO"));
  const cerrados = S.avisos.filter((a) => a.estado === "CERRADO" && a.tecnico_id === S.yo.id).slice(0, 10);
  const tarjeta = (a) => {
    const p = porAviso.get(a.id);
    const ps = servidorPorId.get(p?.id);
    const estadoParte = p ? (p.estadoLocal === "ENVIADO" ? chipEstado(ps?.estado || p.estadoServidor || "ENVIADO") : (p.estadoServidor === "INFO_SOLICITADA"
      ? chipEstado("INFO_SOLICITADA") : `<span class="chip ambar">Parte en curso</span>`)) : "";
    return `<a class="tarjeta enlace" href="#/aviso-abrir" data-aviso="${esc(a.id)}">
      <div class="fila"><span class="chip ${esc(a.prioridad)}">${esc(PRIORIDADES[a.prioridad] || a.prioridad)}</span>
      <span class="suave">${esc(a.codigo || "Aviso nuevo (sin subir)")}</span>${estadoParte}</div>
      <h3>${esc(a.cliente_texto || "Sin cliente")}</h3><div>${esc(a.motivo)}</div>
      ${a.direccion_texto ? `<div class="suave">📍 ${esc(a.direccion_texto)}</div>` : ""}</a>`;
  };
  const enCurso = await partesEnCurso();
  app.innerHTML = `<div class="fila"><h1 class="crece">Mis avisos</h1></div>
    ${enCurso.map((p) => `<a class="boton ancho grande" href="${esc(rutaParte(p))}" style="margin-bottom:8px">▶ Seguir con el parte de ${esc(p.contenido?.cliente?.nombre || p.aviso?.motivo || "…")}</a>`).join("")}
    <a class="boton ${enCurso.length ? "sec" : "verde"} ancho grande" href="#/nuevo">＋ Nuevo parte</a>
    ${esOficina() ? `<p class="centro"><a class="suave peq" href="#/aviso/nuevo">Crear un aviso con todos los datos</a></p>` : ""}
    ${abiertos.length ? abiertos.map(tarjeta).join("") : `<p class="suave">No tienes avisos abiertos.</p>`}
    ${cerrados.length ? `<h2>Cerrados recientemente</h2>${cerrados.map(tarjeta).join("")}` : ""}`;
  $$("[data-aviso]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); abrirParteDeAviso(el.dataset.aviso); }));
}

async function abrirParteDeAviso(avisoId) {
  const aviso = S.avisos.find((a) => a.id === avisoId);
  const todas = (await partes.todas()).filter((p) => p.aviso_id === avisoId);
  const abierta = todas.find((p) => p.estadoLocal !== "ENVIADO");
  if (abierta) { location.hash = `#/parte/${abierta.id}/${abierta.contenido?.modo === "RAPIDO" ? "rapido" : "datos"}`; return; }
  if (todas.length) {
    const r = await dialogo(`<h2>${esc(aviso.codigo || "Aviso")}</h2><p>Este aviso ya tiene un parte enviado.</p>`,
      [{texto: "Ver el parte enviado", valor: "ver"}, {texto: "Nuevo parte (otra visita)", valor: "nuevo"}]);
    if (r === "ver") { location.hash = `#/parte/${todas[todas.length - 1].id}/firmas`; return; }
    if (r !== "nuevo") return;
  }
  if (aviso.estado === "CERRADO") { avisar("El aviso está cerrado.", {error: true}); return; }
  const id = nuevoId();
  // Por defecto, el parte rápido (usuario, 2026-11-18): grabar, fotos, horas y firma. El detallado sigue disponible.
  await partes.put({id, aviso_id: aviso.id, aviso: {codigo: aviso.codigo, motivo: aviso.motivo, prioridad: aviso.prioridad},
    contenido: normalizar({...contenidoNuevo(aviso, S.catalogo), modo: "RAPIDO"}), firmas: [], dictados: [], albaranes: {}, escrito: "",
    estadoLocal: "BORRADOR", creado: Date.now()});
  await Cola.poner("GUARDAR", "guardar:" + id, {parte_id: id});
  location.hash = `#/parte/${id}/rapido`;
}

/** Aviso del propio técnico (en el teléfono primero; se sube por la cola) y su parte rápido. */
async function crearAvisoYParte({cliente, direccion = null, contacto = null, equipo = null, motivo = "Intervención de mantenimiento", prioridad = "NORMAL"}) {
  for (const [tipo, x, lista] of [["CLIENTE", cliente, "clientes"], ["DIRECCION", direccion, "direcciones"], ["CONTACTO", contacto, "contactos"], ["EQUIPO", equipo, "equipos"]]) {
    if (!x?.nuevo) continue;
    const {nuevo, ...datos} = x;
    S.catalogo[lista].push(datos);
    await Cola.poner("ALTA", "alta:" + x.id, {tipo, datos: {...datos, cliente_id: tipo === "CLIENTE" ? undefined : cliente.id}});
  }
  await kv.set("catalogo", S.catalogo);
  const aviso = {id: nuevoId(), motivo, prioridad, cliente_id: cliente.id, direccion_id: direccion?.id || null,
    contacto_id: contacto?.id || null, equipo_id: equipo?.id || null, cliente_texto: cliente.nombre, direccion_texto: direccion?.texto || null,
    contacto_texto: contacto?.nombre || null, equipo_texto: equipo?.nombre || null, origen: "LLAMADA_TECNICO", tecnico_id: S.yo.id};
  const local = {...aviso, codigo: null, estado: "ASIGNADO"};
  const locales = (await kv.get("avisosLocales")) || [];
  await kv.set("avisosLocales", [...locales, local]);
  S.avisos = [local, ...S.avisos];
  await kv.set("avisos", S.avisos);
  await Cola.poner("AVISO", "aviso:" + aviso.id, {aviso});
  await abrirParteDeAviso(aviso.id);
}

const sinTildes = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nuevo parte: buscar el cliente (los de STEL ya están en el teléfono) y empezar. Nada más que rellenar.
async function vistaNuevoParte() {
  const cat = S.catalogo;
  const dirs = (c) => cat.direcciones.filter((d) => d.cliente_id === c.id);
  const hayStel = cat.clientes.some((c) => c.stel_id);
  app.innerHTML = `<div class="fila"><a href="#/avisos" class="boton mini sec">←</a><h1 class="crece">Nuevo parte</h1></div>
    ${hayStel ? "" : `<div class="alerta ambar">Todavía no están los clientes de STEL en el teléfono: en la oficina hay que pulsar «Actualizar catálogo desde STEL» (Oficina → Ajustes). Mientras, puedes añadir el cliente a mano.</div>`}
    <label for="bCli">Cliente</label><input id="bCli" type="search" placeholder="Nombre, NIF, teléfono o dirección" autocomplete="off" enterkeyhint="search">
    <div id="resCli" style="margin-top:8px"></div>
    <button type="button" class="boton sec ancho" id="bCliNuevo" style="margin-top:12px">El cliente no está: añadirlo</button>`;
  const pintar = () => {
    const q = sinTildes($("#bCli").value).split(/\s+/).filter(Boolean);
    const lista = !q.length ? [] : cat.clientes.filter((c) => {
      const t = sinTildes([c.nombre, c.nif, c.telefono, ...dirs(c).map((d) => d.texto)].join(" "));
      return q.every((p) => t.includes(p));
    }).slice(0, 40);
    $("#resCli").innerHTML = !q.length ? `<p class="suave peq">Escribe para buscar entre ${cat.clientes.length} clientes.</p>`
      : lista.map((c) => `<button type="button" class="eleccion" data-cli="${esc(c.id)}">${esc(c.nombre)}${c.provisional ? " <small>(nuevo, sin STEL)</small>" : ""}
        <small>${esc([dirs(c)[0]?.texto, c.nif, c.telefono].filter(Boolean).join(" · "))}</small></button>`).join("") || `<p class="suave">Ningún cliente coincide.</p>`;
    $$("[data-cli]").forEach((b) => b.onclick = async () => {
      if (S.creandoParte) return; // dos toques seguidos no crean dos partes
      const c = cat.clientes.find((x) => x.id === b.dataset.cli);
      // Ya hay un parte empezado de este cliente en el teléfono: se sigue con él (no se duplica).
      const previo = (await partesEnCurso()).find((p) => p.contenido?.cliente?.id === c.id);
      if (previo) {
        const r = await dialogo(`<h2>${esc(c.nombre)}</h2><p>Ya tienes un parte empezado de este cliente.</p>`,
          [{texto: "Es otro trabajo: parte nuevo", valor: "nuevo"}, {texto: "Seguir con ese", valor: "seguir"}]); // el último es el destacado
        if (r === "seguir") { location.hash = rutaParte(previo); return; }
        if (r !== "nuevo") return;
      }
      const ds = dirs(c);
      let direccion = ds.length === 1 ? ds[0] : null;
      if (ds.length > 1) {
        direccion = await elegir("¿Dónde es el trabajo?", ds, {texto: (d) => d.texto, nuevo: "Otra dirección"});
        if (direccion === "nuevo") direccion = null;
        else if (!direccion) return;
      }
      S.creandoParte = true;
      try { await crearAvisoYParte({cliente: c, direccion}); } finally { S.creandoParte = false; }
    });
  };
  $("#bCli").addEventListener("input", pintar);
  $("#bCliNuevo").onclick = async () => {
    const d = await dialogo(`<h2>Cliente nuevo</h2><p class="suave">Queda provisional: la oficina lo vincula con STEL (no se duplica).</p>
      <label>Nombre o razón social</label><input id="nNombre" value="${esc($("#bCli").value)}"><label>Teléfono (si lo tienes)</label><input id="nTel" inputmode="tel">
      <label>Dirección del trabajo</label><input id="nDir">`,
    [{texto: "Cancelar", valor: null}, {texto: "Empezar el parte", valor: (x) => ({nombre: $("#nNombre", x).value.trim(), telefono: $("#nTel", x).value.trim(), dir: $("#nDir", x).value.trim()}),
      validar: (x) => $("#nNombre", x).value.trim().length > 1}]);
    if (!d) return;
    const cliente = {id: nuevoId(), nombre: d.nombre, nif: "", telefono: d.telefono, provisional: true, nuevo: true};
    const direccion = d.dir ? {id: nuevoId(), cliente_id: cliente.id, texto: d.dir, provisional: true, nuevo: true} : null;
    await crearAvisoYParte({cliente, direccion});
  };
  pintar();
  $("#bCli").focus();
}

// Aviso creado por el técnico (llamada directa), con altas provisionales si el cliente no existe.
async function vistaNuevoAviso() {
  const f = {cliente: null, direccion: null, contacto: null, equipo: null, prioridad: "NORMAL"};
  const cat = S.catalogo;
  const pintar = () => {
    const dirs = cat.direcciones.filter((d) => d.cliente_id === f.cliente?.id);
    const cons = cat.contactos.filter((d) => d.cliente_id === f.cliente?.id);
    const eqs = cat.equipos.filter((d) => d.cliente_id === f.cliente?.id);
    app.innerHTML = `<h1>Aviso por llamada</h1><div class="tarjeta">
      <label>Cliente</label><button type="button" class="eleccion" id="bCliente">${f.cliente ? esc(f.cliente.nombre) + (f.cliente.provisional ? " <small>Nuevo (provisional)</small>" : "") : "Elegir cliente…"}</button>
      ${f.cliente ? `<label>Dirección de la intervención</label><select id="sDir"><option value="">—</option>${dirs.map((d) => `<option value="${esc(d.id)}" ${f.direccion?.id === d.id ? "selected" : ""}>${esc(d.texto)}</option>`).join("")}<option value="nuevo">＋ Otra dirección…</option></select>
      <label>Persona de contacto</label><select id="sCon"><option value="">—</option>${cons.map((d) => `<option value="${esc(d.id)}" ${f.contacto?.id === d.id ? "selected" : ""}>${esc(d.nombre)}${d.cargo ? " · " + esc(d.cargo) : ""}</option>`).join("")}<option value="nuevo">＋ Otra persona…</option></select>
      <label>Instalación o equipo</label><select id="sEq"><option value="">—</option>${eqs.map((d) => `<option value="${esc(d.id)}" ${f.equipo?.id === d.id ? "selected" : ""}>${esc([d.nombre, d.marca, d.modelo].filter(Boolean).join(" · "))}</option>`).join("")}<option value="nuevo">＋ Otro equipo…</option></select>` : ""}
      <label for="tMotivo">Motivo del aviso</label><textarea id="tMotivo" placeholder="Qué le pasa, qué ha dicho el cliente…">${esc(f.motivo || "")}</textarea>
      <label>Prioridad</label><div class="opciones">${Object.entries(PRIORIDADES).map(([k, v]) => `<button type="button" class="opcion ${f.prioridad === k ? "si" : ""}" data-prio="${k}">${v}</button>`).join("")}</div>
      </div><div class="pie-pasos"><a class="boton sec" href="#/avisos">Cancelar</a><button type="button" class="boton" id="bCrear">Crear y empezar parte</button></div>`;
    $("#bCliente").onclick = async () => {
      const c = await elegir("Cliente", cat.clientes, {texto: (x) => x.nombre, detalle: (x) => [x.nif, x.telefono].filter(Boolean).join(" · "), nuevo: "＋ Cliente nuevo"});
      if (c === "nuevo") {
        const d = await dialogo(`<h2>Cliente nuevo</h2><p class="suave">Queda provisional hasta que la oficina lo vincule con STEL (no se duplica).</p>
          <label>Nombre o razón social</label><input id="nNombre"><label>NIF (si lo sabes)</label><input id="nNif"><label>Teléfono</label><input id="nTel" inputmode="tel">`,
        [{texto: "Cancelar", valor: null}, {texto: "Añadir", valor: (x) => ({nombre: $("#nNombre", x).value.trim(), nif: $("#nNif", x).value.trim(), telefono: $("#nTel", x).value.trim()}),
          validar: (x) => $("#nNombre", x).value.trim().length > 1}]);
        if (d) { f.cliente = {id: nuevoId(), ...d, provisional: true, nuevo: true}; f.direccion = f.contacto = f.equipo = null; }
      } else if (c) { f.cliente = c; f.direccion = f.contacto = f.equipo = null; }
      f.motivo = $("#tMotivo").value; pintar();
    };
    const alta = async (sel, tipo) => {
      const el = $(sel); if (!el) return;
      el.onchange = async () => {
        f.motivo = $("#tMotivo").value;
        const lista = {direccion: cat.direcciones, contacto: cat.contactos, equipo: cat.equipos}[tipo];
        if (el.value !== "nuevo") { f[tipo] = lista.find((x) => x.id === el.value) || null; return; }
        const campos = {direccion: [["texto", "Dirección completa"]], contacto: [["nombre", "Nombre"], ["cargo", "Cargo"], ["telefono", "Teléfono"]],
          equipo: [["nombre", "Instalación o equipo"], ["marca", "Marca"], ["modelo", "Modelo"], ["numero_serie", "N.º de serie"]]}[tipo];
        const d = await dialogo(`<h2>Nuevo</h2>${campos.map(([k, t]) => `<label>${t}</label><input data-k="${k}">`).join("")}`,
          [{texto: "Cancelar", valor: null}, {texto: "Añadir", valor: (x) => Object.fromEntries($$("[data-k]", x).map((i) => [i.dataset.k, i.value.trim()])),
            validar: (x) => $$("[data-k]", x)[0].value.trim().length > 1}]);
        if (d) f[tipo] = {id: nuevoId(), cliente_id: f.cliente.id, ...d, provisional: true, nuevo: true};
        pintar();
      };
    };
    alta("#sDir", "direccion"); alta("#sCon", "contacto"); alta("#sEq", "equipo");
    if (f.direccion?.nuevo && $("#sDir")) $("#sDir").insertAdjacentHTML("afterend", `<p class="suave">Nueva: ${esc(f.direccion.texto)}</p>`);
    if (f.contacto?.nuevo && $("#sCon")) $("#sCon").insertAdjacentHTML("afterend", `<p class="suave">Nueva: ${esc(f.contacto.nombre)}</p>`);
    if (f.equipo?.nuevo && $("#sEq")) $("#sEq").insertAdjacentHTML("afterend", `<p class="suave">Nuevo: ${esc(f.equipo.nombre)}</p>`);
    $$("[data-prio]").forEach((b) => b.onclick = () => { f.prioridad = b.dataset.prio; f.motivo = $("#tMotivo").value; pintar(); });
    $("#bCrear").onclick = crear;
  };
  const crear = async () => {
    f.motivo = $("#tMotivo").value.trim();
    if (!f.motivo) return avisar("Escribe el motivo del aviso.", {error: true});
    if (!f.cliente) return avisar("Elige o añade el cliente.", {error: true});
    await crearAvisoYParte(f);
  };
  pintar();
}

// ------------------------------------------------------------------ parte
const PASOS = [["datos", "1 · Datos"], ["dictado", "2 · Dictado y fotos"], ["trabajo", "3 · Trabajo"], ["firmas", "4 · Revisar y firmar"]];
const firmaValida = (p, f) => iguales(f.contenido, p.contenido);

let guardarTemporizador = null;
/**
 * Cambia el contenido del parte en el teléfono (en fila con cualquier otro cambio: nunca se pierde uno) y lo pone a subir.
 * `fn(p)` cambia el parte en el sitio. Devuelve el parte guardado.
 */
async function cambiarParte(id, fn, {inmediato = false} = {}) {
  let cambio = false;
  const p = await partes.modificar(id, async (q) => {
    const antes = structuredClone(q.contenido);
    await fn(q);
    q.contenido = normalizar(q.contenido);
    cambio = !iguales(antes, q.contenido);
    if (cambio && q.envio) q.envio = null;
  });
  if (cambio) {
    clearTimeout(guardarTemporizador);
    const subir = () => Cola.poner("GUARDAR", "guardar:" + id, {parte_id: id});
    if (inmediato) await subir(); else guardarTemporizador = setTimeout(subir, 1500);
  }
  return p;
}

function asignar(obj, ruta, valor) {
  const k = ruta.split("."); let o = obj;
  for (const x of k.slice(0, -1)) { o[x] ??= {}; o = o[x]; }
  o[k.at(-1)] = valor;
}
function leerValor(el) {
  if (el.dataset.tipo === "horas") return String(el.value).trim() === "" ? null : minutosDeHoras(el.value);
  if (el.dataset.tipo === "num") { const v = String(el.value).replace(",", ".").trim(); return v === "" || !Number.isFinite(Number(v)) ? null : Number(v); }
  return el.value;
}

async function vistaParte(id, paso) {
  let p = await partes.get(id);
  if (!p) { app.innerHTML = `<div class="alerta rojo">Este parte no está en este teléfono.</div><a class="boton sec" href="#/avisos">Volver</a>`; return; }
  const editable = p.estadoLocal !== "ENVIADO";
  const c = p.contenido;
  const rapido = c.modo === "RAPIDO";
  if (rapido && ["datos", "dictado", "trabajo"].includes(paso)) { location.replace(`#/parte/${p.id}/rapido`); return; }
  if (!rapido && paso === "rapido") paso = "datos";
  const cabecera = `<div class="fila"><a href="#/avisos" class="boton mini sec">←</a><div class="crece"><b id="codigoParte" data-id="${esc(p.id)}">${esc(p.codigo || "Parte nuevo (sin subir)")}</b>
    <div class="suave peq">${esc(p.aviso?.codigo || "")} · ${esc(c.cliente?.nombre || "")}</div></div>${p.estadoLocal === "ENVIADO" ? chipEstado(p.estadoServidor || "ENVIADO") : ""}</div>
    ${p.estadoServidor === "INFO_SOLICITADA" && editable ? `<div class="alerta rojo"><b>La oficina pide información:</b> ${esc(p.decisionNota || "revisa el parte")}<br>Corrige lo necesario, vuelve a firmar y envía.</div>` : ""}
    ${rapido ? "" : `<nav class="pasos">${PASOS.map(([k, t]) => `<a href="#/parte/${p.id}/${k}" class="${k === paso ? "activo" : ""}">${t}</a>`).join("")}</nav>`}`;
  const ultimas = ["TECNICO", "CLIENTE"].map((r) => p.firmas.filter((f) => f.rol === r).at(-1)).filter(Boolean);
  const avisoFirmas = editable && ultimas.some((f) => !firmaValida(p, f))
    ? `<div class="alerta ambar">Has cambiado el parte después de firmar: las firmas ya no valen y hay que volver a firmar.</div>` : "";
  const vistas = {datos: pasoDatos, dictado: pasoDictado, trabajo: pasoTrabajo, firmas: pasoFirmas, rapido: pasoRapido};
  app.innerHTML = cabecera + avisoFirmas + `<div id="paso"></div>`;
  await vistas[paso](p, $("#paso"), editable);
  if (!editable) $$("#paso input, #paso textarea, #paso select, #paso .opcion, #paso [data-editar]").forEach((x) => { x.disabled = true; });
  // Campos simples: data-campo="ruta.del.contenido"; listas: data-lista, data-i, data-k.
  $("#paso").addEventListener("input", async (e) => {
    const el = e.target;
    if (!editable || !(el.dataset.campo || el.dataset.lista)) return;
    const valor = leerValor(el), {campo, lista, i, k} = el.dataset;
    await cambiarParte(id, (q) => {
      if (campo) asignar(q.contenido, campo, valor);
      else if (q.contenido[lista]?.[Number(i)]) q.contenido[lista][Number(i)][k] = valor;
    });
  });
}

function opciones(nombre, valores, actual) {
  return `<div class="opciones">${Object.entries(valores).map(([k, v]) => `<button type="button" class="opcion ${actual === k ? "si" : ""}" data-opcion="${nombre}" data-valor="${k}">${esc(v)}</button>`).join("")}</div>`;
}
function enlazarOpciones(p, raiz, alCambiar) {
  $$("[data-opcion]", raiz).forEach((b) => b.addEventListener("click", async () => {
    await cambiarParte(p.id, (q) => {
      const actual = b.dataset.opcion.split(".").reduce((o, k) => o?.[k], q.contenido);
      asignar(q.contenido, b.dataset.opcion, actual === b.dataset.valor ? null : b.dataset.valor);
    }, {inmediato: true});
    alCambiar();
  }));
}

async function pasoDatos(p, raiz, editable) {
  const c = p.contenido;
  raiz.innerHTML = `<div class="tarjeta"><label>Tipo de visita</label>${opciones("tipo_visita", TIPOS_VISITA, c.tipo_visita)}
    ${c.tipo_visita === "PENDIENTE" ? `<label>Pendiente</label>${opciones("pendiente_de", PENDIENTE_DE, c.pendiente_de)}` : ""}
    <div class="fila"><div class="crece"><label for="dFecha">Fecha</label><input id="dFecha" type="date" data-campo="fecha" value="${esc(c.fecha)}"></div></div>
    <div class="fila"><div class="crece"><label for="dIni">Hora de inicio</label><input id="dIni" type="time" data-campo="hora_inicio" value="${esc(c.hora_inicio)}"></div>
      <button type="button" class="boton sec mini" data-ahora="hora_inicio" style="margin-top:28px">Ahora</button></div>
    <div class="fila"><div class="crece"><label for="dFin">Hora de finalización</label><input id="dFin" type="time" data-campo="hora_fin" value="${esc(c.hora_fin)}"></div>
      <button type="button" class="boton sec mini" data-ahora="hora_fin" style="margin-top:28px">Ahora</button></div></div>
    <div class="tarjeta"><label>Cliente</label><input data-campo="cliente.nombre" value="${esc(c.cliente?.nombre)}" ${c.cliente?.stel_id ? "readonly" : ""}>
    <label>Dirección de la intervención</label><input data-campo="direccion.texto" value="${esc(c.direccion?.texto)}">
    <div class="fila"><div class="crece"><label>Persona de contacto</label><input data-campo="contacto.nombre" value="${esc(c.contacto?.nombre)}"></div>
      <div class="crece"><label>Teléfono</label><input data-campo="contacto.telefono" inputmode="tel" value="${esc(c.contacto?.telefono)}"></div></div>
    <label>Instalación o equipo revisado</label><input data-campo="equipo.nombre" value="${esc(c.equipo?.nombre)}">
    <label>N.º de serie</label><input data-campo="equipo.numero_serie" value="${esc(c.equipo?.numero_serie)}">
    <label>Motivo del aviso</label><textarea data-campo="motivo">${esc(c.motivo)}</textarea>
    <label>Prioridad</label>${opciones("prioridad", PRIORIDADES, c.prioridad)}</div>
    <div class="pie-pasos"><a class="boton" href="#/parte/${p.id}/dictado">Siguiente →</a></div>`;
  enlazarOpciones(p, raiz, () => render());
  $$("[data-ahora]", raiz).forEach((b) => b.addEventListener("click", async () => {
    if (!editable) return;
    await cambiarParte(p.id, (q) => { q.contenido[b.dataset.ahora] = ahoraHora(); }, {inmediato: true}); render();
  }));
}

async function pasoDictado(p, raiz, editable) {
  const audios = [];
  for (const d of p.dictados || []) { const a = await archivos.get(d.archivo_id); if (a) audios.push({d, a}); }
  const fotos = [];
  for (const f of p.contenido.fotos || []) { const a = await archivos.get(f.id); fotos.push({f, a}); }
  const url = (blob) => { const u = URL.createObjectURL(blob); S.urls.push(u); return u; };
  raiz.innerHTML = `<div class="tarjeta"><h2>🎙️ Dictado</h2>
    <p class="suave peq">Cuenta lo que ves y lo que haces. Se transcribe tal cual: revisa el texto antes de usarlo. Las cantidades y referencias dudosas quedarán marcadas.</p>
    <button type="button" class="boton ancho ${S.grabacion ? "grabando" : ""}" id="bGrabar" data-editar>${S.grabacion ? "■ Parar y guardar" : "● Grabar audio"}</button>
    <label class="boton sec ancho" style="margin-top:8px">Adjuntar audio del teléfono<input id="iAudio" type="file" accept="audio/*" hidden data-editar></label>
    ${audios.map(({d, a}, i) => `<div class="item" style="margin-top:12px"><div class="fila"><b>Audio ${i + 1}</b><span class="suave peq">${esc(fechaHora(a.creado))}</span>
      ${a.registrado ? `<span class="chip verde">subido</span>` : `<span class="chip ambar">por subir</span>`}</div>
      <audio controls preload="none" src="${url(a.blob)}" style="width:100%"></audio>
      <button type="button" class="boton sec mini" data-transcribir="${esc(a.id)}" data-editar>${d.texto ? "Volver a transcribir" : "Transcribir"}</button>
      <label>Texto (corrígelo si hace falta)</label><textarea data-dictado="${esc(a.id)}">${esc(d.texto || "")}</textarea></div>`).join("")}
    ${audios.length ? `<button type="button" class="boton ancho" id="bProponer" data-editar>Proponer el parte con el dictado</button>` : ""}
    <p class="suave peq">Sin conexión, el audio queda guardado y se transcribe después. También puedes usar el micrófono del teclado en cualquier casilla.</p>
    <div id="propuesta"></div></div>
    <div class="tarjeta"><h2>📷 Fotografías</h2><label>Momento</label>
    <div class="opciones">${Object.entries(MOMENTOS).map(([k, v]) => `<button type="button" class="opcion ${S.momentoFoto === k ? "si" : ""}" data-momento="${k}">${v}</button>`).join("")}</div>
    <div class="fila"><label class="boton crece">Hacer foto<input id="iCamara" type="file" accept="image/*" capture="environment" hidden data-editar></label>
    <label class="boton sec crece">Desde la galería<input id="iGaleria" type="file" accept="image/*" multiple hidden data-editar></label></div>
    <div class="fotos" style="margin-top:12px">${fotos.map(({f, a}, i) => `<div class="foto">${a ? `<img src="${url(a.blob)}" alt="Foto ${i + 1}">` : `<p class="suave">Foto no disponible en este teléfono</p>`}
      <div class="pie"><select data-lista="fotos" data-i="${i}" data-k="momento">${Object.entries(MOMENTOS).map(([k, v]) => `<option value="${k}" ${f.momento === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input data-lista="fotos" data-i="${i}" data-k="comentario" placeholder="Comentario (opcional)" value="${esc(f.comentario)}">
      <div class="fila"><span class="chip ${a?.registrado ? "verde" : "ambar"}">${a?.registrado ? "subida" : "por subir"}</span>
      <button type="button" class="boton mini sec" data-quitar-foto="${i}" data-editar>Quitar</button></div></div></div>`).join("")}</div></div>
    <div class="pie-pasos"><a class="boton sec" href="#/parte/${p.id}/datos">← Atrás</a><a class="boton" href="#/parte/${p.id}/trabajo">Siguiente →</a></div>`;
  if (!editable) return;
  $$("[data-momento]", raiz).forEach((b) => b.onclick = () => { S.momentoFoto = b.dataset.momento; $$("[data-momento]", raiz).forEach((x) => x.classList.toggle("si", x === b)); });
  const anadirFotos = async (files) => {
    for (const file of files) {
      try {
        const blob = await comprimirFoto(file);
        const fid = nuevoId();
        await archivos.put({id: fid, parte_id: p.id, tipo: "FOTO", momento: S.momentoFoto, ruta: `${p.id}/foto-${fid}.jpg`, blob, mime: "image/jpeg",
          sha256: await sha256(blob), creado: new Date().toISOString(), subido: false, registrado: false});
        await cambiarParte(p.id, (q) => { q.contenido.fotos = [...(q.contenido.fotos || []), {id: fid, momento: S.momentoFoto, comentario: ""}]; }, {inmediato: true});
        await Cola.poner("ARCHIVO", "archivo:" + fid, {archivo_id: fid});
      } catch (e) { avisar("No se pudo guardar la foto: " + e.message, {error: true}); }
    }
    render();
  };
  $("#iCamara").onchange = (e) => anadirFotos([...e.target.files]);
  $("#iGaleria").onchange = (e) => anadirFotos([...e.target.files]);
  $$("[data-quitar-foto]", raiz).forEach((b) => b.onclick = async () => {
    if (!(await confirmar("¿Quitar esta foto del parte?", "Quitar"))) return;
    await cambiarParte(p.id, (q) => { q.contenido.fotos.splice(Number(b.dataset.quitarFoto), 1); }, {inmediato: true}); render();
  });
  const guardarAudio = async (blob, nombre) => {
    const aid = nuevoId(), ext = extensionAudio(blob.type || nombre || "");
    await archivos.put({id: aid, parte_id: p.id, tipo: "AUDIO", ruta: `${p.id}/audio-${aid}.${ext}`, blob, mime: blob.type || "audio/webm",
      sha256: await sha256(blob), creado: new Date().toISOString(), subido: false, registrado: false});
    await partes.modificar(p.id, (q) => { q.dictados = [...(q.dictados || []), {archivo_id: aid, texto: ""}]; });
    await Cola.poner("GUARDAR", "guardar:" + p.id, {parte_id: p.id});
    await Cola.poner("ARCHIVO", "archivo:" + aid, {archivo_id: aid});
    render();
    if (navigator.onLine) transcribirAudio(aid);
  };
  $("#bGrabar").onclick = async () => {
    try {
      if (!S.grabacion) { S.grabacion = await grabarAudio(); render(); return; }
      const g = S.grabacion; S.grabacion = null;
      await guardarAudio(await g.parar());
    } catch (e) { S.grabacion = null; avisar(e.message || "No se pudo usar el micrófono.", {error: true}); render(); }
  };
  $("#iAudio").onchange = (e) => { const f = e.target.files[0]; if (f) guardarAudio(f, f.name); };
  $$("[data-transcribir]", raiz).forEach((b) => b.onclick = () => transcribirAudio(b.dataset.transcribir));
  $$("[data-dictado]", raiz).forEach((t) => t.addEventListener("input", () => {
    const texto = t.value;
    partes.modificar(p.id, (q) => { q.dictados = q.dictados.map((d) => d.archivo_id === t.dataset.dictado ? {...d, texto} : d); });
  }));
  $("#bProponer")?.addEventListener("click", async () => {
    const q = await partes.get(p.id);
    const texto = q.dictados.map((d) => d.texto).filter(Boolean).join("\n");
    if (!texto.trim()) return avisar("Primero transcribe el audio o escribe el texto.", {error: true});
    S.propuesta = organizarDictado(texto);
    pintarPropuesta(p.id);
  });
}

async function transcribirAudio(aid, {silencioso = false} = {}) {
  const a = await archivos.get(aid);
  if (!a || S.transcribiendo.has(aid)) return;
  S.transcribiendo.add(aid);
  if (location.hash.includes("/rapido")) render();
  else if (!silencioso) avisar("Transcribiendo…", {ms: 15000});
  try {
    const texto = await transcribir(S.yo.transcripcion_url || "", a.blob, a.ruta.split("/").pop());
    await partes.modificar(a.parte_id, (q) => { q.dictados = q.dictados.map((d) => d.archivo_id === aid ? {...d, texto, error: null} : d); });
    await archivos.put({...(await archivos.get(aid)), transcripcion: texto});
    await Cola.poner("ARCHIVO", "archivo:" + aid + ":texto", {archivo_id: aid});
    if (!silencioso && !location.hash.includes("/rapido")) avisar("Transcrito. Revísalo antes de usarlo.");
  } catch (e) {
    const error = e instanceof SinConexion ? "Sin cobertura: se transcribirá al recuperarla." : e.message;
    await partes.modificar(a.parte_id, (q) => { q.dictados = q.dictados.map((d) => d.archivo_id === aid ? {...d, error} : d); });
    if (!silencioso) avisar("No se pudo transcribir: " + error, {error: true});
  } finally {
    S.transcribiendo.delete(aid);
  }
  if (location.hash.includes("/dictado") || location.hash.includes("/rapido")) render();
}

// ------------------------------------------------------------------ parte rápido (usuario, 2026-11-18)
// Una sola pantalla: grabar lo hecho, fotos del trabajo, foto del albarán de compra (si lo hay), cómo queda, horas y firmar.
// El texto del audio se ordena solo (sin inventar) y los materiales salen del albarán del proveedor y de lo dictado con cantidad.
const HORAS_TRABAJO = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
const HORAS_DESPLAZAMIENTO = [0, 0.5, 1, 1.5, 2];

async function guardarFotoParte(pid, file, momento, comentario = "") {
  // El albarán del proveedor se guarda con más resolución (3200 px, antes 2200) para poder volver a leerlo en la oficina
  // y medir el lector con fotos reales (2026-11-18: con 2200 px la letra pequeña de la tabla no se distinguía bien).
  const lado = momento === "MATERIAL" ? 3200 : 1600;
  const blob = await comprimirFoto(file, lado, momento === "MATERIAL" ? 0.88 : 0.8);
  const fid = nuevoId();
  await archivos.put({id: fid, parte_id: pid, tipo: "FOTO", momento, ruta: `${pid}/${momento === "MATERIAL" ? "albaran-proveedor" : "foto"}-${fid}.jpg`, blob, mime: "image/jpeg",
    sha256: await sha256(blob), creado: new Date().toISOString(), subido: false, registrado: false});
  await cambiarParte(pid, (q) => { q.contenido.fotos = [...(q.contenido.fotos || []), {id: fid, momento, comentario}]; }, {inmediato: true});
  await Cola.poner("ARCHIVO", "archivo:" + fid, {archivo_id: fid});
  return {fid, blob};
}

async function guardarAudioParte(pid, blob, nombre) {
  const aid = nuevoId(), ext = extensionAudio(blob.type || nombre || "");
  await archivos.put({id: aid, parte_id: pid, tipo: "AUDIO", ruta: `${pid}/audio-${aid}.${ext}`, blob, mime: blob.type || "audio/webm",
    sha256: await sha256(blob), creado: new Date().toISOString(), subido: false, registrado: false});
  await partes.modificar(pid, (q) => { q.dictados = [...(q.dictados || []), {archivo_id: aid, texto: ""}]; });
  await Cola.poner("GUARDAR", "guardar:" + pid, {parte_id: pid});
  await Cola.poner("ARCHIVO", "archivo:" + aid, {archivo_id: aid});
  return aid;
}

/** Lee la foto del albarán del proveedor en el teléfono y guarda lo leído en el parte (no en lo firmado hasta «Firmar»). */
async function leerAlbaranRapido(pid, fid, blob) {
  if (S.leyendo.has(fid)) return;
  S.leyendo.add(fid);
  await partes.modificar(pid, (q) => { q.albaranes = {...(q.albaranes || {}), [fid]: {estado: "LEYENDO"}}; });
  if (location.hash.includes("/rapido")) render();
  let res;
  try {
    const {leerFotoAlbaran} = await import("./lib/lector-foto.js");
    const {materialesDesdeAlbaran} = await import("./lib/materiales-albaran.js");
    const r = await leerFotoAlbaran(blob);
    const prop = materialesDesdeAlbaran(r, {articulos: S.catalogo.articulos || [], fotoId: fid});
    res = {estado: "LEIDO", proveedor: [prop.proveedor, prop.numero ? "n.º " + prop.numero : ""].filter(Boolean).join(" · "),
      materiales: prop.materiales.map((m) => ({...m, id: nuevoId()})), avisos: prop.avisos};
  } catch (e) {
    res = {estado: "ERROR", error: e.message};
  } finally {
    S.leyendo.delete(fid);
  }
  await partes.modificar(pid, (q) => { q.albaranes = {...(q.albaranes || {}), [fid]: res}; });
  if (location.hash.includes("/rapido")) render();
}

async function pasoRapido(p, raiz, editable) {
  const c = p.contenido;
  const url = (blob) => { const u = URL.createObjectURL(blob); S.urls.push(u); return u; };
  const audios = [];
  for (const d of p.dictados || []) { const a = await archivos.get(d.archivo_id); if (a) audios.push({d, a}); }
  const fotos = [];
  for (const f of c.fotos || []) fotos.push({f, a: await archivos.get(f.id)});
  const trabajo = fotos.filter(({f}) => f.momento !== "MATERIAL"), albs = fotos.filter(({f}) => f.momento === "MATERIAL");
  const alb = p.albaranes || {};
  const h = (min) => min === null || min === undefined ? null : Math.round(Number(min) / 60 * 100) / 100;
  const chips = (campo, valores, actual, cero) => `<div class="opciones horas">${valores.map((v) => `<button type="button" class="opcion ${actual === v ? "si" : ""}" data-horas="${campo}" data-valor="${v}">${v === 0 ? cero : String(v).replace(".", ",") + " h"}</button>`).join("")}
    <button type="button" class="opcion ${actual !== null && !valores.includes(actual) ? "si" : ""}" data-horas-otra="${campo}">${actual !== null && !valores.includes(actual) ? String(actual).replace(".", ",") + " h" : "Otra…"}</button></div>`;
  const estadoAudio = ({d, a}) => S.transcribiendo.has(a.id) ? `<p class="suave">⏳ Transcribiendo…</p>`
    : d.texto ? `<p class="texto-dictado">${esc(d.texto)}</p><button type="button" class="boton mini sec" data-corregir="${esc(a.id)}" data-editar>Corregir el texto</button>`
    : `<p class="${d.error ? "alerta ambar" : "suave"}">${esc(d.error ? "No transcrito: " + d.error : "Sin transcribir todavía")}</p>
       <button type="button" class="boton mini" data-transcribir="${esc(a.id)}" data-editar>Transcribir</button>`;
  // Precio y descuento leídos del papel (usuario, 2026-11-23: si el lector se equivoca, «lo modifica el técnico o en el STEL»).
  // No van al PDF ni a la firma: solo para que el técnico los compare con el papel y los corrija con «Corregir».
  const eur = (x) => String(Math.round(Number(x) * 10000) / 10000).replace(".", ",");
  // Solo se enseña cuando hace falta mirarlo: precio leído pero sin comprobar (si cuadra, nada que hacer).
  const precioLinea = (m) => {
    const precio = m.precio_papel ?? m.precio_leido, dto = m.dto_leido;
    if (Number(m.precio_neto) > 0 || !(Number(precio) > 0)) return "";
    return `<div class="suave peq">Precio ${esc(eur(precio))} €${Number(dto) > 0 ? ` · dto ${esc(eur(dto))} %` : ""} <span class="chip ambar">mira el precio</span></div>`;
  };
  const estadoAlb = (fid) => {
    const x = alb[fid];
    if (!x || x.estado === "LEYENDO") return `<p class="suave">⏳ Leyendo el albarán… (alrededor de un minuto)</p>`;
    if (x.estado === "ERROR") return `<p class="alerta ambar">No se pudo leer (${esc(x.error)}). La foto va adjunta: la oficina lo verá.</p>`;
    // Entran en el parte las líneas leídas sin dudas y las que el técnico ha comparado con el papel (misma regla que
    // contenidoRapido). Las dudosas se enseñan para comparar: «Coinciden con el papel», «Corregir» o «Quitar».
    if (!x.materiales.length) return `<p class="suave">No se han reconocido líneas: la foto va adjunta y la oficina las pasa.</p>`;
    const entra = (m) => Number(m.cantidad) > 0 && m.descripcion && (!m.dudas.length || m.confirmado);
    const pendientes = x.materiales.filter((m) => !entra(m));
    const linea = (m) => `<li class="${entra(m) ? "" : "dudosa"}"><b>${m.cantidad === null ? "¿cantidad?" : esc(String(m.cantidad).replace(".", ","))} ${esc(m.unidad)}</b> · ${esc(m.descripcion || "¿descripción?")}
      ${m.referencia ? ` <span class="suave">(${esc(m.referencia)})</span>` : ""}${m.confirmado ? ` <span class="chip verde">comprobado</span>` : !m.dudas.length ? "" : ` <span class="chip ambar">comprobar</span>`}
      ${precioLinea(m)}
      <span class="fila" style="margin-top:4px"><button type="button" class="boton mini sec" data-alb-corregir="${esc(fid)}|${esc(m.id)}" data-editar>Corregir</button>
      <button type="button" class="boton mini sec" data-alb-quitar="${esc(fid)}|${esc(m.id)}" data-editar>Quitar</button></span></li>`;
    return `<p class="peq"><b>${esc(x.proveedor || "Albarán leído")}</b></p><ul class="materiales">${x.materiales.map(linea).join("")}</ul>
      ${pendientes.length ? `<p class="alerta ambar peq">${pendientes.length} línea(s) leídas con dudas (en ámbar). Compáralas con el papel: si están bien, pulsa «Coinciden»; si no, «Corregir» o «Quitar». Lo que no confirmes no entra en lo que firma el cliente (la oficina lo pasa con la foto).</p>
        <button type="button" class="boton verde ancho" data-alb-confirmar="${esc(fid)}" data-editar>✓ Coinciden con el papel</button>` : `<p class="peq">✓ Estas líneas entran en el parte.</p>`}`;
  };
  const tTrab = h(c.tiempo_trabajo_min), tDesp = h(c.desplazamiento_min);
  raiz.innerHTML = `<div class="tarjeta"><h2>📍 ${esc(c.cliente?.nombre || "Cliente")}</h2>
      ${c.direccion?.texto && !c.direccion?.editar ? `<div>${esc(c.direccion.texto)}</div>` : `<label>Dirección del trabajo</label><input data-campo="direccion.texto" value="${esc(c.direccion?.texto || "")}" placeholder="Calle, número y localidad">`}</div>
    <div class="tarjeta"><h2>🎙️ Cuenta lo que has hecho</h2>
      <p class="suave peq">Qué le pasaba, qué has hecho, el material que has puesto (con cantidades) y si queda algo pendiente.</p>
      <button type="button" class="boton ancho grande ${S.grabacion ? "grabando" : ""}" id="bGrabar" data-editar>${S.grabacion ? "■ Parar y guardar" : "● Grabar audio"}</button>
      <p class="centro" style="margin:8px 0 0"><label class="suave peq enlace-label">o adjuntar un audio del teléfono<input id="iAudioR" type="file" accept="audio/*" hidden data-editar></label></p>
      ${audios.map((x, i) => `<div class="item" style="margin-top:12px"><div class="fila"><b>Audio ${i + 1}</b><span class="chip ${x.a.registrado ? "verde" : "ambar"}">${x.a.registrado ? "subido" : "por subir"}</span>
        <button type="button" class="boton mini sec" data-quitar-audio="${esc(x.a.id)}" data-editar>Quitar</button></div>
        <audio controls preload="none" src="${url(x.a.blob)}" style="width:100%"></audio>${estadoAudio(x)}</div>`).join("")}
      <details style="margin-top:10px" ${p.escrito ? "open" : ""}><summary>Prefiero escribirlo</summary><textarea id="tEscrito" placeholder="Lo que has hecho…">${esc(p.escrito || "")}</textarea></details></div>
    <div class="tarjeta"><h2>📷 Fotos del trabajo</h2>
      <div class="fila"><label class="boton crece">Hacer foto<input id="iFotoC" type="file" accept="image/*" capture="environment" hidden data-editar></label>
      <label class="boton sec crece">Galería<input id="iFotoG" type="file" accept="image/*" multiple hidden data-editar></label></div>
      <div class="opciones">${["ANTES", "DESPUES"].map((k) => `<button type="button" class="opcion ${S.momentoRapido === k ? "si" : ""}" data-momento-r="${k}">${k === "ANTES" ? "Antes de arreglar" : "Arreglado"}</button>`).join("")}</div>
      <div class="fotos">${trabajo.map(({f, a}) => `<div class="foto">${a ? `<img src="${url(a.blob)}" alt="">` : ""}<div class="pie fila"><span class="chip">${esc(MOMENTOS[f.momento] || "")}</span>
        <button type="button" class="boton mini sec" data-quitar-foto="${esc(f.id)}" data-editar>Quitar</button></div></div>`).join("")}</div></div>
    <div class="tarjeta"><h2>🧾 Albarán o ticket de compra <span class="suave peq">(si lo hay)</span></h2>
      <p class="suave peq">Se adjunta al parte y se leen sus materiales solos.</p>
      <div class="fila"><label class="boton crece">Foto del albarán<input id="iAlbC" type="file" accept="image/*" capture="environment" hidden data-editar></label>
      <label class="boton sec crece">Galería<input id="iAlbG" type="file" accept="image/*" hidden data-editar></label></div>
      ${albs.map(({f, a}) => `<div class="item fila" style="margin-top:10px;align-items:flex-start">${a ? `<img class="mini-foto" src="${url(a.blob)}" alt="">` : ""}
        <div class="crece">${estadoAlb(f.id)}<button type="button" class="boton mini sec" data-quitar-foto="${esc(f.id)}" data-editar>Quitar la foto</button></div></div>`).join("")}</div>
    <div class="tarjeta"><h2>¿Cómo queda?</h2>${opciones("tipo_visita", {REPARACION_FINALIZADA: "✓ Terminado", PENDIENTE: "Queda pendiente", DIAGNOSTICO: "Solo revisión"}, c.tipo_visita)}
      ${c.tipo_visita === "PENDIENTE" ? `<label>Pendiente de</label>${opciones("pendiente_de", {PRESUPUESTO: "Presupuesto", REPUESTOS: "Repuestos", SEGUNDA_VISITA: "Otra visita"}, c.pendiente_de)}` : ""}
      <h3>Horas de trabajo</h3>${chips("tiempo_trabajo_min", HORAS_TRABAJO, tTrab, "")}
      <h3>Horas de desplazamiento</h3>${chips("desplazamiento_min", HORAS_DESPLAZAMIENTO, tDesp, "Sin desplazamiento")}</div>
    <button type="button" class="boton verde ancho grande" id="bAFirmar" data-editar>Firmar ✍️</button>
    ${esOficina() ? `<p class="centro" style="margin-top:14px"><a href="#" class="suave peq" id="bDetallado">Rellenar a mano (modo detallado)</a></p>` : ""}
    ${["BORRADOR", "FIRMADO", undefined, null].includes(p.estadoServidor) ? `<p class="centro" style="margin-top:18px"><a href="#" class="suave peq" id="bDescartar" data-editar>🗑️ Descartar este parte</a></p>` : ""}`;
  if (!editable) return;
  // Transcribir solos los audios pendientes (una vez por sesión; con error, a mano con «Transcribir»).
  if (navigator.onLine) for (const {d, a} of audios) if (!d.texto && !S.transcribiendo.has(a.id) && !S.autoTranscrito.has(a.id)) { S.autoTranscrito.add(a.id); transcribirAudio(a.id, {silencioso: true}); }
  // Lecturas de albarán interrumpidas (se cerró la app): se retoman.
  for (const {f, a} of albs) if (a && (!alb[f.id] || alb[f.id].estado === "LEYENDO") && !S.leyendo.has(f.id)) leerAlbaranRapido(p.id, f.id, a.blob);
  $("#bGrabar").onclick = async () => {
    try {
      if (!S.grabacion) { S.grabacion = await grabarAudio(); render(); return; }
      const g = S.grabacion; S.grabacion = null;
      const aid = await guardarAudioParte(p.id, await g.parar());
      render();
      if (navigator.onLine) { S.autoTranscrito.add(aid); transcribirAudio(aid, {silencioso: true}); }
    } catch (e) { S.grabacion = null; avisar(e.message || "No se pudo usar el micrófono.", {error: true}); render(); }
  };
  $("#iAudioR").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const aid = await guardarAudioParte(p.id, f, f.name);
    render();
    if (navigator.onLine) { S.autoTranscrito.add(aid); transcribirAudio(aid, {silencioso: true}); }
  };
  $$("[data-transcribir]", raiz).forEach((b) => b.onclick = () => transcribirAudio(b.dataset.transcribir));
  $$("[data-corregir]", raiz).forEach((b) => b.onclick = async () => {
    const d = (p.dictados || []).find((x) => x.archivo_id === b.dataset.corregir);
    const texto = await pedirTexto("Corregir el texto", {valor: d?.texto || "", ayuda: "Corrige solo lo que el reconocimiento de voz haya entendido mal."});
    if (texto === null || texto === undefined) return;
    await partes.modificar(p.id, (q) => { q.dictados = q.dictados.map((x) => x.archivo_id === b.dataset.corregir ? {...x, texto} : x); });
    render();
  });
  $$("[data-quitar-audio]", raiz).forEach((b) => b.onclick = async () => {
    if (!(await confirmar("¿Quitar este audio del parte?", "Quitar"))) return;
    await partes.modificar(p.id, (q) => { q.dictados = q.dictados.filter((x) => x.archivo_id !== b.dataset.quitarAudio); });
    render();
  });
  $("#tEscrito").addEventListener("input", (e) => { const v = e.target.value; partes.modificar(p.id, (q) => { q.escrito = v; }); });
  $$("[data-momento-r]", raiz).forEach((b) => b.onclick = () => { S.momentoRapido = b.dataset.momentoR; render(); });
  const fotosTrabajo = async (files) => {
    for (const file of files) { try { await guardarFotoParte(p.id, file, S.momentoRapido); } catch (e) { avisar("No se pudo guardar la foto: " + e.message, {error: true}); } }
    render();
  };
  $("#iFotoC").onchange = (e) => fotosTrabajo([...e.target.files]);
  $("#iFotoG").onchange = (e) => fotosTrabajo([...e.target.files]);
  const fotoAlbaran = async (file) => {
    if (!file) return;
    try {
      const {fid} = await guardarFotoParte(p.id, file, "MATERIAL", "Albarán o ticket del proveedor");
      leerAlbaranRapido(p.id, fid, file); // la original, a resolución completa, para leer mejor
    } catch (e) { avisar("No se pudo guardar la foto: " + e.message, {error: true}); }
    render();
  };
  $("#iAlbC").onchange = (e) => fotoAlbaran(e.target.files[0]);
  $("#iAlbG").onchange = (e) => fotoAlbaran(e.target.files[0]);
  // Líneas del albarán del proveedor: el técnico las compara con el papel.
  const cambiarLineas = async (fid, fn) => { await partes.modificar(p.id, (q) => { const x = q.albaranes?.[fid]; if (x?.materiales) fn(x); }); render(); };
  const conArticulo = (m) => {
    // Referencia comparada por el técnico: se busca su artículo de STEL (solo si hay UNO con esa referencia).
    if (m.stel_item_id || !m.referencia) return m;
    const {articulo} = articuloPorReferencia(m.referencia, S.catalogo.articulos || []);
    return articulo ? {...m, stel_item_id: articulo.stel_id, articulo_stel: articulo.nombre} : m;
  };
  $$("[data-alb-confirmar]", raiz).forEach((b) => b.onclick = async () => {
    const x = (await partes.get(p.id)).albaranes?.[b.dataset.albConfirmar];
    const sinDatos = (x?.materiales || []).filter((m) => !(Number(m.cantidad) > 0) || !m.descripcion);
    if (sinDatos.length) return avisar(`${sinDatos.length} línea(s) sin cantidad o sin descripción: corrígelas o quítalas antes.`, {error: true});
    if (!(await confirmar("¿Has comparado cada línea (cantidad, descripción y referencia) con el papel y están bien?", "Sí, coinciden", "Todavía no"))) return;
    cambiarLineas(b.dataset.albConfirmar, (x2) => { x2.materiales = x2.materiales.map((m) => conArticulo({...m, confirmado: true})); });
  });
  $$("[data-alb-quitar]", raiz).forEach((b) => b.onclick = () => {
    const [fid, mid] = b.dataset.albQuitar.split("|");
    cambiarLineas(fid, (x) => { x.materiales = x.materiales.filter((m) => m.id !== mid); });
  });
  $$("[data-alb-corregir]", raiz).forEach((b) => b.onclick = async () => {
    const [fid, mid] = b.dataset.albCorregir.split("|");
    const m = (await partes.get(p.id)).albaranes?.[fid]?.materiales?.find((x) => x.id === mid);
    if (!m) return;
    const d = await dialogo(`<h2>Corregir la línea</h2><p class="suave">Cópiala tal cual del papel.</p>
      <label>Cantidad</label><input id="cCant" inputmode="decimal" value="${esc(m.cantidad ?? "")}">
      <label>Descripción</label><input id="cDesc" value="${esc(m.descripcion || "")}">
      <label>Referencia</label><input id="cRef" value="${esc(m.referencia || "")}">
      <div class="fila"><div class="crece"><label>Precio por unidad (€)</label><input id="cPrecio" inputmode="decimal" value="${esc(m.precio_papel ?? m.precio_leido ?? "")}"></div>
      <div class="crece"><label>Descuento (%)</label><input id="cDto" inputmode="decimal" placeholder="60+10" value="${esc(m.dto_texto ?? m.dto_leido ?? "")}"></div></div>
      <p class="suave peq">Precio y descuento no salen en lo que firma el cliente: son para la oficina. Varios descuentos: «60+10».</p>`,
    [{texto: "Cancelar", valor: null}, {texto: "Guardar", valor: (x) => ({cantidad: Number(String($("#cCant", x).value).replace(",", ".")), descripcion: $("#cDesc", x).value.trim(), referencia: $("#cRef", x).value.trim(),
      precio: $("#cPrecio", x).value.trim(), dto: $("#cDto", x).value.trim()}),
      validar: (x) => Number(String($("#cCant", x).value).replace(",", ".")) > 0 && $("#cDesc", x).value.trim().length > 1
        && ($("#cPrecio", x).value.trim() === "" || Number($("#cPrecio", x).value.trim().replace(",", ".")) > 0) && descuentoTexto($("#cDto", x).value) !== null}]);
    if (!d) return;
    // Precio y descuento copiados del papel por el técnico: el neto queda comprobado por él.
    const precio = d.precio === "" ? null : Number(d.precio.replace(",", ".")), dto = descuentoTexto(d.dto);
    const precios = precio > 0 ? {precio_papel: precio, precio_neto: Math.round(precio * (1 - dto / 100) * 10000) / 10000, precio_comprobado: "TECNICO",
      dto_leido: dto > 0 ? dto : undefined, dto_texto: d.dto || undefined, precio_neto_estimado: undefined, neto_estimado_como: undefined} : {};
    const {precio: _p, dto: _d, ...campos} = d;
    cambiarLineas(fid, (x) => { x.materiales = x.materiales.map((y) => y.id === mid ? conArticulo({...y, ...campos, ...precios, stel_item_id: campos.referencia === y.referencia ? y.stel_item_id : null, confirmado: true}) : y); });
  });
  $$("[data-quitar-foto]", raiz).forEach((b) => b.onclick = async () => {
    if (!(await confirmar("¿Quitar esta foto del parte?", "Quitar"))) return;
    const fid = b.dataset.quitarFoto;
    await cambiarParte(p.id, (q) => { q.contenido.fotos = q.contenido.fotos.filter((f) => f.id !== fid); if (q.albaranes) delete q.albaranes[fid]; }, {inmediato: true});
    render();
  });
  enlazarOpciones(p, raiz, () => render());
  $$("[data-horas]", raiz).forEach((b) => b.onclick = async () => {
    const min = Math.round(Number(b.dataset.valor) * 60);
    await cambiarParte(p.id, (q) => { q.contenido[b.dataset.horas] = q.contenido[b.dataset.horas] === min ? null : min; }, {inmediato: true});
    render();
  });
  $$("[data-horas-otra]", raiz).forEach((b) => b.onclick = async () => {
    const t = await pedirTexto("¿Cuántas horas?", {multilinea: false, placeholder: "Por ejemplo 2,5", ayuda: "En horas: 0,25 es un cuarto de hora."});
    if (t === null || t === undefined || t === "") return;
    const min = minutosDeHoras(t);
    if (min === null) return avisar("Escribe un número de horas (por ejemplo 2,5).", {error: true});
    await cambiarParte(p.id, (q) => { q.contenido[b.dataset.horasOtra] = min; }, {inmediato: true});
    render();
  });
  // Preparar lo que se firma: el texto ordenado, los materiales y la hora de fin. Si ya está firmado y no ha cambiado nada, no se toca.
  const preparar = async () => {
    const q = await partes.get(p.id);
    if (Object.values(q.albaranes || {}).some((x) => x.estado === "LEYENDO") || S.leyendo.size) { avisar("Espera: todavía se está leyendo el albarán de compra.", {error: true}); return false; }
    if (S.transcribiendo.size) { avisar("Espera a que termine de transcribirse el audio.", {error: true}); return false; }
    const textos = [...(q.dictados || []).map((d) => d.texto), q.escrito];
    if ((q.dictados || []).some((d) => !d.texto) && !q.escrito?.trim()) {
      if (!(await confirmar("Hay audios sin transcribir: su contenido no entrará en el parte. ¿Seguir igualmente?", "Seguir", "Esperar"))) return false;
    }
    const materialesAlbaran = Object.values(q.albaranes || {}).filter((x) => x.estado === "LEIDO").flatMap((x) => x.materiales);
    const propuesto = contenidoRapido(q.contenido, {textos, organizar: organizarDictado, materialesAlbaran, horaFin: q.contenido.hora_fin || ahoraHora(), nuevoId});
    const firmado = ["TECNICO", "CLIENTE"].some((r) => { const f = q.firmas.filter((x) => x.rol === r).at(-1); return f && firmaValida(q, f); });
    const igualSalvoHora = iguales({...propuesto, hora_fin: q.contenido.hora_fin}, q.contenido);
    if (firmado && igualSalvoHora) return true;
    await cambiarParte(p.id, (x) => { x.contenido = contenidoRapido(x.contenido, {textos, organizar: organizarDictado, materialesAlbaran, horaFin: ahoraHora(), nuevoId}); }, {inmediato: true});
    return true;
  };
  $("#bAFirmar").onclick = async () => { if (await preparar()) location.hash = `#/parte/${p.id}/firmas`; };
  // Descartar un parte sin enviar (empezado por error o repetido): se borra en el teléfono y en el servidor.
  $("#bDescartar")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!(await confirmar(`¿Descartar el parte de ${c.cliente?.nombre || "este cliente"}? Se borra con sus fotos, audios y firmas, y no se puede deshacer.`, "Descartar", "No", "peligro"))) return;
    const otros = (await partes.todas()).filter((x) => x.aviso_id === p.aviso_id && x.id !== p.id);
    const locales = (await kv.get("avisosLocales")) || [];
    const avisoSoloLocal = locales.some((a) => a.id === p.aviso_id);
    await Cola.descartarParte(p.id, {avisoId: p.aviso_id, quitarAviso: avisoSoloLocal && !otros.length});
    // Un aviso creado por el técnico que se queda sin partes desaparece de su lista (en el servidor queda anulado).
    const aviso = S.avisos.find((a) => a.id === p.aviso_id);
    if (!otros.length && aviso && aviso.origen === "LLAMADA_TECNICO") {
      S.avisos = S.avisos.filter((a) => a.id !== p.aviso_id);
      await kv.set("avisos", S.avisos);
      await kv.set("avisosLocales", locales.filter((a) => a.id !== p.aviso_id));
    }
    avisar("Parte descartado.");
    location.hash = "#/avisos";
  });
  if ($("#bDetallado")) $("#bDetallado").onclick = async (e) => {
    e.preventDefault();
    if (!(await confirmar("Pasar a rellenar el parte a mano por pasos. Lo grabado y las fotos se mantienen. ¿Seguir?", "Seguir"))) return;
    if (!(await preparar())) return;
    await cambiarParte(p.id, (x) => { delete x.contenido.modo; }, {inmediato: true});
    location.hash = `#/parte/${p.id}/datos`;
  };
}

function pintarPropuesta(parteId) {
  const r = S.propuesta, caja = $("#propuesta");
  if (!r || !caja) return;
  const grupo = (titulo, clave, items, fmt) => items.length ? `<h3>${titulo}</h3><ul class="propuesta">${items.map((x, i) =>
    `<li><label><input type="checkbox" data-prop="${clave}" data-i="${i}" ${clave === "otros" ? "" : "checked"}><span>${fmt(x)}</span></label></li>`).join("")}</ul>` : "";
  caja.innerHTML = `<div class="alerta azul" style="margin-top:12px"><b>Propuesta a partir del dictado.</b> Solo contiene lo que se dijo. Marca lo que quieras añadir al parte.</div>
    ${r.avisos.length ? `<div class="alerta ambar"><b>Para confirmar:</b><ul>${r.avisos.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
    ${grupo("Avería o problema", "averia", r.averia, esc)}
    ${grupo("Comprobaciones", "comprobaciones", r.comprobaciones, (x) => esc(x.texto) + (x.resultado ? ` <span class="chip">${RESULTADOS[x.resultado]}</span>` : ` <span class="chip ambar">resultado por indicar</span>`))}
    ${grupo("Trabajos realizados", "trabajos", r.trabajos, esc)}
    ${grupo("Materiales", "materiales", r.materiales, (m) => `${m.cantidad === null ? "<b>¿cantidad?</b>" : esc(String(m.cantidad).replace(".", ","))} ${esc(m.unidad)} · ${esc(m.descripcion)}${m.referencia ? ` · ref. <b>${esc(m.referencia)}</b>` : ""}${m.dudas.length ? ` <span class="chip ambar">dudoso</span>` : ""}`)}
    ${grupo("Pendientes", "pendientes", r.pendientes, esc)}
    ${grupo("Sin clasificar (se añadirán a Trabajos si los marcas)", "otros", r.otros, esc)}
    <button type="button" class="boton ancho verde" id="bAplicar">Añadir lo marcado al parte</button>`;
  $("#bAplicar").onclick = async () => {
    const marcados = (k) => $$(`[data-prop="${k}"]`).filter((x) => x.checked).map((x) => r[k][Number(x.dataset.i)]);
    const sel = Object.fromEntries(["averia", "comprobaciones", "trabajos", "otros", "materiales", "pendientes"].map((k) => [k, marcados(k)]));
    const unir = (actual, nuevas) => [actual, ...nuevas].filter(Boolean).join("\n");
    await cambiarParte(parteId, (q) => {
      const c = q.contenido;
      c.averia = unir(c.averia, sel.averia);
      c.comprobaciones = [...(c.comprobaciones || []), ...sel.comprobaciones.map((x) => ({texto: x.texto, resultado: x.resultado}))];
      c.trabajos = unir(c.trabajos, [...sel.trabajos, ...sel.otros]);
      c.materiales = [...(c.materiales || []), ...sel.materiales.map((m) => ({id: nuevoId(), descripcion: m.descripcion, referencia: m.referencia || "",
        cantidad: m.cantidad, unidad: m.unidad, stel_item_id: null, dudas: m.dudas, dicho: m.dicho}))];
      c.pendientes = unir(c.pendientes, sel.pendientes);
      if (sel.pendientes.length && !c.tipo_visita) c.tipo_visita = "PENDIENTE";
    }, {inmediato: true});
    S.propuesta = null;
    avisar("Añadido al parte. Revisa el paso 3.");
    location.hash = `#/parte/${parteId}/trabajo`;
  };
}

async function pasoTrabajo(p, raiz, editable) {
  const c = p.contenido;
  const horas = minutosEntre(c.hora_inicio, c.hora_fin);
  const articulos = S.catalogo.articulos || [];
  raiz.innerHTML = `<div class="tarjeta"><h2>Comprobaciones y resultados</h2><div class="lista-items">${(c.comprobaciones || []).map((x, i) => `<div class="item">
      <textarea data-lista="comprobaciones" data-i="${i}" data-k="texto" style="min-height:60px">${esc(x.texto)}</textarea>
      <div class="opciones">${Object.entries(RESULTADOS).map(([k, v]) => `<button type="button" class="opcion ${x.resultado === k ? "si" : ""}" data-resultado="${i}" data-valor="${k}">${v}</button>`).join("")}</div>
      <button type="button" class="boton mini sec" data-quitar="comprobaciones" data-i="${i}" data-editar>Quitar</button></div>`).join("")}</div>
    <button type="button" class="boton sec ancho" data-anadir="comprobaciones" data-editar>＋ Comprobación</button></div>
    <div class="tarjeta"><label>Avería o problema encontrado</label><textarea data-campo="averia">${esc(c.averia)}</textarea>
    <label>Trabajos realizados</label><textarea data-campo="trabajos">${esc(c.trabajos)}</textarea></div>
    <div class="tarjeta"><h2>Materiales y repuestos</h2><div class="lista-items">${(c.materiales || []).map((m, i) => {
      const art = articulos.find((a) => Number(a.stel_id) === Number(m.stel_item_id));
      return `<div class="item"><label>Descripción</label><input data-lista="materiales" data-i="${i}" data-k="descripcion" value="${esc(m.descripcion)}">
      <div class="fila"><div class="crece"><label>Cantidad</label><input class="${m.cantidad === null ? "dudoso" : ""}" data-lista="materiales" data-i="${i}" data-k="cantidad" data-tipo="num" inputmode="decimal" value="${esc(m.cantidad ?? "")}"></div>
      <div class="crece"><label>Unidad</label><select data-lista="materiales" data-i="${i}" data-k="unidad">${UNIDADES.map((u) => `<option ${m.unidad === u ? "selected" : ""}>${u}</option>`).join("")}</select></div></div>
      <label>Referencia</label><input class="${m.dudas?.some((d) => /Referencia/.test(d)) ? "dudoso" : ""}" data-lista="materiales" data-i="${i}" data-k="referencia" value="${esc(m.referencia)}">
      <div class="fila" style="margin-top:6px"><button type="button" class="boton mini sec" data-articulo="${i}" data-editar>${art ? "STEL: " + esc(art.nombre) : "Artículo de STEL…"}</button>
      <button type="button" class="boton mini sec" data-quitar="materiales" data-i="${i}" data-editar>Quitar</button></div>
      ${m.dudas?.length ? `<div class="alerta ambar" style="margin-top:8px">${m.dudas.map(esc).join("<br>")}${m.dicho ? `<br><span class="peq">${m.origen ? "Origen" : "Dicho"}: «${esc(m.dicho)}»</span>` : ""}
        <br><button type="button" class="boton mini" data-confirmar="${i}" data-editar>Lo he comprobado</button></div>` : ""}</div>`;
    }).join("")}</div>
    <div class="fila"><button type="button" class="boton sec crece" data-anadir="material-catalogo" data-editar>＋ Del catálogo</button>
    <button type="button" class="boton sec crece" data-anadir="materiales" data-editar>＋ Escrito a mano</button></div>
    <label class="boton ancho" style="margin-top:10px">📷 Foto del albarán o ticket del proveedor<input id="iAlbaranProv" type="file" accept="image/*" capture="environment" hidden data-editar></label>
    <label class="boton sec ancho" style="margin-top:8px">Albarán del proveedor desde la galería<input id="iAlbaranGal" type="file" accept="image/*" hidden data-editar></label>
    <p class="suave peq">La foto se adjunta al parte y al albarán de trabajo, y se leen sus líneas (referencia, descripción y cantidad) para proponer los materiales. Lo leído con dudas sale en ámbar para compararlo con el papel. Los precios del papel no pasan al parte.</p>
    <div id="propuestaAlbaran"></div></div>
    <div class="tarjeta"><h2>Tiempos (en horas)</h2><div class="fila"><div class="crece"><label>Trabajo (horas)</label><input data-campo="tiempo_trabajo_min" data-tipo="horas" inputmode="decimal" placeholder="p. ej. 1,5" value="${esc(horasTexto(c.tiempo_trabajo_min).replace(" h", ""))}"></div>
      ${horas ? `<button type="button" class="boton mini sec" id="bUsarHoras" style="margin-top:28px" data-editar>Usar ${esc(horasTexto(horas))}</button>` : ""}</div>
    <div class="fila"><div class="crece"><label>Desplazamiento (horas)</label><input data-campo="desplazamiento_min" data-tipo="horas" inputmode="decimal" placeholder="p. ej. 0,5" value="${esc(horasTexto(c.desplazamiento_min).replace(" h", ""))}"></div>
    <div class="crece"><label>Desplazamiento (km)</label><input data-campo="desplazamiento_km" data-tipo="num" inputmode="decimal" value="${esc(c.desplazamiento_km ?? "")}"></div></div></div>
    <div class="tarjeta"><label>Estado final de la instalación</label><textarea data-campo="estado_final">${esc(c.estado_final)}</textarea>
    <label>Trabajos pendientes</label><textarea data-campo="pendientes" placeholder="Qué falta, qué repuesto hay que pedir, si hace falta presupuesto o segunda visita…">${esc(c.pendientes)}</textarea></div>
    <div class="pie-pasos"><a class="boton sec" href="#/parte/${p.id}/dictado">← Atrás</a><a class="boton" href="#/parte/${p.id}/firmas">Revisar y firmar →</a></div>`;
  if (!editable) return;
  const cambiar = async (fn) => { await cambiarParte(p.id, (q) => fn(q.contenido), {inmediato: true}); render(); };
  const leerAlbaran = async (file) => {
    if (!file) return;
    const caja = $("#propuestaAlbaran");
    try {
      // 1. La foto queda adjunta (al parte, a su PDF y al albarán de trabajo de STEL).
      const blob = await comprimirFoto(file, 3200, 0.88);
      const fid = nuevoId();
      await archivos.put({id: fid, parte_id: p.id, tipo: "FOTO", momento: "MATERIAL", ruta: `${p.id}/albaran-proveedor-${fid}.jpg`, blob, mime: "image/jpeg",
        sha256: await sha256(blob), creado: new Date().toISOString(), subido: false, registrado: false});
      await cambiarParte(p.id, (q) => { q.contenido.fotos = [...(q.contenido.fotos || []), {id: fid, momento: "MATERIAL", comentario: "Albarán o ticket del proveedor"}]; }, {inmediato: true});
      await Cola.poner("ARCHIVO", "archivo:" + fid, {archivo_id: fid});
      // 2. Lectura en el propio teléfono con el lector de albaranes (la foto original, a resolución completa).
      caja.innerHTML = `<div class="alerta azul" id="progAlbaran">Leyendo el albarán… puede tardar un minuto.</div>`;
      const {leerFotoAlbaran} = await import("./lib/lector-foto.js");
      const {materialesDesdeAlbaran} = await import("./lib/materiales-albaran.js");
      const r = await leerFotoAlbaran(file, {alProgresar: (t) => { const el = $("#progAlbaran"); if (el) el.textContent = "Leyendo el albarán… " + t; }});
      pintarPropuestaAlbaran(p.id, materialesDesdeAlbaran(r, {articulos, fotoId: fid}));
    } catch (e) {
      caja.innerHTML = `<div class="alerta rojo">No se pudo leer el albarán: ${esc(e.message)}. La foto queda adjunta: escribe los materiales a mano.</div>`;
    }
  };
  $("#iAlbaranProv").onchange = (e) => leerAlbaran(e.target.files[0]);
  $("#iAlbaranGal").onchange = (e) => leerAlbaran(e.target.files[0]);
  $$("[data-resultado]", raiz).forEach((b) => b.onclick = () => cambiar((x) => { const it = x.comprobaciones[Number(b.dataset.resultado)]; it.resultado = it.resultado === b.dataset.valor ? null : b.dataset.valor; }));
  $$("[data-quitar]", raiz).forEach((b) => b.onclick = async () => { if (await confirmar("¿Quitar?", "Quitar")) cambiar((x) => x[b.dataset.quitar].splice(Number(b.dataset.i), 1)); });
  $$("[data-confirmar]", raiz).forEach((b) => b.onclick = () => cambiar((x) => {
    const m = x.materiales[Number(b.dataset.confirmar)];
    if (m.cantidad === null || !(Number(m.cantidad) > 0)) { avisar("Escribe la cantidad primero.", {error: true}); return; }
    m.dudas = []; delete m.dicho;
  }));
  $$("[data-articulo]", raiz).forEach((b) => b.onclick = async () => {
    const a = await elegir("Artículo o servicio de STEL", articulos, {texto: (x) => x.nombre, detalle: (x) => [x.referencia, x.tipo === "SERVICIO" ? "servicio" : ""].filter(Boolean).join(" · ")});
    if (a) cambiar((x) => { const m = x.materiales[Number(b.dataset.articulo)]; m.stel_item_id = a.stel_id; if (!m.descripcion) m.descripcion = a.nombre; });
  });
  $$("[data-anadir]", raiz).forEach((b) => b.onclick = async () => {
    const k = b.dataset.anadir;
    if (k === "comprobaciones") return cambiar((x) => { x.comprobaciones = [...(x.comprobaciones || []), {texto: "", resultado: null}]; });
    if (k === "materiales") return cambiar((x) => { x.materiales = [...(x.materiales || []), {id: nuevoId(), descripcion: "", referencia: "", cantidad: null, unidad: "ud", stel_item_id: null}]; });
    const a = await elegir("Material del catálogo de STEL", articulos.filter((x) => x.tipo === "PRODUCTO"), {texto: (x) => x.nombre, detalle: (x) => x.referencia || ""});
    if (a) cambiar((x) => { x.materiales = [...(x.materiales || []), {id: nuevoId(), descripcion: a.nombre, referencia: a.referencia || "", cantidad: null, unidad: "ud", stel_item_id: a.stel_id}]; });
  });
  $("#bUsarHoras")?.addEventListener("click", () => cambiar((x) => { x.tiempo_trabajo_min = horas; }));
}

function pintarPropuestaAlbaran(parteId, prop) {
  const caja = $("#propuestaAlbaran");
  if (!caja) return;
  const titulo = [prop.proveedor, prop.numero ? "n.º " + prop.numero : "", prop.fecha ? fechaCorta(prop.fecha) : ""].filter(Boolean).join(" · ");
  caja.innerHTML = `<div class="alerta azul" style="margin-top:10px"><b>Albarán leído${titulo ? ": " + esc(titulo) : ""}.</b> Marca los materiales usados en este trabajo.</div>
    ${prop.avisos.length ? `<div class="alerta ambar">${prop.avisos.map(esc).join("<br>")}</div>` : ""}
    <ul class="propuesta">${prop.materiales.map((m, i) => `<li><label><input type="checkbox" data-alb="${i}" checked><span>
      <b class="${m.cantidad === null ? "" : ""}">${m.cantidad === null ? "¿cantidad?" : esc(String(m.cantidad).replace(".", ","))} ${esc(m.unidad)}</b> · ${esc(m.descripcion || "¿descripción?")}
      ${m.referencia ? ` · ref. ${esc(m.referencia)}` : ""}${m.stel_item_id ? ` <span class="chip verde">STEL: ${esc(m.articulo_stel)}</span>` : ""}
      ${m.dudas.length ? `<br><span class="chip ambar">dudoso</span> <span class="peq">${m.dudas.map(esc).join(" · ")}</span>` : ""}</span></label></li>`).join("")}</ul>
    ${prop.materiales.length ? `<button type="button" class="boton ancho verde" id="bAplicarAlbaran">Añadir lo marcado a los materiales</button>` : ""}`;
  $("#bAplicarAlbaran")?.addEventListener("click", async () => {
    const elegidos = $$("[data-alb]").filter((x) => x.checked).map((x) => prop.materiales[Number(x.dataset.alb)]);
    await cambiarParte(parteId, (q) => {
      q.contenido.materiales = [...(q.contenido.materiales || []), ...elegidos.map((m) => ({id: nuevoId(), descripcion: m.descripcion, referencia: m.referencia,
        cantidad: m.cantidad, unidad: m.unidad, stel_item_id: m.stel_item_id, dudas: m.dudas, dicho: m.dicho, origen: m.origen,
        ...camposDePrecio(m)}))];
    }, {inmediato: true});
    avisar(`${elegidos.length} material(es) añadidos desde el albarán del proveedor.`);
    render();
  });
}

function resumenHtml(c) {
  const fila = (t, v) => (v ? `<dt>${t}</dt><dd>${esc(v)}</dd>` : "");
  return `<dl class="resumen">${fila("Cliente", c.cliente?.nombre)}${fila("Dirección", c.direccion?.texto)}${fila("Contacto", [c.contacto?.nombre, c.contacto?.telefono].filter(Boolean).join(" · "))}
    ${fila("Instalación / equipo", [c.equipo?.nombre, c.equipo?.numero_serie].filter(Boolean).join(" · "))}${fila("Motivo", c.motivo)}${fila("Tipo de visita", resumenTipo(c))}
    ${fila("Fecha y horas", `${fechaCorta(c.fecha)} · de ${c.hora_inicio || "?"} a ${c.hora_fin || "?"}`)}
    ${(c.comprobaciones || []).length ? `<dt>Comprobaciones</dt><dd>${c.comprobaciones.map((x) => `• ${esc(x.texto)} — <b>${esc(RESULTADOS[x.resultado] || "sin resultado")}</b>`).join("<br>")}</dd>` : ""}
    ${fila("Avería o problema", c.averia)}${fila("Trabajos realizados", c.trabajos)}
    ${(c.materiales || []).length ? `<dt>Materiales</dt><dd>${c.materiales.map((m) => `• ${esc(String(m.cantidad ?? "?").replace(".", ","))} ${esc(m.unidad)} · ${esc(m.descripcion)}${m.referencia ? " (ref. " + esc(m.referencia) + ")" : ""}${(m.dudas || []).length ? ` <span class="chip ambar">a confirmar por la oficina</span>` : ""}`).join("<br>")}</dd>` : ""}
    ${fila("Horas de trabajo", horasTexto(c.tiempo_trabajo_min))}
    ${fila("Desplazamiento", c.desplazamiento_min === 0 ? "Sin desplazamiento" : [horasTexto(c.desplazamiento_min), c.desplazamiento_km ? c.desplazamiento_km + " km" : ""].filter(Boolean).join(" · "))}
    ${fila("Estado final", c.estado_final)}${fila("Pendiente", c.pendientes)}${fila("Fotografías", (c.fotos || []).length ? `${c.fotos.length}` : "")}</dl>`;
}

async function pasoFirmas(p, raiz, editable) {
  const c = p.contenido;
  const problemas = problemasParaFirmar(c);
  const alcance = S.yo.texto_alcance_firma || "";
  const vigente = (rol) => p.firmas.filter((f) => f.rol === rol).at(-1);
  const ft = vigente("TECNICO"), fc = vigente("CLIENTE");
  const ok = (f) => f && firmaValida(p, f);
  const estadoFirma = (f) => !f ? "" : ok(f) ? `<span class="chip ${f.ausente_motivo ? "ambar" : "verde"}">${f.ausente_motivo ? "Sin firma, motivo registrado" : "Firmado"} ${esc(fechaHora(f.firmado_en))}</span>`
    : `<span class="chip rojo">Hay que volver a ${f.ausente_motivo ? "registrar" : "firmar"}</span>`;
  const enviado = p.estadoLocal === "ENVIADO";
  raiz.innerHTML = `${problemas.length && editable ? `<div class="alerta rojo"><b>Antes de firmar:</b><ul>${problemas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    <div class="tarjeta"><h2>Parte completo</h2>${resumenHtml(c)}</div>
    <div class="tarjeta"><h2>Alcance de la firma</h2><p>${esc(alcance)}</p></div>
    <div class="tarjeta"><div class="fila"><h2 class="crece">Firma del técnico</h2>${estadoFirma(ft)}</div>
      ${ok(ft) || enviado ? `<p>${esc(ft?.nombre || S.yo.nombre)}</p>` : `<canvas class="firma" id="cTecnico"></canvas>
      <div class="fila" style="margin-top:8px"><button type="button" class="boton sec mini" data-limpiar="cTecnico">Borrar</button>
      <button type="button" class="boton crece" id="bFirmaTecnico" ${problemas.length ? "disabled" : ""}>Firmar como técnico</button></div>`}</div>
    <div class="tarjeta"><div class="fila"><h2 class="crece">Responsable del cliente</h2>${estadoFirma(fc)}</div>
      ${ok(fc) || enviado ? `<p>${fc?.ausente_motivo ? `<b>Sin firma:</b> ${esc(fc.ausente_motivo)}` : esc([fc?.nombre, fc?.cargo].filter(Boolean).join(" · "))}</p>` : `
      <div class="fila"><div class="crece"><label for="fcNombre">Nombre</label><input id="fcNombre" value="${esc(c.contacto?.nombre || "")}"></div>
      <div class="crece"><label for="fcCargo">Cargo</label><input id="fcCargo" placeholder="Encargado, propietario…"></div></div>
      <canvas class="firma" id="cCliente" style="margin-top:10px"></canvas>
      <div class="fila" style="margin-top:8px"><button type="button" class="boton sec mini" data-limpiar="cCliente">Borrar</button>
      <button type="button" class="boton crece" id="bFirmaCliente" ${problemas.length ? "disabled" : ""}>Firma del responsable</button></div>
      <button type="button" class="boton sec ancho" id="bAusente" style="margin-top:8px" ${problemas.length ? "disabled" : ""}>No está o no quiere firmar…</button>`}</div>
    <div id="envio"></div>
    <div class="pie-pasos"><a class="boton sec" href="#/parte/${p.id}/${c.modo === "RAPIDO" ? "rapido" : "trabajo"}">← Atrás</a></div>`;
  const envio = $("#envio");
  if (enviado) {
    envio.innerHTML = `<div class="alerta verde"><b>Parte enviado a la oficina.</b> ${p.envio?.subido ? "" : "Si no hay conexión, se sube solo en cuanto la haya."}</div>
      <div class="fila"><button type="button" class="boton crece" id="bVerPdf">Ver PDF</button><button type="button" class="boton sec crece" id="bCompartirPdf">Compartir PDF</button></div>`;
  } else if (ok(ft) && ok(fc)) {
    envio.innerHTML = `<div class="alerta verde"><b>Parte firmado.</b> Genera el PDF y envíalo a la oficina.</div>
      <button type="button" class="boton verde ancho" id="bEnviar">Generar PDF y enviar a administración</button>`;
  }
  const pdfBlob = async () => { const a = p.envio?.pdf_archivo_id ? await archivos.get(p.envio.pdf_archivo_id) : null; return a?.blob; };
  $("#bVerPdf")?.addEventListener("click", async () => { const b = await pdfBlob(); if (b) abrirBlob(b); else avisar("El PDF no está en este teléfono.", {error: true}); });
  $("#bCompartirPdf")?.addEventListener("click", async () => { const b = await pdfBlob(); if (b) compartirBlob(b, `Parte ${p.codigo || p.id.slice(0, 8)}.pdf`, "Parte de trabajo"); });
  if (!editable) return;
  const paneles = {};
  for (const id of ["cTecnico", "cCliente"]) if ($("#" + id)) paneles[id] = new PanelFirma($("#" + id));
  $$("[data-limpiar]", raiz).forEach((b) => b.onclick = () => paneles[b.dataset.limpiar]?.limpiar());
  const registrar = async (rol, {panel, nombre, cargo, ausente_motivo}) => {
    const q = await partes.get(p.id);
    if (problemasParaFirmar(q.contenido).length) return avisar("Completa el parte antes de firmar.", {error: true});
    const fid = nuevoId();
    let imagen_archivo_id = null;
    if (panel) {
      if (panel.vacia()) return avisar("La firma está vacía.", {error: true});
      const png = await panel.aPng();
      imagen_archivo_id = nuevoId();
      await archivos.put({id: imagen_archivo_id, parte_id: p.id, tipo: "FIRMA", ruta: `${p.id}/firma-${rol.toLowerCase()}-${imagen_archivo_id}.png`, blob: png, mime: "image/png",
        sha256: await sha256(png), creado: new Date().toISOString(), subido: false, registrado: false});
    }
    // Lo firmado es el contenido EXACTO de este momento (se lee dentro de la fila de cambios).
    await partes.modificar(p.id, (x) => {
      x.firmas = [...x.firmas, {id: fid, rol, nombre, cargo, ausente_motivo, firmado_en: new Date().toISOString(), texto_alcance: alcance,
        contenido: structuredClone(x.contenido), imagen_archivo_id}];
    });
    await Cola.poner("GUARDAR", "guardar:" + p.id, {parte_id: p.id});
    if (imagen_archivo_id) await Cola.poner("ARCHIVO", "archivo:" + imagen_archivo_id, {archivo_id: imagen_archivo_id});
    await Cola.poner("FIRMA", "firma:" + fid, {parte_id: p.id, firma_id: fid});
    render();
  };
  $("#bFirmaTecnico")?.addEventListener("click", () => registrar("TECNICO", {panel: paneles.cTecnico, nombre: S.yo.nombre}));
  $("#bFirmaCliente")?.addEventListener("click", () => {
    const nombre = $("#fcNombre").value.trim();
    if (!nombre) return avisar("Escribe el nombre del responsable.", {error: true});
    registrar("CLIENTE", {panel: paneles.cCliente, nombre, cargo: $("#fcCargo").value.trim()});
  });
  $("#bAusente")?.addEventListener("click", async () => {
    const motivo = await pedirTexto("Sin firma del responsable", {minimo: 5, ayuda: "Explica por qué no firma (ausente, no quiere firmar, quién atendió…). Se verá en el parte y en la oficina."});
    if (motivo) registrar("CLIENTE", {ausente_motivo: motivo, nombre: $("#fcNombre")?.value.trim() || null});
  });
  $("#bEnviar")?.addEventListener("click", () => enviarParte(p.id));
}

async function enviarParte(id) {
  const b = $("#bEnviar"); if (b) { b.disabled = true; b.textContent = "Generando PDF…"; }
  try {
    const p = await partes.get(id);
    const c = p.contenido;
    const vig = (rol) => p.firmas.filter((f) => f.rol === rol).at(-1);
    const firmas = [];
    for (const f of [vig("TECNICO"), vig("CLIENTE")]) {
      if (!f || !firmaValida(p, f)) throw new Error("Faltan firmas válidas.");
      const img = f.imagen_archivo_id ? await archivos.get(f.imagen_archivo_id) : null;
      firmas.push({...f, png: img ? new Uint8Array(await img.blob.arrayBuffer()) : null});
    }
    const fotos = [];
    for (const f of c.fotos || []) { const a = await archivos.get(f.id); if (a) fotos.push({...f, jpg: new Uint8Array(await a.blob.arrayBuffer())}); }
    let logo = null;
    try { logo = new Uint8Array(await (await fetch("../dafrica-logo.png.png")).arrayBuffer()); } catch { /* sin logo */ }
    const huella = await huellaContenido(c);
    const bytes = await generarPdfParte({codigo: p.codigo || `Ref. ${p.id.slice(0, 8)}`, aviso: p.aviso, contenido: c,
      tecnico: S.yo.nombre, alcance: vig("TECNICO").texto_alcance, huella, firmas, fotos, logo});
    const blob = new Blob([bytes], {type: "application/pdf"});
    const sha = await sha256(blob), aid = nuevoId();
    const ruta = `${p.id}/parte-${aid}.pdf`;
    await archivos.put({id: aid, parte_id: p.id, tipo: "PDF_PARTE", ruta, blob, mime: "application/pdf", sha256: sha, creado: new Date().toISOString(), subido: false, registrado: false});
    await partes.modificar(p.id, (x) => {
      if (!iguales(x.contenido, c)) throw new Error("el parte ha cambiado mientras se generaba el PDF; vuelve a firmar y enviar");
      x.estadoLocal = "ENVIADO";
      x.envio = {pdf_archivo_id: aid, pdf_path: ruta, sha, huella, en: new Date().toISOString()};
    });
    await Cola.poner("GUARDAR", "guardar:" + p.id, {parte_id: p.id});
    await Cola.poner("ARCHIVO", "archivo:" + aid, {archivo_id: aid});
    await Cola.poner("ENVIAR", `enviar:${p.id}:${sha}`, {parte_id: p.id, pdf_path: ruta, sha});
    avisar("Parte firmado y enviado. Puedes enseñar o compartir el PDF.");
    render();
  } catch (e) {
    avisar("No se pudo generar el PDF: " + e.message, {error: true});
    if (b) { b.disabled = false; b.textContent = "Generar PDF y enviar a administración"; }
  }
}

// ------------------------------------------------------------------ bandeja de facturas
async function vistaBandeja() {
  let lista = (await kv.get("bandeja")) || [];
  app.innerHTML = `<h1>Facturas para entregar</h1><p class="suave">Las facturas emitidas de tus partes. Ábrelas, descárgalas o compártelas con el cliente, y marca cuándo las entregas.</p><div id="lista"><p class="cargando">Cargando…</p></div>`;
  try {
    lista = await rpc("sat_mis_facturas");
    await kv.set("bandeja", lista);
    for (const f of lista) if (!(await kv.get("pdf:" + f.id))) { try { await kv.set("pdf:" + f.id, await descargar(f.pdf_path)); } catch { /* después */ } }
  } catch (e) { if (!(e instanceof SinConexion)) avisar(e.message, {error: true}); }
  const pdfs = new Map();
  for (const f of lista) pdfs.set(f.id, await kv.get("pdf:" + f.id));
  $("#lista").innerHTML = lista.length ? lista.map((f) => `<div class="tarjeta"><div class="fila"><b class="crece">${esc(f.referencia || "Factura")}</b>
      ${f.entrega_estado === "ENTREGADA" ? `<span class="chip verde">Entregada</span>` : `<span class="chip ambar">Pendiente de entregar</span>`}</div>
      <div>${esc(f.cliente || "")}</div><div class="suave">Parte ${esc(f.parte_codigo)} · ${esc(fechaHora(f.emitida_en))}</div>
      ${f.entrega_estado === "ENTREGADA" ? `<div class="suave">Entregada ${esc(fechaHora(f.entregada_en))}${f.entrega_medio ? " · " + esc(f.entrega_medio) : ""}</div>` : ""}
      <div class="fila" style="margin-top:10px">${pdfs.get(f.id) ? `<button type="button" class="boton mini" data-abrir="${f.id}">Abrir</button>
        <button type="button" class="boton mini sec" data-bajar="${f.id}">Descargar</button><button type="button" class="boton mini sec" data-compartir="${f.id}">Compartir</button>`
        : `<span class="suave">PDF no descargado (sin conexión)</span>`}</div>
      <div style="margin-top:10px">${f.entrega_estado === "ENTREGADA" ? `<button type="button" class="boton mini sec" data-entregar="${f.id}" data-valor="0">Deshacer «entregada»</button>`
        : `<button type="button" class="boton verde ancho" data-entregar="${f.id}" data-valor="1">Marcar como entregada al cliente</button>`}</div></div>`).join("")
    : `<p class="suave">No hay facturas en tu bandeja.</p>`;
  const nombre = (f) => `Factura ${f.referencia || f.parte_codigo}.pdf`;
  const porId = (id) => lista.find((f) => f.id === id);
  $$("[data-abrir]").forEach((b) => b.onclick = () => abrirBlob(pdfs.get(b.dataset.abrir)));
  $$("[data-bajar]").forEach((b) => b.onclick = () => descargarBlob(pdfs.get(b.dataset.bajar), nombre(porId(b.dataset.bajar))));
  $$("[data-compartir]").forEach((b) => b.onclick = () => compartirBlob(pdfs.get(b.dataset.compartir), nombre(porId(b.dataset.compartir)), "Factura"));
  $$("[data-entregar]").forEach((b) => b.onclick = async () => {
    const si = b.dataset.valor === "1";
    let medio = null;
    if (si) {
      medio = await dialogo(`<h2>¿Cómo se ha entregado al cliente?</h2><p class="suave">Solo se marca como entregada cuando tú lo confirmas.</p>`,
        [{texto: "Cancelar", valor: null}, ...["En mano", "Correo electrónico", "WhatsApp", "Otro"].map((m) => ({texto: m, valor: m, clase: "sec"}))]);
      if (!medio) return;
    }
    try { await rpc("sat_factura_entrega", {p_factura: b.dataset.entregar, p_entregada: si, p_medio: medio}); avisar(si ? "Marcada como entregada." : "Marcada como pendiente."); }
    catch (e) { avisar(e instanceof SinConexion ? "Necesitas conexión para marcar la entrega." : e.message, {error: true}); }
    render();
  });
}

async function vistaNotificaciones() {
  app.innerHTML = `<h1>Notificaciones</h1><div id="lista"><p class="cargando">Cargando…</p></div>`;
  const lista = await rpc("sat_notificaciones", {p_todas: true});
  $("#lista").innerHTML = lista.length ? lista.map((n) => `<div class="tarjeta" style="${n.leida ? "opacity:.7" : ""}"><div class="suave peq">${esc(fechaHora(n.creado_en))}</div>
    <div>${esc(n.texto)}</div>${n.parte_id ? `<a href="#" data-ir="${esc(n.parte_id)}" data-tipo="${esc(n.tipo)}">Abrir</a>` : ""}</div>`).join("") : `<p class="suave">Sin notificaciones.</p>`;
  const noLeidas = lista.filter((n) => !n.leida).map((n) => n.id);
  if (noLeidas.length) { await rpc("sat_notificaciones_leidas", {p_ids: noLeidas}); $("#numNotis").hidden = true; }
  $$("[data-ir]").forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    const id = a.dataset.ir, tipo = a.dataset.tipo;
    if (tipo === "FACTURA_DISPONIBLE") location.hash = "#/bandeja";
    else if (await partes.get(id) && !["PARTE_RECIBIDO", "FACTURA_POR_APROBAR", "STEL_ERROR", "STEL_BLOQUEADA", "FACTURA_SIN_PDF"].includes(tipo)) {
      await refrescar({silencioso: true}); location.hash = `#/parte/${id}/firmas`;
    } else location.hash = `#/admin/parte/${id}`;
  });
}

function vistaCuenta() {
  app.innerHTML = `<h1>Cuenta</h1><div class="tarjeta"><p><b>${esc(S.yo.nombre)}</b><br><span class="suave">${esc(S.yo.email || "")}</span></p>
    <p class="suave">Permisos: ${esc(S.yo.permisos.join(", "))}</p><p class="suave">DAFRICA SAT ${esc(CONFIG.version)}${CONFIG.local ? " · ENTORNO DE PRUEBAS" : ""}</p></div>
    <button type="button" class="boton sec ancho" id="bRefrescar">Actualizar datos</button><div style="height:10px"></div>
    <button type="button" class="boton peligro ancho" id="bSalir">Cerrar sesión</button>`;
  $("#bRefrescar").onclick = async () => { if (await refrescar()) avisar("Datos actualizados."); };
  $("#bSalir").onclick = async () => {
    const pend = (await import("./lib/almacen.js")).cola;
    const n = (await pend.todas()).length;
    if (n && !(await confirmar(`Quedan ${n} elementos sin subir. Si cierras sesión se subirán cuando vuelvas a entrar en este teléfono. ¿Cerrar sesión?`, "Cerrar sesión"))) return;
    salir(); location.reload();
  };
}

iniciar();
