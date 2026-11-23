// DAFRICA SAT · parte rápido (2026-11-18): lo que se firma sale del audio y del albarán del proveedor sin inventar nada,
// las horas las elige el técnico y STEL recibe mano de obra y desplazamiento en horas.
import test from "node:test";
import assert from "node:assert/strict";
import {organizarDictado, frases} from "../sat/lib/dictado.js";
import {contenidoNuevo, contenidoRapido, problemasParaFirmar, horasTexto, minutosDeHoras, iguales} from "../sat/lib/contenido.js";
import {lineasAlbaran} from "../supabase/functions/sat-stel/handler.mjs";
import {proponerLineas} from "../sat/lib/economia.js";

let n = 0;
const nuevoId = () => `id-${++n}`;
const base = () => ({...contenidoNuevo({cliente_texto: "Cliente Ficticio", direccion_texto: "Calle Falsa 1, Pueblo", motivo: "Intervención"}), modo: "RAPIDO"});
const DICHO = "La caldera no arrancaba. He cambiado el termostato. He usado dos metros de tubo multicapa. He revisado la presión y está bien. Queda pendiente pintar la pared.";

test("parte rápido: cada frase del audio va entera al parte; materiales solo con cantidad dicha o leída", () => {
  const albaran = [
    {id: "alb-1", descripcion: "TERMOSTATO DIGITAL", referencia: "TER-01", cantidad: 1, unidad: "ud", stel_item_id: 7, dudas: []},
    {id: "alb-2", descripcion: "CODO 16", referencia: "CD16", cantidad: 3, unidad: "ud", stel_item_id: null, dudas: ["Referencia leída con dudas"]},
    {id: "alb-3", descripcion: "TUBO", referencia: "", cantidad: null, unidad: "m", dudas: ["Cantidad ilegible"]}];
  const c = contenidoRapido(base(), {textos: [DICHO, ""], organizar: organizarDictado, materialesAlbaran: albaran, horaFin: "11:30", nuevoId});
  const texto = [c.averia, c.trabajos, c.pendientes].join("\n");
  // Cada frase está en el texto o, si es de material, en la lista de materiales con lo dicho (nada se pierde).
  for (const f of frases(DICHO)) assert.ok(texto.includes(f) || c.materiales.some((m) => m.dicho && f.includes(m.dicho)), `la frase «${f}» debe estar en el parte`);
  assert.equal(c.modo, "RAPIDO");
  assert.equal(c.tipo_visita, "PENDIENTE", "si se dice que queda algo pendiente, se propone pendiente");
  assert.deepEqual(c.comprobaciones, [], "en el parte rápido no hay resultados que rellenar");
  // Albarán: solo lo leído sin dudas; el dudoso y el de cantidad ilegible NO entran en lo firmado (nunca se inventa).
  assert.deepEqual(c.materiales.filter((m) => m.origen === "ALBARAN_PROVEEDOR").map((m) => [m.id, m.cantidad, m.dudas.length]), [["alb-1", 1, 0]]);
  // Dictado: «dos metros de tubo» sí; «he cambiado el termostato» (sin cantidad) no se convierte en material.
  const dictados = c.materiales.filter((m) => m.origen === "DICTADO");
  assert.deepEqual(dictados.map((m) => [m.id, m.cantidad, m.unidad]), [["dictado-1", 2, "m"]]);
  assert.equal(c.hora_fin, "11:30");
  assert.equal(c.tiempo_trabajo_min, null, "las horas las elige el técnico: no se calculan solas");
  // Preparar dos veces lo mismo da el mismo parte (no invalida firmas).
  const otra = contenidoRapido(c, {textos: [DICHO], organizar: organizarDictado, materialesAlbaran: albaran, horaFin: "11:30", nuevoId});
  assert.ok(iguales(c, otra));
});

