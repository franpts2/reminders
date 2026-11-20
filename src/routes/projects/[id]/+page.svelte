<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import MarkSeen from '$lib/components/mark-seen.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { submitAction } from '$lib/forms';
	import { timeAgo } from '$lib/time';

	interface Props {
		data: any;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();

	let scanning = $state(false);

	const visibleIds = $derived(data.reminders.map((reminder: any) => reminder.id));

	function labelFor(type: string) {
		return data.reminderTypeLabels.find((t: any) => t.key === type)?.label || type;
	}

	function descriptionFor(type: string) {
		return data.reminderTypeLabels.find((t: any) => t.key === type)?.description || '';
	}

	async function snooze(reminderId: string, days: number) {
		const result = await submitAction('?/snoozeReminder', {
			reminderId,
			days: String(days)
		});

		if (result.type === 'success') {
			toast(`Snoozed for ${days === 1 ? '1 day' : `${days} days`}`);
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
</script>

<MarkSeen ids={visibleIds} />

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
			<Button type="submit" disabled={scanning}>
				{scanning ? 'Scanning…' : 'Scan now'}
			</Button>
		</form>
	</div>

	{#if form?.error}
		<div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{form.error}</div>
	{/if}

	<section class="rounded-lg border bg-card p-6 text-card-foreground">
		<h2 class="text-lg font-semibold text-foreground">Reminder settings</h2>
		<p class="text-sm text-muted-foreground">
			Choose which reminders to enable and set thresholds.
		</p>

		<div class="mt-6 space-y-6">
			{#each data.configs as config}
				<form method="POST" action="?/updateConfig" class="rounded-md border p-4">
					<input type="hidden" name="type" value={config.type} />
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1">
							<h3 class="font-medium text-foreground">{labelFor(config.type)}</h3>
							<p class="text-sm text-muted-foreground">{descriptionFor(config.type)}</p>
						</div>
						<label class="inline-flex cursor-pointer items-center">
							<input
								type="checkbox"
								name="enabled"
								checked={config.enabled === 1}
								class="h-4 w-4 rounded border-input text-primary focus:ring-ring"
							/>
							<span class="ml-2 text-sm text-foreground">Enabled</span>
						</label>
					</div>

					<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label for="threshold_{config.type}" class="block text-sm font-medium text-foreground">
								Threshold (days)
							</label>
							<input
								type="number"
								name="threshold_days"
								id="threshold_{config.type}"
								min="1"
								value={config.threshold_days}
								class="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>

						{#if config.type === 'assigned_not_started'}
							<div>
								<label for="started_{config.type}" class="block text-sm font-medium text-foreground">
									"Started" means
								</label>
								<select
									name="started_definition"
									id="started_{config.type}"
									value={config.started_definition || 'both'}
									class="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
								>
									<option value="linked_pr">Linked PR exists</option>
									<option value="in_progress_column">Moved to In Progress</option>
									<option value="both">Both</option>
								</select>
							</div>
						{/if}
					</div>

					<div class="mt-4 flex justify-end">
						<Button type="submit" variant="outline" size="sm">Save</Button>
					</div>
				</form>
			{/each}
		</div>
	</section>

	<section class="rounded-lg border bg-card p-6 text-card-foreground">
		<h2 class="text-lg font-semibold text-foreground">Open reminders</h2>

		{#if data.reminders.length === 0}
			<p class="mt-2 text-sm text-muted-foreground">
				No open reminders. Run a scan to check for stale issues and PRs.
			</p>
		{:else}
			<ul class="mt-4 space-y-2">
				{#each data.reminders as reminder (reminder.id)}
					<li class="rounded-md border p-4 transition-colors hover:bg-muted/50">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<a
										href={reminder.github_url}
										target="_blank"
										rel="noopener noreferrer"
										class="truncate font-medium text-foreground hover:underline"
									>
										<span class="font-mono text-muted-foreground">
											{reminder.github_item_type === 'pr' ? 'PR' : 'Issue'} #{reminder.github_item_number}
										</span>
										{reminder.title}
									</a>
									<span
										class="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
									>
										{labelFor(reminder.type)}
									</span>
								</div>
								<p class="mt-1 text-sm text-muted-foreground">{reminder.message}</p>
								{#if reminder.assignee}
									<p class="mt-1 text-xs text-muted-foreground">Assignee: {reminder.assignee}</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-1">
								<DropdownMenu.Root>
									<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'sm' })}>
										Snooze
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item onSelect={() => snooze(reminder.id, 1)}>
											For 1 day
										</DropdownMenu.Item>
										<DropdownMenu.Item onSelect={() => snooze(reminder.id, 3)}>
											For 3 days
										</DropdownMenu.Item>
										<DropdownMenu.Item onSelect={() => snooze(reminder.id, 7)}>
											For 1 week
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>

								<Button
									variant="ghost"
									size="sm"
									class="text-muted-foreground"
									onclick={() => dismiss(reminder.id)}
								>
									Dismiss
								</Button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
