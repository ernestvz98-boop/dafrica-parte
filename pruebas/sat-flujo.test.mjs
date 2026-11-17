// DAFRICA SAT · flujo completo con la base de datos de la propuesta (PGlite), la función Edge real y un STEL falso.
// Aviso → parte → firmas → envío → STEL (incidencia, albarán de trabajo, adjuntos) → revisión → aprobación →
// factura → PDF → bandeja del técnico → entrega. Con respuestas perdidas, reintentos y sin duplicados.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {crearEmulador, USUARIOS} from "./sat/emulador.mjs";

const uuid = () => crypto.randomUUID();
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

test("SAT: flujo completo de punta a punta con STEL falso", {timeout: 120000}, async (t) => {
  const e = await crearEmulador();
  t.after(() => e.cerrar());
  const sesiones = {};
  for (const u of USUARIOS) sesiones[u.email.split("@")[0]] = await e.entrar(u.email);
  const llamar = async (quien, ruta, cuerpo, {esperar = 200} = {}) => {
    const r = await fetch(e.origen + ruta, {method: "POST", headers: {Authorization: "Bearer " + sesiones[quien], apikey: "anon-local",
      "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)});
    const txt = await r.text();
    assert.equal(r.status, esperar, `${ruta}: ${txt}`);
    return txt ? JSON.parse(txt) : null;
  };
  const rpc = (quien, fn, args, op) => llamar(quien, "/rest/v1/rpc/" + fn, args, op);
  const stel = (quien, cuerpo, op) => llamar(quien, "/functions/v1/sat-stel", cuerpo, op);
  const subir = async (quien, ruta, bytes, tipo) => {
    const r = await fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST",
      headers: {Authorization: "Bearer " + sesiones[quien], "Content-Type": tipo}, body: bytes});
    return r.status;
  };

  // 1. Catálogo de STEL y ajustes (administración). Un técnico no puede leer el catálogo de STEL ni ver precios.
  await stel("tecnico", {accion: "catalogo"}, {esperar: 403});
  const cargado = await stel("admin", {accion: "catalogo"});
  assert.equal(cargado.cargados.clientes, 2);
  assert.equal(cargado.cargados.articulos, 4);
  await rpc("tecnico", "sat_articulos_precios", {}, {esperar: 403});
  await rpc("admin", "sat_ajuste_guardar", {p_clave: "stel_servicio_mano_obra_id", p_valor: e.semilla.s1.id});
  await rpc("admin", "sat_ajuste_guardar", {p_clave: "stel_servicio_desplazamiento_id", p_valor: e.semilla.s2.id});
  const cat = await rpc("tecnico", "sat_catalogo", {});
  const cli = cat.clientes.find((c) => c.stel_id === e.semilla.c1.id);
  const dir = cat.direcciones.find((d) => d.cliente_id === cli.id);
  const eq = cat.equipos.find((d) => d.cliente_id === cli.id);
  assert.ok(cli && dir && eq);

  // 2. El técnico recibe una llamada y crea el aviso él mismo (reintentar no lo duplica).
  const aviso = {id: uuid(), motivo: "Caldera no arranca", prioridad: "URGENTE", cliente_id: cli.id, direccion_id: dir.id, equipo_id: eq.id,
    cliente_texto: cli.nombre, direccion_texto: dir.texto};
  const a1 = await rpc("tecnico", "sat_aviso_guardar", {p: aviso});
  const a2 = await rpc("tecnico", "sat_aviso_guardar", {p: aviso});
  assert.equal(a1.codigo, a2.codigo);
  assert.equal(a1.origen, "LLAMADA_TECNICO");

  // 3. Parte: un material del catálogo y otro escrito a mano (sin artículo de STEL).
  const parteId = uuid(), fotoId = uuid();
  const contenido = {tipo_visita: "REPARACION_FINALIZADA", pendiente_de: null, fecha: "2026-11-16", hora_inicio: "09:00", hora_fin: "10:30",
    cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, direccion: {id: dir.id, stel_id: dir.stel_id, texto: dir.texto},
    equipo: {id: eq.id, stel_id: eq.stel_id, nombre: eq.nombre}, contacto: {id: null, nombre: "", telefono: ""},
    motivo: aviso.motivo, prioridad: "URGENTE", averia: "No arrancaba (error E133)", trabajos: "Sustituido el termostato",
    comprobaciones: [{texto: "Presión del circuito", resultado: "INCORRECTO"}],
    materiales: [{id: "m1", descripcion: "Termostato digital", cantidad: 1, unidad: "ud", stel_item_id: e.semilla.p1.id},
      {id: "m2", descripcion: "Codo 16", cantidad: 3, unidad: "ud"}],
    tiempo_trabajo_min: 90, desplazamiento_min: 20, desplazamiento_km: null, estado_final: "Funciona", pendientes: "",
    fotos: [{id: fotoId, momento: "DESPUES", comentario: "Termostato nuevo"}]};
  await rpc("tecnico", "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  // Archivos: el segundo técnico no puede subir a la carpeta de este parte; reintentar una subida da «ya existe».
  assert.equal(await subir("tecnico2", `${parteId}/intruso.jpg`, Buffer.from("x"), "image/jpeg"), 403);
  const foto = Buffer.from("foto-de-prueba-".repeat(20)), firma = Buffer.from("firma-png-de-prueba"), pdf = Buffer.from("%PDF-1.4 parte firmado de prueba %%EOF");
  assert.equal(await subir("tecnico", `${parteId}/${fotoId}.jpg`, foto, "image/jpeg"), 200);
  assert.equal(await subir("tecnico", `${parteId}/${fotoId}.jpg`, foto, "image/jpeg"), 409);
  await rpc("tecnico", "sat_archivo_registrar", {p: {id: fotoId, parte_id: parteId, tipo: "FOTO", momento: "DESPUES", storage_path: `${parteId}/${fotoId}.jpg`, sha256: sha(foto)}});
  const firmaT = uuid(), firmaC = uuid(), pdfId = uuid();
  for (const [id, n] of [[firmaT, "firma-tecnico"], [firmaC, "firma-cliente"]]) {
    assert.equal(await subir("tecnico", `${parteId}/${n}-${id}.png`, firma, "image/png"), 200);
    await rpc("tecnico", "sat_archivo_registrar", {p: {id, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/${n}-${id}.png`, sha256: sha(firma)}});
  }
  const base = {parte_id: parteId, texto_alcance: "La firma no acepta importes.", firmado_en: new Date().toISOString(), contenido};
  await rpc("tecnico", "sat_firma_registrar", {p: {...base, id: firmaT, rol: "TECNICO", imagen_path: `${parteId}/firma-tecnico-${firmaT}.png`}});
  const fc = await rpc("tecnico", "sat_firma_registrar", {p: {...base, id: firmaC, rol: "CLIENTE", nombre: "Responsable Ficticio", cargo: "Presidente",
    imagen_path: `${parteId}/firma-cliente-${firmaC}.png`}});
  assert.equal(fc.estado_parte, "FIRMADO");
  assert.equal(await subir("tecnico", `${parteId}/parte-v1-${pdfId}.pdf`, pdf, "application/pdf"), 200);
  await rpc("tecnico", "sat_archivo_registrar", {p: {id: pdfId, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/parte-v1-${pdfId}.pdf`, sha256: sha(pdf)}});
  const enviado = await rpc("tecnico", "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/parte-v1-${pdfId}.pdf`, p_pdf_sha256: sha(pdf)});
  assert.equal(enviado.estado, "ENVIADO");

  // 4. STEL: la incidencia se crea; el albarán se bloquea porque «Codo 16» no tiene artículo de STEL.
  await stel("tecnico2", {accion: "procesar", parte_id: parteId}, {esperar: 403});
  let r = await stel("tecnico", {accion: "procesar", parte_id: parteId});
  assert.deepEqual(r.operaciones.map((o) => [o.tipo, o.estado]), [["INCIDENCIA", "OK"], ["ALBARAN_TRABAJO", "BLOQUEADA"]]);
  assert.match(r.operaciones[1].error, /Codo 16/);
  assert.equal(e.stel.datos.incidents.length, 1);
  assert.equal(e.stel.datos.incidents[0]["external-id"], "DAFRICA-SAT-" + aviso.id);

  // 5. Administración asigna el artículo en la revisión; STEL pierde la respuesta del POST del albarán.
  const lineas = [
    {tipo: "MATERIAL", material_id: "m1", stel_item_id: e.semilla.p1.id, descripcion: "Termostato digital", cantidad: 1, precio: 40, descuento_pct: 0, iva_pct: 21},
    {tipo: "MATERIAL", material_id: "m2", stel_item_id: e.semilla.p2.id, descripcion: "Codo 16", cantidad: 3, precio: 2.5, descuento_pct: 10, iva_pct: 21},
    {tipo: "MANO_OBRA", stel_item_id: e.semilla.s1.id, descripcion: "Mano de obra", cantidad: 1.5, precio: 35, descuento_pct: 0, iva_pct: 21},
    {tipo: "DESPLAZAMIENTO", stel_item_id: e.semilla.s2.id, descripcion: "Desplazamiento", cantidad: 1, precio: 25, descuento_pct: 0, iva_pct: 21}];
  await rpc("tecnico", "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: null}, {esperar: 403});
  const rev = await rpc("admin", "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: "Precios de tarifa"});
  // 40 + 6,75 + 52,5 + 25 = 124,25 de base; con IVA por línea: 48,40 + 8,17 + 63,53 + 30,25 = 150,35.
  assert.equal(Number(rev.total_revision), 150.35);
  e.stel.estado.perderRespuesta.add("POST workDeliveryNotes");
  r = await stel("admin", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "ERROR");
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1, "el POST se hizo aunque se perdió la respuesta");
  r = await stel("admin", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "OK");
  assert.equal(r.operaciones[0].detalle.accion, "reutilizado");
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1, "sin duplicar el albarán de trabajo");
  const wdn = e.stel.datos.workDeliveryNotes[0];
  assert.equal(wdn["account-id"], e.semilla.c1.id);
  assert.equal(wdn["parent-incident-id"], e.stel.datos.incidents[0].id);
  assert.ok(wdn.title.startsWith(enviado.codigo + " "));
  assert.deepEqual(wdn.lines.map((l) => [l["item-id"], l.units]), [[e.semilla.p1.id, 1], [e.semilla.p2.id, 3], [e.semilla.s1.id, 1.5], [e.semilla.s2.id, 1]]);
  assert.deepEqual(e.stel.datos.entityAttachments.map((a) => a.name).sort(),
    [`${enviado.codigo}_foto_despues_${fotoId.slice(0, 8)}.jpg`, `${enviado.codigo}_parte_firmado_v1.pdf`].sort());
  assert.equal(Buffer.from(e.stel.datos.entityAttachments.find((a) => a.name.endsWith(".pdf"))._base64, "base64").toString(), pdf.toString());
  // Reintentar a mano la operación ya hecha no crea nada nuevo.
  const det = await rpc("admin", "sat_parte_detalle", {p_id: parteId});
  const opAlb = det.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO");
  await rpc("admin", "sat_stel_reintentar", {p_op: opAlb.id});
  r = await stel("admin", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "OK");
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1);
  assert.equal(e.stel.datos.entityAttachments.length, 2);

  // 6. Decisión, aprobación expresa y factura (con respuesta perdida en el POST de la factura).
  await rpc("admin", "sat_decidir", {p_id: parteId, p_decision: "FACTURAR", p_nota: null});
  await rpc("admin", "sat_factura_aprobar", {p_id: parteId, p_total_visto: 150.35, p_texto: "Apruebo"}, {esperar: 403});
  await rpc("factura", "sat_factura_aprobar", {p_id: parteId, p_total_visto: 150.35, p_texto: "Apruebo la factura de 150,35 €"});
  e.stel.estado.perderRespuesta.add("POST ordinaryInvoices");
  r = await stel("factura", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "ERROR");
  r = await stel("factura", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "OK");
  assert.equal(r.operaciones[0].detalle.accion, "reutilizada");
  assert.equal(e.stel.datos.ordinaryInvoices.length, 1, "sin duplicar la factura");
  const fac = e.stel.datos.ordinaryInvoices[0];
  assert.equal(fac["parent-document-id"], wdn.id);
  assert.equal(fac["total-amount"], 150.35);
  assert.equal(r.operaciones[0].detalle.diferencia_total, 0);
  // Creada en STEL pero SIN emitir (emisión por la API desactivada): su PDF nunca va al técnico.
  assert.equal(r.operaciones[0].detalle.emitida, false);
  assert.equal(r.operaciones[0].detalle.pdf_path, undefined);
  let tras = await rpc("tecnico", "sat_parte_detalle", {p_id: parteId});
  assert.equal(tras.estado, "APROBADO");
  assert.equal(tras.factura.estado, "EN_STEL");
  assert.equal(tras.factura.entrega_estado, "SIN_PDF");
  assert.ok((await rpc("factura", "sat_notificaciones", {})).some((n) => n.tipo === "FACTURA_POR_EMITIR"));
  // Una persona autorizada confirma que la emitió en STEL: entonces se trae el PDF (sin crear otra factura).
  await rpc("tecnico", "sat_factura_confirmar_emitida", {p_parte: parteId}, {esperar: 403});
  await rpc("factura", "sat_factura_confirmar_emitida", {p_parte: parteId});
  r = await stel("factura", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "OK");
  assert.equal(r.operaciones[0].detalle.emitida, true);
  assert.ok(r.operaciones[0].detalle.pdf_path);
  assert.equal(e.stel.datos.ordinaryInvoices.length, 1);
  assert.equal(e.stel.estado.emitidas.size, 0, "sin la opción activada, la aplicación no emite");
  tras = await rpc("tecnico", "sat_parte_detalle", {p_id: parteId});
  assert.equal(tras.estado, "FACTURADO");
  assert.equal(tras.factura.entrega_estado, "PENDIENTE_ENTREGA", "avisar al técnico no es entregar");

  // 7. Bandeja del técnico: abre el PDF con un enlace firmado y marca la entrega a mano.
  const bandeja = await rpc("tecnico", "sat_mis_facturas", {});
  assert.equal(bandeja.length, 1);
  assert.deepEqual(await rpc("tecnico2", "sat_mis_facturas", {}), []);
  const firmado = await llamar("tecnico", `/storage/v1/object/sign/sat-archivos/${bandeja[0].pdf_path}`, {expiresIn: 60});
  const bytes = Buffer.from(await (await fetch(e.origen + "/storage/v1" + firmado.signedURL)).arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const ent = await rpc("tecnico", "sat_factura_entrega", {p_factura: bandeja[0].id, p_entregada: true, p_medio: "Correo del cliente"});
  assert.equal(ent.entrega_estado, "ENTREGADA");
  const notis = await rpc("tecnico", "sat_notificaciones", {p_todas: true});
  assert.ok(notis.some((n) => n.tipo === "FACTURA_DISPONIBLE"));
  const noti = await rpc("admin", "sat_notificaciones", {p_todas: true});
  assert.ok(noti.some((n) => n.tipo === "AVISO_TECNICO") && noti.some((n) => n.tipo === "PARTE_RECIBIDO"));

  // 8. Recuento de STEL: una incidencia, un albarán, una factura y dos adjuntos, pese a los reintentos.
  assert.equal(e.stel.datos.incidents.length, 1);
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1);
  assert.equal(e.stel.datos.ordinaryInvoices.length, 1);
  const auditoria = (await rpc("admin", "sat_parte_detalle", {p_id: parteId})).auditoria.map((a) => a.accion);
  for (const x of ["PARTE_CREADO", "FIRMA_TECNICO", "FIRMA_CLIENTE", "PARTE_ENVIADO", "REVISION_GUARDADA", "DECISION_FACTURAR", "FACTURA_APROBADA", "FACTURA_ENTREGADA"])
    assert.ok(auditoria.includes(x), "auditoría: " + x);
});

test("SAT: factura sin PDF en STEL → administración sube el PDF y llega al técnico", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  e.stel.estado.pdfFactura = false;
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local"), fac = await e.entrar("factura@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)})).json();
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  const aviso = (await rpc(tec, "sat_avisos_listar", {}))[0];
  const cat = await rpc(tec, "sat_catalogo", {});
  const cli = cat.clientes.find((c) => c.id === aviso.cliente_id);
  const parteId = crypto.randomUUID();
  const contenido = {tipo_visita: "DIAGNOSTICO", fecha: "2026-11-16", hora_inicio: "08:00", hora_fin: "08:40", cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre},
    direccion: {texto: "x"}, averia: "Diagnóstico", materiales: [], tiempo_trabajo_min: 40, fotos: []};
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  const fid = crypto.randomUUID(), pid = crypto.randomUUID(), pdf = Buffer.from("%PDF parte");
  await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
  await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
  const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: crypto.randomUUID(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: crypto.randomUUID(), rol: "CLIENTE", ausente_motivo: "No había nadie responsable en el local"}});
  await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
  await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
  await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
  const r1 = await fn(tec, {accion: "procesar", parte_id: parteId});
  assert.deepEqual(r1.operaciones.map((o) => o.estado), ["OK", "OK"], JSON.stringify(r1));
  const lineas = [{tipo: "MANO_OBRA", stel_item_id: e.semilla.s1.id, descripcion: "Mano de obra", cantidad: 0.67, precio: 35, descuento_pct: 0, iva_pct: 21}];
  const rev = await rpc(adm, "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: null});
  await rpc(adm, "sat_decidir", {p_id: parteId, p_decision: "FACTURAR", p_nota: null});
  // Emisión por la API activada (solo quien puede facturar): la factura se emite (Verifactu) una sola vez.
  await rpc(fac, "sat_ajuste_guardar", {p_clave: "stel_emitir_factura", p_valor: true});
  await rpc(fac, "sat_factura_aprobar", {p_id: parteId, p_total_visto: Number(rev.total_revision), p_texto: "Apruebo"});
  const r2 = await fn(fac, {accion: "procesar", parte_id: parteId});
  assert.equal(r2.operaciones[0].estado, "OK");
  assert.equal(r2.operaciones[0].detalle.emitida, true);
  assert.equal(e.stel.estado.emitidas.size, 1);
  assert.equal(e.stel.estado.llamadas.filter((l) => l.recurso === "issueInvoiceVerifactu").length, 1);
  assert.match(r2.operaciones[0].detalle.pdf_nota, /pdf-path vacío/);
  let det = await rpc(tec, "sat_parte_detalle", {p_id: parteId});
  assert.equal(det.estado, "APROBADO");
  assert.equal(det.factura.entrega_estado, "SIN_PDF");
  assert.ok((await rpc(adm, "sat_notificaciones", {})).some((n) => n.tipo === "FACTURA_SIN_PDF"));
  // Administración sube el PDF descargado de STEL.
  const aid = crypto.randomUUID(), fpdf = Buffer.from("%PDF factura descargada de STEL");
  assert.equal((await subir(adm, `${parteId}/factura-${aid}.pdf`, fpdf, "application/pdf")).status, 200);
  await rpc(adm, "sat_archivo_registrar", {p: {id: aid, parte_id: parteId, tipo: "PDF_FACTURA", storage_path: `${parteId}/factura-${aid}.pdf`, sha256: sha(fpdf)}});
  await rpc(adm, "sat_factura_pdf_manual", {p_parte: parteId, p_path: `${parteId}/factura-${aid}.pdf`, p_sha256: sha(fpdf), p_referencia: null});
  det = await rpc(tec, "sat_parte_detalle", {p_id: parteId});
  assert.equal(det.estado, "FACTURADO");
  assert.equal(det.factura.entrega_estado, "PENDIENTE_ENTREGA");
  assert.equal((await rpc(tec, "sat_mis_facturas", {})).length, 1);
});

