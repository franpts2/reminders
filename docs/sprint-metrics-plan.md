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

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OAuth app needs `read:project`; existing users must re-consent | Blocks the feature per user | Optional "Connect board" re-auth, never a forced sign-in change; detect scope via `X-OAuth-Scopes` and the stored token scope |
| Org has OAuth app access restrictions | NIAEFEUP can block the token | Spike with a real user token; add an actionable error path; document org approval |
| No field history | Planned/carryover unrecoverable | Baseline snapshot at sprint start; label late-connected sprints "approximate" |
| Items rolled over before first sync | Wrong committed set | Lock baseline at first sync after `start_date`; show `baseline_approximate` |
| Archived items excluded by default | Completed count silently drops | Query with `archivedStates: [ARCHIVED, NOT_ARCHIVED]` |
| Workers subrequest / CPU limits | Sync times out | Separate invocation from reminder scan; GraphQL pages of 100; batch D1 writes |
| D1 bound-parameter limits | Bulk inserts fail | `db.batch()` with chunks of ≤ ~20 rows |
| Iteration renamed / deleted | Keys break | Key on `iterationId`, never title; tolerate deleted iterations |
| Board hygiene (no iteration, no Status) | Metrics look wrong | Data-quality banner with counts; never hide the gap |
| Board spans several repos | Scope confusion | Board scope wins; show repo breakdown, optional repo filter |

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

| Metric | Definition |
| --- | --- |
| Committed | `sprint_items.is_committed = 1` (set at baseline) |
| Done | `status = done_option_name` OR (`issue` and `state = CLOSED` and `state_reason <> NOT_PLANNED`) OR (`pr` and `merged_at is not null`); precedence configurable per board |
| Completed in sprint | Done with a done timestamp inside the window (`closed_at` / `merged_at`) |
| Added after start | Items whose iteration value was assigned on/after `start_date` (active sprint), or not in baseline (historical, approximate) |
| Scope change | `added / committed` |
| Carryover | Committed and not done at `end_date` (or at sync time for an active sprint) |
| WIP at end | Items still in the iteration and not done |
| Throughput | Issues closed + PRs merged with timestamp in the window (repo-level, independent of membership) |
| Cycle time | PR `createdAt` (v2: first commit) → `mergedAt`; median and p90 |
| Lead time | Issue `createdAt` → `closed_at`; median and p90 |
| Review latency | v2: ready-for-review or first push → first non-author review |
| Stuck work | Reminders created/resolved in the window and their age at resolution |

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

| Chart | What it plots | Question it answers | Backfillable |
| --- | --- | --- | --- |
| Burnup (per sprint) | committed baseline, cumulative done, scope (committed + added) by day | Will we finish? | No — needs snapshots |
| Throughput trend (last 6–8 sprints) | merged PRs + closed issues per sprint | Are we delivering more or less? | Yes |
| Commitment vs outcome (per sprint) | done / carryover / added, stacked | Do we finish what we commit? | No |
| Cycle time trend | median and p90 PR created → merged, per sprint | Is flow getting faster? | Yes |
| Cross-project sparkbars | throughput per project on `/insights` | Which project needs attention? | Yes |

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

| Iteration | Outcome | Estimate |
| --- | --- | --- |
| 0 | Data and auth proven | 0.5 d |
| 1 | Board connected, sprints imported | 2 d |
| 2 | History captured | 3 d |
| 3 | Summary and charts | 3 d |
| 4 | Retro artifact | 2 d |
| 5 | Multi-project view | 1.5 d |
| 6 | Safe to operate | 2 d |
| **Total** | | **~14 d** |

Iterations 0–4 make a retro worth opening; 0–3 is a working summary. 5–6 can ship
independently.

## 9. Open decisions

Settle 1–5 before Iteration 2, 6–7 before PR 12.

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

Rules for every PR:

- One reason to exist. No PR mixes a migration, behaviour and a new screen.
- New behaviour stays inert until it is wired, or behind `BOARD_METRICS=1` until PR 11.
- Tests land with the logic they test, not in a later PR.
- Target under ~400 changed lines excluding fixtures and generated files.
- `npm run check` must pass; once PR 2 lands, `npm test` must pass too.
- UI PRs include a screenshot and a keyboard/a11y note.
- Charts use the shadcn-svelte `chart` components; no bespoke chart primitives.
- Deploy notes say whether a migration, env var or re-auth is required.
- Title in conventional-commit form, e.g. `feat(board): ...`, `chore(test): ...`.

