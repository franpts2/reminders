import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	exchangeGitHubCode,
	fetchGitHubIdentity,
	getOrCreateUserFromGitHub,
	encryptSession
} from '$lib/auth';

export const GET: RequestHandler = async ({ url, cookies, platform }) => {
	const env = (platform as App.Platform)?.env;
	const required = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'APP_URL', 'SESSION_SECRET'] as const;
	const missing = required.filter((key) => !env?.[key]);
	if (!env || missing.length > 0) {
		throw error(
			500,
			`Server not configured: missing ${missing.join(', ')}. For local development add them to .dev.vars, then restart the dev server.`
		);
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const storedState = cookies.get('oauth_state');

	if (!code || !state || state !== storedState) {
		throw error(400, 'Invalid OAuth state');
	}

	cookies.delete('oauth_state', { path: '/' });

	const tokens = await exchangeGitHubCode(
		env.GITHUB_CLIENT_ID,
		env.GITHUB_CLIENT_SECRET,
		`${env.APP_URL}/auth/callback`,
		code
	).catch((cause: unknown) => {
		throw error(500, cause instanceof Error ? cause.message : 'GitHub token exchange failed');
	});
	const identity = await fetchGitHubIdentity(tokens.access_token).catch((cause: unknown) => {
		throw error(500, cause instanceof Error ? cause.message : 'Failed to fetch GitHub user');
	});
	const oauthScopes = tokens.scope || identity.scopes || null;
	const user = await getOrCreateUserFromGitHub(
		env.DB,
		identity.user,
		tokens.access_token,
		oauthScopes
	).catch((cause: unknown) => {
		throw error(
			500,
			cause instanceof Error ? `Failed to save user: ${cause.message}` : 'Failed to save user'
		);
	});

	const sessionToken = await encryptSession(user.id, env.SESSION_SECRET);
	cookies.set('session', sessionToken, {
		path: '/',
		httpOnly: true,
		secure: env.APP_URL?.startsWith('https://') ?? true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7
	});

	const next = cookies.get('oauth_next');
	cookies.delete('oauth_next', { path: '/' });
	const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/inbox';

	throw redirect(302, destination);
};
