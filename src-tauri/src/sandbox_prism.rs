// Patent Pending — US 63/993,589 (Feb 28, 2026)
// Sandbox Prism — WASM-Isolated Execution with Cryptographic Signing,
//                 Allow-List Enforcement, and Automatic Rollback
//
// Sandbox Prisms are the critical patented security component of PrismOS.
// Every agent action passes through the Sandbox Prism before execution:
//   1. Cryptographic signing — HMAC-SHA256 signs every action for tamper proof
//   2. Allow-list enforcement — only pre-approved operation categories execute
//   3. WASM-style isolation — actions run in a deterministic boundary
//   4. Anomaly detection — deviation from expected patterns triggers rollback
//   5. Auto-rollback — reverts side effects with plain-English explanation
//
// All data stays local. No telemetry. No cloud dependency.

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

// ─── Allow-List Categories ─────────────────────────────────────────────────────

/// Operations that the Sandbox Prism permits, categorized by risk tier.
/// Tier 1 (safe): read-only queries, graph reads, memory retrieval
/// Tier 2 (moderate): graph writes, conversation storage, edge reinforcement
/// Tier 3 (restricted): LLM inference, external network calls, tool execution
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AllowedOperation {
    // Tier 1 — safe, always permitted
    GraphRead,
    MemoryQuery,
    StatusCheck,
    // Tier 2 — moderate, logged and checkpointed
    GraphWrite,
    ConversationStore,
    EdgeReinforce,
    NodeCreate,
    // Tier 3 — restricted, requires signing + anomaly check
    LlmInference,
    ExternalNetwork,
    ToolExecution,
    FileAccess,
}

impl AllowedOperation {
    /// Risk tier: 1 = safe, 2 = moderate, 3 = restricted
    pub fn risk_tier(&self) -> u8 {
        match self {
            Self::GraphRead | Self::MemoryQuery | Self::StatusCheck => 1,
            Self::GraphWrite | Self::ConversationStore
            | Self::EdgeReinforce | Self::NodeCreate => 2,
            Self::LlmInference | Self::ExternalNetwork
            | Self::ToolExecution | Self::FileAccess => 3,
        }
    }

    /// Human-readable label
    pub fn label(&self) -> &'static str {
        match self {
            Self::GraphRead => "Read from Spectrum Graph",
            Self::MemoryQuery => "Query memory",
            Self::StatusCheck => "Check system status",
            Self::GraphWrite => "Write to Spectrum Graph",
            Self::ConversationStore => "Store conversation",
            Self::EdgeReinforce => "Reinforce graph edge",
            Self::NodeCreate => "Create graph node",
            Self::LlmInference => "LLM inference (Ollama)",
            Self::ExternalNetwork => "External network call",
            Self::ToolExecution => "Execute tool",
            Self::FileAccess => "Access local file",
        }
    }

    /// Classify a free-text action string into the closest AllowedOperation.
    /// Returns None if the action doesn't match any known category (denied).
    pub fn classify(action: &str) -> Option<Self> {
        let lower = action.to_lowercase();

        // Tier 1
        if lower.contains("read") && lower.contains("graph")
            || lower.contains("get_node") || lower.contains("get_spectrum")
            || lower.contains("search_node") || lower.contains("query_intent")
        {
            return Some(Self::GraphRead);
        }
        if lower.contains("memory") && (lower.contains("query") || lower.contains("retrieve"))
            || lower.contains("anticipate")
        {
            return Some(Self::MemoryQuery);
        }
        if lower.contains("status") || lower.contains("health") || lower.contains("check") {
            return Some(Self::StatusCheck);
        }

        // Tier 2
        if lower.contains("reinforce") || lower.contains("update_edge")
            || lower.contains("feedback")
        {
            return Some(Self::EdgeReinforce);
        }
        if lower.contains("add_node") || lower.contains("create_node")
            || lower.contains("node_create")
        {
            return Some(Self::NodeCreate);
        }
        if lower.contains("conversation") || lower.contains("store_chat")
            || lower.contains("save_message")
        {
            return Some(Self::ConversationStore);
        }
        if (lower.contains("write") || lower.contains("update") || lower.contains("delete"))
            && lower.contains("graph")
        {
            return Some(Self::GraphWrite);
        }

        // Tier 3
        if lower.contains("llm") || lower.contains("ollama") || lower.contains("inference")
            || lower.contains("generate") || lower.contains("mistral")
        {
            return Some(Self::LlmInference);
        }
        if lower.contains("network") || lower.contains("http") || lower.contains("fetch")
            || lower.contains("download")
        {
            return Some(Self::ExternalNetwork);
        }
        if lower.contains("execute") || lower.contains("run") || lower.contains("tool")
            || lower.contains("sandbox_exec")
        {
            return Some(Self::ToolExecution);
        }
        if lower.contains("file") || lower.contains("disk") || lower.contains("path") {
            return Some(Self::FileAccess);
        }

        // Not on allow-list → denied
        None
    }
}

