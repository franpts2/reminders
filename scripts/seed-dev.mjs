#!/usr/bin/env node
/**
 * Seeds the local D1 database with fictional, screenshot-friendly data.
 *
 * Every project id is prefixed with `seed-`, so re-running replaces only this
 * data and leaves real projects alone. It refuses to run unless APP_URL points
 * at localhost, so it cannot touch production.
 *
 * Usage:
 *   npm run db:seed:local               # seed (requires one sign-in first)
 *   npm run db:seed:local -- --reset    # remove only the seeded data
 *   npm run db:seed:local -- --login=franpts2
 *
 * The data belongs to an existing user row. Sign in with GitHub once at
 * APP_URL before the first seed.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_PREFIX = 'seed-';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.now();
const isoAgo = (ms) => new Date(NOW - ms).toISOString();
const isoIn = (ms) => new Date(NOW + ms).toISOString();

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const hit = args.find((arg) => arg.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : undefined;
};

if (hasFlag('help')) {
	console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
	process.exit(0);
}

// --- environment ----------------------------------------------------------

function loadDevVars() {
	/** @type {Record<string, string>} */
	const values = {};
	let raw;
	try {
		raw = readFileSync(new URL('.dev.vars', `file://${process.cwd()}/`), 'utf8');
	} catch {
		fail('Missing .dev.vars. Copy .dev.vars.example and fill it in first.');
	}
	for (const line of raw.split(/\r?\n/)) {
		if (/^\s*#/.test(line)) continue;
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
	}
	return values;
}

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

const vars = loadDevVars();
const appUrl = vars.APP_URL ?? '';
let host;
try {
	host = new URL(appUrl).hostname;
} catch {
	fail(`APP_URL in .dev.vars is not a URL: ${appUrl || '(empty)'}`);
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
	fail(
		`APP_URL is ${appUrl}. This script only seeds the local database, so it needs a localhost APP_URL.`
	);
}

const wranglerToml = readFileSync('wrangler.toml', 'utf8');
const databaseName =
	/database_name\s*=\s*"([^"]+)"/.exec(wranglerToml)?.[1] ?? 'github-pm-reminders-db';

// --- wrangler plumbing ----------------------------------------------------

const localBinary = join(
	process.cwd(),
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
);
const useLocal = existsSync(localBinary);
const command = useLocal ? localBinary : 'npx';
const commandPrefix = useLocal ? [] : ['--no-install', 'wrangler'];

function runWrangler(d1Args) {
	const result = spawnSync(command, [...commandPrefix, 'd1', 'execute', databaseName, '--local', ...d1Args], {
		cwd: process.cwd(),
		encoding: 'utf8'
	});

	if (result.status !== 0) {
		fail(`wrangler failed:\n${(result.stderr || result.stdout || '').trim()}`);
	}

	return result.stdout;
}

function query(sql) {
	const stdout = runWrangler(['--json', '--command', sql]);
	const start = stdout.indexOf('[');
	const payload = JSON.parse(start === -1 ? '[]' : stdout.slice(start));
	return payload[0]?.results ?? [];
}

function execute(sql) {
	const dir = mkdtempSync(join(tmpdir(), 'reminders-seed-'));
	const file = join(dir, 'seed.sql');
	writeFileSync(file, sql);
	runWrangler([`--file=${file}`]);
}

const sql = (value) =>
	value === null || value === undefined
		? 'NULL'
		: typeof value === 'number'
			? String(value)
			: `'${String(value).replaceAll("'", "''")}'`;

// --- target user ----------------------------------------------------------

let userId = option('user-id');
let userLogin = option('login');

if (!hasFlag('reset') && !userId) {
	const users = query(
		'SELECT id, github_login FROM users ORDER BY created_at DESC, rowid DESC'
	);

	if (users.length === 0) {
		fail(
			`No user in the local database yet. Start \`npm run dev\`, sign in at ${appUrl}, then run this again.`
		);
	}

	const match = userLogin
		? users.find((user) => user.github_login.toLowerCase() === userLogin.toLowerCase())
		: users[0];

	if (!match) {
		fail(
			`No local user named ${userLogin}. Known users: ${users.map((user) => user.github_login).join(', ')}`
		);
	}

	userId = match.id;
	userLogin = match.github_login;

	if (users.length > 1 && !option('login')) {
		console.log(
			`· ${users.length} local users found; seeding for the newest, @${userLogin}. Pass --login=<name> to choose.`
		);
	}
}

