# ttn-backup — Plan

A backup utility PWA for the suite of `timtomnow.github.io/*` apps.

This file is the living spec. Update it whenever a design decision changes.

## Purpose

All apps in the suite are local-first PWAs that store data in the browser
(localStorage and/or IndexedDB) and import/export JSON. Because they share an
origin (`timtomnow.github.io`), one app accidentally clearing site data,
storage eviction by the OS, or a stray "clear browsing data" can wipe
everything across all apps. **ttn-backup** exists to protect against that:
it produces durable on-device JSON backups outside of browser storage and
provides a one-tap restore path back into each app.

## Hosting / origin assumption

All compatible apps live under `timtomnow.github.io/<repo>/`. They share the
origin `timtomnow.github.io`, which means:

- They share `localStorage`, `IndexedDB`, `BroadcastChannel`, etc.
- The utility can load any of them in a same-origin iframe and exchange
  `postMessage`s.
- A script served from `/ttn-backup/client.js` can be embedded in any app
  and read/write shared storage on its behalf.

If any app moves to a custom domain in the future, that app drops out of
the suite until it moves back (or until we add a cross-origin transport,
which is a separate effort).

## Devices

Both iOS (Safari) and Android (Chrome). The big platform split is:

| Capability                     | Android Chrome    | iOS Safari        |
|--------------------------------|-------------------|-------------------|
| File System Access API         | Yes               | No                |
| Periodic Background Sync       | Yes (installed)   | No                |
| Web Share API w/ files         | Yes               | Yes               |
| `<a download>` to Files app    | Yes               | Yes               |
| Installable PWA                | Yes               | Yes (limited)     |

This shapes everything below.

## Snapshot strategy

The utility does **not** read each app's storage directly. Each compatible
app exposes a small adapter that delegates to its existing export/import:

```js
// In each compatible app:
window.TTNBackupAdapter = {
  appId: 'fintom-planning',
  appName: 'FinTom Financial Planning',
  version: 1,
  exportData: () => state.data,             // returns a JSON-serializable object
  importData: (data) => { /* app's own import path */ },
};
```

The utility runs a backup by opening each app's path in a hidden
same-origin iframe and exchanging `postMessage`s with `client.js`, which
calls into `TTNBackupAdapter`. Same flow in reverse for restores.

Benefits:

- Single source of truth: each app already has export/import, we reuse it.
- Works transparently for localStorage AND IndexedDB AND mixed storage.
- Blobs (e.g. `ttn-list` photos) are handled by the app's own
  base64-encoding logic in its export function — utility stays agnostic.

## File format

One backup file per "Backup all" run is a JSON document:

```json
{
  "format": "ttn-backup",
  "formatVersion": 1,
  "createdAt": "2026-05-27T15:30:00.000Z",
  "device": "<optional user-set device label>",
  "bundleId": "<uuid>",
  "apps": {
    "fintom-planning": {
      "appName": "FinTom Financial Planning",
      "appVersion": 1,
      "payload": { /* whatever exportData() returned */ }
    },
    "ttn-list": {
      "appName": "TTN List",
      "appVersion": 1,
      "payload": { /* ... */ }
    }
  }
}
```

Filename: `ttn-backup-bundle-YYYYMMDD-HHmm.json`.

**Split-on-import**: the import UI on each app can extract a single app's
section from a bundle when needed.

## Storage layers

Two layers:

1. **Filesystem (source of truth, durable)**
   - **Android (Chrome)**: File System Access API. User picks a folder once
     via "Settings → Choose backup folder"; the handle is persisted in
     IndexedDB; subsequent writes are silent.
   - **iOS (Safari)**: Web Share API with `files: [...]` so the system
     share sheet pops and the user saves to the Files app (iCloud Drive,
     On My iPhone, etc.). Each save is a single user gesture (this is the
     iOS Safari constraint — there is no silent file write).
2. **IndexedDB (working copy + index)**
   - Mirrors metadata (id, bundleId, appId list, timestamp, filename,
     sizeBytes, sha?) for fast UI rendering of "last backup", history list.
   - Also caches the JSON bytes as a defensive duplicate (cleared if the
     user wants).
   - **Not** the durable copy — Safari can evict IndexedDB after ~7 days
     of disuse. Filesystem copy is the safety net.

### Recovery after browser wipe

A "Re-import backup folder" action in Settings:

- Android: re-pick the folder via FSA, utility re-scans `.json` files and
  rebuilds the IndexedDB index.
- iOS: a `<input type="file" multiple accept=".json">` lets the user pick
  one or many previously-saved backup files, utility rebuilds the index.

## Per-app integration

Each compatible app adds:

