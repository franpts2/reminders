import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';

/**
 * Submits a form action without a <form>, for interactions that start from
 * a menu item or a toast. Successful results refresh the page data.
 */
export async function submitAction(
	url: string,
	fields: Record<string, string>
): Promise<ActionResult> {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		body.set(key, value);
	}

	const response = await fetch(url, {
		method: 'POST',
		body,
		headers: { accept: 'application/json' }
	});

	const result: ActionResult = deserialize(await response.text());

	if (result.type === 'success') {
		await invalidateAll();
	}

	return result;
}
