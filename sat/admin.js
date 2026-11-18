// DAFRICA SAT · oficina: partes recibidos, revisión económica, decisión, aprobación de factura, avisos, STEL y ajustes.
// Necesita conexión (no guarda nada en el teléfono).
import {rpc, funcion, urlFirmada, subirArchivo, SinConexion} from "./lib/api.js";
import {sha256} from "./lib/almacen.js";
import {nuevoId, resumenTipo, RESULTADOS, MOMENTOS, PRIORIDADES} from "./lib/contenido.js";
import {proponerLineas, totales, totalLinea, euros, lineasIncompletas} from "./lib/economia.js";
import {esc, $, $$, avisar, dialogo, confirmar, pedirTexto, elegir, fechaHora, fechaCorta, chipEstado} from "./lib/ui.js";

let ctx;
const puede = (p) => Boolean(ctx.S.yo?.permisos?.includes(p));
const TIPOS_LINEA = {MATERIAL: "Material", MANO_OBRA: "Mano de obra", DESPLAZAMIENTO: "Desplazamiento", OTRO: "Otro"};
const ESTADO_OP = {PENDIENTE: "ambar", EN_CURSO: "ambar", OK: "verde", ERROR: "rojo", BLOQUEADA: "rojo"};

export async function vistaAdmin(app, a, b, contexto) {
  ctx = contexto;
  if (!(puede("sat.administrar") || puede("sat.facturar"))) { app.innerHTML = `<div class="alerta rojo">Necesitas permiso de administración.</div>`; return; }
  const pestanas = [["", "Partes"], ["avisos", "Avisos"], ["stel", "STEL"], ["ajustes", "Ajustes"]];
  const cab = `<nav class="pasos">${pestanas.map(([k, t]) => `<a href="#/admin${k ? "/" + k : ""}" class="${(a || "") === k || (a === "parte" && !k) ? "activo" : ""}">${t}</a>`).join("")}</nav>`;
  app.innerHTML = cab + `<div id="admin"><p class="cargando">Cargando…</p></div>`;
  const raiz = $("#admin");
  if (!a) return listaPartes(raiz);
  if (a === "parte") return detalle(raiz, b);
  if (a === "avisos") return avisos(raiz);
  if (a === "stel") return stel(raiz);
  if (a === "ajustes") return ajustes(raiz);
}

// ------------------------------------------------------------------ partes
const FILTROS = {revisar: ["ENVIADO", "EN_REVISION"], aprobar: ["PENDIENTE_APROBACION"], facturados: ["APROBADO", "FACTURADO"],
  otros: ["INFO_SOLICITADA", "PRESUPUESTAR", "NO_FACTURABLE"], curso: ["BORRADOR", "FIRMADO"]};
async function listaPartes(raiz) {
  const lista = await rpc("sat_partes_listar", {p_estado: null});
  const filtro = sessionStorage.getItem("satFiltro") || (puede("sat.facturar") && !puede("sat.tecnico") ? "aprobar" : "revisar");
  const n = (k) => lista.filter((p) => FILTROS[k].includes(p.estado)).length;
  const nombres = {revisar: "Por revisar", aprobar: "Factura por aprobar", facturados: "Facturados", otros: "Info / presupuesto / no fact.", curso: "En curso (técnico)"};
  const vis = lista.filter((p) => FILTROS[filtro].includes(p.estado));
  raiz.innerHTML = `<div class="opciones">${Object.keys(FILTROS).map((k) => `<button type="button" class="opcion ${k === filtro ? "si" : ""}" data-filtro="${k}">${nombres[k]} (${n(k)})</button>`).join("")}</div>
    ${vis.length ? vis.map((p) => `<a class="tarjeta enlace" href="#/admin/parte/${esc(p.id)}"><div class="fila"><b>${esc(p.codigo)}</b>${chipEstado(p.estado)}
      ${p.stel_estado === "BLOQUEADO" || p.stel_estado === "ERROR" ? `<span class="chip rojo">STEL: ${esc(p.stel_estado.toLowerCase())}</span>` : p.stel_estado === "SINCRONIZADO" ? `<span class="chip verde">STEL ${esc(p.stel_albaran_ref || "")}</span>` : ""}
      ${p.entrega_estado === "PENDIENTE_ENTREGA" ? `<span class="chip ambar">sin entregar</span>` : p.entrega_estado === "ENTREGADA" ? `<span class="chip verde">entregada</span>` : ""}</div>
      <div><b>${esc(p.cliente || "")}</b> · ${esc(p.motivo || "")}</div>
      <div class="suave">${esc(p.tecnico_nombre || "")} · ${esc(fechaCorta(p.fecha))} · ${esc(resumenTipo({tipo_visita: p.tipo_visita}))}</div></a>`).join("")
    : `<p class="suave">No hay partes en este grupo.</p>`}`;
  $$("[data-filtro]", raiz).forEach((x) => x.onclick = () => { sessionStorage.setItem("satFiltro", x.dataset.filtro); listaPartes(raiz); });
}

