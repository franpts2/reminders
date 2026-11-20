#!/usr/bin/env node
/**
 * Checks that GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .dev.vars are a
 * matching pair, without starting the app or consuming a real OAuth code.
 *
 * It sends a deliberately invalid code to GitHub's token endpoint. GitHub
 * validates the client credentials first, so:
 *   - "bad_verification_code"        -> credentials are valid, code was fake
 *   - "incorrect_client_credentials" -> the secret does not belong to that ID
 *   - "redirect_uri_mismatch"        -> credentials valid, callback URL differs
 *
 * The secret is never printed. Run with: npm run check:oauth
 */
import { readFileSync } from 'node:fs';

function loadDevVars(path = '.dev.vars') {
	/** @type {Record<string, string>} */
	const values = {};
	let raw;
	try {
		raw = readFileSync(new URL(path, `file://${process.cwd()}/`), 'utf8');
	} catch {
		return values;
	}
	for (const line of raw.split(/\r?\n/)) {
		if (/^\s*#/.test(line)) continue;
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;
		values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
	}
	return values;
}

const vars = loadDevVars();
const clientId = vars.GITHUB_CLIENT_ID;
const clientSecret = vars.GITHUB_CLIENT_SECRET;
const appUrl = vars.APP_URL ?? 'http://localhost:5173';

const missing = [
	['GITHUB_CLIENT_ID', clientId],
	['GITHUB_CLIENT_SECRET', clientSecret]
]
	.filter(([, value]) => !value)
	.map(([key]) => key);

if (missing.length > 0) {
	console.error(`✗ Missing in .dev.vars: ${missing.join(', ')}`);
	process.exit(1);
}

console.log(`Client ID: ${clientId}`);
console.log(
	`Secret:    ${clientSecret.length} chars, ${/^[0-9a-f]{40}$/.test(clientSecret) ? 'looks like a GitHub secret' : 'unusual format'}`
);

if (/your-|placeholder|xxxx/i.test(clientId) || /your-|placeholder|xxxx/i.test(clientSecret)) {
	console.error('✗ .dev.vars still contains a placeholder value.');
	process.exit(1);
}

const appResponse = await fetch(`https://api.github.com/applications/${clientId}`, {
	headers: {
		Accept: 'application/vnd.github+json',
		Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
		'User-Agent': 'github-pm-reminders-check'
	}
});

if (appResponse.ok) {
	/** @type {{ name?: string, callback_urls?: string[] }} */
	const app = await appResponse.json();
	console.log(`App:       ${app.name ?? '(no name)'}`);
	console.log(`Callbacks: ${(app.callback_urls ?? []).join(', ') || '(none)'}`);
} else {
	console.log('App:       not resolvable from this client ID + secret');
}

const response = await fetch('https://github.com/login/oauth/access_token', {
	method: 'POST',
	headers: {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded'
	},
	body: new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		redirect_uri: `${appUrl}/auth/callback`,
		code: '0'.repeat(40)
	})
});

/** @type {{ error?: string, error_description?: string }} */
const data = await response.json().catch(() => ({}));

switch (data.error) {
	case 'bad_verification_code':
		console.log('\n✓ Credentials are valid (GitHub rejected only the fake code).');
		console.log('  Restart `npm run dev`, then sign in from /auth/github.');
		process.exit(0);
	case 'redirect_uri_mismatch':
		console.log('\n~ Credentials are valid, but the callback URL does not match.');
		console.log(`  Register ${appUrl}/auth/callback on the OAuth app.`);
		process.exit(1);
	case 'incorrect_client_credentials':
		console.log('\n✗ The secret does not belong to this client ID (or the app no longer exists).');
		console.log('  0. Verify the app still exists and note its Client ID here:');
		console.log('     https://github.com/settings/developers');
		console.log('  1. Open the app page and check the name GitHub shows for it:');
		console.log(
			`     https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(`${appUrl}/auth/callback`)}&scope=read:user`
		);
		console.log('  2. On that same app: Client secrets -> Generate a new client secret.');
		console.log('  3. Paste the full value into GITHUB_CLIENT_SECRET (no quotes, no spaces).');
		console.log('  4. Re-run `npm run check:oauth`, then restart `npm run dev`.');
		process.exit(1);
	default:
		console.log(`\n? Unexpected response from GitHub: ${data.error ?? 'no error field'}`);
		if (data.error_description) console.log(`  ${data.error_description}`);
		process.exit(1);
}
