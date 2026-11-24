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

  // 4. STEL: al enviar se crean la incidencia y el albarán de trabajo (usuario, 2026-11-24: «que cuando lo envíe se cree el albarán
  // de trabajo y ya Dani en la oficina lo revise»). «Codo 16», escrito a mano y sin artículo de STEL, va con el artículo genérico
  // «por identificar» y queda apuntado para la oficina. STEL pierde la respuesta del POST del albarán: el siguiente intento lo encuentra.
  await stel("tecnico2", {accion: "procesar", parte_id: parteId}, {esperar: 403});
  e.stel.estado.perderRespuesta.add("POST workDeliveryNotes");
  let r = await stel("tecnico", {accion: "procesar", parte_id: parteId});
  assert.deepEqual(r.operaciones.map((o) => [o.tipo, o.estado]), [["INCIDENCIA", "OK"], ["ALBARAN_TRABAJO", "ERROR"]]);
  assert.equal(e.stel.datos.incidents.length, 1);
  assert.equal(e.stel.datos.incidents[0]["external-id"], "DAFRICA-SAT-" + aviso.id);
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1, "el POST se hizo aunque se perdió la respuesta");
  r = await stel("tecnico", {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones[0].estado, "OK", JSON.stringify(r));
  assert.equal(r.operaciones[0].detalle.accion, "reutilizado");
  assert.equal(e.stel.datos.workDeliveryNotes.length, 1, "sin duplicar el albarán de trabajo");
  const genericos = e.stel.datos.products.filter((x) => x.reference === "SAT-POR-IDENTIFICAR");
  assert.equal(genericos.length, 1, "el artículo genérico se da de alta una sola vez");
  assert.deepEqual(r.operaciones[0].detalle.por_identificar, ["Codo 16 (dictado)"]);
  const wdn = e.stel.datos.workDeliveryNotes[0];
  assert.equal(wdn["account-id"], e.semilla.c1.id);
  assert.equal(wdn["parent-incident-id"], e.stel.datos.incidents[0].id);
  assert.ok(wdn.title.startsWith(enviado.codigo + " "));
  assert.deepEqual(wdn.lines.map((l) => [l["item-id"], l.units]), [[e.semilla.p1.id, 1], [genericos[0].id, 3], [e.semilla.s1.id, 1.5], [e.semilla.s2.id, 0.33]]); // desplazamiento en horas (20 min)
  assert.match(wdn["private-comments"], /POR IDENTIFICAR \(poner el artículo\): Codo 16/);
  // La oficina ve en el parte el artículo con el que se creó cada material (para proponer la revisión).
  const conArt = await rpc("admin", "sat_parte_detalle", {p_id: parteId});
  assert.deepEqual(conArt.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO").articulos, {m2: genericos[0].id});

  // 5. Administración revisa: pone el artículo bueno y los precios, y los lleva al albarán de trabajo de STEL.
  const lineas = [
    {tipo: "MATERIAL", material_id: "m1", stel_item_id: e.semilla.p1.id, descripcion: "Termostato digital", cantidad: 1, precio: 40, descuento_pct: 0, iva_pct: 21},
    {tipo: "MATERIAL", material_id: "m2", stel_item_id: e.semilla.p2.id, descripcion: "Codo 16", cantidad: 3, precio: 2.5, descuento_pct: 10, iva_pct: 21},
    {tipo: "MANO_OBRA", stel_item_id: e.semilla.s1.id, descripcion: "Mano de obra", cantidad: 1.5, precio: 35, descuento_pct: 0, iva_pct: 21},
    {tipo: "DESPLAZAMIENTO", stel_item_id: e.semilla.s2.id, descripcion: "Desplazamiento", cantidad: 1, precio: 25, descuento_pct: 0, iva_pct: 21}];
  await rpc("tecnico", "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: null}, {esperar: 403});
  const rev = await rpc("admin", "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: "Precios de tarifa"});
  // 40 + 6,75 + 52,5 + 25 = 124,25 de base; con IVA por línea: 48,40 + 8,17 + 63,53 + 30,25 = 150,35.
  assert.equal(Number(rev.total_revision), 150.35);
  const pa = await stel("admin", {accion: "precios_albaran", parte_id: parteId});
  assert.equal(pa.ok, true, JSON.stringify(pa));
  assert.deepEqual(wdn.lines.map((l) => [l["item-id"], l.units, l["item-base-price"], l["discount-percentage"] ?? 0]),
    [[e.semilla.p1.id, 1, 40, 0], [e.semilla.p2.id, 3, 2.5, 10], [e.semilla.s1.id, 1.5, 35, 0], [e.semilla.s2.id, 0.33, 25, 0]]);
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
  assert.deepEqual([fac["payment-option-id"], fac["bank-account-id"], wdn["payment-option-id"], wdn["bank-account-id"]],
    [e.semilla.fp.id, e.semilla.cb.id, e.semilla.fp.id, e.semilla.cb.id], "transferencia y la cuenta de Ajustes en albarán y factura");
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

test("SAT: materiales del albarán del proveedor → se usan o se dan de alta en STEL (una vez) y la revisión recibe el artículo", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  // Artículo que ya existe con el prefijo del proveedor delante de la referencia (como los del robot).
  const pref = e.stel.sembrar("products", {name: "Enlace junta plana ficticio", reference: "H0000- 6000000001", "sales-price": 1, "purchase-price": 2.1, inactive: false});
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)})).json();
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  const aviso = (await rpc(tec, "sat_avisos_listar", {}))[0];
  const cat = await rpc(tec, "sat_catalogo", {});
  const cli = cat.clientes.find((c) => c.id === aviso.cliente_id);
  const origen = (linea) => ({tipo: "ALBARAN_PROVEEDOR", proveedor: "Proveedor Ficticio", numero: "A-1", linea});
  const contenido = {tipo_visita: "REPARACION_FINALIZADA", fecha: "2026-11-20", hora_inicio: "08:00", hora_fin: "09:00", modo: "RAPIDO",
    cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, direccion: {texto: "x"}, trabajos: "Cambio de piezas", fotos: [],
    tiempo_trabajo_min: 60, desplazamiento_min: 0, materiales: [
      {id: "m1", descripcion: "Termostato digital", referencia: "TER-01", cantidad: 1, unidad: "ud", dudas: [], origen: origen(1), precio_papel: 40},
      {id: "m2", descripcion: "TE 90 FICTICIA", referencia: "1801999999", cantidad: 1, unidad: "ud", dudas: [], comprobado: "TECNICO", origen: origen(2), precio_papel: 2, precio_neto: 0.76},
      {id: "m3", descripcion: "Enlace junta plana ficticio", referencia: "6000000001", cantidad: 2, unidad: "ud", dudas: [], origen: origen(3)}]};
  const parteId = uuid();
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  const fid = uuid(), pid = uuid(), pdf = Buffer.from("%PDF parte");
  await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
  await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
  const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "CLIENTE", ausente_motivo: "No había nadie responsable en el local"}});
  await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
  await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
  await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
  // La oficina ya había preparado la revisión (sin artículos de STEL en los materiales).
  await rpc(adm, "sat_revision_guardar", {p_id: parteId, p_nota: null, p_lineas: ["m1", "m2", "m3"].map((m, i) => ({tipo: "MATERIAL", material_id: m, stel_item_id: null,
    descripcion: m, cantidad: 1, precio: [40, 2, 4][i], descuento_pct: 0, iva_pct: 21}))});
  const r1 = await fn(tec, {accion: "procesar", parte_id: parteId});
  const alb = r1.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO");
  assert.equal(alb.estado, "OK", JSON.stringify(r1));
  const nuevos = e.stel.datos.products.filter((x) => x.reference === "1801999999");
  assert.equal(nuevos.length, 1, "el que no existe se da de alta una vez");
  assert.equal(nuevos[0].name, "TE 90 FICTICIA");
  assert.equal(nuevos[0]["purchase-price"], 0.76, "compra = neto del albarán del proveedor");
  assert.deepEqual(alb.detalle.articulos, {m1: e.semilla.p1.id, m2: nuevos[0].id, m3: pref.id}, "TER-01 por la referencia; el del prefijo, por el nombre");
  const wdn = e.stel.datos.workDeliveryNotes.at(-1);
  assert.deepEqual(wdn.lines.slice(0, 3).map((l) => [l["item-id"], l.units]), [[e.semilla.p1.id, 1], [nuevos[0].id, 1], [pref.id, 2]]);
  // La revisión ya lleva los artículos (la factura los necesita) y el nuevo está en la copia del catálogo.
  const det = await rpc(adm, "sat_parte_detalle", {p_id: parteId});
  assert.deepEqual(det.revision.map((l) => l.stel_item_id), [e.semilla.p1.id, nuevos[0].id, pref.id]);
  assert.ok((await rpc(adm, "sat_articulos_precios", {})).some((a) => Number(a.stel_id) === nuevos[0].id));
  // Reintentar no duplica nada.
  await rpc(adm, "sat_stel_reintentar", {p_op: alb.id ?? (det.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO")).id});
  await fn(adm, {accion: "procesar", parte_id: parteId});
  assert.equal(e.stel.datos.products.filter((x) => x.reference === "1801999999").length, 1);
  // El artículo nuevo se creó con compra = neto y venta = neto + 30 % (usuario, 2026-11-23), no el PRECIO bruto del papel.
  assert.equal(nuevos[0]["sales-price"], 0.99);
  // Oficina: precio de un artículo (solo administración) y precios de la revisión en las líneas del albarán de trabajo.
  const sinPermiso = await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tec, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "precio_articulo", stel_id: nuevos[0].id, compra: 1, venta: 2})});
  assert.equal(sinPermiso.status, 403, "un técnico no cambia precios");
  const pa = await (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "precio_articulo", stel_id: nuevos[0].id, compra: 0.76, venta: 2})})).json();
  assert.equal(pa.ok, true, JSON.stringify(pa));
  assert.deepEqual([nuevos[0]["purchase-price"], nuevos[0]["sales-price"]], [0.76, 2]);
  const rev2 = (await rpc(adm, "sat_parte_detalle", {p_id: parteId})).revision.map((l, i) => ({...l, precio: [41, 1.25, 3.5][i]}));
  await rpc(adm, "sat_revision_guardar", {p_id: parteId, p_lineas: rev2, p_nota: null});
  const pr = await (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "precios_albaran", parte_id: parteId})})).json();
  assert.equal(pr.ok, true, JSON.stringify(pr));
  assert.deepEqual(e.stel.datos.workDeliveryNotes.at(-1).lines.map((l) => l["item-base-price"]).slice(0, 4), [41, 1.25, 3.5, 50], "materiales de la revisión; mano de obra sin línea en la revisión: precio por hora de Ajustes");
  // «Precios de materiales (compra + 30 %)»: neto del papel (0,76) o compra de STEL (2,10); sin coste, como estaba.
  const rc = await (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "recalcular_materiales", parte_id: parteId})})).json();
  assert.equal(rc.ok, true, JSON.stringify(rc));
  assert.deepEqual(rc.recalculado.materiales.map((m) => [m.coste, m.precio]), [[0.76, 0.99], [2.1, 2.73]]);
  assert.deepEqual(rc.recalculado.sin_coste, ["m1"]);
  assert.deepEqual(e.stel.datos.workDeliveryNotes.at(-1).lines.map((l) => l["item-base-price"]).slice(0, 3), [41, 0.99, 2.73]);
  assert.deepEqual((await rpc(adm, "sat_parte_detalle", {p_id: parteId})).revision.map((l) => l.precio).slice(0, 3), [41, 0.99, 2.73], "la revisión (y la factura) con los mismos precios");
  // La oficina corrige un precio a mano en el albarán de STEL: «Traer precios corregidos» lo pasa a la revisión (y a la factura).
  const enStel = e.stel.datos.workDeliveryNotes.at(-1).lines[1];
  enStel["item-base-price"] = 1.1; enStel["discount-percentage"] = 10;
  const ds = await (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "precios_desde_stel", parte_id: parteId})})).json();
  assert.equal(ds.ok, true, JSON.stringify(ds));
  // También la cantidad: la revisión de la prueba tenía 1 en la tercera línea y el albarán (como el parte) 2.
  assert.deepEqual(ds.cambios.map((x) => [x.antes.cantidad, x.ahora.cantidad, x.antes.precio, x.ahora.precio, x.ahora.dto]), [[1, 1, 0.99, 1.1, 10], [1, 2, 2.73, 2.73, 0]]);
  const rev3 = (await rpc(adm, "sat_parte_detalle", {p_id: parteId})).revision[1];
  assert.deepEqual([rev3.precio, rev3.descuento_pct, rev3.coste_origen], [1.1, 10, "corregido en el albarán de STEL"]);
  // Parte duplicado: no se borra nada si no está marcado NO FACTURABLE; marcado, se borra su albarán y su incidencia.
  const llamarBorrar = async () => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + adm, "Content-Type": "application/json", Origin: e.origen},
    body: JSON.stringify({accion: "borrar_albaran", parte_id: parteId})}));
  assert.equal((await llamarBorrar()).status, 409);
  await rpc(adm, "sat_decidir", {p_id: parteId, p_decision: "NO_FACTURABLE", p_nota: "Duplicado de prueba"});
  const bo = await (await llamarBorrar()).json();
  assert.equal(bo.ok, true, JSON.stringify(bo));
  assert.ok(bo.borrado.albaran && bo.borrado.incidencia);
  assert.equal(e.stel.datos.workDeliveryNotes.at(-1).deleted, true);
  assert.equal(e.stel.datos.incidents.at(-1).deleted, true);
});

