const test = require('node:test');
const assert = require('node:assert/strict');

test('uses the Upstash REST API when Vercel KV env vars are set', async () => {
  process.env.KV_REST_API_URL = 'https://example.upstash.io/';
  process.env.KV_REST_API_TOKEN = 'tok';
  const db = {};
  const calls = [];
  global.fetch = async (url, init) => {
    const cmd = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, cmd });
    const result = cmd[0] === 'SET' ? (db[cmd[1]] = cmd[2], 'OK') : (db[cmd[1]] ?? null);
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  const store = require('../lib/store');
  assert.equal(store.isConfigured(), true);
  assert.equal(await store.read(), null);
  await store.write({ version: 3 });
  assert.deepEqual(await store.read(), { version: 3 });
  assert.equal(calls[0].url, 'https://example.upstash.io');
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.deepEqual(calls[1].cmd, ['SET', 'robogolf:catalog', '{"version":3}']);
});