test("parte rápido: para firmar hacen falta texto, cómo queda y las horas; lo dudoso no bloquea (lo confirma la oficina)", () => {
  const vacio = problemasParaFirmar({...base(), hora_fin: "10:00"});
  assert.ok(vacio.some((p) => /audio/.test(p)));
  assert.ok(vacio.some((p) => /terminado o pendiente/.test(p)));
  assert.ok(vacio.some((p) => /horas de trabajo/.test(p)));
  assert.ok(vacio.some((p) => /desplazamiento/.test(p)));
  const c = contenidoRapido(base(), {textos: ["He cambiado el termostato."], organizar: organizarDictado, horaFin: "10:00",
    materialesAlbaran: [{id: "a", descripcion: "CODO", cantidad: 2, unidad: "ud", dudas: ["dudoso"]}], nuevoId});
  assert.deepEqual(c.materiales, [], "lo dudoso del albarán del proveedor no entra en lo firmado");
  // Confirmado por el técnico: entra con sus precios (comprobado, estimado y lo leído) para la oficina.
  const conf = contenidoRapido(base(), {textos: ["He cambiado el codo."], organizar: organizarDictado, horaFin: "10:00", nuevoId,
    materialesAlbaran: [{id: "a", descripcion: "CODO", cantidad: 2, unidad: "ud", dudas: ["dudoso"], confirmado: true, precio_leido: 3, dto_leido: 20, precio_neto_estimado: 2.4, neto_estimado_como: "precio del papel − 20 %"}]});
  assert.deepEqual([conf.materiales[0].precio_neto_estimado, conf.materiales[0].neto_estimado_como, conf.materiales[0].precio_leido, conf.materiales[0].comprobado], [2.4, "precio del papel − 20 %", 3, "TECNICO"]);
  c.materiales = [{id: "d", descripcion: "TERMOSTATO", referencia: "TER 01", cantidad: 1, unidad: "ud", dudas: ["Referencia dictada"], origen: "DICTADO"}];
  Object.assign(c, {tipo_visita: "REPARACION_FINALIZADA", tiempo_trabajo_min: 90, desplazamiento_min: 0});
  assert.deepEqual(problemasParaFirmar(c), [], "material dictado con la referencia a confirmar, sin desplazamiento: se puede firmar");
  assert.ok(problemasParaFirmar({...c, modo: undefined}).some((p) => /confirma lo dudoso/.test(p)), "en el modo detallado lo dudoso sí bloquea");
});

test("horas: texto y lectura; STEL y la revisión en horas", () => {
  assert.equal(horasTexto(90), "1,5 h");
  assert.equal(horasTexto(0), "");
  assert.equal(minutosDeHoras("2,5"), 150);
  assert.equal(minutosDeHoras("0.25 h"), 15);
  assert.equal(minutosDeHoras("abc"), null);
  assert.equal(minutosDeHoras("30"), null, "más de 24 h no es un parte de un día");
  const ajustes = {stel_servicio_mano_obra_id: 9, stel_servicio_desplazamiento_id: 8, precio_hora_mano_obra: 50, precio_hora_desplazamiento: 50};
  const {lineas, faltan} = lineasAlbaran({materiales: [], tiempo_trabajo_min: 90, desplazamiento_min: 30, desplazamiento_km: 12}, [], ajustes);
  assert.deepEqual(faltan, []);
  assert.deepEqual(lineas.map((l) => [l["item-id"], l.units, l["item-description"]]),
    [[9, 1.5, "Mano de obra: 1,5 h"], [8, 0.5, "Desplazamiento: 0,5 h, 12 km"]]);
  const sinDesp = lineasAlbaran({materiales: [], tiempo_trabajo_min: 60, desplazamiento_min: 0}, [], ajustes);
  assert.equal(sinDesp.lineas.length, 1, "«sin desplazamiento» no crea línea");
  const rev = proponerLineas({tiempo_trabajo_min: 90, desplazamiento_min: 30}, [{stel_id: 9, precio: 35}, {stel_id: 8, precio: 25}], ajustes);
  assert.deepEqual(rev.map((l) => [l.cantidad, l.precio]), [[1.5, 50], [0.5, 50]]);
});