test("SAT: «servicios» crea en STEL mano de obra y desplazamiento por horas una vez, los elige en Ajustes y desbloquea", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => { const r = await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)}); return {status: r.status, ...(await r.json())}; };
  assert.equal((await fn(tec, {accion: "servicios"})).status, 403, "un técnico no puede");
  const r1 = await fn(adm, {accion: "servicios"});
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual(r1.servicios.map((s) => [s.nombre, s.creado]), [["MANO DE OBRA (HORA)", true], ["DESPLAZAMIENTO (HORA)", true]]);
  const mo = e.stel.datos.services.find((s) => s.reference === "MO-HORA");
  assert.equal(mo["sales-price"], 50);
  const aj = await rpc(adm, "sat_ajustes_leer", {});
  assert.equal(Number(aj.stel_servicio_mano_obra_id), mo.id);
  assert.equal(Number(aj.stel_servicio_desplazamiento_id), e.stel.datos.services.find((s) => s.reference === "DESP-HORA").id);
  assert.ok((await rpc(adm, "sat_articulos_precios", {})).some((a) => Number(a.stel_id) === mo.id), "entra en la copia del catálogo");
  const r2 = await fn(adm, {accion: "servicios"});
  assert.deepEqual(r2.servicios.map((s) => s.creado), [false, false], "la segunda vez los reutiliza");
  assert.equal(e.stel.datos.services.filter((s) => s.reference === "MO-HORA").length, 1);
});

