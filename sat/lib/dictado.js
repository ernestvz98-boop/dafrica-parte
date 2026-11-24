// DAFRICA SAT · organizar un dictado transcrito en un parte, SIN inventar nada.
// Reglas:
//  - Cada frase dictada se coloca entera (palabra por palabra) en una sección: avería, comprobaciones, trabajos,
//    materiales, pendientes u «otros» (lo que no encaja nunca se pierde).
//  - Un material solo sale con la cantidad que se dijo («dos metros de…», «3 codos», «un termostato…»).
//    Si se cambió una pieza sin decir cantidad, se propone como material DUDOSO para confirmar o borrar.
//  - Las referencias y códigos dictados siempre se marcan para comprobar (el reconocimiento de voz los confunde).
//  - Nunca se calculan precios, ni se rellenan resultados, mediciones o cantidades que no se dijeron.

const NUMEROS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100, medio: 0.5, media: 0.5,
};
const VAGOS = /\b(unos|unas|varios|varias|algunos|algunas|un par|bastantes?|poco|pocos|un poco)\b/i;
const UNIDADES = [
  [/^(metros?|m|mts?)\b/i, "m"], [/^(cent[ií]metros?|cm)\b/i, "cm"], [/^(mil[ií]metros?|mm)\b/i, "mm"],
  [/^(litros?|l)\b/i, "l"], [/^(kilos?|kilogramos?|kg)\b/i, "kg"], [/^(gramos?|g|gr)\b/i, "g"],
  [/^(unidad(es)?|uds?|piezas?)\b/i, "ud"], [/^(rollos?)\b/i, "rollo"], [/^(cajas?)\b/i, "caja"], [/^(botes?)\b/i, "bote"],
  [/^(cartuchos?)\b/i, "cartucho"], [/^(bolsas?)\b/i, "bolsa"], [/^(sacos?)\b/i, "saco"], [/^(par(es)?)\b/i, "par"],
];
// Magnitudes que son mediciones, nunca materiales.
const MEDIDAS = /^(bar(es)?|grados?|º|°|voltios?|v|amperios?|a|vatios?|w|kw|kilovatios?|hz|hercios|psi|pascal(es)?|pa|ppm|%|por ciento|horas?|minutos?|segundos?|h|min)\b/i;
const INICIO_MATERIAL = /^(material(es)?|material usado|material utilizado|he (usado|utilizado|gastado|empleado)|se han (usado|utilizado|gastado)|gastado|usado)\b\s*:?\s*/i;
const sinPuntoFinal = (s) => s.replace(/[\s.,;:]+$/, "");

// Trabajos y comprobaciones dichos en impersonal o en tercera persona («se hace un desagüe», «se arregla la fuga»,
// «se instalan llaves»): caso real del 2026-11-18, todo iba a «Avería» porque la frase decía también «no funciona».
const SE_TRABAJO = "se (?:ha |han )?(?:hace|hacen|hecho|arregla|arreglan|arreglado|repara|reparan|reparado|cambia|cambian|cambiado|sustituye|sustituyen|sustituido|instala|instalan|instalado|coloca|colocan|colocado|pone|ponen|puesto|monta|montan|montado|ajusta|ajustan|ajustado|limpia|limpian|limpiado|purga|purgan|purgado|rellena|rellenan|rellenado|carga|cargan|cargado|desmonta|desmontan|desmontado|suelda|sueldan|soldado|sella|sellan|sellado|programa|programan|programado|conecta|conectan|conectado|desatasca|desatascan|desatascado|engrasa|engrasan|engrasado|regula|regulan|regulado|resetea|resetean|reseteado|rearma|rearman|rearmado|quita|quitan|quitado|retira|retiran|retirado|sustituyó|repone|reponen|repuesto|sanea|sanean|saneado|aísla|aíslan|aislado|calibra|calibran|calibrado)";
const SE_COMPROBACION = "se (?:ha |han )?(?:revisa|revisan|revisado|comprueba|comprueban|comprobado|verifica|verifican|verificado|mide|miden|medido|prueba|prueban|probado|inspecciona|inspeccionan|inspeccionado)";

