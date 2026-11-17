// DAFRICA SAT · organizar el dictado sin inventar, contenido del parte y cálculo de importes.
import test from "node:test";
import assert from "node:assert/strict";
import {organizarDictado, materialesConCantidad, frases} from "../sat/lib/dictado.js";
import {problemasParaFirmar, iguales, minutosEntre, contenidoNuevo} from "../sat/lib/contenido.js";
import {totales, totalLinea, redondear2, proponerLineas, lineasIncompletas} from "../sat/lib/economia.js";
import {materialesDesdeAlbaran, unidadDe} from "../sat/lib/materiales-albaran.js";
import {TRANSCRIPCION_PRUEBA} from "./sat/emulador.mjs";
import {lineasAlbaran, textoAlbaran, fechaStel} from "../supabase/functions/sat-stel/handler.mjs";

test("dictado: cada frase va entera a su sección y nada se pierde", () => {
  const r = organizarDictado(TRANSCRIPCION_PRUEBA);
  const todas = [...r.averia, ...r.comprobaciones.map((c) => c.texto), ...r.trabajos, ...r.pendientes, ...r.otros];
  for (const f of frases(TRANSCRIPCION_PRUEBA)) {
    const enMateriales = r.materiales.some((m) => f.includes(m.dicho) || m.dicho === f);
    assert.ok(todas.includes(f) || enMateriales, "frase perdida: " + f);
  }
  assert.deepEqual(r.averia, ["La caldera no arrancaba y daba error E133."]);
  assert.equal(r.comprobaciones.length, 2);
  assert.equal(r.comprobaciones[0].resultado, "INCORRECTO"); // «estaba baja»
  assert.equal(r.comprobaciones[1].resultado, "INCORRECTO"); // «estaba sucio»
  assert.ok(r.trabajos.some((t) => t.startsWith("He limpiado el electrodo")));
  assert.ok(r.pendientes[0].startsWith("Queda pendiente cambiar la válvula de tres vías"));
});

test("dictado: materiales solo con la cantidad dicha; referencias siempre a comprobar", () => {
  const r = organizarDictado(TRANSCRIPCION_PRUEBA);
  const tubo = r.materiales.find((m) => m.descripcion.startsWith("tubo multicapa"));
  assert.deepEqual([tubo.cantidad, tubo.unidad, tubo.descripcion], [2, "m", "tubo multicapa de 16"]);
  const codos = r.materiales.find((m) => m.descripcion.startsWith("codos"));
  assert.deepEqual([codos.cantidad, codos.unidad], [3, "ud"]);
  const ter = r.materiales.find((m) => m.descripcion.startsWith("termostato digital"));
  assert.equal(ter.cantidad, 1);
  assert.equal(ter.referencia, "TER 01");
  assert.ok(ter.dudas.some((d) => /Referencia dictada/.test(d)));
  // «medio bar» y «un bar y medio» son mediciones, nunca materiales.
  assert.ok(!r.materiales.some((m) => /bar/.test(m.descripcion)));
  // Ningún precio en ningún sitio.
  assert.ok(!JSON.stringify(r).match(/precio|€|euros/i));
});

test("dictado: pieza cambiada sin cantidad → material dudoso, nunca cantidad inventada", () => {
  const r = organizarDictado("He cambiado la bomba de circulación porque hacía ruido.");
  assert.equal(r.materiales.length, 1);
  assert.equal(r.materiales[0].cantidad, null);
  assert.match(r.materiales[0].dudas[0], /No se dijo cantidad/);
  assert.equal(r.materiales[0].descripcion, "bomba de circulación");
});

test("dictado: cantidades vagas y partes inaudibles quedan señaladas", () => {
  const r = organizarDictado("Material: unos cuantos tornillos. He revisado el quemador [inaudible].");
  assert.equal(r.materiales.length, 0);
  assert.ok(r.avisos.some((a) => /Cantidad no concreta/.test(a)));
  assert.ok(r.avisos.some((a) => /Parte dudosa/.test(a)));
  assert.equal(r.comprobaciones[0].resultado, null);
  assert.ok(r.avisos.some((a) => /Indica el resultado/.test(a)));
});

