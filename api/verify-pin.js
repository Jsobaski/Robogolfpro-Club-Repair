/*
 * POST /api/verify-pin { pin } -> 200 if it matches the admin PIN.
 * Desktop app only: if no PIN has been chosen yet, the first PIN sent becomes the PIN.
 */
'use strict';

const { send, readBody, checkPin, pinStatus, createPin, sleep } = require('../lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const body = await readBody(req, 4096);
    if (pinStatus() === 'setup') {
      const pin = String(body.pin || '');
      if (pin.length < 4) return send(res, 400, { error: 'Choose a PIN of at least 4 characters' });
      createPin(pin);
      return send(res, 200, { ok: true, created: true });
    }
    const r = checkPin(body.pin);
    if (r === 'unset') return send(res, 503, { error: 'ADMIN_PIN is not set in the Vercel project settings.' });
    if (r !== 'ok') { await sleep(800); return send(res, 401, { error: 'Wrong PIN' }); }
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 400, { error: 'Bad request' });
  }
};