const PATRONES = {
  averia: /\b(no (funciona|arranca|arrancaba|enciende|encend[ií]a|calienta|calentaba|enfr[ií]a|va|iba|tira)|aver[ií]a|averiad[oa]|error|c[oó]digo de error|fuga|pierde|perd[ií]a|gotea|goteaba|ruido|falla|fallaba|fallo|rot[oa]|estropead[oa]|se para|se paraba|salta|saltaba|bloquead[oa]|el cliente (dice|indica|comenta)|problema|s[ií]ntoma|da error)\b/i,
  comprobacion: /\b(he comprobado|comprobad[oa]s?|compruebo|comprobar|he revisado|revisad[oa]s?|reviso|he verificado|verificad[oa]s?|verifico|he medido|medid[oa]s?|mido|medici[oó]n|inspeccionad[oa]|he probado|probad[oa]|pruebo|he mirado|chequead[oa])\b/i,
  trabajo: /\b(he cambiado|cambiad[oa]s?|cambio|he sustituido|sustituid[oa]s?|sustituyo|he puesto|puesto|pongo|he instalado|instalad[oa]s?|instalo|he montado|montad[oa]|monto|he limpiado|limpiad[oa]s?|limpio|he reparado|reparad[oa]s?|reparo|he ajustado|ajustad[oa]s?|ajusto|he apretado|apretad[oa]s?|he purgado|purgad[oa]s?|purgo|he rellenado|rellenad[oa]s?|relleno|he cargado|cargad[oa]s?|he desmontado|desmontad[oa]s?|he soldado|soldad[oa]s?|he sellado|sellad[oa]s?|he programado|programad[oa]s?|he conectado|conectad[oa]s?|he desatascado|desatascad[oa]s?|he engrasado|engrasad[oa]s?|he regulado|regulad[oa]s?|he reseteado|reseteo|rearmad[oa]|he rearmado|he sacado|he quitado|quitad[oa]s?|he retirado|retirad[oa]s?)\b/i,
  material: INICIO_MATERIAL,
  pendiente: /\b(queda pendiente|pendiente de|pendiente|hay que|habr[aá] que|falta|faltan|faltar[ií]a|pr[oó]xima visita|segunda visita|volver a|volveremos|pedir (el |la |los |las )?(repuesto|pieza)|presupuest(o|ar)|no se ha podido|no he podido)\b/i,
};
const FIN_PALABRA = "(?![\\wáéíóúüñ])";
const RE_SE_TRABAJO = new RegExp(`\\b${SE_TRABAJO}${FIN_PALABRA}`, "i");
const RE_SE_COMPROBACION = new RegExp(`\\b${SE_COMPROBACION}${FIN_PALABRA}`, "i");
const esTrabajo = (f) => PATRONES.trabajo.test(f) || RE_SE_TRABAJO.test(f);
// «Por falta de gas» es la causa de la avería, no algo pendiente (prueba del 2026-11-24: «La caldera no arrancaba por falta de gas»
// salía en «Pendiente» de un trabajo terminado). «Falta cambiar el filtro» sí es pendiente.
const esPendiente = (f) => PATRONES.pendiente.test(String(f).replace(/\bpor falta de\b/gi, "por causa de"));
const esComprobacion = (f) => PATRONES.comprobacion.test(f) || RE_SE_COMPROBACION.test(f);
const PIEZA =/\b(?:he cambiado|he sustituido|he puesto|he instalado|he montado|cambiad[oa]|sustituid[oa]|instalad[oa]|montad[oa])\s+(?:el|la|los|las|un|una|unos|unas)?\s*([a-záéíóúñü0-9][^,;:]{1,60}?)(?=\s+(?:por|y|que|porque|ya que|del|de la|en)\b|[,;:.]|$)/i;
const REFERENCIA = /\b(?:referencia|ref\.?|c[oó]digo|modelo|n[uú]mero de serie)\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-./]{1,30}(?:\s+[0-9][A-Za-z0-9\-./]{0,20})?)/i;
const MARCAS_DUDA = /(\[(inaudible|ininteligible|\?)\]|\?\?|\.{3}|…)/i;

function limpiar(t) { return String(t || "").replace(/\s+/g, " ").trim(); }

/** Frases del dictado, respetando el texto. */
export function frases(texto) {
  return limpiar(texto)
    .split(/(?<=[.;!?])\s+|\n+|\s+(?:y luego|luego|despu[eé]s|a continuaci[oó]n)\s+/i)
    .map((f) => f.replace(/^[,;\s]+|[;\s]+$/g, "").trim())
    .filter((f) => f.length > 1);
}

function numeroDe(palabra) {
  const p = palabra.toLowerCase();
  if (/^\d+([.,]\d+)?$/.test(p)) return Number(p.replace(",", "."));
  return Object.prototype.hasOwnProperty.call(NUMEROS, p) ? NUMEROS[p] : null;
}

function unidadDe(resto) {
  for (const [re, u] of UNIDADES) { const m = resto.match(re); if (m) return {unidad: u, largo: m[0].length}; }
  return null;
}

/**
 * Materiales con cantidad dicha dentro de un fragmento: «dos metros de tubo multicapa», «3 codos de 16»,
 * «un termostato Honeywell referencia T6360», «metro y medio de cable».
 */
