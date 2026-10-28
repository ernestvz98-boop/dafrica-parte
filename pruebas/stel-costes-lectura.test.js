const test = require('node:test');
const assert = require('node:assert/strict');
const mod = import('../supabase/functions/stel-costes-lectura/handler.mjs');
const values = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'public-test', SUPABASE_SERVICE_ROLE_KEY: 'private-test', STEL_API_KEY: 'stel-private-test' };
const env = k => values[k];
const json = (x, status = 200) => new Response(JSON.stringify(x), { status });
const request = (body, token = 'user-test', extra = {}) => new Request('https://edge.example/stel-costes-lectura', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
function userFetch(records, { permission = true } = {}) {
  const calls = [];
  const fetcher = async (url, opt = {}) => {
    calls.push({ url: String(url), method: opt.method || 'GET', headers: opt.headers });
    if (String(url).endsWith('/auth/v1/user')) return json({ id: 'test-user' });
    if (String(url).includes('/rpc/mis_permisos')) return json(permission ? [{ codigo: 'costes.ver' }] : []);
    if (String(url).startsWith('https://app.stelorder.com/app/')) return json(records);
    throw new Error('Unexpected endpoint');
  };
  return { fetcher, calls };
}
test('rechaza anon, métodos de escritura, origen ajeno y permiso ausente antes de STEL', async () => {
  const { handler } = await mod;
  let calls = 0; const deny = async () => { calls++; throw Error('must not fetch'); };
  assert.equal((await handler(new Request('https://edge.example', { method: 'POST' }), { env, fetcher: deny })).status, 401);
  assert.equal((await handler(new Request('https://edge.example', { method: 'PUT' }), { env, fetcher: deny })).status, 405);
  assert.equal((await handler(request({}, 'user', { Origin: 'https://evil.example' }), { env, fetcher: deny })).status, 403);
  assert.equal(calls, 0);
  const mock = userFetch([], { permission: false });
  assert.equal((await handler(request({ recurso: 'productos' }), { env, fetcher: mock.fetcher })).status, 403);
  assert.equal(mock.calls.filter(x => x.url.includes('stelorder')).length, 0);
});
test('rechaza rutas arbitrarias, filtros de inyección, fechas imposibles y límites abusivos', async () => {
  const { validate } = await mod;
  for (const input of [
    { recurso: 'https://evil.example' }, { recurso: '__proto__' }, { recurso: 'productos', url: 'https://evil.example' },
    { recurso: 'facturas', limite: 5000 }, { recurso: 'facturas', inicio: -1 },
    { recurso: 'facturas', referencia: 'in:all' }, { recurso: 'facturas', desde: '2026-02-30' },
    { recurso: 'facturas', desde: '2026-99-01' }, { recurso: 'facturas', desde: '2026-10-02', hasta: '2026-10-01' },
    { recurso: 'facturas', id: 2, inicio: 0 }, { recurso: 'productos', desde: '2026-01-01' }
  ]) assert.throws(() => validate(input));
});
test('conserva cero frente a dato ausente; no usa precio de venta como compra', async () => {
  const { projectProduct, number } = await mod;
  const p = projectProduct({ id: 701, name: 'Material sintético', 'purchase-price': 0, 'sales-price': 999, 'private-comments': 'secret' });
  assert.equal(p.precio_compra_catalogo, 0); assert.equal(p.unidad, null); assert.equal(p.moneda, null);
  assert.equal(projectProduct({ id: 702, 'sales-price': 88 }).precio_compra_catalogo, null);
  assert.equal(number(''), null); assert.equal(number(false), null); assert.equal(number('1,25'), null);
  assert.equal(number('9'.repeat(400)), null); assert.equal(JSON.stringify(p).includes('secret'), false);
});
test('factura: conserva fechas, cantidades negativas y descuentos; neto solo si constan ambos', async () => {
  const { projectDocument } = await mod;
  const d = projectDocument({ id: 801, date: '2026-10-01', 'currency-code': 'EUR', 'discount-percentage': 5, 'bank-account-id': 99, lines: [
    { id: 1, units: -2, 'item-base-price': 100, 'discount-percentage': 10, 'private-comments': 'private' },
    { id: 2, units: 1, 'item-base-price': 0, 'discount-percentage': 0 },
    { id: 3, units: 1, 'item-base-price': 20 },
    { id: 4, units: 1 }
  ] }, 'facturas');
  assert.equal(d.lineas[0].precio_neto_calculado, 85.5); assert.equal(d.lineas[0].cantidad, -2);
  assert.equal(d.lineas[1].precio_neto_calculado, 0); assert.equal(d.lineas[1].precio_pendiente, false);
  assert.equal(d.lineas[2].precio_neto_calculado, null); assert.equal(d.lineas[3].precio_pendiente, true);
  assert.equal(d.confirmacion_contable, 'NO_DETERMINADA'); assert.equal(d.lineas[0].unidad, null);
  assert.equal(JSON.stringify(d).includes('bank-account'), false); assert.equal(JSON.stringify(d).includes('private'), false);
});
test('precios de compra autenticados: upstream GET exclusivamente y cabeceras sin exponer secretos', async () => {
  const { handler } = await mod;
  const mock = userFetch([{ id: 901, reference: 'FICTICIO-1', 'purchase-price': 12.5, 'sales-price': 77 }]);
  const r = await handler(request({ recurso: 'productos', limite: 1 }), { env, fetcher: mock.fetcher });
  assert.equal(r.status, 200); const payload = await r.json();
  assert.equal(payload.registros[0].precio_compra_catalogo, 12.5);
  const calls = mock.calls.filter(x => x.url.includes('stelorder'));
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.APIKEY, 'stel-private-test');
  assert.equal(JSON.stringify(payload).includes('private-test'), false);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
test('página corta conserva siguiente pero nunca declara catálogo completo', async () => {
  const { queryStel, validate } = await mod;
  const x = await queryStel(validate({ recurso: 'productos', inicio: 10, limite: 25 }), { fetcher: async () => json([{ id: 4 }, { id: 5 }]), key: 'test' });
  assert.equal(x.paginacion.siguiente, 12); assert.equal(x.paginacion.catalogo_completo, false);
  await assert.rejects(queryStel(validate({ recurso: 'productos' }), { fetcher: async () => json([{ id: 4 }, { id: 4 }]), key: 'test' }));
});
test('detalle debe devolver el ID solicitado; documentos sin líneas se declaran incompletos', async () => {
  const { queryStel, validate, projectDocument } = await mod;
  await assert.rejects(queryStel(validate({ recurso: 'facturas', id: 6 }), { fetcher: async () => json([{ id: 7 }]), key: 'test' }));
  assert.equal(projectDocument({ id: 6 }, 'facturas').lineas_incluidas, false);
  assert.equal(projectDocument({ id: 6 }, 'facturas').lineas_completas, false);
  assert.equal(projectDocument({ id: 6, lines: [] }, 'facturas').lineas_completas, true);
});
test('si STEL ignora filtros se descartan filas ajenas sin alterar el avance de página', async () => {
  const { queryStel, validate } = await mod;
  const x = await queryStel(validate({ recurso: 'facturas', desde: '2026-10-01', hasta: '2026-10-21', referencia: 'TEST-REF' }), {
    key: 'test', fetcher: async () => json([
      { id: 1, date: '2026-09-01', 'full-reference': 'TEST-REF' },
      { id: 2, date: '2026-10-01', 'full-reference': 'OTRA' },
      { id: 3, date: '2026-10-10', 'full-reference': 'TEST-REF' },
      { id: 4, 'full-reference': 'TEST-REF' }
    ])
  });
  assert.deepEqual(x.registros.map(r => r.id), [3]); assert.equal(x.filas_fuera_de_filtro, 3);
  assert.equal(x.paginacion.siguiente, 4);
});
test('errores del proveedor no filtran respuesta ni clave', async () => {
  const { handler } = await mod;
  const mock = userFetch([]); const upstream = mock.fetcher;
  const fetcher = async (url, opt) => String(url).includes('stelorder') ? new Response('stel-private-test sensitive body', { status: 400 }) : upstream(url, opt);
  const r = await handler(request({ recurso: 'facturas' }), { env, fetcher });
  assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: 'STEL_HTTP_400' });
});
test('capacidad backend: vencida/inexistente no consulta STEL; válida se consume una sola vez', async () => {
  const { handler } = await mod;
  let available = false, reads = 0, writes = 0;
  const fetcher = async (url, opt = {}) => {
    const u = String(url);
    if (u.includes('stelorder')) { reads++; return json([{ id: 1, 'purchase-price': 3 }]); }
    if (u.includes('token_hash=')) {
      if (opt.method === 'PATCH') { if (!available) return json([]); available = false; writes++; return json([{ id: '00000000-0000-0000-0000-000000000001' }]); }
      assert.match(u, /expires_at=gt\./); assert.match(u, /claimed_at=is.null/);
      return json(available ? [{ id: '00000000-0000-0000-0000-000000000001', request: { recurso: 'productos' } }] : []);
    }
    writes++; return new Response(null, { status: 204 });
  };
  const make = () => request({ consulta_id: '00000000-0000-0000-0000-000000000001' }, 'dc_' + 'A'.repeat(43));
  assert.equal((await handler(make(), { env, fetcher })).status, 401); assert.equal(reads, 0);
  available = true;
  assert.equal((await handler(make(), { env, fetcher })).status, 200); assert.equal(reads, 1); assert.equal(writes, 2);
  assert.equal((await handler(make(), { env, fetcher })).status, 401); assert.equal(reads, 1);
});
