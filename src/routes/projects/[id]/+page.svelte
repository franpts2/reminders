<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { toast } from 'svelte-sonner';
	import ReminderRow from '$lib/components/reminder-row.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { submitAction } from '$lib/forms';
	import { SeenTracker } from '$lib/seen-tracker.svelte';
	import { parseTimestamp, timeAgo } from '$lib/time';

	interface Props {
		data: any;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();

	let scanning = $state(false);
	const seen = new SeenTracker();

	const latestScanAt = $derived(
		data.latestScan ? parseTimestamp(data.latestScan.started_at) : 0
	);

	function shortLabelFor(type: string) {
		return data.reminderTypeLabels.find((t: any) => t.key === type)?.short_label || type;
	}

	// A reminder is "new" when it first appeared in the most recent scan, or
	// while it is still unread.
	function isFromLatestScan(reminder: any) {
		return latestScanAt > 0 && parseTimestamp(reminder.created_at) >= latestScanAt;
	}

	async function snooze(reminderId: string, days: number) {
		const result = await submitAction('?/snoozeReminder', {
			reminderId,
			days: String(days)
		});

		if (result.type === 'success') {
			toast(`Snoozed for ${days === 1 ? '1 day' : `${days} days`}`, {
				action: { label: 'Undo', onClick: () => restore(reminderId) }
			});
		} else {
			toast.error('Could not snooze that reminder');
		}
	}

	async function dismiss(reminderId: string) {
		const result = await submitAction('?/dismissReminder', { reminderId });

		if (result.type !== 'success') {
			toast.error('Could not dismiss that reminder');
			return;
		}

		toast('Reminder dismissed', {
			action: {
				label: 'Undo',
				onClick: () => restore(reminderId)
			}
		});
	}

	async function restore(reminderId: string) {
		const result = await submitAction('?/restoreReminder', { reminderId });

		if (result.type === 'success') {
			toast.success('Reminder restored');
		} else {
			toast.error('Could not restore that reminder');
		}
	}

	onMount(() => {
		return () => seen.dispose();
	});
</script>

<div class="space-y-8">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-foreground">{data.project.name}</h1>
			<p class="font-mono text-sm text-muted-foreground">
				{data.project.owner}/{data.project.repo}
			</p>
			{#if data.latestScan}
				<p class="mt-2 text-xs text-muted-foreground">
					{#if data.latestScan.finished_at}
						Scanned {timeAgo(data.latestScan.finished_at)} · {data.latestScan.items_checked} items
						checked · {data.latestScan.reminders_created} new
					{:else}
						Scan started {timeAgo(data.latestScan.started_at)}…
					{/if}
					{#if data.latestScan.error}
						<span class="text-destructive"> · last scan failed</span>
					{/if}
				</p>
			{:else}
				<p class="mt-2 text-xs text-muted-foreground">Not scanned yet</p>
			{/if}
		</div>

		<div class="flex shrink-0 items-center gap-2">
			<a
				href="/projects/{data.project.id}/settings"
				class={buttonVariants({ variant: 'outline', size: 'sm' })}
			>
				<SettingsIcon class="size-4" />
				Rules
			</a>

			<form
				method="POST"
				action="?/scanNow"
				use:enhance={() => {
					scanning = true;
					return async ({ result, update }) => {
						scanning = false;
						await update();

						if (result.type === 'success') {
							const outcome = (result.data as any)?.result;
							toast.success('Scan finished', {
								description: outcome
									? `${outcome.itemsChecked} items checked · ${outcome.remindersCreated} new · ${outcome.remindersResolved} resolved`
									: undefined
							});
						} else if (result.type === 'failure') {
							toast.error((result.data as any)?.error ?? 'Scan failed');
						}
					};
				}}
			>
				<Button type="submit" size="sm" disabled={scanning}>
					{scanning ? 'Scanning…' : 'Scan now'}
				</Button>
			</form>
		</div>
	</div>

	{#if form?.error}
		<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{form.error}</div>
	{/if}

	<section>
		<div class="flex items-baseline justify-between">
			<h2 class="text-sm font-semibold text-foreground">Open reminders</h2>
			<span class="text-xs tabular-nums text-muted-foreground">{data.reminders.length}</span>
		</div>

		{#if data.reminders.length === 0}
			<p class="mt-2 text-sm text-muted-foreground">
				No open reminders. Run a scan to check for stale issues and PRs.
			</p>
		{:else}
			<ul class="mt-2">
				{#each data.reminders as reminder (reminder.id)}
					{@const unread = seen.isUnread(reminder)}
					<ReminderRow
						{reminder}
						typeLabel={shortLabelFor(reminder.type)}
						showProject={false}
						{unread}
						isNew={unread || isFromLatestScan(reminder)}
						onDismiss={dismiss}
						onSnooze={snooze}
						onSeen={seen.mark}
					/>
				{/each}
			</ul>
		{/if}
	</section>
</div>
