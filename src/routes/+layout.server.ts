import type { LayoutServerLoad } from './$types';
import { getProjectsByUser } from '$lib/db';

export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const user = locals.user;
	if (!user) {
		return { user: undefined, projects: [] };
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		return { user, projects: [] };
	}

	const projects = await getProjectsByUser(env.DB, user.id);

	return {
		user,
		projects: projects.map(({ id, name, owner, repo }) => ({ id, name, owner, repo }))
	};
};
