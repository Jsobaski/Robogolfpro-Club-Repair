/*
 * GET  /api/catalog  -> { configured, data: { catalog, settings, version, updatedAt } | null }
 * PUT  /api/catalog  -> save; requires header "x-admin-pin" and body
 *                      { catalog, settings, baseVersion }.
 *                      Returns 409 with the current data if someone saved in between.
 */
'use strict';

const store = require('../lib/store');
const { send, readBody, checkPin, pinStatus, sleep } = require('../lib/http');
const { validateCatalog, validateSettings } = require('../lib/validate');

module.exports = async function handler(req, res) {
  try {
    if (!store.isConfigured()) {
      return send(res, req.method === 'GET' ? 200 : 503, {
        configured: false, data: null,
        error: 'Storage is not connected. Add an Upstash Redis database to this Vercel project.'
      });
    }

    if (req.method === 'GET') {
      return send(res, 200, { configured: true, storage: store.kind(), pin: pinStatus(), location: process.env.DATA_DIR_DISPLAY || null, data: await store.read() });
    }

    if (req.method === 'PUT') {
      const auth = checkPin(req.headers['x-admin-pin']);
      if (auth === 'unset') return send(res, 503, { error: pinStatus() === 'setup' ? 'Create an admin PIN first.' : 'ADMIN_PIN is not set in the Vercel project settings.' });
      if (auth !== 'ok') { await sleep(800); return send(res, 401, { error: 'Wrong PIN' }); }

      const body = await readBody(req, 1024 * 1024);
      const err = validateCatalog(body.catalog) || validateSettings(body.settings);
      if (err) return send(res, 400, { error: err });

      const current = await store.read();
      const currentVersion = current ? current.version : 0;
      if ((body.baseVersion || 0) !== currentVersion) {
        return send(res, 409, { error: 'The catalog was changed on another device.', data: current });
      }
      const doc = {
        catalog: body.catalog,
        settings: body.settings,
        version: currentVersion + 1,
        updatedAt: new Date().toISOString()
      };
      await store.write(doc);
      return send(res, 200, { configured: true, storage: store.kind(), pin: pinStatus(), data: doc });
    }

    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Server error' });
  }
};
