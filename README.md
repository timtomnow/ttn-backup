# ttn-backup

A backup utility PWA for the `timtomnow.github.io/*` app suite.

All apps in the suite store data in the browser (localStorage or
IndexedDB). Because they share an origin, a single "clear site data" can
wipe everything across apps. **ttn-backup** captures all your apps'
exports into a single JSON bundle, writes that bundle to durable storage
(outside the browser), and provides a one-tap restore path back into each
app.

## Quick start

1. Open `index.html` directly, or host the folder behind any static
   server. There's no build step.
2. (Android only) **Settings → Choose backup folder** picks the folder
   where bundles are silently written.
3. **Backup all** snapshots every registered app and saves a single
   `ttn-backup-bundle-YYYYMMDD-HHmm.json` bundle.
4. **History → Open → Restore** pushes a saved bundle's data back into
   any app.

On iOS Safari, the **Backup all** flow uses the system share sheet so you
can save the bundle to Files / iCloud Drive. One tap per save — that's
the platform constraint.

## How it works

Each compatible app declares a small adapter:

```html
<script src="https://timtomnow.github.io/ttn-backup/client.js" defer></script>
<script>
  window.TTNBackupAdapter = {
    appId: 'fintom-planning',
    appName: 'FinTom Financial Planning',
    version: 1,
    exportData: () => state.data,
    importData: (data) => { /* the app's own import path */ },
  };
</script>
```

The utility runs each backup by loading every app in a hidden same-origin
iframe and exchanging `postMessage`s with `client.js`. It never reads any
app's storage directly — the app's own export function is the source of
truth. See [docs/INTEGRATION.md](docs/INTEGRATION.md) for the full
integration guide.

## Tips

- **iOS users**: pick the same Files destination each time (e.g. iCloud
  Drive → ttn-backup). The Save sheet remembers your last folder so it's
  effectively one tap.
- **Browser data wipes happen**: that's why we write JSON files. After a
  wipe, **Settings → Import backup files** lets you pick all the
  previously-saved `.json` files to rebuild the local index.
- **Email a bundle** to another device to migrate — the bundle is just a
  JSON file.

## Files & where to look

See [PLAN.md](PLAN.md) for the developer/architecture spec, build slices,
and open questions. See [docs/INTEGRATION.md](docs/INTEGRATION.md) for
how to add a new app.

## V1 status

V1 ships with adapters for:

- `fintom-planning`
- `ttn-list`
- `stock-style-analyzer`
- `dart-trainer`
- `plot-my-notes`

Adding more apps is a one-line entry in `js/data.js` plus dropping the
adapter snippet into the new app's HTML.
