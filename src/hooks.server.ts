import type { Handle } from '@sveltejs/kit';
import { decryptSession } from '$lib/auth';
import { getUserById } from '$lib/db';

export const handle: Handle = async ({ event, resolve }) => {
	const platform = event.platform as { env: App.Platform['env'] } | undefined;
	const env = platform?.env ?? ({} as App.Platform['env']);

	const sessionCookie = event.cookies.get('session');
	if (sessionCookie && env.SESSION_SECRET) {
		const session = await decryptSession(sessionCookie, env.SESSION_SECRET);
		if (session) {
			const user = await getUserById(env.DB, session.userId);
			if (user) {
				event.locals.user = {
					id: user.id,
					github_id: user.github_id,
					github_login: user.github_login,
					email: user.email,
					avatar_url: user.avatar_url,
					access_token: user.access_token
				};
			}
		}
	}

	return resolve(event);
};
