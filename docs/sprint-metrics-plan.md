# Sprint metrics from GitHub Projects v2 iterations — iterative delivery plan

Status: draft, ready to start Iteration 0.

## 1. Decisions this plan is built on

1. **A sprint is an iteration field value on a GitHub Project v2 board.** The board is the
   source of truth for both the calendar (start date + duration, including breaks) and
   membership (which item belongs to which iteration).
2. **The site never defines its own sprint calendar.** Sprint rows are a cache keyed by
   `iterationId`; a sync refreshes them from the board. If GitHub changes an iteration, the
   site follows and flags the change.
3. **The site is the source of truth for history.** GitHub exposes no field-change history,
   and moving items between iterations overwrites the previous value. Anything a retro needs
   (committed set, scope added, carryover, burnup) must be snapshotted before rollover.
4. **Metrics are additive to Reminders.** The reminder scanner and lifecycle stay untouched;
   the board sync is a separate function on the same cron schedule, with its own logs.
5. **Read-only.** No mutations to GitHub in v1. No `project` (write) scope.
6. **Charts use LayerChart through shadcn-svelte's chart components.** No bespoke chart
   primitives; the series data they render is still produced by tested pure functions.

## 2. Non-goals

- Creating or editing iterations on GitHub.
- A second, manually maintained sprint definition in the site.
- Webhooks / true real-time (`projects_v2_item` can come in a later version).
- Private repositories and GitHub App auth.
- Per-person leaderboards.
- Story points, unless the board already has a number field; count items first.
- Milestone-based sprints as a parallel mode.

## 3. Dependency and risk register

| Risk                                                           | Impact                          | Mitigation                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OAuth app needs `read:project`; existing users must re-consent | Blocks the feature per user     | Optional "Connect board" re-auth, never a forced sign-in change; detect scope via `X-OAuth-Scopes` and the stored token scope |
| Org has OAuth app access restrictions                          | NIAEFEUP can block the token    | Spike with a real user token; add an actionable error path; document org approval                                             |
| No field history                                               | Planned/carryover unrecoverable | Baseline snapshot at sprint start; label late-connected sprints "approximate"                                                 |
| Items rolled over before first sync                            | Wrong committed set             | Lock baseline at first sync after `start_date`; show `baseline_approximate`                                                   |
| Archived items excluded by default                             | Completed count silently drops  | Query with `archivedStates: [ARCHIVED, NOT_ARCHIVED]`                                                                         |
| Workers subrequest / CPU limits                                | Sync times out                  | Separate invocation from reminder scan; GraphQL pages of 100; batch D1 writes                                                 |
| D1 bound-parameter limits                                      | Bulk inserts fail               | `db.batch()` with chunks of ≤ ~20 rows                                                                                        |
| Iteration renamed / deleted                                    | Keys break                      | Key on `iterationId`, never title; tolerate deleted iterations                                                                |
| Board hygiene (no iteration, no Status)                        | Metrics look wrong              | Data-quality banner with counts; never hide the gap                                                                           |
| Board spans several repos                                      | Scope confusion                 | Board scope wins; show repo breakdown, optional repo filter                                                                   |

## 4. Data model (migration `006_sprint_metrics.sql`)

