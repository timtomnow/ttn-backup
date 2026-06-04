function renderSettings() {
  const folder = state.folderName;
  const fsa = hasFSA();

  const folderCard = fsa ? `
    <div class="card">
      <h3>Backup folder</h3>
      <p>${folder ? `Saving to: <strong>${esc(folder)}</strong>` : 'No folder chosen yet — backups will use the share/download sheet.'}</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn-primary" onclick="pickFolder()">${folder ? 'Change folder' : 'Choose folder'}</button>
        ${folder ? `<button class="btn-secondary" onclick="rescanFolderUI()">Rescan folder</button>` : ''}
      </div>
    </div>
  ` : `
    <div class="card">
      <h3>Backup folder</h3>
      <p>This browser does not support the File System Access API. Each backup will trigger the system share/download sheet so you can save to Files / iCloud Drive.</p>
    </div>
  `;

  return `
    <div class="page-header">
      <div><h1>Settings</h1><p>Storage, recovery, and device.</p></div>
    </div>

    <div class="card card-clickable" onclick="navigate('help')">
      <h3>Help &amp; guides</h3>
      <p class="muted">How to back up, schedule, and restore your apps.</p>
    </div>

    ${folderCard}

    <div class="card">
      <h3>Import backup files</h3>
      <p>Re-build the local index from previously-saved <code>.json</code> bundles. Useful after a browser data wipe or on a new device.</p>
      <input type="file" id="import-file-input" accept=".json,application/json" multiple style="margin-top:10px"
             onchange="importFilesUI(this.files)">
    </div>

    <div class="card">
      <h3>Device label</h3>
      <p>Optional. Stored inside each bundle so you can tell devices apart.</p>
      <input type="text" id="device-label" placeholder="e.g. iPhone 15"
             value="${esc(state.deviceLabel || '')}"
             style="margin-top:8px"
             onchange="setDeviceLabel(this.value)">
    </div>

    <div class="card">
      <h3>Default retention</h3>
      <p>Default number of bundles to keep per app. Overridden per-app on the Apps page.</p>
      <input type="number" min="1" max="50" id="default-retention"
             value="${state.retentionPerApp}"
             style="width:100px; margin-top:8px"
             onchange="setDefaultRetention(this.value)">
      <div class="btn-row" style="margin-top:10px">
        <button class="btn-secondary" onclick="pruneNow()">Prune now</button>
      </div>
    </div>

    <div class="card">
      <h3>Danger zone</h3>
      <p>Wipes the local index. Files on disk (FSA folder, iCloud Drive) are not touched.</p>
      <button class="btn-danger" style="margin-top:10px" onclick="confirmClearIndex()">Clear index</button>
    </div>

    <p class="muted" style="text-align:center; margin-top:24px; font-size:12px">
      ttn-backup · v1 · <a href="https://github.com/timtomnow" style="color:var(--accent)">timtomnow</a>
    </p>
  `;
}

async function pickFolder() {
  try {
    const name = await chooseBackupFolder();
    showToast(`Folder set: ${name}`, 'success');
    await navigate('settings');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled
    showToast(err.message || 'Could not set folder.', 'error');
  }
}

async function rescanFolderUI() {
  showToast('Scanning folder…');
  try {
    const r = await rescanFolder();
    showToast(`Rescan complete: ${r.imported} new, ${r.skipped} already indexed, ${r.failed} failed.`, 'success');
    await navigate('settings');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function importFilesUI(fileList) {
  if (!fileList || !fileList.length) return;
  try {
    const r = await importFiles(fileList);
    showToast(`Import: ${r.imported} new, ${r.skipped} already indexed, ${r.failed} failed.`, 'success');
    await navigate('settings');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function setDeviceLabel(v) {
  await dbSetMeta('deviceLabel', v.trim());
  await loadState();
}

async function pruneNow() {
  const before = state.bundles.length;
  await pruneBundles();
  await loadState();
  const after = state.bundles.length;
  const removed = before - after;
  showToast(removed ? `Pruned ${removed} bundle(s).` : 'Nothing to prune.', 'success');
  await navigate('settings');
}

async function setDefaultRetention(v) {
  const n = Math.max(1, Math.min(50, parseInt(v, 10) || 3));
  await dbSetMeta('retentionPerApp', n);
  await loadState();
}

async function confirmClearIndex() {
  showConfirm(
    'Clear local index?',
    'Removes all bundles from the local index and clears app metadata. Files saved to your folder / Files app are not affected.',
    async () => {
      const db = await openDb();
      const tx = db.transaction(['bundles', 'apps'], 'readwrite');
      tx.objectStore('bundles').clear();
      tx.objectStore('apps').clear();
      await idbTx(tx);
      showToast('Index cleared.', 'success');
      await navigate('settings');
    },
    'Clear',
  );
}
