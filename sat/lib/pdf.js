// DAFRICA SAT · PDF del parte firmado (pdf-lib, en el propio teléfono: funciona sin conexión).
// Lleva identificación del parte, datos de la intervención, trabajos, materiales (sin importes), fotos y firmas,
// el texto del alcance de la firma y la huella SHA-256 del contenido firmado.
import {resumenTipo, RESULTADOS, MOMENTOS, PRIORIDADES, canonico, normalizar, horasTexto} from "./contenido.js";
import {sha256} from "./almacen.js";

const A4 = [595.28, 841.89], M = 42, AZUL = [0.04, 0.16, 0.35], GRIS = [0.38, 0.42, 0.48], LINEA = [0.82, 0.85, 0.9];

// Helvetica estándar (WinAnsi): se sustituyen los signos que no puede escribir.
function texto(s) {
  return String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/→/g, "->").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ€…·]/g, "?");
}

export async function huellaContenido(contenido) {
  return sha256(new TextEncoder().encode(canonico(normalizar(contenido))));
}

/**
 * @param {object} d {codigo, aviso:{codigo,motivo,prioridad}, contenido, tecnico, alcance, huella,
 *   firmas:[{rol,nombre,cargo,ausente_motivo,firmado_en,png?:Uint8Array}], fotos:[{jpg:Uint8Array,momento,comentario}], logo?:Uint8Array}
 * @returns {Promise<Uint8Array>}
 */
