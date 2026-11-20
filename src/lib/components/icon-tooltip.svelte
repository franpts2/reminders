<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	interface Props {
		label: string;
		side?: 'top' | 'right' | 'bottom' | 'left';
		children: Snippet<[{ props: Record<string, unknown> }]>;
	}

	let { label, side = 'top', children }: Props = $props();
</script>

<Tooltip.Root delayDuration={400}>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			{@render children({ props })}
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content {side}>{label}</Tooltip.Content>
</Tooltip.Root>
