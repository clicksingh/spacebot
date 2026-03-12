//! Working state store: short-term session continuity per channel.
//!
//! One row per channel. Always upserted, never appended. Loaded directly
//! into the system prompt at the top of every turn - no vector search.

use crate::error::Result;
use anyhow::Context as _;
use serde::{Deserialize, Serialize};
use sqlx::{Row as _, SqlitePool};
use std::sync::Arc;

const MAX_TASK_CHARS: usize = 400;
const MAX_PROGRESS_CHARS: usize = 2_000;
const MAX_NEXT_CHARS: usize = 800;
const MAX_BLOCKERS_CHARS: usize = 800;
const MAX_CONTEXT_CHARS: usize = 4_000;

fn render_labeled_field(out: &mut String, label: &str, value: &str) {
    let mut lines = value.lines();
    match lines.next() {
        Some(first_line) => {
            out.push_str(&format!("**{label}:** {first_line}\n"));
            for line in lines {
                out.push_str(&format!("    {line}\n"));
            }
        }
        None => {
            out.push_str(&format!("**{label}:**\n"));
        }
    }
}

fn clamp_field(value: &str, max_chars: usize, field_name: &str) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.to_string();
    }

    tracing::warn!(
        field = field_name,
        original_chars = char_count,
        max_chars,
        "working_state field exceeded size budget and was truncated"
    );

    value.chars().take(max_chars).collect()
}

fn normalize_optional(
    value: &Option<String>,
    max_chars: usize,
    field_name: &str,
) -> Option<String> {
    value
        .as_ref()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| clamp_field(item, max_chars, field_name))
}

/// Current task state for a channel. Structured so the LLM writes consistent
/// summaries and so the injected context is easy for the model to parse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingState {
    /// Channel this state belongs to.
    pub channel_id: String,
    /// What task is currently in progress. One clear sentence.
    pub task: String,
    /// What has been done so far. Concise - bullet points or a short sentence.
    pub progress: String,
    /// What comes next. Actionable and specific.
    pub next: String,
    /// Anything stuck, blocked, or waiting for input. None if nothing is blocked.
    pub blockers: Option<String>,
    /// Relevant technical details: file paths, commands, error messages,
    /// environment facts. None if not applicable.
    pub context: Option<String>,
    /// Monotonic snapshot sequence assigned at branch spawn time.
    pub snapshot_seq: i64,
    /// When this was last written.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl WorkingState {
    /// Render the working state as a Markdown block for injection into
    /// the system prompt. Called from `build_system_prompt`.
    pub fn render(&self) -> String {
        let mut out = String::new();

        render_labeled_field(&mut out, "Task", &self.task);
        render_labeled_field(&mut out, "Progress", &self.progress);
        render_labeled_field(&mut out, "Next", &self.next);

        if let Some(ref blockers) = self.blockers {
            render_labeled_field(&mut out, "Blockers", blockers);
        }
        if let Some(ref context) = self.context {
            render_labeled_field(&mut out, "Context", context);
        }

        // Age note so the model knows how stale this is.
        let age = chrono::Utc::now()
            .signed_duration_since(self.updated_at)
            .num_minutes();
        if age < 60 {
            out.push_str(&format!("*Updated {} minute(s) ago.*\n", age));
        } else if age < 1440 {
            out.push_str(&format!("*Updated {} hour(s) ago.*\n", age / 60));
        } else {
            out.push_str(&format!(
                "*Updated {} day(s) ago - may be stale.*\n",
                age / 1440
            ));
        }

        out
    }
}

/// Store for working state. Wraps SQLite pool. Cheap to clone (Arc inside).
#[derive(Debug, Clone)]
pub struct WorkingStateStore {
    pool: Arc<SqlitePool>,
}

