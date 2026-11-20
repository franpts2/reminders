import type { LayoutServerLoad } from './$types';
import { getProjectsByUser, getSnoozedReminderCount, getUnreadReminderCount } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) {
		return { user: undefined, projects: [], unreadCount: 0, snoozedCount: 0 };
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		return { user, projects: [], unreadCount: 0, snoozedCount: 0 };
	}

	const [projects, unreadCount, snoozedCount] = await Promise.all([
		getProjectsByUser(env.DB, user.id),
		getUnreadReminderCount(env.DB, user.id),
		getSnoozedReminderCount(env.DB, user.id)
	]);

	return {
		user,
		projects: projects.map(({ id, name, owner, repo }) => ({ id, name, owner, repo })),
		unreadCount,
		snoozedCount
	};
};
