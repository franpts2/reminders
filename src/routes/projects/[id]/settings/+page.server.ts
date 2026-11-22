import { redirect, error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import {
	getProjectById,
	getReminderConfigsByProject,
	getOpenReminderCounts,
	getRecentScansByProject,
	updateReminderConfig,
	resolveRemindersByType,
	deleteReminderConditionsByType,
	deleteProject,
	REMINDER_TYPES
} from '$lib/db';

const MIN_THRESHOLD_DAYS = 1;
const MAX_THRESHOLD_DAYS = 365;
const STARTED_DEFINITIONS = ['linked_pr', 'in_progress_column', 'both'];

async function requireOwnedProject(
	params: { id: string },
	locals: App.Locals,
	platform: App.Platform | undefined
) {
	if (!locals.user) throw redirect(302, '/');

	const env = platform?.env;
	if (!env?.DB) throw error(500, 'Database not configured');

	const project = await getProjectById(env.DB, params.id);
	if (!project || project.created_by_user_id !== locals.user.id) {
		throw error(404, 'Project not found');
	}

	return { db: env.DB, project };
}

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	const { db, project } = await requireOwnedProject(params, locals, platform);

	const [configs, counts, scans] = await Promise.all([
		getReminderConfigsByProject(db, project.id),
		getOpenReminderCounts(db, project.id),
		getRecentScansByProject(db, project.id)
	]);

	return {
		project,
		configs,
		counts,
		scans,
		reminderTypes: REMINDER_TYPES
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals, platform }) => {
		const { db, project } = await requireOwnedProject(params, locals, platform);
		const formData = await request.formData();

		const updates: Array<{
			type: string;
			enabled: number;
			threshold: number;
			started: string | null;
		}> = [];

		for (const type of REMINDER_TYPES) {
			const threshold = Number(formData.get(`threshold_${type.key}`));
			if (
				!Number.isInteger(threshold) ||
				threshold < MIN_THRESHOLD_DAYS ||
				threshold > MAX_THRESHOLD_DAYS
			) {
				return fail(400, {
					error: `${type.label}: the threshold must be between ${MIN_THRESHOLD_DAYS} and ${MAX_THRESHOLD_DAYS} days.`
				});
			}

			const started = String(formData.get(`started_${type.key}`) ?? 'both');
			if (type.key === 'assigned_not_started' && !STARTED_DEFINITIONS.includes(started)) {
				return fail(400, { error: `${type.label}: choose what counts as started.` });
			}

			updates.push({
				type: type.key,
				enabled: formData.has(`enabled_${type.key}`) ? 1 : 0,
				threshold,
				started: type.key === 'assigned_not_started' ? started : null
			});
		}

		for (const update of updates) {
			await updateReminderConfig(db, project.id, update.type, {
				enabled: update.enabled,
				threshold_days: update.threshold,
				started_definition: update.started
			});

			// A disabled rule should not leave its reminders sitting in the
			// inbox, and re-enabling it should start its clocks from scratch.
			if (update.enabled === 0) {
				await resolveRemindersByType(db, project.id, update.type);
				await deleteReminderConditionsByType(db, project.id, update.type);
			}
		}

		return { success: true };
	},

	delete: async ({ params, locals, platform }) => {
		const { db, project } = await requireOwnedProject(params, locals, platform);

		await deleteProject(db, project.id);

		throw redirect(303, '/inbox');
	}
};
