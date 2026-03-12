-- Working state table: one row per channel, always overwritten.
-- Stores the agent's current task context for cross-restart continuity.
CREATE TABLE IF NOT EXISTS working_state (
    channel_id TEXT PRIMARY KEY,
    task       TEXT NOT NULL,
    progress   TEXT NOT NULL,
    next       TEXT NOT NULL,
    blockers   TEXT,
    context    TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Persisted message count per channel for memory persistence triggering.
-- Survives restarts so the first persistence branch fires at the right time.
CREATE TABLE IF NOT EXISTS channel_message_counts (
    channel_id    TEXT PRIMARY KEY,
    message_count INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);