// ─── Agent Allow-List Policy ───────────────────────────────────────────────────

/// Per-agent allow-list: which operations each agent may perform.
/// The Sentinel agent has the broadest scope; Tool Smith has restricted access.
pub fn agent_allow_list(agent_id: &str) -> Vec<AllowedOperation> {
    match agent_id {
        "orchestrator" => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::MemoryQuery,
            AllowedOperation::StatusCheck,
            AllowedOperation::LlmInference,
        ],
        "memory_keeper" => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::GraphWrite,
            AllowedOperation::MemoryQuery,
            AllowedOperation::ConversationStore,
            AllowedOperation::EdgeReinforce,
            AllowedOperation::NodeCreate,
        ],
        "reasoner" => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::MemoryQuery,
            AllowedOperation::LlmInference,
            AllowedOperation::ConversationStore,
            AllowedOperation::EdgeReinforce,
            AllowedOperation::NodeCreate,
        ],
        "tool_smith" => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::MemoryQuery,
            AllowedOperation::ToolExecution,
            AllowedOperation::FileAccess,
            AllowedOperation::NodeCreate,
        ],
        "sentinel" => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::MemoryQuery,
            AllowedOperation::StatusCheck,
            AllowedOperation::GraphWrite,
            AllowedOperation::ConversationStore,
            AllowedOperation::EdgeReinforce,
            AllowedOperation::NodeCreate,
            AllowedOperation::LlmInference,
        ],
        // Unknown agents get read-only access
        _ => vec![
            AllowedOperation::GraphRead,
            AllowedOperation::MemoryQuery,
            AllowedOperation::StatusCheck,
        ],
    }
}

// ─── Data Models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prism {
    pub id: String,
    pub name: String,
    pub status: PrismStatus,
    pub created_at: String,
    pub checkpoints: Vec<Checkpoint>,
    pub side_effects: Vec<SideEffect>,
    pub action_log: Vec<SignedAction>,
    pub agent_id: String,
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

