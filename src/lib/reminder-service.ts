import type { D1Database } from '@cloudflare/workers-types';
import {
	getOwnedReminder,
	snoozeReminder as setSnoozedUntil,
	dismissReminder as setDismissed,
	restoreReminder as setRestored
} from './db';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_SNOOZE_DAYS = 30;

/**
 * Reminder mutations shared by the inbox and project pages. Every call is
 * scoped to a user, so a reminder id from another account is a no-op.
 */
export async function dismissForUser(
	db: D1Database,
	userId: string,
	reminderId: string
): Promise<boolean> {
	if (!(await getOwnedReminder(db, userId, reminderId))) return false;
	await setDismissed(db, reminderId);
	return true;
}

export async function restoreForUser(
	db: D1Database,
	userId: string,
	reminderId: string
): Promise<boolean> {
	if (!(await getOwnedReminder(db, userId, reminderId))) return false;
	await setRestored(db, reminderId);
	return true;
}

export async function snoozeForUser(
	db: D1Database,
	userId: string,
	reminderId: string,
	days: number
): Promise<boolean> {
	if (!Number.isInteger(days) || days < 1 || days > MAX_SNOOZE_DAYS) return false;
	if (!(await getOwnedReminder(db, userId, reminderId))) return false;
	await setSnoozedUntil(db, reminderId, new Date(Date.now() + days * DAY_MS));
	return true;
}
