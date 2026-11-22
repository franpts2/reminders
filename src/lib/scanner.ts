import type { D1Database } from '@cloudflare/workers-types';
import {
	getReminderConfigsByProject,
	getReminderByItem,
	getOpenRemindersByType,
	createReminder,
	refreshReminder,
	reopenReminder,
	resolveReminder,
	createScanLog,
	finishScanLog,
	getUserById,
	type Project
} from './db';
import {
	fetchRepoIssues,
	fetchRepoPullRequests,
	fetchPullRequestReviews,
	fetchLinkedPullRequestNumbers,
	fetchCommitDate,
	type GitHubIssue,
	type GitHubPullRequest,
	type GitHubReview
} from './github';
import {
	evaluateAssignedNotStarted,
	evaluatePrOpenTooLong,
	evaluatePrNeedsReview,
	evaluatePrChangesRequested,
	evaluatePrApprovedNotMerged,
	evaluateNoActivity,
	evaluateStuckInColumn,
	daysSince,
	isIssueAssigned,
	latestDecision,
	type ReminderCandidate
} from './reminders';

export interface ScanResult {
	itemsChecked: number;
	remindersCreated: number;
	remindersResolved: number;
}

const GITHUB_FETCH_CONCURRENCY = 5;

export async function scanProject(db: D1Database, project: Project): Promise<ScanResult> {
	const scanLog = await createScanLog(db, {
		project_id: project.id,
		items_checked: 0,
		reminders_created: 0,
		reminders_resolved: 0,
		error: null
	});

	try {
		const owner = project.owner;
		const repo = project.repo;

		const user = await getUserById(db, project.created_by_user_id);
		if (!user) {
			throw new Error('Project owner user not found');
		}

		const [issues, prs] = await Promise.all([
			fetchRepoIssues(owner, repo, user.access_token),
			fetchRepoPullRequests(owner, repo, user.access_token)
		]);

		// Filter out pull requests from the issues list (GitHub API returns PRs as issues too)
		const pureIssues = issues.filter((i) => !i.pull_request);

		const reviewsMap = new Map<number, GitHubReview[]>();
		await Promise.all(
			prs.map(async (pr) => {
				const reviews = await fetchPullRequestReviews(owner, repo, pr.number, user.access_token);
				reviewsMap.set(pr.number, reviews);
			})
		);

		const configs = await getReminderConfigsByProject(db, project.id);
		const enabledConfigs = configs.filter((c) => c.enabled === 1);

		// "Needs review" counts from the last push when a review has been
		// superseded. The list endpoint has no commit date, so it is fetched
		// only for the PRs that actually need it.
		const needsReviewConfig = enabledConfigs.find((config) => config.type === 'pr_no_review');
		const headCommitDates = new Map<number, string | null>();

		if (needsReviewConfig) {
			const prsToCheck = prs.filter((pr) => {
				const latest = latestDecision(reviewsMap.get(pr.number) ?? []);
				return (
					latest !== null &&
					latest.state !== 'APPROVED' &&
					latest.commit_id !== pr.head.sha
				);
			});

			for (let index = 0; index < prsToCheck.length; index += GITHUB_FETCH_CONCURRENCY) {
				const batch = prsToCheck.slice(index, index + GITHUB_FETCH_CONCURRENCY);

				await Promise.all(
					batch.map(async (pr) => {
						const date = await fetchCommitDate(owner, repo, pr.head.sha, user.access_token);
						headCommitDates.set(pr.number, date);
					})
				);
			}
		}

		// Only issues that the rule would otherwise flag need their timeline read.
		const linkedPrsByIssue = new Map<number, number[] | null>();
		const assignedConfig = enabledConfigs.find((config) => config.type === 'assigned_not_started');

		if (assignedConfig) {
			const issuesToCheck = pureIssues.filter(
				(issue) => isIssueAssigned(issue) && daysSince(issue.created_at) >= assignedConfig.threshold_days
			);

			for (let index = 0; index < issuesToCheck.length; index += GITHUB_FETCH_CONCURRENCY) {
				const batch = issuesToCheck.slice(index, index + GITHUB_FETCH_CONCURRENCY);

				await Promise.all(
					batch.map(async (issue) => {
						try {
							const linked = await fetchLinkedPullRequestNumbers(
								owner,
								repo,
								issue.number,
								user.access_token
							);
							linkedPrsByIssue.set(issue.number, linked);
						} catch {
							// Leave the issue unresolved rather than flagging it
							// just because one lookup failed.
							linkedPrsByIssue.set(issue.number, null);
						}
					})
				);
			}
		}

		let itemsChecked = pureIssues.length + prs.length;
		let remindersCreated = 0;
		let remindersResolved = 0;

		for (const config of enabledConfigs) {
			let candidates: ReminderCandidate[] = [];

			switch (config.type) {
				case 'assigned_not_started':
					candidates = evaluateAssignedNotStarted(pureIssues, config, linkedPrsByIssue);
					break;
				case 'pr_open_too_long':
					candidates = evaluatePrOpenTooLong(prs, config);
					break;
				case 'pr_no_review':
					candidates = evaluatePrNeedsReview(prs, reviewsMap, headCommitDates, config);
					break;
				case 'pr_changes_requested':
					candidates = evaluatePrChangesRequested(prs, reviewsMap, config);
					break;
				case 'pr_approved_not_merged':
					candidates = evaluatePrApprovedNotMerged(prs, reviewsMap, config);
					break;
				case 'no_activity':
					candidates = evaluateNoActivity([...pureIssues, ...prs], config);
					break;
				case 'stuck_in_column':
					candidates = evaluateStuckInColumn([...pureIssues, ...prs], config);
					break;
			}

			const stillMatches = new Set(candidates.map((candidate) => candidate.githubItemNumber));

			if (config.type === 'assigned_not_started') {
				// A failed timeline lookup leaves the issue's state unknown, so
				// keep any existing reminder for it instead of resolving it.
				for (const [issueNumber, linkedPrs] of linkedPrsByIssue) {
					if (linkedPrs === null) stillMatches.add(issueNumber);
				}
			}

			for (const candidate of candidates) {
				const existing = await getReminderByItem(
					db,
					project.id,
					candidate.type,
					candidate.githubItemNumber
				);

				if (!existing) {
					await createReminder(db, {
						project_id: project.id,
						type: candidate.type,
						github_item_number: candidate.githubItemNumber,
						github_item_type: candidate.githubItemType,
						github_url: candidate.githubUrl,
						title: candidate.title,
						assignee: candidate.assignee,
						message: candidate.message,
						status: 'open'
					});
					remindersCreated++;
					continue;
				}

				if (existing.status === 'open') {
					// Keep the copy current without losing seen/snooze state.
					await refreshReminder(db, existing.id, {
						github_url: candidate.githubUrl,
						title: candidate.title,
						assignee: candidate.assignee,
						message: candidate.message
					});
				} else if (existing.status === 'resolved') {
					// The condition came back after being resolved, so surface it again.
					await reopenReminder(db, existing.id);
					remindersCreated++;
				}
				// Dismissed reminders stay dismissed until the user restores them.
			}

			const openReminders = await getOpenRemindersByType(db, project.id, config.type);
			for (const reminder of openReminders) {
				if (stillMatches.has(reminder.github_item_number)) continue;
				await resolveReminder(db, reminder.id);
				remindersResolved++;
			}
		}

		await finishScanLog(db, scanLog.id, {
			items_checked: itemsChecked,
			reminders_created: remindersCreated,
			reminders_resolved: remindersResolved
		});

		return { itemsChecked, remindersCreated, remindersResolved };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await finishScanLog(db, scanLog.id, { error: message });
		throw error;
	}
}

export async function scanAllProjects(db: D1Database): Promise<void> {
	// For the prototype, we scan all projects owned by all users.
	// In a multi-user system this would iterate over all projects directly.
	const stmt = db.prepare('SELECT * FROM projects');
	const { results } = await stmt.all<Project>();
	const projects = results || [];

	for (const project of projects) {
		await scanProject(db, project);
	}
}
