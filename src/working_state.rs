//! Working state store: short-term session continuity per channel.
//!
//! One row per channel. Always upserted, never appended. Loaded directly
//! into the system prompt at the top of every turn - no vector search.

use crate::error::Result;
use anyhow::Context as _;
use serde::{Deserialize, Serialize};
use sqlx::{Row as _, SqlitePool};
use std::sync::Arc;

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
    /// When this was last written.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl WorkingState {
    /// Render the working state as a Markdown block for injection into
    /// the system prompt. Called from `build_system_prompt`.
    pub fn render(&self) -> String {
        let mut out = String::new();

        out.push_str(&format!("**Task:** {}\n", self.task));
        out.push_str(&format!("**Progress:** {}\n", self.progress));
        out.push_str(&format!("**Next:** {}\n", self.next));

        if let Some(ref b) = self.blockers {
            out.push_str(&format!("**Blockers:** {}\n", b));
        }
        if let Some(ref c) = self.context {
            out.push_str(&format!("**Context:** {}\n", c));
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
        sqlx::query(
            r#"
            INSERT INTO working_state (channel_id, task, progress, next, blockers, context, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(channel_id) DO UPDATE SET
                task       = excluded.task,
                progress   = excluded.progress,
                next       = excluded.next,
                blockers   = excluded.blockers,
                context    = excluded.context,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&state.channel_id)
        .bind(&state.task)
        .bind(&state.progress)
        .bind(&state.next)
        .bind(&state.blockers)
        .bind(&state.context)
        .execute(self.pool.as_ref())
        .await
        .with_context(|| format!("failed to upsert working state for channel {}", state.channel_id))?;

        Ok(())
    }

    /// Get the working state for a channel. Returns None if no state exists
    /// or if the state is older than `max_age_hours`.
    pub async fn get(&self, channel_id: &str, max_age_hours: i64) -> Result<Option<WorkingState>> {
        let row = sqlx::query(
            r#"
            SELECT channel_id, task, progress, next, blockers, context, updated_at
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
            updated_at: r.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        }))
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
    pub task: String,
    pub progress: String,
    pub next: String,
    pub blockers: Option<String>,
    pub context: Option<String>,
}
