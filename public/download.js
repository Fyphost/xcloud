(() => {
  'use strict';
  const box = document.getElementById('countdown');
  const btn = document.getElementById('dl-btn');
  const form = document.getElementById('dl-form');
  const countEl = document.getElementById('count');
  const countInline = document.getElementById('count-inline');
  const text = document.getElementById('countdown-text');
  const note = document.getElementById('dl-note');
  const ring = document.getElementById('ring-fg');

  const wait = Number(box.dataset.wait) || 0;
  const CIRC = 2 * Math.PI * 52;
  ring.style.strokeDasharray = CIRC;
  ring.style.strokeDashoffset = 0;

  // Share link
  const share = document.getElementById('share-url');
  share.value = location.origin + location.pathname;
  document.getElementById('copy-share').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(share.value); } catch { share.select(); document.execCommand('copy'); }
    e.target.textContent = 'Copied!';
    setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
  });

  function ready() {
    box.classList.add('ready');
    countEl.textContent = '✓';
    ring.style.strokeDashoffset = CIRC;
    text.textContent = 'Your download is ready!';
    btn.disabled = false;
    btn.textContent = '⬇ Download now';
  }

  if (wait <= 0) return ready();

  // Use wall-clock time so the countdown stays accurate even if the tab is throttled.
  const end = Date.now() + wait * 1000;
  // Only count down while the page is visible (keeps users on the page with the ads).
  let pausedAt = null;
  let offset = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pausedAt = Date.now();
    else if (pausedAt) { offset += Date.now() - pausedAt; pausedAt = null; }
  });

  function tick() {
    if (pausedAt) return setTimeout(tick, 250);
    const left = Math.max(0, end + offset - Date.now());
    const secs = Math.ceil(left / 1000);
    countEl.textContent = secs;
    countInline.textContent = secs;
    ring.style.strokeDashoffset = CIRC * (1 - left / (wait * 1000));
    if (left <= 0) return ready();
    setTimeout(tick, 200);
  }
  tick();

  form.addEventListener('submit', (e) => {
    if (btn.disabled) { e.preventDefault(); return; }
    note.hidden = false;
  });
})();
