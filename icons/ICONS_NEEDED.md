# Icons

Required for full PWA installability:

- `icon-192.png` — 192×192 PNG
- `icon-512.png` — 512×512 PNG

Chrome will not surface the install prompt until at least a 192×192 icon
is present. The app runs fine without them; only installability is
affected. iOS uses `apple-touch-icon` (currently pointed at
`icon-192.png`).

Use a simple, recognizable mark — a stylized 💾 / archive box / nested
folders works. Match the `ttn-list` aesthetic when those exist.
