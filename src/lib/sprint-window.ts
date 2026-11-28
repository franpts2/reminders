/**
 * Pure date and completion helpers for sprint metrics.
 *
 * All dates are UTC and day-granular. A sprint window is half-open:
 * `[startDate 00:00, endDate 00:00)`, so a 14-day sprint starting on the 5th
 * ends on the 19th. Iteration windows may be non-contiguous; nothing here
 * assumes one sprint ends when the next begins.
 */

export type SprintState = 'upcoming' | 'active' | 'completed';
export type ItemType = 'issue' | 'pr' | 'draft';

export interface SprintWindow {
	startDate: string;
	durationDays: number;
	endDate: string;
}

export interface DoneInput {
	itemType: ItemType;
	status?: string | null;
	contentState?: string | null;
	stateReason?: string | null;
	mergedAt?: string | null;
	closedAt?: string | null;
}

export interface DoneOptions {
	doneOptionName?: string | null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SQLITE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const TIMESTAMP_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

function parseDateOnly(value: string): { year: number; month: number; day: number } {
	const match = DATE_ONLY.exec(value);
	if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${value}"`);

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));

	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		throw new Error(`Invalid calendar date: "${value}"`);
	}

	return { year, month, day };
}

/**
 * Normalises a Date or timestamp to a UTC `YYYY-MM-DD` day. A date-only
 * string is validated and returned unchanged.
 */
export function toDateOnly(value: Date | string): string {
	if (typeof value === 'string') {
		if (DATE_ONLY.test(value)) {
			parseDateOnly(value);
			return value;
		}

		// D1's CURRENT_TIMESTAMP is UTC but has no zone marker.
		const sqlite = SQLITE_TIMESTAMP.exec(value);
		if (sqlite) {
			return toDateOnly(
				`${sqlite[1]}-${sqlite[2]}-${sqlite[3]}T${sqlite[4]}:${sqlite[5]}:${sqlite[6]}Z`
			);
		}

		if (TIMESTAMP_WITHOUT_ZONE.test(value)) {
			throw new Error(`Timestamp must include Z or an offset: "${value}"`);
		}
	}

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: "${String(value)}"`);
	return date.toISOString().slice(0, 10);
}

/**
 * Builds a half-open window. `endDate` is exclusive, so it is never a day the
 * sprint contains.
 */
export function sprintWindow(startDate: string, durationDays: number): SprintWindow {
	const { year, month, day } = parseDateOnly(startDate);

	if (!Number.isInteger(durationDays) || durationDays <= 0) {
		throw new Error(`durationDays must be a positive integer, got ${durationDays}`);
	}

	const end = new Date(Date.UTC(year, month - 1, day + durationDays));
	return { startDate, durationDays, endDate: end.toISOString().slice(0, 10) };
}

export function isUpcoming(window: SprintWindow, today = toDateOnly(new Date())): boolean {
	return today < window.startDate;
}

export function isActive(window: SprintWindow, today = toDateOnly(new Date())): boolean {
	return window.startDate <= today && today < window.endDate;
}

export function isCompleted(window: SprintWindow, today = toDateOnly(new Date())): boolean {
	return today >= window.endDate;
}

export function sprintState(
	window: SprintWindow,
	today = toDateOnly(new Date())
): SprintState {
	if (isUpcoming(window, today)) return 'upcoming';
	if (isCompleted(window, today)) return 'completed';
	return 'active';
}

/** Whether a timestamp falls inside the half-open sprint window. */
export function isWithinWindow(
	value: string | Date,
	window: SprintWindow
): boolean {
	const day = toDateOnly(value);
	return window.startDate <= day && day < window.endDate;
}

/**
 * Done precedence from the plan: Status = Done wins, then a closed issue that
 * was not closed as NOT_PLANNED, then a merged pull request.
 */
export function isDone(input: DoneInput, options: DoneOptions = {}): boolean {
	const doneName = options.doneOptionName;
	if (doneName && input.status === doneName) return true;

	if (input.itemType === 'pr') {
		return Boolean(input.mergedAt) || input.contentState === 'MERGED';
	}

	if (input.itemType === 'issue') {
		return input.contentState === 'CLOSED' && input.stateReason !== 'NOT_PLANNED';
	}

	return false;
}

/** When an item finished, for window membership. */
export function completionTimestamp(input: DoneInput): string | null {
	return input.mergedAt ?? input.closedAt ?? null;
}

export function completedInWindow(
	input: DoneInput,
	window: SprintWindow,
	options: DoneOptions = {}
): boolean {
	if (!isDone(input, options)) return false;
	const at = completionTimestamp(input);
	return at !== null && isWithinWindow(at, window);
}
