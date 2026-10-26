'use strict';
// Ad slots are plain HTML snippets in the ads/ directory (e.g. ads/header.html).
// Paste your AdSense / ad-network code there. Files are re-read when they change,
// so you can update ads without restarting the server.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { html, raw } = require('./html');

const SLOTS = {
  head: null, // network loader script injected into <head>, no placeholder
  header: { size: '728 × 90', cls: 'ad-leaderboard' },
  countdown: { size: '468 × 60', cls: 'ad-banner' },
  sidebar: { size: '300 × 250', cls: 'ad-rectangle' },
  sidebar2: { size: '300 × 600', cls: 'ad-skyscraper' },
  footer: { size: '728 × 90', cls: 'ad-leaderboard' },
};

const cache = new Map();

function readSnippet(name) {
  const file = path.join(config.adsDir, `${name}.html`);
  try {
    const { mtimeMs } = fs.statSync(file);
    const hit = cache.get(name);
    if (hit && hit.mtimeMs === mtimeMs) return hit.code;
    const code = fs.readFileSync(file, 'utf8').trim();
    cache.set(name, { mtimeMs, code });
    return code;
  } catch {
    return '';
  }
}

function adSlot(name) {
  const slot = SLOTS[name];
  const code = readSnippet(name);
  if (!slot) return raw(code);
  if (code) return html`<div class="ad ${slot.cls}" data-ad-slot="${name}"><span class="ad-label">Advertisement</span>${raw(code)}</div>`;
  if (!config.showAdPlaceholders) return '';
  return html`<div class="ad ${slot.cls} ad-placeholder" data-ad-slot="${name}">
    <span class="ad-label">Advertisement</span><strong>Your ad here</strong><small>${slot.size} · ads/${name}.html</small>
  </div>`;
}

module.exports = { adSlot };
