# GitHub PM Reminders (Prototype)

A SvelteKit + Cloudflare Workers app that scans public GitHub repositories and creates in-app reminders for project managers.

## Features (Prototype)

- Sign in with GitHub (read-only)
- Create a project linked to a public repo
- Configure reminder rules with custom thresholds
- Manual scan from project page
- HTTP endpoint `/api/scan` for periodic scans via external cron service
- In-app reminders dashboard

## Reminder Types

- **Assigned but not started** — issue assigned but no linked PR / not moved to In Progress
- **PR open too long** — PR open longer than threshold
- **PR with no review** — PR open with no review longer than threshold
- **Approved but not merged** — PR approved but unmerged longer than threshold
- **No activity** — issue or PR with no activity longer than threshold
- **Stuck in project column** — placeholder (requires GitHub Projects v2 GraphQL integration)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a GitHub OAuth app

- Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
- Application name: `GitHub PM Reminders`
- Authorization callback URL: `http://localhost:5173/auth/callback`
- Copy the **Client ID** and **Client Secret**

### 3. Create a D1 database

```bash
npx wrangler d1 create github-pm-reminders-db
```

Update `wrangler.toml` with the `database_id` from the output.

### 4. Set secrets

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `SESSION_SECRET`
(`SESSION_SECRET` can be any long random string). `.dev.vars` is gitignored.

For production:

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CRON_SECRET
```

Also update `GITHUB_CLIENT_ID` and `APP_URL` in `wrangler.toml`.

### 5. Apply database migrations

Local:
```bash
npm run db:migrate:local
```

Production:
```bash
npm run db:migrate:prod
```

### 6. Run locally

Either use the Vite dev server (bindings and `wrangler.toml` vars are emulated,
and `.dev.vars` is loaded):

```bash
npm run dev
```

Or build first, then use Wrangler dev explicitly:

```bash
npm run build
npx wrangler dev --port 5173
```

Open http://localhost:5173.

If "Sign in with GitHub" lands on a GitHub 404, the `GITHUB_CLIENT_ID` is still
the placeholder value or does not match a real OAuth app.

## Deployment

```bash
npm run build
npm run deploy
```

Apply migrations in production:
```bash
npm run db:migrate:prod
```

## Periodic Scanning

For the prototype, periodic scans can be triggered by:

1. Clicking **Scan now** on a project page
2. Calling `/api/scan` with the `x-cron-secret` header matching `CRON_SECRET`

For production, configure an external cron service (e.g., cron-job.org, GitHub Actions) to hit `/api/scan` hourly.

## Known Limitations

- Only public repositories
- One project per user in the prototype
- "Stuck in project column" is not yet implemented
- "Moved to In Progress" detection uses linked PR as proxy
- PM invitations and org-level views are not implemented yet
