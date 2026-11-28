-- Sprint metrics sourced from a GitHub Projects v2 board.
--
-- The board is the source of truth for iteration dates and membership, but it
-- keeps no field history: moving an item between iterations overwrites the
-- previous value. sprints and sprint_items are therefore a cache, and
-- sprint_snapshots is what makes a retro possible after rollover.
--
-- Additive only.

ALTER TABLE users ADD COLUMN oauth_scopes TEXT;

CREATE TABLE project_boards (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL UNIQUE,        -- one board per project in v1
	owner_login TEXT NOT NULL,              -- NIAEFEUP
	owner_type TEXT NOT NULL,               -- 'organization' | 'user'
	project_number INTEGER NOT NULL,
	project_node_id TEXT NOT NULL,
	iteration_field_id TEXT NOT NULL,
	iteration_field_name TEXT NOT NULL,
	status_field_id TEXT,
	status_field_name TEXT,
	done_option_name TEXT,                  -- e.g. 'Done'
	last_synced_at DATETIME,
	last_sync_error TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE sprints (
	id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL,
	iteration_id TEXT NOT NULL,
	title TEXT NOT NULL,
	start_date TEXT NOT NULL,               -- YYYY-MM-DD
	duration_days INTEGER NOT NULL,
	end_date TEXT NOT NULL,                 -- start + duration, exclusive
	state TEXT NOT NULL,                    -- 'upcoming' | 'active' | 'completed'
	baseline_locked_at DATETIME,
	baseline_approximate INTEGER NOT NULL DEFAULT 0,
	closed_at DATETIME,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(board_id, iteration_id),
	FOREIGN KEY (board_id) REFERENCES project_boards(id)
);

CREATE TABLE sprint_items (
	id TEXT PRIMARY KEY,
	sprint_id TEXT NOT NULL,
	project_item_id TEXT NOT NULL,
	repo_full_name TEXT,                    -- null for draft issues
	item_type TEXT NOT NULL,                -- 'issue' | 'pr' | 'draft'
	number INTEGER,
	title TEXT NOT NULL,
	status TEXT,
	assignee TEXT,
	labels TEXT,                            -- JSON array
	content_state TEXT,                     -- OPEN | CLOSED | MERGED
	state_reason TEXT,                      -- COMPLETED | NOT_PLANNED | null
	is_archived INTEGER NOT NULL DEFAULT 0,
	iteration_assigned_at DATETIME,         -- from the iteration value's createdAt
	is_committed INTEGER NOT NULL DEFAULT 0,
	first_seen_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	closed_at DATETIME,
	merged_at DATETIME,
	UNIQUE(sprint_id, project_item_id),
	FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE TABLE sprint_snapshots (
	id TEXT PRIMARY KEY,
	sprint_id TEXT NOT NULL,
	project_item_id TEXT NOT NULL,
	snapshotted_on TEXT NOT NULL,           -- YYYY-MM-DD
	iteration_id TEXT,
	status TEXT,
	is_done INTEGER NOT NULL,
	UNIQUE(sprint_id, project_item_id, snapshotted_on),
	FOREIGN KEY (sprint_id) REFERENCES sprints(id)
);

CREATE TABLE board_sync_logs (
	id TEXT PRIMARY KEY,
	board_id TEXT NOT NULL,
	started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	finished_at DATETIME,
	items_seen INTEGER NOT NULL DEFAULT 0,
	items_redacted INTEGER NOT NULL DEFAULT 0,
	sprints_synced INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	stats_json TEXT,                        -- hygiene counters for the UI
	FOREIGN KEY (board_id) REFERENCES project_boards(id)
);

CREATE INDEX idx_sprints_board_window ON sprints(board_id, start_date);
CREATE INDEX idx_sprint_items_sprint ON sprint_items(sprint_id);
CREATE INDEX idx_sprint_items_status ON sprint_items(sprint_id, is_committed, status);
CREATE INDEX idx_sprint_snapshots_sprint_day ON sprint_snapshots(sprint_id, snapshotted_on);
