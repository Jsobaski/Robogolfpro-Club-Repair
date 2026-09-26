/*
 * Local stand-in for Vercel: serves app/ and the /api functions, storing the
 * catalog in a JSON file.  Usage:  ADMIN_PIN=1234 npm run dev
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.env.LOCAL_STORE_FILE = process.env.LOCAL_STORE_FILE || path.join(root, '.local-store.json');
process.env.ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const routes = {
  '/api/catalog': require('../api/catalog'),
  '/api/verify-pin': require('../api/verify-pin')
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (routes[url.pathname]) return routes[url.pathname](req, res);
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(root, 'app', rel);
  if (!file.startsWith(path.join(root, 'app'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log('RoboGolf POS on http://localhost:' + port + '  (admin PIN ' + process.env.ADMIN_PIN + ')'));
