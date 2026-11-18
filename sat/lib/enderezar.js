// DAFRICA SAT · enderezar la foto de un albarán (usuario, 2026-11-18: «no leyó las líneas del albarán»).
// Una foto hecha a mano sale torcida y en perspectiva, con la mesa alrededor: el lector separa mal las columnas (el
// código acaba en la descripción y las filas se parten). Aquí se busca la hoja (la zona clara más grande), sus cuatro
// esquinas, y se pasa a un rectángulo recto a ~300 ppp. Si no hay una hoja clara, la foto se deja como estaba: nunca
// empeora la lectura. Todo en el propio teléfono, sin servicios externos.

/** Umbral de Otsu sobre un histograma de 256 niveles. */
export function otsu(hist, total) {
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const mB = sumaB / pesoB, mF = (suma - sumaB) / pesoF;
    const v = pesoB * pesoF * (mB - mF) * (mB - mF);
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}

/**
 * Esquinas de la hoja en una imagen pequeña en gris (Uint8 de w×h). Devuelve [sup-izq, sup-der, inf-der, inf-izq] o
 * null si no hay una hoja clara (zona clara pequeña, que ya llena la foto o con forma que no es un cuadrilátero).
 */
export function esquinasHoja(gris, w, h) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gris.length; i++) hist[gris[i]]++;
  const u = otsu(hist, gris.length);
  const claro = new Uint8Array(gris.length);
  for (let i = 0; i < gris.length; i++) claro[i] = gris[i] > u ? 1 : 0;
  // Componente clara más grande (4-vecinos).
  const marca = new Int32Array(gris.length);
  let mejor = 0, mejorN = 0, n = 0;
  const pila = new Int32Array(gris.length);
  for (let s = 0; s < gris.length; s++) {
    if (!claro[s] || marca[s]) continue;
    n++;
    let tope = 0, cuenta = 0;
    pila[tope++] = s; marca[s] = n;
    while (tope) {
      const p = pila[--tope]; cuenta++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && claro[p - 1] && !marca[p - 1]) { marca[p - 1] = n; pila[tope++] = p - 1; }
      if (x < w - 1 && claro[p + 1] && !marca[p + 1]) { marca[p + 1] = n; pila[tope++] = p + 1; }
      if (y > 0 && claro[p - w] && !marca[p - w]) { marca[p - w] = n; pila[tope++] = p - w; }
      if (y < h - 1 && claro[p + w] && !marca[p + w]) { marca[p + w] = n; pila[tope++] = p + w; }
    }
    if (cuenta > mejorN) { mejorN = cuenta; mejor = n; }
  }
  const fraccion = mejorN / gris.length;
  if (fraccion < 0.2 || fraccion > 0.97) return null;
  // Esquinas: extremos de x+y y x−y de la hoja.
  let tl = null, tr = null, br = null, bl = null;
  let mTL = Infinity, mBR = -Infinity, mTR = -Infinity, mBL = Infinity;
  for (let p = 0; p < marca.length; p++) {
    if (marca[p] !== mejor) continue;
    const x = p % w, y = (p / w) | 0;
    if (x + y < mTL) { mTL = x + y; tl = [x, y]; }
    if (x + y > mBR) { mBR = x + y; br = [x, y]; }
    if (x - y > mTR) { mTR = x - y; tr = [x, y]; }
    if (x - y < mBL) { mBL = x - y; bl = [x, y]; }
  }
  const q = [tl, tr, br, bl];
  // Convexo (en el sentido de las agujas del reloj en coordenadas de imagen).
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) return null;
  }
  // El cuadrilátero tiene que contener casi toda la zona clara (si sobresale mucho, no es una hoja rectangular) y la
  // zona clara tiene que llenar buena parte de él (dentro de la hoja hay texto, logotipos y anuncios oscuros).
  const area = Math.abs(q.reduce((s, a, i) => { const b = q[(i + 1) % 4]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  const dentro = (x, y) => {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -2 * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
    }
    return true;
  };
  let fuera = 0;
  for (let p = 0; p < marca.length; p++) if (marca[p] === mejor && !dentro(p % w, (p / w) | 0)) fuera++;
  if (fuera > 0.03 * mejorN || mejorN < 0.6 * area) return null;
  const lado = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (Math.min(lado(tl, tr), lado(bl, br), lado(tl, bl), lado(tr, br)) < 0.25 * Math.min(w, h)) return null;
  return q;
}

/** Homografía que lleva el rectángulo destino (0..W, 0..H) a las 4 esquinas de origen (resolviendo 8×8). */
export function homografia(W, H, q) {
  const dst = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gauss con pivote.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((x, i) => x / A[i][i]);
}

/**
 * Endereza la hoja de un lienzo. Devuelve {lienzo, enderezada: true, esquinas} o {lienzo: el mismo, enderezada: false}.
 * anchoSalida: ancho del resultado en píxeles (A4 a 300 ppp = 2480).
 */
export function enderezarLienzo(origen, {anchoSalida = 2480, crear = (w, h) => Object.assign(document.createElement("canvas"), {width: w, height: h})} = {}) {
  const W0 = origen.width, H0 = origen.height;
  const esc = 700 / Math.max(W0, H0);
  const w = Math.max(1, Math.round(W0 * esc)), h = Math.max(1, Math.round(H0 * esc));
  const peq = crear(w, h);
  const cp = peq.getContext("2d", {willReadFrequently: true});
  cp.drawImage(origen, 0, 0, w, h);
  const d = cp.getImageData(0, 0, w, h).data;
  const gris = new Uint8Array(w * h);
  for (let i = 0; i < gris.length; i++) gris[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  const q = esquinasHoja(gris, w, h);
  if (!q) return {lienzo: origen, enderezada: false};
  const Q = q.map(([x, y]) => [x / esc, y / esc]);
  const lado = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const anchoHoja = (lado(Q[0], Q[1]) + lado(Q[3], Q[2])) / 2, altoHoja = (lado(Q[0], Q[3]) + lado(Q[1], Q[2])) / 2;
  const W = anchoSalida, H = Math.round(anchoSalida * altoHoja / anchoHoja);
  const m = homografia(W, H, Q);
  const src = origen.getContext("2d", {willReadFrequently: true}).getImageData(0, 0, W0, H0).data;
  const sal = crear(W, H);
  const cs = sal.getContext("2d", {alpha: false, willReadFrequently: true});
  const img = cs.createImageData(W, H);
  const o = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = m[6] * x + m[7] * y + 1;
      const u = (m[0] * x + m[1] * y + m[2]) / den, v = (m[3] * x + m[4] * y + m[5]) / den;
      const j = (y * W + x) * 4;
      if (u < 0 || v < 0 || u >= W0 - 1 || v >= H0 - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * W0 + x0) * 4, i10 = i00 + 4, i01 = i00 + W0 * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        o[j + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
      o[j + 3] = 255;
    }
  }
  cs.putImageData(img, 0, 0);
  return {lienzo: sal, enderezada: true, esquinas: Q};
}
