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
}

export interface GitHubReview {
	id: number;
	state: string;
	submitted_at: string | null;
	user: { login: string };
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

export async function fetchPullRequestReviews(
	owner: string,
	repo: string,
	prNumber: number,
	accessToken: string
): Promise<GitHubReview[]> {
	return githubFetch<GitHubReview[]>(
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
		accessToken
	);
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
