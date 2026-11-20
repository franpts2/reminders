<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import type { Snippet } from 'svelte';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import ThemeToggle from '$lib/components/theme-toggle.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';

	interface Props {
		data: {
			user?: App.Locals['user'];
			projects: Array<{ id: string; name: string; owner: string; repo: string }>;
			unreadCount: number;
		};
		children: Snippet;
	}

	let { data, children }: Props = $props();

	const activeProject = $derived(
		data.projects.find((project) => {
			const base = `/projects/${project.id}`;
			return page.url.pathname === base || page.url.pathname.startsWith(`${base}/`);
		})
	);

	const pageTitle = $derived.by(() => {
		const path = page.url.pathname;
		if (path === '/inbox') return 'Inbox';
		if (path === '/projects/new') return 'New project';
		if (!activeProject) return '';
		return path.endsWith('/settings') ? `${activeProject.name} rules` : activeProject.name;
	});
</script>

<ModeWatcher defaultMode="system" />

{#if data.user}
	<Sidebar.Provider>
		<AppSidebar user={data.user} projects={data.projects} unreadCount={data.unreadCount} />

		<div class="flex min-w-0 flex-1 flex-col">
			<header
				class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm"
			>
				<Sidebar.Trigger class="-ml-1" />
				<div class="h-4 w-px bg-border" aria-hidden="true"></div>
				<div class="flex min-w-0 flex-col leading-tight">
					<span class="truncate text-sm font-medium">{pageTitle}</span>
					{#if activeProject}
						<span class="truncate font-mono text-[11px] text-muted-foreground">
							{activeProject.owner}/{activeProject.repo}
						</span>
					{/if}
				</div>
				<div class="ml-auto flex items-center gap-1">
					<ThemeToggle />
				</div>
			</header>

			<main class="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
				{@render children()}
			</main>
		</div>
	</Sidebar.Provider>
{:else}
	<div class="flex min-h-svh flex-col">
		<header class="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
			<a href="/" class="flex items-center gap-2 text-sm font-semibold tracking-tight">
				<span
					class="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground"
				>
					<GitPullRequestIcon class="size-3.5" />
				</span>
				GitHub PM Reminders
			</a>
			<div class="flex items-center gap-2">
				<ThemeToggle />
				<a href="/auth/github" class={buttonVariants({ size: 'sm' })}>Sign in</a>
			</div>
		</header>
		<main class="flex flex-1 flex-col">
			{@render children()}
		</main>
	</div>
{/if}

<Toaster />

<svelte:head>
	<title>{pageTitle ? `${pageTitle} · Reminders` : 'GitHub PM Reminders'}</title>
</svelte:head>
