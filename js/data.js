// App registry + in-memory runtime state.
//
// The app registry is the authoritative list of compatible apps. To add a
// new app, append an entry below and ship a deploy.
//
// Each app must also have a `TTNBackupAdapter` global declared in its own
// code (see docs/INTEGRATION.md). The utility doesn't read the registered
// app's storage directly — it asks the app for its data via postMessage.

const APP_REGISTRY = [
  {
    appId: 'fintom-planning',
    name: 'FinTom Financial Planning',
    icon: '📈',
    path: '/financial-plan/',           // GitHub Pages path
    description: 'Self-contained financial planning app.',
  },
  {
    appId: 'ttn-list',
    name: 'TTN List',
    icon: '✅',
    path: '/ttn-list/',
    description: 'Shopping / chores / projects list PWA.',
  },
];

// Find an app definition. Returns undefined if the appId isn't registered.
function getApp(appId) {
  return APP_REGISTRY.find((a) => a.appId === appId);
}

// Resolve an app's iframe URL. In production this is `path` relative to the
// origin. In development (file:// or localhost dev server), the user can
// override per-app paths in Settings; that override is stored in IndexedDB
// (`meta` store, key `appPathOverride:<appId>`).
function appUrl(appId, overrides) {
  const app = getApp(appId);
  if (!app) return null;
  const o = overrides && overrides[appId];
  if (o) return o;
  return app.path;
}

// In-memory runtime state. Mirrors persisted IndexedDB data for the
// current session. Re-loaded on every navigate via `loadState()`.
const state = {
  page: 'dashboard',
  params: {},
  // Settings (persisted in IDB `meta` store):
  retentionPerApp: 3,            // default; per-app overrides in `apps` store
  deviceLabel: '',
  folderName: null,              // human-readable name of chosen folder (Android FSA)
  // Cached lists:
  bundles: [],                   // sorted desc by timestamp
  appsMeta: {},                  // { [appId]: { lastBackupAt, retention } }
  schedules: [],
  // Path overrides for dev:
  pathOverrides: {},
};

// Load all state from IndexedDB. Called once on init and after any
// persisted mutation.
async function loadState() {
  state.bundles = await dbListBundles();
  state.appsMeta = await dbGetAppsMeta();
  state.schedules = await dbListSchedules();
  state.retentionPerApp = (await dbGetMeta('retentionPerApp')) ?? 3;
  state.deviceLabel = (await dbGetMeta('deviceLabel')) ?? '';
  state.folderName = (await dbGetMeta('folderName')) ?? null;
  state.pathOverrides = (await dbGetMeta('pathOverrides')) ?? {};
}

// Retention for a specific app. Falls back to the global default.
function retentionFor(appId) {
  return state.appsMeta?.[appId]?.retention ?? state.retentionPerApp;
}

// Last backup timestamp for a specific app.
function lastBackupFor(appId) {
  // Each bundle records which appIds it contained; find the most recent
  // bundle that contains this app.
  for (const b of state.bundles) {
    if (b.appIds && b.appIds.includes(appId)) return b.createdAt;
  }
  return null;
}
