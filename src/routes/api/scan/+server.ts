import type { RequestHandler } from './$types';
import { scanAllProjects } from '$lib/scanner';

export const GET: RequestHandler = async ({ platform, request }) => {
	const env = (platform as App.Platform)?.env;
	if (!env?.DB) {
		return new Response('Database not configured', { status: 500 });
	}

	// Optional: require a secret header for manual triggers
	const cronSecret = request.headers.get('x-cron-secret');
	const expectedSecret = (env as any).CRON_SECRET;
	if (expectedSecret && cronSecret !== expectedSecret) {
		return new Response('Unauthorized', { status: 401 });
	}

	try {
		await scanAllProjects(env.DB);
		return new Response('OK', { status: 200 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return new Response(`Scan failed: ${message}`, { status: 500 });
	}
};
