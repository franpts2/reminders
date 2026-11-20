<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import AlarmClockIcon from '@lucide/svelte/icons/alarm-clock';
	import { toast } from 'svelte-sonner';
	import ReminderRow from '$lib/components/reminder-row.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import type { InboxReminder } from '$lib/db';
	import { submitAction } from '$lib/forms';

	interface Props {
		data: {
			reminders: InboxReminder[];
			reminderTypes: Array<{ key: string; short_label: string }>;
		};
	}

	let { data }: Props = $props();

	let removed = $state<string[]>([]);

	const reminders = $derived(data.reminders.filter((reminder) => !removed.includes(reminder.id)));

	function shortLabelFor(type: string) {
		return data.reminderTypes.find((candidate) => candidate.key === type)?.short_label ?? type;
	}

	async function unsnooze(id: string) {
		removed = [...removed, id];

		const result = await submitAction('?/unsnooze', { reminderId: id });

		if (result.type === 'success') {
			toast.success('Back in the inbox');
		} else {
			removed = removed.filter((removedId) => removedId !== id);
			toast.error('Could not unsnooze that reminder');
		}
	}

	async function dismiss(id: string) {
		removed = [...removed, id];

		const result = await submitAction('?/dismiss', { reminderId: id });

		if (result.type !== 'success') {
			removed = removed.filter((removedId) => removedId !== id);
			toast.error('Could not dismiss that reminder');
			return;
		}

		toast('Reminder dismissed', {
			action: { label: 'Undo', onClick: () => unsnooze(id) }
		});
	}
</script>

<div class="flex flex-col">
	<a
		href="/inbox"
		class={buttonVariants({ variant: 'ghost', size: 'sm', class: '-ml-2 self-start' })}
	>
		<ArrowLeftIcon class="size-4" />
		Inbox
	</a>

	<h1 class="mt-3 text-lg font-semibold tracking-tight text-foreground">Snoozed</h1>
	<p class="mt-1 text-xs text-muted-foreground">
		They return to the inbox on their own. Unsnooze brings one back now.
	</p>

	{#if reminders.length === 0}
		<Empty.Root class="border-0 py-20">
			<Empty.Media variant="icon">
				<AlarmClockIcon />
			</Empty.Media>
			<Empty.Title>Nothing snoozed</Empty.Title>
			<Empty.Description>
				Reminders you snooze wait here until their time is up.
			</Empty.Description>
			<Empty.Content>
				<a href="/inbox" class={buttonVariants({ variant: 'outline', size: 'sm' })}>
					Back to the inbox
				</a>
			</Empty.Content>
		</Empty.Root>
	{:else}
		<p class="mt-6 text-xs tabular-nums text-muted-foreground">{reminders.length} waiting</p>
		<ul class="mt-2">
			{#each reminders as reminder (reminder.id)}
				<ReminderRow
					{reminder}
					mode="snoozed"
					typeLabel={shortLabelFor(reminder.type)}
					isNew={false}
					onDismiss={dismiss}
					onUnsnooze={unsnooze}
				/>
			{/each}
		</ul>
	{/if}
</div>
