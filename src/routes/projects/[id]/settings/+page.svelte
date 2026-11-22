<script lang="ts">
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import MenuSelect from '$lib/components/menu-select.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { timeAgo } from '$lib/time';

	interface Props {
		data: any;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();

	let dirty = $state(false);
	let deleteForm: HTMLFormElement;

	// Captured once: afterwards the select owns the value until a save.
	let startedDefinition = $state(
		untrack(
			() =>
				data.configs.find((config: any) => config.type === 'assigned_not_started')
					?.started_definition ?? 'both'
		)
	);

	const STARTED_OPTIONS = [
		{ value: 'linked_pr', label: 'a PR is linked' },
		{ value: 'in_progress_column', label: 'it moves to In Progress' },
		{ value: 'both', label: 'both' }
	];

	const GROUPS = [
		{
			title: 'Issues',
			description: 'Work that has been handed out but has not moved.',
			types: ['assigned_not_started']
		},
		{
			title: 'Pull requests',
			description: 'Reviews, merges and PRs that are sitting too long.',
			types: [
				'pr_open_too_long',
				'pr_no_review',
				'pr_changes_requested',
				'pr_approved_not_merged',
				'pr_conflicts'
			]
		},
		{
			title: 'Activity',
			description: 'Items that have gone quiet or lost traction.',
			types: ['no_activity', 'stuck_in_column']
		}
	];

	function typeFor(key: string) {
		return data.reminderTypes.find((type: any) => type.key === key);
	}

	function configFor(key: string) {
		return data.configs.find((config: any) => config.type === key);
	}

	const enabledCount = $derived(
		data.configs.filter((config: any) => config.enabled === 1).length
	);
</script>

<div class="pb-20">
	<a
		href="/projects/{data.project.id}"
		class={buttonVariants({ variant: 'ghost', size: 'sm', class: '-ml-2 mb-3' })}
	>
		<ArrowLeftIcon class="size-4" />
		{data.project.name}
	</a>

	<h1 class="text-2xl font-bold tracking-tight text-foreground">Reminder rules</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		<span class="font-mono">{data.project.owner}/{data.project.repo}</span>
		· {enabledCount} of {data.reminderTypes.length} rules active. Thresholds apply on the next scan.
	</p>

	{#if form?.error}
		<div class="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{form.error}</div>
	{/if}

	<form
		method="POST"
		action="?/save"
		use:enhance={() => {
			return async ({ result, update }) => {
				await update();

				if (result.type === 'success') {
					dirty = false;
					toast.success('Reminder rules saved');
				} else if (result.type === 'failure') {
					toast.error((result.data as any)?.error ?? 'Could not save the rules');
				}
			};
		}}
		oninput={() => (dirty = true)}
		onchange={() => (dirty = true)}
	>
		{#each GROUPS as group (group.title)}
			<section class="mt-8">
				<header>
					<h2 class="text-sm font-semibold text-foreground">{group.title}</h2>
					<p class="text-xs text-muted-foreground">{group.description}</p>
				</header>

				<div class="mt-3 divide-y rounded-lg border">
					{#each group.types as typeKey (typeKey)}
						{@const type = typeFor(typeKey)}
						{@const config = configFor(typeKey)}
						{@const openNow = data.counts[typeKey] ?? 0}
						{@const unavailable = typeKey === 'stuck_in_column'}
						<div id="rule-{typeKey}" class="scroll-mt-24 p-4 transition-colors">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-sm font-medium text-foreground">{type.label}</h3>
								{#if unavailable}
									<Badge variant="secondary">Not available yet</Badge>
								{:else if openNow > 0}
									<span class="text-xs text-muted-foreground tabular-nums">
										{openNow} open now
									</span>
								{/if}
							</div>

							<div class="mt-1 flex items-start justify-between gap-4">
								<p class="max-w-prose text-xs leading-5 text-muted-foreground">
									{type.description}
								</p>

								<div class="flex shrink-0 items-center">
									<Label for={typeKey} class="sr-only">Enable {type.label}</Label>
									<Switch
										id={typeKey}
										name="enabled_{typeKey}"
										checked={config.enabled === 1}
										disabled={unavailable}
										aria-label="Enable {type.label}"
									/>
								</div>
							</div>

							<div class="mt-3 flex flex-wrap items-center gap-2">
								<Label for="threshold_{typeKey}" class="text-xs text-muted-foreground">
									Alert after
								</Label>
								<Input
									id="threshold_{typeKey}"
									name="threshold_{typeKey}"
									type="number"
									min="1"
									max="365"
									required
									readonly={unavailable}
									class={unavailable
										? 'h-9 w-20 opacity-60 md:h-8'
										: 'h-9 w-20 md:h-8'}
									value={config.threshold_days}
								/>
								<span class="text-xs text-muted-foreground">days</span>

								{#if typeKey === 'assigned_not_started'}
									<span class="ml-1 text-xs text-muted-foreground">· counts as started when</span>
									<MenuSelect
										bind:value={startedDefinition}
										options={STARTED_OPTIONS}
										label="What counts as started"
										onChange={() => (dirty = true)}
									/>
									<input type="hidden" name="started_{typeKey}" value={startedDefinition} />
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<div
			class="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center justify-between gap-4 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
		>
			<p class="text-xs text-muted-foreground">
				{dirty ? 'Unsaved changes' : 'Changes apply on the next scan'}
			</p>
			<Button type="submit">Save changes</Button>
		</div>
	</form>

	<section class="mt-10">
		<h2 class="text-sm font-semibold text-foreground">Recent scans</h2>
		<p class="text-xs text-muted-foreground">The last five runs for this repository.</p>

		{#if data.scans.length === 0}
			<p class="mt-3 text-sm text-muted-foreground">No scans yet.</p>
		{:else}
			<ul class="mt-3 divide-y rounded-lg border text-xs">
				{#each data.scans as scan (scan.id)}
					<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
						<span class="text-foreground">
							{timeAgo(scan.finished_at ?? scan.started_at)}
						</span>
						<span class="text-muted-foreground">
							{scan.items_checked} checked · {scan.reminders_created} new ·
							{scan.reminders_resolved} resolved
						</span>
						{#if !scan.finished_at}
							<span class="text-muted-foreground">running…</span>
						{/if}
						{#if scan.error}
							<span class="text-destructive">failed</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mt-10 rounded-lg border border-destructive/30 p-5">
		<div class="flex items-center justify-between gap-4">
			<div class="min-w-0 flex-1">
				<h2 class="text-sm font-semibold text-destructive">Danger zone</h2>
				<p class="mt-1 text-pretty text-xs leading-5 text-muted-foreground">
					Deleting this project removes its reminders, rules and scan history. Nothing on GitHub is
					changed.
				</p>
			</div>

			<AlertDialog.Root>
				<AlertDialog.Trigger
					class={buttonVariants({
						variant: 'outline',
						size: 'sm',
						class: 'shrink-0 text-destructive hover:text-destructive'
					})}
				>
					Delete project
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Delete {data.project.name}?</AlertDialog.Title>
						<AlertDialog.Description>
							This deletes {data.project.owner}/{data.project.repo} from your inbox, along with every
							reminder and scan record. It cannot be undone.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
						<AlertDialog.Action variant="destructive" onclick={() => deleteForm?.requestSubmit()}>
							Delete project
						</AlertDialog.Action>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</div>

		<form bind:this={deleteForm} method="POST" action="?/delete" use:enhance class="hidden"></form>
	</section>
</div>
