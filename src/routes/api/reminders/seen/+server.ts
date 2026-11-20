import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markRemindersSeenForUser } from '$lib/db';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user) {
		return json({ ok: false }, { status: 401 });
	}

	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		return json({ ok: false }, { status: 500 });
	}

	const payload = (await request.json().catch(() => null)) as { ids?: unknown } | null;
	const ids = Array.isArray(payload?.ids)
		? payload.ids.filter((id): id is string => typeof id === 'string')
		: [];

	await markRemindersSeenForUser(env.DB, locals.user.id, ids);

	return json({ ok: true, marked: ids.length });
};
