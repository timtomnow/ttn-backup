# Adding a new app to ttn-backup

Two changes are required: one in the new app (so it can be snapshotted /
restored), and one in `ttn-backup` itself (so it knows the app exists).

## 1. In the new app

Add two `<script>` tags to your app's HTML, anywhere in the body:

```html
<script src="https://timtomnow.github.io/ttn-backup/client.js" defer></script>
<script>
  window.TTNBackupAdapter = {
    appId: 'my-new-app',                 // unique kebab-case id
    appName: 'My New App',
    version: 1,                          // bump when the data shape changes
    exportData: () => {
      // Return whatever JSON-serializable shape your app considers "everything".
      // For localStorage apps this is usually the parsed JSON of your main key.
      // For IndexedDB apps, reuse the same shape your own export-to-JSON uses.
      return state.data;
    },
    importData: (data) => {
      // Replace the app's data with `data` and trigger whatever your app does
      // when it imports its own JSON file.
      state.data = data;
      saveData();
      location.reload();
    },
  };
</script>
```

That's it for the snapshot/restore round-trip. The utility will pick the
app up automatically.

### Optional: a "Restore from ttn-backup" button

```html
<button onclick="TTNBackup.openImport('my-new-app')">Restore from ttn-backup</button>
```

This opens a Shadow-DOM modal listing every bundle that contains your
app, picks one, and pushes it through your `importData`.

### Notes on the adapter

- `exportData()` may be async. Return a Promise if you need it.
- `importData(data)` may be async. Return a Promise.
- `version` is opaque to the utility but is stored in the bundle so
  `importData` can branch on schema changes if needed.
- Don't include device-local UI state in the export (theme, last-page
  visited) — restore should bring back the user's *data*, not their
  scroll position.
- For IndexedDB apps with blobs (e.g. photos), reuse the same
  base64-encoding your own export already does. The utility is
  blob-agnostic; whatever you return must round-trip through
  `JSON.stringify`.

## 2. In ttn-backup

Append an entry to `APP_REGISTRY` in `js/data.js`:

```js
{
  appId: 'my-new-app',
  name: 'My New App',
  icon: '🆕',
  path: '/my-new-app/',
  description: 'One-line description.',
},
```

Then bump `CACHE_VERSION` in `sw.js` so installed clients pick up the new
registry.

## Testing the round-trip

1. Add your app to the registry (with a dev path, e.g.
   `sample_apps/my-app.html`, while testing).
2. Open the utility. **Apps → Test adapter** pings your app and shows
   the payload size if successful, or the exact error otherwise.
3. **Backup all** writes a real bundle. Check **History → Open** to
   verify your app is in the bundle.
4. **Restore** to verify `importData` is called with the right payload.

If you see "Adapter timeout (export)…", either the script didn't load
(check the network tab) or `TTNBackupAdapter` isn't set on `window`
before `client.js` runs.
