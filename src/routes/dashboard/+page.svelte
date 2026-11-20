<script lang="ts">
	import MarkSeen from '$lib/components/mark-seen.svelte';

	interface Props {
		data: { user: App.Locals['user']; projects: any[] };
	}

	let { data }: Props = $props();

	const visibleIds = $derived(
		data.projects.flatMap((project) => project.reminders.slice(0, 5).map((reminder: any) => reminder.id))
	);

	function reminderTypeLabel(type: string) {
		const labels: Record<string, string> = {
			assigned_not_started: 'Assigned but not started',
			pr_open_too_long: 'PR open too long',
			pr_no_review: 'PR with no review',
			pr_approved_not_merged: 'Approved but not merged',
			stuck_in_column: 'Stuck in column',
			no_activity: 'No activity'
		};
		return labels[type] || type;
	}
</script>

<div class="space-y-8">
	<MarkSeen ids={visibleIds} />

	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
			<p class="text-gray-600">Welcome, {data.user?.github_login ?? 'guest'}</p>
		</div>
		<a href="/projects/new" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
			+ New Project
		</a>
	</div>

	{#if data.projects.length === 0}
		<div class="rounded-lg border border-dashed border-gray-300 p-12 text-center">
			<h3 class="text-lg font-semibold text-gray-900">No projects yet</h3>
			<p class="mt-2 text-gray-600">Create your first project to start receiving reminders.</p>
			<a href="/projects/new" class="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
				Create Project
			</a>
		</div>
	{:else}
		<div class="grid gap-6">
			{#each data.projects as project}
				<div class="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
					<div class="flex items-start justify-between">
						<div>
							<h2 class="text-lg font-semibold text-gray-900">
								<a href="/projects/{project.id}" class="hover:text-indigo-600">{project.name}</a>
							</h2>
							<p class="text-sm text-gray-500">{project.owner}/{project.repo}</p>
						</div>
						<span class="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
							{project.reminders.length} open
						</span>
					</div>

					{#if project.reminders.length > 0}
						<ul class="mt-4 space-y-3">
							{#each project.reminders.slice(0, 5) as reminder}
								<li class="rounded-md bg-gray-50 p-3">
									<div class="flex items-center justify-between">
										<a href={reminder.github_url} target="_blank" class="font-medium text-indigo-600 hover:text-indigo-500">
											#{reminder.github_item_number} {reminder.title}
										</a>
										<span class="text-xs text-gray-500">{reminderTypeLabel(reminder.type)}</span>
									</div>
									<p class="mt-1 text-sm text-gray-700">{reminder.message}</p>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
