-- Merge conflicts have no "since" timestamp on GitHub, so the scanner records
-- when it first saw the condition. Rows are removed when it clears, when the
-- PR closes, or when the rule is disabled.

CREATE TABLE IF NOT EXISTS reminder_conditions (
	project_id TEXT NOT NULL,
	type TEXT NOT NULL,
	github_item_number INTEGER NOT NULL,
	first_seen_at DATETIME NOT NULL,
	PRIMARY KEY (project_id, type, github_item_number),
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- New rule, disabled by default. Backfill the config for existing projects.
INSERT OR IGNORE INTO reminder_configs
	(id, project_id, type, enabled, threshold_days, started_definition)
SELECT lower(hex(randomblob(16))), id, 'pr_conflicts', 0, 3, NULL
FROM projects;
