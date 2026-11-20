import type { D1Database } from '@cloudflare/workers-types';

export interface User {
	id: string;
	github_id: number;
	github_login: string;
	email: string | null;
	avatar_url: string | null;
	access_token: string;
	created_at: string;
}

export interface Project {
	id: string;
	name: string;
	owner: string;
	repo: string;
	created_by_user_id: string;
	created_at: string;
}

export interface ReminderConfig {
	id: string;
	project_id: string;
	type: string;
	enabled: number;
	threshold_days: number;
	started_definition: string | null;
	created_at: string;
	updated_at: string;
}

export type ReminderStatus = 'open' | 'dismissed' | 'resolved';

export interface Reminder {
	id: string;
	project_id: string;
	type: string;
	github_item_number: number;
	github_item_type: string;
	github_url: string;
	title: string;
	assignee: string | null;
	message: string;
	status: ReminderStatus;
	created_at: string;
	seen_at: string | null;
	snoozed_until: string | null;
	dismissed_at: string | null;
	resolved_at: string | null;
}

export interface InboxReminder extends Reminder {
	project_name: string;
	project_owner: string;
	project_repo: string;
}

export function generateId() {
	return crypto.randomUUID();
}

export async function getUserByGithubId(db: D1Database, githubId: number): Promise<User | null> {
	const result = await db.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first<User>();
	return result || null;
}

