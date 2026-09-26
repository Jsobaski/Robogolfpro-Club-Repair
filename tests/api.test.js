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
  assert.deepEqual(r.body, { configured: true, data: null });
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
