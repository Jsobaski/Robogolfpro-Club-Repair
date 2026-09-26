/*
 * RoboGolf POS desktop app (Windows .exe).
 *
 * Starts a small web server on this PC (127.0.0.1 only — not reachable from
 * other computers), saves the catalog to a folder on disk, and opens the app in
 * its own Microsoft Edge / Chrome window. Close the console window to quit.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let sea = null;
try { sea = require('node:sea'); } catch (e) { /* older Node, dev only */ }
const packaged = !!(sea && sea.isSea());

const PORT = Number(process.env.ROBOGOLF_PORT) || 47817;
const URL = 'http://127.0.0.1:' + PORT + '/';
const APP_NAME = 'RoboGolf POS';

// ---------------------------------------------------------------- data folder
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (e) { return false; }
}

function pickDataDir() {
  if (process.env.ROBOGOLF_DATA_DIR) return process.env.ROBOGOLF_DATA_DIR;
  // Next to the .exe, so it's easy to find and back up. Falls back to the
  // user's AppData if the .exe sits somewhere read-only (e.g. Program Files).
  const beside = packaged
    ? path.join(path.dirname(process.execPath), 'RoboGolf POS Data')
    : path.join(__dirname, '..', '.desktop-data');
  if (writable(beside)) return beside;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'RoboGolfPOS');
}

const dataDir = pickDataDir();
fs.mkdirSync(dataDir, { recursive: true });
process.env.LOCAL_STORE_FILE = path.join(dataDir, 'catalog.json');
process.env.PIN_FILE = path.join(dataDir, 'admin-pin.json');
process.env.DATA_DIR_DISPLAY = dataDir;
// Never talk to a cloud database from the desktop build.
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.ADMIN_PIN;

// ---------------------------------------------------------------- static files
function readStatic(rel) {
  if (packaged) {
    try { return Buffer.from(sea.getAsset('app/' + rel.replace(/\\/g, '/'))); } catch (e) { return null; }
  }
  try { return fs.readFileSync(path.join(__dirname, '..', 'app', rel)); } catch (e) { return null; }
}

// ---------------------------------------------------------------- app window
function findBrowser() {
  if (process.platform !== 'win32') return null;
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const rels = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe'];
  for (const rel of rels) {
    for (const root of roots) {
      const p = path.join(root, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function openWindow() {
  if (process.env.ROBOGOLF_NO_BROWSER) return;
  const browser = findBrowser();
  const opts = { detached: true, stdio: 'ignore' };
  try {
    if (browser) spawn(browser, ['--app=' + URL, '--window-size=1400,900'], opts).unref();
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', URL], opts).unref();
    else if (process.platform === 'darwin') spawn('open', [URL], opts).unref();
    else spawn('xdg-open', [URL], opts).unref();
  } catch (e) {
    console.log('Open this address in your browser: ' + URL);
  }
}

// If the app is already running (double-clicked twice), just open another window.
function alreadyRunning() {
  return new Promise((resolve) => {
    const req = http.get(URL + 'api/catalog', { timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function waitForKeyThenExit(code) {
  console.log('\nPress Enter to close this window.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(code));
}

// ---------------------------------------------------------------- start
const { createServer } = require('../lib/local-server');
const server = createServer(readStatic);

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    if (await alreadyRunning()) {
      console.log(APP_NAME + ' is already running — opening another window.');
      openWindow();
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    console.error('Port ' + PORT + ' is being used by another program, so ' + APP_NAME + ' cannot start.');
  } else {
    console.error('Could not start: ' + err.message);
  }
  waitForKeyThenExit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  if (process.platform === 'win32') process.title = APP_NAME;
  console.log('==============================================');
  console.log('  ' + APP_NAME + ' is running');
  console.log('==============================================');
  console.log('  Keep this window open while using the app');
  console.log('  (you can minimize it). Close it to quit.');
  console.log('');
  console.log('  Catalog is saved in:');
  console.log('  ' + dataDir);
  console.log('');
  console.log('  If the app window closed, reopen it at:');
  console.log('  ' + URL);
  openWindow();
});
