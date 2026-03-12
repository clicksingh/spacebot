-- Add monotonic sequencing columns to prevent stale async writes from
-- overwriting newer state when completion order differs from creation order.
ALTER TABLE working_state
    ADD COLUMN snapshot_seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE channel_message_counts
    ADD COLUMN message_seq INTEGER NOT NULL DEFAULT 0;
