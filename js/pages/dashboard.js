function renderDashboard() {
  const totalBundles = state.bundles.length;
  const lastBundle = state.bundles[0];

  const folderStatus = hasFSA()
    ? (state.folderName ? `<span class="badge ok">Folder: ${esc(state.folderName)}</span>` : `<span class="badge warn">No folder set</span>`)
    : `<span class="badge">iOS / share-sheet mode</span>`;

  const perApp = APP_REGISTRY.map((a) => {
    const last = lastBackupFor(a.appId);
    const dot = last ? 'ok' : 'err';
    return `
      <div class="list-item">
        <div class="meta">
          <div class="meta-title">${esc(a.icon)} ${esc(a.name)}</div>
          <div class="meta-sub"><span class="dot ${dot}"></span>${last ? `Last backup: ${esc(fmtRelative(last))}` : 'No backups yet'}</div>
        </div>
        <div class="actions">
          <button onclick="runBackupOne('${esc(a.appId)}')">Backup</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>Backup status across your apps.</p>
      </div>
      ${folderStatus}
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Bundles stored</div>
        <div class="kpi-value">${totalBundles}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Last backup</div>
        <div class="kpi-value" style="font-size:16px">${lastBundle ? esc(fmtRelative(lastBundle.createdAt)) : 'never'}</div>
        <div class="kpi-sub">${lastBundle ? esc(fmtDateTime(lastBundle.createdAt)) : ''}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Apps registered</div>
        <div class="kpi-value">${APP_REGISTRY.length}</div>
      </div>
    </div>

    <button class="btn-primary btn-block" onclick="runBackupAll()">Backup all apps now</button>

    <div class="section" style="margin-top:24px">
      <div class="section-title">Per-app status</div>
      <div class="list">${perApp}</div>
    </div>

    ${hasFSA() && !state.folderName ? `
      <div class="card" style="margin-top:16px; border-color: var(--warn)">
        <h3>Choose a backup folder</h3>
        <p>Without a chosen folder, backups will go through the system share/download sheet each time.</p>
        <button class="btn-primary" style="margin-top:8px" onclick="navigate('settings')">Open Settings</button>
      </div>
    ` : ''}
  `;
}

async function runBackupOne(appId) {
  showToast(`Backing up ${appId}…`);
  try {
    const result = await runBackup([appId]);
    showToast(`Saved (${result.saved.method}).`, 'success');
    if (state.page === 'dashboard') await navigate('dashboard');
  } catch (err) {
    showToast(err.message || 'Backup failed.', 'error');
  }
}
