<script lang="ts">
	interface Props {
		form?: { error?: string };
	}

	let { form }: Props = $props();
</script>

<div class="max-w-xl mx-auto">
	<h1 class="text-2xl font-bold text-gray-900">Create Project</h1>
	<p class="mt-2 text-gray-600">Link a public GitHub repository to start tracking reminders.</p>

	<form method="POST" class="mt-8 space-y-6">
		<div>
			<label for="name" class="block text-sm font-medium text-gray-700">Project name</label>
			<input
				type="text"
				name="name"
				id="name"
				required
				class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
				placeholder="e.g. TTS Core"
			/>
		</div>

		<div>
			<label for="repoUrl" class="block text-sm font-medium text-gray-700">GitHub repo URL</label>
			<input
				type="url"
				name="repoUrl"
				id="repoUrl"
				required
				class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
				placeholder="https://github.com/owner/repo"
			/>
		</div>

		{#if form?.error}
			<div class="rounded-md bg-red-50 p-3 text-sm text-red-700">{form.error}</div>
		{/if}

		<div class="flex gap-4">
			<a href="/inbox" class="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
				Cancel
			</a>
			<button type="submit" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
				Create Project
			</button>
		</div>
	</form>
</div>
