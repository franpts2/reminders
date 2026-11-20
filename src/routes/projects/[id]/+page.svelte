<script lang="ts">
	interface Props {
		data: any;
		form?: { error?: string };
	}

	let { data, form }: Props = $props();

	function labelFor(type: string) {
		return data.reminderTypeLabels.find((t: any) => t.key === type)?.label || type;
	}

	function descriptionFor(type: string) {
		return data.reminderTypeLabels.find((t: any) => t.key === type)?.description || '';
	}
</script>

<div class="space-y-8">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">{data.project.name}</h1>
			<p class="text-gray-600">{data.project.owner}/{data.project.repo}</p>
		</div>
		<form method="POST" action="?/scanNow">
			<button type="submit" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
				Scan now
			</button>
		</form>
	</div>

	{#if form?.error}
		<div class="rounded-md bg-red-50 p-3 text-sm text-red-700">{form.error}</div>
	{/if}

	<section class="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
		<h2 class="text-lg font-semibold text-gray-900">Reminder settings</h2>
		<p class="text-sm text-gray-600">Choose which reminders to enable and set thresholds.</p>

		<div class="mt-6 space-y-6">
			{#each data.configs as config}
				<form method="POST" action="?/updateConfig" class="rounded-md border border-gray-200 p-4">
					<input type="hidden" name="type" value={config.type} />
					<div class="flex items-start justify-between gap-4">
						<div class="flex-1">
							<h3 class="font-medium text-gray-900">{labelFor(config.type)}</h3>
							<p class="text-sm text-gray-500">{descriptionFor(config.type)}</p>
						</div>
						<label class="inline-flex items-center cursor-pointer">
							<input
								type="checkbox"
								name="enabled"
								checked={config.enabled === 1}
								class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
							/>
							<span class="ml-2 text-sm text-gray-700">Enabled</span>
						</label>
					</div>

					<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label for="threshold_{config.type}" class="block text-sm font-medium text-gray-700">
								Threshold (days)
							</label>
							<input
								type="number"
								name="threshold_days"
								id="threshold_{config.type}"
								min="1"
								value={config.threshold_days}
								class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
							/>
						</div>

						{#if config.type === 'assigned_not_started'}
							<div>
								<label for="started_{config.type}" class="block text-sm font-medium text-gray-700">
									"Started" means
								</label>
								<select
									name="started_definition"
									id="started_{config.type}"
									value={config.started_definition || 'both'}
									class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-indigo-500"
								>
									<option value="linked_pr">Linked PR exists</option>
									<option value="in_progress_column">Moved to In Progress</option>
									<option value="both">Both</option>
								</select>
							</div>
						{/if}
					</div>

					<div class="mt-4 flex justify-end">
						<button type="submit" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
							Save
						</button>
					</div>
				</form>
			{/each}
		</div>
	</section>

	<section class="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
		<h2 class="text-lg font-semibold text-gray-900">Open reminders</h2>

		{#if data.reminders.length === 0}
			<p class="mt-2 text-gray-600">No open reminders. Run a scan to check for stale issues and PRs.</p>
		{:else}
			<ul class="mt-4 space-y-3">
				{#each data.reminders as reminder}
					<li class="rounded-md bg-gray-50 p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<a href={reminder.github_url} target="_blank" class="font-medium text-indigo-600 hover:text-indigo-500">
										#{reminder.github_item_number} {reminder.title}
									</a>
									<span class="text-xs text-gray-500">{labelFor(reminder.type)}</span>
								</div>
								<p class="mt-1 text-sm text-gray-700">{reminder.message}</p>
								{#if reminder.assignee}
									<p class="mt-1 text-xs text-gray-500">Assignee: {reminder.assignee}</p>
								{/if}
							</div>
							<form method="POST" action="?/dismissReminder">
								<input type="hidden" name="reminderId" value={reminder.id} />
								<button type="submit" class="text-sm text-gray-500 hover:text-gray-700">Dismiss</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
