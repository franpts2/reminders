import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubOAuthUrl, isPlaceholderClientId } from '$lib/auth';

export const GET: RequestHandler = async ({ platform, cookies }) => {
	const env = (platform as App.Platform)?.env;
	if (!env?.GITHUB_CLIENT_ID || !env?.APP_URL) {
		throw error(
			500,
			'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and APP_URL (wrangler.toml for deploys, .dev.vars for local dev).'
		);
	}

	if (isPlaceholderClientId(env.GITHUB_CLIENT_ID)) {
		throw error(
			500,
			'GITHUB_CLIENT_ID is still the placeholder value, so GitHub will return a 404. Create an OAuth app at https://github.com/settings/developers and set the real Client ID (and callback URL) before signing in.'
		);
	}

	const state = crypto.randomUUID();
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: env.APP_URL?.startsWith('https://') ?? true,
		sameSite: 'lax',
		maxAge: 600
	});

	const redirectUri = `${env.APP_URL}/auth/callback`;
	const url = getGitHubOAuthUrl(env.GITHUB_CLIENT_ID, redirectUri, state);
	throw redirect(302, url);
};
