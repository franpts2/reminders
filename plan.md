# GitHub PM Reminders — Product Plan

> **Status:** Prototype built  
> **Temp name:** GitHub PM Reminders  
> **Target users:** Project managers and coordinators of GitHub-based teams  

---

## 1. Vision

A lightweight web app that helps project managers stay on top of their team's GitHub activity by generating configurable reminders such as:

- "X has been assigned to an issue for Y days and hasn't started."
- "X opened a PR on this issue Y days ago."
- "PR #N has been approved but not merged for Y days."

The app is designed to work with **any public GitHub repository** used by a team with PMs/coordinators, not only TTS.

---

## 2. Target Users & Permissions

| Role | Description | Permissions |
|---|---|---|
| **Project Manager / Coordinator** | Owns or is invited to a project; configures rules and receives reminders | Create projects, configure reminders, view dashboard, dismiss reminders |
| **Superior / Org-level coordinator** | Oversees multiple projects | (Future) org-level view across multiple projects |
| **Team members (GitHub users)** | Assigned to issues and PRs | No app account needed; actions are read from GitHub |

**Prototype scope:** one user owns one project; invitations and org-level views are out of scope for the prototype.

---

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Full-stack framework | SvelteKit |
| Deployment target | Cloudflare Workers (`@sveltejs/adapter-cloudflare`) |
| Styling | Tailwind CSS |
| Database | Cloudflare D1 (SQLite) |
| Short-term cache / dedup | Cloudflare KV (reserved for future use) |
| Authentication | GitHub OAuth (prototype); later switchable to organization-specific auth |
| Scheduling | External cron service calling `/api/scan` (prototype); Cloudflare Cron Trigger or equivalent for production |
| Notifications | In-app dashboard (prototype); Google Chat integration planned |

---

## 4. Features

### In scope for prototype
- Sign in with GitHub
- Create a project linked to one public GitHub repo
- Configure reminder types per project with custom thresholds
- Choice of "started" definition for assigned issues:
  - Linked PR exists
  - Moved to In Progress column
  - Both
- Manual scan trigger from project page
- HTTP endpoint for periodic scans
- In-app reminders list with dismiss action
- Deduplication: reminders are not re-created within a 3-day window

### Out of scope for prototype
- Inviting other PMs to a project
- Org-level view for superiors
- Google Chat notifications
- Weekly summaries
- Metrics dashboard
- Private repositories
- GitHub webhooks / real-time updates
- Multi-project per user

### Future features
- Google Chat space notifications
- Email / Slack / Teams support
- Weekly summary on user-chosen day
- Real-time via GitHub webhooks
- Metrics and analytics
- Org-level rollups
- Project invitations and RBAC
- Support for private repos (GitHub App)

---

## 5. Reminder Types

| Type | Trigger Condition | Configurable Threshold | Notes |
|---|---|---|---|
| **Assigned but not started** | Issue assigned, no linked PR, not in In Progress | Days since assignment | "Started" definition is configurable |
| **PR open too long** | PR is open | Days since PR opened | Draft PRs count (they indicate work in progress) |
| **PR with no review** | PR open with no submitted review | Days since PR opened |  |
| **Approved but not merged** | PR approved but unmerged | Days since last approval |  |
| **No activity** | Issue or PR has had no updates | Days since last `updated_at` |  |
| **Stuck in project column** | Item in same board column too long | Days | Requires GitHub Projects v2 GraphQL; placeholder in prototype |

Reminders are created **per issue/PR** (not batched). One open reminder per issue/PR per type at a time.

---

## 6. Data Model

### `users`
Stores authenticated PMs.

| Field | Type | Notes |
|---|---|---|
| id | TEXT PK |  |
| github_id | INTEGER UNIQUE |  |
| github_login | TEXT |  |
| email | TEXT | Nullable |
| avatar_url | TEXT | Nullable |
| access_token | TEXT | Encrypted GitHub OAuth token |
| created_at | DATETIME |  |

### `projects`
Stores linked GitHub repositories.

| Field | Type | Notes |
|---|---|---|
| id | TEXT PK |  |
| name | TEXT | User-facing project name |
| owner | TEXT | GitHub owner/org |
| repo | TEXT | Repository name |
| created_by_user_id | TEXT FK | Project owner |
| created_at | DATETIME |  |

### `reminder_configs`
Per-project rule configuration.

| Field | Type | Notes |
|---|---|---|
| id | TEXT PK |  |
| project_id | TEXT FK |  |
| type | TEXT | Reminder type key |
| enabled | INTEGER | 0 or 1 |
| threshold_days | INTEGER |  |
| started_definition | TEXT | `linked_pr`, `in_progress_column`, `both` (only for assigned_not_started) |

### `reminders`
Generated reminders.

| Field | Type | Notes |
|---|---|---|
| id | TEXT PK |  |
| project_id | TEXT FK |  |
| type | TEXT |  |
| github_item_number | INTEGER | Issue or PR number |
| github_item_type | TEXT | `issue` or `pr` |
| github_url | TEXT | Link to item |
| title | TEXT | Item title |
| assignee | TEXT | Nullable |
| message | TEXT | Human-readable reminder text |
| status | TEXT | `open`, `seen`, `dismissed` |
| created_at | DATETIME |  |
| seen_at | DATETIME | Nullable |

### `scan_logs`
Tracks scan runs.

