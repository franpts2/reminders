import type { D1Database } from '@cloudflare/workers-types';
import { getUserByGithubId, createUser, updateUserAccessToken, type User } from './db';

export interface GitHubUser {
	id: number;
	login: string;
	email: string | null;
	avatar_url: string | null;
}

export interface GitHubTokens {
	access_token: string;
	token_type: string;
	scope: string;
}

const PLACEHOLDER_CLIENT_ID = 'your-github-oauth-app-client-id';

export function isPlaceholderClientId(clientId: string): boolean {
	return clientId.trim() === '' || clientId.trim() === PLACEHOLDER_CLIENT_ID;
}

export function getGitHubOAuthUrl(clientId: string, redirectUri: string, state: string): string {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'read:user',
		state
	});
	return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(
	clientId: string,
	clientSecret: string,
	redirectUri: string,
	code: string
): Promise<GitHubTokens> {
	const response = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
			code
		})
	});

	const data = (await response.json().catch(() => ({}))) as Partial<GitHubTokens> & {
		error?: string;
		error_description?: string;
	};

	if (!response.ok || data.error || !data.access_token) {
		throw new Error(`GitHub token exchange failed: ${describeTokenError(data, response.status)}`);
	}

	return data as GitHubTokens;
}

function describeTokenError(
	data: { error?: string; error_description?: string },
	status: number
): string {
	if (data.error_description) return data.error_description;

	switch (data.error) {
		case 'incorrect_client_credentials':
			return 'incorrect_client_credentials — GITHUB_CLIENT_SECRET does not match the OAuth app (regenerate the secret and restart the dev server)';
		case 'bad_verification_code':
			return 'bad_verification_code — the code was already used or expired; start sign-in again from /auth/github';
		case 'redirect_uri_mismatch':
			return 'redirect_uri_mismatch — the callback URL on the OAuth app must exactly match APP_URL + /auth/callback';
		case 'Not Found':
			return 'client_id not recognized — check GITHUB_CLIENT_ID matches the OAuth app';
		default:
			return data.error ?? `HTTP ${status}`;
	}
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
	const response = await fetch('https://api.github.com/user', {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'reminders',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});

	if (!response.ok) {
		throw new Error(`Failed to fetch GitHub user: ${response.status}`);
	}

	return (await response.json()) as GitHubUser;
}

export async function getOrCreateUserFromGitHub(
	db: D1Database,
	githubUser: GitHubUser,
	accessToken: string
): Promise<User> {
	let user = await getUserByGithubId(db, githubUser.id);
	if (user) {
		await updateUserAccessToken(db, githubUser.id, accessToken);
		user = await getUserByGithubId(db, githubUser.id);
		if (!user) throw new Error('User disappeared after update');
		return user;
	}

	return await createUser(db, {
		github_id: githubUser.id,
		github_login: githubUser.login,
		email: githubUser.email,
		avatar_url: githubUser.avatar_url,
		access_token: accessToken
	});
}

export async function encryptSession(userId: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));

	const key = await deriveKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);

	const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);

	return btoa(String.fromCharCode(...combined));
}

export async function decryptSession(token: string, secret: string): Promise<{ userId: string } | null> {
	try {
		const combined = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
		const iv = combined.slice(0, 12);
		const encrypted = combined.slice(12);

		const key = await deriveKey(secret);
		const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
		const payload = JSON.parse(new TextDecoder().decode(decrypted)) as {
			userId: string;
			exp: number;
		};

		if (payload.exp < Date.now()) return null;
		return { userId: payload.userId };
	} catch {
		return null;
	}
}

async function deriveKey(secret: string): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: encoder.encode('github-pm-reminders-session'),
			iterations: 100000,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}