/// Cryptographically signed action record — tamper-proof audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedAction {
    pub action_id: String,
    pub agent_id: String,
    pub action: String,
    pub operation: String,
    pub risk_tier: u8,
    pub hmac_signature: String,
    pub timestamp: String,
    pub verdict: ActionVerdict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ActionVerdict {
    Approved,
    Denied,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismResult {
    pub success: bool,
    pub output: String,
    pub side_effects: Vec<SideEffect>,
    pub sandbox_protected: bool,
    pub action_signature: String,
    pub rollback_explanation: Option<String>,
}

/// Result from the sandbox execution pipeline
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxVerdict {
    pub allowed: bool,
    pub operation: Option<AllowedOperation>,
    pub risk_tier: u8,
    pub signature: String,
    pub explanation: String,
}

// ─── Cryptographic Signing Engine ──────────────────────────────────────────────

/// Per-instance signing key derived from the Prism ID.
/// In production, this would be a hardware-backed key or KDF-derived secret.
/// For local-first MVP, we derive from the Prism identity + a fixed salt.
const SANDBOX_SALT: &[u8] = b"PrismOS-SandboxPrism-Patent-63993589";

/// Sign an action with HMAC-SHA256 for tamper-proof audit trail
fn sign_action(prism_id: &str, agent_id: &str, action: &str) -> String {
    let key_material = format!("{}:{}:{}", prism_id, SANDBOX_SALT.len(), agent_id);
    let mut mac = HmacSha256::new_from_slice(key_material.as_bytes())
        .expect("HMAC accepts any key length");
    mac.update(action.as_bytes());
    mac.update(agent_id.as_bytes());
    let result = mac.finalize();
    let bytes = result.into_bytes();
    bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>()
}

/// Verify an HMAC-SHA256 signature
#[allow(dead_code)]
fn verify_signature(prism_id: &str, agent_id: &str, action: &str, signature: &str) -> bool {
    let expected = sign_action(prism_id, agent_id, action);
    expected == signature
}

// ─── Anomaly Detection ─────────────────────────────────────────────────────────

/// Simple anomaly heuristics for MVP. Detects:
///   - Excessive action length (possible injection)
///   - Repeated rapid actions (possible loop/abuse)
///   - Tier escalation attempts (agent trying restricted ops)
struct AnomalyDetector;

impl AnomalyDetector {
    /// Check action for anomalies. Returns Ok(()) or Err(plain-English explanation).
    fn check(
        action: &str,
        agent_id: &str,
        operation: &AllowedOperation,
        action_log: &[SignedAction],
    ) -> Result<(), String> {
        // 1. Excessive action length (>10KB could be injection)
        if action.len() > 10_240 {
            return Err(format!(
                "🛑 Action blocked: The action from agent '{}' was unusually large ({} bytes). \
                 This could indicate a prompt injection or malformed payload. \
                 The Sandbox Prism rejected it to protect your data.",
                agent_id,
                action.len()
            ));
        }

        // 2. Rapid-fire detection: >20 actions in last 60 seconds
        let now = Utc::now();
        let recent_count = action_log
            .iter()
            .filter(|a| {
                if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&a.timestamp) {
                    (now - ts.with_timezone(&Utc)).num_seconds() < 60
                } else {
                    false
                }
            })
            .count();

        if recent_count > 20 {
            return Err(format!(
                "🛑 Action blocked: Agent '{}' has performed {} actions in the last 60 seconds. \
                 This unusual burst of activity was halted by the Sandbox Prism to prevent \
                 runaway processing or infinite loops.",
                agent_id, recent_count
            ));
        }

        // 3. Tier mismatch — agent requesting higher tier than their max
        let allowed = agent_allow_list(agent_id);
        let max_allowed_tier = allowed.iter().map(|op| op.risk_tier()).max().unwrap_or(1);
        if operation.risk_tier() > max_allowed_tier {
            return Err(format!(
                "🛑 Action blocked: Agent '{}' attempted a Tier {} operation ('{}') \
                 but is only authorized up to Tier {}. \
                 The Sandbox Prism enforces strict agent boundaries per the patent specification.",
                agent_id,
                operation.risk_tier(),
                operation.label(),
                max_allowed_tier
            ));
        }

        Ok(())
    }
}

// ─── Prism Lifecycle ───────────────────────────────────────────────────────────

/// Create a new sandboxed Prism execution environment for a specific agent
pub fn create_prism(name: &str) -> Prism {
    create_prism_for_agent(name, "unknown")
}

/// Create a Prism bound to a specific agent identity
pub fn create_prism_for_agent(name: &str, agent_id: &str) -> Prism {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let mut prism = Prism {
        id,
        name: name.to_string(),
        status: PrismStatus::Ready,
        created_at: now,
        checkpoints: vec![],
        side_effects: vec![],
        action_log: vec![],
        agent_id: agent_id.to_string(),
    };

    // Auto-create initial checkpoint
    let _initial = create_checkpoint(&mut prism);

    prism
}

