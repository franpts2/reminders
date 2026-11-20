<script lang="ts">
	import { enhance } from '$app/forms';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	interface Props {
		form?: { error?: string };
	}

	let { form }: Props = $props();

	let creating = $state(false);
</script>

<div class="mx-auto max-w-xl">
	<a
		href="/inbox"
		class={buttonVariants({ variant: 'ghost', size: 'sm', class: '-ml-2 mb-3' })}
	>
		<ArrowLeftIcon class="size-4" />
		Inbox
	</a>

	<h1 class="text-2xl font-bold tracking-tight text-foreground">Create a project</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		Link a public GitHub repository to start tracking its issues and pull requests.
	</p>

	<form
		method="POST"
		use:enhance={() => {
			creating = true;
			return async ({ update }) => {
				await update();
				creating = false;
			};
		}}
		class="mt-8"
	>
		<Field.Group>
			<Field.Field>
				<Field.Label for="name">Project name</Field.Label>
				<Input
					id="name"
					name="name"
					required
					autocomplete="off"
					placeholder="e.g. Core"
					aria-describedby="name-hint"
				/>
				<Field.Description id="name-hint">
					Only used inside this app. The repository keeps its own name.
				</Field.Description>
			</Field.Field>

			<Field.Field>
				<Field.Label for="repoUrl">GitHub repository</Field.Label>
				<Input
					id="repoUrl"
					name="repoUrl"
					type="url"
					required
					autocomplete="off"
					spellcheck={false}
					placeholder="https://github.com/owner/repo"
					aria-describedby="repo-hint"
				/>
				<Field.Description id="repo-hint">
					Public repositories only. Issues and pull requests are read with your GitHub access.
				</Field.Description>
			</Field.Field>
		</Field.Group>

		{#if form?.error}
			<div role="alert" class="mt-6 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
				{form.error}
			</div>
		{/if}

		<div class="mt-8 flex items-center gap-2">
			<Button type="submit" disabled={creating}>
				{creating ? 'Creating…' : 'Create project'}
			</Button>
			<a href="/inbox" class={buttonVariants({ variant: 'ghost' })}>Cancel</a>
		</div>
	</form>
</div>