test("sat-stel: con la clave de servicio, también en apikey (la puerta de Supabase daba 401 al actualizar el catálogo)", async () => {
  const {handler} = await import("../supabase/functions/sat-stel/handler.mjs");
  const env = (k) => ({SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srv", SUPABASE_ANON_KEY: "anon", STEL_API_KEY: "stel"})[k];
  const fetcher = async (url, init) => {
    const u = String(url), h = init.headers || {};
    if (u.includes("/rest/v1/rpc/")) {
      const fn = u.split("/rpc/")[1];
      if (fn === "sat_puede_procesar") return new Response(h.apikey === "anon" && h.Authorization === "Bearer usuario" ? "true" : "{}", {status: h.apikey === "anon" ? 200 : 401});
      if (h.apikey !== "srv" || h.Authorization !== "Bearer srv") return new Response(JSON.stringify({message: "Invalid JWT"}), {status: 401});
      return new Response(fn === "sat_ajuste" ? "250" : "0", {status: 200});
    }
    if (u.startsWith("https://app.stelorder.com/")) return new Response("[]", {status: 200});
    throw new Error("URL inesperada " + u);
  };
  const req = new Request("https://x.supabase.co/functions/v1/sat-stel", {method: "POST", headers: {authorization: "Bearer usuario", "content-type": "application/json"},
    body: JSON.stringify({accion: "catalogo"})});
  const r = await handler(req, {env, fetcher, dormir: async () => {}});
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.ok, true);
});

test("dictado en impersonal («se hace», «se arregla», «se instalan»): trabajos, no avería; sin inventar materiales", () => {
  const dicho = "El equipo pierde agua. Se hace un desagüe nuevo y doble, el circuito no funcionaba, se arregla la fuga, se ajustan las presiones y se instalan llaves y manómetros nuevos. Se ha revisado el compresor y está bien.";
  const r = organizarDictado(dicho);
  assert.deepEqual(r.averia, ["El equipo pierde agua."]);
  assert.equal(r.trabajos.length, 1);
  assert.match(r.trabajos[0], /^Se hace un desagüe/);
  assert.equal(r.comprobaciones.length, 1);
  assert.equal(r.comprobaciones[0].resultado, "CORRECTO");
  assert.deepEqual(r.materiales, [], "«llaves y manómetros» sin cantidad no se convierten en materiales");
});

test("albarán del proveedor: lo dudoso entra solo si el técnico lo ha comparado con el papel", () => {
  const albaran = [
    {id: "a1", descripcion: "CODO FICTICIO 25", referencia: "9990000001", cantidad: 3, unidad: "ud", dudas: ["Albarán leído con dudas en conjunto"]},
    {id: "a2", descripcion: "TE FICTICIA 25", referencia: "9990000002", cantidad: 1, unidad: "ud", dudas: ["Albarán leído con dudas en conjunto"], confirmado: true, stel_item_id: 77}];
  const c = contenidoRapido(base(), {textos: ["He cambiado el codo."], organizar: organizarDictado, materialesAlbaran: albaran, horaFin: "10:00", nuevoId});
  const alb = c.materiales.filter((m) => m.origen === "ALBARAN_PROVEEDOR");
  assert.deepEqual(alb.map((m) => [m.id, m.cantidad, m.dudas.length, m.comprobado, m.stel_item_id]), [["a2", 1, 0, "TECNICO", 77]]);
});

test("precios del albarán del proveedor: PRECIO si se leyó con seguridad; neto solo si la línea cuadra con su importe", async () => {
  const {preciosDeLinea, descuentoTexto, camposDePrecio} = await import("../sat/lib/materiales-albaran.js");
  const c = (valor, confianza = 0.95) => ({valor, confianza});
  // Datos ficticios. 3 × 10,00 con 45 % + 5 % (= 47,75 %) = 15,68 → cuadra.
  assert.deepEqual(preciosDeLinea({precio: c(10), descuento: c(47.75), importe: c(15.68)}, 3), {precio_leido: 10, dto_leido: 47.75, precio_papel: 10, precio_neto: 5.225});
  // Descuento mal leído (6 en vez de 62): no cuadra → sin neto comprobado, pero se ESTIMA (usuario, 2026-11-23: «que intente
  // rellenar») con el importe ÷ cantidad, que ya lleva el descuento; la oficina lo ve «sin comprobar».
  assert.deepEqual(preciosDeLinea({precio: c(2), descuento: c(6, 0.6), importe: c(0.76)}, 1),
    {precio_leido: 2, dto_leido: 6, precio_papel: 2, precio_neto_estimado: 0.76, neto_estimado_como: "importe ÷ cantidad del papel"});
  // Precio con dudas: nunca comprobado; estimado con el importe.
  assert.deepEqual(preciosDeLinea({precio: c(8, 0.6), importe: c(4.18)}, 1), {precio_leido: 8, precio_neto_estimado: 4.18, neto_estimado_como: "importe ÷ cantidad del papel"});
  // Sin importe: precio menos el descuento leído.
  assert.deepEqual(preciosDeLinea({precio: c(10, 0.5), descuento: c(20, 0.5)}, 2), {precio_leido: 10, dto_leido: 20, precio_neto_estimado: 8, neto_estimado_como: "precio del papel − 20 %"});
  // Importe por encima del precio × cantidad (cantidad o importe mal leídos): no se usa; precio menos descuento.
  assert.equal(preciosDeLinea({precio: c(5, 0.5), importe: c(50, 0.5)}, 2).precio_neto_estimado, 5);
  // Sin descuento y cuadra: el neto es el precio.
  assert.deepEqual(preciosDeLinea({precio: c(2.5), importe: c(7.5)}, 3), {precio_leido: 2.5, precio_papel: 2.5, precio_neto: 2.5});
  // Descuento en cascada «60+10» (el lector da el equivalente, 64 %): 2 × 10 × 0,36 = 7,20 → neto 3,60.
  assert.deepEqual(preciosDeLinea({precio: c(10), descuento: c(64), importe: c(7.2)}, 2), {precio_leido: 10, dto_leido: 64, precio_papel: 10, precio_neto: 3.6});
  // Descuento escrito por el técnico.
  assert.deepEqual(["", "62", "62,5", "60+10", "60 10", "60 + 10%", "abc", "100"].map(descuentoTexto), [0, 62, 62.5, 64, 64, 64, null, null]);
  assert.deepEqual(camposDePrecio({precio_neto: 3.6, precio_comprobado: "TECNICO", precio_neto_estimado: 0, otro: 1}), {precio_neto: 3.6, precio_comprobado: "TECNICO"});
});

test("sat-stel: solo da de alta lo leído del albarán del proveedor y comprobado; referencias con el prefijo del proveedor", async () => {
  const {materialDelProveedor, mismaReferencia} = await import("../supabase/functions/sat-stel/handler.mjs");
  const o = {tipo: "ALBARAN_PROVEEDOR"};
  assert.ok(materialDelProveedor({origen: o, referencia: "9990000002", descripcion: "TE FICTICIA", dudas: []}));
  assert.ok(materialDelProveedor({origen: o, referencia: "9990000002", descripcion: "TE FICTICIA", dudas: ["x"], comprobado: "TECNICO"}));
  assert.ok(!materialDelProveedor({origen: o, referencia: "9990000002", descripcion: "TE FICTICIA", dudas: ["x"]}), "dudoso sin comprobar, no");
  assert.ok(!materialDelProveedor({origen: "DICTADO", referencia: "TER 01", descripcion: "Termostato", dudas: []}), "lo dictado, no");
  assert.ok(!materialDelProveedor({origen: o, referencia: "", descripcion: "Sin referencia", dudas: []}), "sin referencia, no");
  assert.ok(mismaReferencia("H8953- 1255087035", "1255087035"));
  assert.ok(mismaReferencia("1255087035", "1255087035"));
  assert.ok(!mismaReferencia("H89531255087035", "1255087035"), "sin separador no se parte");
  assert.ok(!mismaReferencia("1255087036", "1255087035"));
});