test("dictado: metro y medio, cifras con coma y unidades", () => {
  assert.deepEqual(materialesConCantidad("Material: metro y medio de cable de 2,5").map((m) => [m.cantidad, m.unidad, m.descripcion]), [[1.5, "m", "cable de 2,5"]]);
  assert.deepEqual(materialesConCantidad("He usado 2,5 litros de anticongelante").map((m) => [m.cantidad, m.unidad, m.descripcion]), [[2.5, "l", "anticongelante"]]);
  assert.deepEqual(materialesConCantidad("Material: 4 tacos y dos bridas").map((m) => [m.cantidad, m.descripcion]), [[4, "tacos"], [2, "bridas"]]);
  assert.deepEqual(materialesConCantidad("Material: 3 bar de presión"), []);
});

test("contenido: no se puede firmar con cantidades dudosas, resultados vacíos o sin horas", () => {
  const c = contenidoNuevo({motivo: "x", cliente_texto: "Cliente", direccion_texto: "Calle"}, {});
  c.hora_inicio = "09:00";
  const p = problemasParaFirmar({...c, comprobaciones: [{texto: "Presión", resultado: null}],
    materiales: [{descripcion: "Bomba", cantidad: null, dudas: ["No se dijo cantidad"]}]});
  assert.ok(p.some((x) => /tipo de visita/.test(x)));
  assert.ok(p.some((x) => /hora/.test(x)));
  assert.ok(p.some((x) => /Comprobación 1/.test(x)));
  assert.ok(p.some((x) => /Bomba.*cantidad/.test(x)));
  assert.ok(p.some((x) => /Bomba.*confirma/.test(x)));
  const bien = {...c, tipo_visita: "PENDIENTE", pendiente_de: "REPUESTOS", hora_fin: "10:00", averia: "Fuga", pendientes: "Pedir válvula"};
  assert.deepEqual(problemasParaFirmar(bien), []);
  assert.ok(iguales({a: 1, b: [1, {c: " x "}]}, {b: [1, {c: "x"}], a: 1}));
  assert.ok(!iguales({a: 1}, {a: 2}));
  assert.equal(minutosEntre("23:30", "00:15"), 45);
});

test("importes: igual que sat_total() en Supabase (por línea, a céntimos)", () => {
  assert.equal(redondear2(1.005), 1.01);
  assert.equal(totalLinea({cantidad: 3, precio: 2.5, descuento_pct: 10, iva_pct: 21}), 8.17);
  assert.deepEqual(totales([{cantidad: 1, precio: 40, iva_pct: 21}, {cantidad: 3, precio: 2.5, descuento_pct: 10, iva_pct: 21},
    {cantidad: 1.5, precio: 35, iva_pct: 21}, {cantidad: 1, precio: 25, iva_pct: 21}]), {base: 124.25, iva: 26.1, total: 150.35});
  const art = [{stel_id: 1, precio: 40, iva_pct: 21, nombre: "Termostato"}, {stel_id: 9, precio: 35, iva_pct: 21, nombre: "Mano de obra"}];
  const l = proponerLineas({materiales: [{id: "m1", descripcion: "Termostato", cantidad: 1, stel_item_id: 1}, {id: "m2", descripcion: "Codo", cantidad: 2}],
    tiempo_trabajo_min: 90}, art, {stel_servicio_mano_obra_id: 9});
  assert.deepEqual(l.map((x) => [x.tipo, x.stel_item_id, x.cantidad, x.precio]), [["MATERIAL", 1, 1, 40], ["MATERIAL", null, 2, null], ["MANO_OBRA", 9, 1.5, 35]]);
  assert.equal(lineasIncompletas(l).length, 1, "el codo sin artículo ni precio queda para completar; nunca se inventa un precio");
});

