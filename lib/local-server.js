/*
 * HTTP server that serves the app and the /api functions on this machine.
 * Used by the desktop .exe (desktop/main.js) and by `npm run dev`.
 * `readStatic(relPath)` returns a Buffer or null.
 */
'use strict';

const http = require('http');
const path = require('path');

const catalogHandler = require('../api/catalog');
const pinHandler = require('../api/verify-pin');

const routes = { '/api/catalog': catalogHandler, '/api/verify-pin': pinHandler };
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};

function createServer(readStatic) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (routes[url.pathname]) return routes[url.pathname](req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel.split(/[\\/]/).includes('..')) { res.statusCode = 403; return res.end(); }
    const data = readStatic(rel);
    if (!data) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(rel)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  });
}

module.exports = { createServer };
