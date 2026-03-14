CREATE TABLE IF NOT EXISTS channel_runs (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    tool_calls_json TEXT NOT NULL DEFAULT '[]',
    tool_calls_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channel_runs_channel ON channel_runs(channel_id, started_at);
