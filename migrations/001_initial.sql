CREATE TABLE users (
	id TEXT PRIMARY KEY,
	github_id INTEGER NOT NULL UNIQUE,
	github_login TEXT NOT NULL,
	email TEXT,
	avatar_url TEXT,
	access_token TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	owner TEXT NOT NULL,
	repo TEXT NOT NULL,
	created_by_user_id TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE reminder_configs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	type TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	threshold_days INTEGER NOT NULL DEFAULT 3,
	started_definition TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id),
	UNIQUE(project_id, type)
);

CREATE TABLE reminders (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	type TEXT NOT NULL,
	github_item_number INTEGER NOT NULL,
	github_item_type TEXT NOT NULL, -- 'issue' or 'pr'
	github_url TEXT NOT NULL,
	title TEXT NOT NULL,
	assignee TEXT,
	message TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'open', -- 'open', 'seen', 'dismissed'
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	seen_at DATETIME,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE scan_logs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL,
	started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	finished_at DATETIME,
	items_checked INTEGER NOT NULL DEFAULT 0,
	reminders_created INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_reminders_project_status ON reminders(project_id, status);
CREATE INDEX idx_reminders_item ON reminders(project_id, type, github_item_number, status);
