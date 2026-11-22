-- A reminder's age should reflect how long its underlying condition has been
-- true, not when a scan happened to insert the row. Each rule already knows
-- the timestamp it measures in its message ("open for 40 days", "updated 4
-- days ago"); store that anchor so the inbox can show the real stale time.

ALTER TABLE reminders ADD COLUMN stale_since DATETIME;

-- Existing rows have no anchor until the next scan refreshes them.
UPDATE reminders SET stale_since = created_at WHERE stale_since IS NULL;
