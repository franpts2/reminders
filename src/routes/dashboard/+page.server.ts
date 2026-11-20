import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProjectsByUser, getOpenRemindersByProject } from '$lib/db';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		throw error(500, 'Database not configured');
	}

	const projects = await getProjectsByUser(env.DB, locals.user.id);
	const projectsWithReminders = await Promise.all(
		projects.map(async (project) => {
			const reminders = await getOpenRemindersByProject(env.DB, project.id);
			return { ...project, reminders };
		})
	);

	return {
		user: locals.user,
		projects: projectsWithReminders
	};
};
