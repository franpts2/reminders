import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getInboxReminders,
	getLatestScanForUser,
	getSnoozedReminderCount,
	REMINDER_TYPES
} from '$lib/db';
import { dismissForUser, restoreForUser, snoozeForUser, MAX_SNOOZE_DAYS } from '$lib/reminder-service';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		throw error(500, 'Database not configured');
	}

	const [reminders, latestScan, snoozedCount] = await Promise.all([
		getInboxReminders(env.DB, locals.user.id),
		getLatestScanForUser(env.DB, locals.user.id),
		getSnoozedReminderCount(env.DB, locals.user.id)
	]);

	return {
		reminders,
		latestScan,
		snoozedCount,
		reminderTypes: REMINDER_TYPES
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
	}
};
