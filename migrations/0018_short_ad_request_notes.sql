-- Separate note recovery from lead delivery to prevent duplicate Jobber Requests.
CREATE TABLE IF NOT EXISTS short_ad_request_notes (
  submission_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