test("SAT: forma de pago y cuenta obligatorias; «pagos» las busca en STEL (una sola) y desbloquea", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true, sinPago: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => { const r = await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)}); return {status: r.status, ...(await r.json())}; };
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  const aviso = (await rpc(tec, "sat_avisos_listar", {}))[0];
  const cli = (await rpc(tec, "sat_catalogo", {})).clientes.find((c) => c.id === aviso.cliente_id);
  const contenido = {tipo_visita: "REPARACION_FINALIZADA", fecha: "2026-11-23", hora_inicio: "08:00", hora_fin: "09:00", modo: "RAPIDO",
    cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, direccion: {texto: "x"}, trabajos: "Revisión", fotos: [], tiempo_trabajo_min: 60, desplazamiento_min: 0, materiales: []};
  const parteId = uuid(), fid = uuid(), pid = uuid(), pdf = Buffer.from("%PDF parte");
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
  await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
  const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "CLIENTE", ausente_motivo: "No había nadie responsable en el local"}});
  await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
  await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
  await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
  let r = await fn(tec, {accion: "procesar", parte_id: parteId});
  const alb = r.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO");
  assert.deepEqual([alb.estado, alb.error], ["BLOQUEADA", "Falta: forma de pago y cuenta bancaria (Ajustes)"]);
  assert.equal(e.stel.datos.workDeliveryNotes.length, 0, "sin forma de pago no se crea");
  assert.equal((await fn(tec, {accion: "pagos", forma: "transferencia", cuenta: "1111"})).status, 403, "un técnico no puede");
  let p = await fn(adm, {accion: "pagos", forma: "transferencia", cuenta: "1111"});
  assert.equal(p.status, 409, "dos formas de pago llevan «transferencia»: no elige sola");
  assert.match(p.error, /Transferencia bancaria/);
  p = await fn(adm, {accion: "pagos", forma: "Transferencia bancaria", cuenta: "0000"});
  assert.equal(p.status, 409, "varias cuentas terminan en 0000");
  p = await fn(adm, {accion: "pagos", forma: "Transferencia bancaria", cuenta: "1111"});
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.descripcion, "Transferencia bancaria · Banco Ficticio ···1111");
  const aj = await rpc(adm, "sat_ajustes_leer", {});
  assert.deepEqual([Number(aj.stel_forma_pago_id), Number(aj.stel_cuenta_bancaria_id), Number(aj.margen_materiales_pct)], [e.semilla.fp.id, e.semilla.cb.id, 30]);
  r = await fn(tec, {accion: "procesar", parte_id: parteId});
  assert.equal(r.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO").estado, "OK", JSON.stringify(r));
  const wdn = e.stel.datos.workDeliveryNotes.at(-1);
  assert.deepEqual([wdn["payment-option-id"], wdn["bank-account-id"]], [e.semilla.fp.id, e.semilla.cb.id]);
  // La oficina lee la foto del albarán del proveedor y añade líneas a la revisión (el móvil no las reconoció): van al albarán
  // de trabajo; el artículo que no existe se da de alta y el precio es coste + 30 %.
  const det = await rpc(adm, "sat_parte_detalle", {p_id: parteId});
  const oficina = [{tipo: "MATERIAL", oficina: true, material_id: "ofi-1", stel_item_id: null, descripcion: "VALVULA FICTICIA Ref. 9990001", descripcion_material: "VALVULA FICTICIA",
      referencia: "9990001", cantidad: 2, precio: 2.6, descuento_pct: 0, iva_pct: 21, precio_neto: 2, origen_material: {proveedor: "Proveedor Ficticio", numero: "X-1"}},
    {tipo: "MATERIAL", oficina: true, material_id: "ofi-2", stel_item_id: e.semilla.p1.id, descripcion: "Termostato digital", referencia: "TER-01", cantidad: 1, precio: null,
      descuento_pct: 0, iva_pct: 21, precio_neto_estimado: 10, neto_estimado_como: "importe ÷ cantidad del papel"}];
  await rpc(adm, "sat_revision_guardar", {p_id: parteId, p_lineas: [...(det.revision || []), ...oficina], p_nota: null});
  p = await fn(adm, {accion: "recalcular_materiales", parte_id: parteId});
  assert.equal(p.ok, true, JSON.stringify(p));
  const alta = e.stel.datos.products.filter((x) => x.reference === "9990001");
  assert.equal(alta.length, 1, "el artículo de la línea de la oficina se da de alta una vez");
  const lineasStel = e.stel.datos.workDeliveryNotes.at(-1).lines;
  assert.deepEqual(lineasStel.filter((l) => [alta[0].id, e.semilla.p1.id].includes(l["item-id"])).map((l) => [l.units, l["item-base-price"]]), [[2, 2.6], [1, 13]],
    "neto comprobado + 30 %; estimado + 30 % (sin compra en STEL)");
  const rev = (await rpc(adm, "sat_parte_detalle", {p_id: parteId})).revision.find((l) => l.material_id === "ofi-1");
  assert.equal(rev.stel_item_id, alta[0].id, "la revisión guarda el artículo");
});

