#!/usr/bin/env node
/**
 * Seeds the local D1 database with fictional, screenshot-friendly data.
 *
 * The work happens in the app itself, through the dev-only route
 * POST /api/dev/seed, so the seed uses the same db helpers and message rules
 * as a real scan. This script just calls that route.
 *
 * Usage (with `npm run dev` running):
 *   npm run db:seed:local               # seed / refresh
 *   npm run db:seed:local -- --reset    # remove only the seeded data
 *   npm run db:seed:local -- --login=franpts2
 *
 * Sign in with GitHub once at APP_URL before the first seed, since the data
 * belongs to an existing local user.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const hit = args.find((arg) => arg.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : undefined;
};

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

if (hasFlag('help')) {
	console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
	process.exit(0);
}

function loadDevVars() {
	/** @type {Record<string, string>} */
	const values = {};
	let raw;
	try {
		raw = readFileSync(new URL('.dev.vars', `file://${process.cwd()}/`), 'utf8');
	} catch {
		fail('Missing .dev.vars. Copy .dev.vars.example and fill it in first.');
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
const appUrl = (vars.APP_URL ?? '').replace(/\/+$/, '');

let host;
try {
	host = new URL(appUrl).hostname;
} catch {
	fail(`APP_URL in .dev.vars is not a URL: ${appUrl || '(empty)'}`);
}
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
	fail(
		`APP_URL is ${appUrl}. This script only seeds the local database, so it needs a localhost APP_URL.`
	);
}

const params = new URLSearchParams();
if (hasFlag('reset')) params.set('reset', '1');
const login = option('login');
if (login) params.set('login', login);

const endpoint = `${appUrl}/api/dev/seed${params.size > 0 ? `?${params}` : ''}`;

let response;
try {
	response = await fetch(endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{}'
	});
} catch {
	fail(`Could not reach ${appUrl}. Is \`npm run dev\` running?`);
}

const payload = await response.json().catch(() => null);

if (!response.ok) {
	fail(payload?.message ?? `Seed failed with HTTP ${response.status}.`);
}

if (payload?.reset) {
	console.log(`✓ Removed ${payload.projects} seeded projects and their reminders.`);
	console.log('  Real projects in the local database were left alone.');
	process.exit(0);
}

console.log(`✓ Seeded ${payload.projects.length} projects for @${payload.login}`);
console.log(`  ${payload.open} open reminders, ${payload.snoozed} snoozed, ${payload.closed} closed`);
for (const project of payload.projects) {
	console.log(
		`  · ${project.name.padEnd(15)} ${project.owner}/${project.repo} (${project.open} open)`
	);
}
console.log(`\n  Open ${appUrl}/inbox`);
console.log('  Re-run to reset the demo data, or use --reset to remove it.');
