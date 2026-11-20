import { redirect, error, fail } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { PageServerLoad, Actions } from './$types';
import {
	getProjectById,
	getReminderConfigsByProject,
	getActiveRemindersByProject,
	getLatestScanByProject,
	getReminderById,
	updateReminderConfig,
	snoozeReminder,
	dismissReminder,
	restoreReminder,
	resolveRemindersByType,
	REMINDER_TYPES
} from '$lib/db';
import { scanProject } from '$lib/scanner';

const MAX_SNOOZE_DAYS = 30;

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		throw error(500, 'Database not configured');
	}

	const project = await getProjectById(env.DB, params.id);
	if (!project || project.created_by_user_id !== locals.user.id) {
		throw error(404, 'Project not found');
	}

	const [configs, reminders, latestScan] = await Promise.all([
		getReminderConfigsByProject(env.DB, project.id),
		getActiveRemindersByProject(env.DB, project.id),
		getLatestScanByProject(env.DB, project.id)
	]);

	return {
		project,
		configs,
		reminders,
		latestScan,
		reminderTypeLabels: REMINDER_TYPES
	};
};

async function requireOwnedReminder(
	db: D1Database,
	projectId: string,
	reminderId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const reminder = await getReminderById(db, reminderId);
	if (!reminder || reminder.project_id !== projectId) {
		return { ok: false, error: 'Reminder not found' };
	}
	return { ok: true };
}

export const actions: Actions = {
	updateConfig: async ({ request, params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		const formData = await request.formData();
		const type = String(formData.get('type'));
		const enabled = formData.has('enabled') ? 1 : 0;
		const thresholdDays = parseInt(String(formData.get('threshold_days')), 10);
		const startedDefinition = String(formData.get('started_definition') || '');

		if (!type || isNaN(thresholdDays) || thresholdDays < 1) {
			return fail(400, { error: 'Invalid configuration' });
		}

		await updateReminderConfig(env.DB, project.id, type, {
			enabled,
			threshold_days: thresholdDays,
			started_definition: type === 'assigned_not_started' ? startedDefinition : null
		});

		// A disabled rule should not leave its reminders sitting in the inbox.
		if (enabled === 0) {
			await resolveRemindersByType(env.DB, project.id, type);
		}

		return { success: true };
	},

	snoozeReminder: async ({ request, params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));
		const days = parseInt(String(formData.get('days')), 10);

		if (isNaN(days) || days < 1 || days > MAX_SNOOZE_DAYS) {
			return fail(400, { error: 'Invalid snooze duration' });
		}

		const owned = await requireOwnedReminder(env.DB, project.id, reminderId);
		if (!owned.ok) return fail(404, { error: owned.error });

		const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
		await snoozeReminder(env.DB, reminderId, until);

		return { success: true, snoozedUntil: until.toISOString() };
	},

	dismissReminder: async ({ request, params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const owned = await requireOwnedReminder(env.DB, project.id, reminderId);
		if (!owned.ok) return fail(404, { error: owned.error });

		await dismissReminder(env.DB, reminderId);

		return { success: true, reminderId };
	},

	restoreReminder: async ({ request, params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const owned = await requireOwnedReminder(env.DB, project.id, reminderId);
		if (!owned.ok) return fail(404, { error: owned.error });

		await restoreReminder(env.DB, reminderId);

		return { success: true, reminderId };
	},

	scanNow: async ({ params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		try {
			const result = await scanProject(env.DB, project);
			return { success: true, result };
		} catch (scanError) {
			const message = scanError instanceof Error ? scanError.message : String(scanError);
			return fail(502, { error: `Scan failed: ${message}` });
		}
	}
};
