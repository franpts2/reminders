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
	getBoardByProject,
	upsertProjectBoard,
	deleteBoardByProject,
	REMINDER_TYPES
} from '$lib/db';
import { hasProjectScope } from '$lib/auth';
import { BoardError, isBoardMetricsEnabled, parseBoardUrl, resolveBoard } from '$lib/board-connect';

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

	return { db: env.DB, env, project };
}

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	const { db, env, project } = await requireOwnedProject(params, locals, platform);

	const [configs, counts, scans, board] = await Promise.all([
		getReminderConfigsByProject(db, project.id),
		getOpenReminderCounts(db, project.id),
		getRecentScansByProject(db, project.id),
		getBoardByProject(db, project.id)
	]);

	return {
		project,
		configs,
		counts,
		scans,
		reminderTypes: REMINDER_TYPES,
		board,
		boardFeatureEnabled: isBoardMetricsEnabled(env),
		boardScopeGranted: hasProjectScope(locals.user)
	};
};

async function readBoardTarget(request: Request) {
	const formData = await request.formData();
	const boardUrl = String(formData.get('board_url') ?? '').trim();
	if (!boardUrl) throw new BoardError('invalid_url', 'Paste a board URL first.');
	return { formData, boardUrl, target: parseBoardUrl(boardUrl) };
}

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
	},

	previewBoard: async ({ request, params, locals, platform }) => {
		const { env } = await requireOwnedProject(params, locals, platform);
		if (!isBoardMetricsEnabled(env)) {
			return fail(404, { boardError: 'Sprint board metrics are not enabled.' });
		}
		if (!locals.user) throw redirect(302, '/');
		if (!hasProjectScope(locals.user)) {
			return fail(403, {
				boardError: 'GitHub has not granted board access yet. Reconnect GitHub, then try again.',
				needsScope: true
			});
		}

		try {
			const { boardUrl, target } = await readBoardTarget(request);
			const resolved = await resolveBoard(locals.user.access_token, target);

			if (!resolved.iterationField) {
				return fail(400, {
					boardError:
						'That board has no iteration field. Add an iteration field on GitHub, then try again.'
				});
			}

			return {
				boardPreview: {
					url: boardUrl,
					title: resolved.title,
					owner: resolved.owner,
					number: resolved.number,
					iterationFieldId: resolved.iterationField.id,
					iterationFields: resolved.iterationFields.map(({ id, name }) => ({ id, name })),
					statusFieldId: resolved.statusField?.id ?? null,
					statusFields: resolved.statusFields.map(({ id, name }) => ({ id, name }))
				}
			};
		} catch (cause) {
			if (cause instanceof BoardError) return fail(400, { boardError: cause.message });
			throw error(500, 'Could not read that board.');
		}
	},

	connectBoard: async ({ request, params, locals, platform }) => {
		const { db, env, project } = await requireOwnedProject(params, locals, platform);
		if (!isBoardMetricsEnabled(env)) {
			return fail(404, { boardError: 'Sprint board metrics are not enabled.' });
		}
		if (!locals.user) throw redirect(302, '/');
		if (!hasProjectScope(locals.user)) {
			return fail(403, {
				boardError: 'GitHub has not granted board access yet. Reconnect GitHub, then try again.',
				needsScope: true
			});
		}

		try {
			const { formData, target } = await readBoardTarget(request);
			const iterationFieldId = String(formData.get('iteration_field_id') ?? '');
			const statusFieldId = String(formData.get('status_field_id') ?? '');
			if (!iterationFieldId) return fail(400, { boardError: 'Choose an iteration field.' });

			// Re-read the board instead of trusting the preview fields.
			const resolved = await resolveBoard(locals.user.access_token, target);
			const iterationField = resolved.iterationFields.find(
				(field) => field.id === iterationFieldId
			);
			if (!iterationField) {
				return fail(400, {
					boardError: 'That iteration field is no longer on the board. Find the board again.'
				});
			}

			const statusField = statusFieldId
				? (resolved.statusFields.find((field) => field.id === statusFieldId) ?? null)
				: null;
			if (statusFieldId && !statusField) {
				return fail(400, {
					boardError: 'That Status field is no longer on the board. Find the board again.'
				});
			}

			const doneOptionName =
				statusField?.options.find((option) => option.name.toLowerCase() === 'done')?.name ?? null;

			await upsertProjectBoard(db, {
				project_id: project.id,
				owner_login: resolved.owner,
				owner_type: resolved.ownerType,
				project_number: resolved.number,
				project_node_id: resolved.projectNodeId,
				iteration_field_id: iterationField.id,
				iteration_field_name: iterationField.name,
				status_field_id: statusField?.id ?? null,
				status_field_name: statusField?.name ?? null,
				done_option_name: doneOptionName
			});

			return { boardConnected: true };
		} catch (cause) {
			if (cause instanceof BoardError) return fail(400, { boardError: cause.message });
			throw error(500, 'Could not connect that board.');
		}
	},

	disconnectBoard: async ({ params, locals, platform }) => {
		const { db, env, project } = await requireOwnedProject(params, locals, platform);
		if (!isBoardMetricsEnabled(env)) {
			return fail(404, { boardError: 'Sprint board metrics are not enabled.' });
		}

		await deleteBoardByProject(db, project.id);
		return { boardDisconnected: true };
	}
};
