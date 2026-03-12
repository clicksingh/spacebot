//! Tool for saving working state from within a memory persistence branch.

use crate::working_state::{WorkingStateInput, WorkingStateStore};
use rig::completion::ToolDefinition;
use rig::tool::Tool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct WorkingStateSaveTool {
    store: Arc<WorkingStateStore>,
    channel_id: String,
}

impl WorkingStateSaveTool {
    pub fn new(store: Arc<WorkingStateStore>, channel_id: impl Into<String>) -> Self {
        Self {
            store,
            channel_id: channel_id.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("working_state_save failed: {0}")]
pub struct WorkingStateSaveError(String);

#[derive(Debug, Deserialize, JsonSchema)]
pub struct WorkingStateSaveArgs {
    /// What task is currently in progress. One clear sentence. Example:
    /// "Debugging opencode PATH issue in WSL worker environments."
    pub task: String,

    /// What has been done so far. Concise. Example:
    /// "Confirmed opencode binary at /home/click/.opencode/bin/opencode. RTK wrapper created. Config updated."
    #[serde(default)]
    pub progress: Option<String>,

    /// What comes next. Actionable. Example:
    /// "Restart spacebot and test by asking agent to run opencode."
    #[serde(default)]
    pub next: Option<String>,

    /// Anything stuck, blocked, or waiting. Omit if nothing is blocked.
    #[serde(default)]
    pub blockers: Option<String>,

    /// Relevant technical details: paths, commands, errors, env facts.
    /// Omit if not applicable.
    #[serde(default)]
    pub context: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WorkingStateSaveOutput {
    pub success: bool,
}

impl Tool for WorkingStateSaveTool {
    const NAME: &'static str = "working_state_save";

    type Error = WorkingStateSaveError;
    type Args = WorkingStateSaveArgs;
    type Output = WorkingStateSaveOutput;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "Save the current working state for session continuity. \
                Call this FIRST in every memory persistence run, before memory_recall or memory_save. \
                This is what lets the agent resume after a restart or context compaction. \
                Describe the active task, progress, and next steps concisely. \
                If no task is in progress (idle conversation), set task to 'idle' and omit progress/next."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "What task is currently in progress. One clear sentence."
                    },
                    "progress": {
                        "type": "string",
                        "description": "What has been done so far. Concise bullet points or short sentence."
                    },
                    "next": {
                        "type": "string",
                        "description": "What comes next. Actionable and specific."
                    },
                    "blockers": {
                        "type": "string",
                        "description": "Anything stuck or waiting. Omit if nothing is blocked."
                    },
                    "context": {
                        "type": "string",
                        "description": "Relevant technical details: paths, commands, error messages. Omit if not applicable."
                    }
                },
                "required": ["task"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let progress = args
            .progress
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "none".to_string());
        let next = args
            .next
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "none".to_string());

        let input = WorkingStateInput {
            channel_id: self.channel_id.clone(),
            task: args.task,
            progress,
            next,
            blockers: args.blockers,
            context: args.context,
        };

        self.store
            .upsert(&input)
            .await
            .map_err(|e| WorkingStateSaveError(format!("{e}")))?;

        Ok(WorkingStateSaveOutput { success: true })
    }
}