test("SAT: el técnico descarta un parte sin enviar (duplicado); no el de otro ni uno enviado", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), tec2 = await e.entrar("tecnico2@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const llamar = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); return {status: r.status, datos: x ? JSON.parse(x) : null};
  };
  const rpc = async (tok, fn, args) => { const r = await llamar(tok, fn, args); assert.equal(r.status, 200, fn + ": " + JSON.stringify(r.datos)); return r.datos; };
  const cli = (await rpc(tec, "sat_catalogo", {})).clientes[0];
  // El técnico crea él mismo el aviso dos veces (como en el primer parte real) y su parte.
  const aviso = {id: uuid(), motivo: "Intervención", prioridad: "NORMAL", cliente_id: cli.id, cliente_texto: cli.nombre};
  await rpc(tec, "sat_aviso_guardar", {p: aviso});
  const contenido = {tipo_visita: null, fecha: "2026-11-23", cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, modo: "RAPIDO", materiales: [], fotos: []};
  const parteId = uuid();
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  assert.equal((await llamar(tec2, "sat_parte_descartar", {p_id: parteId})).status, 403, "otro técnico no puede");
  const r = await rpc(tec, "sat_parte_descartar", {p_id: parteId});
  assert.deepEqual([r.descartado, r.aviso_estado], [true, "ANULADO"], "el aviso que creó el técnico, sin partes, queda anulado");
  assert.equal((await rpc(tec, "sat_parte_descartar", {p_id: parteId})).ya_no_existia, true, "repetirlo no falla (cola del teléfono)");
  assert.equal((await rpc(adm, "sat_partes_listar", {p_estado: null})).some((p) => p.id === parteId), false);
  // Un aviso de la oficina vuelve a ASIGNADO al descartar su único parte.
  const avisoOf = (await rpc(tec, "sat_avisos_listar", {})).find((a) => a.origen === "ADMINISTRACION" && a.tecnico_id);
  const p2 = uuid();
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: p2, aviso_id: avisoOf.id, contenido: {...contenido, cliente: {id: avisoOf.cliente_id, nombre: avisoOf.cliente_texto}}}});
  assert.equal((await rpc(tec, "sat_parte_descartar", {p_id: p2})).aviso_estado, "ASIGNADO");
});

