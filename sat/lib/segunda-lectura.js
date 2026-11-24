// DAFRICA SAT · segunda lectura de la foto del albarán con la hoja ENDEREZADA (usuario, 2026-11-24: «el lector tuvo muchos
// fallos y la foto fue buena»). En una foto la hoja no llena el encuadre y sale en perspectiva: el texto de la tabla queda a
// unos 250 ppp y el OCR destroza códigos y descripciones bien impresos (la misma cifra mal leída en todos los códigos, palabras irreconocibles).
// Enderezada (la hoja llevada a un A4 de 300 ppp, enderezar.js) se leen mucho mejor, pero sus cifras salen peor. Por eso la
// primera lectura manda (cantidades, precios, importes y qué líneas hay) y la enderezada solo aporta, en el código y la
// descripción, una PROPUESTA mejor cuando la primera no está segura. Nada pasa a aceptado: el mismo OCR sobre la misma foto no
// es una prueba independiente; el técnico lo compara con el papel («Coinciden con el papel» / «Corregir»).

const CAMPOS = ["referencia", "descripcion"];
const canon = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const aceptado = (c) => Boolean(c) && ["OK", "VERIFICADO"].includes(c.estado) && (c.confianza ?? 0) >= 0.9;
const conTexto = (c) => canon(c?.valor ?? c?.literal).length > 0;

/** ¿Merece la pena la segunda lectura? Alguna línea con código o descripción leídos y sin aceptar. */
export function necesitaSegunda(r) {
  return (r?.lineas || []).some((l) => CAMPOS.some((k) => conTexto(l[k]) && !aceptado(l[k])));
}

export function distancia(a, b) {
  const x = canon(a), y = canon(b);
  if (!x || !y) return Infinity;
  let prev = Array.from({length: y.length + 1}, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const fila = [i];
    for (let j = 1; j <= y.length; j++) fila[j] = Math.min(prev[j] + 1, fila[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = fila;
  }
  return prev[y.length];
}
const trigramas = (s) => { const t = canon(s), out = new Set(); for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3)); return out; };
function parecidoTexto(a, b) {
  const x = trigramas(a), y = trigramas(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / Math.min(x.size, y.size);
}
const mismoNumero = (a, b) => a?.valor != null && b?.valor != null && Math.abs(Number(a.valor) - Number(b.valor)) < 1e-6;

/** Parecido de dos líneas (mismo papel, dos lecturas): importe, cantidad, código casi igual y descripción. */
export function parecido(a, b) {
  let s = 0;
  if (mismoNumero(a.importe, b.importe)) s += 2;
  if (mismoNumero(a.cantidad, b.cantidad)) s += 1;
  const ra = a.referencia?.valor ?? a.referencia?.literal, rb = b.referencia?.valor ?? b.referencia?.literal;
  if (canon(ra).length >= 4 && canon(rb).length >= 4 && distancia(ra, rb) <= 2) s += 2;
  if (parecidoTexto(a.descripcion?.valor ?? a.descripcion?.literal, b.descripcion?.valor ?? b.descripcion?.literal) >= 0.35) s += 1;
  return s;
}

/**
 * Parejas (línea de la primera lectura → línea de la enderezada) en el MISMO orden de arriba abajo: la de más parecido total,
 * solo parejas que se parecen en al menos dos cosas (p. ej. código casi igual, o importe).
 */
export function emparejar(lineas1, lineas2) {
  const n = lineas1.length, m = lineas2.length;
  const s = lineas1.map((a) => lineas2.map((b) => parecido(a, b)));
  const mejor = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    mejor[i][j] = Math.max(mejor[i + 1][j], mejor[i][j + 1], s[i][j] >= 2 ? s[i][j] + mejor[i + 1][j + 1] : -Infinity);
  }
  const parejas = new Map();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (s[i][j] >= 2 && mejor[i][j] === s[i][j] + mejor[i + 1][j + 1]) { parejas.set(lineas1[i], lineas2[j]); i++; j++; }
    else if (mejor[i][j] === mejor[i + 1][j]) i++;
    else j++;
  }
  return parejas;
}

const fuerza = (c) => [c?.confianza ?? 0, c?.conf_ocr ?? 0];
const mejorQue = (a, b) => { const [x, y] = fuerza(a), [u, v] = fuerza(b); return x > u || (x === u && y > v); };

/**
 * Lleva a la primera lectura lo que aporta la enderezada (lo modifica). Por cada pareja y campo (código, descripción):
 *  - la primera no está aceptada y la enderezada lo lee con más confianza y distinto → se propone el de la enderezada, en duda;
 *  - las dos lo aceptan y dicen cosas distintas → dos interpretaciones plausibles: en duda, con las dos.
 * Devuelve la lista de cambios (para el registro de lectura).
 */
export function aplicarSegunda(r1, r2) {
  const cambios = [];
  if (!r1?.lineas?.length || !r2?.lineas?.length) return cambios;
  for (const [l1, l2] of emparejar(r1.lineas, r2.lineas)) {
    for (const k of CAMPOS) {
      const a = l1[k], b = l2[k];
      if (!conTexto(b) || canon(a?.valor ?? a?.literal) === canon(b.valor ?? b.literal)) continue;
      const v1 = a?.valor ?? a?.literal ?? "", v2 = b.valor ?? b.literal;
      if (aceptado(a)) {
        if (!aceptado(b)) continue;
        const m = `Otra lectura fiable (foto enderezada) dice «${v2}»: compruébalo con el papel`;
        l1[k] = {...a, estado: "REVISAR", confianza: 0.5, motivos: [...(a.motivos || []), m]};
        l1.estado = "REVISAR";
        cambios.push({fila: l1.fila, campo: k, tipo: "conflicto", antes: v1, enderezada: v2});
        continue;
      }
      if (!mejorQue(b, a)) continue;
      const m = `Propuesto por la foto enderezada (primera lectura: «${v1}»): compruébalo con el papel`;
      l1[k] = {...(a || {}), literal: v2, valor: v2, estado: "REVISAR", confianza: Math.min(0.85, b.confianza ?? 0.85),
        conf_ocr: b.conf_ocr ?? null, motivos: [...((a?.motivos) || []).filter((t) => !/^Relecturas fiables distintas/.test(t)), m],
        lectura_inicial: v1, metodo: "foto_enderezada"};
      cambios.push({fila: l1.fila, campo: k, tipo: "propuesta", antes: v1, enderezada: v2});
    }
  }
  return cambios;
}
