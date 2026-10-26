'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const config = require('./config');
const db = require('./db');
const Router = require('./router');
const views = require('./views');
const auth = require('./auth');
const { HttpError, parseCookies, send, json, redirect, parseBody, clientIp, origin } = require('./http');
const { randomToken, randomSlug, sanitizeFileName, contentDisposition } = require('./util');

const router = new Router();

// ---------------------------------------------------------------- helpers
function requireUser(ctx, { api = false } = {}) {
  if (ctx.user) return ctx.user;
  if (api) throw new HttpError(401, 'Please log in.');
  const err = new HttpError(302, 'Login required');
  err.location = `/login?next=${encodeURIComponent(ctx.url.pathname)}`;
  throw err;
}

function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/dashboard';
}

function storagePath(storageName) {
  return path.join(config.uploadsDir, storageName);
}

function usageFor(userId) {
  return db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS used, COALESCE(SUM(downloads),0) AS downloads FROM files WHERE user_id = ?').get(userId);
}

function fileDto(f, base) {
  return {
    id: f.id, slug: f.slug, name: f.name, size: f.size, isPublic: !!f.is_public,
    downloads: f.downloads, createdAt: f.created_at, url: `${base}/f/${f.slug}`,
  };
}

function ownFile(userId, id) {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(Number(id), userId);
  if (!file) throw new HttpError(404, 'File not found.');
  return file;
}

async function streamFile(req, res, file, { disposition = true } = {}) {
  const p = storagePath(file.storage_name);
  let stat;
  try { stat = await fsp.stat(p); } catch { throw new HttpError(410, 'This file is no longer available.'); }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': disposition ? contentDisposition(file.name) : 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(fs.createReadStream(p), res).catch(() => {});
}

// ---------------------------------------------------------------- pages
router.get('/', (ctx) => send(ctx.res, 200, views.home(ctx)));

router.get('/login', (ctx) => {
  if (ctx.user) return redirect(ctx.res, '/dashboard');
  send(ctx.res, 200, views.authPage({ ...ctx, mode: 'login', next: ctx.url.searchParams.get('next') || '' }));
});

router.post('/login', async (ctx) => {
  const body = await parseBody(ctx.req);
  auth.assertCsrf(ctx.req, body._csrf);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const render = (status, error) => send(ctx.res, status, views.authPage({ ...ctx, mode: 'login', error, values: { email }, next: body.next }));

  const key = `${clientIp(ctx.req)}|${email}`;
  if (auth.rateLimited(key)) return render(429, 'Too many login attempts. Please try again in 15 minutes.');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
    return render(401, 'Invalid email or password.');
  }
  auth.clearRateLimit(key);
  auth.createSession(ctx.res, user.id);
  redirect(ctx.res, safeNext(body.next));
});

router.get('/register', (ctx) => {
  if (ctx.user) return redirect(ctx.res, '/dashboard');
  if (!config.allowRegistration) throw new HttpError(403, 'Registration is currently closed.');
  send(ctx.res, 200, views.authPage({ ...ctx, mode: 'register' }));
});