test("SAT: material del proveedor SIN código (una tasa) → referencia propia SR- y se da de alta una vez; margen por línea", {timeout: 120000}, async (t) => {
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)})).json();
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  const aviso = (await rpc(tec, "sat_avisos_listar", {}))[0];
  const cli = (await rpc(tec, "sat_catalogo", {})).clientes.find((c) => c.id === aviso.cliente_id);
  const origen = {tipo: "ALBARAN_PROVEEDOR", proveedor: "Proveedor Ficticio", numero: "A-9", linea: 2};
  const contenido = {tipo_visita: "REPARACION_FINALIZADA", fecha: "2026-11-24", hora_inicio: "08:00", hora_fin: "09:00", modo: "RAPIDO",
    cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, direccion: {texto: "x"}, trabajos: "Recarga", fotos: [], tiempo_trabajo_min: 60, desplazamiento_min: 0,
    materiales: [{id: "t1", descripcion: "TASA FICTICIA", referencia: "", cantidad: 2, unidad: "ud", dudas: [], comprobado: "TECNICO", origen, precio_papel: 3, precio_neto: 3}]};
  const parteId = uuid(), fid = uuid(), pid = uuid(), pdf = Buffer.from("%PDF parte");
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
  await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
  const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "CLIENTE", ausente_motivo: "No había nadie responsable en el local"}});
  await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
  await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
  await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
  let r = await fn(tec, {accion: "procesar", parte_id: parteId});
  const alb = r.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO");
  assert.equal(alb.estado, "OK", JSON.stringify(r));
  const altas = e.stel.datos.products.filter((x) => x.name === "TASA FICTICIA");
  assert.equal(altas.length, 1);
  assert.match(altas[0].reference, /^SR-[0-9A-F]{8}$/);
  assert.deepEqual([altas[0]["purchase-price"], altas[0]["sales-price"]], [3, 3.9]);
  assert.deepEqual(e.stel.datos.workDeliveryNotes.at(-1).lines[0]["item-base-price"], 3.9, "coste + 30 %");
  // Otra vez la misma tasa: se encuentra por su referencia propia, no se duplica.
  await rpc(adm, "sat_stel_reintentar", {p_op: (await rpc(adm, "sat_parte_detalle", {p_id: parteId})).operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO").id});
  await fn(adm, {accion: "procesar", parte_id: parteId});
  assert.equal(e.stel.datos.products.filter((x) => x.name === "TASA FICTICIA").length, 1);
  // La oficina pone un margen propio a esa línea (50 %): «Precios de materiales» lo respeta.
  const rev = (await rpc(adm, "sat_parte_detalle", {p_id: parteId})).revision || [];
  const lineas = [{tipo: "MATERIAL", material_id: "t1", stel_item_id: altas[0].id, descripcion: "TASA FICTICIA", cantidad: 2, precio: 4.5, descuento_pct: 0, iva_pct: 21,
    coste: 3, margen_pct: 50, margen_manual: true}, ...rev.filter((l) => l.material_id !== "t1")];
  await rpc(adm, "sat_revision_guardar", {p_id: parteId, p_lineas: lineas, p_nota: null});
  const rc = await fn(adm, {accion: "recalcular_materiales", parte_id: parteId});
  assert.equal(rc.ok, true, JSON.stringify(rc));
  assert.deepEqual(rc.recalculado.materiales.map((m) => m.precio), [4.5], "margen de la línea (50 %), no el de Ajustes");
  assert.equal(e.stel.datos.workDeliveryNotes.at(-1).lines[0]["item-base-price"], 4.5);
});

