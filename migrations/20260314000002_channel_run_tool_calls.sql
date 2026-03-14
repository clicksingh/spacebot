CREATE TABLE IF NOT EXISTS channel_run_tool_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    name TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '',
    result TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES channel_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_run_tool_calls_run
ON channel_run_tool_calls(run_id, created_at);
