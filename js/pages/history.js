function renderHistory() {
  if (!state.bundles.length) {
    return `
      <div class="page-header">
        <div><h1>History</h1><p>All backup bundles.</p></div>
      </div>
      <div class="empty">
        <div class="empty-icon">📭</div>
        <h3>No bundles yet</h3>
        <p>Run a backup to see it here.</p>
        <button class="btn-primary" onclick="runBackupAll()">Backup all now</button>
      </div>
    `;
  }

  const items = state.bundles.map((b) => {
    const apps = (b.appIds || []).map((id) => getApp(id)?.name || id).join(', ');
    return `
      <div class="list-item">
        <div class="meta">
          <div class="meta-title">${esc(fmtDateTime(b.createdAt))}</div>
          <div class="meta-sub">${esc(apps)} · ${esc(fmtBytes(b.sizeBytes))} · ${esc(b.saveMethod || '')}</div>
          <div class="meta-sub" style="font-family:monospace; font-size:11px">${esc(b.filename)}</div>
        </div>
        <div class="actions">
          <button onclick="openBundle('${esc(b.id)}')">Open</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-header">
      <div><h1>History</h1><p>All backup bundles, newest first.</p></div>
    </div>
    <div class="list">${items}</div>
  `;
}

async function openBundle(id) {
  const b = await dbGetBundle(id);
  if (!b) { showToast('Bundle not found.', 'error'); return; }
  const apps = (b.appIds || []).map((aid) => {
    const a = getApp(aid);
    return `
      <div class="list-item">
        <div class="meta">
          <div class="meta-title">${esc(a?.icon || '')} ${esc(a?.name || aid)}</div>
          <div class="meta-sub">${esc(aid)}</div>
        </div>
        <div class="actions">
          <button onclick="restoreOneFromBundle('${esc(id)}', '${esc(aid)}')">Restore</button>
        </div>
      </div>
    `;
  }).join('');

  const body = `
    <p class="muted" style="font-size:13px">${esc(fmtDateTime(b.createdAt))} · ${esc(fmtBytes(b.sizeBytes))}</p>
    <p style="font-family:monospace; font-size:12px; word-break:break-all">${esc(b.filename)}</p>

    <div class="section-title" style="margin-top:16px">Apps in this bundle</div>
    <div class="list">${apps}</div>

    <div class="btn-row" style="margin-top:16px">
      <button class="btn-secondary" onclick="downloadBundle('${esc(id)}')">Download .json</button>
      <button class="btn-danger" onclick="confirmDeleteBundle('${esc(id)}')">Delete bundle</button>
    </div>
  `;
  showModal('Bundle', body, null);
}

async function downloadBundle(id) {
  try {
    const json = await readBundleJson(id);
    const b = await dbGetBundle(id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = b.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmDeleteBundle(id) {
  hideModal();
  showConfirm(
    'Delete bundle',
    'This removes the bundle from the local index and (if a folder is set) deletes the file. The copy you saved to Files/iCloud is not affected.',
    async () => {
      const b = await dbGetBundle(id);
      if (b && b.filename) await deleteBundleFile(b.filename);
      await dbDeleteBundle(id);
      showToast('Bundle deleted.', 'success');
      await navigate('history');
    },
    'Delete',
  );
}

async function restoreOneFromBundle(bundleId, appId) {
  const b = await dbGetBundle(bundleId);
  if (!b) { showToast('Bundle not found.', 'error'); return; }
  const json = await readBundleJson(bundleId);
  const env = JSON.parse(json);
  const entry = env.apps && env.apps[appId];
  if (!entry) { showToast(`App ${appId} not present in this bundle.`, 'error'); return; }

  hideModal();
  showConfirm(
    `Restore ${getApp(appId)?.name || appId}?`,
    `This replaces all current data in that app with the snapshot from ${fmtDateTime(env.createdAt)}.`,
    async () => {
      showToast(`Restoring ${appId}…`);
      try {
        await restoreAppInline(appId, entry.payload);
        showToast(`Restored ${appId}.`, 'success');
      } catch (err) {
        showToast(err.message || 'Restore failed.', 'error');
      }
    },
    'Restore',
  );
}