```sql
ALTER TABLE users ADD COLUMN oauth_scopes TEXT; -- from the token exchange response

CREATE TABLE project_boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,        -- one board per project in v1
  owner_login TEXT NOT NULL,              -- NIAEFEUP
  owner_type TEXT NOT NULL,               -- 'organization' | 'user'
  project_number INTEGER NOT NULL,
  project_node_id TEXT NOT NULL,
  iteration_field_id TEXT NOT NULL,
  iteration_field_name TEXT NOT NULL,
  status_field_id TEXT,
  status_field_name TEXT,
  done_option_name TEXT,                  -- e.g. 'Done'
  last_synced_at DATETIME,
  last_sync_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE sprints (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  iteration_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,               -- YYYY-MM-DD
  duration_days INTEGER NOT NULL,
  end_date TEXT NOT NULL,                 -- start + duration, exclusive
  state TEXT NOT NULL,                    -- 'upcoming' | 'active' | 'completed'
  baseline_locked_at DATETIME,
  baseline_approximate INTEGER NOT NULL DEFAULT 0,
  closed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(board_id, iteration_id),
  FOREIGN KEY (board_id) REFERENCES project_boards(id)
);

CREATE TABLE sprint_items (
  id TEXT PRIMARY KEY,
  sprint_id TEXT NOT NULL,
  project_item_id TEXT NOT NULL,
  repo_full_name TEXT,                    -- null for draft issues
  item_type TEXT NOT NULL,                -- 'issue' | 'pr' | 'draft'
  number INTEGER,
  title TEXT NOT NULL,
  status TEXT,
  assignee TEXT,
  labels TEXT,                            -- JSON array
  content_state TEXT,                     -- OPEN | CLOSED | MERGED
  state_reason TEXT,                      -- COMPLETED | NOT_PLANNED | null
  is_archived INTEGER NOT NULL DEFAULT 0,
  iteration_assigned_at DATETIME,         -- from the iteration value's createdAt
  is_committed INTEGER NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  closed_at DATETIME,
  merged_at DATETIME,
  UNIQUE(sprint_id, project_item_id),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE TABLE sprint_snapshots (
  id TEXT PRIMARY KEY,
  sprint_id TEXT NOT NULL,
  project_item_id TEXT NOT NULL,
  snapshotted_on TEXT NOT NULL,           -- YYYY-MM-DD
  iteration_id TEXT,
  status TEXT,
  is_done INTEGER NOT NULL,
  UNIQUE(sprint_id, project_item_id, snapshotted_on),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE TABLE board_sync_logs (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  items_seen INTEGER NOT NULL DEFAULT 0,
  items_redacted INTEGER NOT NULL DEFAULT 0,
  sprints_synced INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (board_id) REFERENCES project_boards(id)
);

CREATE INDEX idx_sprints_board_window ON sprints(board_id, start_date);
CREATE INDEX idx_sprint_items_sprint ON sprint_items(sprint_id);
CREATE INDEX idx_sprint_items_status ON sprint_items(sprint_id, is_committed, status);
CREATE INDEX idx_sprint_snapshots_sprint_day ON sprint_snapshots(sprint_id, snapshotted_on);
```

`end_date` is stored, derived, and exclusive: a 14-day sprint starting on the 5th ends on
the 19th (`[5th 00:00, 19th 00:00)`).

## 5. GraphQL surface

One query per page of 100 items. Shapes needed:

- `organization(login:) { projectV2(number:) }` (or `user(login:)` for user boards)
- `fields`: `ProjectV2IterationField { id name configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } }`
  and `ProjectV2SingleSelectField { id name options { id name } }`
- `items(first: 100, after:, archivedStates: [ARCHIVED, NOT_ARCHIVED])`:
  - `id isArchived type`
  - `content`: `Issue { number title state stateReason createdAt closedAt repository { nameWithOwner } assignees labels }`,
    `PullRequest { number title state createdAt closedAt mergedAt repository { nameWithOwner } author assignees labels }`,
    `DraftIssue { title createdAt }`
  - `fieldValues(first: 50)`: iteration value (`iterationId title startDate duration createdAt field { id name }`),
    single-select value (`name optionId field { id name }`), number value (`number field { id name }`)
- Optional `rateLimit { limit cost remaining resetAt }` in every response, logged with the sync.

Notes:

- `content` can come back as `REDACTED` when the user cannot see the repository. Count it,
  never drop it silently.
- `fieldValues` is a nested connection; check its `pageInfo.hasNextPage`, not only the outer one.
- The iteration value's `createdAt` is the best available signal for "when did this enter the
  sprint" for the active sprint. It is not a history log and is overwritten on move.

