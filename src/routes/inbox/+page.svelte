<script lang="ts">
	import { onMount } from 'svelte';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import { toast } from 'svelte-sonner';
	import MarkSeen from '$lib/components/mark-seen.svelte';
	import ReminderRow from '$lib/components/reminder-row.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Kbd } from '$lib/components/ui/kbd/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { InboxReminder } from '$lib/db';
	import { submitAction } from '$lib/forms';
	import { parseTimestamp, timeAgo } from '$lib/time';

	interface Props {
		data: {
			reminders: InboxReminder[];
			latestScan: { finished_at: string | null; started_at: string } | null;
			reminderTypes: Array<{ key: string; short_label: string }>;
		};
	}

	let { data }: Props = $props();

	const DAY_MS = 24 * 60 * 60 * 1000;

	let projectFilter = $state('all');
	let typeFilter = $state('all');
	let removed = $state<string[]>([]);
	let activeId = $state<string | null>(null);

	const reminders = $derived(data.reminders);
	const shortLabels = $derived(new Map(data.reminderTypes.map((type) => [type.key, type.short_label])));
	const filtersActive = $derived(projectFilter !== 'all' || typeFilter !== 'all');

	const projectOptions = $derived.by(() => {
		const projects = new Map<string, string>();
		for (const reminder of reminders) {
			if (!projects.has(reminder.project_id)) {
				projects.set(reminder.project_id, reminder.project_name);
			}
		}
		return [...projects].map(([id, name]) => ({ id, name }));
	});

	const typeOptions = $derived.by(() => {
		const types = new Map<string, string>();
		for (const reminder of reminders) {
			types.set(reminder.type, shortLabels.get(reminder.type) ?? reminder.type);
		}
		return [...types].map(([value, label]) => ({ value, label }));
	});

	const filtered = $derived(
		reminders.filter(
			(reminder) =>
				!removed.includes(reminder.id) &&
				(projectFilter === 'all' || reminder.project_id === projectFilter) &&
				(typeFilter === 'all' || reminder.type === typeFilter)
		)
	);

	const groups = $derived.by(() => {
		const now = Date.now();
		const buckets: Record<'older' | 'week' | 'today', InboxReminder[]> = {
			older: [],
			week: [],
			today: []
		};

		for (const reminder of filtered) {
			const age = now - parseTimestamp(reminder.created_at);
			if (age >= 7 * DAY_MS) buckets.older.push(reminder);
			else if (age >= DAY_MS) buckets.week.push(reminder);
			else buckets.today.push(reminder);
		}

		return [
			{ key: 'older', label: 'Over a week', items: buckets.older },
			{ key: 'week', label: 'This week', items: buckets.week },
			{ key: 'today', label: 'Today', items: buckets.today }
		].filter((group) => group.items.length > 0);
	});

	const flat = $derived(groups.flatMap((group) => group.items));

	function clearFilters() {
		projectFilter = 'all';
		typeFilter = 'all';
	}

	function focusRow(id: string) {
		requestAnimationFrame(() => {
			document.getElementById(`reminder-${id}`)?.focus();
		});
	}

	function move(direction: 1 | -1) {
		if (flat.length === 0) return;

		const currentIndex = activeId ? flat.findIndex((item) => item.id === activeId) : -1;
		const nextIndex =
			currentIndex === -1
				? direction === 1
					? 0
					: flat.length - 1
				: Math.max(0, Math.min(flat.length - 1, currentIndex + direction));

		activeId = flat[nextIndex].id;
		focusRow(activeId);
	}

	async function dismiss(id: string) {
		const previous = activeId;
		removed = [...removed, id];
		if (activeId === id) activeId = null;

		const result = await submitAction('?/dismissReminder', { reminderId: id });

		if (result.type !== 'success') {
			removed = removed.filter((removedId) => removedId !== id);
			activeId = previous;
			toast.error('Could not dismiss that reminder');
			return;
		}

		toast('Reminder dismissed', {
			action: {
				label: 'Undo',
				onClick: () => restore(id)
			}
		});
	}

	async function snooze(id: string, days: number) {
		removed = [...removed, id];
		if (activeId === id) activeId = null;

		const result = await submitAction('?/snoozeReminder', { reminderId: id, days: String(days) });

		if (result.type !== 'success') {
			removed = removed.filter((removedId) => removedId !== id);
			toast.error('Could not snooze that reminder');
			return;
		}

		toast(`Snoozed for ${days === 1 ? '1 day' : `${days} days`}`, {
			action: {
				label: 'Undo',
				onClick: () => restore(id)
			}
		});
	}

	async function restore(id: string) {
		removed = removed.filter((removedId) => removedId !== id);

		const result = await submitAction('?/restoreReminder', { reminderId: id });

		if (result.type === 'success') {
			toast.success('Reminder restored');
		} else {
			removed = [...removed, id];
			toast.error('Could not restore that reminder');
		}
	}

	onMount(() => {
		function onKeydown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (!['j', 'k', 'd', 's', 'Enter', 'Escape'].includes(event.key)) return;

			const target = event.target as HTMLElement | null;
			if (target?.closest('a, button, input, select, textarea, [role="menuitem"]')) return;

			switch (event.key) {
				case 'j':
					move(1);
					break;
				case 'k':
					move(-1);
					break;
				case 'd':
					if (activeId) dismiss(activeId);
					break;
				case 's':
					if (activeId) snooze(activeId, 3);
					break;
				case 'Enter': {
					const active = flat.find((item) => item.id === activeId);
					if (active) window.open(active.github_url, '_blank', 'noopener');
					break;
				}
				case 'Escape':
					activeId = null;
					break;
				default:
					return;
			}

			event.preventDefault();
		}

		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<MarkSeen ids={reminders.map((reminder) => reminder.id)} />

<div class="flex flex-col">
	<div
		class="sticky top-14 z-[1] flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-2.5 backdrop-blur-sm"
	>
		<p class="text-xs text-muted-foreground">
			<span class="tabular-nums">{filtered.length}</span> open
			{#if filtersActive}
				<span class="text-muted-foreground/70">of {reminders.length}</span>
			{/if}
		</p>

		<div class="ml-auto flex flex-wrap items-center gap-1.5">
			<Select.Root type="single" bind:value={projectFilter}>
				<Select.Trigger size="sm" class="max-w-[180px] text-xs">
					<Select.Value placeholder="All projects" />
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All projects</Select.Item>
					{#each projectOptions as project (project.id)}
						<Select.Item value={project.id}>{project.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			<Select.Root type="single" bind:value={typeFilter}>
				<Select.Trigger size="sm" class="max-w-[180px] text-xs">
					<Select.Value placeholder="All rules" />
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All rules</Select.Item>
					{#each typeOptions as type (type.value)}
						<Select.Item value={type.value}>{type.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			{#if filtersActive}
				<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={clearFilters}>
					Clear
				</Button>
			{/if}
		</div>

		<div class="hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
			<Kbd>j</Kbd>
			<Kbd>k</Kbd>
			<span>move</span>
			<span class="mx-1 text-border">|</span>
			<Kbd>d</Kbd>
			<span>dismiss</span>
			<span class="mx-1 text-border">|</span>
			<Kbd>s</Kbd>
			<span>snooze</span>
		</div>
	</div>

	{#if reminders.length === 0}
		<Empty.Root class="border-0 py-20">
			<Empty.Media variant="icon">
				<InboxIcon />
			</Empty.Media>
			<Empty.Title>Inbox zero</Empty.Title>
			<Empty.Description>
				Nothing needs your attention.
				{#if data.latestScan}
					Last scanned {timeAgo(data.latestScan.finished_at ?? data.latestScan.started_at)}.
				{/if}
			</Empty.Description>
		</Empty.Root>
	{:else if filtered.length === 0}
		<Empty.Root class="border-0 py-20">
			<Empty.Media variant="icon">
				<SearchXIcon />
			</Empty.Media>
			<Empty.Title>No reminders match these filters</Empty.Title>
			<Empty.Description>There are {reminders.length} reminders outside the current filters.</Empty.Description>
			<Empty.Content>
				<Button variant="outline" size="sm" onclick={clearFilters}>Clear filters</Button>
			</Empty.Content>
		</Empty.Root>
	{:else}
		<div>
			{#each groups as group (group.key)}
				<section aria-labelledby="group-{group.key}">
					<h2
						id="group-{group.key}"
						class="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
					>
						{group.label}
						<span class="tabular-nums text-muted-foreground/70">{group.items.length}</span>
					</h2>
					<ul>
						{#each group.items as reminder (reminder.id)}
							<ReminderRow
								{reminder}
								typeLabel={shortLabels.get(reminder.type) ?? reminder.type}
								active={activeId === reminder.id}
								onDismiss={dismiss}
								onSnooze={snooze}
							/>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>
