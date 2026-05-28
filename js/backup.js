// Backup orchestration. Two responsibilities:
//   1. Snapshot — drive a hidden iframe to load each compatible app and ask
//      its TTNBackupAdapter for export data via postMessage. Assemble into a
//      bundle, write to filesystem + IDB index, then prune to retention.
//   2. Restore — load the target app in an iframe (or use the current
//      window if same app) and send it the import payload.
//
// PostMessage protocol (host ↔ iframe):
//   host → frame:   { type: 'ttn-backup:hello', requestId }
//   frame → host:   { type: 'ttn-backup:ready', requestId, appId, appName, version }
//   host → frame:   { type: 'ttn-backup:export', requestId }
//   frame → host:   { type: 'ttn-backup:export-result', requestId, ok, payload?, error? }
//   host → frame:   { type: 'ttn-backup:import', requestId, payload }
//   frame → host:   { type: 'ttn-backup:import-result', requestId, ok, error? }
//
// All messages include the requestId so concurrent calls don't cross wires.

const FORMAT = 'ttn-backup';
const FORMAT_VERSION = 1;
const FRAME_TIMEOUT_MS = 15000;

// Drive the hidden iframe to load an app and run a sequence of messages.
// Returns a Promise that resolves with the final result or rejects on
// timeout / error.
function _runAdapterRequest(appId, requestType, payload) {
  return new Promise((resolve, reject) => {
    const app = getApp(appId);
    if (!app) return reject(new Error(`Unknown app: ${appId}`));
    const url = appUrl(appId, state.pathOverrides);
    if (!url) return reject(new Error(`No URL configured for app: ${appId}`));

    const frame = document.getElementById('snapshot-frame');
    if (!frame) return reject(new Error('Snapshot frame not present in DOM.'));

    const requestId = uuid();
    let settled = false;
    let phase = 'loading'; // loading → ready → request-sent → done

    const cleanup = () => {
      window.removeEventListener('message', onMsg);
      clearTimeout(timer);
      // Blank the frame so it doesn't keep running.
      try { frame.src = 'about:blank'; } catch {}
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const done = (val) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    const onMsg = (ev) => {
      // Same-origin only.
      if (ev.origin !== location.origin) return;
      const msg = ev.data;
      if (!msg || typeof msg !== 'object' || msg.requestId !== requestId) return;

      if (msg.type === 'ttn-backup:ready' && phase === 'loading') {
        phase = 'request-sent';
        const out = { type: `ttn-backup:${requestType}`, requestId };
        if (requestType === 'import') out.payload = payload;
        frame.contentWindow.postMessage(out, location.origin);
        return;
      }

      if (msg.type === `ttn-backup:${requestType}-result`) {
        if (msg.ok) {
          done(msg);
        } else {
          fail(new Error(msg.error || `${requestType} failed in adapter`));
        }
      }
    };

    const timer = setTimeout(() => {
      fail(new Error(`Adapter timeout (${requestType}) for app ${appId} after ${FRAME_TIMEOUT_MS}ms. Is TTNBackupAdapter and client.js loaded?`));
    }, FRAME_TIMEOUT_MS);

    window.addEventListener('message', onMsg);

    frame.onload = () => {
      // After load, the client.js inside should send a 'ready' message
      // immediately. To kick things off if it hasn't, we also ping it with
      // a 'hello' once. (client.js is allowed to send 'ready' either
      // proactively on load OR in response to a 'hello'.)
      try {
        frame.contentWindow.postMessage({ type: 'ttn-backup:hello', requestId }, location.origin);
      } catch {
        // postMessage may throw on certain about:blank states; harmless.
      }
    };

    // Loading triggers onload above.
    frame.src = url;
  });
}

async function snapshotApp(appId) {
  const res = await _runAdapterRequest(appId, 'export', null);
  return {
    appId,
    appName: res.appName || getApp(appId)?.name || appId,
    appVersion: res.appVersion ?? 1,
    payload: res.payload,
  };
}

async function restoreAppInline(appId, payload) {
  // Used when the user picks "Restore" from the utility (utility-driven).
  // Loads the target app in the hidden iframe and pushes the payload.
  return _runAdapterRequest(appId, 'import', payload);
}

// Build a bundle for a list of appIds. Returns the bundle envelope (not
// yet serialized).
async function buildBundle(appIds) {
  const apps = {};
  const errors = [];
  for (const id of appIds) {
    try {
      const snap = await snapshotApp(id);
      apps[id] = {
        appName: snap.appName,
        appVersion: snap.appVersion,
        payload: snap.payload,
      };
    } catch (err) {
      errors.push({ appId: id, error: err.message });
    }
  }
  return {
    envelope: {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: nowIso(),
      device: state.deviceLabel || '',
      bundleId: uuid(),
      apps,
    },
    errors,
  };
}

// Run a full backup of the selected apps:
//   1. Build the bundle.
//   2. Serialize to JSON.
//   3. Save to filesystem.
//   4. Index it in IndexedDB (also caches the bytes).
//   5. Prune old bundles per retention.
async function runBackup(appIds) {
  if (!appIds || !appIds.length) throw new Error('No apps selected.');
  const built = await buildBundle(appIds);
  const includedAppIds = Object.keys(built.envelope.apps);
  if (!includedAppIds.length) {
    const err = built.errors.map((e) => `${e.appId}: ${e.error}`).join('; ');
    throw new Error(`No apps could be snapshotted. ${err}`);
  }
  const json = JSON.stringify(built.envelope, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = `ttn-backup-bundle-${timestampSlug(new Date(built.envelope.createdAt))}.json`;

  const saved = await saveBundleFile(filename, blob);

  // Index in IndexedDB.
  const bundleRecord = {
    id: built.envelope.bundleId,
    createdAt: built.envelope.createdAt,
    filename: saved.filename,
    sizeBytes: blob.size,
    appIds: includedAppIds,
    bytes: blob,             // working-copy cache
    saveMethod: saved.method,
  };
  await dbAddBundle(bundleRecord);

  // Update each included app's lastBackupAt.
  for (const id of includedAppIds) {
    await dbSetAppMeta(id, { lastBackupAt: built.envelope.createdAt });
  }

  // Prune.
  await loadState();
  await pruneBundles();
  await loadState();

  return { bundle: bundleRecord, errors: built.errors, saved };
}

// Retention policy: per-app. For each app, find bundles containing that
// app, sort newest first, and any bundle past position [retention] is a
// pruning candidate FOR THAT APP. A bundle is actually pruned (whole file
// + index entry) only when it's past retention for EVERY app it contains.
// This conservative behaviour preserves multi-app bundles for the longest
// living app.
async function pruneBundles() {
  const bundles = await dbListBundles(); // newest first
  // Per-app count.
  const counts = {}; // appId -> count seen so far (oldest-first count we accumulate by iterating newest→oldest)
  const keep = new Set();

  // Pass: for each app, walk bundles newest→oldest and mark the first
  // `retention` bundles that contain that app as "keep for this app".
  for (const app of APP_REGISTRY) {
    const retention = retentionFor(app.appId);
    let kept = 0;
    for (const b of bundles) {
      if (!b.appIds || !b.appIds.includes(app.appId)) continue;
      if (kept < retention) {
        keep.add(b.id);
        kept++;
      }
    }
  }

  // Anything not in `keep` is eligible for full deletion.
  const toDelete = bundles.filter((b) => !keep.has(b.id));
  for (const b of toDelete) {
    await deleteBundleFile(b.filename);
    await dbDeleteBundle(b.id);
  }
}

// Read a bundle's JSON content for download/inspection. Prefers the
// cached blob in IDB; falls back to re-reading from filesystem when
// available (FSA only).
async function readBundleJson(id) {
  const b = await dbGetBundle(id);
  if (!b) throw new Error('Bundle not found.');
  if (b.bytes) {
    if (b.bytes instanceof Blob) return await b.bytes.text();
    return String(b.bytes);
  }
  // Fall back to disk (FSA only).
  if (hasFSA()) {
    const handle = await getFolderHandle();
    if (handle) {
      try {
        const fh = await handle.getFileHandle(b.filename);
        const file = await fh.getFile();
        return await file.text();
      } catch {}
    }
  }
  throw new Error('Bundle bytes are not cached and could not be re-read from the filesystem.');
}

// Re-import the chosen FSA folder into the IDB index. Used after a browser
// data wipe. Bundles that already exist (by id) are skipped.
async function rescanFolder() {
  if (!hasFSA()) throw new Error('Folder rescan requires the File System Access API.');
  const files = await listFolderJsonFiles();
  let imported = 0, skipped = 0, failed = 0;
  for (const { name, file } of files) {
    try {
      const text = await file.text();
      const env = JSON.parse(text);
      if (env.format !== FORMAT) { failed++; continue; }
      const existing = await dbGetBundle(env.bundleId);
      if (existing) { skipped++; continue; }
      const blob = new Blob([text], { type: 'application/json' });
      await dbAddBundle({
        id: env.bundleId,
        createdAt: env.createdAt,
        filename: name,
        sizeBytes: blob.size,
        appIds: Object.keys(env.apps || {}),
        bytes: blob,
        saveMethod: 'fsa',
      });
      imported++;
    } catch (err) {
      failed++;
    }
  }
  return { imported, skipped, failed };
}

// Import user-picked files (multi-file input, used on iOS).
async function importFiles(fileList) {
  let imported = 0, skipped = 0, failed = 0;
  for (const file of fileList) {
    try {
      const text = await file.text();
      const env = JSON.parse(text);
      if (env.format !== FORMAT) { failed++; continue; }
      const existing = await dbGetBundle(env.bundleId);
      if (existing) { skipped++; continue; }
      const blob = new Blob([text], { type: 'application/json' });
      await dbAddBundle({
        id: env.bundleId,
        createdAt: env.createdAt,
        filename: file.name,
        sizeBytes: blob.size,
        appIds: Object.keys(env.apps || {}),
        bytes: blob,
        saveMethod: 'import',
      });
      imported++;
    } catch {
      failed++;
    }
  }
  return { imported, skipped, failed };
}