export async function generarPdfParte(d) {
  const {PDFDocument, StandardFonts, rgb} = window.PDFLib;
  const pdf = await PDFDocument.create();
  pdf.setTitle(texto(`Parte ${d.codigo || ""}`)); pdf.setAuthor("DAFRICA"); pdf.setCreator("DAFRICA SAT");
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const color = (c) => rgb(...c);
  let pag, y;
  const paginas = [];
  const nueva = () => { pag = pdf.addPage(A4); paginas.push(pag); y = A4[1] - M; };
  const espacio = (h) => { if (y - h < M + 30) nueva(); };
  const lineas = (s, fuente, tam, ancho) => {
    const out = [];
    for (const parrafo of texto(s).split(/\n/)) {
      let actual = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = actual ? actual + " " + palabra : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) <= ancho) actual = prueba;
        else { if (actual) out.push(actual); actual = palabra; while (fuente.widthOfTextAtSize(actual, tam) > ancho) { out.push(actual.slice(0, 60)); actual = actual.slice(60); } }
      }
      out.push(actual);
    }
    return out;
  };
  const escribir = (s, {tam = 10, fuente = f, x = M, ancho = A4[0] - 2 * M, col = [0, 0, 0], inter = 1.35} = {}) => {
    for (const l of lineas(s, fuente, tam, ancho)) { espacio(tam * inter); pag.drawText(l, {x, y: y - tam, size: tam, font: fuente, color: color(col)}); y -= tam * inter; }
  };
  const titulo = (s) => {
    espacio(30); y -= 8;
    pag.drawText(texto(s.toUpperCase()), {x: M, y: y - 11, size: 10.5, font: fb, color: color(AZUL)});
    y -= 15; pag.drawLine({start: {x: M, y}, end: {x: A4[0] - M, y}, thickness: 0.8, color: color(LINEA)}); y -= 6;
  };
  const campo = (etiqueta, valor) => {
    if (valor === null || valor === undefined || valor === "") return;
    const ancho = A4[0] - 2 * M - 120;
    const ls = lineas(valor, f, 10, ancho);
    espacio(13 * ls.length);
    pag.drawText(texto(etiqueta), {x: M, y: y - 10, size: 9, font: fb, color: color(GRIS)});
    ls.forEach((l, i) => pag.drawText(l, {x: M + 120, y: y - 10 - i * 13, size: 10, font: f}));
    y -= 13 * ls.length + 2;
  };

  nueva();
  // Cabecera
  if (d.logo) {
    try { const img = await pdf.embedPng(d.logo); const k = 34 / img.height; pag.drawImage(img, {x: M, y: y - 34, width: img.width * k, height: 34}); }
    catch { /* sin logo */ }
  }
  pag.drawText("PARTE DE TRABAJO", {x: A4[0] - M - fb.widthOfTextAtSize("PARTE DE TRABAJO", 16), y: y - 16, size: 16, font: fb, color: color(AZUL)});
  const ultimaFirma = d.firmas.map((x) => x.firmado_en).filter(Boolean).sort().at(-1);
  const fechaFirma = ultimaFirma ? new Date(ultimaFirma).toLocaleString("es-ES", {timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short"}) : "";
  const id = texto(`${d.codigo || "(sin código todavía)"}${fechaFirma ? " · firmado el " + fechaFirma : ""}`);
  pag.drawText(id, {x: A4[0] - M - f.widthOfTextAtSize(id, 10), y: y - 32, size: 10, font: f, color: color(GRIS)});
  y -= 48;
  const c = d.contenido;

  titulo("Intervención");
  campo("Aviso", d.aviso ? `${d.aviso.codigo || ""} · ${d.aviso.motivo || c.motivo || ""}` : c.motivo);
  campo("Prioridad", PRIORIDADES[c.prioridad] || c.prioridad);
  campo("Cliente", c.cliente?.nombre);
  campo("Dirección", c.direccion?.texto);
  campo("Contacto", [c.contacto?.nombre, c.contacto?.telefono].filter(Boolean).join(" · "));
  campo("Instalación / equipo", [c.equipo?.nombre, c.equipo?.numero_serie ? `n.º serie ${c.equipo.numero_serie}` : ""].filter(Boolean).join(" · "));
  campo("Tipo de visita", resumenTipo(c));
  campo("Fecha y horas", `${c.fecha ? c.fecha.split("-").reverse().join("/") : ""}  ·  de ${c.hora_inicio || "?"} a ${c.hora_fin || "?"}`);
  campo("Horas de trabajo", horasTexto(c.tiempo_trabajo_min));
  campo("Desplazamiento", c.desplazamiento_min === 0 ? "Sin desplazamiento" : [horasTexto(c.desplazamiento_min), c.desplazamiento_km ? `${c.desplazamiento_km} km` : ""].filter(Boolean).join(" · "));
  campo("Técnico", d.tecnico);

  if ((c.comprobaciones || []).length) {
    titulo("Comprobaciones realizadas");
    for (const x of c.comprobaciones) {
      const r = RESULTADOS[x.resultado] || "-";
      const ancho = A4[0] - 2 * M - 90;
      const ls = lineas(x.texto, f, 10, ancho);
      espacio(13 * ls.length + 2);
      ls.forEach((l, i) => pag.drawText(l, {x: M, y: y - 10 - i * 13, size: 10, font: f}));
      pag.drawText(texto(r), {x: A4[0] - M - 80, y: y - 10, size: 10, font: fb, color: color(x.resultado === "INCORRECTO" ? [0.7, 0.1, 0.1] : x.resultado === "CORRECTO" ? [0.1, 0.45, 0.2] : GRIS)});
      y -= 13 * ls.length + 3;
    }
  }
  if (c.averia) { titulo("Avería o problema encontrado"); escribir(c.averia); }
  if (c.trabajos) { titulo("Trabajos realizados"); escribir(c.trabajos); }
  if ((c.materiales || []).length) {
    titulo("Materiales y repuestos");
    const cols = [M, A4[0] - M - 150, A4[0] - M - 70];
    espacio(14);
    pag.drawText("Descripción", {x: cols[0], y: y - 9, size: 8.5, font: fb, color: color(GRIS)});
    pag.drawText("Cantidad", {x: cols[1], y: y - 9, size: 8.5, font: fb, color: color(GRIS)});
    pag.drawText("Unidad", {x: cols[2], y: y - 9, size: 8.5, font: fb, color: color(GRIS)});
    y -= 14;
    for (const m of c.materiales) {
      const desc = [m.descripcion, m.referencia ? `(ref. ${m.referencia})` : "", (m.dudas || []).length ? "[a confirmar por la oficina]" : ""].filter(Boolean).join(" ");
      const ls = lineas(desc, f, 10, cols[1] - cols[0] - 10);
      espacio(13 * ls.length + 2);
      ls.forEach((l, i) => pag.drawText(l, {x: cols[0], y: y - 10 - i * 13, size: 10, font: f}));
      pag.drawText(texto(String(m.cantidad ?? "").replace(".", ",")), {x: cols[1], y: y - 10, size: 10, font: f});
      pag.drawText(texto(m.unidad || ""), {x: cols[2], y: y - 10, size: 10, font: f});
      y -= 13 * ls.length + 3;
    }
    escribir("Sin importes: los precios se presentan por separado.", {tam: 8, col: GRIS});
    if (c.materiales.some((m) => (m.dudas || []).length)) escribir("«A confirmar»: leído del albarán del proveedor o del dictado con alguna duda; la oficina lo comprueba con la foto adjunta.", {tam: 8, col: GRIS});
  }
  if (c.estado_final) { titulo("Estado final de la instalación"); escribir(c.estado_final); }
  if (c.pendientes) { titulo("Trabajos pendientes"); escribir(c.pendientes); }

  if ((d.fotos || []).length) {
    const ancho = (A4[0] - 2 * M - 14) / 2, alto = 170;
    espacio(alto + 70); // el título nunca queda solo al final de una página
    titulo("Fotografías");
    let col = 0;
    for (const foto of d.fotos) {
      let img;
      try { img = await pdf.embedJpg(foto.jpg); } catch { continue; }
      if (col === 0) espacio(alto + 30);
      const k = Math.min(ancho / img.width, alto / img.height), x = M + col * (ancho + 14);
      pag.drawImage(img, {x, y: y - img.height * k, width: img.width * k, height: img.height * k});
      const pie = texto([MOMENTOS[foto.momento] || "", foto.comentario || ""].filter(Boolean).join(": ")).slice(0, 80);
      pag.drawText(pie, {x, y: y - alto - 12, size: 8, font: f, color: color(GRIS)});
      if (col === 1) y -= alto + 24;
      col = 1 - col;
    }
    if (col === 1) y -= alto + 24;
  }

  titulo("Conformidad");
  escribir(d.alcance, {tam: 9, col: [0.15, 0.15, 0.15]});
  y -= 6;
  espacio(150);
  const anchoF = (A4[0] - 2 * M - 20) / 2;
  const fecha = (iso) => { const t = new Date(iso); return isNaN(t) ? "" : t.toLocaleString("es-ES", {timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short"}); };
  const yBase = y;
  for (const [i, rol] of ["TECNICO", "CLIENTE"].entries()) {
    const fi = d.firmas.find((x) => x.rol === rol);
    const x = M + i * (anchoF + 20);
    y = yBase;
    pag.drawRectangle({x, y: y - 140, width: anchoF, height: 140, borderColor: color(LINEA), borderWidth: 0.8});
    pag.drawText(rol === "TECNICO" ? "Técnico" : texto("Responsable del cliente"), {x: x + 8, y: y - 14, size: 9, font: fb, color: color(AZUL)});
    if (fi?.png) {
      try { const img = await pdf.embedPng(fi.png); const k = Math.min((anchoF - 16) / img.width, 70 / img.height);
        pag.drawImage(img, {x: x + 8, y: y - 22 - img.height * k, width: img.width * k, height: img.height * k}); } catch { /* nada */ }
    } else if (fi?.ausente_motivo) {
      lineas("SIN FIRMA: " + fi.ausente_motivo, fb, 9, anchoF - 16).slice(0, 5).forEach((l, j) =>
        pag.drawText(l, {x: x + 8, y: y - 34 - j * 12, size: 9, font: fb, color: color([0.7, 0.1, 0.1])}));
    }
    const pie = [fi?.nombre, fi?.cargo].filter(Boolean).join(" · ");
    pag.drawText(texto(pie).slice(0, 60), {x: x + 8, y: y - 112, size: 9, font: f});
    pag.drawText(texto(fi ? "Fecha: " + fecha(fi.firmado_en) : ""), {x: x + 8, y: y - 126, size: 8.5, font: f, color: color(GRIS)});
  }
  y = yBase - 150;

  paginas.forEach((p, i) => {
    const pie = texto(`DAFRICA · ${d.codigo || ""} · Huella del contenido firmado (SHA-256): ${d.huella}`);
    p.drawText(pie.slice(0, 140), {x: M, y: 22, size: 6.5, font: f, color: color(GRIS)});
    const n = `${i + 1} / ${paginas.length}`;
    p.drawText(n, {x: A4[0] - M - f.widthOfTextAtSize(n, 8), y: 22, size: 8, font: f, color: color(GRIS)});
  });
  return pdf.save();
}
