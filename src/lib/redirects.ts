/**
 * Validates a post-login redirect target. Resolving against a fixed base lets
 * the WHATWG URL parser normalise tricks like `/\evil.com` or `//evil.com`,
 * so an origin comparison rejects them instead of a string-prefix check.
 */

const BASE = 'https://placeholder.invalid';

export function safeRedirectPath(
	next: string | null | undefined,
	allowedPrefixes?: string[]
): string | null {
	if (!next) return null;

	let url: URL;
	try {
		url = new URL(next, BASE);
	} catch {
		return null;
	}

	if (url.origin !== BASE) return null;

	if (
		allowedPrefixes &&
		!allowedPrefixes.some(
			(prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
		)
	) {
		return null;
	}

	return url.pathname + url.search + url.hash;
}