export function materialesConCantidad(fragmento) {
  const out = [];
  const trozos = sinPuntoFinal(fragmento).split(/,\s+|(?<!\b(?:metros?|litros?|kilos?))\s+y\s+(?=(?:\d|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)/i);
  for (const t0 of trozos) {
    const t = t0.replace(INICIO_MATERIAL, "")
      .replace(/^(?:he cambiado|he sustituido|he puesto|he instalado|he montado|pongo|cambio)\s+/i, "").trim();
    let m = t.match(/^(\d+(?:[.,]\d+)?|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta|cuarenta|cincuenta|cien|medio|media)\s+(.+)$/i);
    let cantidad, resto;
    const mm = t.match(/^(metro|litro|kilo)\s+y\s+medio\s+(?:de\s+)?(.+)$/i);
    if (mm) { cantidad = 1.5; resto = mm[1] + " " + mm[2]; }
    else if (m) { cantidad = numeroDe(m[1]); resto = m[2]; }
    else continue;
    if (cantidad === null) continue;
    let unidad = "ud";
    const u = unidadDe(resto);
    if (MEDIDAS.test(resto)) continue;
    if (u) { unidad = u.unidad; resto = resto.slice(u.largo).replace(/^\s*y\s+medio\b/i, () => { cantidad += 0.5; return ""; }).replace(/^\s*de\s+/i, ""); }
    resto = resto.replace(/\s*(para|en|que|porque)\s.*$/i, "").trim();
    if (!resto || resto.length < 2) continue;
    const dudas = [];
    let referencia = null;
    const r = resto.match(REFERENCIA);
    if (r) {
      referencia = sinPuntoFinal(r[1].trim());
      resto = resto.slice(0, r.index).trim();
      dudas.push("Referencia dictada: compruébala letra a letra");
    }
    if (/^(un|una|uno)$/i.test((m && m[1]) || "") && u) dudas.push("Cantidad «un/una» con unidad: confirma la cantidad");
    if (MARCAS_DUDA.test(t0)) dudas.push("La transcripción tiene partes dudosas");
    out.push({descripcion: sinPuntoFinal(limpiar(resto)), cantidad, unidad, referencia, dudas, dicho: limpiar(t0)});
  }
  return out;
}

/**
 * Propuesta de parte a partir del dictado. Devuelve secciones con el texto tal cual y avisos de lo dudoso.
 * @returns {{averia:string[], comprobaciones:{texto:string,resultado:null|string}[], trabajos:string[],
 *   materiales:object[], pendientes:string[], otros:string[], avisos:string[]}}
 */
export function organizarDictado(texto) {
  const r = {averia: [], comprobaciones: [], trabajos: [], materiales: [], pendientes: [], otros: [], avisos: []};
  const fr = frases(texto);
  for (const f of fr) {
    let colocada = false;
    if (MARCAS_DUDA.test(f)) r.avisos.push(`Parte dudosa en: «${f}»`);
    if (PATRONES.material.test(f)) {
      const mats = materialesConCantidad(f);
      if (mats.length) { r.materiales.push(...mats); colocada = true; }
      else if (VAGOS.test(f)) r.avisos.push(`Cantidad no concreta en: «${f}»`);
    }
    if (!colocada && esPendiente(f)) { r.pendientes.push(f); colocada = true; }
    if (!colocada && esTrabajo(f)) {
      r.trabajos.push(f); colocada = true;
      const mats = materialesConCantidad(f);
      if (mats.length) r.materiales.push(...mats);
      else {
        const p = f.match(PIEZA);
        if (p && !/^(la presi[oó]n|el agua|los filtros? de|la configuraci[oó]n|el programa|la temperatura)$/i.test(p[1].trim())) {
          const ref = p[1].match(REFERENCIA);
          r.materiales.push({descripcion: sinPuntoFinal(limpiar(ref ? p[1].slice(0, ref.index) : p[1])), cantidad: null, unidad: "ud",
            referencia: ref ? sinPuntoFinal(ref[1].trim()) : null, dicho: f,
            dudas: ["No se dijo cantidad: ¿se usó este material? Confírmalo con su cantidad o bórralo",
              ...(ref ? ["Referencia dictada: compruébala letra a letra"] : [])]});
        }
      }
    }
    if (!colocada && esComprobacion(f)) {
      let resultado = null;
      if (/\b(correct[oa]s?|bien|ok|normal(es)?|funciona(ba)? bien|sin (fugas|problemas|anomal[ií]as)|dentro de (lo normal|rango))\b/i.test(f)) resultado = "CORRECTO";
      if (/\b(mal|incorrect[oa]s?|suci[oa]s?|baj[oa]|alt[oa]|rot[oa]|defectuos[oa]|no funciona|averiad[oa]|fuga|pierde|deteriorad[oa]|quemad[oa]|obstruid[oa]|fuera de rango)\b/i.test(f)) resultado = resultado ? null : "INCORRECTO";
      r.comprobaciones.push({texto: f, resultado});
      colocada = true;
    }
    if (!colocada && PATRONES.averia.test(f)) { r.averia.push(f); colocada = true; }
    if (!colocada && PATRONES.material.test(f)) { r.otros.push(f); r.avisos.push(`Material sin cantidad clara: «${f}»`); colocada = true; }
    if (!colocada) r.otros.push(f);
  }
  for (const c of r.comprobaciones) if (!c.resultado) r.avisos.push(`Indica el resultado de: «${c.texto}»`);
  for (const m of r.materiales) for (const d of m.dudas) r.avisos.push(`${m.descripcion}: ${d}`);
  return r;
}