// --- seeded content -------------------------------------------------------

/** Remove only rows whose project id starts with the seed prefix. */
function resetSql() {
	return [
		`DELETE FROM reminders WHERE project_id LIKE '${PROJECT_PREFIX}%';`,
		`DELETE FROM reminder_conditions WHERE project_id LIKE '${PROJECT_PREFIX}%';`,
		`DELETE FROM reminder_configs WHERE project_id LIKE '${PROJECT_PREFIX}%';`,
		`DELETE FROM scan_logs WHERE project_id LIKE '${PROJECT_PREFIX}%';`,
		`DELETE FROM projects WHERE id LIKE '${PROJECT_PREFIX}%';`
	].join('\n');
}

const RULES = [
	{ type: 'assigned_not_started', threshold: 3, started: 'both' },
	{ type: 'pr_open_too_long', threshold: 5, started: null },
	{ type: 'pr_no_review', threshold: 2, started: null },
	{ type: 'pr_changes_requested', threshold: 3, started: null },
	{ type: 'pr_approved_not_merged', threshold: 2, started: null },
	{ type: 'pr_conflicts', threshold: 2, started: null },
	{ type: 'stuck_in_column', threshold: 14, started: null },
	{ type: 'no_activity', threshold: 7, started: null }
];

const PROJECTS = [
	{
		slug: 'storefront',
		name: 'Storefront',
		owner: 'acme',
		repo: 'storefront',
		checked: 142,
		created: [4, 3, 2]
	},
	{
		slug: 'mobile',
		name: 'Mobile app',
		owner: 'acme',
		repo: 'mobile',
		checked: 96,
		created: [3, 2, 2]
	},
	{
		slug: 'design-system',
		name: 'Design system',
		owner: 'northwind',
		repo: 'design-system',
		checked: 61,
		created: [2, 1, 1]
	},
	{
		slug: 'platform',
		name: 'Platform',
		owner: 'northwind',
		repo: 'platform',
		checked: 87,
		created: [3, 2, 1]
	}
];

/**
 * One row per open reminder. `days` is how long the underlying condition has
 * been true; it drives both the age column and the message. `reviewer` is only
 * used by the changes-requested rule.
 */
const REMINDERS = [
	// Storefront
	{ project: 'storefront', type: 'pr_open_too_long', number: 399, kind: 'pr', title: 'Move cart storage off localStorage', assignee: 'ren', days: 28, seen: true },
	{ project: 'storefront', type: 'assigned_not_started', number: 391, kind: 'issue', title: 'Add rate limiting to promo-code endpoint', assignee: 'tobi', days: 21 },
	{ project: 'storefront', type: 'pr_no_review', number: 412, kind: 'pr', title: 'Add saved-cards checkout flow', assignee: 'jules', days: 16 },
	{ project: 'storefront', type: 'no_activity', number: 377, kind: 'issue', title: 'Investigate slow first paint on PDP', assignee: 'mara', days: 12, seen: true },
	{ project: 'storefront', type: 'pr_changes_requested', number: 408, kind: 'pr', title: 'Split order summary into server components', assignee: 'mara', reviewer: 'jules', days: 9 },
	{ project: 'storefront', type: 'pr_approved_not_merged', number: 405, kind: 'pr', title: 'Fix tax rounding on multi-item carts', assignee: 'jules', days: 6, seen: true },
	{ project: 'storefront', type: 'pr_conflicts', number: 415, kind: 'pr', title: 'Bump payments SDK to 4.2', assignee: 'tobi', days: 5 },

	// Mobile app
	{ project: 'mobile', type: 'pr_open_too_long', number: 233, kind: 'pr', title: 'Offline mode for the scan screen', assignee: 'sofia', days: 18 },
	{ project: 'mobile', type: 'no_activity', number: 229, kind: 'issue', title: 'Crash on cold start on Android 13', assignee: 'ren', days: 15, seen: true },
	{ project: 'mobile', type: 'pr_approved_not_merged', number: 247, kind: 'pr', title: 'Cut bundle size by dropping moment', assignee: 'sofia', days: 10 },
	{ project: 'mobile', type: 'pr_no_review', number: 245, kind: 'pr', title: 'Dark mode polish for the bottom sheet', assignee: 'sofia', days: 8 },
	{ project: 'mobile', type: 'assigned_not_started', number: 241, kind: 'issue', title: 'Add haptics to receipt confirmation', assignee: 'milo', days: 4 },
	{ project: 'mobile', type: 'pr_changes_requested', number: 238, kind: 'pr', title: 'Move analytics behind a provider', assignee: 'milo', reviewer: 'ren', days: 3 },

	// Design system
	{ project: 'design-system', type: 'no_activity', number: 88, kind: 'pr', title: 'Token aliases for the spacing scale', assignee: 'iris', days: 30 },
	{ project: 'design-system', type: 'pr_open_too_long', number: 97, kind: 'pr', title: 'Replace the tooltip primitive', assignee: 'iris', days: 13 },
	{ project: 'design-system', type: 'assigned_not_started', number: 91, kind: 'issue', title: 'Audit color contrast in the dark theme', assignee: 'noah', days: 11 },
	{ project: 'design-system', type: 'pr_no_review', number: 94, kind: 'pr', title: 'Document focus rings', assignee: 'iris', days: 7 },

	// Platform
	{ project: 'platform', type: 'pr_conflicts', number: 57, kind: 'pr', title: 'Upgrade Terraform provider to 5.x', assignee: 'pablo', days: 22 },
	{ project: 'platform', type: 'no_activity', number: 52, kind: 'issue', title: 'Rotate staging database credentials', assignee: 'pablo', days: 17 },
	{ project: 'platform', type: 'pr_no_review', number: 61, kind: 'pr', title: 'Add alerting for queue depth', assignee: 'pablo', days: 4 },
	{ project: 'platform', type: 'assigned_not_started', number: 63, kind: 'issue', title: 'Write a runbook for the failover drill', assignee: 'dana', days: 2 }
];