async function detalle(raiz, id) {
  const [d, precios, aj] = await Promise.all([rpc("sat_parte_detalle", {p_id: id}),
    puede("sat.administrar") ? rpc("sat_articulos_precios") : [], puede("sat.administrar") ? rpc("sat_ajustes_leer") : {}]);
  const c = d.contenido;
  const firmar = async (ruta) => { try { return await urlFirmada(ruta, 1800); } catch { return ""; } };
  const archivos = d.archivos || [];
  const url = new Map();
  await Promise.all(archivos.map(async (a) => url.set(a.storage_path, await firmar(a.storage_path))));
  if (d.factura?.pdf_path && !url.has(d.factura.pdf_path)) url.set(d.factura.pdf_path, await firmar(d.factura.pdf_path));
  const fotos = (c.fotos || []).map((f) => ({...f, a: archivos.find((x) => x.id === f.id)}));
  const audios = archivos.filter((a) => a.tipo === "AUDIO");
  const pdfParte = d.pdf_path ? url.get(d.pdf_path) : "";
  const editableEco = ["ENVIADO", "EN_REVISION", "PRESUPUESTAR", "PENDIENTE_APROBACION"].includes(d.estado) && puede("sat.administrar");
  let lineas = structuredClone(d.revision || proponerLineas(c, precios, aj));
  const clienteCat = ctx.S.catalogo.clientes.find((x) => x.id === c.cliente?.id);

  raiz.innerHTML = `<div class="fila"><a class="boton mini sec" href="#/admin">←</a><h1 class="crece" style="margin:0">${esc(d.codigo)}</h1>${chipEstado(d.estado)}</div>
    <p class="suave">${esc(d.aviso?.codigo || "")} · ${esc(d.tecnico_nombre || "")} · versión ${esc(d.version)}${d.enviado_en ? " · enviado " + esc(fechaHora(d.enviado_en)) : ""}</p>
    ${pdfParte ? `<a class="boton sec ancho" href="${esc(pdfParte)}" target="_blank" rel="noopener">📄 PDF del parte firmado (v${esc(d.pdf_version)})</a>` : ""}
    ${d.decision_nota ? `<div class="alerta azul" style="margin-top:10px"><b>Nota de la decisión:</b> ${esc(d.decision_nota)}</div>` : ""}
    ${clienteCat?.provisional ? `<div class="alerta ambar" style="margin-top:10px"><b>Cliente provisional</b> (creado por el técnico): «${esc(clienteCat.nombre)}»${clienteCat.nif ? " · " + esc(clienteCat.nif) : ""}.
      Vincúlalo a un cliente de STEL para no duplicarlo, o créalo en STEL.<div class="fila" style="margin-top:8px">
      <button type="button" class="boton mini" id="bVincular">Vincular a cliente de STEL</button><button type="button" class="boton mini sec" id="bCrearCli">Crear en STEL</button></div></div>` : ""}
    <div class="tarjeta" style="margin-top:12px"><h2>Intervención</h2><dl class="resumen">
      ${[["Cliente", c.cliente?.nombre], ["Dirección", c.direccion?.texto], ["Contacto", [c.contacto?.nombre, c.contacto?.telefono].filter(Boolean).join(" · ")],
        ["Instalación / equipo", [c.equipo?.nombre, c.equipo?.numero_serie].filter(Boolean).join(" · ")], ["Motivo", c.motivo], ["Prioridad", PRIORIDADES[c.prioridad]],
        ["Tipo de visita", resumenTipo(c)], ["Fecha y horas", `${fechaCorta(c.fecha)} · ${c.hora_inicio || "?"}–${c.hora_fin || "?"}`],
        ["Tiempo de trabajo", c.tiempo_trabajo_min ? c.tiempo_trabajo_min + " min" : ""], ["Desplazamiento", [c.desplazamiento_min ? c.desplazamiento_min + " min" : "", c.desplazamiento_km ? c.desplazamiento_km + " km" : ""].filter(Boolean).join(" · ")],
        ["Avería", c.averia], ["Trabajos", c.trabajos], ["Estado final", c.estado_final], ["Pendiente", c.pendientes]]
        .filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}
      ${(c.comprobaciones || []).length ? `<dt>Comprobaciones</dt><dd>${c.comprobaciones.map((x) => `• ${esc(x.texto)} — <b>${esc(RESULTADOS[x.resultado] || "?")}</b>`).join("<br>")}</dd>` : ""}
      ${(c.materiales || []).length ? `<dt>Materiales (del técnico)</dt><dd>${c.materiales.map((m) => `• ${esc(String(m.cantidad).replace(".", ","))} ${esc(m.unidad)} · ${esc(m.descripcion)}${m.referencia ? " · ref. " + esc(m.referencia) : ""}${m.stel_item_id ? "" : ` <span class="chip ambar">sin artículo STEL</span>`}`).join("<br>")}</dd>` : ""}
    </dl></div>
    ${fotos.length ? `<div class="tarjeta"><h2>Fotografías</h2><div class="fotos">${fotos.map((f) => `<div class="foto">${f.a && url.get(f.a.storage_path)
      ? `<a href="${esc(url.get(f.a.storage_path))}" target="_blank" rel="noopener"><img src="${esc(url.get(f.a.storage_path))}" alt=""></a>` : `<p class="suave">No subida todavía</p>`}
      <div class="pie peq"><b>${esc(MOMENTOS[f.momento] || "")}</b> ${esc(f.comentario || "")}</div></div>`).join("")}</div></div>` : ""}
    ${audios.length ? `<div class="tarjeta"><h2>Audios y transcripción</h2>${audios.map((a) => `<div class="item"><audio controls preload="none" src="${esc(url.get(a.storage_path))}" style="width:100%"></audio>
      ${a.transcripcion ? `<p class="peq">${esc(a.transcripcion)}</p>` : `<p class="suave peq">Sin transcripción.</p>`}</div>`).join("")}</div>` : ""}
    <div class="tarjeta"><h2>Firmas</h2>${(d.firmas || []).map((f) => `<div class="item" style="${f.valida ? "" : "opacity:.6"}"><div class="fila"><b>${f.rol === "TECNICO" ? "Técnico" : "Responsable"}</b>
      ${f.valida ? `<span class="chip verde">válida (v${esc(f.parte_version)})</span>` : `<span class="chip gris">no válida</span>`}<span class="suave peq">${esc(fechaHora(f.firmado_en))}</span></div>
      ${f.imagen_path && url.get(f.imagen_path) ? `<img src="${esc(url.get(f.imagen_path))}" alt="Firma" style="max-width:260px;background:#fff;border-radius:8px">` : ""}
      <div>${f.ausente_motivo ? `<b>Sin firma:</b> ${esc(f.ausente_motivo)}` : esc([f.nombre, f.cargo].filter(Boolean).join(" · "))}</div>
      ${f.invalidada_motivo ? `<div class="suave peq">${esc(f.invalidada_motivo)}</div>` : ""}</div>`).join("") || `<p class="suave">Sin firmas.</p>`}</div>
    ${(d.versiones || []).length ? `<div class="tarjeta"><h2>Versiones y correcciones</h2>${d.versiones.map((v) => `<div class="item"><b>v${esc(v.version)}</b> · ${esc(v.motivo)} <span class="suave peq">${esc(fechaHora(v.guardado_en))} · ${esc(v.guardado_por || "")}</span></div>`).join("")}</div>` : ""}
    <div class="tarjeta"><h2>STEL</h2><p>Albarán de trabajo: ${d.stel_albaran_ref ? `<b>${esc(d.stel_albaran_ref)}</b>` : "—"} · <span class="chip ${d.stel_estado === "SINCRONIZADO" ? "verde" : ["ERROR", "BLOQUEADO"].includes(d.stel_estado) ? "rojo" : "ambar"}">${esc(d.stel_estado)}</span></p>
      ${(d.operaciones || []).map((o) => `<div class="item"><div class="fila"><b>${esc({INCIDENCIA: "Incidencia", ALBARAN_TRABAJO: "Albarán de trabajo + PDF y fotos", FACTURA: "Factura", CLIENTE: "Cliente"}[o.tipo])}</b>
        <span class="chip ${ESTADO_OP[o.estado]}">${esc(o.estado)}</span>${o.stel_id ? `<span class="suave peq">id ${esc(o.stel_id)}</span>` : ""}
        ${puede("sat.administrar") && o.estado !== "EN_CURSO" ? `<button type="button" class="boton mini sec" data-reintentar="${esc(o.id)}">Reintentar</button>` : ""}</div>
        ${o.error ? `<div class="peq" style="color:var(--rojo)">${esc(o.error)}</div>` : ""}</div>`).join("")}
      ${d.operaciones?.length ? `<button type="button" class="boton sec ancho" id="bProcesar" style="margin-top:8px">Sincronizar ahora con STEL</button>` : `<p class="suave">Se sincroniza al enviarse el parte.</p>`}</div>
    <div class="tarjeta"><h2>Revisión económica</h2><p class="suave peq">Precios del catálogo de STEL; nada se inventa: lo que falta queda en blanco. La firma del cliente no incluye importes.</p>
      <div id="eco"></div></div>
    <div id="decision"></div><div id="factura"></div>
    <div class="tarjeta"><h2>Registro</h2>${(d.auditoria || []).map((x) => `<div class="peq">${esc(fechaHora(x.creado_en))} · <b>${esc(x.accion)}</b> · ${esc(x.usuario || "sistema")}</div>`).join("")}</div>`;

  // Cliente provisional
  $("#bVincular")?.addEventListener("click", async () => {
    const x = await elegir("Cliente de STEL", ctx.S.catalogo.clientes.filter((k) => k.stel_id), {texto: (k) => k.nombre, detalle: (k) => [k.nif, k.telefono].filter(Boolean).join(" · ")});
    if (!x) return;
    try { await rpc("sat_cliente_resolver", {p_cliente: clienteCat.id, p_stel_id: x.stel_id, p_crear_en_stel: false}); await ctx.refrescar({silencioso: true}); avisar("Cliente vinculado."); ctx.render(); }
    catch (e) { avisar(e.message, {error: true}); }
  });
  $("#bCrearCli")?.addEventListener("click", async () => {
    if (!(await confirmar(`¿Crear «${clienteCat.nombre}» como cliente en STEL? Antes se busca por NIF y nombre para no duplicarlo.`, "Crear en STEL"))) return;
    try { await rpc("sat_cliente_resolver", {p_cliente: clienteCat.id, p_stel_id: null, p_crear_en_stel: true}); await funcion("sat-stel", {accion: "procesar"});
      await ctx.refrescar({silencioso: true}); ctx.render(); } catch (e) { avisar(e.message, {error: true}); }
  });
  // STEL
  $$("[data-reintentar]", raiz).forEach((b) => b.onclick = async () => {
    try { await rpc("sat_stel_reintentar", {p_op: b.dataset.reintentar}); await procesar(id); } catch (e) { avisar(e.message, {error: true}); }
  });
  $("#bProcesar")?.addEventListener("click", () => procesar(id));

  // Revisión económica
  const eco = $("#eco");
  const pintarEco = () => {
    const t = totales(lineas);
    eco.innerHTML = `<div class="desliza"><table class="tabla lineas-eco"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto %</th><th class="num">IVA %</th><th class="num">Importe</th><th></th></tr></thead><tbody>
      ${lineas.map((l, i) => `<tr><td style="min-width:220px"><select data-l="${i}" data-k="tipo">${Object.entries(TIPOS_LINEA).map(([k, v]) => `<option value="${k}" ${l.tipo === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="eleccion" data-art="${i}" style="margin:4px 0">${l.stel_item_id ? esc((precios.find((p) => Number(p.stel_id) === Number(l.stel_item_id)) || {}).nombre || "Artículo " + l.stel_item_id) : "<b>Elegir artículo de STEL…</b>"}</button>
        <input data-l="${i}" data-k="descripcion" value="${esc(l.descripcion)}" placeholder="Descripción"></td>
        <td><input data-l="${i}" data-k="cantidad" inputmode="decimal" value="${esc(l.cantidad ?? "")}" style="width:72px"></td>
        <td><input data-l="${i}" data-k="precio" inputmode="decimal" value="${esc(l.precio ?? "")}" style="width:90px" class="${l.precio === null || l.precio === "" ? "dudoso" : ""}"></td>
        <td><input data-l="${i}" data-k="descuento_pct" inputmode="decimal" value="${esc(l.descuento_pct ?? 0)}" style="width:64px"></td>
        <td><input data-l="${i}" data-k="iva_pct" inputmode="decimal" value="${esc(l.iva_pct ?? "")}" style="width:64px"></td>
        <td class="num">${euros(totalLinea(l))}</td><td><button type="button" class="boton mini sec" data-quitar="${i}">✕</button></td></tr>`).join("")}
      </tbody></table></div>
      <p class="num" style="text-align:right">Base ${euros(t.base)} · IVA ${euros(t.iva)} · <b>Total ${euros(t.total)}</b></p>
      ${lineasIncompletas(lineas).length ? `<div class="alerta ambar">${lineasIncompletas(lineas).length} línea(s) sin artículo de STEL, cantidad, precio o IVA.</div>` : ""}
      ${editableEco ? `<div class="fila"><button type="button" class="boton sec mini" id="bLinea">＋ Línea</button><button type="button" class="boton sec mini" id="bProponer">Proponer desde el parte</button>
        <button type="button" class="boton crece" id="bGuardarEco">Guardar revisión</button></div>` : ""}`;
    if (!editableEco) { $$("input, select, .eleccion, [data-quitar]", eco).forEach((x) => { x.disabled = true; }); return; }
    $$("[data-l]", eco).forEach((el) => el.addEventListener("change", () => {
      const l = lineas[Number(el.dataset.l)], k = el.dataset.k;
      l[k] = ["cantidad", "precio", "descuento_pct", "iva_pct"].includes(k) ? (el.value.trim() === "" ? null : Number(el.value.replace(",", "."))) : el.value;
      pintarEco();
    }));
    $$("[data-art]", eco).forEach((b) => b.onclick = async () => {
      const a = await elegir("Artículo o servicio de STEL", precios, {texto: (x) => x.nombre, detalle: (x) => [x.referencia, x.precio !== null ? euros(x.precio) : "sin precio", x.tipo === "SERVICIO" ? "servicio" : ""].filter(Boolean).join(" · ")});
      if (!a) return;
      const l = lineas[Number(b.dataset.art)];
      l.stel_item_id = a.stel_id; if (!l.descripcion) l.descripcion = a.nombre;
      if (l.precio === null || l.precio === "") l.precio = a.precio; if (l.iva_pct === null || l.iva_pct === "") l.iva_pct = a.iva_pct;
      pintarEco();
    });
    $$("[data-quitar]", eco).forEach((b) => b.onclick = () => { lineas.splice(Number(b.dataset.quitar), 1); pintarEco(); });
    $("#bLinea").onclick = () => { lineas.push({tipo: "OTRO", stel_item_id: null, descripcion: "", cantidad: 1, precio: null, descuento_pct: 0, iva_pct: 21}); pintarEco(); };
    $("#bProponer").onclick = async () => { if (await confirmar("¿Sustituir las líneas por las propuestas desde el parte?", "Sustituir")) { lineas = proponerLineas(c, precios, aj); pintarEco(); } };
    $("#bGuardarEco").onclick = async () => {
      try { await rpc("sat_revision_guardar", {p_id: id, p_lineas: lineas, p_nota: null}); avisar("Revisión guardada."); ctx.render(); }
      catch (e) { avisar(e.message, {error: true}); }
    };
  };
  pintarEco();

  // Decisión
  if (puede("sat.administrar") && ["ENVIADO", "EN_REVISION", "PRESUPUESTAR"].includes(d.estado)) {
    $("#decision").innerHTML = `<div class="tarjeta"><h2>Decisión</h2>${d.estado === "ENVIADO" ? `<p class="suave">Guarda primero la revisión económica.</p>` : ""}
      <div class="opciones"><button type="button" class="opcion" data-decidir="FACTURAR" ${d.revision ? "" : "disabled"}>Facturar → aprobación</button>
      <button type="button" class="opcion" data-decidir="PRESUPUESTAR">Presupuestar</button><button type="button" class="opcion" data-decidir="INFO">Pedir información al técnico</button>
      <button type="button" class="opcion" data-decidir="NO_FACTURABLE">No facturable</button></div></div>`;
    $$("[data-decidir]").forEach((b) => b.onclick = async () => {
      const dec = b.dataset.decidir;
      let nota = null;
      if (dec === "INFO" || dec === "NO_FACTURABLE") { nota = await pedirTexto(dec === "INFO" ? "¿Qué información falta?" : "Motivo (garantía, contrato…)", {minimo: 3}); if (!nota) return; }
      else if (dec === "PRESUPUESTAR") nota = await pedirTexto("Nota para el presupuesto (opcional)") ?? null;
      else if (!(await confirmar(`¿Pasar a aprobación una factura de ${euros(Number(d.total_revision))}?`, "Pasar a aprobación"))) return;
      try { await rpc("sat_decidir", {p_id: id, p_decision: dec, p_nota: nota || null}); avisar("Hecho."); ctx.render(); } catch (e) { avisar(e.message, {error: true}); }
    });
  }

  // Aprobación de la factura y factura
  const fac = $("#factura");
  if (d.estado === "PENDIENTE_APROBACION") {
    const total = Number(d.total_revision);
    fac.innerHTML = puede("sat.facturar") ? `<div class="tarjeta"><h2>Aprobar factura</h2>
      <table class="tabla">${(d.revision || []).map((l) => `<tr><td>${esc(l.descripcion)}</td><td class="num">${esc(l.cantidad)} × ${euros(l.precio)}${Number(l.descuento_pct) ? " −" + esc(l.descuento_pct) + "%" : ""}</td><td class="num">${euros(totalLinea(l))}</td></tr>`).join("")}
      <tr><td colspan="2"><b>Total con IVA</b></td><td class="num"><b>${euros(total)}</b></td></tr></table>
      <label class="fila" style="font-weight:400;margin-top:12px"><input type="checkbox" id="cAprobar" style="width:24px;min-height:24px"> He revisado parte, líneas e importes y apruebo emitir la factura por ${euros(total)}.</label>
      <button type="button" class="boton verde ancho" id="bAprobar" disabled>Aprobar y crear la factura en STEL</button>
      <p class="suave peq">Se comprueba en STEL que el albarán de trabajo no tenga ya factura. ${aj.stel_emitir_factura === true ? "La factura se EMITIRÁ en STEL (Verifactu)." : "La factura se crea en STEL; la emisión definitiva se hace en STEL."}</p></div>`
      : `<div class="alerta azul">Pendiente de la aprobación de una persona autorizada a facturar.</div>`;
    $("#cAprobar")?.addEventListener("change", (e) => { $("#bAprobar").disabled = !e.target.checked; });
    $("#bAprobar")?.addEventListener("click", async () => {
      try {
        await rpc("sat_factura_aprobar", {p_id: id, p_total_visto: total, p_texto: `Aprobada por ${ctx.S.yo.nombre}: ${euros(total)}`});
        avisar("Factura aprobada. Creándola en STEL…");
        await procesar(id);
      } catch (e) { avisar(e.message, {error: true}); }
    });
  }
  if (d.factura) {
    const f = d.factura;
    const pdf = f.pdf_path ? url.get(f.pdf_path) : "";
    const dif = f.stel_total !== null && f.stel_total !== undefined ? Math.round((Number(f.stel_total) - Number(f.total_previsto)) * 100) / 100 : null;
    fac.insertAdjacentHTML("beforeend", `<div class="tarjeta"><h2>Factura</h2><p><span class="chip ${f.estado === "ERROR" ? "rojo" : "verde"}">${esc(f.estado)}</span>
      ${f.stel_referencia ? ` · <b>${esc(f.stel_referencia)}</b>` : ""} · aprobada ${esc(fechaHora(f.aprobado_en))}</p>
      <p>Total aprobado ${euros(f.total_previsto)}${f.stel_total !== null && f.stel_total !== undefined ? ` · total en STEL ${euros(f.stel_total)}` : ""}</p>
      ${dif ? `<div class="alerta ambar">STEL calcula ${euros(dif)} de diferencia con el total aprobado (redondeo del IVA por líneas o por tipos): revísala en STEL.</div>` : ""}
      <p>Entrega al cliente: <b>${esc({SIN_PDF: "falta el PDF", PENDIENTE_ENTREGA: "pendiente (el técnico la tiene en su bandeja)", ENTREGADA: "entregada"}[f.entrega_estado])}</b>
      ${f.entregada_en ? " · " + esc(fechaHora(f.entregada_en)) + (f.entrega_medio ? " · " + esc(f.entrega_medio) : "") : ""}</p>
      ${pdf ? `<a class="boton sec ancho" href="${esc(pdf)}" target="_blank" rel="noopener">📄 PDF de la factura</a>` : ""}
      ${f.estado === "EN_STEL" && !f.pdf_path ? `<div class="alerta ambar">Creada en STEL <b>pendiente de emitir</b>. Emítela en STEL; después ${puede("sat.facturar")
        ? `confírmalo aquí y se traerá su PDF para el técnico.<br><button type="button" class="boton mini" id="bEmitida" style="margin-top:8px">Ya está emitida en STEL: traer el PDF</button>`
        : "una persona autorizada a facturar lo confirmará aquí."}</div>` : ""}
      ${!f.pdf_path && puede("sat.administrar") ? `<p class="suave">Si STEL no da el PDF por la API, descarga de STEL el PDF de la factura EMITIDA y súbelo aquí: llegará a la bandeja del técnico.</p>
        <label class="boton ancho">Subir PDF de la factura<input type="file" accept="application/pdf" id="iFactura" hidden></label>` : ""}</div>`);
    $("#bEmitida")?.addEventListener("click", async () => {
      if (!(await confirmar(`¿Confirmas que la factura ${f.stel_referencia || ""} ya está EMITIDA en STEL? Su PDF irá a la bandeja del técnico para entregarla.`, "Sí, está emitida"))) return;
      try { await rpc("sat_factura_confirmar_emitida", {p_parte: id}); await procesar(id); } catch (er) { avisar(er.message, {error: true}); }
    });
    $("#iFactura")?.addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const aid = nuevoId(), ruta = `${id}/factura-${aid}.pdf`, sha = await sha256(file);
        await subirArchivo(ruta, file, "application/pdf");
        await rpc("sat_archivo_registrar", {p: {id: aid, parte_id: id, tipo: "PDF_FACTURA", storage_path: ruta, mime_type: "application/pdf", bytes: file.size, sha256: sha}});
        const ref = await pedirTexto("Número de la factura (opcional)", {multilinea: false, valor: f.stel_referencia || ""});
        await rpc("sat_factura_pdf_manual", {p_parte: id, p_path: ruta, p_sha256: sha, p_referencia: ref || null});
        avisar("PDF subido: el técnico ya lo tiene en su bandeja."); ctx.render();
      } catch (er) { avisar(er.message, {error: true}); }
    });
  }
}

async function procesar(parteId) {
  try {
    const r = await funcion("sat-stel", {accion: "procesar", ...(parteId ? {parte_id: parteId} : {})});
    const malos = (r.operaciones || []).filter((o) => o.estado !== "OK");
    avisar(malos.length ? `STEL: ${malos.map((o) => o.tipo + " " + o.estado + (o.error ? " (" + o.error + ")" : "")).join("; ")}` : `STEL al día (${r.llamadas} llamadas).`, {error: malos.length > 0, ms: 7000});
  } catch (e) { avisar(e instanceof SinConexion ? "Sin conexión." : "STEL: " + e.message, {error: true, ms: 7000}); }
  ctx.render();
}

// ------------------------------------------------------------------ avisos
async function avisos(raiz) {
  await ctx.refrescar({silencioso: true});
  const {S} = ctx;
  const tecnicos = S.catalogo.tecnicos || [];
  const abiertos = S.avisos.filter((a) => !["CERRADO", "ANULADO"].includes(a.estado));
  raiz.innerHTML = `${puede("sat.administrar") ? `<button type="button" class="boton ancho" id="bNuevo">＋ Nuevo aviso</button><div style="height:12px"></div>` : ""}
    ${abiertos.map((a) => `<div class="tarjeta"><div class="fila"><span class="chip ${esc(a.prioridad)}">${esc(PRIORIDADES[a.prioridad])}</span><b>${esc(a.codigo)}</b>
      <span class="chip ${a.estado === "NUEVO" ? "rojo" : "gris"}">${esc(a.estado)}</span>${a.origen === "LLAMADA_TECNICO" ? `<span class="chip">por llamada</span>` : ""}</div>
      <h3>${esc(a.cliente_texto || "")}</h3><div>${esc(a.motivo)}</div><div class="suave">${esc(a.direccion_texto || "")}</div>
      ${puede("sat.administrar") ? `<div class="fila" style="margin-top:8px"><select data-asignar="${esc(a.id)}" class="crece"><option value="">Sin asignar</option>${tecnicos.map((t) => `<option value="${esc(t.id)}" ${a.tecnico_id === t.id ? "selected" : ""}>${esc(t.nombre)}</option>`).join("")}</select>
        <button type="button" class="boton mini sec" data-anular="${esc(a.id)}">Anular</button></div>` : ""}</div>`).join("") || `<p class="suave">No hay avisos abiertos.</p>`}`;
  const guardar = async (a, cambios) => {
    try { await rpc("sat_aviso_guardar", {p: {...a, ...cambios}}); avisar("Aviso guardado."); } catch (e) { avisar(e.message, {error: true}); }
    avisos(raiz);
  };
  $$("[data-asignar]", raiz).forEach((s) => s.onchange = () => guardar(S.avisos.find((x) => x.id === s.dataset.asignar), {tecnico_id: s.value || null}));
  $$("[data-anular]", raiz).forEach((b) => b.onclick = async () => { if (await confirmar("¿Anular este aviso?", "Anular", "No", "peligro")) guardar(S.avisos.find((x) => x.id === b.dataset.anular), {estado: "ANULADO"}); });
  $("#bNuevo")?.addEventListener("click", () => nuevoAviso(raiz));
}

async function nuevoAviso(raiz) {
  const {S} = ctx, cat = S.catalogo;
  const cli = await elegir("Cliente", cat.clientes, {texto: (x) => x.nombre, detalle: (x) => [x.nif, x.telefono, x.provisional ? "provisional" : ""].filter(Boolean).join(" · ")});
  if (!cli) return;
  const sel = (lista, nombre) => `<select id="${nombre}"><option value="">—</option>${lista.map((x) => `<option value="${esc(x.id)}">${esc(x.texto || [x.nombre, x.marca, x.modelo, x.cargo].filter(Boolean).join(" · "))}</option>`).join("")}</select>`;
  const r = await dialogo(`<h2>Nuevo aviso · ${esc(cli.nombre)}</h2>
    <label>Dirección</label>${sel(cat.direcciones.filter((x) => x.cliente_id === cli.id), "nDir")}
    <label>Contacto</label>${sel(cat.contactos.filter((x) => x.cliente_id === cli.id), "nCon")}
    <label>Instalación o equipo</label>${sel(cat.equipos.filter((x) => x.cliente_id === cli.id), "nEq")}
    <label>Motivo</label><textarea id="nMotivo"></textarea>
    <label>Prioridad</label><select id="nPrio">${Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}" ${k === "NORMAL" ? "selected" : ""}>${v}</option>`).join("")}</select>
    <label>Técnico</label><select id="nTec"><option value="">Sin asignar</option>${(cat.tecnicos || []).map((t) => `<option value="${esc(t.id)}">${esc(t.nombre)}</option>`).join("")}</select>
    <label>Programado para (opcional)</label><input id="nProg" type="datetime-local">`,
  [{texto: "Cancelar", valor: null}, {texto: "Crear aviso", valor: (d) => ({dir: $("#nDir", d).value, con: $("#nCon", d).value, eq: $("#nEq", d).value, motivo: $("#nMotivo", d).value.trim(),
    prioridad: $("#nPrio", d).value, tecnico: $("#nTec", d).value, prog: $("#nProg", d).value}), validar: (d) => $("#nMotivo", d).value.trim().length > 2}]);
  if (!r) return;
  const buscar = (lista, id) => lista.find((x) => x.id === id);
  try {
    await rpc("sat_aviso_guardar", {p: {id: nuevoId(), motivo: r.motivo, prioridad: r.prioridad, cliente_id: cli.id, direccion_id: r.dir || null, contacto_id: r.con || null,
      equipo_id: r.eq || null, cliente_texto: cli.nombre, direccion_texto: buscar(cat.direcciones, r.dir)?.texto || null, contacto_texto: buscar(cat.contactos, r.con)?.nombre || null,
      equipo_texto: buscar(cat.equipos, r.eq)?.nombre || null, tecnico_id: r.tecnico || null, programado_para: r.prog ? new Date(r.prog).toISOString() : null, origen: "ADMINISTRACION"}});
    avisar("Aviso creado" + (r.tecnico ? " y notificado al técnico." : "."));
  } catch (e) { avisar(e.message, {error: true}); }
  avisos(raiz);
}

// ------------------------------------------------------------------ STEL
async function stel(raiz) {
  const ops = await rpc("sat_stel_pendientes");
  raiz.innerHTML = `<div class="tarjeta"><h2>Operaciones con STEL pendientes o con fallo</h2>
    ${ops.map((o) => `<div class="item"><div class="fila"><b>${esc(o.tipo)}</b><span class="chip ${ESTADO_OP[o.estado]}">${esc(o.estado)}</span>
      ${o.parte_codigo ? `<a href="#/admin/parte/${esc(o.parte_id)}">${esc(o.parte_codigo)}</a>` : esc(o.cliente || "")}<span class="suave peq">${esc(fechaHora(o.actualizado_en))} · ${esc(o.intentos)} intento(s)</span>
      <button type="button" class="boton mini sec" data-reintentar="${esc(o.id)}">Reintentar</button></div>${o.error ? `<div class="peq" style="color:var(--rojo)">${esc(o.error)}</div>` : ""}</div>`).join("") || `<p class="suave">Todo sincronizado.</p>`}
    <button type="button" class="boton ancho" id="bTodo" style="margin-top:10px">Procesar todo ahora</button></div>`;
  $$("[data-reintentar]", raiz).forEach((b) => b.onclick = async () => { try { await rpc("sat_stel_reintentar", {p_op: b.dataset.reintentar}); await procesar(null); } catch (e) { avisar(e.message, {error: true}); } });
  $("#bTodo").onclick = () => procesar(null);
}

// ------------------------------------------------------------------ ajustes
async function ajustes(raiz) {
  if (!puede("sat.administrar")) { raiz.innerHTML = `<div class="alerta rojo">Solo administración.</div>`; return; }
  const [aj, precios] = await Promise.all([rpc("sat_ajustes_leer"), rpc("sat_articulos_precios")]);
  const servicios = precios.filter((p) => p.tipo === "SERVICIO");
  const selServicio = (clave) => `<select data-ajuste="${clave}" data-tipo="num"><option value="">— sin configurar —</option>${servicios.map((s) => `<option value="${s.stel_id}" ${Number(aj[clave]) === Number(s.stel_id) ? "selected" : ""}>${esc(s.nombre)}${s.precio !== null ? " · " + euros(s.precio) : ""}</option>`).join("")}</select>`;
  raiz.innerHTML = `<div class="tarjeta"><h2>Catálogo de STEL</h2><p>${esc(aj._catalogo?.clientes ?? 0)} clientes · ${esc(aj._catalogo?.articulos ?? 0)} artículos y servicios
    ${aj._catalogo?.actualizado ? " · actualizado " + esc(fechaHora(aj._catalogo.actualizado)) : ""}</p>
    <p class="suave peq">Llamadas a STEL hoy: ${esc(aj._llamadas_hoy)} de ${esc(aj.stel_limite_llamadas_dia)} (límite propio, por debajo del de tu plan de STEL).</p>
    <button type="button" class="boton ancho" id="bCatalogo">Actualizar catálogo desde STEL</button></div>
    <div class="tarjeta"><h2>Líneas automáticas</h2><label>Servicio de STEL para la mano de obra (por horas)</label>${selServicio("stel_servicio_mano_obra_id")}
    <label>Servicio de STEL para el desplazamiento</label>${selServicio("stel_servicio_desplazamiento_id")}
    <div class="fila"><div class="crece"><label>Precio fijo por hora de mano de obra (€)</label><input data-ajuste="precio_hora_mano_obra" data-tipo="num" inputmode="decimal" value="${esc(aj.precio_hora_mano_obra ?? "")}"></div>
    <div class="crece"><label>Precio fijo por hora de desplazamiento (€)</label><input data-ajuste="precio_hora_desplazamiento" data-tipo="num" inputmode="decimal" value="${esc(aj.precio_hora_desplazamiento ?? "")}"></div></div>
    <p class="suave peq">La revisión propone las horas que anotó el técnico (minutos ÷ 60) a este precio. Vacío: el precio del servicio de STEL.</p>
    <label>Serie de los albaranes de trabajo (id de STEL, vacío = la predeterminada)</label><input data-ajuste="stel_serie_albaran_trabajo_id" data-tipo="num" value="${esc(aj.stel_serie_albaran_trabajo_id ?? "")}">
    <label>Límite propio de llamadas a STEL al día</label><input data-ajuste="stel_limite_llamadas_dia" data-tipo="num" value="${esc(aj.stel_limite_llamadas_dia ?? 250)}"></div>
    <div class="tarjeta"><h2>Factura</h2><label class="fila" style="font-weight:400"><input type="checkbox" data-ajuste="stel_emitir_factura" data-tipo="bool" style="width:24px;min-height:24px" ${aj.stel_emitir_factura === true ? "checked" : ""} ${puede("sat.facturar") ? "" : "disabled"}>
      Emitir la factura en STEL (Verifactu) al aprobarla. Sin marcar: se crea en STEL y se emite allí.</label></div>
    <div class="tarjeta"><h2>Firma y dictado</h2><label>Texto del alcance de la firma</label><textarea data-ajuste="texto_alcance_firma" style="min-height:140px">${esc(aj.texto_alcance_firma || "")}</textarea>
    <label>Servicio de transcripción (URL)</label><input data-ajuste="transcripcion_url" value="${esc(aj.transcripcion_url || "")}"></div>
    <button type="button" class="boton ancho" id="bGuardarAj">Guardar ajustes</button>`;
  $("#bCatalogo").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Leyendo STEL…";
    try { const r = await funcion("sat-stel", {accion: "catalogo"}); avisar(`Catálogo actualizado: ${Object.entries(r.cargados).map(([k, v]) => `${v} ${k}`).join(", ")} (${r.llamadas} llamadas).`, {ms: 7000});
      await ctx.refrescar({silencioso: true}); } catch (er) { avisar(er.message, {error: true}); }
    ajustes(raiz);
  };
  $("#bGuardarAj").onclick = async () => {
    try {
      for (const el of $$("[data-ajuste]", raiz)) {
        const v = el.dataset.tipo === "num" ? (el.value === "" ? null : Number(el.value)) : el.dataset.tipo === "bool" ? el.checked : el.value;
        if (JSON.stringify(v) !== JSON.stringify(aj[el.dataset.ajuste] ?? null) && !(el.disabled)) await rpc("sat_ajuste_guardar", {p_clave: el.dataset.ajuste, p_valor: v});
      }
      avisar("Ajustes guardados."); ajustes(raiz);
    } catch (e) { avisar(e.message, {error: true}); }
  };
}
