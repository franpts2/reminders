export function parseTimestamp(value: string): number {
	// SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC, while
	// values written from JS are ISO strings with an explicit zone.
	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		return new Date(`${value.replace(' ', 'T')}Z`).getTime();
	}
	return new Date(value).getTime();
}

export function timeAgo(value: string, now = Date.now()): string {
	const seconds = Math.round((parseTimestamp(value) - now) / 1000);
	const absolute = Math.abs(seconds);
	const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

	if (absolute < 60) return formatter.format(seconds, 'second');
	if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
	if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
	return formatter.format(Math.round(seconds / 86400), 'day');
}
