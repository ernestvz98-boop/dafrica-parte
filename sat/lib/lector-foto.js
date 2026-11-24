// DAFRICA SAT · lectura de la foto de un albarán o ticket del proveedor con el MISMO lector de albaranes de DAFRICA
// Control (albaranes/*.js + tesseract.js servido por la propia web: sin servicios externos, funciona en el teléfono y,
// una vez descargado, sin conexión). La foto nunca sale del teléfono para leerla.

import {enderezarLienzo} from "./enderezar.js";
import {aplicarSegunda, necesitaSegunda} from "./segunda-lectura.js";

const RAIZ = new URL("../", location.href); // la web: …/sat/ → …/
const SCRIPTS = ["albaranes/normalizar.js", "albaranes/nif.js", "albaranes/texto-pdf.js", "albaranes/proveedores.js", "albaranes/extraer.js",
  "albaranes/articulos.js", "albaranes/etiquetas.js", "albaranes/ocr.js", "albaranes/escaneado.js", "vendor/tesseract/tesseract.min.js",
  "albaranes/motor-navegador.js", "albaranes/manuscritos.js"];
let carga = null;

export function cargarLector() {
  carga ??= (async () => {
    window.DAFRICA_TESSERACT_BASE = new URL("vendor/tesseract/", RAIZ).href;
    for (const s of SCRIPTS) {
      await new Promise((ok, mal) => {
        const e = document.createElement("script");
        e.src = new URL(s, RAIZ).href;
        e.onload = ok;
        e.onerror = () => mal(new Error("No se pudo cargar el lector (" + s + "). ¿Sin conexión la primera vez?"));
        document.head.appendChild(e);
      });
    }
    if (!window.DafricaAlbaranes?.escaneado || !window.DafricaAlbaranes?.motorNavegador?.paginaDesdeLienzo) throw new Error("Lector incompleto");
  })().catch((e) => { carga = null; throw e; });
  return carga;
}

/**
 * Lienzo a ~300 ppp: un A4 fotografiado entero mide 8,27 pulgadas de ancho; un ticket estrecho (más de 2 veces más
 * alto que ancho), unos 80 mm. La foto se gira según su EXIF.
 */
export async function lienzoDeFoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, {imageOrientation: "from-image"}); }
  catch { bmp = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = URL.createObjectURL(file); }); }
  const w = bmp.width, h = bmp.height;
  const anchoPulgadas = h / w > 2 ? 3.15 : 8.27;
  const k = Math.min(1.6, Math.max(0.35, (anchoPulgadas * 300) / w));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const x = c.getContext("2d", {alpha: false, willReadFrequently: true});
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = "high";
  x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/**
 * Lee la foto con el lector de albaranes. Devuelve el resultado completo del lector (con confianza por campo). Si quedan
 * códigos o descripciones dudosos y se encuentra la hoja, la lee otra vez ENDEREZADA y toma de ahí propuestas mejores para
 * esos campos, siempre en duda (segunda-lectura.js). `segunda_lectura` lo resume para el registro de lectura.
 */
export async function leerFotoAlbaran(file, {alProgresar = null} = {}) {
  alProgresar?.("Preparando el lector (la primera vez descarga unos 9 MB)…");
  await cargarLector();
  const hoy = new Date().toISOString().slice(0, 10);
  const leer = (l) => window.DafricaAlbaranes.escaneado.extraerEscaneado([window.DafricaAlbaranes.motorNavegador.paginaDesdeLienzo(l, {alProgresar})], {hoy});
  let lienzo = await lienzoDeFoto(file), hoja = null;
  try {
    const r = await leer(lienzo);
    if (!necesitaSegunda(r)) return r;
    const t0 = Date.now();
    try {
      const e = enderezarLienzo(lienzo);
      if (!e.enderezada) { r.segunda_lectura = {enderezada: false}; return r; }
      hoja = e.lienzo;
      lienzo.width = 0; lienzo.height = 0;
      alProgresar?.("Segunda lectura con la hoja enderezada…");
      const r2 = await leer(hoja);
      r.segunda_lectura = {enderezada: true, segundos: Math.round((Date.now() - t0) / 1000), cambios: aplicarSegunda(r, r2)};
    } catch (e) {
      // La segunda lectura solo mejora propuestas: si falla, vale la primera tal cual.
      r.segunda_lectura = {error: String(e?.message || e).slice(0, 200)};
    }
    return r;
  } finally {
    lienzo.width = 0; lienzo.height = 0;
    if (hoja) { hoja.width = 0; hoja.height = 0; }
  }
}
