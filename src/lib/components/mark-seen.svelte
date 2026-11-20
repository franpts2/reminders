<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';

	interface Props {
		ids: string[];
	}

	let { ids }: Props = $props();

	// Viewing a list of reminders counts as seeing them. This clears the
	// unread badge once the server confirms the write.
	onMount(async () => {
		if (ids.length === 0) return;

		const response = await fetch('/api/reminders/seen', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ids })
		});

		if (response.ok) {
			await invalidateAll();
		}
	});
</script>