```html
<script src="https://timtomnow.github.io/ttn-backup/client.js" defer></script>
<script>
  window.TTNBackupAdapter = {
    appId: 'fintom-planning',
    appName: 'FinTom Financial Planning',
    version: 1,
    exportData: () => state.data,
    importData: (data) => { state.data = data; saveData(); location.reload(); },
  };
</script>
<button onclick="TTNBackup.openImport('fintom-planning')">Restore from ttn-backup</button>
```

`client.js` is served from the utility origin, so improvements flow to every
compatible app on next load — no per-app deploy needed.

The script:

- In **standalone** mode (running in its own tab/window): exposes
  `TTNBackup.openImport(appId)` which opens a Shadow-DOM modal listing
  backups for that app from the shared IndexedDB; on selection, calls the
  adapter's `importData(...)`.
- In **iframe** mode (loaded by the utility): listens for postMessages and
  uses the adapter to fulfil export/import requests.

Mode is detected via `window.parent !== window` and an init handshake
message.

## Scheduling via .ics

Reminder-based (not background-execution-based):

- User builds a schedule in the utility: "FinTom + ttn-list, weekly Sundays
  9am, keep 3 backups per app."
- Utility generates a downloadable `.ics` file with:
  - `RRULE` for recurrence.
  - `URL` and description pointing at
    `https://timtomnow.github.io/ttn-backup/?run=<scheduleId>`.
- User imports the `.ics` into their calendar of choice.
- At the reminder time, the calendar pops a notification. User taps the
  link → utility opens → runs the schedule → on iOS, one share-sheet tap
  to save the bundle → done.

Retention is **per app** (default 3). When a new bundle is saved, after
the write succeeds the utility prunes the oldest bundles for each app
beyond its retention count. Pruning a bundle removes its file and its
index entry; if the bundle contained multiple apps and only one is past
retention, we keep the bundle but the index could remove that app's
reference — first pass implementation prunes whole bundles, treating any
app being in a bundle as "this bundle counts for that app's retention."

## V1 scope

Apps wired up in v1:

- `fintom-planning`
- `ttn-list`

Pages in v1:

- **Dashboard** — current backup status per app, "Backup all now" button.
- **Apps** — list of registered apps, retention setting, "Test snapshot."
- **History** — flat list of all bundles, with detail view + restore.
- **Schedules** — list of schedules, create/edit, download `.ics`. (Basic
  in v1; can grow later.)
- **Settings** — folder selection (Android), import-folder recovery, app
  registry overrides, danger zone (clear index, etc.), about.

## Out of scope for v1

- Cross-device sync (user will email JSON files between devices as
  needed).
- Cloud backup destinations (Drive/Dropbox/GitHub Gist).
- Encryption-at-rest of backup files.
- More than the two seeded apps.

## File map (target)

```
ttn-backup/
├── index.html              # PWA shell, loads vendored deps + js/*
├── styles.css              # Mobile-first design system
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker (cache-first)
├── client.js               # Cross-app snippet (loaded by other apps)
├── README.md               # End-user instructions
├── PLAN.md                 # This file
├── icons/
│   └── ICONS_NEEDED.md     # Placeholder; PNG icons to be added
├── docs/
│   └── INTEGRATION.md      # How to add a new app
├── sample_apps/
│   └── demo-host.html      # A trivial host app for testing round-trip
└── js/
    ├── utils.js            # Pure helpers
    ├── data.js             # App registry + in-memory state
    ├── storage.js          # IndexedDB + FSA/share-sheet abstraction
    ├── backup.js           # Snapshot + restore orchestration
    ├── schedule.js         # .ics generation
    ├── ui.js               # Shared UI infra (navigate, modals, toasts)
    └── pages/
        ├── dashboard.js
        ├── apps.js
        ├── history.js
        ├── schedules.js
        └── settings.js
```

## Build slices

1. **Slice 1 (this commit)**: scaffold + IndexedDB + folder choice +
   backup-all + history list + restore. Round-trip self-test using a tiny
   `sample_apps/demo-host.html` adapter.
2. **Slice 2**: wire `fintom-planning` and `ttn-list` adapters; verify
   real backup/restore.
3. **Slice 3**: schedules + `.ics` generation + URL-action handling
   (`?run=<id>`).
4. **Slice 4**: polish — install prompt, error states, retention edge
   cases, design pass against ttn-list aesthetic.

## Open questions / future work

- ttn-list uses Vite + React; its `TTNBackupAdapter` needs to be set up
  inside the React app (likely in `app/` providers). Confirm during Slice
  2.
- The bundle-vs-per-app retention policy might need rethinking once we
  see real usage. First pass treats each bundle as one unit and prunes
  whole bundles.
- Periodic Background Sync (Android only, installed PWA only) could
  optionally fire scheduled backups without the user tapping a calendar
  reminder. Defer to post-v1.
