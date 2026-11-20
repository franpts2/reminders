import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getProjectById,
	getActiveRemindersByProject,
	getLatestScanByProject,
	REMINDER_TYPES
} from '$lib/db';
import { dismissForUser, restoreForUser, snoozeForUser, MAX_SNOOZE_DAYS } from '$lib/reminder-service';
import { scanProject } from '$lib/scanner';

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

	const [reminders, latestScan] = await Promise.all([
		getActiveRemindersByProject(env.DB, project.id),
		getLatestScanByProject(env.DB, project.id)
	]);

	return {
		project,
		reminders,
		latestScan,
		reminderTypeLabels: REMINDER_TYPES
	};
};

export const actions: Actions = {
	snoozeReminder: async ({ request, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));
		const days = parseInt(String(formData.get('days')), 10);

		if (isNaN(days) || days < 1 || days > MAX_SNOOZE_DAYS) {
			return fail(400, { error: 'Invalid snooze duration' });
		}

		const done = await snoozeForUser(env.DB, locals.user.id, reminderId, days);
		if (!done) return fail(404, { error: 'Reminder not found' });

		return { success: true };
	},

	dismissReminder: async ({ request, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const done = await dismissForUser(env.DB, locals.user.id, reminderId);
		if (!done) return fail(404, { error: 'Reminder not found' });

		return { success: true, reminderId };
	},

	restoreReminder: async ({ request, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const done = await restoreForUser(env.DB, locals.user.id, reminderId);
		if (!done) return fail(404, { error: 'Reminder not found' });

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
