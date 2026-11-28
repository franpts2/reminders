/**
 * Resolution and validation for GitHub Projects v2 boards.
 *
 * Read-only: this module parses a board URL and reads its fields. It never
 * mutates GitHub, and the token needs the `read:project` scope.
 */

export type BoardOwnerType = 'organization' | 'user';

export interface BoardUrl {
	ownerType: BoardOwnerType;
	owner: string;
	number: number;
}

export interface BoardIteration {
	id: string;
	title: string;
	startDate: string;
	duration: number;
}

export interface BoardIterationField {
	id: string;
	name: string;
	duration: number;
	startDay: number;
	iterations: BoardIteration[];
	completedIterations: BoardIteration[];
}

export interface BoardStatusField {
	id: string;
	name: string;
	options: { id: string; name: string }[];
}

export interface ResolvedBoard {
	projectNodeId: string;
	title: string;
	ownerType: BoardOwnerType;
	owner: string;
	number: number;
	iterationFields: BoardIterationField[];
	statusFields: BoardStatusField[];
	iterationField: BoardIterationField | null;
	statusField: BoardStatusField | null;
	doneOptionName: string | null;
}

export type BoardErrorCode =
	| 'invalid_url'
	| 'not_found'
	| 'no_scope'
	| 'org_restricted'
	| 'no_iteration_field'
	| 'network'
	| 'unknown';

export class BoardError extends Error {
	constructor(
		readonly code: BoardErrorCode,
		message: string
	) {
		super(message);
		this.name = 'BoardError';
	}
}

export function isBoardMetricsEnabled(
	env: { BOARD_METRICS?: string } | null | undefined
): boolean {
	return env?.BOARD_METRICS === '1';
}

const INVALID_URL =
	'Paste a board URL like https://github.com/orgs/NIAEFEUP/projects/7 or https://github.com/users/<login>/projects/1.';

export function parseBoardUrl(value: string): BoardUrl {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new BoardError('invalid_url', INVALID_URL);
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new BoardError('invalid_url', INVALID_URL);
	}
	if (url.hostname !== 'github.com') {
		throw new BoardError('invalid_url', 'Board URLs must be on github.com.');
	}

	const org = /^\/orgs\/([^/]+)\/projects\/(\d+)(?:\/views\/\d+)?\/?$/.exec(url.pathname);
	if (org) {
		return { ownerType: 'organization', owner: org[1], number: Number(org[2]) };
	}

	const user = /^\/users\/([^/]+)\/projects\/(\d+)(?:\/views\/\d+)?\/?$/.exec(url.pathname);
	if (user) {
		return { ownerType: 'user', owner: user[1], number: Number(user[2]) };
	}

	throw new BoardError('invalid_url', INVALID_URL);
}

export interface GqlField {
	__typename?: string;
	id?: string;
	name?: string;
	configuration?: {
		duration?: number | null;
		startDay?: number | null;
		iterations?: BoardIteration[] | null;
		completedIterations?: BoardIteration[] | null;
	} | null;
	options?: { id: string; name: string }[] | null;
}

export interface BoardFieldSelection {
	iterationFields: BoardIterationField[];
	statusFields: BoardStatusField[];
	iterationField: BoardIterationField | null;
	statusField: BoardStatusField | null;
	doneOptionName: string | null;
}

/** Picks the fields the sync needs, tolerating boards with extras or none. */
export function pickBoardFields(fields: GqlField[]): BoardFieldSelection {
	const iterationFields: BoardIterationField[] = fields
		.filter((field) => field.__typename === 'ProjectV2IterationField' && field.id && field.name)
		.map((field) => ({
			id: field.id as string,
			name: field.name as string,
			duration: field.configuration?.duration ?? 0,
			startDay: field.configuration?.startDay ?? 0,
			iterations: field.configuration?.iterations ?? [],
			completedIterations: field.configuration?.completedIterations ?? []
		}));

	const statusFields: BoardStatusField[] = fields
		.filter(
			(field) => field.__typename === 'ProjectV2SingleSelectField' && field.id && field.name
		)
		.map((field) => ({
			id: field.id as string,
			name: field.name as string,
			options: field.options ?? []
		}));

	const hasDone = (field: BoardStatusField) =>
		field.options.some((option) => option.name.toLowerCase() === 'done');

	const statusField =
		statusFields.find((field) => field.name === 'Status') ??
		statusFields.find(hasDone) ??
		statusFields[0] ??
		null;

	const doneOptionName =
		statusField?.options.find((option) => option.name.toLowerCase() === 'done')?.name ?? null;

	return {
		iterationFields,
		statusFields,
		iterationField: iterationFields[0] ?? null,
		statusField,
		doneOptionName
	};
}

