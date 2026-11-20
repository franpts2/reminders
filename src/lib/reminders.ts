import type { ReminderConfig } from './db';
import type { GitHubIssue, GitHubPullRequest, GitHubReview } from './github';

export interface ReminderCandidate {
	type: string;
	githubItemNumber: number;
	githubItemType: 'issue' | 'pr';
	githubUrl: string;
	title: string;
	assignee: string | null;
	message: string;
}

export function daysSince(dateString: string): number {
	const then = new Date(dateString).getTime();
	const now = Date.now();
	return (now - then) / (1000 * 60 * 60 * 24);
}

export function isIssueAssigned(issue: GitHubIssue): boolean {
	return Boolean(issue.assignee) || issue.assignees.length > 0;
}

function formatAssignee(issue: GitHubIssue | GitHubPullRequest): string | null {
	if (issue.assignee) return issue.assignee.login;
	if ('assignees' in issue && issue.assignees.length > 0) return issue.assignees[0].login;
	if ('user' in issue) return issue.user.login;
	return null;
}

export function evaluateAssignedNotStarted(
	issues: GitHubIssue[],
	config: ReminderConfig,
	linkedPrsByIssue: Map<number, number[] | null>
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const startedDefinition = config.started_definition || 'both';
	const candidates: ReminderCandidate[] = [];

	for (const issue of issues) {
		if (!isIssueAssigned(issue)) continue;
		if (daysSince(issue.created_at) < threshold) continue;

		const linkedPrs = linkedPrsByIssue.get(issue.number);
		// The timeline lookup failed, so leave the issue alone instead of
		// producing a reminder we cannot justify.
		if (linkedPrs === null) continue;

		const hasLinkedPr = Boolean(issue.pull_request) || (linkedPrs?.length ?? 0) > 0;
		// Projects v2 column tracking is not wired up yet, so "in progress"
		// still falls back to the linked PR signal.
		const inProgress = hasLinkedPr;

		let notStarted = false;
		if (startedDefinition === 'linked_pr') {
			notStarted = !hasLinkedPr;
		} else if (startedDefinition === 'in_progress_column') {
			notStarted = !inProgress;
		} else if (startedDefinition === 'both') {
			notStarted = !hasLinkedPr && !inProgress;
		}

		if (!notStarted) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: issue.number,
			githubItemType: 'issue',
			githubUrl: issue.html_url,
			title: issue.title,
			assignee: formatAssignee(issue),
			message: `Issue #${issue.number} has been assigned to ${formatAssignee(issue)} for ${Math.floor(daysSince(issue.created_at))} days but has not started.`
		});
	}

	return candidates;
}

export function evaluatePrOpenTooLong(
	prs: GitHubPullRequest[],
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const pr of prs) {
		if (daysSince(pr.created_at) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: pr.number,
			githubItemType: 'pr',
			githubUrl: pr.html_url,
			title: pr.title,
			assignee: formatAssignee(pr),
			message: `PR #${pr.number} has been open for ${Math.floor(daysSince(pr.created_at))} days.`
		});
	}

	return candidates;
}

export function evaluatePrNoReview(
	prs: GitHubPullRequest[],
	reviewsMap: Map<number, GitHubReview[]>,
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const pr of prs) {
		const reviews = reviewsMap.get(pr.number) || [];
		if (reviews.length > 0) continue;
		if (daysSince(pr.created_at) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: pr.number,
			githubItemType: 'pr',
			githubUrl: pr.html_url,
			title: pr.title,
			assignee: formatAssignee(pr),
			message: `PR #${pr.number} has been open for ${Math.floor(daysSince(pr.created_at))} days with no review.`
		});
	}

	return candidates;
}

export function evaluatePrApprovedNotMerged(
	prs: GitHubPullRequest[],
	reviewsMap: Map<number, GitHubReview[]>,
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const pr of prs) {
		const reviews = reviewsMap.get(pr.number) || [];
		const approvedReview = reviews
			.filter((r) => r.state === 'APPROVED')
			.sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime())[0];

		if (!approvedReview || !approvedReview.submitted_at) continue;
		if (daysSince(approvedReview.submitted_at) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: pr.number,
			githubItemType: 'pr',
			githubUrl: pr.html_url,
			title: pr.title,
			assignee: formatAssignee(pr),
			message: `PR #${pr.number} was approved ${Math.floor(daysSince(approvedReview.submitted_at))} days ago but has not been merged.`
		});
	}

	return candidates;
}

export function evaluateNoActivity(
	items: (GitHubIssue | GitHubPullRequest)[],
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const item of items) {
		if (daysSince(item.updated_at) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: item.number,
			githubItemType: 'pull_request' in item ? 'pr' : 'issue',
			githubUrl: item.html_url,
			title: item.title,
			assignee: formatAssignee(item),
			message: `${'pull_request' in item ? 'PR' : 'Issue'} #${item.number} has had no activity for ${Math.floor(daysSince(item.updated_at))} days.`
		});
	}

	return candidates;
}

export function evaluateStuckInColumn(
	_items: (GitHubIssue | GitHubPullRequest)[],
	_config: ReminderConfig
): ReminderCandidate[] {
	// Placeholder: requires GitHub Projects v2 GraphQL integration for board column tracking.
	return [];
}
