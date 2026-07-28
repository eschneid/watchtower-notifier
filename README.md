# watchtower-notifier

Standalone cron runner for [Watchtower](https://mcschneiderdesigns.com/watchtower)'s
real-time social notifications (likes & comments on your activity feed).

This repo is intentionally **public** so its GitHub Actions minutes are unlimited.
It contains **no secrets and no app source** — only the queue-drainer script. The
app source lives in the private `watchtower-mobile` repo.

## How it works

1. When a friend likes or comments on your activity, the Watchtower app writes a
   lightweight doc to the Firestore `notificationQueue` collection.
2. `notify-social.js` runs every 15 minutes (via `.github/workflows/notify-social.yml`),
   drains the queue, collapses multiple interactions per recipient into one push,
   and sends an FCM notification. Processed docs are deleted; stale device tokens
   are pruned automatically.

## Setup

The only requirement is one repository secret:

- **`FIREBASE_SERVICE_ACCOUNT`** — the full Firebase service-account JSON (same value
  used by the private repo's workflows). Add via **Settings → Secrets and variables →
  Actions**, or:

  ```sh
  gh secret set FIREBASE_SERVICE_ACCOUNT < service-account.json
  ```

The service account is encrypted by GitHub and is never exposed in a public repo
(it is also unavailable to fork pull requests).

## Manual run

Trigger from the **Actions** tab → *Notify Social Interactions* → *Run workflow*.
