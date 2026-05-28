// ttn-backup client. Drop this single <script> into any compatible app:
//
//   <script src="https://timtomnow.github.io/ttn-backup/client.js" defer></script>
//   <script>
//     window.TTNBackupAdapter = {
//       appId: 'fintom-planning',
//       appName: 'FinTom Financial Planning',
//       version: 1,
//       exportData: () => state.data,
//       importData: (data) => { state.data = data; saveData(); location.reload(); },
//     };
//   </script>
//
// The script works in two modes:
//
//   Standalone (the app's own tab) — exposes `TTNBackup.openImport(appId)`
//   so the host app can render a "Restore from ttn-backup" button that
//   surfaces saved bundles for that app.
//
//   IFrame (loaded by the utility) — answers postMessage requests for
//   export / import using TTNBackupAdapter, so the utility can build
//   backups without each app having to know about IndexedDB schemas.

(function () {
  'use strict';

  if (window.TTNBackup && window.TTNBackup.__loaded) return;

  const HOST_ORIGIN = 'https://timtomnow.github.io';
  const UTILITY_BASE = HOST_ORIGIN + '/ttn-backup/';
  const DB_NAME = 'ttnBackup';

  const inIframe = (() => {
    try { return window.self !== window.top; } catch { return true; }
  })();

  // ---------- iframe protocol ----------

  function getAdapter() {
    return window.TTNBackupAdapter || null;
  }

  function postReady(requestId) {
    const a = getAdapter();
    if (!a) return;
    parent.postMessage({
      type: 'ttn-backup:ready',
      requestId,
      appId: a.appId,
      appName: a.appName,
      version: a.version || 1,
    }, location.origin);
  }

  if (inIframe) {
    // Send a proactive ready as soon as we can identify the adapter.
    function tryProactiveReady() {
      const a = getAdapter();
      if (a) {
        try { parent.postMessage({ type: 'ttn-backup:ready', requestId: 'init', appId: a.appId, appName: a.appName, version: a.version || 1 }, location.origin); } catch {}
      }
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      tryProactiveReady();
    } else {
      document.addEventListener('DOMContentLoaded', tryProactiveReady, { once: true });
    }

    window.addEventListener('message', async (ev) => {
      if (ev.origin !== location.origin) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      const a = getAdapter();
      if (!a) return;

      if (msg.type === 'ttn-backup:hello') {
        postReady(msg.requestId);
        return;
      }

      if (msg.type === 'ttn-backup:export') {
        try {
          const payload = await Promise.resolve(a.exportData());
          parent.postMessage({
            type: 'ttn-backup:export-result',
            requestId: msg.requestId,
            ok: true,
            appId: a.appId,
            appName: a.appName,
            appVersion: a.version || 1,
            payload,
          }, location.origin);
        } catch (err) {
          parent.postMessage({
            type: 'ttn-backup:export-result',
            requestId: msg.requestId,
            ok: false,
            error: err && err.message || String(err),
          }, location.origin);
        }
        return;
      }

      if (msg.type === 'ttn-backup:import') {
        try {
          await Promise.resolve(a.importData(msg.payload));
          parent.postMessage({
            type: 'ttn-backup:import-result',
            requestId: msg.requestId,
            ok: true,
          }, location.origin);
        } catch (err) {
          parent.postMessage({
            type: 'ttn-backup:import-result',
            requestId: msg.requestId,
            ok: false,
            error: err && err.message || String(err),
          }, location.origin);
        }
        return;
      }
    });
  }

  // ---------- standalone API (TTNBackup.openImport) ----------

  // Open the shared utility DB read-only and list bundles containing this
  // app. Same-origin only.
  function openSharedDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function listBundlesFor(appId) {
    let db;
    try { db = await openSharedDb(); } catch { return []; }
    if (!db.objectStoreNames.contains('bundles')) { db.close(); return []; }
    return new Promise((resolve) => {
      const tx = db.transaction('bundles');
      const req = tx.objectStore('bundles').getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        const mine = all
          .filter((b) => Array.isArray(b.appIds) && b.appIds.includes(appId))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        resolve(mine);
        db.close();
      };
      req.onerror = () => { resolve([]); db.close(); };
    });
  }

  function fmtRel(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Inject a Shadow-DOM modal so the host app's CSS doesn't clash.
  async function openImport(appId) {
    if (!appId) throw new Error('openImport(appId) requires an appId.');
    const adapter = getAdapter();
    if (!adapter) throw new Error('No TTNBackupAdapter found on this page.');
    if (adapter.appId !== appId) {
      console.warn(`[ttn-backup] openImport(${appId}) called but adapter.appId is ${adapter.appId}. Continuing.`);
    }

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    document.body.appendChild(host);
    const sr = host.attachShadow({ mode: 'open' });

    const bundles = await listBundlesFor(appId);
    const items = bundles.length
      ? bundles.map((b, i) => `
          <li data-idx="${i}">
            <div class="when">${b === bundles[0] ? '<span class="latest">LATEST</span> ' : ''}${fmtRel(b.createdAt)}</div>
            <div class="sub">${new Date(b.createdAt).toLocaleString()} · ${fmtBytes(b.sizeBytes)}</div>
          </li>
        `).join('')
      : `<li class="empty">No bundles found for <code>${appId}</code>.</li>`;

    sr.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.55);
          display: flex; align-items: flex-end; justify-content: center;
          font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .sheet {
          background: #1e293b; color: #e2e8f0;
          width: 100%; max-width: 560px;
          max-height: 85dvh; overflow-y: auto;
          border-radius: 12px 12px 0 0;
          padding: 20px; padding-bottom: calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -4px 16px rgba(0,0,0,0.5);
        }
        @media (min-width: 600px) {
          .overlay { align-items: center; padding: 16px; }
          .sheet { border-radius: 12px; }
        }
        h2 { margin: 0 0 4px; font-size: 18px; }
        .sub { color: #94a3b8; font-size: 12px; }
        ul { list-style: none; padding: 0; margin: 14px 0; display: flex; flex-direction: column; gap: 8px; }
        li {
          background: #0f172a; border: 1px solid #334155; border-radius: 8px;
          padding: 12px 14px; cursor: pointer;
        }
        li:hover { background: #273449; }
        li.empty { cursor: default; color: #94a3b8; text-align: center; }
        .when { font-weight: 600; }
        .latest { font-size: 10px; background: #38bdf8; color: #0c1322; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-right: 6px; }
        .actions { display: flex; gap: 8px; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; }
        .actions .left { display:flex; gap:8px; flex-wrap:wrap; }
        button {
          font: inherit; border: 1px solid #475569; background: #1e293b; color: #e2e8f0;
          border-radius: 8px; padding: 9px 14px; cursor: pointer;
        }
        button.primary { background: #38bdf8; color: #0c1322; border-color: #38bdf8; font-weight: 600; }
        a.link { color: #38bdf8; text-decoration: none; font-size: 12px; }
        code { background: #0f172a; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
      </style>
      <div class="overlay">
        <div class="sheet">
          <h2>Restore from ttn-backup</h2>
          <div class="sub">Pick a bundle to restore <code>${appId}</code>.</div>
          <ul>${items}</ul>
          <div class="actions">
            <a class="link" href="${UTILITY_BASE}" target="_blank" rel="noopener">Open ttn-backup ↗</a>
            <div class="left">
              <button data-act="cancel">Cancel</button>
              <button class="primary" data-act="restore" ${bundles.length ? '' : 'disabled'}>Restore selected</button>
            </div>
          </div>
        </div>
      </div>
    `;

    let selected = bundles.length ? 0 : -1;
    function updateSelection() {
      sr.querySelectorAll('li[data-idx]').forEach((el) => {
        const i = parseInt(el.dataset.idx, 10);
        el.style.borderColor = i === selected ? '#38bdf8' : '#334155';
      });
    }
    updateSelection();

    sr.querySelectorAll('li[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        selected = parseInt(el.dataset.idx, 10);
        updateSelection();
      });
    });

    function close() { host.remove(); }
    sr.querySelector('[data-act="cancel"]').addEventListener('click', close);
    sr.querySelector('.overlay').addEventListener('click', (ev) => {
      if (ev.target === sr.querySelector('.overlay')) close();
    });

    sr.querySelector('[data-act="restore"]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Restoring…';
      try {
        const b = bundles[selected];
        if (!b || !b.bytes) throw new Error('Bundle bytes unavailable. Open ttn-backup and re-save.');
        const text = b.bytes instanceof Blob ? await b.bytes.text() : String(b.bytes);
        const env = JSON.parse(text);
        const entry = env.apps && env.apps[appId];
        if (!entry) throw new Error(`This bundle does not contain ${appId}.`);
        await Promise.resolve(adapter.importData(entry.payload));
        close();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Restore selected';
        alert('Restore failed: ' + (err.message || err));
      }
    });
  }

  window.TTNBackup = Object.assign(window.TTNBackup || {}, {
    __loaded: true,
    openImport,
    listBundlesFor,
  });
})();