test("SAT: cliente nuevo del técnico → se crea en STEL una vez, o se vincula al existente; incidencia y albarán se desbloquean", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)})).json();
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  // Un parte enviado con un cliente provisional, firmado por el técnico y con el responsable ausente.
  const enviarCon = async (cliente) => {
    await rpc(tec, "sat_alta_provisional", {p_tipo: "CLIENTE", p_datos: cliente});
    const aviso = {id: crypto.randomUUID(), motivo: "Cámara no enfría", prioridad: "ALTA", cliente_id: cliente.id, cliente_texto: cliente.nombre};
    await rpc(tec, "sat_aviso_guardar", {p: aviso});
    const parteId = crypto.randomUUID();
    const contenido = {tipo_visita: "PENDIENTE", pendiente_de: "REPUESTOS", fecha: "2026-11-16", hora_inicio: "09:00", hora_fin: "09:40",
      cliente: {id: cliente.id, stel_id: null, nombre: cliente.nombre}, direccion: {texto: "Calle Ficticia 10"}, averia: "Relé quemado",
      pendientes: "Pedir relé", materiales: [], tiempo_trabajo_min: 40, fotos: []};
    await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
    const fid = crypto.randomUUID(), pid = crypto.randomUUID(), pdf = Buffer.from("%PDF parte " + parteId);
    await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
    await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
    const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
    await rpc(tec, "sat_firma_registrar", {p: {...b, id: crypto.randomUUID(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
    await rpc(tec, "sat_firma_registrar", {p: {...b, id: crypto.randomUUID(), rol: "CLIENTE", ausente_motivo: "El dueño no estaba"}});
    await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
    await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
    await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
    const r = await fn(tec, {accion: "procesar", parte_id: parteId});
    assert.deepEqual(r.operaciones.map((o) => o.estado), ["BLOQUEADA", "BLOQUEADA"], JSON.stringify(r));
    assert.match(r.operaciones[0].error, /Cliente provisional/);
    return parteId;
  };
  const clientesAntes = e.stel.datos.clients.length;

  // A) Cliente que no existe en STEL: «Crear en STEL» lo crea una sola vez y todo sigue solo.
  const nuevo = {id: crypto.randomUUID(), nombre: "Bar Ficticio La Esquina", nif: "B99999999"};
  const parteA = await enviarCon(nuevo);
  await rpc(adm, "sat_cliente_resolver", {p_cliente: nuevo.id, p_stel_id: null, p_crear_en_stel: true});
  let r = await fn(adm, {accion: "procesar"});
  assert.deepEqual(r.operaciones.map((o) => [o.tipo, o.estado]), [["CLIENTE", "OK"], ["INCIDENCIA", "OK"], ["ALBARAN_TRABAJO", "OK"]], JSON.stringify(r));
  assert.equal(e.stel.datos.clients.length, clientesAntes + 1);
  assert.equal((await rpc(adm, "sat_parte_detalle", {p_id: parteA})).stel_estado, "SINCRONIZADO");
  await rpc(adm, "sat_cliente_resolver", {p_cliente: nuevo.id, p_stel_id: null, p_crear_en_stel: true});
  await fn(adm, {accion: "procesar"});
  assert.equal(e.stel.datos.clients.length, clientesAntes + 1, "repetir no duplica el cliente");

  // B) El técnico escribe un cliente que YA está en STEL: la oficina lo vincula (no se crea otro).
  const cat = await rpc(adm, "sat_catalogo", {});
  const existente = cat.clientes.find((c) => c.stel_id === e.semilla.c2.id);
  const repetido = {id: crypto.randomUUID(), nombre: "Restaurante El Puerto (escrito a mano)"};
  const parteB = await enviarCon(repetido);
  await rpc(adm, "sat_cliente_resolver", {p_cliente: repetido.id, p_stel_id: existente.stel_id, p_crear_en_stel: false});
  r = await fn(adm, {accion: "procesar", parte_id: parteB});
  assert.deepEqual(r.operaciones.map((o) => [o.tipo, o.estado]), [["INCIDENCIA", "OK"], ["ALBARAN_TRABAJO", "OK"]], JSON.stringify(r));
  assert.equal(e.stel.datos.clients.length, clientesAntes + 1, "vincular no crea clientes");
  assert.equal(e.stel.datos.workDeliveryNotes.at(-1)["account-id"], e.semilla.c2.id);
  assert.ok(!(await rpc(adm, "sat_catalogo", {})).clientes.some((c) => c.id === repetido.id), "el provisional vinculado ya no sale en el catálogo");
});

test("SAT: límite diario de llamadas a STEL", {timeout: 60000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const adm = await e.entrar("admin@prueba.local");
  const h = {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen};
  await fetch(`${e.origen}/rest/v1/rpc/sat_ajuste_guardar`, {method: "POST", headers: h, body: JSON.stringify({p_clave: "stel_limite_llamadas_dia", p_valor: 3})});
  const r = await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: h, body: JSON.stringify({accion: "catalogo"})});
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /Límite diario/);
});
