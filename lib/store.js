/*
 * Storage for the shared catalog + settings document.
 *
 * Production (Vercel): Upstash Redis via its REST API. Connect an Upstash Redis
 * database to the Vercel project (Storage tab / Marketplace) and Vercel injects
 * KV_REST_API_URL and KV_REST_API_TOKEN automatically.
 *
 * Local development: set LOCAL_STORE_FILE to a JSON file path (scripts/dev-server.js does this).
 */
'use strict';

const fs = require('fs');

const KEY = process.env.STORE_KEY || 'robogolf:catalog';

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function redis(cmd) {
  const cfg = redisConfig();
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error('Redis error: ' + (body.error || res.status));
  return body.result;
}

// 'cloud' (Upstash) or 'local' (a file on this computer)
function kind() { return redisConfig() ? 'cloud' : 'local'; }

function isConfigured() {
  return !!(redisConfig() || process.env.LOCAL_STORE_FILE);
}

async function read() {
  if (redisConfig()) {
    const raw = await redis(['GET', KEY]);
    return raw ? JSON.parse(raw) : null;
  }
  const file = process.env.LOCAL_STORE_FILE;
  if (file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  }
  throw new Error('Storage is not configured');
}

async function write(doc) {
  const json = JSON.stringify(doc);
  if (redisConfig()) { await redis(['SET', KEY, json]); return; }
  const file = process.env.LOCAL_STORE_FILE;
  if (file) {
    // Write to a temp file then rename, so a crash or power cut mid-save
    // can't leave a half-written catalog.
    // The previous version is kept as <file>.bak.
    const tmp = file + '.tmp';
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
    return;
  }
  throw new Error('Storage is not configured');
}

module.exports = { isConfigured, kind, read, write };