## 6. Metric definitions

Use date-only windows in the project timezone (v1: UTC, stated in the UI).

| Metric              | Definition                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Committed           | `sprint_items.is_committed = 1` (set at baseline)                                                                                                                        |
| Done                | `status = done_option_name` OR (`issue` and `state = CLOSED` and `state_reason <> NOT_PLANNED`) OR (`pr` and `merged_at is not null`); precedence configurable per board |
| Completed in sprint | Done with a done timestamp inside the window (`closed_at` / `merged_at`)                                                                                                 |
| Added after start   | Items whose iteration value was assigned on/after `start_date` (active sprint), or not in baseline (historical, approximate)                                             |
| Scope change        | `added / committed`                                                                                                                                                      |
| Carryover           | Committed and not done at `end_date` (or at sync time for an active sprint)                                                                                              |
| WIP at end          | Items still in the iteration and not done                                                                                                                                |
| Throughput          | Issues closed + PRs merged with timestamp in the window (repo-level, independent of membership)                                                                          |
| Cycle time          | PR `createdAt` (v2: first commit) → `mergedAt`; median and p90                                                                                                           |
| Lead time           | Issue `createdAt` → `closed_at`; median and p90                                                                                                                          |
| Review latency      | v2: ready-for-review or first push → first non-author review                                                                                                             |
| Stuck work          | Reminders created/resolved in the window and their age at resolution                                                                                                     |

Every metric row carries its source (`membership`, `timestamp`, `reminder`) so the UI can say
"exact" vs "approximate" instead of pretending.

Two classes of metric age differently:

- **Timestamp metrics** (throughput, cycle time, lead time) derive from
  `createdAt` / `closedAt` / `mergedAt`, so they can be backfilled for
  `completedIterations`.
- **Membership metrics** (committed, added, carryover, predictability) have no GitHub
  history and only become real from the first baseline lock. Sprints before that show them
  as "not captured", never as zero.

### Chart stack

