/*
 * Builds the desktop app as a single executable using Node's built-in
 * "single executable application" feature: the app files and server code are
 * embedded into a copy of node.exe.
 *
 *   npm install && npm run build:exe
 *
 * Output: dist/RoboGolfPOS.exe on Windows (dist/robogolf-pos elsewhere).
 * Run it on the OS you are building for — the Windows .exe is built by the
 * GitHub Actions workflow in .github/workflows/build-desktop.yml.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const dist = path.join(root, 'dist');
const isWin = process.platform === 'win32';

async function main() {
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(dist, { recursive: true });

  // 1. Bundle the server into one CommonJS file (SEA can only run a single script).
  await require('esbuild').build({
    entryPoints: [path.join(root, 'desktop', 'main.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node' + process.versions.node.split('.')[0],
    outfile: path.join(build, 'main.cjs'),
    external: ['node:sea'],
    logLevel: 'warning'
  });

  // 2. Embed every file in app/ as an asset.
  const assets = {};
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else assets[path.relative(root, full).split(path.sep).join('/')] = full;
    }
  })(path.join(root, 'app'));

  const config = path.join(build, 'sea-config.json');
  const blob = path.join(build, 'sea-prep.blob');
  fs.writeFileSync(config, JSON.stringify({
    main: path.join(build, 'main.cjs'),
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

  // 3. Copy this Node binary and inject the blob.
  const out = path.join(dist, isWin ? 'RoboGolfPOS.exe' : 'robogolf-pos');
  fs.copyFileSync(process.execPath, out);
  fs.chmodSync(out, 0o755);

  if (isWin) {
    // Remove Node's code signature (it becomes invalid once we modify the file),
    // then set the icon and file details shown in Explorer.
    try { execFileSync('signtool', ['remove', '/s', out], { stdio: 'ignore' }); } catch (e) { /* signtool optional */ }
    const { rcedit } = await import('rcedit');
    await rcedit(out, {
      icon: path.join(root, 'desktop', 'icon.ico'),
      'file-version': require('../package.json').version,
      'product-version': require('../package.json').version,
      'version-string': {
        ProductName: 'RoboGolf POS',
        FileDescription: 'RoboGolf POS',
        CompanyName: 'RoboGolfPro Las Vegas',
        OriginalFilename: 'RoboGolfPOS.exe',
        LegalCopyright: ''
      }
    });
  }

  const { inject } = require('postject');
  await inject(out, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined
  });

  const mb = (fs.statSync(out).size / 1048576).toFixed(1);
  console.log('Built ' + path.relative(root, out) + ' (' + mb + ' MB)');
}

main().catch((e) => { console.error(e); process.exit(1); });
