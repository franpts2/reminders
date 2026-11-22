-- New rule: a pull request whose change request has not been followed by a
-- commit. New projects get the row from ensureDefaultReminderConfigs, but
-- existing projects need it backfilled or the settings page has no config to
-- render. The rule starts disabled, like every other rule.

INSERT OR IGNORE INTO reminder_configs
	(id, project_id, type, enabled, threshold_days, started_definition)
SELECT lower(hex(randomblob(16))), id, 'pr_changes_requested', 0, 3, NULL
FROM projects;