test("SAT: el albarán de trabajo se crea con TODO lo del parte (lo dudoso, lo dictado, sin precio) y deja la lista para la oficina", {timeout: 120000}, async (t) => {
  // Usuario, 2026-11-24: «que cuando lo envíe se cree el albarán de trabajo y ya Dani en la oficina lo revise y actualice todo (pero que
  // el lector de albarán trate de ponerlo todo); si sale mal ya Dani lo arregla». Datos inventados.
  const e = await crearEmulador({demo: true});
  t.after(() => e.cerrar());
  const tec = await e.entrar("tecnico@prueba.local"), adm = await e.entrar("admin@prueba.local");
  const rpc = async (tok, fn, args) => {
    const r = await fetch(`${e.origen}/rest/v1/rpc/${fn}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json"}, body: JSON.stringify(args)});
    const x = await r.text(); assert.equal(r.status, 200, fn + ": " + x); return x ? JSON.parse(x) : null;
  };
  const fn = async (tok, cuerpo) => (await fetch(`${e.origen}/functions/v1/sat-stel`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: e.origen}, body: JSON.stringify(cuerpo)})).json();
  const subir = (tok, ruta, b, tipo) => fetch(`${e.origen}/storage/v1/object/sat-archivos/${ruta}`, {method: "POST", headers: {Authorization: "Bearer " + tok, "Content-Type": tipo}, body: b});
  const aviso = (await rpc(tec, "sat_avisos_listar", {}))[0];
  const cli = (await rpc(tec, "sat_catalogo", {})).clientes.find((c) => c.id === aviso.cliente_id);
  const ter = e.stel.datos.products.find((x) => x.reference === "TER-01"), tubo = e.stel.datos.products.find((x) => x.reference === "TUB-16");
  // Como en producción desde el 2026-11-24: sin margen (el porcentaje lo pone la oficina a mano en STEL).
  await rpc(adm, "sat_ajuste_guardar", {p_clave: "margen_materiales_pct", p_valor: 0});
  const origen = (linea) => ({tipo: "ALBARAN_PROVEEDOR", proveedor: "Proveedor Ficticio", numero: "A-7", linea});
  const duda = ["Albarán leído con dudas en conjunto: compara esta línea con el papel"];
  const contenido = {tipo_visita: "REPARACION_FINALIZADA", fecha: "2026-11-24", hora_inicio: "08:00", hora_fin: "10:00", modo: "RAPIDO",
    cliente: {id: cli.id, stel_id: cli.stel_id, nombre: cli.nombre}, direccion: {texto: "x"}, trabajos: "Recarga y cambio de piezas", fotos: [],
    tiempo_trabajo_min: 90, desplazamiento_min: 30, materiales: [
      // Leído con dudas y que no está en STEL: se da de alta igual, marcado «ALTA SIN COMPROBAR»; sin precio en el papel.
      {id: "d1", descripcion: "VALVULA FICTICIA 3/4", referencia: "9990000071", cantidad: 2, unidad: "ud", dudas: duda, origen: origen(1)},
      // Leído con dudas con un código que en STEL es de OTRO artículo (una cifra mal leída): genérico, para la oficina.
      {id: "d2", descripcion: "MANGUITO ELECTRICO FICTICIO", referencia: "TER-01", cantidad: 1, unidad: "ud", dudas: duda, origen: origen(2), precio_neto_estimado: 4},
      // Leído con dudas con un código de STEL cuyo nombre se parece: ese artículo.
      {id: "d3", descripcion: "TUBO MULTICAPA 16 MM METRO", referencia: "TUB-16", cantidad: 5, unidad: "m", dudas: duda, origen: origen(3), precio_neto: 1.2},
      // Dictado: genérico.
      {id: "dictado-1", descripcion: "Cinta de teflón", referencia: "", cantidad: 1, unidad: "ud", dudas: [], origen: "DICTADO"}]};
  const parteId = uuid(), fid = uuid(), pid = uuid(), pdf = Buffer.from("%PDF parte");
  await rpc(tec, "sat_parte_guardar", {p_parte: {id: parteId, aviso_id: aviso.id, contenido}});
  await subir(tec, `${parteId}/f-${fid}.png`, Buffer.from("png"), "image/png");
  await rpc(tec, "sat_archivo_registrar", {p: {id: fid, parte_id: parteId, tipo: "FIRMA", storage_path: `${parteId}/f-${fid}.png`}});
  const b = {parte_id: parteId, texto_alcance: "A", firmado_en: new Date().toISOString(), contenido};
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "TECNICO", imagen_path: `${parteId}/f-${fid}.png`}});
  await rpc(tec, "sat_firma_registrar", {p: {...b, id: uuid(), rol: "CLIENTE", ausente_motivo: "No había nadie responsable en el local"}});
  await subir(tec, `${parteId}/p-${pid}.pdf`, pdf, "application/pdf");
  await rpc(tec, "sat_archivo_registrar", {p: {id: pid, parte_id: parteId, tipo: "PDF_PARTE", storage_path: `${parteId}/p-${pid}.pdf`, sha256: sha(pdf)}});
  await rpc(tec, "sat_parte_enviar", {p_id: parteId, p_pdf_path: `${parteId}/p-${pid}.pdf`, p_pdf_sha256: sha(pdf)});
  const r = await fn(tec, {accion: "procesar", parte_id: parteId});
  const alb = r.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO");
  assert.equal(alb.estado, "OK", JSON.stringify(r));
  const nueva = e.stel.datos.products.filter((x) => x.reference === "9990000071");
  const generico = e.stel.datos.products.filter((x) => x.reference === "SAT-POR-IDENTIFICAR");
  assert.equal(nueva.length, 1);
  assert.match(nueva[0]["private-comments"], /^ALTA SIN COMPROBAR/);
  assert.equal(generico.length, 1);
  assert.deepEqual(alb.detalle.articulos, {d1: nueva[0].id, d2: generico[0].id, d3: tubo.id, "dictado-1": generico[0].id});
  const wdn = e.stel.datos.workDeliveryNotes.at(-1);
  assert.deepEqual(wdn.lines.slice(0, 4).map((l) => [l["item-id"], l.units, l["item-base-price"]]),
    [[nueva[0].id, 2, 0], [generico[0].id, 1, 4], [tubo.id, 5, 1.2], [generico[0].id, 1, 0]], "a su coste; sin precio, el que ponga STEL (aquí 0)");
  const notas = wdn["private-comments"];
  for (const re of [/LEÍDO CON DUDAS \(comprobar con la foto del albarán del proveedor\): VALVULA FICTICIA 3\/4, MANGUITO ELECTRICO FICTICIO, TUBO MULTICAPA 16 MM METRO/,
    /POR IDENTIFICAR \(poner el artículo\): MANGUITO ELECTRICO FICTICIO \(la referencia TER-01 es de «Termostato digital» en STEL\), Cinta de teflón \(dictado\)/,
    /ARTÍCULOS DADOS DE ALTA SIN COMPROBAR: 9990000071 «VALVULA FICTICIA 3\/4»/, /SIN PRECIO: VALVULA FICTICIA 3\/4, Cinta de teflón/]) assert.match(notas, re);
  assert.ok(!/TER-01/.test(JSON.stringify(wdn.lines.map((l) => l["item-id"]))) && !wdn.lines.some((l) => l["item-id"] === ter.id), "nunca el artículo de otro código");
  // La oficina propone la revisión con los artículos con los que se creó el albarán (no le salen vacíos).
  const {proponerLineas, articulosDelAlbaran} = await import("../sat/lib/economia.js");
  const det = await rpc(adm, "sat_parte_detalle", {p_id: parteId});
  const prop = proponerLineas(det.contenido, [], {}, articulosDelAlbaran(det));
  assert.deepEqual(prop.filter((l) => l.tipo === "MATERIAL").map((l) => [l.material_id, l.stel_item_id]),
    [["d1", nueva[0].id], ["d2", generico[0].id], ["d3", tubo.id], ["dictado-1", generico[0].id]]);
  // Reintentar no duplica ni el artículo dado de alta ni el genérico.
  await rpc(adm, "sat_stel_reintentar", {p_op: det.operaciones.find((o) => o.tipo === "ALBARAN_TRABAJO").id});
  await fn(adm, {accion: "procesar", parte_id: parteId});
  assert.equal(e.stel.datos.products.filter((x) => ["9990000071", "SAT-POR-IDENTIFICAR"].includes(x.reference)).length, 2);
});