export async function createUser(
	db: D1Database,
	user: Omit<User, 'id' | 'created_at'>
): Promise<User> {
	const id = generateId();
	await db
		.prepare(
			'INSERT INTO users (id, github_id, github_login, email, avatar_url, access_token) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.bind(id, user.github_id, user.github_login, user.email, user.avatar_url, user.access_token)
		.run();
	return { ...user, id, created_at: new Date().toISOString() };
}

export async function updateUserAccessToken(
	db: D1Database,
	githubId: number,
	accessToken: string
): Promise<void> {
	await db.prepare('UPDATE users SET access_token = ? WHERE github_id = ?').bind(accessToken, githubId).run();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
	return await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function getProjectsByUser(db: D1Database, userId: string): Promise<Project[]> {
	const { results } = await db
		.prepare('SELECT * FROM projects WHERE created_by_user_id = ? ORDER BY created_at DESC')
		.bind(userId)
		.all<Project>();
	return results || [];
}

export async function getProjectById(db: D1Database, id: string): Promise<Project | null> {
	return await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>();
}

export async function createProject(
	db: D1Database,
	project: Omit<Project, 'id' | 'created_at'>
): Promise<Project> {
	const id = generateId();
	await db
		.prepare('INSERT INTO projects (id, name, owner, repo, created_by_user_id) VALUES (?, ?, ?, ?, ?)')
		.bind(id, project.name, project.owner, project.repo, project.created_by_user_id)
		.run();
	return { ...project, id, created_at: new Date().toISOString() };
}

export async function getReminderConfigsByProject(
	db: D1Database,
	projectId: string
): Promise<ReminderConfig[]> {
	const { results } = await db
		.prepare('SELECT * FROM reminder_configs WHERE project_id = ?')
		.bind(projectId)
		.all<ReminderConfig>();
	return results || [];
}

export const REMINDER_TYPES = [
	{
		key: 'assigned_not_started',
		label: 'Assigned but not started',
		short_label: 'Not started',
		description: 'Issue assigned to someone but with no linked PR and/or not moved to In Progress.'
	},
	{
		key: 'pr_open_too_long',
		label: 'PR open too long',
		short_label: 'Open too long',
		description: 'A pull request has been open for longer than the threshold.'
	},
	{
		key: 'pr_no_review',
		label: 'PR with no review',
		short_label: 'No review',
		description: 'A pull request has been open with no review for longer than the threshold.'
	},
	{
		key: 'pr_approved_not_merged',
		label: 'Approved but not merged',
		short_label: 'Approved, unmerged',
		description: 'A pull request has been approved but not merged for longer than the threshold.'
	},
	{
		key: 'stuck_in_column',
		label: 'Stuck in project column',
		short_label: 'Stuck',
		description: 'An issue or PR has been in the same project board column for longer than the threshold.'
	},
	{
		key: 'no_activity',
		label: 'No activity',
		short_label: 'No activity',
		description: 'An issue or PR has had no activity for longer than the threshold.'
	}
];

export async function ensureDefaultReminderConfigs(
	db: D1Database,
	projectId: string
): Promise<void> {
	for (const type of REMINDER_TYPES) {
		const existing = await db
			.prepare('SELECT id FROM reminder_configs WHERE project_id = ? AND type = ?')
			.bind(projectId, type.key)
			.first();
		if (!existing) {
			const id = generateId();
			await db
				.prepare(
					'INSERT INTO reminder_configs (id, project_id, type, enabled, threshold_days, started_definition) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.bind(id, projectId, type.key, 0, 3, type.key === 'assigned_not_started' ? 'both' : null)
				.run();
		}
	}
}

export async function updateReminderConfig(
	db: D1Database,
	projectId: string,
	type: string,
	updates: { enabled?: number; threshold_days?: number; started_definition?: string | null }
): Promise<void> {
	const sets: string[] = [];
	const values: (string | number | null)[] = [];

	if (updates.enabled !== undefined) {
		sets.push('enabled = ?');
		values.push(updates.enabled);
	}
	if (updates.threshold_days !== undefined) {
		sets.push('threshold_days = ?');
		values.push(updates.threshold_days);
	}
	if (updates.started_definition !== undefined) {
		sets.push('started_definition = ?');
		values.push(updates.started_definition);
	}
	if (sets.length === 0) return;

	sets.push('updated_at = CURRENT_TIMESTAMP');
	values.push(projectId, type);

	await db
		.prepare(`UPDATE reminder_configs SET ${sets.join(', ')} WHERE project_id = ? AND type = ?`)
		.bind(...values)
		.run();
}

/**
 * Reminders a user can act on right now: open and not snoozed into the future.
 */
export async function getActiveRemindersByProject(
	db: D1Database,
	projectId: string,
	now = new Date()
): Promise<Reminder[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM reminders
			WHERE project_id = ? AND status = 'open'
				AND (snoozed_until IS NULL OR snoozed_until <= ?)
			ORDER BY created_at DESC`
		)
		.bind(projectId, now.toISOString())
		.all<Reminder>();
	return results || [];
}

export async function getInboxReminders(
	db: D1Database,
	userId: string,
	now = new Date()
): Promise<InboxReminder[]> {
	const { results } = await db
		.prepare(
			`SELECT r.*, p.name AS project_name, p.owner AS project_owner, p.repo AS project_repo
			FROM reminders r
			JOIN projects p ON p.id = r.project_id
			WHERE p.created_by_user_id = ? AND r.status = 'open'
				AND (r.snoozed_until IS NULL OR r.snoozed_until <= ?)
			ORDER BY r.created_at ASC`
		)
		.bind(userId, now.toISOString())
		.all<InboxReminder>();
	return results || [];
}

export async function getOpenRemindersByType(
	db: D1Database,
	projectId: string,
	type: string
): Promise<Reminder[]> {
	const { results } = await db
		.prepare(`SELECT * FROM reminders WHERE project_id = ? AND type = ? AND status = 'open'`)
		.bind(projectId, type)
		.all<Reminder>();
	return results || [];
}

export async function getLatestScanForUser(
	db: D1Database,
	userId: string
): Promise<ScanLog | null> {
	const result = await db
		.prepare(
			`SELECT s.* FROM scan_logs s
			JOIN projects p ON p.id = s.project_id
			WHERE p.created_by_user_id = ?
			ORDER BY s.started_at DESC, s.rowid DESC
			LIMIT 1`
		)
		.bind(userId)
		.first<ScanLog>();
	return result || null;
}

export async function getRecentScansByProject(
	db: D1Database,
	projectId: string,
	limit = 5
): Promise<ScanLog[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM scan_logs WHERE project_id = ?
			ORDER BY started_at DESC, rowid DESC LIMIT ?`
		)
		.bind(projectId, limit)
		.all<ScanLog>();
	return results || [];
}

export async function getOpenReminderCounts(
	db: D1Database,
	projectId: string
): Promise<Record<string, number>> {
	const { results } = await db
		.prepare(
			`SELECT type, COUNT(*) AS count FROM reminders
			WHERE project_id = ? AND status = 'open'
			GROUP BY type`
		)
		.bind(projectId)
		.all<{ type: string; count: number }>();

	return Object.fromEntries((results || []).map((row) => [row.type, row.count]));
}

export async function deleteProject(db: D1Database, projectId: string): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM reminders WHERE project_id = ?').bind(projectId),
		db.prepare('DELETE FROM reminder_configs WHERE project_id = ?').bind(projectId),
		db.prepare('DELETE FROM scan_logs WHERE project_id = ?').bind(projectId),
		db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId)
	]);
}

