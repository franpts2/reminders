import type { D1Database } from '@cloudflare/workers-types';

export interface User {
	id: string;
	github_id: number;
	github_login: string;
	email: string | null;
	avatar_url: string | null;
	access_token: string;
	oauth_scopes: string | null;
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
	stale_since: string | null;
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
	user: Omit<User, 'id' | 'created_at' | 'oauth_scopes'> & { oauth_scopes?: string | null }
): Promise<User> {
	const id = generateId();
	await db
		.prepare(
			'INSERT INTO users (id, github_id, github_login, email, avatar_url, access_token, oauth_scopes) VALUES (?, ?, ?, ?, ?, ?, ?)'
		)
		.bind(
			id,
			user.github_id,
			user.github_login,
			user.email,
			user.avatar_url,
			user.access_token,
			user.oauth_scopes ?? null
		)
		.run();
	return { ...user, oauth_scopes: user.oauth_scopes ?? null, id, created_at: new Date().toISOString() };
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
		label: 'Needs review',
		short_label: 'Needs review',
		description:
			'A pull request is waiting for a first review, or for a re-review after new commits were pushed.'
	},
	{
		key: 'pr_changes_requested',
		label: 'Changes requested',
		short_label: 'Changes requested',
		description:
			'A pull request has changes requested and the author has not pushed since.'
	},
	{
		key: 'pr_approved_not_merged',
		label: 'Approved but not merged',
		short_label: 'Approved, unmerged',
		description: 'A pull request has been approved but not merged for longer than the threshold.'
	},
	{
		key: 'pr_conflicts',
		label: 'Merge conflicts',
		short_label: 'Conflicts',
		description: 'A pull request has had unresolved merge conflicts for longer than the threshold.'
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
			ORDER BY COALESCE(r.stale_since, r.created_at) ASC`
		)
		.bind(userId, now.toISOString())
		.all<InboxReminder>();
	return results || [];
}

export async function getSnoozedReminders(
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
				AND r.snoozed_until IS NOT NULL AND r.snoozed_until > ?
			ORDER BY r.snoozed_until ASC`
		)
		.bind(userId, now.toISOString())
		.all<InboxReminder>();
	return results || [];
}

export async function getSnoozedReminderCount(
	db: D1Database,
	userId: string,
	now = new Date()
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS count FROM reminders r
			JOIN projects p ON p.id = r.project_id
			WHERE p.created_by_user_id = ? AND r.status = 'open'
				AND r.snoozed_until IS NOT NULL AND r.snoozed_until > ?`
		)
		.bind(userId, now.toISOString())
		.first<{ count: number }>();
	return row?.count ?? 0;
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
		db.prepare('DELETE FROM reminder_conditions WHERE project_id = ?').bind(projectId),
		db.prepare('DELETE FROM reminder_configs WHERE project_id = ?').bind(projectId),
		db.prepare('DELETE FROM scan_logs WHERE project_id = ?').bind(projectId),
		db
			.prepare(
				`DELETE FROM sprint_snapshots WHERE sprint_id IN (
					SELECT s.id FROM sprints s
					JOIN project_boards b ON b.id = s.board_id
					WHERE b.project_id = ?
				)`
			)
			.bind(projectId),
		db
			.prepare(
				`DELETE FROM sprint_items WHERE sprint_id IN (
					SELECT s.id FROM sprints s
					JOIN project_boards b ON b.id = s.board_id
					WHERE b.project_id = ?
				)`
			)
			.bind(projectId),
		db
			.prepare(
				'DELETE FROM sprints WHERE board_id IN (SELECT id FROM project_boards WHERE project_id = ?)'
			)
			.bind(projectId),
		db
			.prepare(
				'DELETE FROM board_sync_logs WHERE board_id IN (SELECT id FROM project_boards WHERE project_id = ?)'
			)
			.bind(projectId),
		db.prepare('DELETE FROM project_boards WHERE project_id = ?').bind(projectId),
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

/**
 * Tracks how long a stateful condition has been true when GitHub does not
 * expose its start time (merge conflicts). The reminder itself is only
 * created once the threshold passes.
 */
export async function getReminderConditions(
	db: D1Database,
	projectId: string,
	type: string
): Promise<Map<number, string>> {
	const { results } = await db
		.prepare(
			`SELECT github_item_number, first_seen_at FROM reminder_conditions
			WHERE project_id = ? AND type = ?`
		)
		.bind(projectId, type)
		.all<{ github_item_number: number; first_seen_at: string }>();

	return new Map((results || []).map((row) => [row.github_item_number, row.first_seen_at]));
}

export async function upsertReminderCondition(
	db: D1Database,
	projectId: string,
	type: string,
	githubItemNumber: number,
	now = new Date()
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO reminder_conditions (project_id, type, github_item_number, first_seen_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(project_id, type, github_item_number) DO NOTHING`
		)
		.bind(projectId, type, githubItemNumber, now.toISOString())
		.run();
}

