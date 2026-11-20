<script lang="ts">
	interface Props {
		data: { user?: App.Locals['user'] };
	}

	let { data }: Props = $props();
</script>

<div class="text-center py-20">
	<h1 class="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
		GitHub PM Reminders
	</h1>
	<p class="mt-6 text-lg leading-8 text-gray-600 max-w-2xl mx-auto">
		Stay on top of your team's GitHub issues and pull requests. Get reminded when items are assigned but not started, PRs are stale, reviews are missing, and more.
	</p>
	<div class="mt-10 flex items-center justify-center gap-x-6">
		{#if data.user}
			<a href="/dashboard" class="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
				Go to Dashboard
			</a>
		{:else}
			<a href="/auth/github" class="rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">
				Sign in with GitHub
			</a>
		{/if}
	</div>
</div>
