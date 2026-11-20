<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';

	interface Props {
		data: { user?: App.Locals['user'] };
		children: Snippet;
	}

	let { data, children }: Props = $props();
</script>

<div class="min-h-screen">
	<nav class="bg-white border-b border-gray-200">
		<div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
			<div class="flex justify-between h-16">
				<div class="flex items-center">
					<a href="/" class="text-xl font-bold text-gray-900">GitHub PM Reminders</a>
				</div>
				<div class="flex items-center gap-4">
					{#if data.user}
						<a href="/dashboard" class="text-sm font-medium text-gray-700 hover:text-gray-900">Dashboard</a>
						<form method="POST" action="/auth/logout">
							<button type="submit" class="text-sm font-medium text-gray-700 hover:text-gray-900">Sign out</button>
						</form>
					{:else}
						<a href="/auth/github" class="text-sm font-medium text-gray-700 hover:text-gray-900">Sign in with GitHub</a>
					{/if}
				</div>
			</div>
		</div>
	</nav>

	<main class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
		{@render children()}
	</main>
</div>
