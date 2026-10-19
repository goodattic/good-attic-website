CREATE TABLE IF NOT EXISTS closed_loop_stage2_historical_appointments (
 market_key TEXT NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY(market_key,request_id)
);
CREATE TABLE IF NOT EXISTS closed_loop_stage2_runs (
 run_id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at TEXT NOT NULL,
 completed_at TEXT, status TEXT NOT NULL, events_processed INTEGER NOT NULL DEFAULT 0,
 webhooks_processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS closed_loop_stage2_runs_time ON closed_loop_stage2_runs(completed_at,status);
CREATE TABLE IF NOT EXISTS closed_loop_stage2_validation (
 event_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL, result_json TEXT NOT NULL
);
INSERT OR IGNORE INTO closed_loop_stage2_historical_appointments
 SELECT market_key,request_id FROM closed_loop_stage1_events
 WHERE event_name='appointment_set' AND request_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM closed_loop_stage1_control WHERE name='stage2_appointment_start_at');
INSERT OR IGNORE INTO closed_loop_stage2_historical_appointments
 SELECT market_key,object_id FROM closed_loop_stage1_objects
 WHERE object_type='request' AND json_extract(object_json,'$.assessment.startAt') IS NOT NULL
 AND json_extract(object_json,'$.assessment.endAt') IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM closed_loop_stage1_control WHERE name='stage2_appointment_start_at');
INSERT OR IGNORE INTO closed_loop_stage1_control(name,value,updated_at)
 VALUES('stage2_appointment_start_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
