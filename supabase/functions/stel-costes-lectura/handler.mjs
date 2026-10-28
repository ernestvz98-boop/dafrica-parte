// Consulta económica independiente del lector. STEL se consulta exclusivamente mediante GET.
const TABLE = 'cerebro_stel_consultas';
const ORIGIN = 'https://ernestvz98-boop.github.io';
const routes = { productos: 'products', facturas: 'purchaseInvoices', albaranes: 'purchaseDeliveryNotes' };
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin'
};
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });
const text = (v, max = 300) => v == null ? null : String(v).slice(0, max);
export function number(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number.isFinite(Number(v)) ? Number(v) : null;
  return null;
}
const id = v => Number.isSafeInteger(number(v)) && number(v) > 0 ? number(v) : null;
const flag = v => typeof v === 'boolean' ? v : null;
const unit = x => text(x['unit-name'] ?? x['unit-symbol'] ?? x.unit, 30);
const round = v => Math.round((v + Number.EPSILON) * 1e6) / 1e6;
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('PETICION_INVALIDA');
  const allowed = ['recurso', 'id', 'inicio', 'limite', 'referencia', 'desde', 'hasta'];
  if (Object.keys(input).some(k => !allowed.includes(k)) || !Object.hasOwn(routes, input.recurso)) throw fail('PETICION_INVALIDA');
  const q = { recurso: input.recurso, inicio: input.inicio ?? 0, limite: input.limite ?? 25 };
  if (!Number.isSafeInteger(q.inicio) || q.inicio < 0 || q.inicio > 1000000 || !Number.isSafeInteger(q.limite) || q.limite < 1 || q.limite > 50) throw fail('PAGINACION_INVALIDA');
  if (input.id !== undefined) {
    if (!Number.isSafeInteger(input.id) || input.id <= 0) throw fail('ID_INVALIDO');
    if (['referencia', 'desde', 'hasta', 'inicio', 'limite'].some(k => input[k] !== undefined)) throw fail('FILTROS_INCOMPATIBLES');
    q.id = input.id;
  }
  if (input.referencia !== undefined) {
    if (typeof input.referencia !== 'string' || !/^[A-Za-z0-9._/ -]{1,80}$/.test(input.referencia)) throw fail('REFERENCIA_INVALIDA');
    q.referencia = input.referencia;
  }
  for (const k of ['desde', 'hasta']) if (input[k] !== undefined) {
    const s = input[k];
    const date = typeof s === 'string' ? new Date(s + 'T00:00:00Z') : null;
    if (q.recurso === 'productos' || typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(date?.getTime()) || date.toISOString().slice(0, 10) !== s) throw fail('FECHA_INVALIDA');
    q[k] = s;
  }
  if (q.desde && q.hasta && q.desde > q.hasta) throw fail('FECHAS_INVERTIDAS');
  return q;
}
export function projectProduct(x) {
  return {
    id: id(x.id), referencia: text(x.reference, 100), descripcion: text(x.name),
    precio_compra_catalogo: number(x['purchase-price']), unidad: unit(x),
    moneda: text(x['currency-code'], 3), modificado_en: text(x['utc-last-modification-date'], 40),
    origen_precio: 'CATALOGO_STEL', compra_historica_confirmada: false,
    advertencias: ['El precio de catálogo no acredita una compra real.', 'Confirmar moneda, unidad, vigencia y condiciones antes de estimar.']
  };
}
export function projectDocument(x, recurso) {
  const discount = number(x['discount-percentage']);
  const rawLines = Array.isArray(x.lines) ? x.lines : null;
  const lines = (rawLines ?? []).slice(0, 500).filter(l => l && l.deleted !== true).map(l => {
    const price = number(l['item-base-price']), lineDiscount = number(l['discount-percentage']);
    const computable = price !== null && lineDiscount !== null && discount !== null && lineDiscount >= 0 && lineDiscount <= 100 && discount >= 0 && discount <= 100;
    return {
      id: id(l.id), articulo_id: id(l['item-id']), referencia: text(l['item-reference'], 100),
      descripcion: text(l['item-name'] || l['item-description']), tipo: text(l['line-type'], 30),
      cantidad: number(l.units), unidad: unit(l), precio_base: price,
      descuento_linea_pct: lineDiscount, impuesto_pct: number(l['primary-tax-percentage']),
      importe_linea_stel: number(l['total-amount']),
      precio_neto_calculado: computable ? round(price * (1 - lineDiscount / 100) * (1 - discount / 100)) : null,
      precio_pendiente: price === null
    };
  });
  return {
    id: id(x.id), referencia: text(x['full-reference'] || x.reference, 100), fecha: text(x.date, 40),
    proveedor_id: id(x['account-id']), estado_id: id(x['document-state-id']), liquidado: flag(x.settled),
    moneda: text(x['currency-code'], 3), descuento_documento_pct: discount,
    base_imponible: number(x['subtotal-amount']), impuestos: number(x['tax-total-amount']), total: number(x['total-amount']),
    modificado_en: text(x['utc-last-modification-date'], 40),
    origen_precio: recurso === 'facturas' ? 'FACTURA_COMPRA_STEL' : 'ALBARAN_COMPRA_STEL',
    confirmacion_contable: 'NO_DETERMINADA', lineas_incluidas: rawLines !== null,
    lineas_completas: rawLines !== null && rawLines.length <= 500,
    lineas: lines,
    advertencias: ['La fecha y el estado se conservan sin inferir aprobación contable.',
      'Precio neto calculado: descuentos sucesivos de línea y documento; contrastar redondeos y gastos con el original.',
      ...(rawLines === null ? ['La consulta no incluye líneas: consultar el ID del documento.'] : []),
      ...(rawLines && rawLines.length > 500 ? ['Más de 500 líneas: respuesta parcial.'] : [])]
  };
}
export async function queryStel(q, { fetcher, key, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const url = new URL('https://app.stelorder.com/app/' + routes[q.recurso] + (q.id ? '/' + q.id : ''));
  if (!q.id) {
    url.searchParams.set('limit', String(q.limite)); url.searchParams.set('start', String(q.inicio));
    url.searchParams.set('sort', 'id');
    if (q.referencia) url.searchParams.set(q.recurso === 'productos' ? 'reference' : 'full-reference', q.referencia);
    if (q.desde) url.searchParams.set('start-date', q.desde + 'T00:00:00+0000');
    if (q.hasta) url.searchParams.set('end-date', q.hasta + 'T23:59:59+0000');
  }
  let response;
  for (let n = 0; n < 3; n++) {
    try { response = await fetcher(url.href, { method: 'GET', headers: { APIKEY: key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw fail('STEL_CONEXION_NO_DISPONIBLE', 502); }
    if (response.ok || ![403, 429, 500, 502, 503, 504].includes(response.status) || n === 2) break;
    await sleep(1000 * (n + 1));
  }
  if (!response.ok) throw fail('STEL_HTTP_' + response.status, 502);
  const rawText = await response.text();
  if (rawText.length > 4000000) throw fail('RESPUESTA_DEMASIADO_GRANDE', 502);
  let raw; try { raw = JSON.parse(rawText); } catch { throw fail('STEL_FORMATO_INVALIDO', 502); }
  if (!Array.isArray(raw)) throw fail('STEL_FORMATO_INVALIDO', 502);
  if (q.id && (raw.length > 1 || raw.some(x => id(x?.id) !== q.id))) throw fail('STEL_ID_NO_COINCIDE', 502);
  const ids = raw.map(x => id(x?.id));
  if (ids.some(x => x === null) || new Set(ids).size !== ids.length || (!q.id && raw.length > q.limite)) throw fail('STEL_PAGINA_INVALIDA', 502);
  // El servidor puede ignorar filtros: nunca etiquetar filas ajenas como coincidencias.
  const matching = raw.filter(x => {
    if (q.referencia) {
      const reference = q.recurso === 'productos' ? x.reference : x['full-reference'];
      if (typeof reference !== 'string' || reference.trim().toUpperCase() !== q.referencia.trim().toUpperCase()) return false;
    }
    if (q.desde || q.hasta) {
      const day = typeof x.date === 'string' ? x.date.slice(0, 10) : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (q.desde && day < q.desde) || (q.hasta && day > q.hasta)) return false;
    }
    return true;
  });
  const active = matching.filter(x => x.deleted !== true && !(q.recurso === 'productos' && x.inactive === true));
  return {
    solo_lectura_stel: true, consultado_en: new Date().toISOString(), recurso: q.recurso,
    consulta: q, filas_recibidas: raw.length, filas_fuera_de_filtro: raw.length - matching.length,
    registros: active.map(x => q.recurso === 'productos' ? projectProduct(x) : projectDocument(x, q.recurso)),
    paginacion: q.id ? null : { inicio: q.inicio, siguiente: q.inicio + raw.length, pagina_vacia: raw.length === 0,
      catalogo_completo: false, ids_pagina: ids,
      advertencia: 'Una página corta no demuestra fin. Continuar desde siguiente hasta página vacía y comprobar IDs entre páginas.' }
  };
}
async function hashToken(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function handler(req, { env, fetcher = fetch, sleep } = {}) {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: 'METODO_NO_PERMITIDO' }, 405);
  const origin = req.headers.get('Origin');
  if (origin && origin !== ORIGIN) return reply({ error: 'ORIGEN_NO_PERMITIDO' }, 403);
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length > 10000) return reply({ error: 'IDENTIFICACION_REQUERIDA' }, 401);
  const base = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY'), stel = env('STEL_API_KEY');
  if (!base || !anon || !service || !stel) return reply({ error: 'CONFIGURACION_INCOMPLETA' }, 503);
  const adminHeaders = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  let claimedId = null;
  async function db(path, options = {}) {
    const r = await fetcher(base + '/rest/v1/' + path, { ...options, headers: { ...adminHeaders, ...options.headers }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw fail('REGISTRO_CONSULTA_NO_DISPONIBLE', 503);
    const s = await r.text(); return s ? JSON.parse(s) : null;
  }
  try {
    const rawBody = await req.text();
    if (rawBody.length > 2048) throw fail('PETICION_DEMASIADO_GRANDE');
    let body; try { body = JSON.parse(rawBody); } catch { throw fail('JSON_INVALIDO'); }
    let q;
    if (auth.startsWith('Bearer dc_')) {
      // Capacidad de un solo uso, emitida por el backend autorizado; nunca por anon/authenticated.
      const token = auth.slice(7);
      if (!/^dc_[A-Za-z0-9_-]{43}$/.test(token) || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !/^[a-f0-9-]{36}$/.test(body.consulta_id || '')) throw fail('CONSULTA_NO_AUTORIZADA', 401);
      const digest = await hashToken(token), now = new Date().toISOString();
      const filter = TABLE + '?id=eq.' + body.consulta_id + '&token_hash=eq.' + digest + '&claimed_at=is.null&expires_at=gt.' + encodeURIComponent(now);
      const jobs = await db(filter + '&select=id,request');
      if (!Array.isArray(jobs) || jobs.length !== 1) throw fail('CONSULTA_NO_AUTORIZADA', 401);
      q = validate(jobs[0].request);
      const claimed = await db(filter + '&select=id', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ claimed_at: now, token_hash: null }) });
      if (!Array.isArray(claimed) || claimed.length !== 1) throw fail('CONSULTA_NO_AUTORIZADA', 401);
      claimedId = jobs[0].id;
    } else {
      // Usuario de DAFRICA: validación real en Auth y permiso actual, sin claims editables.
      const userHeaders = { apikey: anon, Authorization: auth };
      const user = await fetcher(base + '/auth/v1/user', { method: 'GET', headers: userHeaders, signal: AbortSignal.timeout(10000) });
      if (!user.ok) throw fail('SESION_NO_VALIDA', 401);
      const permissions = await fetcher(base + '/rest/v1/rpc/mis_permisos', { method: 'POST', headers: { ...userHeaders, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) });
      if (!permissions.ok) throw fail('PERMISO_NO_COMPROBADO', 403);
      const p = await permissions.json();
      if (!Array.isArray(p) || !p.some(x => x.codigo === 'costes.ver')) throw fail('SIN_PERMISO_COSTES', 403);
      q = validate(body);
    }
    const result = await queryStel(q, { fetcher, key: stel, sleep });
    if (claimedId) await db(TABLE + '?id=eq.' + claimedId, { method: 'PATCH', body: JSON.stringify({ completed_at: new Date().toISOString(), result }) });
    return reply(result);
  } catch (e) {
    const code = e?.code || 'CONSULTA_NO_DISPONIBLE';
    if (claimedId) { try { await db(TABLE + '?id=eq.' + claimedId, { method: 'PATCH', body: JSON.stringify({ completed_at: new Date().toISOString(), error_code: code }) }); } catch {} }
    return reply({ error: code }, e?.status || 502);
  }
}
