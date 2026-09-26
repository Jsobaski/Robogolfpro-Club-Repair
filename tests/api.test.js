const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rgp-')), 'store.json');
process.env.LOCAL_STORE_FILE = file;
process.env.ADMIN_PIN = '4821';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const catalogHandler = require('../api/catalog');
const pinHandler = require('../api/verify-pin');
const { DEFAULT_CATALOG, DEFAULT_SETTINGS } = require('../app/catalog-defaults');

// Minimal stand-in for Node's req/res as Vercel passes them.
async function call(handler, { method = 'GET', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = headers;
  const res = {
    statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s ? JSON.parse(s) : undefined; }
  };
  await handler(req, res);
  return res;
}
const doc = (baseVersion, extra = {}) => ({ catalog: DEFAULT_CATALOG, settings: DEFAULT_SETTINGS, baseVersion, ...extra });

test('empty store returns null data', async () => {
  const r = await call(catalogHandler);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { configured: true, storage: 'local', pin: 'set', location: null, data: null });
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('save requires the admin PIN', async () => {
  const r = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': 'nope' }, body: doc(0) });
  assert.equal(r.statusCode, 401);
  assert.equal(fs.existsSync(file), false);
});

test('save, read back, and reject stale writes', async () => {
  const ok = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': '4821' }, body: doc(0) });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.version, 1);

  const got = await call(catalogHandler);
  assert.equal(got.body.data.catalog.items.length, DEFAULT_CATALOG.items.length);

  const stale = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': '4821' }, body: doc(0) });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.data.version, 1);
});

test('rejects malformed catalogs', async () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_CATALOG));
  bad.items.push({ id: 'x', name: 'Orphan', categoryId: 'missing', price: 1 });
  const r = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': '4821' }, body: doc(1, { catalog: bad }) });
  assert.equal(r.statusCode, 400);
  const r2 = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': '4821' }, body: doc(1, { settings: { taxRate: 'x' } }) });
  assert.equal(r2.statusCode, 400);
});

test('verify-pin', async () => {
  assert.equal((await call(pinHandler, { method: 'POST', body: { pin: '4821' } })).statusCode, 200);
  assert.equal((await call(pinHandler, { method: 'POST', body: { pin: '0000' } })).statusCode, 401);
});

test('desktop mode: first PIN entered becomes the admin PIN', async () => {
  const saved = process.env.ADMIN_PIN;
  delete process.env.ADMIN_PIN;
  process.env.PIN_FILE = path.join(path.dirname(file), 'pin.json');
  try {
    assert.equal((await call(catalogHandler)).body.pin, 'setup');
    assert.equal((await call(pinHandler, { method: 'POST', body: { pin: '12' } })).statusCode, 400);
    const created = await call(pinHandler, { method: 'POST', body: { pin: 'golf99' } });
    assert.equal(created.statusCode, 200);
    assert.equal(created.body.created, true);
    assert.equal(fs.readFileSync(process.env.PIN_FILE, 'utf8').includes('golf99'), false);
    assert.equal((await call(catalogHandler)).body.pin, 'set');
    assert.equal((await call(pinHandler, { method: 'POST', body: { pin: 'wrong' } })).statusCode, 401);
    assert.equal((await call(pinHandler, { method: 'POST', body: { pin: 'golf99' } })).statusCode, 200);
    const put = await call(catalogHandler, { method: 'PUT', headers: { 'x-admin-pin': 'golf99' }, body: doc(1) });
    assert.equal(put.statusCode, 200);
    assert.equal(fs.existsSync(file + '.bak'), true);
  } finally {
    process.env.ADMIN_PIN = saved;
    delete process.env.PIN_FILE;
  }
});
