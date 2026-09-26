/*
 * Self-update for the Windows app.
 *
 * Checks the latest GitHub Release of this (public) repository. When it is
 * newer than the running version and has a RoboGolfPOS.exe asset, the app can
 * download it, swap it in next to the running .exe and restart:
 *
 *   RoboGolfPOS.exe      (running)  -> renamed to RoboGolfPOS.old.exe
 *   RoboGolfPOS.new.exe  (download) -> renamed to RoboGolfPOS.exe, started
 *
 * Windows allows renaming a running .exe, just not overwriting it. The old
 * file is deleted the next time the app starts. The data folder is untouched.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'Jsobaski/Robogolfpro-Club-Repair';
const LATEST_URL = process.env.ROBOGOLF_UPDATE_URL || 'https://api.github.com/repos/' + REPO + '/releases/latest';
const ASSET = process.env.ROBOGOLF_UPDATE_ASSET || 'RoboGolfPOS.exe';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// "1.10.0" > "1.9.2"; ignores a leading "v" and any "-suffix".
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('-')[0].split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function createUpdater({ currentVersion, exePath, enabled, onRestart }) {
  const state = {
    version: currentVersion,
    enabled,
    checkedAt: null,
    latest: null,          // { version, name, url, size, digest, notesUrl }
    installing: false,
    error: null
  };

  function info() {
    const available = !!(state.enabled && state.latest && compareVersions(state.latest.version, state.version) > 0);
    return {
      version: state.version,
      updatesEnabled: state.enabled,
      checkedAt: state.checkedAt,
      available,
      latest: available ? { version: state.latest.version, name: state.latest.name, notesUrl: state.latest.notesUrl } : null,
      installing: state.installing,
      error: state.error
    };
  }

  async function check() {
    if (!state.enabled) return info();
    try {
      const res = await fetch(LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RoboGolfPOS/' + state.version }
      });
      state.checkedAt = new Date().toISOString();
      if (res.status === 404) { state.latest = null; state.error = null; return info(); } // no releases yet
      if (!res.ok) throw new Error('GitHub returned ' + res.status);
      const rel = await res.json();
      const asset = (rel.assets || []).find((a) => a.name === ASSET);
      if (!rel.tag_name || !asset || rel.draft || rel.prerelease) { state.latest = null; state.error = null; return info(); }
      state.latest = {
        version: rel.tag_name.replace(/^v/, ''),
        name: rel.name || rel.tag_name,
        url: asset.browser_download_url,
        size: asset.size,
        digest: asset.digest || null, // "sha256:<hex>" when GitHub provides it
        notesUrl: rel.html_url
      };
      state.error = null;
    } catch (e) {
      state.error = 'Could not check for updates (' + e.message + ')';
    }
    return info();
  }

  async function install() {
    if (!state.enabled) throw new Error('Updates are only available in the Windows app');
    if (state.installing) throw new Error('An update is already being installed');
    await check();
    const i = info();
    if (!i.available) throw new Error('No update available');
    state.installing = true;
    state.error = null;
    const dir = path.dirname(exePath);
    const ext = path.extname(exePath);
    const base = path.basename(exePath, ext);
    const newPath = path.join(dir, base + '.new' + ext);
    const oldPath = path.join(dir, base + '.old' + ext);
    try {
      const res = await fetch(state.latest.url, { headers: { 'User-Agent': 'RoboGolfPOS/' + state.version } });
      if (!res.ok) throw new Error('Download failed (' + res.status + ')');
      const buf = Buffer.from(await res.arrayBuffer());
      if (state.latest.size && buf.length !== state.latest.size) throw new Error('Download was incomplete');
      if (state.latest.digest && state.latest.digest.startsWith('sha256:')) {
        const got = crypto.createHash('sha256').update(buf).digest('hex');
        if (got !== state.latest.digest.slice(7)) throw new Error('Downloaded file failed its integrity check');
      }
      if (process.platform === 'win32' && buf.slice(0, 2).toString() !== 'MZ') throw new Error('Downloaded file is not a Windows program');

      fs.writeFileSync(newPath, buf);
      fs.chmodSync(newPath, 0o755);
      try { fs.unlinkSync(oldPath); } catch (e) { /* not there */ }
      fs.renameSync(exePath, oldPath);
      try {
        fs.renameSync(newPath, exePath);
      } catch (e) {
        fs.renameSync(oldPath, exePath); // put the working version back
        throw e;
      }
    } catch (e) {
      state.installing = false;
      try { fs.unlinkSync(newPath); } catch (x) { /* ignore */ }
      state.error = e.code === 'EPERM' || e.code === 'EACCES'
        ? 'Windows would not let the app replace itself. Move RoboGolfPOS.exe to a folder like Documents and try again.'
        : e.message;
      throw new Error(state.error);
    }
    onRestart(state.latest.version);
    return info();
  }

  function cleanupOld() {
    const ext = path.extname(exePath);
    const oldPath = path.join(path.dirname(exePath), path.basename(exePath, ext) + '.old' + ext);
    // The previous process may take a moment to exit after an update.
    let tries = 0;
    (function attempt() {
      if (!fs.existsSync(oldPath)) return;
      try { fs.unlinkSync(oldPath); } catch (e) { if (++tries < 10) setTimeout(attempt, 2000); }
    })();
  }

  function start() {
    if (!state.enabled) return;
    cleanupOld();
    check();
    setInterval(check, CHECK_EVERY_MS).unref();
  }

  // HTTP handlers --------------------------------------------------------------
  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }
  // The custom header forces a CORS preflight, so other websites can't trigger these.
  function fromApp(req) { return req.headers['x-robogolf'] === '1'; }

  const routes = {
    '/api/app-info': (req, res) => send(res, 200, info()),
    '/api/update/check': async (req, res) => {
      if (req.method !== 'POST' || !fromApp(req)) return send(res, 405, { error: 'Not allowed' });
      send(res, 200, await check());
    },
    '/api/update/install': async (req, res) => {
      if (req.method !== 'POST' || !fromApp(req)) return send(res, 405, { error: 'Not allowed' });
      try { send(res, 200, await install()); } catch (e) { send(res, 409, Object.assign(info(), { error: e.message })); }
    }
  };

  return { info, check, install, start, routes };
}

module.exports = { createUpdater, compareVersions };