export async function getReminderById(db: D1Database, id: string): Promise<Reminder | null> {
	const result = await db.prepare('SELECT * FROM reminders WHERE id = ?').bind(id).first<Reminder>();
	return result || null;
}

/**
 * Returns the reminder only if it belongs to a project owned by the user.
 */
export async function getOwnedReminder(
	db: D1Database,
	userId: string,
	id: string
): Promise<Reminder | null> {
	const result = await db
		.prepare(
			`SELECT r.* FROM reminders r
			JOIN projects p ON p.id = r.project_id
			WHERE r.id = ? AND p.created_by_user_id = ?`
		)
		.bind(id, userId)
		.first<Reminder>();
	return result || null;
}

export async function getReminderByItem(
	db: D1Database,
	projectId: string,
	type: string,
	githubItemNumber: number
): Promise<Reminder | null> {
	const result = await db
		.prepare('SELECT * FROM reminders WHERE project_id = ? AND type = ? AND github_item_number = ?')
		.bind(projectId, type, githubItemNumber)
		.first<Reminder>();
	return result || null;
}

export async function getUnreadReminderCount(
	db: D1Database,
	userId: string,
	now = new Date()
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM reminders r
			JOIN projects p ON p.id = r.project_id
			WHERE p.created_by_user_id = ? AND r.status = 'open'
				AND r.seen_at IS NULL
				AND (r.snoozed_until IS NULL OR r.snoozed_until <= ?)`
		)
		.bind(userId, now.toISOString())
		.first<{ count: number }>();
	return row?.count ?? 0;
}

export async function getLatestScanByProject(
	db: D1Database,
	projectId: string
): Promise<ScanLog | null> {
	const result = await db
		.prepare('SELECT * FROM scan_logs WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1')
		.bind(projectId)
		.first<ScanLog>();
	return result || null;
}

export async function createReminder(
	db: D1Database,
	reminder: Omit<
		Reminder,
		'id' | 'created_at' | 'seen_at' | 'snoozed_until' | 'dismissed_at' | 'resolved_at'
	>
): Promise<Reminder> {
	const id = generateId();
	await db
		.prepare(
			'INSERT INTO reminders (id, project_id, type, github_item_number, github_item_type, github_url, title, assignee, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		)
		.bind(
			id,
			reminder.project_id,
			reminder.type,
			reminder.github_item_number,
			reminder.github_item_type,
			reminder.github_url,
			reminder.title,
			reminder.assignee,
			reminder.message,
			reminder.status
		)
		.run();
	return {
		...reminder,
		id,
		created_at: new Date().toISOString(),
		seen_at: null,
		snoozed_until: null,
		dismissed_at: null,
		resolved_at: null
	};
}

export async function refreshReminder(
	db: D1Database,
	id: string,
	updates: { github_url: string; title: string; assignee: string | null; message: string }
): Promise<void> {
	await db
		.prepare('UPDATE reminders SET github_url = ?, title = ?, assignee = ?, message = ? WHERE id = ?')
		.bind(updates.github_url, updates.title, updates.assignee, updates.message, id)
		.run();
}

// D1 allows 100 bound parameters per query. Each batch spends one on
// seen_at and one on the user id, so the remaining budget is the chunk size.
const D1_MAX_BOUND_PARAMETERS = 100;
const SEEN_BATCH_SIZE = D1_MAX_BOUND_PARAMETERS - 2;

export async function markRemindersSeenForUser(
	db: D1Database,
	userId: string,
	ids: string[],
	now = new Date()
): Promise<void> {
	const uniqueIds = [...new Set(ids)];
	if (uniqueIds.length === 0) return;

	const seenAt = now.toISOString();

	for (let start = 0; start < uniqueIds.length; start += SEEN_BATCH_SIZE) {
		const batch = uniqueIds.slice(start, start + SEEN_BATCH_SIZE);
		const placeholders = batch.map(() => '?').join(', ');

		await db
			.prepare(
				`UPDATE reminders SET seen_at = ?
				WHERE seen_at IS NULL AND id IN (${placeholders})
					AND project_id IN (SELECT id FROM projects WHERE created_by_user_id = ?)`
			)
			.bind(seenAt, ...batch, userId)
			.run();
	}
}

export async function snoozeReminder(db: D1Database, id: string, until: Date): Promise<void> {
	// Clear seen_at so the reminder comes back as unread when the snooze ends.
	await db
		.prepare('UPDATE reminders SET snoozed_until = ?, seen_at = NULL WHERE id = ?')
		.bind(until.toISOString(), id)
		.run();
}

export async function dismissReminder(db: D1Database, id: string, now = new Date()): Promise<void> {
	await db
		.prepare(`UPDATE reminders SET status = 'dismissed', dismissed_at = ?, snoozed_until = NULL WHERE id = ?`)
		.bind(now.toISOString(), id)
		.run();
}

export async function restoreReminder(db: D1Database, id: string): Promise<void> {
	await db
		.prepare(
			`UPDATE reminders SET status = 'open', dismissed_at = NULL, resolved_at = NULL,
				snoozed_until = NULL
			WHERE id = ?`
		)
		.bind(id)
		.run();
}

export async function reopenReminder(db: D1Database, id: string): Promise<void> {
	await db
		.prepare(
			`UPDATE reminders SET status = 'open', seen_at = NULL, snoozed_until = NULL,
				dismissed_at = NULL, resolved_at = NULL
			WHERE id = ?`
		)
		.bind(id)
		.run();
}

export async function resolveReminder(db: D1Database, id: string, now = new Date()): Promise<void> {
	await db
		.prepare(`UPDATE reminders SET status = 'resolved', resolved_at = ? WHERE id = ?`)
		.bind(now.toISOString(), id)
		.run();
}

export async function resolveRemindersByType(
	db: D1Database,
	projectId: string,
	type: string,
	now = new Date()
): Promise<number> {
	const result = await db
		.prepare(
			`UPDATE reminders SET status = 'resolved', resolved_at = ?
			WHERE project_id = ? AND type = ? AND status = 'open'`
		)
		.bind(now.toISOString(), projectId, type)
		.run();
	return result.meta.changes ?? 0;
}

export async function createScanLog(
	db: D1Database,
	scan: Omit<ScanLog, 'id' | 'started_at' | 'finished_at'>
): Promise<ScanLog> {
	const id = generateId();
	await db
		.prepare(
			'INSERT INTO scan_logs (id, project_id, items_checked, reminders_created, reminders_resolved, error) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.bind(
			id,
			scan.project_id,
			scan.items_checked,
			scan.reminders_created,
			scan.reminders_resolved,
			scan.error || null
		)
		.run();
	return { ...scan, id, started_at: new Date().toISOString(), finished_at: null };
}

export async function finishScanLog(
	db: D1Database,
	id: string,
	updates: {
		items_checked?: number;
		reminders_created?: number;
		reminders_resolved?: number;
		error?: string | null;
	}
): Promise<void> {
	await db
		.prepare(
			'UPDATE scan_logs SET finished_at = CURRENT_TIMESTAMP, items_checked = ?, reminders_created = ?, reminders_resolved = ?, error = ? WHERE id = ?'
		)
		.bind(
			updates.items_checked ?? 0,
			updates.reminders_created ?? 0,
			updates.reminders_resolved ?? 0,
			updates.error || null,
			id
		)
		.run();
}

export interface ScanLog {
	id: string;
	project_id: string;
	started_at: string;
	finished_at: string | null;
	items_checked: number;
	reminders_created: number;
	reminders_resolved: number;
	error: string | null;
}
