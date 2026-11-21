<script lang="ts">
	import { attachDragToClose } from '$lib/actions/drag-to-close';
	import * as Sheet from '$lib/components/ui/sheet/index.js';

	interface Props {
		open?: boolean;
		onSelect: (days: number) => void;
	}

	let { open = $bindable(false), onSelect }: Props = $props();

	const options = [
		{ days: 1, label: 'Tomorrow', hint: '1 day' },
		{ days: 3, label: 'In three days', hint: '3 days' },
		{ days: 7, label: 'Next week', hint: '1 week' }
	];

	let contentElement = $state.raw<HTMLDivElement | null>(null);
	let draggedClosed = false;

	$effect(() => {
		if (!contentElement) return;

		return attachDragToClose(contentElement, {
			axis: 'y',
			direction: 1,
			onClose: () => {
				draggedClosed = true;
				open = false;
			}
		});
	});

	// A drag leaves the panel translated off screen; clear that before the
	// next open so the built-in entrance animation starts from its place.
	$effect(() => {
		if (!open || !draggedClosed || !contentElement) return;

		draggedClosed = false;
		contentElement.style.transform = '';
		contentElement.style.transition = '';
		contentElement.style.animation = '';
		contentElement.style.willChange = '';
		contentElement.style.userSelect = '';
	});

	function select(days: number) {
		open = false;
		onSelect(days);
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		bind:ref={contentElement}
		side="bottom"
		showCloseButton={false}
		class="gap-3 rounded-t-2xl px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
	>
		<div class="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true"></div>

		<Sheet.Header class="gap-1 text-left">
			<Sheet.Title class="text-sm font-semibold">Snooze reminder</Sheet.Title>
			<Sheet.Description class="text-xs">
				It leaves the inbox now and comes back when the snooze ends.
			</Sheet.Description>
		</Sheet.Header>

		<div class="grid gap-1.5">
			{#each options as option (option.days)}
				<button
					type="button"
					class="flex min-h-11 items-center justify-between rounded-lg border px-3 text-left text-sm transition-colors hover:bg-muted active:bg-accent"
					onclick={() => select(option.days)}
				>
					<span>{option.label}</span>
					<span class="text-xs text-muted-foreground">{option.hint}</span>
				</button>
			{/each}
		</div>
	</Sheet.Content>
</Sheet.Root>
