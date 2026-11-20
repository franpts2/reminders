<script lang="ts">
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import XIcon from '@lucide/svelte/icons/x';
	import IconTooltip from '$lib/components/icon-tooltip.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import type { InboxReminder } from '$lib/db';
	import { timeAgo } from '$lib/time';
	import { cn } from '$lib/utils';

	interface Props {
		reminder: InboxReminder;
		typeLabel: string;
		active?: boolean;
		unread?: boolean;
		isNew?: boolean;
		showProject?: boolean;
		onDismiss: (id: string) => void;
		onSnooze: (id: string, days: number) => void;
		onSeen?: (id: string) => void;
	}

	let {
		reminder,
		typeLabel,
		active = false,
		unread = false,
		isNew = false,
		showProject = true,
		onDismiss,
		onSnooze,
		onSeen
	}: Props = $props();

	const isPr = $derived(reminder.github_item_type === 'pr');
	const reference = $derived(
		showProject
			? `${reminder.project_owner}/${reminder.project_repo}#${reminder.github_item_number}`
			: `#${reminder.github_item_number}`
	);
	const actionsVisibility =
		'transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

	// A row counts as read once it has actually been on screen, not the moment
	// the inbox opens, so the unread bar means something.
	let rowElement: HTMLLIElement;
	let visibilityTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		if (!rowElement || !unread || !onSeen) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					visibilityTimer = setTimeout(() => onSeen(reminder.id), 1200);
				} else if (visibilityTimer) {
					clearTimeout(visibilityTimer);
					visibilityTimer = undefined;
				}
			},
			{ threshold: 0.6 }
		);

		observer.observe(rowElement);

		return () => {
			observer.disconnect();
			if (visibilityTimer) clearTimeout(visibilityTimer);
		};
	});
</script>

<li
	bind:this={rowElement}
	id="reminder-{reminder.id}"
	tabindex="-1"
	data-active={active ? 'true' : undefined}
	class={cn(
		'group relative flex items-start gap-3 border-b px-3 py-3 outline-none transition-colors sm:px-4',
		'hover:bg-muted/60 data-[active=true]:bg-accent/70 focus-visible:bg-accent/70'
	)}
>
	<span
		class={cn(
			'mt-1 h-4 w-[3px] shrink-0 rounded-full transition-colors duration-500',
			isNew ? 'bg-primary' : 'bg-muted-foreground/25'
		)}
		aria-hidden="true"
	></span>

	<div class="min-w-0 flex-1">
		<div class="flex min-w-0 items-center gap-1.5">
			{#if isPr}
				<GitPullRequestIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="sr-only">Pull request</span>
			{:else}
				<CircleDotIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<span class="sr-only">Issue</span>
			{/if}
			<a
				href={reminder.github_url}
				target="_blank"
				rel="noopener noreferrer"
				title={reminder.message}
				class="truncate text-sm font-medium text-foreground hover:underline"
			>
				{reminder.title}
			</a>
		</div>

		<div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
			<span class="font-mono">{reference}</span>
			<span aria-hidden="true">·</span>
			<a
				href="/projects/{reminder.project_id}/settings#rule-{reminder.type}"
				class="underline-offset-2 hover:text-foreground hover:underline"
				title="View this rule"
			>
				{typeLabel}
			</a>
			{#if reminder.assignee}
				<span aria-hidden="true">·</span>
				<span>@{reminder.assignee}</span>
			{/if}
			<span aria-hidden="true">·</span>
			<time datetime={reminder.created_at} class="tabular-nums">
				{timeAgo(reminder.created_at)}
			</time>
		</div>
	</div>

	<div class={cn('flex shrink-0 items-center gap-0.5', actionsVisibility)}>
		<IconTooltip label="Dismiss">
			{#snippet children({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class="size-7 text-muted-foreground"
					aria-label="Dismiss reminder"
					onclick={() => onDismiss(reminder.id)}
				>
					<XIcon class="size-4" />
				</Button>
			{/snippet}
		</IconTooltip>

		<IconTooltip label="Snooze">
			{#snippet children({ props })}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						{...props}
						class={buttonVariants({
							variant: 'ghost',
							size: 'icon',
							class: 'size-7 text-muted-foreground'
						})}
						aria-label="Snooze reminder"
					>
						<ClockIcon class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-40">
						<DropdownMenu.Item onSelect={() => onSnooze(reminder.id, 1)}>For 1 day</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => onSnooze(reminder.id, 3)}>For 3 days</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => onSnooze(reminder.id, 7)}>For 1 week</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/snippet}
		</IconTooltip>

		<IconTooltip label="Open on GitHub">
			{#snippet children({ props })}
				<a
					{...props}
					href={reminder.github_url}
					target="_blank"
					rel="noopener noreferrer"
					class={buttonVariants({
						variant: 'ghost',
						size: 'icon',
						class: 'size-7 text-muted-foreground'
					})}
					aria-label="Open on GitHub"
				>
					<ArrowUpRightIcon class="size-4" />
				</a>
			{/snippet}
		</IconTooltip>
	</div>
</li>
