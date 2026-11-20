import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { parseRepoUrl, validateRepoAccess } from '$lib/github';
import { createProject, ensureDefaultReminderConfigs } from '$lib/db';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, locals, platform }) => {
		if (!locals.user) {
			throw redirect(302, '/');
		}

		const env = (platform as App.Platform)?.env;
		if (!env?.DB) {
			throw error(500, 'Database not configured');
		}

		const formData = await request.formData();
		const repoUrl = String(formData.get('repoUrl') || '').trim();
		const name = String(formData.get('name') || '').trim();

		if (!repoUrl || !name) {
			return fail(400, { error: 'Repo URL and project name are required' });
		}

		const parsed = parseRepoUrl(repoUrl);
		if (!parsed) {
			return fail(400, { error: 'Invalid GitHub repo URL' });
		}

		const hasAccess = await validateRepoAccess(parsed.owner, parsed.repo, locals.user.access_token);
		if (!hasAccess) {
			return fail(400, { error: 'Could not access repo. Make sure it is public and try again.' });
		}

		const project = await createProject(env.DB, {
			name,
			owner: parsed.owner,
			repo: parsed.repo,
			created_by_user_id: locals.user.id
		});

		await ensureDefaultReminderConfigs(env.DB, project.id);

		throw redirect(302, `/projects/${project.id}`);
	}
};
