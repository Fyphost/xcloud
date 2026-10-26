'use strict';
const crypto = require('node:crypto');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomSlug(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[bytes[i] % 62];
  return out;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function sanitizeFileName(name) {
  let clean = String(name || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/^[\s.]+/, '')
    .trim();
  if (clean.length > 200) {
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
    clean = clean.slice(0, 200 - ext.length) + ext;
  }
  return clean;
}

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif', 'tiff'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'dmg'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'csv', 'md', 'epub'],
  code: ['js', 'ts', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'php', 'rb', 'sh', 'xml', 'yml', 'yaml', 'sql'],
  app: ['exe', 'msi', 'apk', 'deb', 'rpm', 'appimage', 'jar'],
};

function fileExt(name) {
  const dot = String(name).lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

function fileKind(name) {
  const ext = fileExt(name);
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return kind;
  return 'other';
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

module.exports = { randomToken, randomSlug, sha256, safeEqual, formatBytes, sanitizeFileName, fileExt, fileKind, contentDisposition, formatDate };