| Field | Type | Notes |
|---|---|---|
| id | TEXT PK |  |
| project_id | TEXT FK |  |
| started_at | DATETIME |  |
| finished_at | DATETIME | Nullable |
| items_checked | INTEGER |  |
| reminders_created | INTEGER |  |
| error | TEXT | Nullable |

---

## 7. Core Flows

### Sign in
1. User clicks "Sign in with GitHub"
2. Redirected to GitHub OAuth authorization
3. Code exchanged for access token
4. GitHub user profile fetched
5. User record created or updated in D1
6. Encrypted session cookie set

### Create project
1. User enters project name and public GitHub repo URL
2. Repo URL parsed into owner/repo
3. GitHub API validates repo is accessible
4. Project inserted into `projects`
5. Default `reminder_configs` seeded for the project

### Configure reminders
1. User visits project settings
2. Toggles reminder types on/off
3. Sets threshold days
4. For "assigned not started", chooses how "started" is defined
5. Saves per-reminder-type form

### Periodic scan
1. Triggered manually via "Scan now" or by external cron calling `/api/scan`
2. For each enabled project:
   - Fetch open issues and PRs from GitHub
   - Fetch PR reviews
   - Evaluate each enabled reminder config against each item
   - If condition met and no duplicate reminder exists within the dedup window, insert reminder
3. Scan result logged to `scan_logs`

### View reminders
1. Dashboard shows projects with open reminder counts
2. Project page lists open reminders
3. PM can dismiss reminders

---

## 8. Pages / Routes

| Route | Purpose |
|---|---|
| `/` | Landing page with sign-in |
| `/auth/github` | Redirect to GitHub OAuth |
| `/auth/callback` | OAuth callback, creates session |
| `/auth/logout` | Clear session |
| `/dashboard` | List projects + open reminders preview |
| `/projects/new` | Create a new project |
| `/projects/:id` | Project settings + open reminders |
| `/api/scan` | Trigger scan (with optional cron secret) |

---

## 9. Configuration Rules

- Thresholds are configurable **per reminder type** and **per project**.
- "Started" definition is configurable **only for the assigned-not-started reminder**.
- Weekends and holidays are **not excluded**.
- Different thresholds for labels/priorities are **not implemented** yet.
- Draft PRs are **not ignored**.

---

## 10. Notifications

### Current (prototype)
- In-app dashboard notifications only
- Only the PM who created the project is notified

### Planned
- Google Chat space messages
- Weekly summary on a user-chosen day
- Real-time notifications via GitHub webhooks

---

## 11. Authentication & Security

### Current
- GitHub OAuth with `read:user` scope
- Public repo access does not require additional OAuth scopes
- Session cookie encrypted with AES-GCM using `SESSION_SECRET`
- `CRON_SECRET` protects the `/api/scan` endpoint from unauthorized calls

### Future
- Organization-specific authentication (details TBD)
- GitHub App for private repo support and finer-grained permissions
- RBAC for invited PMs

---

## 12. Deployment

- Built with `npm run build`
- Deployed to Cloudflare Workers with `npm run deploy`
- D1 migrations applied via `npm run db:migrate:prod`
- `wrangler.toml` configures the worker, D1 binding, and secrets

---

## 13. Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Project scaffold + SvelteKit + Tailwind + Cloudflare adapter | ✅ Done |
| 2 | GitHub OAuth sign-in + session | ✅ Done |
| 3 | D1 schema + migrations | ✅ Done |
| 4 | Create project from public repo | ✅ Done |
| 5 | Reminder configuration UI | ✅ Done |
| 6 | Scanner + reminder rules | ✅ Done |
| 7 | Dashboard + reminders list | ✅ Done |
| 8 | Google Chat integration | 🔄 Planned |
| 9 | Multi-PM invitations + org view | 🔄 Planned |
| 10 | Metrics dashboard | 🔄 Planned |
| 11 | GitHub Projects v2 column tracking | 🔄 Planned |

---

## 14. Known Limitations

- Only public repositories supported
- One project per user in the prototype
- "Moved to In Progress" is approximated using linked PR existence
- "Stuck in project column" is a placeholder
- Automated periodic scans require an external cron service in the prototype
- No email / chat notifications yet

---

## 15. Open Questions

1. What should the final product name be?
2. Should the app support private repositories in the first production version?
3. What is the organization-specific authentication method that will replace GitHub OAuth?
4. Which Google Chat spaces should receive notifications, and who configures them?
5. Should reminders support different thresholds by issue label or priority?
6. Should there be a Slack / Microsoft Teams integration alongside Google Chat?
7. What retention policy should apply to historical scan logs and reminders beyond 3 weeks?

---

## 16. Files Overview

```
github-pm-reminders/
├── src/
│   ├── app.html, app.css, app.d.ts     # App shell + types
│   ├── hooks.server.ts                  # Session handling
│   ├── lib/
│   │   ├── auth.ts                      # GitHub OAuth + encryption
│   │   ├── db.ts                        # D1 queries + helpers
│   │   ├── github.ts                    # GitHub REST API client
│   │   ├── reminders.ts                 # Reminder rule logic
│   │   └── scanner.ts                   # Scan orchestration
│   └── routes/                          # SvelteKit pages and API routes
├── migrations/001_initial.sql           # D1 schema
├── static/favicon.svg
├── wrangler.toml                        # Cloudflare config
├── package.json
├── svelte.config.js
├── tailwind.config.js
├── vite.config.ts
├── tsconfig.json
└── README.md
```