interface GqlProject {
	id: string;
	title: string;
	fields?: { nodes?: GqlField[] | null } | null;
}

interface GqlResponse {
	data?: {
		organization?: { projectV2?: GqlProject | null } | null;
		user?: { projectV2?: GqlProject | null } | null;
	} | null;
	errors?: { type?: string; message?: string }[];
}

const BOARD_FIELDS = `
	fragment BoardFields on ProjectV2 {
		id
		title
		fields(first: 50) {
			nodes {
				__typename
				id
				name
				... on ProjectV2IterationField {
					configuration {
						duration
						startDay
						iterations { id title startDate duration }
						completedIterations { id title startDate duration }
					}
				}
				... on ProjectV2SingleSelectField {
					options { id name }
				}
			}
		}
	}
`;

function resolveQuery(root: 'organization' | 'user'): string {
	return `
		query ResolveBoard($owner: String!, $number: Int!) {
			${root}(login: $owner) {
				projectV2(number: $number) { ...BoardFields }
			}
		}
		${BOARD_FIELDS}
	`;
}

const QUERIES = {
	organization: resolveQuery('organization'),
	user: resolveQuery('user')
};

function mapGraphQLErrors(errors: { type?: string; message?: string }[]): BoardError {
	const types = errors.map((error) => error.type ?? '').join(' ');
	const messages = errors.map((error) => error.message ?? '').join('; ');

	if (/INSUFFICIENT_SCOPES/i.test(types) || /read:project|insufficient scopes/i.test(messages)) {
		return new BoardError(
			'no_scope',
			'This GitHub token cannot read projects. Reconnect GitHub to grant board access.'
		);
	}

	if (
		/FORBIDDEN/i.test(types) ||
		/resource not accessible|not accessible by integration|must be a member/i.test(messages)
	) {
		return new BoardError(
			'org_restricted',
			'GitHub did not allow this app to read the board. An organisation owner may need to approve the OAuth app.'
		);
	}

	if (/NOT_FOUND/i.test(types) || /could not resolve to a ProjectV2/i.test(messages)) {
		return new BoardError(
			'not_found',
			'Board not found. Check the URL, and that your GitHub account can see it.'
		);
	}

	return new BoardError('unknown', `GitHub could not read the board: ${messages}`);
}

/**
 * Reads a board and its fields. Returns all iteration and single-select fields
 * so the caller can let the user choose; `iterationField` and `statusField`
 * are the defaults.
 */
export async function resolveBoard(
	accessToken: string,
	target: BoardUrl
): Promise<ResolvedBoard> {
	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			Authorization: `bearer ${accessToken}`,
			'Content-Type': 'application/json',
			'User-Agent': 'reminders',
			'X-GitHub-Api-Version': '2022-11-28'
		},
		body: JSON.stringify({
			query: QUERIES[target.ownerType],
			variables: { owner: target.owner, number: target.number }
		})
	});

	const payload = (await response.json().catch(() => null)) as GqlResponse | null;

	if (response.status === 401) {
		throw new BoardError(
			'no_scope',
			'GitHub rejected this token. Reconnect GitHub to grant board access.'
		);
	}
	if (!response.ok) {
		throw new BoardError('network', `GitHub returned ${response.status}. Try again in a moment.`);
	}
	if (payload?.errors?.length) {
		throw mapGraphQLErrors(payload.errors);
	}

	const project =
		target.ownerType === 'organization'
			? payload?.data?.organization?.projectV2
			: payload?.data?.user?.projectV2;

	if (!project) {
		throw new BoardError(
			'not_found',
			'Board not found. Check the URL, and that your GitHub account can see it.'
		);
	}

	const selection = pickBoardFields(project.fields?.nodes ?? []);

	return {
		projectNodeId: project.id,
		title: project.title,
		ownerType: target.ownerType,
		owner: target.owner,
		number: target.number,
		...selection
	};
}
