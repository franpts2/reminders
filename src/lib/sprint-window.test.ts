import { describe, expect, it } from 'vitest';
import {
	completedInWindow,
	completionTimestamp,
	isActive,
	isCompleted,
	isDone,
	isUpcoming,
	isWithinWindow,
	sprintState,
	sprintWindow,
	toDateOnly
} from './sprint-window';

describe('toDateOnly', () => {
	it('keeps a valid date-only string', () => {
		expect(toDateOnly('2026-11-05')).toBe('2026-11-05');
	});

	it('normalises a UTC timestamp to its day', () => {
		expect(toDateOnly('2026-11-05T23:59:59Z')).toBe('2026-11-05');
	});

	it('normalises an offset timestamp to the UTC day', () => {
		expect(toDateOnly('2026-11-05T23:30:00-03:00')).toBe('2026-11-06');
	});

	it('treats a D1 timestamp without a zone as UTC', () => {
		expect(toDateOnly('2026-11-18 23:30:00')).toBe('2026-11-18');
	});

	it('rejects an ISO timestamp without a zone', () => {
		expect(() => toDateOnly('2026-11-18T23:30:00')).toThrow(/must include Z or an offset/);
	});

	it('rejects impossible dates', () => {
		expect(() => toDateOnly('2026-02-30')).toThrow(/Invalid calendar date/);
	});

	it('rejects non-date strings', () => {
		expect(() => toDateOnly('not a date')).toThrow(/Invalid timestamp/);
	});
});

describe('sprintWindow', () => {
	it('makes the end date exclusive', () => {
		expect(sprintWindow('2026-11-05', 14)).toEqual({
			startDate: '2026-11-05',
			durationDays: 14,
			endDate: '2026-11-19'
		});
	});

	it('crosses a month boundary', () => {
		expect(sprintWindow('2026-01-28', 5).endDate).toBe('2026-02-02');
	});

	it('crosses a leap day', () => {
		expect(sprintWindow('2028-02-27', 3).endDate).toBe('2028-03-01');
	});

	it('crosses a year boundary', () => {
		expect(sprintWindow('2026-12-29', 5).endDate).toBe('2027-01-03');
	});

	it('supports a one-day sprint', () => {
		expect(sprintWindow('2026-11-05', 1).endDate).toBe('2026-11-06');
	});

	it('rejects a non-positive duration', () => {
		expect(() => sprintWindow('2026-11-05', 0)).toThrow(/positive integer/);
		expect(() => sprintWindow('2026-11-05', -3)).toThrow(/positive integer/);
	});

	it('rejects an invalid start date', () => {
		expect(() => sprintWindow('2026-13-01', 14)).toThrow(/Invalid calendar date/);
	});
});

describe('sprint state', () => {
	const window = sprintWindow('2026-11-05', 14);

	it('is upcoming before the start date', () => {
		expect(isUpcoming(window, '2026-11-04')).toBe(true);
		expect(isActive(window, '2026-11-04')).toBe(false);
		expect(sprintState(window, '2026-11-04')).toBe('upcoming');
	});

	it('is active on the start date', () => {
		expect(isActive(window, '2026-11-05')).toBe(true);
		expect(sprintState(window, '2026-11-05')).toBe('active');
	});

	it('is active on the last day', () => {
		expect(isActive(window, '2026-11-18')).toBe(true);
	});

	it('is completed on the exclusive end date', () => {
		expect(isActive(window, '2026-11-19')).toBe(false);
		expect(isCompleted(window, '2026-11-19')).toBe(true);
		expect(sprintState(window, '2026-11-19')).toBe('completed');
	});

	it('treats non-contiguous iterations independently', () => {
		const first = sprintWindow('2026-10-12', 14);
		const second = sprintWindow('2026-11-09', 14);

		expect(isActive(first, '2026-11-01')).toBe(false);
		expect(isActive(second, '2026-11-01')).toBe(false);
		expect(isActive(first, '2026-10-20')).toBe(true);
		expect(isActive(second, '2026-10-20')).toBe(false);
	});
});

