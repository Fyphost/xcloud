'use strict';
const config = require('./config');
const { html, raw, jsonScript } = require('./html');
const { adSlot } = require('./ads');
const { formatBytes, fileKind, fileExt, formatDate } = require('./util');

const ICONS = {
  image: '🖼️', video: '🎬', audio: '🎵', archive: '🗜️', document: '📄', code: '💻', app: '⚙️', other: '📁',
};
const icon = (name) => ICONS[fileKind(name)] || ICONS.other;

function layout({ title, user, csrf, body, bodyClass = '', scripts = [] }) {
  return String(html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title ? `${title} · ${config.siteName}` : config.siteName}</title>
  <meta name="csrf-token" content="${csrf || ''}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>☁️</text></svg>">
  <link rel="stylesheet" href="/static/style.css">
  ${adSlot('head')}
</head>
<body class="${bodyClass}">
  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/"><span class="brand-logo">☁</span> ${config.siteName}</a>
      <nav class="nav">
        ${user ? html`
          <a href="/dashboard">Dashboard</a>
          <span class="nav-user" title="${user.email}">${user.name}</span>
          <form method="post" action="/logout" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}">
            <button class="btn btn-ghost btn-sm" type="submit">Log out</button>
          </form>` : html`
          <a href="/login">Log in</a>
          ${config.allowRegistration ? html`<a class="btn btn-primary btn-sm" href="/register">Sign up free</a>` : ''}`}
      </nav>
    </div>
  </header>
  <main>${body}</main>
  <footer class="footer">
    <div class="container">© ${new Date().getFullYear()} ${config.siteName} · Secure cloud file storage</div>
  </footer>
  ${scripts.map((s) => html`<script src="${s}" defer></script>`)}
</body>
</html>`);
}

function home({ user, csrf }) {
  return layout({
    user, csrf, bodyClass: 'page-home',
    body: html`
    <section class="hero">
      <div class="container hero-inner">
        <h1>Store, manage &amp; share your files<br><span class="grad">from anywhere.</span></h1>
        <p class="lead">Upload files up to ${formatBytes(config.maxFileSize)}, organize them in your dashboard and share a download link with anyone in one click.</p>
        <div class="hero-cta">
          ${user
            ? html`<a class="btn btn-primary btn-lg" href="/dashboard">Go to dashboard →</a>`
            : html`${config.allowRegistration ? html`<a class="btn btn-primary btn-lg" href="/register">Get ${formatBytes(config.userQuota)} free</a>` : ''}
                   <a class="btn btn-ghost btn-lg" href="/login">Log in</a>`}
        </div>
      </div>
    </section>
    <section class="container features">
      <div class="feature"><div class="feature-icon">⬆️</div><h3>Drag &amp; drop uploads</h3><p>Upload many files at once with live progress for every file.</p></div>
      <div class="feature"><div class="feature-icon">🗂️</div><h3>Powerful dashboard</h3><p>Search, sort, rename, delete and control the visibility of every file.</p></div>
      <div class="feature"><div class="feature-icon">🔗</div><h3>Instant share links</h3><p>Each file gets its own download page you can send to anyone.</p></div>
      <div class="feature"><div class="feature-icon">🔒</div><h3>Private by choice</h3><p>Switch any file to private and only you will be able to access it.</p></div>
    </section>`,
  });
}

function authPage({ mode, error, values = {}, csrf, next = '' }) {
  const isLogin = mode === 'login';
  return layout({
    title: isLogin ? 'Log in' : 'Create account', csrf, bodyClass: 'page-auth',
    body: html`
    <section class="auth-wrap">
      <form class="card auth-card" method="post" action="${isLogin ? '/login' : '/register'}">
        <h1>${isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p class="muted">${isLogin ? 'Log in to manage your files.' : `Get ${formatBytes(config.userQuota)} of free storage.`}</p>
        ${error ? html`<div class="alert alert-error">${error}</div>` : ''}
        <input type="hidden" name="_csrf" value="${csrf}">
        <input type="hidden" name="next" value="${next}">
        ${isLogin ? '' : html`
        <label>Name<input name="name" required maxlength="60" autocomplete="name" value="${values.name || ''}"></label>`}
        <label>Email<input type="email" name="email" required maxlength="254" autocomplete="email" value="${values.email || ''}"></label>
        <label>Password<input type="password" name="password" required minlength="${isLogin ? 1 : 8}" maxlength="200"
          autocomplete="${isLogin ? 'current-password' : 'new-password'}"></label>
        <button class="btn btn-primary btn-block" type="submit">${isLogin ? 'Log in' : 'Create account'}</button>
        <p class="muted center">
          ${isLogin
            ? (config.allowRegistration ? html`No account? <a href="/register">Sign up</a>` : '')
            : html`Already have an account? <a href="/login">Log in</a>`}
        </p>
      </form>
    </section>`,
  });
}

function dashboard({ user, csrf }) {
  return layout({
    title: 'Dashboard', user, csrf, bodyClass: 'page-dashboard', scripts: ['/static/dashboard.js'],
    body: html`
    <div class="container">
      <div class="dash-head">
        <div>
          <h1>My files</h1>
          <p class="muted">Upload, manage and share your files.</p>
        </div>
        <div class="stats">
          <div class="stat"><span class="stat-value" id="stat-files">–</span><span class="stat-label">Files</span></div>
          <div class="stat"><span class="stat-value" id="stat-downloads">–</span><span class="stat-label">Downloads</span></div>
          <div class="stat stat-usage">
            <span class="stat-label"><span id="usage-text">–</span></span>
            <div class="progress"><div class="progress-bar" id="usage-bar"></div></div>
          </div>
        </div>
      </div>

      <label class="dropzone" id="dropzone">
        <input type="file" id="file-input" multiple hidden>
        <div class="dropzone-icon">☁️</div>
        <div><strong>Drop files here</strong> or <span class="link">browse</span></div>
        <small class="muted">Max ${formatBytes(config.maxFileSize)} per file</small>
      </label>
      <ul class="upload-list" id="upload-list"></ul>

      <div class="toolbar">
        <input type="search" id="search" placeholder="Search files…" aria-label="Search files">
        <select id="sort" aria-label="Sort files">
          <option value="created_at:desc">Newest first</option>
          <option value="created_at:asc">Oldest first</option>
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="size:desc">Largest first</option>
          <option value="size:asc">Smallest first</option>
          <option value="downloads:desc">Most downloaded</option>
        </select>
        <button class="btn btn-danger btn-sm" id="bulk-delete" hidden>Delete selected (<span id="sel-count">0</span>)</button>
      </div>

      <div class="card table-card">
        <table class="files">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="select-all" aria-label="Select all"></th>
              <th>Name</th><th class="col-size">Size</th><th class="col-dl">Downloads</th>
              <th class="col-date">Uploaded</th><th class="col-vis">Visibility</th><th class="col-actions"></th>
            </tr>
          </thead>
          <tbody id="file-rows"></tbody>
        </table>
        <div class="empty" id="empty" hidden>
          <div class="empty-icon">📂</div>
          <p>No files yet. Upload your first file above.</p>
        </div>
      </div>
    </div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <script type="application/json" id="config">${jsonScript({ maxFileSize: config.maxFileSize })}</script>`,
  });
}

function downloadPage({ user, csrf, file, owner, ticket, isOwner }) {
  const wait = config.downloadWait;
  return layout({
    title: `Download ${file.name}`, user, csrf, bodyClass: 'page-download', scripts: ['/static/download.js'],
    body: html`
    <div class="container">
      ${adSlot('header')}
      <div class="dl-grid">
        <section class="card dl-card">
          <div class="dl-file">
            <div class="dl-icon">${icon(file.name)}</div>
            <div class="dl-meta">
              <h1 class="dl-name" title="${file.name}">${file.name}</h1>
              <ul class="dl-facts">
                <li><span>Size</span><strong>${formatBytes(file.size)}</strong></li>
                <li><span>Type</span><strong>${(fileExt(file.name) || 'file').toUpperCase()}</strong></li>
                <li><span>Uploaded</span><strong>${formatDate(file.created_at)}</strong></li>
                <li><span>Downloads</span><strong>${file.downloads}</strong></li>
                <li><span>Shared by</span><strong>${owner}</strong></li>
              </ul>
              ${isOwner && !file.is_public ? html`<div class="alert alert-info">This file is private — only you can see this page.</div>` : ''}
            </div>
          </div>

          <div class="countdown" id="countdown" data-wait="${wait}">
            <div class="ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="ring-bg" cx="60" cy="60" r="52"></circle>
                <circle class="ring-fg" id="ring-fg" cx="60" cy="60" r="52"></circle>
              </svg>
              <div class="ring-num"><span id="count">${wait}</span><small>sec</small></div>
            </div>
            <p class="countdown-text" id="countdown-text">Your download link will be ready in <strong id="count-inline">${wait}</strong> seconds…</p>
            <form method="post" action="/f/${file.slug}/download" id="dl-form">
              <input type="hidden" name="ticket" value="${ticket}">
              <button class="btn btn-primary btn-lg btn-download" id="dl-btn" type="submit" ${wait > 0 ? 'disabled' : ''}>
                ${wait > 0 ? 'Please wait…' : html`⬇ Download now`}
              </button>
            </form>
            <p class="muted small" id="dl-note" hidden>Download started. If it didn't, click the button again.</p>
          </div>

          ${adSlot('countdown')}

          <div class="dl-share">
            <label class="muted small" for="share-url">Share this file</label>
            <div class="copy-row">
              <input id="share-url" readonly>
              <button class="btn btn-ghost btn-sm" id="copy-share" type="button">Copy</button>
            </div>
          </div>
        </section>

        <aside class="dl-side">
          ${adSlot('sidebar')}
          ${adSlot('sidebar2')}
        </aside>
      </div>
      ${adSlot('footer')}
    </div>`,
  });
}

function errorPage({ user, csrf, status, message }) {
  const titles = { 404: 'Not found', 403: 'Forbidden', 410: 'Gone', 413: 'Too large' };
  return layout({
    title: titles[status] || 'Error', user, csrf, bodyClass: 'page-error',
    body: html`
    <section class="container error-wrap">
      <div class="error-code">${status}</div>
      <h1>${titles[status] || 'Something went wrong'}</h1>
      <p class="muted">${message}</p>
      <a class="btn btn-primary" href="/">Back home</a>
    </section>`,
  });
}

module.exports = { home, authPage, dashboard, downloadPage, errorPage, raw };
