# watchtower-notifier

Cron runner for [Watchtower](https://mcschneiderdesigns.com/watchtower)'s
scheduled background jobs — social pushes, the "airs today" reminder, and the
nightly metadata sync.

This repo is intentionally **public** so its GitHub Actions minutes are
unlimited. Billing follows the repo that *owns* a workflow, not the repo the
code is checked out from, so a job here is free even when it runs private code.

It stores **no secrets and no app source**. The app source lives in the private
`watchtower-mobile` repo, and two of the workflows below check it out at run
time rather than keeping a copy — see "Why the app repo is checked out".

## Why these jobs live here rather than in the app repo

Actions minutes on a **private** repo come out of a 2,000-minute monthly
allowance. On 2026-09-19 that allowance was fully consumed with eleven days left
in the cycle. On GitHub Free the consequence is not a bill — private-repo
workflows simply **stop** until the allowance resets.

For the airing reminder that would have meant no "your show airs today" pushes
for eleven days, with nothing to report it except users not hearing anything.
Moving the job to a public repo removes the failure mode rather than monitoring
for it.

## The jobs

| Workflow | Trigger | What it does |
|---|---|---|
| `notify-social.yml` | cron-job.org, ~5 min | Drains the Firestore `notificationQueue`: likes and comments on your activity, collapsed into one push per recipient. Deletes processed docs and prunes stale device tokens. |
| `notify-airing.yml` | cron-job.org, 13:00 UTC | Sends "airs today" reminders for shows in people's libraries. |
| `sync-shows.yml` | GitHub `schedule`, 04:00 UTC | Refreshes show metadata from TMDb. |

`notify-social.js` lives in this repo. The other two run scripts from the app
repo.

### Why GitHub's own cron drives only one of them

GitHub's `schedule` does not run when you ask it to — against a 13:00 target it
fired at 15:47, 16:43, 16:56, 17:00, 17:09, 18:06 and once 19:23. For a "your
show airs today" reminder, three to six hours late means arriving in the evening
for something that started at nine. cron-job.org hit 13:00:15 on its first run.

So the two time-sensitive jobs are driven externally and carry no `schedule:`
block at all. Only `sync-shows.yml` still uses GitHub's cron, because a metadata
sync landing at 07:00 instead of 04:00 costs nothing.

⚠️ GitHub **disables scheduled workflows in public repos after 60 days with no
repository activity** and emails the owner. That applies to `sync-shows.yml`
alone. If show metadata quietly stops refreshing, check whether the workflow was
disabled before looking at the code.

## Why the app repo is checked out

`notify-airing.js` needs `airingPayload.js` and, through it,
`src/services/airDates.js` — the viewer's own corrected air dates. Copying those
here would put a second copy of the air-date rules in a second repo, free to
drift from the app's. `airDates.js` is explicit that its aired-count rule has to
agree with the one the cards use, or the progress bar lies about its own scale;
two copies is how that stops being true without anyone noticing.

One copy, checked out at run time, cannot drift. The cost is a token, below.

## Setup

Three repository secrets, under **Settings → Secrets and variables → Actions**:

- **`FIREBASE_SERVICE_ACCOUNT`** — the full Firebase service-account JSON (the
  same value the private repo's workflows use).

  ```sh
  gh secret set FIREBASE_SERVICE_ACCOUNT < service-account.json
  ```

- **`TMDB_API_KEY`** — for `sync-shows.yml`.

- **`MOBILE_REPO_TOKEN`** — a fine-grained personal access token with
  **read-only access to `eschneid/watchtower-mobile`** (Repository permissions →
  Contents: Read). Used by `actions/checkout` to pull the app repo.

  ⚠️ **This token expires.** When it does, both checkout steps fail with a 404
  that reads as though the repository is missing rather than as though a
  credential lapsed, and the airing pushes stop. If either job starts failing
  and nothing about the code changed, check the token first. Set a reminder for
  a week before its expiry date.

Secrets are encrypted by GitHub, are never exposed in a public repo, and are
unavailable to fork pull requests. None of the workflows here can be triggered
by a fork PR — the two external ones are `workflow_dispatch` only.

## Manual run

**Actions** tab → pick the workflow → **Run workflow**.