// D1 allows 100 bound parameters per query; two are taken by project and type.
const CONDITION_DELETE_BATCH_SIZE = 90;

export async function deleteReminderConditions(
	db: D1Database,
	projectId: string,
	type: string,
	githubItemNumbers: number[]
): Promise<void> {
	const uniqueNumbers = [...new Set(githubItemNumbers)];

	for (let start = 0; start < uniqueNumbers.length; start += CONDITION_DELETE_BATCH_SIZE) {
		const batch = uniqueNumbers.slice(start, start + CONDITION_DELETE_BATCH_SIZE);
		const placeholders = batch.map(() => '?').join(', ');

		await db
			.prepare(
				`DELETE FROM reminder_conditions
				WHERE project_id = ? AND type = ? AND github_item_number IN (${placeholders})`
			)
			.bind(projectId, type, ...batch)
			.run();
	}
}

export async function deleteReminderConditionsByType(
	db: D1Database,
	projectId: string,
	type: string
): Promise<void> {
	await db
		.prepare('DELETE FROM reminder_conditions WHERE project_id = ? AND type = ?')
		.bind(projectId, type)
		.run();
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
			'INSERT INTO reminders (id, project_id, type, github_item_number, github_item_type, github_url, title, assignee, message, status, stale_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
			reminder.status,
			reminder.stale_since
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
	updates: {
		github_url: string;
		title: string;
		assignee: string | null;
		message: string;
		stale_since: string;
	}
): Promise<void> {
	await db
		.prepare(
			'UPDATE reminders SET github_url = ?, title = ?, assignee = ?, message = ?, stale_since = ? WHERE id = ?'
		)
		.bind(
			updates.github_url,
			updates.title,
			updates.assignee,
			updates.message,
			updates.stale_since,
			id
		)
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

export async function reopenReminder(
	db: D1Database,
	id: string,
	staleSince: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE reminders SET status = 'open', seen_at = NULL, snoozed_until = NULL,
				dismissed_at = NULL, resolved_at = NULL, stale_since = ?
			WHERE id = ?`
		)
		.bind(staleSince, id)
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

// ---------------------------------------------------------------------------
// Sprint metrics (GitHub Projects v2)
// ---------------------------------------------------------------------------

export interface ProjectBoard {
	id: string;
	project_id: string;
	owner_login: string;
	owner_type: 'organization' | 'user';
	project_number: number;
	project_node_id: string;
	iteration_field_id: string;
	iteration_field_name: string;
	status_field_id: string | null;
	status_field_name: string | null;
	done_option_name: string | null;
	last_synced_at: string | null;
	last_sync_error: string | null;
	created_at: string;
}

export interface Sprint {
	id: string;
	board_id: string;
	iteration_id: string;
	title: string;
	start_date: string;
	duration_days: number;
	end_date: string;
	state: 'upcoming' | 'active' | 'completed';
	baseline_locked_at: string | null;
	baseline_approximate: number;
	closed_at: string | null;
	created_at: string;
}

export interface SprintItem {
	id: string;
	sprint_id: string;
	project_item_id: string;
	repo_full_name: string | null;
	item_type: 'issue' | 'pr' | 'draft';
	number: number | null;
	title: string;
	status: string | null;
	assignee: string | null;
	labels: string | null;
	content_state: string | null;
	state_reason: string | null;
	is_archived: number;
	iteration_assigned_at: string | null;
	is_committed: number;
	first_seen_at: string;
	last_seen_at: string;
	closed_at: string | null;
	merged_at: string | null;
}

export interface SprintSnapshot {
	id: string;
	sprint_id: string;
	project_item_id: string;
	snapshotted_on: string;
	iteration_id: string | null;
	status: string | null;
	is_done: number;
}

export interface BoardSyncLog {
	id: string;
	board_id: string;
	started_at: string;
	finished_at: string | null;
	items_seen: number;
	items_redacted: number;
	sprints_synced: number;
	error: string | null;
	stats_json: string | null;
}

export type SprintInput = Omit<Sprint, 'id' | 'created_at'> & { id?: string };
export type SprintItemInput = Omit<SprintItem, 'id'> & { id?: string };
export type SprintSnapshotInput = Omit<SprintSnapshot, 'id'> & { id?: string };

export interface SprintMetricsRow extends SprintItem {
	sprint_start: string;
	sprint_end: string;
	board_id: string;
	done_option_name: string | null;
}

export async function getBoardByProject(
	db: D1Database,
	projectId: string
): Promise<ProjectBoard | null> {
	const row = await db
		.prepare('SELECT * FROM project_boards WHERE project_id = ?')
		.bind(projectId)
		.first<ProjectBoard>();
	return row || null;
}

export async function getSprintsByBoard(db: D1Database, boardId: string): Promise<Sprint[]> {
	const { results } = await db
		.prepare('SELECT * FROM sprints WHERE board_id = ? ORDER BY start_date DESC')
		.bind(boardId)
		.all<Sprint>();
	return results || [];
}

export async function getSprintByIteration(
	db: D1Database,
	boardId: string,
	iterationId: string
): Promise<Sprint | null> {
	const row = await db
		.prepare('SELECT * FROM sprints WHERE board_id = ? AND iteration_id = ?')
		.bind(boardId, iterationId)
		.first<Sprint>();
	return row || null;
}

/**
 * Upserts on `(board_id, iteration_id)`. Baseline and close timestamps are
 * sticky: a refresh never clears them. Returns the stored row so callers get
 * the id that actually exists.
 */
export async function upsertSprint(db: D1Database, sprint: SprintInput): Promise<Sprint> {
	await db
		.prepare(
			`INSERT INTO sprints (
				id, board_id, iteration_id, title, start_date, duration_days, end_date,
				state, baseline_locked_at, baseline_approximate, closed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(board_id, iteration_id) DO UPDATE SET
				title = excluded.title,
				start_date = excluded.start_date,
				duration_days = excluded.duration_days,
				end_date = excluded.end_date,
				state = excluded.state,
				baseline_locked_at = COALESCE(excluded.baseline_locked_at, sprints.baseline_locked_at),
				baseline_approximate = MAX(sprints.baseline_approximate, excluded.baseline_approximate),
				closed_at = COALESCE(excluded.closed_at, sprints.closed_at)`
		)
		.bind(
			sprint.id ?? generateId(),
			sprint.board_id,
			sprint.iteration_id,
			sprint.title,
			sprint.start_date,
			sprint.duration_days,
			sprint.end_date,
			sprint.state,
			sprint.baseline_locked_at,
			sprint.baseline_approximate,
			sprint.closed_at
		)
		.run();

	const stored = await getSprintByIteration(db, sprint.board_id, sprint.iteration_id);
	if (!stored) throw new Error('Sprint disappeared after upsert');
	return stored;
}

export async function getSprintItems(
	db: D1Database,
	sprintId: string,
	onlyCommitted = false
): Promise<SprintItem[]> {
	const { results } = await db
		.prepare(
			onlyCommitted
				? 'SELECT * FROM sprint_items WHERE sprint_id = ? AND is_committed = 1 ORDER BY item_type, number'
				: 'SELECT * FROM sprint_items WHERE sprint_id = ? ORDER BY item_type, number'
		)
		.bind(sprintId)
		.all<SprintItem>();
	return results || [];
}

// D1 allows 100 bound parameters per query, and sprint_items has 19 columns.
const SPRINT_ITEM_COLUMNS = 19;
const SPRINT_ITEM_ROWS_PER_STATEMENT = Math.floor(100 / SPRINT_ITEM_COLUMNS);
const STATEMENTS_PER_BATCH = 20;

/**
 * Inserts or refreshes items for their sprint. `is_committed` (the baseline)
 * and `first_seen_at` are only written on insert; everything else refreshes.
 */
export async function upsertSprintItems(
	db: D1Database,
	items: SprintItemInput[]
): Promise<void> {
	if (items.length === 0) return;

	const rowPlaceholder = `(${Array(SPRINT_ITEM_COLUMNS).fill('?').join(', ')})`;
	const statements: ReturnType<D1Database['prepare']>[] = [];

	for (let start = 0; start < items.length; start += SPRINT_ITEM_ROWS_PER_STATEMENT) {
		const chunk = items.slice(start, start + SPRINT_ITEM_ROWS_PER_STATEMENT);
		const values = chunk.flatMap((item) => [
			item.id ?? generateId(),
			item.sprint_id,
			item.project_item_id,
			item.repo_full_name,
			item.item_type,
			item.number,
			item.title,
			item.status,
			item.assignee,
			item.labels,
			item.content_state,
			item.state_reason,
			item.is_archived,
			item.iteration_assigned_at,
			item.is_committed,
			item.first_seen_at,
			item.last_seen_at,
			item.closed_at,
			item.merged_at
		]);

		statements.push(
			db
				.prepare(
					`INSERT INTO sprint_items (
						id, sprint_id, project_item_id, repo_full_name, item_type, number, title,
						status, assignee, labels, content_state, state_reason, is_archived,
						iteration_assigned_at, is_committed, first_seen_at, last_seen_at,
						closed_at, merged_at
					) VALUES ${chunk.map(() => rowPlaceholder).join(', ')}
					ON CONFLICT(sprint_id, project_item_id) DO UPDATE SET
						repo_full_name = excluded.repo_full_name,
						item_type = excluded.item_type,
						number = excluded.number,
						title = excluded.title,
						status = excluded.status,
						assignee = excluded.assignee,
						labels = excluded.labels,
						content_state = excluded.content_state,
						state_reason = excluded.state_reason,
						is_archived = excluded.is_archived,
						iteration_assigned_at = excluded.iteration_assigned_at,
						last_seen_at = excluded.last_seen_at,
						closed_at = excluded.closed_at,
						merged_at = excluded.merged_at`
				)
				.bind(...values)
		);
	}

	for (let start = 0; start < statements.length; start += STATEMENTS_PER_BATCH) {
		await db.batch(statements.slice(start, start + STATEMENTS_PER_BATCH));
	}
}

/** Idempotent per (sprint, item, day). */
export async function recordSnapshot(
	db: D1Database,
	snapshot: SprintSnapshotInput
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sprint_snapshots (
				id, sprint_id, project_item_id, snapshotted_on, iteration_id, status, is_done
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(sprint_id, project_item_id, snapshotted_on) DO UPDATE SET
				iteration_id = excluded.iteration_id,
				status = excluded.status,
				is_done = excluded.is_done`
		)
		.bind(
			snapshot.id ?? generateId(),
			snapshot.sprint_id,
			snapshot.project_item_id,
			snapshot.snapshotted_on,
			snapshot.iteration_id,
			snapshot.status,
			snapshot.is_done
		)
		.run();
}

export async function getSprintSnapshots(
	db: D1Database,
	sprintId: string
): Promise<SprintSnapshot[]> {
	const { results } = await db
		.prepare(
			'SELECT * FROM sprint_snapshots WHERE sprint_id = ? ORDER BY snapshotted_on, project_item_id'
		)
		.bind(sprintId)
		.all<SprintSnapshot>();
	return results || [];
}

/** Items plus the window and board settings needed to score them. */
export async function getSprintMetricsRows(
	db: D1Database,
	sprintId: string
): Promise<SprintMetricsRow[]> {
	const { results } = await db
		.prepare(
			`SELECT si.*, s.start_date AS sprint_start, s.end_date AS sprint_end,
				s.board_id, b.done_option_name
			FROM sprint_items si
			JOIN sprints s ON s.id = si.sprint_id
			JOIN project_boards b ON b.id = s.board_id
			WHERE si.sprint_id = ?
			ORDER BY si.item_type, si.number`
		)
		.bind(sprintId)
		.all<SprintMetricsRow>();
	return results || [];
}

export async function createBoardSyncLog(
	db: D1Database,
	boardId: string
): Promise<BoardSyncLog> {
	const id = generateId();
	const startedAt = new Date().toISOString();
	await db
		.prepare('INSERT INTO board_sync_logs (id, board_id, started_at) VALUES (?, ?, ?)')
		.bind(id, boardId, startedAt)
		.run();
	return {
		id,
		board_id: boardId,
		started_at: startedAt,
		finished_at: null,
		items_seen: 0,
		items_redacted: 0,
		sprints_synced: 0,
		error: null,
		stats_json: null
	};
}

export async function finishBoardSyncLog(
	db: D1Database,
	id: string,
	updates: {
		items_seen?: number;
		items_redacted?: number;
		sprints_synced?: number;
		error?: string | null;
		stats_json?: string | null;
	}
): Promise<void> {
	const sets = ['finished_at = ?'];
	const values: (string | number | null)[] = [new Date().toISOString()];

	if (updates.items_seen !== undefined) {
		sets.push('items_seen = ?');
		values.push(updates.items_seen);
	}
	if (updates.items_redacted !== undefined) {
		sets.push('items_redacted = ?');
		values.push(updates.items_redacted);
	}
	if (updates.sprints_synced !== undefined) {
		sets.push('sprints_synced = ?');
		values.push(updates.sprints_synced);
	}
	if (updates.error !== undefined) {
		sets.push('error = ?');
		values.push(updates.error);
	}
	if (updates.stats_json !== undefined) {
		sets.push('stats_json = ?');
		values.push(updates.stats_json);
	}

	values.push(id);
	await db
		.prepare(`UPDATE board_sync_logs SET ${sets.join(', ')} WHERE id = ?`)
		.bind(...values)
		.run();
}

export async function getLatestBoardSyncLog(
	db: D1Database,
	boardId: string
): Promise<BoardSyncLog | null> {
	const row = await db
		.prepare(
			'SELECT * FROM board_sync_logs WHERE board_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1'
		)
		.bind(boardId)
		.first<BoardSyncLog>();
	return row || null;
}
