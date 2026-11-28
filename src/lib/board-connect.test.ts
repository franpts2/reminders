import { describe, expect, it } from 'vitest';
import {
	BoardError,
	isBoardMetricsEnabled,
	parseBoardUrl,
	pickBoardFields,
	type GqlField
} from './board-connect';

describe('parseBoardUrl', () => {
	it('parses an organization board', () => {
		expect(parseBoardUrl('https://github.com/orgs/NIAEFEUP/projects/7')).toEqual({
			ownerType: 'organization',
			owner: 'NIAEFEUP',
			number: 7
		});
	});

	it('parses a user board', () => {
		expect(parseBoardUrl('https://github.com/users/francisca/projects/1')).toEqual({
			ownerType: 'user',
			owner: 'francisca',
			number: 1
		});
	});

	it('accepts a trailing slash, query string and hash', () => {
		expect(parseBoardUrl('https://github.com/orgs/NIAEFEUP/projects/7/?tab=1#readme')).toEqual({
			ownerType: 'organization',
			owner: 'NIAEFEUP',
			number: 7
		});
	});

	it('trims surrounding whitespace', () => {
		expect(parseBoardUrl('  https://github.com/orgs/NIAEFEUP/projects/7  ').number).toBe(7);
	});

	it('rejects a repo URL', () => {
		expect(() => parseBoardUrl('https://github.com/NIAEFEUP/website')).toThrow(BoardError);
	});

	it('rejects a board URL on another host', () => {
		expect(() => parseBoardUrl('https://gitlab.com/orgs/NIAEFEUP/projects/7')).toThrow(
			/must be on github.com/
		);
	});

	it('rejects a non-numeric project number', () => {
		expect(() => parseBoardUrl('https://github.com/orgs/NIAEFEUP/projects/seven')).toThrow(
			/paste a board url/i
		);
	});

	it('rejects a bare path', () => {
		expect(() => parseBoardUrl('/orgs/NIAEFEUP/projects/7')).toThrow(/paste a board url/i);
	});
});

function iterationField(id: string, name = 'Iteration'): GqlField {
	return {
		__typename: 'ProjectV2IterationField',
		id,
		name,
		configuration: {
			duration: 14,
			startDay: 1,
			iterations: [{ id: `${id}-current`, title: 'Current', startDate: '2026-11-09', duration: 14 }],
			completedIterations: [
				{ id: `${id}-previous`, title: 'Previous', startDate: '2026-10-26', duration: 14 }
			]
		}
	};
}

function statusField(id: string, name = 'Status', optionNames = ['Todo', 'In Progress', 'Done']): GqlField {
	return {
		__typename: 'ProjectV2SingleSelectField',
		id,
		name,
		options: optionNames.map((optionName, index) => ({ id: `${id}-${index}`, name: optionName }))
	};
}

describe('pickBoardFields', () => {
	it('returns nulls for a board with no usable fields', () => {
		const picked = pickBoardFields([]);
		expect(picked.iterationField).toBeNull();
		expect(picked.statusField).toBeNull();
		expect(picked.doneOptionName).toBeNull();
		expect(picked.iterationFields).toEqual([]);
	});

	it('picks the iteration field and Status', () => {
		const picked = pickBoardFields([iterationField('it'), statusField('status')]);
		expect(picked.iterationField?.id).toBe('it');
		expect(picked.iterationField?.iterations).toHaveLength(1);
		expect(picked.iterationField?.completedIterations).toHaveLength(1);
		expect(picked.statusField?.id).toBe('status');
		expect(picked.doneOptionName).toBe('Done');
	});

	it('uses the first iteration field when a board has several', () => {
		const picked = pickBoardFields([
			iterationField('first', 'Sprint'),
			iterationField('second', 'Release')
		]);
		expect(picked.iterationFields.map((field) => field.id)).toEqual(['first', 'second']);
		expect(picked.iterationField?.id).toBe('first');
	});

	it('prefers a field named Status', () => {
		const picked = pickBoardFields([
			statusField('priority', 'Priority', ['Low', 'High']),
			statusField('status', 'Status')
		]);
		expect(picked.statusField?.id).toBe('status');
	});

	it('falls back to a single-select with a Done option', () => {
		const picked = pickBoardFields([statusField('state', 'State', ['Open', 'Done'])]);
		expect(picked.statusField?.id).toBe('state');
		expect(picked.doneOptionName).toBe('Done');
	});

	it('detects Done case-insensitively', () => {
		const picked = pickBoardFields([statusField('status', 'Status', ['TODO', 'DONE'])]);
		expect(picked.doneOptionName).toBe('DONE');
	});

	it('tolerates a Status field with no Done option', () => {
		const picked = pickBoardFields([statusField('status', 'Status', ['Todo', 'Doing'])]);
		expect(picked.statusField?.id).toBe('status');
		expect(picked.doneOptionName).toBeNull();
	});
});

describe('isBoardMetricsEnabled', () => {
	it('is enabled only for the string 1', () => {
		expect(isBoardMetricsEnabled({ BOARD_METRICS: '1' })).toBe(true);
		expect(isBoardMetricsEnabled({ BOARD_METRICS: '0' })).toBe(false);
		expect(isBoardMetricsEnabled({})).toBe(false);
		expect(isBoardMetricsEnabled(undefined)).toBe(false);
	});
});
