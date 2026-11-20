import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getProjectById,
	getReminderConfigsByProject,
	getOpenRemindersByProject,
	updateReminderConfig,
	updateReminderStatus,
	REMINDER_TYPES
} from '$lib/db';
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

	const configs = await getReminderConfigsByProject(env.DB, project.id);
	const reminders = await getOpenRemindersByProject(env.DB, project.id);

	return {
		project,
		configs,
		reminders,
		reminderTypeLabels: REMINDER_TYPES
	};
};

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

		return { success: true };
	},
	dismissReminder: async ({ request, params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));
		await updateReminderStatus(env.DB, reminderId, 'dismissed');

		return { success: true };
	},
	scanNow: async ({ params, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const project = await getProjectById(env.DB, params.id);
		if (!project || project.created_by_user_id !== locals.user.id) throw error(404);

		await scanProject(env.DB, project);
		return { success: true };
	}
};
