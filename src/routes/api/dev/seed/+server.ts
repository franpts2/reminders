import { dev } from '$app/environment';
import { error, json } from '@sveltejs/kit';
import { listLocalUsers, resetDemoData, seedDemoData } from '$lib/dev/seed';
import type { RequestHandler } from './$types';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function isLocalhost(value: string | undefined): boolean {
	try {
		return LOCAL_HOSTS.includes(new URL(value ?? '').hostname);
	} catch {
		return false;
	}
}

/**
 * Seeds or clears the fictional demo data. Only exists while `vite dev` is
 * running against a localhost APP_URL, so it is not reachable in production.
 */
export const POST: RequestHandler = async ({ url, platform }) => {
	const env = (platform as App.Platform)?.env;

	if (!dev || !isLocalhost(env?.APP_URL)) {
		throw error(404, 'Not found');
	}

	if (!env?.DB) {
		throw error(500, 'Database not configured');
	}

	if (url.searchParams.get('reset') === '1') {
		const projects = await resetDemoData(env.DB);
		return json({ reset: true, projects });
	}

	const users = await listLocalUsers(env.DB);
	if (users.length === 0) {
		throw error(
			400,
			`No local user yet. Sign in at ${env.APP_URL}, then run the seed again.`
		);
	}

	const login = url.searchParams.get('login');
	const user = login
		? users.find((candidate) => candidate.github_login.toLowerCase() === login.toLowerCase())
		: users[0];

	if (!user) {
		throw error(
			400,
			`No local user named ${login}. Known users: ${users.map((candidate) => candidate.github_login).join(', ')}`
		);
	}

	try {
		return json(await seedDemoData(env.DB, user));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw error(500, `Seed failed: ${message}`);
	}
};