test("albarán del proveedor: líneas fiables → materiales; lo dudoso marcado; artículo de STEL solo si es único", () => {
  const campo = (valor, confianza) => ({valor, confianza, estado: "OK"});
  const resultado = {proveedor: {nombre: "Proveedor Ficticio S.L."}, numero: campo("A-123", 0.99), fecha: campo("2026-11-17", 0.99), confianza: 0.6,
    lineas: [
      {referencia: campo("TER-01", 0.95), descripcion: campo("TERMOSTATO DIGITAL", 0.95), cantidad: campo(1, 0.95), unidad: campo("UD", 0.95), precio: campo(40, 0.95)},
      {referencia: campo("CD16", 0.6), descripcion: campo("CODO 16", 0.95), cantidad: campo(3, 0.75), unidad: campo("UDS", 0.9)},
      {referencia: campo("TUB-16", 0.95), descripcion: campo("TUBO MULTICAPA 16", 0.95), cantidad: campo(2.5, 0.99), unidad: campo("M", 0.95)},
      {referencia: campo("REP-9", 0.95), descripcion: campo("REPETIDO", 0.95), cantidad: campo(1, 0.95)},
      {referencia: {valor: null}, descripcion: {valor: null}, cantidad: campo(5, 0.9)}]};
  const articulos = [{stel_id: 1, referencia: "TER-01", nombre: "Termostato digital"}, {stel_id: 2, referencia: "H8953 - TUB-16", nombre: "Tubo 16"},
    {stel_id: 3, referencia: "CD16", nombre: "Codo 16"}, {stel_id: 4, referencia: "REP-9", nombre: "A"}, {stel_id: 5, referencia: "REP9", nombre: "B"}];
  const r = materialesDesdeAlbaran(resultado, {articulos, fotoId: "f1"});
  assert.equal(r.proveedor, "Proveedor Ficticio S.L.");
  assert.equal(r.materiales.length, 4, "una línea sin descripción ni referencia no se inventa");
  const [ter, codo, tubo, rep] = r.materiales;
  assert.deepEqual([ter.cantidad, ter.unidad, ter.stel_item_id, ter.fiable], [1, "ud", 1, true]);
  assert.equal(ter.precio, undefined, "los precios del papel no pasan al parte");
  // Referencia leída con dudas: no se busca en STEL (una cifra mal leída daría otro artículo) y queda para comparar.
  assert.equal(codo.stel_item_id, null);
  assert.ok(codo.dudas.some((d) => /Referencia/.test(d)) && codo.dudas.some((d) => /Cantidad/.test(d)));
  assert.deepEqual([tubo.cantidad, tubo.unidad, tubo.stel_item_id], [2.5, "m", 2], "con el prefijo del proveedor también vale");
  assert.equal(rep.stel_item_id, null, "dos artículos con esa referencia: elige la persona");
  assert.match(rep.motivo_articulo, /2 artículos/);
  assert.equal(ter.origen.tipo, "ALBARAN_PROVEEDOR");
  assert.equal(unidadDe("Mts"), "m");
  assert.deepEqual(materialesDesdeAlbaran({lineas: []}).avisos.length, 1);
});

test("STEL: líneas del albarán de trabajo y texto para el cliente (sin importes)", () => {
  const c = {tipo_visita: "PENDIENTE", pendiente_de: "REPUESTOS", averia: "Fuga", trabajos: "Cerrada la llave", pendientes: "Cambiar válvula",
    materiales: [{id: "m1", descripcion: "Teflón", cantidad: 1, unidad: "rollo", stel_item_id: 5}, {id: "m2", descripcion: "Codo", cantidad: 2}],
    tiempo_trabajo_min: 45, desplazamiento_km: 12};
  let x = lineasAlbaran(c, null, {stel_servicio_mano_obra_id: 7});
  assert.deepEqual(x.faltan, ["artículo de STEL para «Codo»", "servicio de desplazamiento de STEL (Ajustes)"]);
  x = lineasAlbaran(c, [{material_id: "m2", stel_item_id: 6}], {stel_servicio_mano_obra_id: 7, stel_servicio_desplazamiento_id: 8});
  assert.deepEqual(x.faltan, []);
  assert.deepEqual(x.lineas.map((l) => [l["item-id"], l.units]), [[5, 1], [6, 2], [7, 0.75], [8, 1]]);
  assert.ok(x.lineas.every((l) => !("item-base-price" in l)), "el albarán no lleva precios del técnico");
  assert.equal(textoAlbaran(c).split("\n")[0], "Intervención pendiente de repuestos");
  assert.equal(fechaStel("2026-11-16", "09:05"), "2026-11-16T09:05:00+0100");
  assert.equal(fechaStel("2026-07-01", "09:05"), "2026-07-01T09:05:00+0200");
});
