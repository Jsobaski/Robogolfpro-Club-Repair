const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

test('compareVersions', () => {
  const { compareVersions: c } = require('../desktop/updater');
  assert.equal(c('1.10.0', '1.9.9'), 1);
  assert.equal(c('v1.3.0', '1.3.0'), 0);
  assert.equal(c('1.3.0', '1.3.1'), -1);
  assert.equal(c('2.0.0', '1.99.99'), 1);
});

test('downloads the release, swaps the executable and restarts', async (t) => {
  const newBinary = Buffer.from('NEW VERSION BINARY');
  const digest = 'sha256:' + crypto.createHash('sha256').update(newBinary).digest('hex');
  let tamper = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/latest') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        tag_name: 'v9.9.9', name: 'v9.9.9', html_url: 'http://x/notes',
        assets: [{ name: 'app.bin', size: newBinary.length, digest, browser_download_url: 'http://127.0.0.1:' + server.address().port + '/app.bin' }]
      }));
    }
    res.end(tamper ? Buffer.from('EVIL VERSION BINARY'.slice(0, 18)) : newBinary);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  process.env.ROBOGOLF_UPDATE_URL = 'http://127.0.0.1:' + server.address().port + '/latest';
  process.env.ROBOGOLF_UPDATE_ASSET = 'app.bin';
  delete require.cache[require.resolve('../desktop/updater')];
  const { createUpdater } = require('../desktop/updater');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgp-upd-'));
  const exe = path.join(dir, 'app.bin');
  fs.writeFileSync(exe, 'OLD');
  let restartedTo = null;
  const u = createUpdater({ currentVersion: '1.3.0', exePath: exe, enabled: true, onRestart: (v) => { restartedTo = v; } });

  const info = await u.check();
  assert.equal(info.available, true);
  assert.equal(info.latest.version, '9.9.9');

  tamper = true;
  await assert.rejects(u.install(), /integrity/);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'OLD', 'failed update leaves the working version in place');
  assert.equal(restartedTo, null);

  tamper = false;
  await u.install();
  assert.equal(fs.readFileSync(exe, 'utf8'), 'NEW VERSION BINARY');
  assert.equal(fs.readFileSync(path.join(dir, 'app.old.bin'), 'utf8'), 'OLD');
  assert.equal(restartedTo, '9.9.9');

  // Same version -> nothing to do
  const same = createUpdater({ currentVersion: '9.9.9', exePath: exe, enabled: true, onRestart() {} });
  assert.equal((await same.check()).available, false);
});