Charts render with [LayerChart](https://layerchart.com) via the shadcn-svelte `chart`
registry component (`npx shadcn-svelte@latest add chart`), which adds
`src/lib/components/ui/chart/`, `layerchart` and `d3-scale`. They inherit the `--chart-*`
tokens in `app.css`, so light/dark mode and the rest of the UI stay consistent.

Rules:

- Charts are presentation only. Series shape comes from pure functions in
  `src/lib/sprint-series.ts`, unit-tested; components never compute metrics.
- Charts read snapshots and rows, never `Date.now()` during render.
- Every chart has a table fallback for screen readers and respects
  `prefers-reduced-motion`.
- No canvas-only library: SVG keeps tooltips, keyboard focus and assistive tech working.

### Charts (v1)

| Chart                               | What it plots                                                         | Question it answers             | Backfillable         |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------- | -------------------- |
| Burnup (per sprint)                 | committed baseline, cumulative done, scope (committed + added) by day | Will we finish?                 | No — needs snapshots |
| Throughput trend (last 6–8 sprints) | merged PRs + closed issues per sprint                                 | Are we delivering more or less? | Yes                  |
| Commitment vs outcome (per sprint)  | done / carryover / added, stacked                                     | Do we finish what we commit?    | No                   |
| Cycle time trend                    | median and p90 PR created → merged, per sprint                        | Is flow getting faster?         | Yes                  |
| Cross-project sparkbars             | throughput per project on `/insights`                                 | Which project needs attention?  | Yes                  |

## 7. Iterations

Each iteration leaves the app deployable. Estimates assume one developer.

### Iteration 0 — Spike and de-risk (0.5 day, no app changes)

Goal: prove that the production auth path can read NIAEFEUP's board and that the data is
good enough.

- `scripts/spike-board.mjs`: takes `BOARD_URL` and `GITHUB_TOKEN`, prints board id, iteration
  field(s), `iterations` + `completedIterations`, item counts per iteration, archived counts,
  items with no iteration, items with no Status, repos represented, and REDACTED count.
- Run it once with a PAT (`read:project`) and once with a token minted by the real OAuth app
  after adding the scope, to confirm org policy.
- Record one page of real JSON as a fixture for later tests.

Acceptance: board number, field id/name, Status field id and `Done` option are known; the
quality counts are known; the OAuth scope path is confirmed or a blocker is identified.

### Iteration 1 — Scope, board connection, schema (2 days)

- `auth.ts`: `getGitHubOAuthUrl(clientId, redirectUri, state, scopes)`; sign-in keeps
  `read:user`; a new `/auth/github?board=1` flow requests `read:user read:project`.
- Store `tokens.scope` on the user (`oauth_scopes`), and update the token when an existing
  user re-authorizes instead of creating a duplicate.
- Migration `006` from section 4.
- Board connection: paste the board URL
  (`https://github.com/orgs/NIAEFEUP/projects/7` or `/users/<login>/projects/1`), resolve it
  with `projectV2(number:)`, list iteration fields and Status fields, save `project_boards`.
- UI: "Connect board" card on the project page and in settings; clear state for "needs
  project scope", "org has not approved the app", "no iteration field".
- Disconnect/reconnect path.

Acceptance: TTS board connects; `sprints` rows import with exact `start_date`/`end_date`;
sign-in for users who never connect a board is unchanged; a user without the scope sees a
single actionable CTA.

### Iteration 2 — Sync engine and snapshots (3 days)

- `src/lib/projects-graphql.ts`: typed query, pagination, error mapping, rate-limit logging.
- `src/lib/board-sync.ts`: `syncBoard(db, board)`:
  - refresh fields and iteration config; upsert `sprints` (keyed by `iteration_id`)
  - page items with archived states; upsert `sprint_items`
  - derive done state; write today's `sprint_snapshots` rows (idempotent per day)
  - lock the baseline on the first sync where `start_date <= today < end_date`; mark
    `baseline_approximate` if that happens after the sprint began
  - mark sprints completed when `end_date` passes; freeze nothing yet (Iteration 6)
  - write `board_sync_logs`
- Wire into `GET /api/scan` (same cron, after reminders) and a per-project "Sync board"
  action.
- Batch D1 writes; keep each sync under a few GraphQL subrequests.

Acceptance: two consecutive syncs produce identical row counts; archived items are present;
counts match the GitHub UI for one iteration; a sync of ~300 items finishes comfortably
inside Worker limits; reminder scanning is unaffected.

### Iteration 3 — Sprint summary, charts and first insights page (3 days)

- `src/lib/sprint-metrics.ts`: SQL-backed metrics from section 6; one function per view
  (`summary`, `trend`, `flow`, `dataQuality`).
- `src/lib/sprint-series.ts`: pure builders that turn rows and snapshots into chart series;
  unit-tested independently of Svelte.
- `/projects/[id]/insights` server load + page:
  - sprint selector (iteration id in the URL, mirroring the existing filter pattern)
  - summary cards: committed, done, added, carryover, merged PRs, median cycle time
  - burnup: committed line, done over time, added line
  - throughput trend and cycle time trend across recent sprints
  - data-quality banner: items with no iteration, no Status, REDACTED, approximate baseline
- Empty states for "board connected but nothing synced" and "no completed sprints yet".

Acceptance: numbers for TTS Backend Remake match a manual count; charts render with one
sprint and with several; the page renders with one sync and with zero syncs; the selected
sprint survives reload via the URL.

### Iteration 4 — Retro view and export (2 days)

- Retro sections on the insights page: what shipped, scope added with links, carryover with
  links, flow metrics, stuck work derived from `reminders` rows created/resolved in the
  window, optional per-assignee table (off by default).
- `GET /projects/[id]/insights/export?sprint=<iterationId>` returning Markdown, with the same
  ownership check as the page.
- Copy-to-clipboard and download.

Acceptance: the exported Markdown is pasteable into a retro doc; no data from another user's
project leaks; output is deterministic for a frozen sprint.

### Iteration 5 — Cross-project overview (1.5 days)

- `/insights`: every project with an active sprint, one row each: committed/done, scope
  change, carryover risk, last sync, data-quality warnings.
- Sidebar entry next to Inbox; no N+1 queries (one aggregate query).
- Empty and partial states.

Acceptance: with 3+ projects the page loads in one round trip and links into each sprint view.

### Iteration 6 — Lifecycle, hardening, docs (2 days)

- "Close sprint" action: freeze the final snapshot, set `closed_at`, keep the GitHub
  iteration untouched.
- Cadence health: "board has iterations through <date>", "iteration was renamed since last
  sync", "iteration deleted on GitHub".
- Optional backfill of `completedIterations`: completions only; membership marked
  approximate and hidden unless the user asks.
- Failure handling: missing scope, revoked token, board deleted, field deleted, org
  restriction, rate limit, timeout; each with a specific UI message.
- `npm test` with vitest: window math (duration, end exclusive, breaks), baseline logic,
  done precedence, metric formulas; GraphQL fixtures from Iteration 0.
- README section and `docs/` update; run `npm run check` and migrations before deploy.

Acceptance: a sprint can be closed and its retro exported after rollover; every known failure
has a message; unit tests cover the date and membership edge cases.

## 8. Sequence and effort

| Iteration | Outcome                           | Estimate  |
| --------- | --------------------------------- | --------- |
| 0         | Data and auth proven              | 0.5 d     |
| 1         | Board connected, sprints imported | 2 d       |
| 2         | History captured                  | 3 d       |
| 3         | Summary and charts                | 3 d       |
| 4         | Retro artifact                    | 2 d       |
| 5         | Multi-project view                | 1.5 d     |
| 6         | Safe to operate                   | 2 d       |
| **Total** |                                   | **~14 d** |

Iterations are the internal work breakdown; they do not each ship. Iterations 0–5 are the
MVP and land as PR 1–4; Iteration 6 lands as PR 5. Mapping: 0–1 → PR 1–2, 2 → PR 3,
3–5 → PR 4, 6 → PR 5.

## 9. Open decisions

Settle 1–5 before Iteration 2, 6–7 before PR 4.

1. **Done definition**: Status = Done (recommended, matches the board) with closed/merged as
   fallback, or the reverse.
2. **Timezone**: UTC for v1, or a per-board timezone.
3. **Board scope vs repo scope**: include every repo on the board (recommended) or filter to
   the Reminders project's repo.
4. **Not planned closures**: exclude from throughput (recommended) or show separately.
5. **Points**: count items until a number field is confirmed on the board.
6. **Throughput window**: sprint window only, or include the break between iterations?
   Recommended: sprint window, with gap days shown as a footnote.
7. **Chart set**: the four main v1 charts in section 6 (burnup, throughput trend,
   commitment vs outcome, cycle time trend), plus cross-project sparkbars. Cumulative flow
   is deferred.

## 10. PR breakdown

Five PRs, one per delivery phase. The commit list inside each PR is the review script.

Rules for every PR:

- **One PR per phase**, not one per layer. Do not split a phase into infrastructure and UI
  PRs unless review genuinely stalls.
- Tests land with the logic they test, not in a later PR.
- `npm run check` and `npm test` (once PR 1 lands) must pass.
- New behaviour stays behind `BOARD_METRICS=1` until PR 4.
- UI PRs include a screenshot and a keyboard/a11y note.
- Charts use the shadcn-svelte `chart` components; no bespoke chart primitives.
- Deploy notes say whether a migration, env var or re-auth is required.
- Title in conventional-commit form, e.g. `feat(board): ...`, `chore(test): ...`.
- Size guard: aim for ≤1,200 changed lines excluding fixtures. PR 4 is the deliberate
  exception; split any PR only along its commit boundaries, and only if review stalls.

### PR 1 — `chore(foundation): probe the board, add tests and sprint schema`

Covers Iteration 0 and the schema half of Iteration 1. Depends on: nothing. Inert.

Commits:

1. `chore(spike)`: `scripts/spike-board.mjs` takes `BOARD_URL` + `GITHUB_TOKEN`, pages
   items with `archivedStates`, prints iteration/Status/hygiene counts, writes a redacted
   fixture. No production code.
2. `chore(test)`: `vitest.config.ts`, `npm test`, CI step, and `src/lib/sprint-window.ts`
   (`sprintWindow`, `isActive`, `isDone`, `doneAt`, `toDateOnly`) with tests for
   end-date-exclusive, month boundaries, non-contiguous windows and done precedence.
3. `feat(db)`: `migrations/006_sprint_metrics.sql` as section 4, plus `stats_json` on
   `board_sync_logs`; row types and accessors in `db.ts` (`getBoardByProject`,
   `upsertSprint`, `upsertSprintItems`, `recordSnapshot`, `getSprintMetricsRows`).

Review focus: the fixture has no tokens, emails or private data; date math is correct; the
migration is additive and its indexes match PR 4's queries.

Deploy: run `db:migrate:prod` before deploying. No behaviour changes.

Size: ~750 lines + fixture.

### PR 2 — `feat(board): connect a GitHub project board`

Covers the rest of Iteration 1. Depends on PR 1.

Commits:

1. `feat(auth)`: `getGitHubOAuthUrl(clientId, redirectUri, state, scopes)`; sign-in keeps
   `read:user`; `/auth/github?for=board` requests `read:user read:project`; callback stores
   `tokens.scope` in `users.oauth_scopes`, updates the existing token instead of creating a
   duplicate, and keeps the session; `hasProjectScope` + `MissingScopeError`.
2. `feat(board)`: `board-connect.ts` with `parseBoardUrl` for orgs and users, `resolveBoard`
   GraphQL for `projectV2` + fields, and tests for URL variants and zero/one/multiple
   iteration fields.
3. `feat(board)`: `connectBoard` / `disconnectBoard` server actions with the existing
   ownership checks, plus the settings card and its "needs project scope", "org has not
   approved the app" and "no iteration field" states.

Review focus: no forced re-consent for normal sign-in, no duplicate users, existing sessions
survive, a user cannot connect a board to someone else's project, and the resolver performs
no DB writes.

Deploy: users connecting a board re-auth for `read:project`. The card stays behind
`BOARD_METRICS=1`.

Size: ~570 lines.

### PR 3 — `feat(board): sync sprints, items and daily snapshots`

Covers Iteration 2. Depends on PR 2. The riskiest PR: it starts history.

Commits:

1. `feat(board)`: `projects-graphql.ts` — typed query, pagination, error mapping and
   rate-limit logging.
2. `feat(board)`: `board-sync.ts` sprints slice — refresh fields and iteration config,
   upsert `sprints` from `iterations` + `completedIterations` by `iteration_id`, derive
   dates and state, write `board_sync_logs`, "Sync now" action.
3. `feat(board)`: items slice — paginate with archived states, map issues/PRs/drafts,
   iteration and Status values, labels, assignees and timestamps; done precedence; count
   REDACTED; keep moved items in their old sprint via `last_seen_at`.
4. `feat(board)`: baseline lock on the first sync of an active sprint, `baseline_approximate`
   when late, daily idempotent snapshots, rollover to completed, and wiring into
   `GET /api/scan` after reminder scanning.

Review focus: pagination terminates (including nested `fieldValues.pageInfo`), archived
items are included, moved items never disappear, `end_date` is exclusive, "committed" is
frozen exactly once, the sync fits the Worker subrequest/CPU budget, and reminder scanning is
unaffected.

Deploy: run the first sync before the next sprint boundary; that sync starts history.

Size: ~750 lines.

### PR 4 — `feat(insights): add sprint metrics, charts and retro export`

Covers Iterations 3–5. Depends on PR 3. Largest PR; review it by commit, not as one diff.

Commits:

1. `feat(metrics)`: `sprint-metrics.ts` with `getSprintSummary`, `getSprintTrend`,
   `getFlowMetrics`, `getDataQuality`, each returning values plus a source label; seeded
   tests for committed/done/added/carryover, WIP, median/p90, NOT_PLANNED exclusion and
   approximate baselines.
2. `feat(insights)`: `/projects/[id]/insights` load + page with ownership checks,
   `?sprint=<iterationId>` URL state, sprint selector, summary cards, and the empty states
   for no board / not synced / no iterations.
3. `feat(insights)`: `npx shadcn-svelte@latest add chart`, `sprint-series.ts` + tests for
   gaps, single-day sprints, zero-done sprints and non-contiguous windows; burnup,
   throughput, commitment-vs-outcome and cycle-time charts with table fallbacks; the
   data-quality banner.
4. `feat(retro)`: scope-added, carryover and stuck-work lists with GitHub links;
   `buildSprintMarkdown` + `GET /projects/[id]/insights/export` with the same ownership
   check; copy and download controls.
5. `feat(insights)`: `/insights` cross-project overview with throughput sparkbars from the
   same series builders, one aggregate query, and the sidebar entry.

Review focus: formulas match section 6; no chart computes a metric; every number links to
its item; the export cannot leak another project; `/insights` stays at one query; Markdown
output is deterministic for a closed sprint.

Deploy: set `BOARD_METRICS=1` after this PR; this is the first user-visible phase.

Size: ~1,700 lines.

### PR 5 — `feat(board): close sprints, surface failures and document`

Covers Iteration 6. Depends on PR 4.

Commits:

1. `feat(retro)`: "Close sprint" writes the final snapshot, sets `closed_at`, and is
   idempotent; confirmation dialog explains that numbers become final and GitHub rollover no
   longer changes them.
2. `feat(board)`: cadence health (iterations planned through a date, renamed/deleted
   iterations, missing field) and failure states (missing/revoked scope, org restriction,
   deleted board, rate limit, timeout, partial sync), each with a message and retry path;
   store and show the last error.
3. `docs`: README section, `plan.md` milestone 10/11 status, screenshot in
   `docs/screenshots/`.

Review focus: closing twice is safe; every known failure maps to a human action; a stale
sync is visible; docs match the real scope and history limits.

Size: ~600 lines.

## 11. Sequence

```text
PR 1 ─ PR 2 ─ PR 3 ─ PR 4 ─ PR 5
```

- Strictly sequential. Each PR leaves the app deployable.
- PR 1–3 are plumbing behind `BOARD_METRICS=1`; PR 2's connection card is the only visible
  surface.
- PR 3 is the riskiest: it starts history and calls GraphQL on a schedule.
- PR 4 turns the feature on and is the first PR a PM can actually use.
- PR 5 makes it safe to operate after the first real sprint.

**Minimum shippable product:** PR 1–4. **Safe to operate:** PR 5.

## 12. PR description skeleton

```md
## What

One paragraph.

## Why

Link the plan section or issue.

## How to review

Where to start, what is intentionally out of scope.

## Test plan

- [ ] npm run check
- [ ] npm test
- [ ] manual: ...

## Deploy notes

- [ ] migration 006
- [ ] re-auth for read:project
- [ ] none
```

## 13. Review safeguards

- Migrations are additive and reviewed as their own commit; a behaviour commit never
  changes an existing column.
- Every new route calls the same ownership helper; no route trusts `params.id`.
- Tokens, scopes and GraphQL errors are never logged with secrets.
- GraphQL queries are reviewed against section 5; a missing `archivedStates` or
  `fieldValues.pageInfo` is a correctness bug, not a style nit.
- Date logic is only allowed in `sprint-window.ts`; no ad-hoc `new Date()` comparisons in
  components or queries.
