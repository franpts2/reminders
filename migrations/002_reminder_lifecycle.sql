-- A reminder now has a lifecycle: open -> dismissed (by the user) or
-- resolved (the condition stopped being true). Snoozing hides an open
-- reminder until a timestamp passes.

ALTER TABLE reminders ADD COLUMN snoozed_until DATETIME;
ALTER TABLE reminders ADD COLUMN dismissed_at DATETIME;
ALTER TABLE reminders ADD COLUMN resolved_at DATETIME;

ALTER TABLE scan_logs ADD COLUMN reminders_resolved INTEGER NOT NULL DEFAULT 0;

-- The old scanner deduplicated with a three day window, so the same item
-- could have several rows. Keep one per (project, type, item), preferring
-- an open row over a dismissed one.
DELETE FROM reminders
WHERE rowid NOT IN (
	SELECT COALESCE(
		MAX(CASE WHEN status = 'open' THEN rowid END),
		MAX(rowid)
	)
	FROM reminders
	GROUP BY project_id, type, github_item_number
);

DROP INDEX IF EXISTS idx_reminders_item;

CREATE UNIQUE INDEX idx_reminders_item ON reminders(project_id, type, github_item_number);
CREATE INDEX idx_reminders_project_lifecycle ON reminders(project_id, status, snoozed_until);