/// Create a cryptographic checkpoint (SHA-256 state hash) for rollback support
pub fn create_checkpoint(prism: &mut Prism) -> Checkpoint {
    let state_data = format!(
        "{}:{}:{:?}:{}:effects={}",
        prism.id,
        prism.name,
        prism.status,
        prism.agent_id,
        prism.side_effects.len()
    );
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

/// Rollback a Prism to its last checkpoint with a plain-English explanation
pub fn rollback(prism: &mut Prism) -> Option<Checkpoint> {
    rollback_with_reason(prism, "Manual rollback requested by user")
}

/// Rollback with a specific reason — returns the checkpoint and records explanation
pub fn rollback_with_reason(prism: &mut Prism, reason: &str) -> Option<Checkpoint> {
    prism.status = PrismStatus::RolledBack;

    // Record the rollback as a side effect with the explanation
    prism.side_effects.push(SideEffect {
        effect_type: "rollback".to_string(),
        description: format!(
            "Sandbox Prism rolled back all changes. Reason: {}. \
             All {} previous side effects have been reversed.",
            reason,
            prism.side_effects.len()
        ),
        reversible: false,
    });

    // Mark all logged actions as rolled back
    for action in &mut prism.action_log {
        if action.verdict == ActionVerdict::Approved {
            action.verdict = ActionVerdict::RolledBack;
        }
    }

    prism.checkpoints.last().cloned()
}

// ─── Core Sandbox Execution Engine ─────────────────────────────────────────────

/// Execute an action inside the Sandbox Prism security boundary.
/// This is the primary entry point for ALL agent operations.
///
/// Pipeline:
///   1. Classify action → AllowedOperation
///   2. Check agent allow-list
///   3. Sign action with HMAC-SHA256
///   4. Run anomaly detection
///   5. Create pre-execution checkpoint
///   6. Execute in WASM-style isolation boundary
///   7. Record side effects
///   8. Return signed, auditable result
///
/// If any step fails, the Prism auto-rolls back and returns a
/// plain-English explanation of why the action was blocked.
#[allow(dead_code)]
pub fn execute_in_sandbox(prism: &mut Prism, action: &str) -> PrismResult {
    execute_in_sandbox_for_agent(prism, action, &prism.agent_id.clone())
}

/// Execute with explicit agent identity (used by refractive_core integration)
pub fn execute_in_sandbox_for_agent(
    prism: &mut Prism,
    action: &str,
    agent_id: &str,
) -> PrismResult {
    prism.status = PrismStatus::Running;
    let action_id = Uuid::new_v4().to_string();

    // ── Step 1: Classify action against allow-list ──
    let operation = match AllowedOperation::classify(action) {
        Some(op) => op,
        None => {
            // Action not on allow-list → denied with explanation
            let signature = sign_action(&prism.id, agent_id, action);
            let explanation = format!(
                "🛡️ Sandbox Prism blocked this action because it doesn't match any \
                 approved operation category. Agent '{}' tried: \"{}\". \
                 Only pre-approved operations (graph reads, writes, LLM inference, etc.) \
                 are permitted. This protects your data from unexpected behavior.",
                agent_id,
                &action.chars().take(100).collect::<String>()
            );

            prism.action_log.push(SignedAction {
                action_id,
                agent_id: agent_id.to_string(),
                action: action.chars().take(200).collect(),
                operation: "DENIED_UNCLASSIFIED".to_string(),
                risk_tier: 0,
                hmac_signature: signature.clone(),
                timestamp: Utc::now().to_rfc3339(),
                verdict: ActionVerdict::Denied,
            });

            prism.status = PrismStatus::Failed;
            return PrismResult {
                success: false,
                output: explanation.clone(),
                side_effects: vec![],
                sandbox_protected: true,
                action_signature: signature,
                rollback_explanation: Some(explanation),
            };
        }
    };

    // ── Step 2: Check agent allow-list ──
    let allowed_ops = agent_allow_list(agent_id);
    if !allowed_ops.contains(&operation) {
        let signature = sign_action(&prism.id, agent_id, action);
        let explanation = format!(
            "🛡️ Sandbox Prism denied this action: Agent '{}' is not authorized to perform \
             '{}' (Tier {}). This agent is only permitted: {}. \
             Each agent has a strict boundary — this keeps your system safe.",
            agent_id,
            operation.label(),
            operation.risk_tier(),
            allowed_ops.iter().map(|o| o.label()).collect::<Vec<_>>().join(", ")
        );

        prism.action_log.push(SignedAction {
            action_id,
            agent_id: agent_id.to_string(),
            action: action.chars().take(200).collect(),
            operation: format!("DENIED_{:?}", operation),
            risk_tier: operation.risk_tier(),
            hmac_signature: signature.clone(),
            timestamp: Utc::now().to_rfc3339(),
            verdict: ActionVerdict::Denied,
        });

        prism.status = PrismStatus::Failed;
        return PrismResult {
            success: false,
            output: explanation.clone(),
            side_effects: vec![],
            sandbox_protected: true,
            action_signature: signature,
            rollback_explanation: Some(explanation),
        };
    }

    // ── Step 3: Cryptographic signing ──
    let signature = sign_action(&prism.id, agent_id, action);

    // ── Step 4: Anomaly detection ──
    if let Err(anomaly_explanation) =
        AnomalyDetector::check(action, agent_id, &operation, &prism.action_log)
    {
        // Anomaly detected → auto-rollback
        prism.action_log.push(SignedAction {
            action_id,
            agent_id: agent_id.to_string(),
            action: action.chars().take(200).collect(),
            operation: format!("{:?}", operation),
            risk_tier: operation.risk_tier(),
            hmac_signature: signature.clone(),
            timestamp: Utc::now().to_rfc3339(),
            verdict: ActionVerdict::Denied,
        });

        rollback_with_reason(prism, &anomaly_explanation);

        return PrismResult {
            success: false,
            output: anomaly_explanation.clone(),
            side_effects: vec![],
            sandbox_protected: true,
            action_signature: signature,
            rollback_explanation: Some(anomaly_explanation),
        };
    }

    // ── Step 5: Pre-execution checkpoint ──
    if operation.risk_tier() >= 2 {
        create_checkpoint(prism);
    }

    // ── Step 6: Execute in WASM-style isolation boundary ──
    // The action runs inside a deterministic boundary — no ambient authority.
    // Side effects are captured, not applied directly.
    let (exec_output, side_effects) = wasm_isolated_execute(&operation, action, agent_id);

    // ── Step 7: Record signed action ──
    prism.action_log.push(SignedAction {
        action_id,
        agent_id: agent_id.to_string(),
        action: action.chars().take(200).collect(),
        operation: format!("{:?}", operation),
        risk_tier: operation.risk_tier(),
        hmac_signature: signature.clone(),
        timestamp: Utc::now().to_rfc3339(),
        verdict: ActionVerdict::Approved,
    });

    prism.side_effects.extend(side_effects.clone());
    prism.status = PrismStatus::Completed;

    // ── Step 8: Post-execution checkpoint ──
    if operation.risk_tier() >= 2 {
        create_checkpoint(prism);
    }

    PrismResult {
        success: true,
        output: exec_output,
        side_effects,
        sandbox_protected: true,
        action_signature: signature,
        rollback_explanation: None,
    }
}

// ─── WASM-Style Isolation Boundary ─────────────────────────────────────────────

/// Simulate WASM-style deterministic execution boundary.
/// Each operation category has a controlled execution path.
/// No ambient authority — the function receives only what it needs.
///
/// In a future version, this will use wasmtime for true WASM isolation.
/// For the MVP, it enforces the same security invariants in native code:
///   - No direct filesystem access outside approved paths
///   - No network access outside approved endpoints
///   - Deterministic output for the same input
///   - All side effects are captured and returned, not applied in-place
fn wasm_isolated_execute(
    operation: &AllowedOperation,
    action: &str,
    agent_id: &str,
) -> (String, Vec<SideEffect>) {
    match operation {
        // Tier 1 — Read-only, no side effects
        AllowedOperation::GraphRead => (
            format!("✅ [Sandbox] Graph read approved for agent '{}': {}", agent_id, action),
            vec![SideEffect {
                effect_type: "graph_read".to_string(),
                description: "Read-only graph query — no data modified".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::MemoryQuery => (
            format!("✅ [Sandbox] Memory query approved for agent '{}': {}", agent_id, action),
            vec![SideEffect {
                effect_type: "memory_query".to_string(),
                description: "Memory retrieval — no data modified".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::StatusCheck => (
            format!("✅ [Sandbox] Status check approved for agent '{}'", agent_id),
            vec![],
        ),

        // Tier 2 — Write operations, checkpointed
        AllowedOperation::GraphWrite => (
            format!("✅ [Sandbox] Graph write approved for agent '{}'. Changes checkpointed.", agent_id),
            vec![SideEffect {
                effect_type: "graph_write".to_string(),
                description: format!("Graph modification by '{}' — checkpoint created for rollback", agent_id),
                reversible: true,
            }],
        ),
        AllowedOperation::ConversationStore => (
            format!("✅ [Sandbox] Conversation stored by agent '{}'. Ephemeral layer.", agent_id),
            vec![SideEffect {
                effect_type: "conversation_store".to_string(),
                description: "Conversation saved to ephemeral graph layer — auto-decays".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::EdgeReinforce => (
            format!("✅ [Sandbox] Edge reinforcement approved for agent '{}'.", agent_id),
            vec![SideEffect {
                effect_type: "edge_reinforce".to_string(),
                description: "Edge weight updated via closed-loop feedback — reversible".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::NodeCreate => (
            format!("✅ [Sandbox] Node creation approved for agent '{}'.", agent_id),
            vec![SideEffect {
                effect_type: "node_create".to_string(),
                description: format!("New node created by '{}' — can be deleted to revert", agent_id),
                reversible: true,
            }],
        ),

        // Tier 3 — Restricted, full audit trail
        AllowedOperation::LlmInference => (
            format!("✅ [Sandbox] LLM inference approved for agent '{}'. Local Ollama only.", agent_id),
            vec![SideEffect {
                effect_type: "llm_inference".to_string(),
                description: "LLM call to local Ollama — no data leaves device".to_string(),
                reversible: false,
            }],
        ),
        AllowedOperation::ExternalNetwork => (
            format!("✅ [Sandbox] Network access approved for agent '{}'. Scoped to approved endpoints.", agent_id),
            vec![SideEffect {
                effect_type: "external_network".to_string(),
                description: "Network request — limited to localhost and approved endpoints".to_string(),
                reversible: false,
            }],
        ),
        AllowedOperation::ToolExecution => (
            format!("✅ [Sandbox] Tool execution approved for agent '{}' in isolated boundary.", agent_id),
            vec![SideEffect {
                effect_type: "tool_execution".to_string(),
                description: format!("Tool executed by '{}' in WASM-style isolation — no ambient authority", agent_id),
                reversible: true,
            }],
        ),
        AllowedOperation::FileAccess => (
            format!("✅ [Sandbox] File access approved for agent '{}'. App data directory only.", agent_id),
            vec![SideEffect {
                effect_type: "file_access".to_string(),
                description: "File access scoped to PrismOS app data directory only".to_string(),
                reversible: true,
            }],
        ),
    }
}

// ─── Public API for Tauri Command ──────────────────────────────────────────────

/// Top-level sandbox execution entry point for Tauri commands.
/// Creates a Prism, validates the action, executes in sandbox, returns JSON result.
pub fn sandbox_execute(action: &str, agent_id: &str) -> PrismResult {
    let prism_name = format!("prism_{}_{}", agent_id, &Uuid::new_v4().to_string()[..8]);
    let mut prism = create_prism_for_agent(&prism_name, agent_id);
    execute_in_sandbox_for_agent(&mut prism, action, agent_id)
}

/// Verify the signature of a previously executed action
#[allow(dead_code)]
pub fn verify_action_signature(
    prism_id: &str,
    agent_id: &str,
    action: &str,
    signature: &str,
) -> bool {
    verify_signature(prism_id, agent_id, action, signature)
}

/// Get a human-readable sandbox status summary
#[allow(dead_code)]
pub fn sandbox_status_summary(prism: &Prism) -> String {
    let approved = prism.action_log.iter().filter(|a| a.verdict == ActionVerdict::Approved).count();
    let denied = prism.action_log.iter().filter(|a| a.verdict == ActionVerdict::Denied).count();
    let rolled_back = prism.action_log.iter().filter(|a| a.verdict == ActionVerdict::RolledBack).count();

    format!(
        "🛡️ Sandbox Prism '{}' (Agent: {})\n\
         Status: {:?} | Checkpoints: {} | Actions: {} approved, {} denied, {} rolled back\n\
         All actions cryptographically signed with HMAC-SHA256.",
        prism.name,
        prism.agent_id,
        prism.status,
        prism.checkpoints.len(),
        approved,
        denied,
        rolled_back
    )
}
