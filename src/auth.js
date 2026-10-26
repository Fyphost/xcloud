'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./db');
const config = require('./config');
const { setCookie, HttpError } = require('./http');
const { randomToken, sha256, safeEqual } = require('./util');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'xc_sid';
const CSRF_COOKIE = 'xc_csrf';

// ---------- Passwords ----------
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- Sessions ----------
function createSession(res, userId) {
  const token = randomToken(32);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + config.sessionTtl);
  setCookie(res, SESSION_COOKIE, token, { maxAge: config.sessionTtl });
}

function loadUser(req) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?`).get(sha256(token), Date.now()) || null;
}

function destroySession(req, res) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

// ---------- CSRF (double-submit cookie) ----------
function ensureCsrf(req, res) {
  let token = req.cookies[CSRF_COOKIE];
  if (!/^[a-f0-9]{64}$/.test(token || '')) {
    token = randomToken(32);
    setCookie(res, CSRF_COOKIE, token, { maxAge: 365 * 24 * 3600 * 1000 });
  }
  return token;
}

function assertCsrf(req, provided) {
  const cookie = req.cookies[CSRF_COOKIE];
  if (!cookie || !provided || !safeEqual(cookie, provided)) {
    throw new HttpError(403, 'Your session expired or the request was invalid. Please refresh the page and try again.');
  }
}

// ---------- Simple login rate limiter ----------
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}
function clearRateLimit(key) { attempts.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
}, WINDOW).unref();

module.exports = {
  hashPassword, verifyPassword, createSession, loadUser, destroySession,
  ensureCsrf, assertCsrf, rateLimited, clearRateLimit,
};