describe('isWithinWindow', () => {
	const window = sprintWindow('2026-11-05', 14);

	it('includes the start day', () => {
		expect(isWithinWindow('2026-11-05T00:00:00Z', window)).toBe(true);
	});

	it('includes the last day', () => {
		expect(isWithinWindow('2026-11-18T23:59:59Z', window)).toBe(true);
	});

	it('excludes the end day', () => {
		expect(isWithinWindow('2026-11-19T00:00:00Z', window)).toBe(false);
	});

	it('excludes a day before the start', () => {
		expect(isWithinWindow('2026-11-04T23:59:59Z', window)).toBe(false);
	});
});

describe('isDone', () => {
	const done = { doneOptionName: 'Done' };

	it('treats Status = Done as done even when the item is open', () => {
		expect(
			isDone({ itemType: 'issue', status: 'Done', contentState: 'OPEN' }, done)
		).toBe(true);
	});

	it('treats a closed issue as done without a Status', () => {
		expect(
			isDone({ itemType: 'issue', contentState: 'CLOSED', stateReason: 'COMPLETED' })
		).toBe(true);
	});

	it('treats a closed issue with no reason as done', () => {
		expect(isDone({ itemType: 'issue', contentState: 'CLOSED', stateReason: null })).toBe(
			true
		);
	});

	it('excludes an issue closed as NOT_PLANNED', () => {
		expect(
			isDone({ itemType: 'issue', contentState: 'CLOSED', stateReason: 'NOT_PLANNED' })
		).toBe(false);
	});

	it('keeps Status = Done when the issue was closed as NOT_PLANNED', () => {
		expect(
			isDone(
				{
					itemType: 'issue',
					status: 'Done',
					contentState: 'CLOSED',
					stateReason: 'NOT_PLANNED'
				},
				done
			)
		).toBe(true);
	});

	it('treats a merged pull request as done', () => {
		expect(
			isDone({ itemType: 'pr', contentState: 'MERGED', mergedAt: '2026-11-18T09:00:00Z' })
		).toBe(true);
	});

	it('does not treat a closed, unmerged pull request as done', () => {
		expect(
			isDone({ itemType: 'pr', contentState: 'CLOSED', mergedAt: null })
		).toBe(false);
	});

	it('ignores unmerged pull requests with a Done status only if configured', () => {
		const openPr = { itemType: 'pr' as const, status: 'Done', contentState: 'OPEN' };
		expect(isDone(openPr)).toBe(false);
		expect(isDone(openPr, done)).toBe(true);
	});

	it('marks a draft done only when Status says so', () => {
		expect(isDone({ itemType: 'draft', status: 'Done' })).toBe(false);
		expect(isDone({ itemType: 'draft', status: 'Done' }, done)).toBe(true);
	});
});

describe('completionTimestamp', () => {
	it('prefers mergedAt over closedAt', () => {
		expect(
			completionTimestamp({
				itemType: 'pr',
				mergedAt: '2026-11-18T09:00:00Z',
				closedAt: '2026-11-17T09:00:00Z'
			})
		).toBe('2026-11-18T09:00:00Z');
	});

	it('falls back to closedAt', () => {
		expect(
			completionTimestamp({
				itemType: 'issue',
				closedAt: '2026-11-13T16:40:00Z'
			})
		).toBe('2026-11-13T16:40:00Z');
	});

	it('returns null when there is no timestamp', () => {
		expect(completionTimestamp({ itemType: 'issue' })).toBeNull();
	});
});

describe('completedInWindow', () => {
	const window = sprintWindow('2026-11-05', 14);

	it('counts a completion inside the window', () => {
		expect(
			completedInWindow(
				{
					itemType: 'issue',
					contentState: 'CLOSED',
					stateReason: 'COMPLETED',
					closedAt: '2026-11-13T16:40:00Z'
				},
				window
			)
		).toBe(true);
	});

	it('excludes a completion before the window', () => {
		expect(
			completedInWindow(
				{
					itemType: 'issue',
					contentState: 'CLOSED',
					stateReason: 'COMPLETED',
					closedAt: '2026-11-01T16:40:00Z'
				},
				window
			)
		).toBe(false);
	});

	it('excludes a completion on the exclusive end day', () => {
		expect(
			completedInWindow(
				{
					itemType: 'pr',
					contentState: 'MERGED',
					mergedAt: '2026-11-19T09:00:00Z'
				},
				window
			)
		).toBe(false);
	});
});
