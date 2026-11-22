# Reminders

An inbox for the work a project manager has to chase: issues that were handed out but never started, pull requests waiting on review, approvals that never merged, and work that has gone quiet.

Built with SvelteKit on Cloudflare Workers, with D1 for state. Deployed at
https://reminders.franciscaportugal2005.workers.dev.

## What it does

- Signs in with GitHub (read-only) and tracks public repositories
- Puts every project's reminders into **one inbox**, ordered by how long each has been waiting
- Filters by project and rule, sorts oldest or newest first, and keeps all of it in the URL
- **Snoozes** a reminder for a day, three days or a week, with a page for everything currently snoozed
- **Dismisses** with a five-second undo
- Marks rows seen only once they have actually been on screen, so the sidebar count means something
- Gives each project its own **rules page**: thresholds, live counts, scan history and deletion
- Scans on demand per project, or on a schedule through `/api/scan`

## Inbox behaviour

- **Groups** are Over a week, This week and Today, ordered oldest first by default.
- **The left bar** is teal when a reminder appeared in the most recent scan or is still unread, and muted when it was carried over and has been seen.
- **Seen** means “was on screen for a moment”, not “the inbox was opened”.
- **Keyboard**: `j` / `k` move, `Enter` opens on GitHub, `d` dismisses, `s` snoozes three days, `Escape` clears the selection.
- **Touch**: swipe a reminder left to dismiss or right to snooze three days; in Snoozed a right swipe brings it back. The snooze button opens a bottom sheet with 1 day, 3 days and 1 week, and the mobile sidebar closes with a left drag.

## Reminder rules

| Rule | Fires when |
| --- | --- |
| Assigned but not started | An assigned issue has no linked PR and/or has not moved to In Progress |
| PR open too long | A pull request has been open past the threshold |
| Needs review | A pull request is waiting for a first review, or a re-review after new commits, past the threshold |
| Changes requested | A pull request has changes requested and the author has not pushed since |
| Approved but not merged | An approved pull request has not been merged past the threshold |
| Merge conflicts | A pull request has had unresolved merge conflicts past the threshold |
| No activity | An issue or PR has had no activity past the threshold |
| Stuck in project column | Shown but disabled: requires the GitHub Projects v2 API |

“Counts as started” is configurable per rule: a linked PR, movement to In Progress, or both.

## Reminder lifecycle

Each project, rule and item owns exactly one reminder row:

- a new match creates it as **open**
- a match that is still true refreshes its message and assignee, keeping seen and snooze state
- a condition that stops matching marks it **resolved**
- a condition that comes back **reopens** it as unread
- a reminder you **dismiss** stays dismissed until you restore it, and the scanner will not recreate it

Disabling a rule resolves the reminders it already produced.

## Stack

- SvelteKit 2 and Svelte 5, deployed with `@sveltejs/adapter-cloudflare`
- Cloudflare Workers with a D1 database
- Tailwind CSS 4 and shadcn-svelte (bits-ui)
- Self-hosted Geist and Geist Mono

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a GitHub OAuth app

- GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Application name: `Reminders`
- Authorization callback URL: `http://localhost:5173/auth/callback` for local
  development. A deployment needs `${APP_URL}/auth/callback` instead, e.g.
  `https://reminders.<your-subdomain>.workers.dev/auth/callback`; create a
  second OAuth app if you want both.
- Copy the **Client ID** and **Client Secret**

### 3. Create a D1 database

```bash
npx wrangler d1 create github-pm-reminders-db
```

Put the `database_id` from the output into `wrangler.toml`.

### 4. Configure secrets

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `SESSION_SECRET`
(any long random string). `.dev.vars` is gitignored.

For production:

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CRON_SECRET
```

Also set `GITHUB_CLIENT_ID` and `APP_URL` in `wrangler.toml`.

### 5. Apply migrations

```bash
npm run db:migrate:local
```

Migrations are additive; run them before deploying code that needs new columns.

### 6. Run locally

```bash
npm run dev
```

Bindings and `wrangler.toml` vars are emulated and `.dev.vars` is loaded. Open
http://localhost:5173.

If “Sign in with GitHub” lands on a GitHub 404, `GITHUB_CLIENT_ID` is still the
placeholder or does not match a real OAuth app.

## Deployment

The Worker is named `reminders` in `wrangler.toml`, so it deploys to
`https://reminders.<your-subdomain>.workers.dev`. Set `APP_URL` to that origin
and register `${APP_URL}/auth/callback` on the GitHub OAuth app before signing
in.

```bash
npm run build
npm run db:migrate:prod
npm run deploy
```

Run `npm run build` first: `npm run deploy` uploads whatever is already in
`.svelte-kit/cloudflare`. Secrets belong to the Worker, not to the repository,
so re-add them with `wrangler secret put` if you rename or recreate it.

## Scheduled scans

There are two ways to scan:

1. **Scan now** on a project page
2. `GET /api/scan` with an `x-cron-secret` header matching `CRON_SECRET`, which scans every project

Point an external scheduler (cron-job.org, GitHub Actions, a Worker cron) at the
endpoint, hourly is a sensible default.

## Limits

- Public repositories only.
- A scan reads the first 100 open issues and 100 open pull requests per repository.
- “Stuck in project column” needs GitHub Projects v2 and is not implemented.
- No email, Slack or desktop notifications; everything is in-app.
- Team invitations and organisation-level views do not exist yet; a project belongs to the user who created it.