/** Open reminders that are already snoozed, shown on /inbox/snoozed. */
const SNOOZED = [
	{ project: 'mobile', type: 'pr_no_review', number: 251, kind: 'pr', title: 'Experiment: new onboarding copy', assignee: 'sofia', days: 6, snoozedInDays: 5 },
	{ project: 'design-system', type: 'assigned_not_started', number: 101, kind: 'issue', title: 'Deprecate the legacy button variants', assignee: 'noah', days: 9, snoozedInDays: 2 }
];

/** Closed rows give the history tables something believable to show. */
const CLOSED = [
	{ project: 'platform', type: 'no_activity', number: 44, kind: 'issue', title: 'Remove unused feature flags', assignee: 'pablo', days: 12, status: 'dismissed', closedAgo: 1 },
	{ project: 'platform', type: 'pr_open_too_long', number: 38, kind: 'pr', title: 'Upgrade the runtime to Node 22', assignee: 'dana', days: 11, status: 'resolved', closedAgo: 2 }
];

function messageFor(reminder) {
	const days = Math.floor(reminder.days);
	switch (reminder.type) {
		case 'assigned_not_started':
			return `Issue #${reminder.number} has been assigned to ${reminder.assignee} for ${days} days but has not started.`;
		case 'pr_open_too_long':
			return `PR #${reminder.number} has been open for ${days} days.`;
		case 'pr_no_review':
			return `PR #${reminder.number} has been open for ${days} days with no review.`;
		case 'pr_changes_requested':
			return `PR #${reminder.number} had changes requested by ${reminder.reviewer} ${days} days ago and no new commits have been pushed.`;
		case 'pr_approved_not_merged':
			return `PR #${reminder.number} was approved ${days} days ago but has not been merged.`;
		case 'pr_conflicts':
			return `PR #${reminder.number} has had merge conflicts for ${days} days.`;
		case 'no_activity':
			return `${reminder.kind === 'pr' ? 'PR' : 'Issue'} #${reminder.number} has had no activity for ${days} days.`;
		default:
			return `${reminder.kind === 'pr' ? 'PR' : 'Issue'} #${reminder.number} needs attention.`;
	}
}

