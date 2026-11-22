export function parseTimestamp(value: string): number {
	// SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC, while
	// values written from JS are ISO strings with an explicit zone.
	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		return new Date(`${value.replace(' ', 'T')}Z`).getTime();
	}
	return new Date(value).getTime();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface CompactAge {
	value: number;
	unit: 'm' | 'h' | 'd';
	days: number;
}

function compactAge(milliseconds: number): CompactAge {
	const days = Math.floor(milliseconds / DAY);
	if (milliseconds < HOUR) return { value: Math.floor(milliseconds / MINUTE), unit: 'm', days };
	if (milliseconds < DAY) return { value: Math.floor(milliseconds / HOUR), unit: 'h', days };
	return { value: days, unit: 'd', days };
}

/** Age in the largest unit that still reads as a number, e.g. 5m, 18h, 12d. */
export function ageSince(value: string, now = Date.now()): CompactAge {
	return compactAge(Math.max(0, now - parseTimestamp(value)));
}

/** Time left before a future timestamp, in the same compact shape as ageSince. */
export function timeUntil(value: string, now = Date.now()): CompactAge {
	return compactAge(Math.max(0, parseTimestamp(value) - now));
}

export function spellAge(age: CompactAge): string {
	const name = { m: 'minute', h: 'hour', d: 'day' }[age.unit];
	return `${age.value} ${name}${age.value === 1 ? '' : 's'}`;
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
