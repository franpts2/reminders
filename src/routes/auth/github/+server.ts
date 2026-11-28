import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitHubOAuthUrl, isPlaceholderClientId } from '$lib/auth';
import { safeRedirectPath } from '$lib/redirects';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
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
	const secure = env.APP_URL?.startsWith('https://') ?? true;
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax',
		maxAge: 600
	});

	// Board access is an extra consent, never part of normal sign-in. Keep the
	// destination so the user lands back on the page that asked for it.
	const next = safeRedirectPath(url.searchParams.get('next'), ['/projects']);
	if (next) {
		cookies.set('oauth_next', next, {
			path: '/',
			httpOnly: true,
			secure,
			sameSite: 'lax',
			maxAge: 600
		});
	}

	const forBoard = url.searchParams.get('for') === 'board';
	const scopes = forBoard ? 'read:user read:project' : 'read:user';
	const redirectUri = `${env.APP_URL}/auth/callback`;
	const authorizeUrl = getGitHubOAuthUrl(env.GITHUB_CLIENT_ID, redirectUri, state, scopes);
	throw redirect(302, authorizeUrl);
};