### PR 1 — `chore(spike): add board probe script and fixtures`

Depends on: nothing. Inert.

- `scripts/spike-board.mjs`: takes `BOARD_URL` + `GITHUB_TOKEN`, pages items with
  `archivedStates`, prints iteration/Status/hygiene counts, and writes a redacted fixture.
- `test/fixtures/board-page.json` (or `docs/fixtures/`) captured from TTS.

Review focus: the script only reads and prints; no production code. Confirm the fixture
contains no tokens, emails or private data.
Size: ~200 lines + fixture.

### PR 2 — `chore(test): add vitest and sprint window utilities`

Depends on: nothing. Inert.

- `vitest.config.ts`, `npm test` script, CI step.
- `src/lib/sprint-window.ts`: `sprintWindow(startDate, durationDays)`, `isActive`,
  `isDone`, `doneAt`, `toDateOnly`. Pure functions only.
- `src/lib/sprint-window.test.ts`: end date exclusive, month boundaries, iteration breaks
  (windows may be non-contiguous), done precedence.

Review focus: date math. This is the cheapest place to prevent an off-by-one that would
poison every later metric.
Size: ~150 lines.

### PR 3 — `feat(db): add sprint metrics schema and accessors`

Depends on: nothing. Inert.

- `migrations/006_sprint_metrics.sql` exactly as section 4, plus a `stats_json` column on
  `board_sync_logs` for hygiene counters. Additive only.
- `src/lib/db.ts`: row types and accessors for `project_boards`, `sprints`, `sprint_items`,
  `sprint_snapshots`, `board_sync_logs`; `getBoardByProject`, `upsertSprint`,
  `upsertSprintItems`, `recordSnapshot`, `getSprintMetricsRows`.
- Accessor tests against an in-memory SQLite if the harness supports it; otherwise pure
  mapper tests.

Review focus: additive migration, no changes to existing tables besides `users.oauth_scopes`,
indexes match the queries in PR 10. Deploy note: run `db:migrate:prod` before deploying.
Size: ~300 lines.

### PR 4 — `feat(auth): request project scope on demand`

Depends on: PR 3. Inert (no UI yet).

- `getGitHubOAuthUrl(clientId, redirectUri, state, scopes)`; sign-in keeps `read:user`.
- `/auth/github?for=board` requests `read:user read:project`.
- Callback: store `tokens.scope` in `users.oauth_scopes`; update the existing user's token
  instead of creating a duplicate; keep the session.
- `hasProjectScope(user)` helper and a typed `MissingScopeError`.

Review focus: no forced re-consent for normal sign-in; no duplicate users; existing sessions
survive. Manual test: sign in normally, then re-auth for board, then sign out and back in.
Size: ~120 lines.

### PR 5 — `feat(board): resolve a project URL to fields`

Depends on: PR 3, PR 4. Inert.

- `src/lib/board-connect.ts`: `parseBoardUrl` for
  `/orgs/<org>/projects/<n>` and `/users/<login>/projects/<n>`; `resolveBoard` GraphQL query
  for `projectV2` + fields.
- Return: node id, title, iteration fields, Status field + options, done option detection.
- Tests: URL variants (trailing slash, query string, wrong host, repo URL rejected), field
  selection when there are zero/one/multiple iteration fields.

Review focus: pure resolution, no DB writes. Confirm the GraphQL selection matches section 5.
Size: ~200 lines.

### PR 6 — `feat(board): connect and disconnect a board`

Depends on: PR 5.

- Server actions `connectBoard` and `disconnectBoard` in the project settings route; ownership
  checks mirror the existing reminder actions.
- UI card: paste URL, pick iteration field and Status field, show "needs project scope" CTA,
  "org has not approved the app", and "no iteration field" states.
- Writes `project_boards` only. No sync.

