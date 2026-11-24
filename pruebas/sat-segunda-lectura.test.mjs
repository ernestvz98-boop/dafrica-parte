// DAFRICA SAT · segunda lectura de la foto con la hoja enderezada (sat/lib/segunda-lectura.js). Lecturas inventadas que
// reproducen lo visto con una foto real (2026-11-24): la primera lectura acierta las cifras y destroza códigos y
// descripciones; la enderezada lee bien el texto y pierde cifras y alguna línea.
import test from "node:test";
import assert from "node:assert/strict";
import {aplicarSegunda, emparejar, necesitaSegunda, distancia} from "../sat/lib/segunda-lectura.js";

const C = (valor, confianza, estado = "OK", conf_ocr = null) => ({literal: valor == null ? "" : String(valor), valor, estado, confianza, conf_ocr, motivos: []});
const V = () => C(null, 0, "VACIO");
const linea = (fila, ref, desc, cant, imp) => ({fila, estado: "REVISAR", referencia: ref, descripcion: desc,
  cantidad: cant == null ? V() : C(cant, 0.99, "VERIFICADO"), importe: imp == null ? V() : C(imp, 0.99, "VERIFICADO")});
const primera = () => ({lineas: [
  linea(1, C("9990000021", 0.5, "REVISAR", 38), C("TUBO AEPRIGERANTE RAJOA", 0.6, "OK", 6), 10, 100),
  linea(2, V(), C("TASA FICTICIA", 0.95, "OK", 92), 10, 31.3),
  linea(3, C("9990010065", 0.5, "REVISAR", 19), C("ENVASE VACIO GAS REFRIGE RANTE 137,500]", 0.5, "REVISAR", 15), 1, 137.49),
  linea(4, C("1110000001", 0.5, "REVISAR", 89), C("EQUIPO FICTICIO J ANOTACION A MANO", 0.6, "OK", 0), 1, 50)]});
const enderezada = () => ({lineas: [
  linea(1, C("9990000020", 0.5, "REVISAR", 90), C("TUBO REFRIGERANTE R410A (CARGA 10KG)", 0.75, "OK", 70), 10, 100),
  linea(2, C("9990010064", 0.95, "OK", 93), C("ENVASE VACIO 10/12KG GAS REFRIGERANTE", 0.75, "OK", 72), null, null),
  linea(3, C("1110000001", 0.95, "OK", 95), C("EQUIPO FICTICIO migivio", 0.5, "REVISAR", 40), null, 7.5),
  linea(4, V(), C("IN puca AC.", 0.6, "OK", 30), 1, null)]});

test("SAT segunda lectura: solo si queda algún código o descripción dudoso", () => {
  assert.equal(necesitaSegunda(primera()), true);
  assert.equal(necesitaSegunda({lineas: [linea(1, C("9990000021", 0.95), C("TUBO", 0.95), 1, 1), linea(2, V(), C("TASA", 0.95), 1, 1)]}), false);
  assert.equal(distancia("9990000021", "9990000020"), 1);
});

test("SAT segunda lectura: empareja por contenido y en orden (la tasa sin pareja, la línea fantasma tampoco)", () => {
  const a = primera(), b = enderezada();
  const p = emparejar(a.lineas, b.lineas);
  assert.equal(p.get(a.lineas[0]), b.lineas[0]);
  assert.equal(p.get(a.lineas[1]), undefined);
  assert.equal(p.get(a.lineas[2]), b.lineas[1]);
  assert.equal(p.get(a.lineas[3]), b.lineas[2]);
  assert.equal(p.size, 3);
});

test("SAT segunda lectura: propone código y descripción mejores, siempre en duda; no toca cifras ni lo que no mejora", () => {
  const a = primera(), cambios = aplicarSegunda(a, enderezada());
  const [l1, l2, l3, l4] = a.lineas;
  assert.equal(l1.referencia.valor, "9990000020");
  assert.equal(l1.descripcion.valor, "TUBO REFRIGERANTE R410A (CARGA 10KG)");
  assert.equal(l3.referencia.valor, "9990010064");
  assert.equal(l3.descripcion.valor, "ENVASE VACIO 10/12KG GAS REFRIGERANTE");
  for (const c of [l1.referencia, l1.descripcion, l3.referencia, l3.descripcion]) {
    assert.ok(c.confianza < 0.9, "nunca aceptado");
    assert.equal(c.estado, "REVISAR");
    assert.ok(c.motivos.some((m) => /foto enderezada/.test(m)));
  }
  assert.equal(l1.descripcion.lectura_inicial, "TUBO AEPRIGERANTE RAJOA");
  // Mismo código en las dos: no cambia. Descripción de la enderezada con menos confianza: tampoco.
  assert.equal(l4.referencia.valor, "1110000001");
  assert.equal(l4.descripcion.valor, "EQUIPO FICTICIO J ANOTACION A MANO");
  // La tasa (sin pareja) y todas las cifras, como estaban.
  assert.equal(l2.descripcion.valor, "TASA FICTICIA");
  assert.deepEqual(a.lineas.map((l) => l.importe.valor), [100, 31.3, 137.49, 50]);
  assert.equal(cambios.filter((c) => c.tipo === "propuesta").length, 4);
});

test("SAT segunda lectura: aceptado en las dos y distinto → en duda con las dos lecturas", () => {
  const a = {lineas: [linea(1, C("9990000020", 0.95, "OK", 95), C("TUBO FICTICIO", 0.95, "OK", 92), 2, 20)]};
  const b = {lineas: [linea(1, C("9990000028", 0.95, "OK", 93), C("TUBO FICTICIO", 0.95, "OK", 94), 2, 20)]};
  const cambios = aplicarSegunda(a, b);
  assert.equal(a.lineas[0].referencia.valor, "9990000020");
  assert.equal(a.lineas[0].referencia.estado, "REVISAR");
  assert.ok(a.lineas[0].referencia.confianza < 0.9);
  assert.ok(a.lineas[0].referencia.motivos.some((m) => /9990000028/.test(m)));
  assert.equal(a.lineas[0].descripcion.confianza, 0.95, "la descripción coincide: sigue aceptada");
  assert.deepEqual(cambios.map((c) => c.tipo), ["conflicto"]);
});
