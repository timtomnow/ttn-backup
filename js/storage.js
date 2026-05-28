// Storage layer:
//   - IndexedDB for the working copy + index (`dbXxx` functions).
//   - Filesystem for the durable copy. Two backends:
//       FSA (Android Chrome): silent writes once a folder is chosen.
//       Share-sheet (iOS Safari + everything else): user gesture per save.
//   - Detected via `hasFSA()` and `getFolderHandle()`.
//
// IndexedDB schema (db = `ttnBackup`, version 1):
//
//   bundles:   keyPath 'id',  indexes: 'createdAt'
//              { id, createdAt, filename, sizeBytes, appIds: [], bytes: Blob, sha? }
//   apps:      keyPath 'appId'
//              { appId, retention?, lastBackupAt? }
//   schedules: keyPath 'id'
//              { id, name, appIds, rrule, retention?, createdAt }
//   meta:      keyPath 'key'
//              { key, value }     // retentionPerApp, deviceLabel, folderName,
//                                 //  folderHandle (FileSystemDirectoryHandle), pathOverrides

const DB_NAME = 'ttnBackup';
const DB_VERSION = 1;
let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('bundles')) {
        const s = db.createObjectStore('bundles', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('apps')) {
        db.createObjectStore('apps', { keyPath: 'appId' });
      }
      if (!db.objectStoreNames.contains('schedules')) {
        db.createObjectStore('schedules', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

// ----- meta store -----

async function dbGetMeta(key) {
  const db = await openDb();
  const row = await idbReq(db.transaction('meta').objectStore('meta').get(key));
  return row ? row.value : undefined;
}

async function dbSetMeta(key, value) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await idbTx(tx);
}

// ----- bundles -----

async function dbAddBundle(bundle) {
  const db = await openDb();
  const tx = db.transaction('bundles', 'readwrite');
  tx.objectStore('bundles').put(bundle);
  await idbTx(tx);
}

async function dbListBundles() {
  const db = await openDb();
  const tx = db.transaction('bundles');
  const items = await idbReq(tx.objectStore('bundles').getAll());
  items.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return items;
}

async function dbGetBundle(id) {
  const db = await openDb();
  return idbReq(db.transaction('bundles').objectStore('bundles').get(id));
}

async function dbDeleteBundle(id) {
  const db = await openDb();
  const tx = db.transaction('bundles', 'readwrite');
  tx.objectStore('bundles').delete(id);
  await idbTx(tx);
}

// ----- apps meta -----

async function dbGetAppsMeta() {
  const db = await openDb();
  const all = await idbReq(db.transaction('apps').objectStore('apps').getAll());
  const out = {};
  for (const a of all) out[a.appId] = a;
  return out;
}

async function dbSetAppMeta(appId, patch) {
  const db = await openDb();
  const tx = db.transaction('apps', 'readwrite');
  const store = tx.objectStore('apps');
  const existing = await idbReq(store.get(appId));
  const next = { appId, ...(existing || {}), ...patch };
  store.put(next);
  await idbTx(tx);
}

// ----- schedules -----

async function dbListSchedules() {
  const db = await openDb();
  return idbReq(db.transaction('schedules').objectStore('schedules').getAll());
}

async function dbAddSchedule(s) {
  const db = await openDb();
  const tx = db.transaction('schedules', 'readwrite');
  tx.objectStore('schedules').put(s);
  await idbTx(tx);
}

async function dbDeleteSchedule(id) {
  const db = await openDb();
  const tx = db.transaction('schedules', 'readwrite');
  tx.objectStore('schedules').delete(id);
  await idbTx(tx);
}

// ----- filesystem layer -----

function hasFSA() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// Web Share API with files. iOS Safari needs this for durable saves.
function canShareFiles() {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

// Pick (or re-pick) a backup folder. Persists the handle. Android Chrome only.
async function chooseBackupFolder() {
  if (!hasFSA()) throw new Error('File System Access API not supported on this device.');
  const handle = await window.showDirectoryPicker({ id: 'ttn-backup', mode: 'readwrite', startIn: 'documents' });
  // Verify we have readwrite permission persistently.
  if (handle.queryPermission) {
    const p = await handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') {
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') throw new Error('Read/write permission was not granted.');
    }
  }
  await dbSetMeta('folderHandle', handle);
  await dbSetMeta('folderName', handle.name);
  return handle.name;
}

async function getFolderHandle() {
  const handle = await dbGetMeta('folderHandle');
  if (!handle) return null;
  if (handle.queryPermission) {
    let p = await handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') {
      // Permissions can lapse — re-request needs a user gesture; surfaced
      // higher up in the UI.
      p = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    }
    if (p !== 'granted') return null;
  }
  return handle;
}

// Save a JSON bundle to the filesystem.
//   On Android (FSA): silent write to chosen folder.
//   On iOS / fallback: triggers the share sheet so the user can save to Files.
// Returns { method: 'fsa' | 'share' | 'download', filename }.
async function saveBundleFile(filename, blob) {
  const handle = hasFSA() ? await getFolderHandle() : null;
  if (handle) {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { method: 'fsa', filename };
  }
  // No FSA / no chosen folder. Try the share sheet (best on iOS), else fall back to download.
  const file = new File([blob], filename, { type: 'application/json' });
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { method: 'share', filename };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      // fall through to download
    }
  }
  // <a download> fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { method: 'download', filename };
}

// Delete a file from the chosen folder (FSA only). No-op if no folder or
// no FSA — the user's iCloud / Files copy is theirs to manage.
async function deleteBundleFile(filename) {
  const handle = hasFSA() ? await getFolderHandle() : null;
  if (!handle) return false;
  try {
    await handle.removeEntry(filename);
    return true;
  } catch (err) {
    return false;
  }
}

// List .json files in the chosen folder (FSA only). Used by the
// "Re-import folder" recovery action.
async function listFolderJsonFiles() {
  const handle = hasFSA() ? await getFolderHandle() : null;
  if (!handle) return [];
  const out = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && name.toLowerCase().endsWith('.json')) {
      const file = await entry.getFile();
      out.push({ name, file });
    }
  }
  return out;
}
