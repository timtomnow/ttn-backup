---
title: Test an app's backup connection
category: Backing up
order: 30
summary: Check that an app responds before you rely on it for backups.
---

Each app needs a small piece of backup wiring to be reachable. A quick test
confirms an app is responding and shows how much data it would back up, so you
can spot a problem before a real backup misses it.

## Steps

1. Open the **Apps** tab from the bottom bar.
2. Find the app's card.
3. Tap **Test adapter**.

## What you'll see

If the app responds, an **Adapter test passed** message shows the app's name,
its version, and the size of the data it would back up. If it fails, a short
error explains why — usually the app's backup wiring isn't loaded, so its
backups would be skipped until that's fixed.

## Related guides

- [Back up a single app](/help/back-up-a-single-app)
- [Back up all your apps](/help/back-up-all-your-apps)
