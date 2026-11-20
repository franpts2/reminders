import { invalidateAll } from '$app/navigation';

const FLUSH_DELAY_MS = 600;

/**
 * Marks reminders as seen once a row has actually been on screen, batching
 * ids so scrolling a long list costs one request instead of one per row.
 */
export class SeenTracker {
	seen = $state<string[]>([]);

	#pending = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | undefined;

	readonly isUnread = (reminder: { id: string; seen_at: string | null }) =>
		reminder.seen_at === null && !this.seen.includes(reminder.id);

	readonly mark = (id: string) => {
		if (this.seen.includes(id) || this.#pending.has(id)) return;

		this.#pending.add(id);
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(this.#flush, FLUSH_DELAY_MS);
	};

	readonly dispose = () => {
		if (this.#timer) clearTimeout(this.#timer);
	};

	#flush = async () => {
		this.#timer = undefined;

		const ids = [...this.#pending];
		this.#pending.clear();
		if (ids.length === 0) return;

		this.seen = [...this.seen, ...ids];

		const response = await fetch('/api/reminders/seen', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ids })
		});

		if (response.ok) {
			await invalidateAll();
		}
	};
}