function seedSql() {
	const bySlug = new Map(PROJECTS.map((project) => [project.slug, project]));
	const statements = [resetSql()];

	for (const project of PROJECTS) {
		const projectId = `${PROJECT_PREFIX}project-${project.slug}`;
		statements.push(
			`INSERT INTO projects (id, name, owner, repo, created_by_user_id, created_at) VALUES (${[
				sql(projectId),
				sql(project.name),
				sql(project.owner),
				sql(project.repo),
				sql(userId),
				sql(isoAgo(30 * DAY))
			].join(', ')});`
		);

		for (const rule of RULES) {
			statements.push(
				`INSERT INTO reminder_configs (id, project_id, type, enabled, threshold_days, started_definition) VALUES (${[
					sql(`${projectId}-${rule.type}`),
					sql(projectId),
					sql(rule.type),
					rule.type === 'stuck_in_column' ? 0 : 1,
					rule.threshold,
					sql(rule.started)
				].join(', ')});`
			);
		}

		// Three scans so the project history is not a single lonely row.
		const scans = [
			{ startedAgo: 6 * HOUR, items: project.checked, created: project.created[0], resolved: 1 },
			{ startedAgo: 30 * HOUR, items: project.checked - 6, created: project.created[1], resolved: 0 },
			{ startedAgo: 54 * HOUR, items: project.checked - 11, created: project.created[2], resolved: 2 }
		];

		scans.forEach((scan, index) => {
			statements.push(
				`INSERT INTO scan_logs (id, project_id, started_at, finished_at, items_checked, reminders_created, reminders_resolved, error) VALUES (${[
					sql(`${projectId}-scan-${index + 1}`),
					sql(projectId),
					sql(isoAgo(scan.startedAgo)),
					sql(isoAgo(scan.startedAgo - 90_000)),
					sql(scan.items),
					sql(scan.created),
					sql(scan.resolved),
					'NULL'
				].join(', ')});`
			);
		});
	}

	const rows = [
		...REMINDERS.map((reminder) => ({ ...reminder, status: 'open' })),
		...SNOOZED.map((reminder) => ({ ...reminder, status: 'open' })),
		...CLOSED
	];

	for (const reminder of rows) {
		const project = bySlug.get(reminder.project);
		const projectId = `${PROJECT_PREFIX}project-${reminder.project}`;
		const staleSince = isoAgo(reminder.days * DAY + (reminder.number % 7) * HOUR);
		const kindPath = reminder.kind === 'pr' ? 'pull' : 'issues';

		const seenAt = reminder.seen ? isoAgo(2 * HOUR) : null;
		const snoozedUntil =
			reminder.snoozedInDays !== undefined ? isoIn(reminder.snoozedInDays * DAY) : null;
		const dismissedAt = reminder.status === 'dismissed' ? isoAgo(reminder.closedAgo * DAY) : null;
		const resolvedAt = reminder.status === 'resolved' ? isoAgo(reminder.closedAgo * DAY) : null;

		statements.push(
			`INSERT INTO reminders (id, project_id, type, github_item_number, github_item_type, github_url, title, assignee, message, status, created_at, stale_since, seen_at, snoozed_until, dismissed_at, resolved_at) VALUES (${[
				sql(`${projectId}-${reminder.type}-${reminder.number}`),
				sql(projectId),
				sql(reminder.type),
				reminder.number,
				sql(reminder.kind),
				sql(`https://github.com/${project.owner}/${project.repo}/${kindPath}/${reminder.number}`),
				sql(reminder.title),
				sql(reminder.assignee),
				sql(messageFor(reminder)),
				sql(reminder.status),
				sql(staleSince),
				sql(staleSince),
				sql(seenAt),
				sql(snoozedUntil),
				sql(dismissedAt),
				sql(resolvedAt)
			].join(', ')});`
		);

		if (reminder.type === 'pr_conflicts') {
			statements.push(
				`INSERT INTO reminder_conditions (project_id, type, github_item_number, first_seen_at) VALUES (${[
					sql(projectId),
					sql(reminder.type),
					reminder.number,
					sql(staleSince)
				].join(', ')});`
			);
		}
	}

	return statements.join('\n');
}

// --- run ------------------------------------------------------------------

if (hasFlag('print-sql')) {
	console.log(seedSql());
	process.exit(0);
}

if (hasFlag('reset')) {
	execute(resetSql());
	console.log('✓ Removed seeded projects, reminders, configs and scans.');
	console.log('  Real projects in the local database were left alone.');
	process.exit(0);
}

execute(seedSql());

const openCount = REMINDERS.length;
const snoozedCount = SNOOZED.length;

console.log(`✓ Seeded ${PROJECTS.length} projects for @${userLogin}`);
console.log(`  ${openCount} open reminders, ${snoozedCount} snoozed, ${CLOSED.length} closed`);
for (const project of PROJECTS) {
	const count = REMINDERS.filter((reminder) => reminder.project === project.slug).length;
	console.log(`  · ${project.name.padEnd(15)} ${project.owner}/${project.repo} (${count} open)`);
}
console.log(`\n  Open ${appUrl}/inbox`);
console.log('  Re-run to reset the demo data, or use --reset to remove it.');