Review focus: authorization (a user cannot connect a board to someone else's project), error
copy, and that the card is hidden/disabled when the feature flag is off.
Size: ~250 lines.

### PR 7 — `feat(board): sync iterations into cached sprints`

Depends on: PR 6.

- `src/lib/board-sync.ts` first slice: refresh fields and iteration config; upsert `sprints`
  from `iterations` + `completedIterations`; derive `start_date`, `end_date`, `state`;
  create/finish `board_sync_logs`; store hygiene `stats_json`.
- "Sync now" action on the project page, sprints only.
- Fixture-based mapper tests; idempotency test (sync twice, same row count).

Review focus: `iterationId` is the key, titles are display-only; `end_date` exclusive;
completed iterations are imported even if the board has moved on.
Size: ~200 lines.

### PR 8 — `feat(board): sync items with archived states and done mapping`

Depends on: PR 7.

- Paginate `items(first: 100)` with `archivedStates: [ARCHIVED, NOT_ARCHIVED]`; map
  `content` (issue/PR/draft), iteration value, Status value, labels, assignees, timestamps.
- Count `REDACTED` items; never drop silently.
- `isDone` mapping using the decided precedence; rows for an item are kept per sprint and
  never deleted; `last_seen_at` distinguishes current membership from history.
- Tests: archived item included, moved item produces a new sprint row and leaves the old one,
  REDACTED counted.

Review focus: pagination termination, nested `fieldValues.pageInfo`, and the movement rule
above. This is the most subtle PR; read it with the fixture open.
Size: ~300 lines.

### PR 9 — `feat(board): lock baselines and snapshot daily`

Depends on: PR 8.

- Baseline: on the first sync where a sprint is active, set `is_committed = 1` for its items
  and `baseline_locked_at`; set `baseline_approximate` when the sync happens after the start
  date.
- Daily `sprint_snapshots` upsert, idempotent per `(sprint, item, day)`.
- Mark sprints completed when `end_date` passes.
- Wire `syncBoard` into `GET /api/scan` after reminder scanning; keep the manual action.
- Tests: baseline approximate flag, repeated snapshot same day, sprint rollover.

Review focus: what "committed" means and exactly when it is frozen. Deploy note: the first
sync after deploy starts history — run it before the next sprint boundary.
Size: ~250 lines.

### PR 10 — `feat(metrics): add sprint metrics query layer`

Depends on: PR 9. No UI.

- `src/lib/sprint-metrics.ts`: `getSprintSummary`, `getSprintTrend`, `getFlowMetrics`,
  `getDataQuality` from section 6, each returning values plus `source` (`exact` /
  `approximate` / `timestamp`).
- SQL in `db.ts` or the module; one query per view, no N+1.
- Tests with seeded rows: committed/done/added/carryover, WIP, median/p90 helpers, NOT_PLANNED
  excluded, approximate baseline labelled.

Review focus: formulas against section 6, and that empty sprints return zeros rather than
nulls/errors.
Size: ~350 lines.

### PR 11 — `feat(insights): add sprint page with summary cards`

Depends on: PR 10.

- `/projects/[id]/insights` load + page; auth and ownership checks; `?sprint=<iterationId>`
  in the URL; sprint selector.
- Summary cards: committed, done, added, carryover, merged PRs, median cycle time.
- Empty states: no board, not synced, no iterations.
- Link from the project page; no sidebar entry yet.

Review focus: URL state survives reload and sharing; zero-sync state; ownership check.
Size: ~250 lines.

### PR 12 — `feat(insights): add charts and data-quality banner`

Depends on: PR 11.

- `npx shadcn-svelte@latest add chart` (LayerChart) and `src/lib/components/charts/`:
  `burnup-chart.svelte`, `throughput-chart.svelte`, `commitment-chart.svelte`,
  `cycle-time-chart.svelte`.
- `src/lib/sprint-series.ts`: pure series builders for each chart, with tests for gaps,
  single-day sprints, zero-done sprints and non-contiguous iteration windows.
- Charts share `Chart.Container` and the `--chart-*` tokens, read from snapshots (not
  `Date.now()`), and each has a table fallback and `prefers-reduced-motion` handling.
- Data-quality banner: items without iteration, without Status, REDACTED, approximate
  baseline, with links to the board.

Review focus: no chart computes a metric inside the component; every chart has a table
fallback; the banner never hides a gap.
Size: ~350 lines.

### PR 13 — `feat(retro): add scope, carryover and stuck work`

Depends on: PR 11.

- Added-after-start and carryover lists with GitHub links and assignees.
- Stuck work panel from `reminders` rows created/resolved in the window, with age at
  resolution; labelled as reminder-derived.
- No per-person table yet.

Review focus: every number links to the item; no reminder row is attributed to the wrong
project; window boundaries match PR 2.
Size: ~200 lines.

### PR 14 — `feat(retro): export the sprint as Markdown`

Depends on: PR 13.

- `GET /projects/[id]/insights/export?sprint=<iterationId>` with the same ownership check;
  `text/markdown` + `Content-Disposition`.
- `buildSprintMarkdown` pure function + snapshot test; deterministic for a closed sprint.
- Copy and download controls on the page.

Review focus: authorization on the endpoint, no cross-project leakage, stable output.
Size: ~200 lines.

### PR 15 — `feat(insights): add cross-project overview`

Depends on: PR 11.

- `/insights` page: one row per project with an active sprint (committed/done, scope change,
  carryover risk, last sync, warnings); a throughput sparkbar per row from completed sprints,
  fed by the same series builders as PR 12.
- Sidebar entry next to Inbox.

Review focus: query count (the sparkbar data comes from the same aggregate query), partial
states (some projects without boards), and mobile layout.
Size: ~200 lines.

### PR 16 — `feat(retro): close and freeze a sprint`

Depends on: PR 9, PR 13.

- "Close sprint" action: write the final snapshot for the day, set `closed_at`, state
  `completed`; the GitHub iteration is untouched.
- Confirmation dialog explaining that numbers become final and GitHub rollover no longer
  changes them.
- Tests: closing twice is idempotent; export after rollover still matches the frozen numbers.

Review focus: the freeze happens before any GitHub mutation (there are none), and the action
cannot run on another user's project.
Size: ~200 lines.

### PR 17 — `feat(board): surface cadence and failure states`

Depends on: PR 16.

- Cadence health: iterations planned through `<date>`, iteration renamed/deleted since last
  sync, field missing.
- Failure states: missing/revoked scope, org restriction, board deleted, rate limit, timeout,
  partial sync; each with a specific message and a retry path.
- Store and display the last error; no silent failures.

Review focus: every failure maps to a human action, and a stale sync is visible on the page.
Size: ~250 lines.

### PR 18 — `docs: document sprint metrics and update the README`

Depends on: PR 17.

- README: feature, scopes, "Connect board" walkthrough, done definition, approximate
  baselines, cron note, limitations.
- Update `plan.md` milestone 10/11 status; screenshot in `docs/screenshots/`.

Review focus: docs match the shipped behaviour, especially the scope and history limits.
Size: ~150 lines.

## 11. Merge order and parallel tracks

```text
PR 1 ─┐
PR 2 ─┼─ PR 3 ─┬─ PR 4 ─ PR 5 ─ PR 6 ─ PR 7 ─ PR 8 ─ PR 9 ─ PR 10 ─ PR 11 ─┬─ PR 12
      │        │                                                        ├─ PR 13 ─ PR 14
      │        │                                                        ├─ PR 15
      │        │                                                        └─ PR 16 ─ PR 17 ─ PR 18
```

- PR 1 and PR 2 can land immediately, in either order.
- After PR 3, PR 4/5 (auth and resolver) can be reviewed in parallel; PR 6 needs both.
- PR 7–9 are a chain; do not parallelise them.
- After PR 10, PR 11 is the gate. PR 12, 13 and 15 can then go in parallel.
- PR 14 needs PR 13; PR 16 needs PR 9 and 13; PR 17 needs PR 16; PR 18 last.

**Minimum shippable product:** through PR 11 (a sprint summary). PR 12–14 are what make it
worth opening before a retro; PR 12 is the chart PR.

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

- Migration PRs are additive and reviewed separately from behaviour.
- Every new route calls the same ownership helper; no route trusts `params.id`.
- Tokens, scopes and GraphQL errors are never logged with secrets.
- GraphQL queries are reviewed against section 5; a missing `archivedStates` or
  `fieldValues.pageInfo` is a correctness bug, not a style nit.
- Date logic is only allowed in `sprint-window.ts`; no ad-hoc `new Date()` comparisons in
  components or queries.