router.post('/register', async (ctx) => {
  if (!config.allowRegistration) throw new HttpError(403, 'Registration is currently closed.');
  const body = await parseBody(ctx.req);
  auth.assertCsrf(ctx.req, body._csrf);
  const name = String(body.name || '').trim().slice(0, 60);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const render = (status, error) => send(ctx.res, status, views.authPage({ ...ctx, mode: 'register', error, values: { name, email } }));

  if (auth.rateLimited(`register|${clientIp(ctx.req)}`)) return render(429, 'Too many sign-ups from your network. Please try again later.');
  if (!name) return render(400, 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return render(400, 'Please enter a valid email address.');
  if (password.length < 8 || password.length > 200) return render(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return render(409, 'An account with this email already exists.');

  const hash = await auth.hashPassword(password);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(email, name, hash, Date.now());
  auth.createSession(ctx.res, Number(lastInsertRowid));
  redirect(ctx.res, '/dashboard');
});

router.post('/logout', async (ctx) => {
  const body = await parseBody(ctx.req);
  auth.assertCsrf(ctx.req, body._csrf);
  auth.destroySession(ctx.req, ctx.res);
  redirect(ctx.res, '/');
});

router.get('/dashboard', (ctx) => {
  requireUser(ctx);
  send(ctx.res, 200, views.dashboard(ctx));
});

// ---------------------------------------------------------------- download page
function publicFile(ctx, slug) {
  const file = db.prepare(`SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.user_id WHERE f.slug = ?`).get(slug);
  const isOwner = !!(file && ctx.user && ctx.user.id === file.user_id);
  if (!file || (!file.is_public && !isOwner)) {
    throw new HttpError(404, 'This file does not exist, was removed, or is private.');
  }
  return { file, isOwner };
}

router.get('/f/:slug', (ctx) => {
  const { file, isOwner } = publicFile(ctx, ctx.params.slug);
  const ticket = randomToken(24);
  db.prepare('INSERT INTO download_tickets (token, file_id, created_at) VALUES (?, ?, ?)').run(ticket, file.id, Date.now());
  ctx.res.setHeader('Cache-Control', 'no-store');
  send(ctx.res, 200, views.downloadPage({ ...ctx, file, owner: file.owner_name, ticket, isOwner }));
});

router.post('/f/:slug/download', async (ctx) => {
  const { file } = publicFile(ctx, ctx.params.slug);
  const body = await parseBody(ctx.req);
  const t = db.prepare('SELECT * FROM download_tickets WHERE token = ? AND file_id = ?').get(String(body.ticket || ''), file.id);
  const now = Date.now();

  if (!t || now - t.created_at > config.ticketTtl) {
    return redirect(ctx.res, `/f/${file.slug}`); // expired: start over with a fresh countdown
  }
  // Enforce the countdown on the server too (allow 1s of clock/network slack).
  const remaining = config.downloadWait * 1000 - (now - t.created_at) - 1000;
  if (remaining > 0) {
    throw new HttpError(425, `Please wait ${Math.ceil(remaining / 1000)} more second(s) before downloading.`);
  }
  if (!t.used) {
    db.prepare('UPDATE download_tickets SET used = 1 WHERE token = ?').run(t.token);
    db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(file.id);
  }
  await streamFile(ctx.req, ctx.res, file);
});

// ---------------------------------------------------------------- JSON API (dashboard)
function apiGuard(ctx) {
  const user = requireUser(ctx, { api: true });
  if (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD') auth.assertCsrf(ctx.req, ctx.req.headers['x-csrf-token']);
  return user;
}

router.get('/api/files', (ctx) => {
  const user = apiGuard(ctx);
  const base = origin(ctx.req);
  const files = db.prepare('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  json(ctx.res, 200, { files: files.map((f) => fileDto(f, base)), usage: { ...usageFor(user.id), quota: config.userQuota } });
});

router.post('/api/upload', async (ctx) => {
  const user = apiGuard(ctx);
  const { req } = ctx;
  let name;
  try { name = sanitizeFileName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { name = ''; }
  if (!name) throw new HttpError(400, 'Missing or invalid file name.');

  const declared = Number(req.headers['content-length']);
  if (!Number.isFinite(declared) || declared < 0) throw new HttpError(411, 'Content-Length is required.');
  if (declared > config.maxFileSize) throw new HttpError(413, `File exceeds the ${Math.round(config.maxFileSize / 1048576)} MB limit.`);
  const { used } = usageFor(user.id);
  if (used + declared > config.userQuota) throw new HttpError(413, 'Not enough storage space left in your account.');

  const storageName = randomToken(16);
  const dest = storagePath(storageName);
  // Node's HTTP parser never delivers more bytes than Content-Length, so `declared`
  // is an upper bound for the body size; we still verify the exact byte count.
  let received = 0;
  const out = fs.createWriteStream(dest, { flags: 'wx' });
  req.on('data', (chunk) => { received += chunk.length; });
  try {
    await pipeline(req, out);
    if (received !== declared) throw new HttpError(400, 'Upload was incomplete.');
  } catch (err) {
    await fsp.rm(dest, { force: true });
    throw err instanceof HttpError ? err : new HttpError(400, 'Upload failed or was cancelled.');
  }

  // Re-check quota atomically after the upload finished (parallel uploads).
  let file;
  try {
    db.exec('BEGIN IMMEDIATE');
    if (usageFor(user.id).used + received > config.userQuota) throw new HttpError(413, 'Not enough storage space left in your account.');
    let slug;
    do { slug = randomSlug(10); } while (db.prepare('SELECT 1 FROM files WHERE slug = ?').get(slug));
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO files (user_id, slug, name, storage_name, size, is_public, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    ).run(user.id, slug, name, storageName, received, Date.now());
    db.exec('COMMIT');
    file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    await fsp.rm(dest, { force: true });
    throw err;
  }
  json(ctx.res, 201, { file: fileDto(file, origin(req)), usage: { ...usageFor(user.id), quota: config.userQuota } });
});

router.patch('/api/files/:id', async (ctx) => {
  const user = apiGuard(ctx);
  const file = ownFile(user.id, ctx.params.id);
  const body = await parseBody(ctx.req);
  if (body.name !== undefined) {
    const name = sanitizeFileName(body.name);
    if (!name) throw new HttpError(400, 'Please enter a valid file name.');
    db.prepare('UPDATE files SET name = ? WHERE id = ?').run(name, file.id);
  }
  if (body.isPublic !== undefined) {
    db.prepare('UPDATE files SET is_public = ? WHERE id = ?').run(body.isPublic ? 1 : 0, file.id);
  }
  const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(file.id);
  json(ctx.res, 200, { file: fileDto(updated, origin(ctx.req)) });
});

router.delete('/api/files/:id', async (ctx) => {
  const user = apiGuard(ctx);
  const file = ownFile(user.id, ctx.params.id);
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  await fsp.rm(storagePath(file.storage_name), { force: true });
  json(ctx.res, 200, { ok: true, usage: { ...usageFor(user.id), quota: config.userQuota } });
});

// Owners download their own files directly from the dashboard, no countdown.
router.get('/api/files/:id/download', async (ctx) => {
  const user = requireUser(ctx, { api: true });
  await streamFile(ctx.req, ctx.res, ownFile(user.id, ctx.params.id));
});

// ---------------------------------------------------------------- static files
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

async function serveStatic(req, res, rel) {
  const p = path.resolve(config.publicDir, '.' + path.posix.normalize('/' + rel));
  if (!p.startsWith(config.publicDir + path.sep)) return false;
  let stat;
  try { stat = await fsp.stat(p); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end(), true;
  await pipeline(fs.createReadStream(p), res).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- server
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  req.cookies = parseCookies(req);
  const ctx = { req, res, url, params: {}, user: null, csrf: '' };
  try {
    ctx.user = auth.loadUser(req);
    ctx.csrf = auth.ensureCsrf(req, res);

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/static/')) {
      if (await serveStatic(req, res, url.pathname.slice('/static/'.length))) return;
      throw new HttpError(404, 'Not found.');
    }
    if (url.pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /api/\nDisallow: /dashboard\n', 'text/plain');

    const match = router.match(req.method, url.pathname);
    if (!match) throw new HttpError(404, 'The page you are looking for does not exist.');
    if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed.');
    ctx.params = match.params;
    await match.handler(ctx);
  } catch (err) {
    if (res.headersSent) { res.destroy(); return; }
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (status === 302 && err.location) return redirect(res, err.location, 302);
    const message = status === 500 ? 'An unexpected error occurred. Please try again.' : err.message;
    // Drain any unread request body so the client receives the response.
    if (!req.complete) { res.setHeader('Connection', 'close'); req.resume(); }
    if (url.pathname.startsWith('/api/')) return json(res, status, { error: message });
    send(res, status, views.errorPage({ ...ctx, status, message }));
  }
}

const server = http.createServer({ requestTimeout: config.uploadTimeout }, handle);
server.listen(config.port, config.host, () => {
  console.log(`${config.siteName} running at http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
