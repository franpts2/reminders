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

function reviewTimestamp(review: GitHubReview): number {
	return review.submitted_at ? new Date(review.submitted_at).getTime() : 0;
}

function latestOf(reviews: GitHubReview[]): GitHubReview | null {
	let latest: GitHubReview | null = null;

	for (const review of reviews) {
		if (!latest || reviewTimestamp(review) >= reviewTimestamp(latest)) {
			latest = review;
		}
	}

	return latest;
}

/**
 * The current decision of each reviewer. A plain comment does not replace an
 * earlier approval or change request, which matches how GitHub counts
 * reviews. A dismissed review does replace the decision it belonged to.
 */
export function latestDecisionsByUser(reviews: GitHubReview[]): GitHubReview[] {
	const byUser = new Map<string, GitHubReview>();

	for (const review of reviews) {
		if (review.state === 'PENDING' || review.state === 'COMMENTED') continue;

		const existing = byUser.get(review.user.login);
		if (!existing || reviewTimestamp(review) >= reviewTimestamp(existing)) {
			byUser.set(review.user.login, review);
		}
	}

	return [...byUser.values()];
}

export function latestDecision(reviews: GitHubReview[]): GitHubReview | null {
	return latestOf(latestDecisionsByUser(reviews));
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

/**
 * Changes requested, and the author has not pushed since. The moment a commit
 * lands on top of the review, this reminder resolves and "needs review"
 * takes over instead, so the inbox moves from poking the author to poking
 * the reviewer.
 */
export function evaluatePrChangesRequested(
	prs: GitHubPullRequest[],
	reviewsMap: Map<number, GitHubReview[]>,
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const pr of prs) {
		const reviews = reviewsMap.get(pr.number) || [];
		const changesRequested = latestDecisionsByUser(reviews).filter(
			(review) => review.state === 'CHANGES_REQUESTED'
		);
		const latest = latestOf(changesRequested);

		if (!latest?.submitted_at) continue;

		// A different head commit means the author responded. Resolving here
		// lets the "needs review" rule pick the PR up with a fresh clock.
		if (latest.commit_id !== pr.head.sha) continue;
		if (daysSince(latest.submitted_at) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: pr.number,
			githubItemType: 'pr',
			githubUrl: pr.html_url,
			title: pr.title,
			assignee: formatAssignee(pr),
			message: `PR #${pr.number} had changes requested by ${latest.user.login} ${Math.floor(daysSince(latest.submitted_at))} days ago and no new commits have been pushed.`
		});
	}

	return candidates;
}

/**
 * Waiting on a reviewer: either the PR has never had a decisive review, or
 * changes were requested and the author has pushed since. PRs whose latest
 * decision is an approval are handled by "approved but not merged".
 */
export function evaluatePrNeedsReview(
	prs: GitHubPullRequest[],
	reviewsMap: Map<number, GitHubReview[]>,
	headCommitDates: Map<number, string | null>,
	config: ReminderConfig
): ReminderCandidate[] {
	const threshold = config.threshold_days;
	const candidates: ReminderCandidate[] = [];

	for (const pr of prs) {
		// A draft is still work in progress, so nobody owes it a review yet.
		if (pr.draft) continue;

		const reviews = reviewsMap.get(pr.number) || [];
		const decisions = latestDecisionsByUser(reviews);
		const changesRequested = decisions.filter((review) => review.state === 'CHANGES_REQUESTED');
		const latestChanges = latestOf(changesRequested);

		let since: string;
		let message: string;

		if (latestChanges) {
			// Changes requested on the current head is the author's turn.
			if (latestChanges.commit_id === pr.head.sha) continue;

			since =
				headCommitDates.get(pr.number) ?? latestChanges.submitted_at ?? pr.created_at;
			message = `PR #${pr.number} had changes requested and was updated ${Math.floor(daysSince(since))} days ago; it is waiting to be re-reviewed.`;
		} else if (decisions.some((review) => review.state === 'APPROVED')) {
			// An approval means the next move is a merge, not another review.
			continue;
		} else if (decisions.some((review) => review.state === 'DISMISSED')) {
			since = headCommitDates.get(pr.number) ?? pr.updated_at;
			message = `PR #${pr.number} is waiting for a new review after the previous one was dismissed.`;
		} else {
			const lastReview = latestOf(reviews.filter((review) => review.state !== 'PENDING'));
			since = lastReview?.submitted_at ?? pr.created_at;
			message = reviews.length
				? `PR #${pr.number} has had no review decision for ${Math.floor(daysSince(since))} days.`
				: `PR #${pr.number} has been open for ${Math.floor(daysSince(since))} days with no review.`;
		}

		if (daysSince(since) < threshold) continue;

		candidates.push({
			type: config.type,
			githubItemNumber: pr.number,
			githubItemType: 'pr',
			githubUrl: pr.html_url,
			title: pr.title,
			assignee: formatAssignee(pr),
			message
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
		const decisions = latestDecisionsByUser(reviews);

		// A later change request overrides an earlier approval.
		if (decisions.some((review) => review.state === 'CHANGES_REQUESTED')) continue;

		const approvedReview = latestOf(
			decisions.filter((review) => review.state === 'APPROVED')
		);

		if (!approvedReview?.submitted_at) continue;
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
