#!/usr/bin/env node
/**
 * Probes a GitHub Projects v2 board and prints what the sprint metrics sync
 * depends on: iteration fields, per-iteration item counts, archived and
 * redacted items, items with no iteration or Status, and the repositories the
 * board spans.
 *
 * Usage:
 *   BOARD_URL=https://github.com/orgs/NIAEFEUP/projects/7 \
 *   GITHUB_TOKEN=ghp_... node scripts/spike-board.mjs
 *
 *   node scripts/spike-board.mjs --url=... --token=...
 *   node scripts/spike-board.mjs --fixture[=<path>]
 *
 * BOARD_URL and GITHUB_TOKEN fall back to .dev.vars. The token needs
 * read:project, plus repo read access for private items.
 *
 * --fixture writes a redacted copy of the board to docs/fixtures/board-page.json
 * (or the given path). Node ids, iteration ids, option ids, titles, logins,
 * repository names and labels are replaced, so the file is safe to commit.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const inline = args.find((arg) => arg.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);

	const index = args.indexOf(`--${name}`);
	if (index === -1) return undefined;

	// A bare flag keeps its empty value; otherwise consume the next argument.
	const next = args[index + 1];
	return next && !next.startsWith('-') ? next : '';
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
	try {
		const raw = readFileSync(new URL('.dev.vars', `file://${process.cwd()}/`), 'utf8');
		const values = {};
		for (const line of raw.split(/\r?\n/)) {
			if (/^\s*#/.test(line)) continue;
			const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
			if (!match) continue;
			values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
		}
		return values;
	} catch {
		return {};
	}
}

const devVars = loadDevVars();
const boardUrl = option('url') || process.env.BOARD_URL || devVars.BOARD_URL;
const token = option('token') || process.env.GITHUB_TOKEN || devVars.GITHUB_TOKEN;

if (!boardUrl) fail('Missing board URL. Pass --url or set BOARD_URL.');
if (!token) fail('Missing token. Pass --token or set GITHUB_TOKEN.');

function parseBoardUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		fail(`Not a URL: ${value}`);
	}
	if (url.hostname !== 'github.com') fail('Board URL must be on github.com.');

	const org = /^\/orgs\/([^/]+)\/projects\/(\d+)\/?$/.exec(url.pathname);
	const user = /^\/users\/([^/]+)\/projects\/(\d+)\/?$/.exec(url.pathname);
	if (org) return { ownerType: 'organization', owner: org[1], number: Number(org[2]) };
	if (user) return { ownerType: 'user', owner: user[1], number: Number(user[2]) };

	fail('Expected https://github.com/orgs/<org>/projects/<n> or /users/<login>/projects/<n>.');
}

const { ownerType, owner, number } = parseBoardUrl(boardUrl);

const PROJECT_FIELDS = `
	fragment ProjectFields on ProjectV2 {
		id
		title
		fields(first: 50) {
			nodes {
				__typename
				... on ProjectV2IterationField {
					id
					name
					configuration {
						duration
						startDay
						iterations { id title startDate duration }
						completedIterations { id title startDate duration }
					}
				}
				... on ProjectV2SingleSelectField {
					id
					name
					options { id name }
				}
				... on ProjectV2FieldCommon {
					id
					name
				}
			}
		}
	}
`;

const ITEM_FRAGMENT = `
	fragment BoardItem on ProjectV2Item {
		id
		isArchived
		type
		content {
			__typename
			... on Issue {
				number
				title
				state
				stateReason
				createdAt
				closedAt
				repository { nameWithOwner }
				assignees(first: 5) { nodes { login } }
				labels(first: 10) { nodes { name } }
			}
			... on PullRequest {
				number
				title
				state
				createdAt
				closedAt
				mergedAt
				repository { nameWithOwner }
				author { login }
				assignees(first: 5) { nodes { login } }
				labels(first: 10) { nodes { name } }
			}
			... on DraftIssue {
				title
				createdAt
			}
		}
		fieldValues(first: 50) {
			pageInfo { hasNextPage }
			nodes {
				__typename
				... on ProjectV2ItemFieldIterationValue {
					iterationId
					title
					startDate
					duration
					createdAt
					field { ... on ProjectV2FieldCommon { id name } }
				}
				... on ProjectV2ItemFieldSingleSelectValue {
					name
					optionId
					field { ... on ProjectV2FieldCommon { id name } }
				}
				... on ProjectV2ItemFieldNumberValue {
					number
					field { ... on ProjectV2FieldCommon { id name } }
				}
			}
		}
	}
`;

function boardQuery(root) {
	return `
		query BoardProbe($owner: String!, $number: Int!, $cursor: String) {
			${root}(login: $owner) {
				projectV2(number: $number) {
					...ProjectFields
					items(first: 100, after: $cursor, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
						pageInfo { hasNextPage endCursor }
						nodes { ...BoardItem }
					}
				}
			}
			rateLimit { limit cost remaining resetAt }
		}
		${PROJECT_FIELDS}
		${ITEM_FRAGMENT}
	`;
}

const QUERY = boardQuery(ownerType === 'organization' ? 'organization' : 'user');
const ROOT_KEY = ownerType === 'organization' ? 'organization' : 'user';

async function gql(query, variables) {
	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			Authorization: `bearer ${token}`,
			'Content-Type': 'application/json',
			'User-Agent': 'reminders-board-spike'
		},
		body: JSON.stringify({ query, variables })
	});

	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		fail(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
	}
	if (payload?.errors?.length) {
		fail(`GitHub GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
	}
	if (!payload?.data) fail('GitHub returned no data.');
	return payload.data;
}

async function fetchBoard() {
	let cursor = null;
	let project = null;
	let rateLimit = null;
	const items = [];
	let nestedFieldPages = 0;

	for (let page = 0; page < 100; page++) {
		const data = await gql(QUERY, { owner, number, cursor });
		const root = data[ROOT_KEY];
		if (!root?.projectV2) {
			fail(
				`No project #${number} found for ${ownerType} ${owner}. Check the URL and that the token can read the board.`
			);
		}

		project = root.projectV2;
		rateLimit = data.rateLimit;
		items.push(...(project.items.nodes ?? []));

		for (const item of project.items.nodes ?? []) {
			if (item.fieldValues?.pageInfo?.hasNextPage) nestedFieldPages++;
		}

		if (!project.items.pageInfo.hasNextPage) break;
		cursor = project.items.pageInfo.endCursor;
	}

	project.items = { nodes: items, pageInfo: { hasNextPage: false, endCursor: null } };
	return { project, rateLimit, nestedFieldPages };
}

function fieldValue(item, fieldName) {
	return (item.fieldValues?.nodes ?? []).find(
		(value) => value.field?.name === fieldName && value.__typename !== 'ProjectV2ItemFieldNumberValue'
	);
}

function iterationValue(item, iterationFieldName) {
	return (item.fieldValues?.nodes ?? []).find(
		(value) =>
			value.__typename === 'ProjectV2ItemFieldIterationValue' &&
			value.field?.name === iterationFieldName
	);
}

function isDone(item, statusFieldName, doneOptionName) {
	const status = fieldValue(item, statusFieldName)?.name;
	if (doneOptionName && status === doneOptionName) return true;

	const content = item.content;
	if (!content) return false;
	if (content.__typename === 'PullRequest') return Boolean(content.mergedAt);
	if (content.__typename === 'Issue') {
		return content.state === 'CLOSED' && content.stateReason !== 'NOT_PLANNED';
	}
	return false;
}

function redact(project) {
	const clone = structuredClone(project);
	const ids = new Map();
	let idIndex = 0;
	const redactId = (id) => {
		if (!id) return id;
		if (!ids.has(id)) ids.set(id, `example-id-${++idIndex}`);
		return ids.get(id);
	};

	clone.id = redactId(clone.id);
	clone.title = 'Example board';

	const iterationTitles = new Map();
	let iterationIndex = 0;
	for (const field of clone.fields.nodes) {
		field.id = redactId(field.id);
		for (const option of field.options ?? []) option.id = redactId(option.id);

		const iterations = [
			...(field.configuration?.iterations ?? []),
			...(field.configuration?.completedIterations ?? [])
		];
		for (const iteration of iterations) {
			if (!iterationTitles.has(iteration.id)) {
				iterationTitles.set(iteration.id, `Iteration ${++iterationIndex}`);
			}
			iteration.title = iterationTitles.get(iteration.id);
			iteration.id = redactId(iteration.id);
		}
	}

	let itemIndex = 0;
	for (const item of clone.items.nodes) {
		itemIndex++;
		item.id = redactId(item.id);
		const content = item.content;
		if (content) {
			if (content.title) content.title = `Example ${item.type.toLowerCase()} ${itemIndex}`;
			if (content.repository) content.repository.nameWithOwner = 'example/repo';
			if (content.author) content.author.login = 'example-user';
			if (content.assignees?.nodes) {
				content.assignees.nodes = content.assignees.nodes.map(() => ({ login: 'example-user' }));
			}
			if (content.labels?.nodes) {
				content.labels.nodes = content.labels.nodes.map((_, index) => ({ name: `label-${index + 1}` }));
			}
		}
		for (const value of item.fieldValues?.nodes ?? []) {
			if (value.__typename === 'ProjectV2ItemFieldIterationValue' && iterationTitles.has(value.iterationId)) {
				value.title = iterationTitles.get(value.iterationId);
			}
			if (value.iterationId) value.iterationId = redactId(value.iterationId);
			if (value.optionId) value.optionId = redactId(value.optionId);
			if (value.field?.id) value.field.id = redactId(value.field.id);
		}
	}

	return clone;
}

function summarise({ project, rateLimit, nestedFieldPages }) {
	const iterationFields = project.fields.nodes.filter(
		(field) => field.__typename === 'ProjectV2IterationField'
	);
	const statusField =
		project.fields.nodes.find(
			(field) => field.__typename === 'ProjectV2SingleSelectField' && field.name === 'Status'
		) ??
		project.fields.nodes.find(
			(field) =>
				field.__typename === 'ProjectV2SingleSelectField' &&
				field.options?.some((option) => option.name === 'Done')
		);

	if (iterationFields.length === 0) {
		console.log('! No iteration field on this board.');
	} else if (iterationFields.length > 1) {
		console.log(`! ${iterationFields.length} iteration fields; the sync must pick one.`);
	}
	if (!statusField) console.log('! No Status single-select field on this board.');

	const iterationField = iterationFields[0];
	const statusFieldName = statusField?.name ?? 'Status';
	const doneOptionName =
		statusField?.options?.find((option) => option.name.toLowerCase() === 'done')?.name ?? null;

	const iterations = iterationField
		? [...iterationField.configuration.iterations, ...iterationField.configuration.completedIterations]
		: [];
	const counts = new Map(iterations.map((iteration) => [iteration.id, { total: 0, done: 0 }]));
	let noIteration = 0;
	let unknownIteration = 0;
	let noStatus = 0;
	let archived = 0;
	let redacted = 0;
	const repos = new Set();

	for (const item of project.items.nodes) {
		if (item.isArchived) archived++;
		if (!item.content || item.type === 'REDACTED') redacted++;
		if (item.content?.repository?.nameWithOwner) repos.add(item.content.repository.nameWithOwner);

		const iteration = iterationField ? iterationValue(item, iterationField.name) : undefined;
		if (!iteration) {
			noIteration++;
		} else {
			const count = counts.get(iteration.iterationId);
			if (count) {
				count.total++;
				if (isDone(item, statusFieldName, doneOptionName)) count.done++;
			} else {
				unknownIteration++;
			}
		}

		if (statusField && !fieldValue(item, statusFieldName)) noStatus++;
	}

	console.log('');
	console.log(`Board:      ${project.title} (${project.id})`);
	console.log(`Source:     ${ownerType}/${owner}/projects/${number}`);
	console.log(
		`Fields:     ${
			iterationField ? `iteration "${iterationField.name}" (${iterationField.id})` : 'no iteration field'
		}`
	);
	console.log(
		`Status:     ${
			statusField
				? `"${statusField.name}" (${statusField.id}), done option: ${doneOptionName ?? 'not detected'}`
				: 'not found'
		}`
	);
	console.log('');
	console.log(`Iterations: ${iterations.length}`);
	for (const iteration of iterations) {
		const count = counts.get(iteration.id) ?? { total: 0, done: 0 };
		console.log(
			`  ${iteration.startDate} +${iteration.duration}d  ${count.total} items, ${count.done} done  ${iteration.title}`
		);
	}
	console.log('');
	console.log(`Items:      ${project.items.nodes.length} (${archived} archived, ${redacted} redacted)`);
	console.log(`No iteration: ${noIteration}`);
	if (unknownIteration > 0) {
		console.log(
			`! ${unknownIteration} items reference an iteration missing from the field config (deleted?).`
		);
	}
	console.log(`No Status:    ${noStatus}`);
	console.log(`Repos:        ${repos.size}${repos.size ? ` (${[...repos].join(', ')})` : ''}`);
	if (nestedFieldPages > 0) {
		console.log(`! ${nestedFieldPages} items have more than 50 field values; paginate them.`);
	}
	if (rateLimit) {
		console.log(
			`Rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining, resets ${rateLimit.resetAt}`
		);
		if (rateLimit.remaining < 100) console.log('! Rate limit is low; rerun later.');
	}
	console.log('');
}

function writeFixture(project) {
	const path = option('fixture') || 'docs/fixtures/board-page.json';
	const payload = {
		_meta: {
			redacted: true,
			capturedAt: new Date().toISOString(),
			source: 'example/board',
			note: 'Redacted board page for offline mapper tests. No ids, titles, logins or repository names.'
		},
		data: {
			[ROOT_KEY]: { projectV2: redact(project) },
			rateLimit: null
		}
	};

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
	console.log(`Wrote redacted fixture: ${path}`);
}

const result = await fetchBoard();
summarise(result);
if (option('fixture') !== undefined) writeFixture(result.project);
