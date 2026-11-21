<script lang="ts">
	import AlarmClockOffIcon from '@lucide/svelte/icons/alarm-clock-off';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import GitPullRequestIcon from '@lucide/svelte/icons/git-pull-request';
	import XIcon from '@lucide/svelte/icons/x';
	import IconTooltip from '$lib/components/icon-tooltip.svelte';
	import SnoozeSheet from '$lib/components/snooze-sheet.svelte';
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
		mode?: 'active' | 'snoozed';
		onDismiss: (id: string) => void;
		onSnooze?: (id: string, days: number) => void;
		onUnsnooze?: (id: string) => void;
		onSeen?: (id: string) => void;
	}

	let {
		reminder,
		typeLabel,
		active = false,
		unread = false,
		isNew = false,
		showProject = true,
		mode = 'active',
		onDismiss,
		onSnooze,
		onUnsnooze,
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
	const touchTarget =
		"relative size-9 md:size-7 after:absolute after:-inset-1 after:content-['']";

	const canSnooze = $derived(mode === 'snoozed' ? Boolean(onUnsnooze) : Boolean(onSnooze));

	let snoozeOpen = $state(false);

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

	// Swipe to dismiss (left) or snooze (right, or unsnooze in the snoozed
	// view). Tracking is written straight to the DOM: no render per move.
	const CLAIM_DISTANCE = 10;
	const EDGE_GUARD = 24;
	const COMMIT_RATIO = 0.4;
	const FLING_VELOCITY = 0.5;
	const CLICK_GUARD_MS = 400;

	let contentElement = $state.raw<HTMLDivElement | null>(null);
	let snoozePanel = $state.raw<HTMLDivElement | null>(null);
	let dismissPanel = $state.raw<HTMLDivElement | null>(null);

	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastTime = 0;
	let velocity = 0;
	let offset = 0;
	let claimed = false;
	let committing = false;
	let suppressClickUntil = 0;
	let settleTimer: ReturnType<typeof setTimeout> | undefined;

	function resetSwipeStyles() {
		if (!contentElement) return;
		contentElement.style.transition = '';
		contentElement.style.willChange = '';
		contentElement.style.userSelect = '';
	}

	function setPanels() {
		if (!contentElement) return;
		const progress = Math.min(
			1,
			Math.abs(offset) / Math.max(1, contentElement.offsetWidth * COMMIT_RATIO)
		);
		if (snoozePanel) snoozePanel.style.opacity = offset > 0 ? String(progress) : '0';
		if (dismissPanel) dismissPanel.style.opacity = offset < 0 ? String(progress) : '0';
	}

	function releasePointer() {
		if (contentElement && pointerId !== null && contentElement.hasPointerCapture(pointerId)) {
			contentElement.releasePointerCapture(pointerId);
		}
		pointerId = null;
		claimed = false;
	}

	function onPointerDown(event: PointerEvent) {
		if (!contentElement) return;
		if (event.pointerType === 'mouse' || pointerId !== null || committing) return;

		if (settleTimer) {
			clearTimeout(settleTimer);
			settleTimer = undefined;
		}

		const target = event.target as HTMLElement | null;
		if (target?.closest('button, input, select, textarea, [role="menuitem"]')) return;

		// Leave the screen edges to the platform's back gesture.
		if (event.clientX < EDGE_GUARD || event.clientX > window.innerWidth - EDGE_GUARD) return;

		pointerId = event.pointerId;
		startX = lastX = event.clientX;
		startY = event.clientY;
		lastTime = event.timeStamp;
		velocity = 0;
		offset = 0;
	}

	function onPointerMove(event: PointerEvent) {
		if (!contentElement || event.pointerId !== pointerId) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (!claimed) {
			if (Math.abs(dx) < CLAIM_DISTANCE && Math.abs(dy) < CLAIM_DISTANCE) return;

			// A vertical drag belongs to the page, not the row.
			if (Math.abs(dy) > Math.abs(dx)) {
				pointerId = null;
				return;
			}

			claimed = true;
			contentElement.setPointerCapture(event.pointerId);
			contentElement.style.transition = 'none';
			contentElement.style.willChange = 'transform';
			contentElement.style.userSelect = 'none';
		}

		velocity = (event.clientX - lastX) / Math.max(1, event.timeStamp - lastTime);
		lastX = event.clientX;
		lastTime = event.timeStamp;

		const limit = contentElement.offsetWidth * 0.9;
		offset = Math.max(-limit, Math.min(limit, dx));
		contentElement.style.transform = `translateX(${offset}px)`;
		setPanels();
	}

	function snapBack() {
		if (!contentElement) return;
		contentElement.style.transition = 'transform 250ms cubic-bezier(0.32, 0.72, 0, 1)';
		offset = 0;
		setPanels();
		contentElement.style.transform = 'translateX(0)';
		settleTimer = setTimeout(() => {
			resetSwipeStyles();
			settleTimer = undefined;
		}, 280);
	}

	function commitSwipe(direction: 1 | -1) {
		if (!contentElement) return;
		committing = true;
		if (snoozePanel) snoozePanel.style.opacity = direction > 0 ? '1' : '0';
		if (dismissPanel) dismissPanel.style.opacity = direction < 0 ? '1' : '0';

		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const width = contentElement.offsetWidth;

		if (!reducedMotion) {
			contentElement.style.transition = 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)';
			contentElement.style.transform = `translateX(${direction * (width + 24)}px)`;
		}

		setTimeout(
			() => {
				committing = false;
				if (direction > 0) {
					if (mode === 'snoozed') onUnsnooze?.(reminder.id);
					else onSnooze?.(reminder.id, 3);
				} else {
					onDismiss(reminder.id);
				}
			},
			reducedMotion ? 0 : 200
		);
	}

	function onPointerUp(event: PointerEvent) {
		if (!contentElement || event.pointerId !== pointerId) return;

		const wasClaimed = claimed;
		const moved = offset;
		const releasedVelocity = velocity;
		releasePointer();

		if (!wasClaimed) return;

		suppressClickUntil = performance.now() + CLICK_GUARD_MS;

		const width = contentElement.offsetWidth;
		const shouldCommit = Math.abs(moved) >= width * COMMIT_RATIO || Math.abs(releasedVelocity) > FLING_VELOCITY;

		if (!shouldCommit || moved === 0 || (moved > 0 && !canSnooze)) {
			snapBack();
			return;
		}

		commitSwipe(moved > 0 ? 1 : -1);
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;

		const wasClaimed = claimed;
		releasePointer();

		if (wasClaimed) snapBack();
	}

	function onClickCapture(event: MouseEvent) {
		if (performance.now() < suppressClickUntil) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function selectSnooze(days: number) {
		onSnooze?.(reminder.id, days);
	}
</script>

<li
	bind:this={rowElement}
	id="reminder-{reminder.id}"
	tabindex="-1"
	data-active={active ? 'true' : undefined}
	class="group relative overflow-hidden border-b outline-none"
>
	<div class="pointer-events-none absolute inset-0" aria-hidden="true">
		{#if canSnooze}
			<div
				bind:this={snoozePanel}
				class="absolute inset-y-0 left-0 flex w-1/2 items-center gap-2 bg-primary/10 pl-4 text-primary opacity-0"
			>
				{#if mode === 'snoozed'}
					<AlarmClockOffIcon class="size-4" />
					<span class="text-xs font-medium">Unsnooze</span>
				{:else}
					<ClockIcon class="size-4" />
					<span class="text-xs font-medium">Snooze 3 days</span>
				{/if}
			</div>
		{/if}
		<div
			bind:this={dismissPanel}
			class="absolute inset-y-0 right-0 flex w-1/2 items-center justify-end gap-2 bg-destructive/10 pr-4 text-destructive opacity-0"
		>
			<span class="text-xs font-medium">Dismiss</span>
			<XIcon class="size-4" />
		</div>
	</div>

	<div
		bind:this={contentElement}
		role="group"
		class={cn(
			'relative flex touch-pan-y items-start gap-3 bg-background px-3 py-3 transition-colors sm:px-4',
			'hover:bg-muted/60 group-data-[active=true]:bg-accent/70 group-focus-visible:bg-accent/70 active:bg-accent/60'
		)}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerCancel}
		onclickcapture={onClickCapture}
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
				{#if mode === 'snoozed' && reminder.snoozed_until}
					<time datetime={reminder.snoozed_until} class="tabular-nums">
						wakes {timeAgo(reminder.snoozed_until)}
					</time>
				{:else}
					<time datetime={reminder.created_at} class="tabular-nums">
						{timeAgo(reminder.created_at)}
					</time>
				{/if}
			</div>
		</div>

		<div class={cn('flex shrink-0 items-center gap-2 md:gap-0.5', actionsVisibility)}>
			<IconTooltip label="Dismiss">
				{#snippet children({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class={cn(touchTarget, 'text-muted-foreground')}
						aria-label="Dismiss reminder"
						onclick={() => onDismiss(reminder.id)}
					>
						<XIcon class="size-4" />
					</Button>
				{/snippet}
			</IconTooltip>

			{#if mode === 'snoozed'}
				<IconTooltip label="Back to inbox">
					{#snippet children({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class={cn(touchTarget, 'text-muted-foreground')}
							aria-label="Unsnooze reminder"
							onclick={() => onUnsnooze?.(reminder.id)}
						>
							<AlarmClockOffIcon class="size-4" />
						</Button>
					{/snippet}
				</IconTooltip>
			{:else}
				<Button
					variant="ghost"
					size="icon"
					class={cn(touchTarget, 'text-muted-foreground md:hidden')}
					aria-label="Snooze reminder"
					onclick={() => (snoozeOpen = true)}
				>
					<ClockIcon class="size-4" />
				</Button>

				<div class="hidden md:block">
					<IconTooltip label="Snooze">
						{#snippet children({ props })}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									{...props}
									class={buttonVariants({
										variant: 'ghost',
										size: 'icon',
										class: cn(touchTarget, 'text-muted-foreground')
									})}
									aria-label="Snooze reminder"
								>
									<ClockIcon class="size-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="w-40">
									<DropdownMenu.Item onSelect={() => onSnooze?.(reminder.id, 1)}
										>For 1 day</DropdownMenu.Item
									>
									<DropdownMenu.Item onSelect={() => onSnooze?.(reminder.id, 3)}
										>For 3 days</DropdownMenu.Item
									>
									<DropdownMenu.Item onSelect={() => onSnooze?.(reminder.id, 7)}
										>For 1 week</DropdownMenu.Item
									>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/snippet}
					</IconTooltip>
				</div>
			{/if}

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
							class: cn(touchTarget, 'text-muted-foreground')
						})}
						aria-label="Open on GitHub"
					>
						<ArrowUpRightIcon class="size-4" />
					</a>
				{/snippet}
			</IconTooltip>
		</div>
	</div>

	{#if mode !== 'snoozed' && onSnooze}
		<SnoozeSheet bind:open={snoozeOpen} onSelect={selectSnooze} />
	{/if}
</li>
