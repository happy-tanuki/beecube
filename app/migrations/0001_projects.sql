-- Shared projects. The project JSON itself is in R2 under projects/<id>.json.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL,
  -- SHA-256 (hex) of the edit key handed to the sharer; the key itself is never stored.
  edit_key_hash TEXT NOT NULL,
  -- 'shared', or 'hidden' (by reports or a moderator): hidden projects are not served.
  status TEXT NOT NULL DEFAULT 'shared',
  reports INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX projects_moderation ON projects (status, reports);

-- One row per report. No information about the reporter is kept.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX reports_project ON reports (project_id);
