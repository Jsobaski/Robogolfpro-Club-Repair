/* POST /api/verify-pin { pin } -> 200 if it matches ADMIN_PIN */
'use strict';

const { send, readBody, checkPin, sleep } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const body = await readBody(req, 4096);
    const r = checkPin(body.pin);
    if (r === 'unset') return send(res, 503, { error: 'ADMIN_PIN is not set in the Vercel project settings.' });
    if (r !== 'ok') { await sleep(800); return send(res, 401, { error: 'Wrong PIN' }); }
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: 'Bad request' });
  }
};
