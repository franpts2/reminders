<script lang="ts">
	import { page } from '$app/state';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import FolderGit2Icon from '@lucide/svelte/icons/folder-git-2';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	interface Props {
		user: App.Locals['user'];
		projects: Array<{ id: string; name: string; owner: string; repo: string }>;
		unreadCount: number;
	}

	let { user, projects, unreadCount }: Props = $props();

	const pathname = $derived(page.url.pathname);
	const initials = $derived(user?.github_login.slice(0, 2).toUpperCase() ?? 'GH');

	let logoutForm: HTMLFormElement;
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<a href="/inbox" {...props}>
							<div
								class="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
							>
								<GitPullRequestIcon class="size-4" />
							</div>
							<div class="grid flex-1 text-left leading-tight">
								<span class="truncate font-semibold tracking-tight">Reminders</span>
								<span class="truncate text-xs text-muted-foreground">GitHub PM</span>
							</div>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						isActive={pathname === '/inbox' || pathname.startsWith('/inbox/')}
						tooltipContent="Inbox"
					>
						{#snippet child({ props })}
							<a href="/inbox" {...props}>
								<InboxIcon />
								<span>Inbox</span>
								{#if unreadCount > 0}
									<Sidebar.MenuBadge>{unreadCount}</Sidebar.MenuBadge>
								{/if}
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Group>

		<Sidebar.Group>
			<Sidebar.GroupLabel>Projects</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each projects as project (project.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={
									pathname === `/projects/${project.id}` ||
									pathname.startsWith(`/projects/${project.id}/`)
								}
								tooltipContent={project.name}
							>
								{#snippet child({ props })}
									<a href="/projects/{project.id}" {...props}>
										<FolderGit2Icon />
										<span class="truncate">{project.name}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton tooltipContent="New project" class="text-muted-foreground">
							{#snippet child({ props })}
								<a href="/projects/new" {...props}>
									<PlusIcon />
									<span>New project</span>
								</a>
							{/snippet}
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton size="lg" {...props} class="data-[state=open]:bg-sidebar-accent">
								<Avatar.Root class="size-8 rounded-md">
									<Avatar.Image src={user?.avatar_url ?? undefined} alt={user?.github_login ?? ''} />
									<Avatar.Fallback class="rounded-md text-xs">{initials}</Avatar.Fallback>
								</Avatar.Root>
								<div class="grid flex-1 text-left text-sm leading-tight">
									<span class="truncate font-medium">{user?.github_login}</span>
									<span class="truncate text-xs text-muted-foreground">Signed in with GitHub</span>
								</div>
								<ChevronsUpDownIcon class="ml-auto size-4" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content side="top" align="start" class="w-56">
						<DropdownMenu.Item onSelect={() => logoutForm?.requestSubmit()}>
							<LogOutIcon />
							Sign out
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>

<form bind:this={logoutForm} method="POST" action="/auth/logout" class="hidden"></form>
