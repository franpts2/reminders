import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirects';

describe('safeRedirectPath', () => {
	it('keeps a same-origin path with query and hash', () => {
		expect(safeRedirectPath('/projects/abc/settings?tab=1#board')).toBe(
			'/projects/abc/settings?tab=1#board'
		);
	});

	it('rejects protocol-relative targets', () => {
		expect(safeRedirectPath('//evil.com')).toBeNull();
	});

	it('rejects a backslash bypass', () => {
		expect(safeRedirectPath('/\\evil.com')).toBeNull();
	});

	it('rejects an absolute cross-origin URL', () => {
		expect(safeRedirectPath('https://evil.com/projects/1')).toBeNull();
	});

	it('rejects a javascript URL', () => {
		expect(safeRedirectPath('javascript:alert(1)')).toBeNull();
	});

	it('rejects paths outside the allowed prefixes', () => {
		expect(safeRedirectPath('/inbox', ['/projects'])).toBeNull();
		expect(safeRedirectPath('/', ['/projects'])).toBeNull();
	});

	it('allows the prefix itself and its children', () => {
		expect(safeRedirectPath('/projects', ['/projects'])).toBe('/projects');
		expect(safeRedirectPath('/projects/abc', ['/projects'])).toBe('/projects/abc');
	});

	it('rejects encoded traversal out of the prefix', () => {
		expect(safeRedirectPath('/projects/../inbox', ['/projects'])).toBeNull();
	});

	it('returns null for empty input', () => {
		expect(safeRedirectPath(null)).toBeNull();
		expect(safeRedirectPath('')).toBeNull();
	});
});
