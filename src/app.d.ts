/// <reference types="@sveltejs/kit" />
/// <reference types="@cloudflare/workers-types" />

declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				ASSETS: Fetcher;
				GITHUB_CLIENT_ID: string;
				APP_URL: string;
				GITHUB_CLIENT_SECRET: string;
				SESSION_SECRET: string;
			};
		}
		interface Locals {
			user?: {
				id: string;
				github_id: number;
				github_login: string;
				email: string | null;
				avatar_url: string | null;
				access_token: string;
			};
		}
	}
}

export {};
