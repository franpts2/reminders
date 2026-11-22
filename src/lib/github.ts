export interface GitHubIssue {
	number: number;
	title: string;
	state: string;
	created_at: string;
	updated_at: string;
	assignee: { login: string } | null;
	assignees: { login: string }[];
	pull_request?: { url: string };
	html_url: string;
	node_id: string;
}

export interface GitHubPullRequest {
	number: number;
	title: string;
	state: string;
	created_at: string;
	updated_at: string;
	draft: boolean;
	assignee: { login: string } | null;
	assignees: { login: string }[];
	html_url: string;
	node_id: string;
	user: { login: string };
	head: { sha: string; ref: string };
}

export interface GitHubReview {
	id: number;
	state: string;
	submitted_at: string | null;
	commit_id: string;
	user: { login: string };
}

export interface GitHubTimelineEvent {
	event: string;
	source?: {
		type?: string;
		issue?: {
			number: number;
			state?: string;
			pull_request?: { url: string };
		};
	};
}

async function githubFetch<T>(url: string, accessToken: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GitHub API error ${response.status}: ${text}`);
	}

	return (await response.json()) as T;
}

export async function fetchRepoIssues(
	owner: string,
	repo: string,
	accessToken: string
): Promise<GitHubIssue[]> {
	return githubFetch<GitHubIssue[]>(
		`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`,
		accessToken
	);
}

export async function fetchRepoPullRequests(
	owner: string,
	repo: string,
	accessToken: string
): Promise<GitHubPullRequest[]> {
	return githubFetch<GitHubPullRequest[]>(
		`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
		accessToken
	);
}

const REVIEW_PAGE_SIZE = 100;
const REVIEW_MAX_PAGES = 5;

export async function fetchPullRequestReviews(
	owner: string,
	repo: string,
	prNumber: number,
	accessToken: string
): Promise<GitHubReview[]> {
	const reviews: GitHubReview[] = [];

	for (let page = 1; page <= REVIEW_MAX_PAGES; page++) {
		const pageReviews = await githubFetch<GitHubReview[]>(
			`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=${REVIEW_PAGE_SIZE}&page=${page}`,
			accessToken
		);

		reviews.push(...pageReviews);
		if (pageReviews.length < REVIEW_PAGE_SIZE) break;
	}

	return reviews;
}

export type PullRequestMergeability = 'conflicting' | 'clean' | 'unknown';

/**
 * Mergeability is only on the single-PR endpoint, and GitHub computes it in
 * the background, so the first read after a push can still be unknown.
 * `dirty` is the documented GraphQL value for a merge conflict; the REST
 * field returns the same string lowercased.
 */
export async function fetchPullRequestMergeability(
	owner: string,
	repo: string,
	prNumber: number,
	accessToken: string
): Promise<PullRequestMergeability> {
	try {
		const pr = await githubFetch<{
			mergeable: boolean | null;
			mergeable_state: string | null;
		}>(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, accessToken);

		if (pr.mergeable_state === 'dirty') return 'conflicting';
		if (pr.mergeable === true) return 'clean';
		if (pr.mergeable === false) return 'conflicting';

		return 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * The date of a commit, used as the clock for "waiting on a re-review".
 * Returns null when the commit is not readable (for example a deleted fork),
 * so callers can fall back to the last review instead of guessing.
 */
export async function fetchCommitDate(
	owner: string,
	repo: string,
	sha: string,
	accessToken: string
): Promise<string | null> {
	try {
		const commit = await githubFetch<{
			commit: {
				committer: { date: string } | null;
				author: { date: string } | null;
			};
		}>(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, accessToken);

		return commit.commit.committer?.date ?? commit.commit.author?.date ?? null;
	} catch {
		return null;
	}
}

const TIMELINE_PAGE_SIZE = 100;
const TIMELINE_MAX_PAGES = 5;

/**
 * Pull requests that reference an issue. REST does not expose linked pull
 * requests on the issue itself, so they have to be read from the timeline.
 * A pull request linked only through the UI produces a `connected` event
 * that carries no subject, so cross-references are the usable signal.
 */
export async function fetchLinkedPullRequestNumbers(
	owner: string,
	repo: string,
	issueNumber: number,
	accessToken: string
): Promise<number[]> {
	const numbers = new Set<number>();

	for (let page = 1; page <= TIMELINE_MAX_PAGES; page++) {
		const events = await githubFetch<GitHubTimelineEvent[]>(
			`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=${TIMELINE_PAGE_SIZE}&page=${page}`,
			accessToken
		);

		for (const event of events) {
			if (event.event !== 'cross-referenced') continue;

			const source = event.source?.issue;
			if (!source?.pull_request) continue;

			numbers.add(source.number);
		}

		if (events.length < TIMELINE_PAGE_SIZE) break;
	}

	return [...numbers];
}

export async function validateRepoAccess(
	owner: string,
	repo: string,
	accessToken: string
): Promise<boolean> {
	try {
		await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, accessToken);
		return true;
	} catch {
		return false;
	}
}

export interface ProjectItem {
	id: string;
	content_type: 'Issue' | 'PullRequest';
	content_node_id: string;
	field_values: {
		nodes: Array<{
			field: {
				id: string;
				name: string;
				dataType: string;
			};
			option?: {
				id: string;
				name: string;
			};
			date?: string;
			text?: string;
		}>;
	};
	project: {
		id: string;
		title: string;
	};
}

export async function fetchProjectItemsForRepo(
	owner: string,
	repo: string,
	accessToken: string
): Promise<Map<number, { columnName: string; updatedAt: string }>> {
	// This is a simplified placeholder. Full GitHub Projects v2 support requires GraphQL.
	// For the prototype we return an empty map and rely on issue/PR data.
	return new Map();
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split('/').filter(Boolean);
		if (parts.length < 2) return null;
		return { owner: parts[0], repo: parts[1] };
	} catch {
		return null;
	}
}
