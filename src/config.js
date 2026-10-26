'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependencies). Existing env vars take precedence.
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv();

const num = (key, def) => {
  const v = Number(process.env[key]);
  return process.env[key] !== undefined && process.env[key] !== '' && Number.isFinite(v) && v >= 0 ? v : def;
};
const bool = (key, def) => {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
};

const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');

module.exports = {
  ROOT,
  host: process.env.HOST || '0.0.0.0',
  port: num('PORT', 3000),
  siteName: process.env.SITE_NAME || 'xCloud',
  baseUrl: (process.env.BASE_URL || '').replace(/\/+$/, ''),
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  adsDir: path.resolve(ROOT, process.env.ADS_DIR || 'ads'),
  maxFileSize: num('MAX_FILE_SIZE_MB', 500) * 1024 * 1024,
  userQuota: num('USER_QUOTA_MB', 2048) * 1024 * 1024,
  downloadWait: Math.floor(num('DOWNLOAD_WAIT_SECONDS', 15)),
  ticketTtl: num('DOWNLOAD_TICKET_TTL_MINUTES', 60) * 60 * 1000,
  sessionTtl: num('SESSION_TTL_DAYS', 7) * 24 * 60 * 60 * 1000,
  uploadTimeout: num('UPLOAD_TIMEOUT_MINUTES', 120) * 60 * 1000,
  secureCookies: bool('SECURE_COOKIES', false),
  trustProxy: bool('TRUST_PROXY', false),
  showAdPlaceholders: bool('SHOW_AD_PLACEHOLDERS', true),
  allowRegistration: bool('ALLOW_REGISTRATION', true),
};