impl WorkingStateStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool: Arc::new(pool),
        }
    }

    /// Upsert the working state for a channel. Replaces any existing row.
    pub async fn upsert(&self, state: &WorkingStateInput) -> Result<()> {
        let task_raw = state.task.trim();
        let progress_raw = state.progress.trim();
        let next_raw = state.next.trim();

        let is_idle = task_raw.is_empty() || task_raw.eq_ignore_ascii_case("idle");

        let task = if is_idle {
            "idle".to_string()
        } else {
            clamp_field(task_raw, MAX_TASK_CHARS, "task")
        };
        let progress = if is_idle || progress_raw.is_empty() {
            "none".to_string()
        } else {
            clamp_field(progress_raw, MAX_PROGRESS_CHARS, "progress")
        };
        let next = if is_idle || next_raw.is_empty() {
            "none".to_string()
        } else {
            clamp_field(next_raw, MAX_NEXT_CHARS, "next")
        };
        let blockers = if is_idle {
            None
        } else {
            normalize_optional(&state.blockers, MAX_BLOCKERS_CHARS, "blockers")
        };
        let context = if is_idle {
            None
        } else {
            normalize_optional(&state.context, MAX_CONTEXT_CHARS, "context")
        };
        let snapshot_seq = state.snapshot_seq.max(0);

        sqlx::query(
            r#"
            INSERT INTO working_state (
                channel_id, task, progress, next, blockers, context, snapshot_seq, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(channel_id) DO UPDATE SET
                task       = excluded.task,
                progress   = excluded.progress,
                next       = excluded.next,
                blockers   = excluded.blockers,
                context    = excluded.context,
                snapshot_seq = excluded.snapshot_seq,
                updated_at = CURRENT_TIMESTAMP
            WHERE excluded.snapshot_seq >= working_state.snapshot_seq
            "#,
        )
        .bind(&state.channel_id)
        .bind(&task)
        .bind(&progress)
        .bind(&next)
        .bind(&blockers)
        .bind(&context)
        .bind(snapshot_seq)
        .execute(self.pool.as_ref())
        .await
        .with_context(|| {
            format!(
                "failed to upsert working state for channel {}",
                state.channel_id
            )
        })?;

        Ok(())
    }

    /// Get the working state for a channel. Returns None if no state exists
    /// or if the state is older than `max_age_hours`.
    pub async fn get(&self, channel_id: &str, max_age_hours: i64) -> Result<Option<WorkingState>> {
        let row = sqlx::query(
            r#"
            SELECT channel_id, task, progress, next, blockers, context, snapshot_seq, updated_at
            FROM working_state
            WHERE channel_id = ?
              AND updated_at > datetime('now', ? || ' hours')
            "#,
        )
        .bind(channel_id)
        .bind(format!("-{}", max_age_hours))
        .fetch_optional(self.pool.as_ref())
        .await
        .with_context(|| format!("failed to get working state for channel {}", channel_id))?;

        Ok(row.map(|r| WorkingState {
            channel_id: r.get::<String, _>("channel_id"),
            task: r.get::<String, _>("task"),
            progress: r.get::<String, _>("progress"),
            next: r.get::<String, _>("next"),
            blockers: r.get::<Option<String>, _>("blockers"),
            context: r.get::<Option<String>, _>("context"),
            snapshot_seq: r.get::<i64, _>("snapshot_seq"),
            updated_at: r.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        }))
    }

    pub async fn latest_snapshot_seq(&self, channel_id: &str) -> Result<i64> {
        let row = sqlx::query("SELECT snapshot_seq FROM working_state WHERE channel_id = ?")
            .bind(channel_id)
            .fetch_optional(self.pool.as_ref())
            .await
            .with_context(|| {
                format!(
                    "failed to load latest working-state snapshot sequence for channel {}",
                    channel_id
                )
            })?;

        Ok(row
            .map(|record| record.get::<i64, _>("snapshot_seq"))
            .unwrap_or(0))
    }

    /// Clear working state for a channel (e.g. when a task is marked complete).
    pub async fn clear(&self, channel_id: &str) -> Result<()> {
        sqlx::query("DELETE FROM working_state WHERE channel_id = ?")
            .bind(channel_id)
            .execute(self.pool.as_ref())
            .await
            .with_context(|| format!("failed to clear working state for channel {}", channel_id))?;
        Ok(())
    }
}

/// Input for upserting working state. Used by the tool.
#[derive(Debug, Clone)]
pub struct WorkingStateInput {
    pub channel_id: String,
    pub snapshot_seq: i64,
    pub task: String,
    pub progress: String,
    pub next: String,
    pub blockers: Option<String>,
    pub context: Option<String>,
}
