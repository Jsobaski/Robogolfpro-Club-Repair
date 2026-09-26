/*
 * Local stand-in for Vercel: serves app/ and the /api functions, storing the
 * catalog in a JSON file.  Usage:  ADMIN_PIN=1234 npm run dev
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.env.LOCAL_STORE_FILE = process.env.LOCAL_STORE_FILE || path.join(root, '.local-store.json');
process.env.ADMIN_PIN = process.env.ADMIN_PIN || '1234';

const { createServer } = require('../lib/local-server');

const server = createServer((rel) => {
  try { return fs.readFileSync(path.join(root, 'app', rel)); } catch (e) { return null; }
});
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log('RoboGolf POS on http://localhost:' + port + '  (admin PIN ' + process.env.ADMIN_PIN + ')'));
