import type { D1Database } from '@cloudflare/workers-types';
import {
	createReminder,
	createScanLog,
	deleteProject,
	dismissReminder,
	ensureDefaultReminderConfigs,
	finishScanLog,
	markRemindersSeenForUser,
	resolveReminder,
	snoozeReminder,
	updateReminderConfig,
	type ReminderStatus
} from '$lib/db';

/**
 * Fictional projects and reminders for local development. Everything here is
 * inserted through the same helpers the app uses, so a schema or message
 * change cannot leave the seed behind. It is only reachable through the
 * dev-only route at /api/dev/seed.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PROJECT_PREFIX = 'seed-';

interface DemoProject {
	slug: string;
	name: string;
	owner: string;
	repo: string;
	/** Items the latest scan pretended to look at. */
	checked: number;
	/** Reminders "created" by each of the three seeded scans. */
	created: [number, number, number];
}

const PROJECTS: DemoProject[] = [
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

const RULES: Array<{ type: string; threshold: number; started: string | null }> = [
	{ type: 'assigned_not_started', threshold: 3, started: 'both' },
	{ type: 'pr_open_too_long', threshold: 5, started: null },
	{ type: 'pr_no_review', threshold: 2, started: null },
	{ type: 'pr_changes_requested', threshold: 3, started: null },
	{ type: 'pr_approved_not_merged', threshold: 2, started: null },
	{ type: 'pr_conflicts', threshold: 2, started: null },
	{ type: 'stuck_in_column', threshold: 14, started: null },
	{ type: 'no_activity', threshold: 7, started: null }
];

interface DemoReminder {
	project: string;
	type: string;
	number: number;
	kind: 'pr' | 'issue';
	title: string;
	assignee: string;
	/** How long the underlying condition has been true. Drives the age column. */
	days: number;
	/** Only used by the changes-requested rule. */
	reviewer?: string;
	seen?: boolean;
	snoozedInDays?: number;
	status?: Extract<ReminderStatus, 'dismissed' | 'resolved'>;
	closedAgoDays?: number;
}

const OPEN: DemoReminder[] = [
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

const SNOOZED: DemoReminder[] = [
	{ project: 'mobile', type: 'pr_no_review', number: 251, kind: 'pr', title: 'Experiment: new onboarding copy', assignee: 'sofia', days: 6, snoozedInDays: 5 },
	{ project: 'design-system', type: 'assigned_not_started', number: 101, kind: 'issue', title: 'Deprecate the legacy button variants', assignee: 'noah', days: 9, snoozedInDays: 2 }
];

const CLOSED: DemoReminder[] = [
	{ project: 'platform', type: 'no_activity', number: 44, kind: 'issue', title: 'Remove unused feature flags', assignee: 'pablo', days: 12, status: 'dismissed', closedAgoDays: 1 },
	{ project: 'platform', type: 'pr_open_too_long', number: 38, kind: 'pr', title: 'Upgrade the runtime to Node 22', assignee: 'dana', days: 11, status: 'resolved', closedAgoDays: 2 }
];

const projectId = (slug: string) => `${PROJECT_PREFIX}project-${slug}`;
const isoAgo = (now: number, ms: number) => new Date(now - ms).toISOString();

function messageFor(reminder: DemoReminder): string {
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

/**
 * Inserts go through createReminder, which lets the database stamp
 * created_at. The inbox compares that against the latest scan to decide
 * "new" versus "carried over", so demo rows get their historical creation
 * time back afterwards.
 */
async function backdateReminder(db: D1Database, id: string, createdAt: string): Promise<void> {
	await db.prepare('UPDATE reminders SET created_at = ? WHERE id = ?').bind(createdAt, id).run();
}

/** Same idea for scan history: the helper writes "now". */
async function backdateScan(
	db: D1Database,
	id: string,
	startedAt: string,
	finishedAt: string
): Promise<void> {
	await db
		.prepare('UPDATE scan_logs SET started_at = ?, finished_at = ? WHERE id = ?')
		.bind(startedAt, finishedAt, id)
		.run();
}

export interface DemoUser {
	id: string;
	github_login: string;
}

export async function listLocalUsers(db: D1Database): Promise<DemoUser[]> {
	const { results } = await db
		.prepare('SELECT id, github_login FROM users ORDER BY created_at DESC, rowid DESC')
		.all<DemoUser>();
	return results ?? [];
}

export interface SeedSummary {
	login: string;
	projects: Array<{ name: string; owner: string; repo: string; open: number }>;
	open: number;
	snoozed: number;
	closed: number;
}

/** Deletes only projects created by the seed, leaving real projects alone. */
export async function resetDemoData(db: D1Database): Promise<number> {
	for (const project of PROJECTS) {
		await deleteProject(db, projectId(project.slug));
	}
	return PROJECTS.length;
}

export async function seedDemoData(
	db: D1Database,
	user: DemoUser
): Promise<SeedSummary> {
	await resetDemoData(db);

	try {
		return await insertDemoData(db, user);
	} catch (cause) {
		// A half-seeded database is worse than none: clear what did land so the
		// next run starts from a clean slate.
		await resetDemoData(db).catch(() => {});
		throw cause;
	}
}

async function insertDemoData(db: D1Database, user: DemoUser): Promise<SeedSummary> {
	const now = Date.now();
	const projectsBySlug = new Map(PROJECTS.map((project) => [project.slug, project]));

	for (const project of PROJECTS) {
		const id = projectId(project.slug);

		// Deterministic ids are what makes resetDemoData possible; the other
		// project fields mirror what createProject would write.
		await db
			.prepare(
				`INSERT INTO projects (id, name, owner, repo, created_by_user_id, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(id, project.name, project.owner, project.repo, user.id, isoAgo(now, 30 * DAY))
			.run();

		await ensureDefaultReminderConfigs(db, id);
		for (const rule of RULES) {
			await updateReminderConfig(db, id, rule.type, {
				enabled: rule.type === 'stuck_in_column' ? 0 : 1,
				threshold_days: rule.threshold,
				started_definition: rule.started
			});
		}

		// Three scans so the project history is not a single lonely row.
		const scanOffsets = [6 * HOUR, 30 * HOUR, 54 * HOUR];
		for (let index = 0; index < scanOffsets.length; index += 1) {
			const startedAgo = scanOffsets[index];
			const itemsChecked = project.checked - (index === 0 ? 0 : index * 6);
			const remindersCreated = project.created[index] ?? 0;
			const remindersResolved = index === 0 ? 1 : index === 1 ? 0 : 2;

			const log = await createScanLog(db, {
				project_id: id,
				items_checked: itemsChecked,
				reminders_created: remindersCreated,
				reminders_resolved: remindersResolved,
				error: null
			});
			await finishScanLog(db, log.id, {
				items_checked: itemsChecked,
				reminders_created: remindersCreated,
				reminders_resolved: remindersResolved,
				error: null
			});
			await backdateScan(db, log.id, isoAgo(now, startedAgo), isoAgo(now, startedAgo - 90_000));
		}
	}

	const seenIds: string[] = [];
	const all = [...OPEN, ...SNOOZED, ...CLOSED];

	for (const reminder of all) {
		const project = projectsBySlug.get(reminder.project);
		if (!project) continue;

		// A little skew keeps two rows of the same age from looking duplicated.
		const staleSince = isoAgo(now, reminder.days * DAY + (reminder.number % 7) * HOUR);
		const kindPath = reminder.kind === 'pr' ? 'pull' : 'issues';

		const created = await createReminder(db, {
			project_id: projectId(project.slug),
			type: reminder.type,
			github_item_number: reminder.number,
			github_item_type: reminder.kind,
			github_url: `https://github.com/${project.owner}/${project.repo}/${kindPath}/${reminder.number}`,
			title: reminder.title,
			assignee: reminder.assignee,
			message: messageFor(reminder),
			status: 'open',
			stale_since: staleSince
		});

		await backdateReminder(db, created.id, staleSince);

		if (reminder.status === 'dismissed') {
			await dismissReminder(db, created.id, new Date(now - (reminder.closedAgoDays ?? 0) * DAY));
		} else if (reminder.status === 'resolved') {
			await resolveReminder(db, created.id, new Date(now - (reminder.closedAgoDays ?? 0) * DAY));
		} else if (reminder.snoozedInDays !== undefined) {
			await snoozeReminder(db, created.id, new Date(now + reminder.snoozedInDays * DAY));
		} else if (reminder.seen) {
			seenIds.push(created.id);
		}
	}

	if (seenIds.length > 0) {
		await markRemindersSeenForUser(db, user.id, seenIds);
	}

	return {
		login: user.github_login,
		projects: PROJECTS.map((project) => ({
			name: project.name,
			owner: project.owner,
			repo: project.repo,
			open: OPEN.filter((reminder) => reminder.project === project.slug).length
		})),
		open: OPEN.length,
		snoozed: SNOOZED.length,
		closed: CLOSED.length
	};
}
