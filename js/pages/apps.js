function renderApps() {
  const rows = APP_REGISTRY.map((a) => {
    const last = lastBackupFor(a.appId);
    const retention = retentionFor(a.appId);
    return `
      <div class="card">
        <div class="card-row">
          <div style="min-width:0">
            <h3>${esc(a.icon)} ${esc(a.name)}</h3>
            <p>${esc(a.description || '')}</p>
            <p class="muted" style="margin-top:4px">Path: <code>${esc(a.path)}</code></p>
          </div>
          <div class="actions" style="display:flex; flex-direction:column; gap:6px; align-items:flex-end">
            <button class="btn-secondary" onclick="runBackupOne('${esc(a.appId)}')">Backup now</button>
            <button class="btn-secondary" onclick="testAdapter('${esc(a.appId)}')">Test adapter</button>
          </div>
        </div>
        <div class="card-row">
          <div>
            <div class="muted" style="font-size:12px">Last backup</div>
            <div>${last ? esc(fmtDateTime(last)) : '—'}</div>
          </div>
          <div>
            <label for="ret-${esc(a.appId)}">Retention</label>
            <input id="ret-${esc(a.appId)}" type="number" min="1" max="50" value="${retention}" style="width:80px"
              onchange="setRetention('${esc(a.appId)}', this.value)">
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <h1>Apps</h1>
        <p>Registered apps and per-app settings.</p>
      </div>
    </div>
    ${rows}
    <p class="muted" style="text-align:center; margin-top:16px; font-size:12px">
      Add a new app: edit <code>js/data.js</code> → <code>APP_REGISTRY</code>.
    </p>
  `;
}

async function setRetention(appId, raw) {
  const n = Math.max(1, Math.min(50, parseInt(raw, 10) || 3));
  await dbSetAppMeta(appId, { retention: n });
  showToast(`Retention for ${appId} set to ${n}.`, 'success');
}

async function testAdapter(appId) {
  showToast(`Pinging ${appId}…`);
  try {
    const snap = await snapshotApp(appId);
    const bytes = JSON.stringify(snap.payload || {}).length;
    showModal('Adapter test passed', `
      <p><strong>${esc(snap.appName)}</strong> responded.</p>
      <p class="muted" style="font-size:13px">App version: ${esc(String(snap.appVersion))}</p>
      <p class="muted" style="font-size:13px">Payload size: ${esc(fmtBytes(bytes))}</p>
    `, null);
  } catch (err) {
    showToast(err.message || 'Adapter test failed.', 'error');
  }
}
