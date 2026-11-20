<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils';

	interface Option {
		value: string;
		label: string;
	}

	interface Props {
		value: string;
		options: Option[];
		label: string;
		align?: 'start' | 'end';
		class?: string;
		onChange?: (value: string) => void;
	}

	let {
		value = $bindable(),
		options,
		label,
		align = 'start',
		class: className,
		onChange
	}: Props = $props();

	const currentLabel = $derived(options.find((option) => option.value === value)?.label ?? value);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={cn(
			'flex h-8 w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-xs whitespace-nowrap outline-none select-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
			className
		)}
		aria-label={label}
	>
		{currentLabel}
		<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
	</DropdownMenu.Trigger>

	<DropdownMenu.Content {align} class="w-auto min-w-44">
		<DropdownMenu.RadioGroup bind:value onValueChange={(next) => onChange?.(next)}>
			{#each options as option (option.value)}
				<DropdownMenu.RadioItem value={option.value} closeOnSelect class="whitespace-nowrap">
					{option.label}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
