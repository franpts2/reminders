import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getSnoozedReminders, REMINDER_TYPES } from '$lib/db';
import { dismissForUser, restoreForUser } from '$lib/reminder-service';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		throw error(500, 'Database not configured');
	}

	const reminders = await getSnoozedReminders(env.DB, locals.user.id);

	return {
		reminders,
		reminderTypes: REMINDER_TYPES
	};
};

export const actions: Actions = {
	unsnooze: async ({ request, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const done = await restoreForUser(env.DB, locals.user.id, reminderId);
		if (!done) return fail(404, { error: 'Reminder not found' });

		return { success: true, reminderId };
	},

	dismiss: async ({ request, locals, platform }) => {
		if (!locals.user) throw redirect(302, '/');
		const env = (platform as App.Platform)?.env;
		if (!env?.DB) throw error(500, 'Database not configured');

		const formData = await request.formData();
		const reminderId = String(formData.get('reminderId'));

		const done = await dismissForUser(env.DB, locals.user.id, reminderId);
		if (!done) return fail(404, { error: 'Reminder not found' });

		return { success: true, reminderId };
	}
};
