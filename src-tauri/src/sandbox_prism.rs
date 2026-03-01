// Patent Pending — US [application number] (Feb 28, 2026)
// Sandbox Prism — WASM-based Sandboxed Execution with Auto-Rollback
//
// Sandbox Prisms provide isolated execution environments for untrusted
// operations. Each Prism has cryptographic checkpoints enabling automatic
// rollback on failure or policy violation.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ─── Data Models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prism {
    pub id: String,
    pub name: String,
    pub status: PrismStatus,
    pub created_at: String,
    pub checkpoints: Vec<Checkpoint>,
    pub side_effects: Vec<SideEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PrismStatus {
    Ready,
    Running,
    Paused,
    RolledBack,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub prism_id: String,
    pub state_hash: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SideEffect {
    pub effect_type: String,
    pub description: String,
    pub reversible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismResult {
    pub success: bool,
    pub output: String,
    pub side_effects: Vec<SideEffect>,
}

// ─── Prism Lifecycle ───────────────────────────────────────────────────────────

/// Create a new sandboxed Prism execution environment
pub fn create_prism(name: &str) -> Prism {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let mut prism = Prism {
        id,
        name: name.to_string(),
        status: PrismStatus::Ready,
        created_at: now,
        checkpoints: vec![],
        side_effects: vec![],
    };

    // Auto-create initial checkpoint
    let _initial = create_checkpoint(&mut prism);

    prism
}

/// Create a cryptographic checkpoint for rollback support
pub fn create_checkpoint(prism: &mut Prism) -> Checkpoint {
    let state_data = format!("{}:{}:{:?}", prism.id, prism.name, prism.status);
    let hash_bytes = Sha256::digest(state_data.as_bytes());
    let state_hash = hash_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    let checkpoint = Checkpoint {
        id: Uuid::new_v4().to_string(),
        prism_id: prism.id.clone(),
        state_hash,
        created_at: Utc::now().to_rfc3339(),
    };

    prism.checkpoints.push(checkpoint.clone());
    checkpoint
}

/// Rollback a Prism to its last checkpoint
pub fn rollback(prism: &mut Prism) -> Option<Checkpoint> {
    prism.status = PrismStatus::RolledBack;
    prism.side_effects.clear();
    prism.checkpoints.last().cloned()
}

/// Execute a task within the Prism sandbox (stub — WASM runtime planned)
pub fn execute_in_sandbox(prism: &mut Prism, _task: &str) -> PrismResult {
    prism.status = PrismStatus::Running;

    // MVP stub: acknowledge the task without real WASM execution
    let result = PrismResult {
        success: true,
        output: format!(
            "Sandbox '{}' acknowledged task. WASM execution engine planned for v0.3.",
            prism.name
        ),
        side_effects: vec![SideEffect {
            effect_type: "stub".to_string(),
            description: "No actual side effects — sandbox stub mode".to_string(),
            reversible: true,
        }],
    };

    prism.status = if result.success {
        PrismStatus::Completed
    } else {
        PrismStatus::Failed
    };

    prism.side_effects = result.side_effects.clone();
    result
}
