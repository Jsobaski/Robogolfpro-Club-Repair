'use strict';

const crypto = require('crypto');
const fs = require('fs');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Vercel pre-parses JSON bodies into req.body; plain Node (dev server) does not.
async function readBody(req, limit) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

/*
 * Two ways to configure the admin PIN:
 *  - ADMIN_PIN env var (Vercel)
 *  - PIN_FILE (desktop app): a salted hash on disk, created the first time
 *    someone unlocks editing.
 */
function readPinFile() {
  const file = process.env.PIN_FILE;
  if (!file) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32); }

// 'set' | 'setup' (desktop, no PIN chosen yet) | 'missing' (server misconfigured)
function pinStatus() {
  if (process.env.ADMIN_PIN) return 'set';
  if (process.env.PIN_FILE) return readPinFile() ? 'set' : 'setup';
  return 'missing';
}

// Returns 'ok' | 'bad' | 'unset'
function checkPin(given) {
  const pin = process.env.ADMIN_PIN;
  if (pin) return crypto.timingSafeEqual(sha(given || ''), sha(pin)) ? 'ok' : 'bad';
  const stored = readPinFile();
  if (!stored) return 'unset';
  const actual = hashPin(given || '', Buffer.from(stored.salt, 'hex'));
  return crypto.timingSafeEqual(actual, Buffer.from(stored.hash, 'hex')) ? 'ok' : 'bad';
}

function createPin(pin) {
  const salt = crypto.randomBytes(16);
  const doc = { salt: salt.toString('hex'), hash: hashPin(pin, salt).toString('hex'), createdAt: new Date().toISOString() };
  fs.writeFileSync(process.env.PIN_FILE, JSON.stringify(doc));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { send, readBody, checkPin, pinStatus, createPin, sleep };
