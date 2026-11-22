<script lang="ts">
	import { buttonVariants } from '$lib/components/ui/button/index.js';
</script>

<div class="mx-auto flex max-w-2xl flex-1 flex-col justify-center px-4 py-16 text-center">
	<p class="text-xs font-medium uppercase tracking-widest text-muted-foreground">Reminders</p>
	<h1 class="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
		Know what needs attention, without opening GitHub.
	</h1>
	<p class="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
		Connect a repository and get one queue of assigned issues that never started, pull requests
		waiting on review, and work that has gone quiet.
	</p>
	<div class="mt-8 flex justify-center">
		<a href="/auth/github" class={buttonVariants({ size: 'lg' })}>Sign in with GitHub</a>
	</div>
</div>
