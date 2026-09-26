'use strict';

const crypto = require('crypto');

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

// Returns 'ok' | 'bad' | 'unset'
function checkPin(given) {
  const pin = process.env.ADMIN_PIN;
  if (!pin) return 'unset';
  return crypto.timingSafeEqual(sha(given || ''), sha(pin)) ? 'ok' : 'bad';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { send, readBody, checkPin, sleep };
