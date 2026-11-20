<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { mode, resetMode, setMode, userPrefersMode } from 'mode-watcher';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'icon', class: 'relative' })}>
		<SunIcon class="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
		<MoonIcon class="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
		<span class="sr-only">Change theme</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-40">
		<DropdownMenu.Item onSelect={() => setMode('light')}>
			<SunIcon />
			Light
			{#if mode.current === 'light'}<CheckIcon class="ml-auto" />{/if}
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => setMode('dark')}>
			<MoonIcon />
			Dark
			{#if mode.current === 'dark'}<CheckIcon class="ml-auto" />{/if}
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => resetMode()}>
			<MonitorIcon />
			System
			{#if userPrefersMode.current === 'system'}<CheckIcon class="ml-auto" />{/if}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
