(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const { maxFileSize } = JSON.parse($('config').textContent);

  const state = { files: [], usage: null, selected: new Set(), search: '', sort: 'created_at:desc' };

  // ---------- helpers ----------
  const KINDS = {
    '🖼️': 'jpg jpeg png gif webp svg bmp ico heic avif tiff',
    '🎬': 'mp4 mkv mov avi webm wmv flv m4v',
    '🎵': 'mp3 wav flac aac ogg m4a wma opus',
    '🗜️': 'zip rar 7z tar gz bz2 xz tgz iso dmg',
    '📄': 'pdf doc docx xls xlsx ppt pptx txt rtf odt ods csv md epub',
    '💻': 'js ts json html css py java c cpp go rs php rb sh xml yml yaml sql',
    '⚙️': 'exe msi apk deb rpm appimage jar',
  };
  function iconFor(name) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    for (const [icon, exts] of Object.entries(KINDS)) if (exts.split(' ').includes(ext)) return icon;
    return '📁';
  }
  function fmtBytes(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
    const v = b / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }
  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
  }
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) { location.href = '/login?next=/dashboard'; throw new Error('Logged out'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = el('textarea', {}, text);
      document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  // ---------- rendering ----------
  function renderUsage() {
    const u = state.usage;
    if (!u) return;
    $('stat-files').textContent = u.files;
    $('stat-downloads').textContent = u.downloads;
    const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : 0;
    $('usage-text').textContent = `${fmtBytes(u.used)} of ${fmtBytes(u.quota)} used`;
    const bar = $('usage-bar');
    bar.style.width = `${pct}%`;
    bar.classList.toggle('warn', pct > 85);
  }

  function visibleFiles() {
    const q = state.search.trim().toLowerCase();
    const [key, dir] = state.sort.split(':');
    const mul = dir === 'asc' ? 1 : -1;
    const map = { created_at: 'createdAt', name: 'name', size: 'size', downloads: 'downloads' };
    const k = map[key];
    return state.files
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort((a, b) => (k === 'name' ? a.name.localeCompare(b.name) : a[k] - b[k]) * mul);
  }

  function renderRows() {
    const tbody = $('file-rows');
    const files = visibleFiles();
    tbody.replaceChildren(...files.map(row));
    $('empty').hidden = files.length > 0;
    $('empty').querySelector('p').textContent = state.files.length
      ? 'No files match your search.'
      : 'No files yet. Upload your first file above.';
    // Drop selections that no longer exist.
    for (const id of state.selected) if (!state.files.some((f) => f.id === id)) state.selected.delete(id);
    updateSelection(files);
  }

  function row(f) {
    const nameCell = el('div', { class: 'file-name' },
      el('span', { class: 'file-icon' }, iconFor(f.name)),
      el('span', { class: 'text', title: f.name }, f.name));

    return el('tr', { 'data-id': f.id },
      el('td', { class: 'col-check' }, el('input', {
        type: 'checkbox', 'aria-label': `Select ${f.name}`, checked: state.selected.has(f.id),
        onchange: (e) => { e.target.checked ? state.selected.add(f.id) : state.selected.delete(f.id); updateSelection(); },
      })),
      el('td', {}, nameCell),
      el('td', { class: 'col-size' }, fmtBytes(f.size)),
      el('td', { class: 'col-dl' }, String(f.downloads)),
      el('td', { class: 'col-date' }, fmtDate(f.createdAt)),
      el('td', { class: 'col-vis' }, el('button', {
        class: `badge ${f.isPublic ? 'badge-public' : 'badge-private'}`,
        title: 'Click to toggle visibility',
        onclick: () => toggleVisibility(f),
      }, f.isPublic ? '🌐 Public' : '🔒 Private')),
      el('td', { class: 'col-actions' },
        el('button', { class: 'btn-icon', title: 'Copy share link', onclick: () => copyLink(f) }, '🔗'),
        el('a', { class: 'btn-icon', title: 'Open download page', href: f.url, target: '_blank', rel: 'noopener' }, '↗️'),
        el('a', { class: 'btn-icon', title: 'Download', href: `/api/files/${f.id}/download` }, '⬇️'),
        el('button', { class: 'btn-icon', title: 'Rename', onclick: () => startRename(f, nameCell) }, '✏️'),
        el('button', { class: 'btn-icon danger', title: 'Delete', onclick: () => remove([f.id]) }, '🗑️')));
  }

  function updateSelection(files = visibleFiles()) {
    const n = state.selected.size;
    $('sel-count').textContent = n;
    $('bulk-delete').hidden = n === 0;
    const all = $('select-all');
    const visSelected = files.filter((f) => state.selected.has(f.id)).length;
    all.checked = files.length > 0 && visSelected === files.length;
    all.indeterminate = visSelected > 0 && visSelected < files.length;
  }

  // ---------- actions ----------
  async function load() {
    try {
      const data = await api('GET', '/api/files');
      state.files = data.files;
      state.usage = data.usage;
      renderUsage();
      renderRows();
    } catch (e) { toast(e.message, true); }
  }

  async function copyLink(f) {
    await copy(f.url);
    toast(f.isPublic ? 'Share link copied!' : 'Link copied — note: this file is private.');
  }

  async function toggleVisibility(f) {
    try {
      const { file } = await api('PATCH', `/api/files/${f.id}`, { isPublic: !f.isPublic });
      Object.assign(f, file);
      renderRows();
      toast(file.isPublic ? 'File is now public' : 'File is now private');
    } catch (e) { toast(e.message, true); }
  }

  function startRename(f, cell) {
    const input = el('input', { value: f.name, maxlength: 200, 'aria-label': 'New file name' });
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== f.name) {
        try {
          const { file } = await api('PATCH', `/api/files/${f.id}`, { name });
          Object.assign(f, file);
          toast('File renamed');
        } catch (e) { toast(e.message, true); }
      }
      renderRows();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    cell.querySelector('.text').replaceWith(input);
    input.focus();
    const dot = f.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : f.name.length);
  }

  async function remove(ids) {
    const names = state.files.filter((f) => ids.includes(f.id)).map((f) => f.name);
    const msg = ids.length === 1 ? `Delete "${names[0]}"? This cannot be undone.` : `Delete ${ids.length} files? This cannot be undone.`;
    if (!confirm(msg)) return;
    let failed = 0;
    for (const id of ids) {
      try {
        const data = await api('DELETE', `/api/files/${id}`);
        state.files = state.files.filter((f) => f.id !== id);
        state.selected.delete(id);
        state.usage = data.usage;
      } catch { failed++; }
    }
    renderUsage();
    renderRows();
    toast(failed ? `${failed} file(s) could not be deleted` : ids.length === 1 ? 'File deleted' : `${ids.length} files deleted`, !!failed);
  }

  // ---------- uploads ----------
  const queue = [];
  let active = 0;
  const PARALLEL = 3;

  function enqueue(fileList) {
    for (const file of fileList) {
      const bar = el('div', { class: 'progress-bar' });
      const status = el('span', { class: 'status' }, 'Waiting…');
      const cancel = el('button', { class: 'btn-icon', title: 'Cancel' }, '✕');
      const item = el('li', { class: 'upload-item' },
        el('span', { class: 'name', title: file.name }, `${iconFor(file.name)} ${file.name}`),
        el('span', {}, status, ' ', cancel),
        el('div', { class: 'progress' }, bar));
      $('upload-list').prepend(item);
      const job = { file, item, bar, status, cancel, xhr: null, cancelled: false };
      cancel.onclick = () => { job.cancelled = true; job.xhr?.abort(); finish(job, 'Cancelled', true); };

      if (file.size > maxFileSize) { finish(job, `Too large (max ${fmtBytes(maxFileSize)})`, true); continue; }
      queue.push(job);
    }
    pump();
  }

  function pump() {
    while (active < PARALLEL && queue.length) {
      const job = queue.shift();
      if (job.cancelled) continue;
      active++;
      upload(job).finally(() => { active--; pump(); });
    }
  }

  function finish(job, text, isError) {
    job.status.textContent = text;
    job.item.classList.add(isError ? 'error' : 'done');
    job.cancel.remove();
    job.bar.style.width = '100%';
    setTimeout(() => job.item.remove(), isError ? 8000 : 3000);
  }

  function upload(job) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      job.xhr = xhr;
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-CSRF-Token', csrf);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(job.file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.responseType = 'json';
      const started = Date.now();
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = (e.loaded / e.total) * 100;
        job.bar.style.width = `${pct}%`;
        const speed = e.loaded / Math.max(1, (Date.now() - started) / 1000);
        job.status.textContent = `${Math.round(pct)}% · ${fmtBytes(speed)}/s`;
      };
      xhr.onload = () => {
        const data = xhr.response || {};
        if (xhr.status === 201) {
          state.files.unshift(data.file);
          state.usage = data.usage;
          renderUsage();
          renderRows();
          finish(job, 'Uploaded ✓');
        } else if (xhr.status === 401) {
          location.href = '/login?next=/dashboard';
        } else {
          finish(job, data.error || `Upload failed (${xhr.status})`, true);
        }
        resolve();
      };
      xhr.onerror = () => { if (!job.cancelled) finish(job, 'Network error — upload failed', true); resolve(); };
      xhr.onabort = () => resolve();
      job.status.textContent = '0%';
      xhr.send(job.file);
    });
  }

  // ---------- wiring ----------
  const dz = $('dropzone');
  $('file-input').addEventListener('change', (e) => { enqueue(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.size > 0 || f.type);
    if (files.length) enqueue(files);
  });
  // Prevent the browser from opening files dropped outside the zone.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  window.addEventListener('beforeunload', (e) => { if (active || queue.length) { e.preventDefault(); e.returnValue = ''; } });

  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderRows(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderRows(); });
  $('select-all').addEventListener('change', (e) => {
    for (const f of visibleFiles()) e.target.checked ? state.selected.add(f.id) : state.selected.delete(f.id);
    renderRows();
  });
  $('bulk-delete').addEventListener('click', () => remove([...state.selected]));

  load();
})();
