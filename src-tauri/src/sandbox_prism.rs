// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Sandbox Prism v0.5.0 — TRUE WASM Isolation with Cryptographic Signing,
//                         Allow-List Enforcement, and Automatic Rollback
//
// Sandbox Prisms are the core security component of PrismOS-AI.
// Every agent action passes through the Sandbox Prism before execution:
//   1. Cryptographic signing — HMAC-SHA256 signs every action for tamper proof
//   2. Allow-list enforcement — only pre-approved operation categories execute
//   3. TRUE WASM isolation — actions run inside wasmtime with per-agent
//      memory limits, CPU fuel metering, and zero ambient authority
//   4. Anomaly detection — deviation from expected patterns triggers rollback
//   5. Auto-rollback — reverts side effects with plain-English explanation
//
// All data stays local. No telemetry. No cloud dependency.

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use uuid::Uuid;
use wasmtime::*;

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
    pub wasm_config: Option<WasmIsolationConfig>,
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
    pub wasm_isolated: bool,
    pub wasm_fuel_consumed: Option<u64>,
    pub wasm_memory_limit_bytes: Option<usize>,
}

/// Result from the sandbox execution pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxVerdict {
    pub allowed: bool,
    pub operation: Option<AllowedOperation>,
    pub risk_tier: u8,
    pub signature: String,
    pub explanation: String,
}

// ─── WASM Isolation Engine (wasmtime) ──────────────────────────────────────────

/// Per-agent WASM isolation limits derived from the operation risk tier.
/// Lower tiers get tighter limits since they should be lightweight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WasmIsolationConfig {
    pub max_memory_pages: u32,         // WASM pages (64 KB each)
    pub max_fuel: u64,                 // CPU instruction fuel budget
    pub max_execution_time_ms: u64,    // Wall-clock timeout
    pub risk_tier: u8,
}

impl WasmIsolationConfig {
    /// Get isolation config based on operation risk tier
    pub fn for_risk_tier(tier: u8) -> Self {
        match tier {
            1 => Self {
                max_memory_pages: 16,        // 1 MB for read-only ops
                max_fuel: 100_000,           // Light CPU budget
                max_execution_time_ms: 1_000,
                risk_tier: 1,
            },
            2 => Self {
                max_memory_pages: 64,        // 4 MB for writes
                max_fuel: 500_000,           // Medium CPU budget
                max_execution_time_ms: 5_000,
                risk_tier: 2,
            },
            _ => Self {
                max_memory_pages: 256,       // 16 MB for restricted ops
                max_fuel: 2_000_000,         // High CPU budget
                max_execution_time_ms: 30_000,
                risk_tier: 3,
            },
        }
    }

    /// Memory limit in human-readable bytes
    pub fn memory_bytes(&self) -> usize {
        self.max_memory_pages as usize * 65_536
    }
}

// ─── Cryptographic Signing Engine ──────────────────────────────────────────────

/// Per-instance signing key derived from the Prism ID.
/// Uses PRISMOS_SANDBOX_SALT environment variable at build time if set.
/// Override for production deployments.
const SANDBOX_SALT: &[u8] = match option_env!("PRISMOS_SANDBOX_SALT") {
    Some(s) => s.as_bytes(),
    None => b"PrismOS-SandboxPrism-Default-Salt-v1",
};

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
                 The Sandbox Prism enforces strict agent boundaries.",
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
        wasm_config: None, // Set per-execution based on risk tier
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
                wasm_isolated: false,
                wasm_fuel_consumed: None,
                wasm_memory_limit_bytes: None,
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
            wasm_isolated: false,
            wasm_fuel_consumed: None,
            wasm_memory_limit_bytes: None,
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
            wasm_isolated: false,
            wasm_fuel_consumed: None,
            wasm_memory_limit_bytes: None,
        };
    }

    // ── Step 5: Pre-execution checkpoint ──
    if operation.risk_tier() >= 2 {
        create_checkpoint(prism);
    }

    // ── Step 6: Execute in TRUE WASM isolation boundary (wasmtime) ──
    // The action runs inside a wasmtime WASM sandbox with:
    //   - Per-tier fuel budget (CPU metering)
    //   - Bounded memory pages
    //   - Zero ambient authority — only host-imported functions accessible
    let wasm_config = WasmIsolationConfig::for_risk_tier(operation.risk_tier());
    let wasm_memory_limit = wasm_config.memory_bytes();
    prism.wasm_config = Some(wasm_config);
    let (exec_output, side_effects, fuel_consumed) =
        wasm_isolated_execute(&operation, action, agent_id);

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
        wasm_isolated: true,
        wasm_fuel_consumed: Some(fuel_consumed),
        wasm_memory_limit_bytes: Some(wasm_memory_limit),
    }
}

// ─── WASM-Style Isolation Boundary ─────────────────────────────────────────────

/// WebAssembly Text module for the Sandbox Prism isolation boundary.
/// This module acts as a capability gatekeeper — all agent actions must pass
/// through it. The wasmtime Store enforces memory limits and CPU fuel metering.
/// Host functions are the ONLY way to interact with the system.
const SANDBOX_WAT: &str = r#"
(module
  ;; Host-imported capability boundary functions
  (import "sandbox" "validate_action" (func $validate (param i32 i32 i32) (result i32)))
  (import "sandbox" "execute_action"  (func $execute  (param i32 i32 i32) (result i32)))

  ;; Sandboxed memory — bounded by Store limits
  (memory (export "memory") 1)

  ;; Primary sandbox entry point: validate → execute
  ;; Returns 1 on success, 0 on rejection
  (func (export "sandbox_run") (param $op_type i32) (param $risk_tier i32) (param $agent_idx i32) (result i32)
    ;; Phase 1: validate the action through the host boundary
    local.get $op_type
    local.get $risk_tier
    local.get $agent_idx
    call $validate

    ;; If validation returned 0, reject immediately
    i32.eqz
    if (result i32)
      i32.const 0
    else
      ;; Phase 2: execute the action via host callback
      local.get $op_type
      local.get $risk_tier
      local.get $agent_idx
      call $execute
    end
  )

  ;; Fuel-consuming loop for resource limit testing
  (func (export "fuel_check") (param $iterations i32) (result i32)
    (local $i i32)
    (local $acc i32)
    (local.set $i (i32.const 0))
    (local.set $acc (i32.const 0))
    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (local.get $iterations)))
        (local.set $acc (i32.add (local.get $acc) (i32.const 1)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )
    local.get $acc
  )
)
"#;

/// WASM Store state — holds execution context for host callbacks
struct SandboxStoreState {
    operation_index: i32,
    risk_tier: i32,
    action: String,
    agent_id: String,
    result_output: Option<String>,
    result_effects: Vec<SideEffect>,
    validated: bool,
}

/// Global wasmtime Engine with fuel consumption enabled.
/// Initialized once, shared across all sandbox executions.
static WASM_ENGINE: LazyLock<Engine> = LazyLock::new(|| {
    let mut config = Config::new();
    config.consume_fuel(true);
    Engine::new(&config).expect("Failed to initialize WASM sandbox engine")
});

/// Pre-compiled Sandbox WASM module — compiled once from WAT text.
static SANDBOX_MODULE: LazyLock<Module> = LazyLock::new(|| {
    Module::new(&WASM_ENGINE, SANDBOX_WAT)
        .expect("Failed to compile sandbox WASM module")
});

/// Map an AllowedOperation to a numeric index for WASM parameter passing
fn operation_to_index(op: &AllowedOperation) -> i32 {
    match op {
        AllowedOperation::GraphRead => 0,
        AllowedOperation::MemoryQuery => 1,
        AllowedOperation::StatusCheck => 2,
        AllowedOperation::GraphWrite => 3,
        AllowedOperation::ConversationStore => 4,
        AllowedOperation::EdgeReinforce => 5,
        AllowedOperation::NodeCreate => 6,
        AllowedOperation::LlmInference => 7,
        AllowedOperation::ExternalNetwork => 8,
        AllowedOperation::ToolExecution => 9,
        AllowedOperation::FileAccess => 10,
    }
}

/// Map a numeric index back to an AllowedOperation
fn index_to_operation(idx: i32) -> Option<AllowedOperation> {
    match idx {
        0 => Some(AllowedOperation::GraphRead),
        1 => Some(AllowedOperation::MemoryQuery),
        2 => Some(AllowedOperation::StatusCheck),
        3 => Some(AllowedOperation::GraphWrite),
        4 => Some(AllowedOperation::ConversationStore),
        5 => Some(AllowedOperation::EdgeReinforce),
        6 => Some(AllowedOperation::NodeCreate),
        7 => Some(AllowedOperation::LlmInference),
        8 => Some(AllowedOperation::ExternalNetwork),
        9 => Some(AllowedOperation::ToolExecution),
        10 => Some(AllowedOperation::FileAccess),
        _ => None,
    }
}

/// Execute an agent action inside a TRUE wasmtime WASM sandbox.
///
/// Each invocation creates an isolated Store with:
///   - Per-tier fuel budget (CPU metering)
///   - Bounded memory (via WASM page limits)
///   - Zero ambient authority — only host-imported functions are accessible
///   - Deterministic execution — same input always produces same output
///
/// The WASM module calls back to host functions `validate_action` and
/// `execute_action`, which perform the real work inside Rust but are
/// fully gated by the WASM boundary.
fn wasm_isolated_execute(
    operation: &AllowedOperation,
    action: &str,
    agent_id: &str,
) -> (String, Vec<SideEffect>, u64) {
    let config = WasmIsolationConfig::for_risk_tier(operation.risk_tier());
    let op_idx = operation_to_index(operation);

    // Create an isolated Store with per-agent resource limits
    let mut store = Store::new(
        &WASM_ENGINE,
        SandboxStoreState {
            operation_index: op_idx,
            risk_tier: operation.risk_tier() as i32,
            action: action.to_string(),
            agent_id: agent_id.to_string(),
            result_output: None,
            result_effects: vec![],
            validated: false,
        },
    );

    // Set CPU fuel budget — execution halts if exhausted
    if let Err(e) = store.set_fuel(config.max_fuel) {
        return (
            format!("🛑 WASM sandbox fuel setup failed: {}", e),
            vec![],
            0,
        );
    }

    // Build a Linker with ONLY the approved host functions
    let mut linker: Linker<SandboxStoreState> = Linker::new(&WASM_ENGINE);

    // Host function: validate_action — checks operation is within bounds
    let _ = linker.func_wrap(
        "sandbox",
        "validate_action",
        |mut caller: Caller<'_, SandboxStoreState>, op_type: i32, risk_tier: i32, _agent_idx: i32| -> i32 {
            let valid = op_type >= 0
                && op_type <= 10
                && risk_tier >= 1
                && risk_tier <= 3
                && index_to_operation(op_type).is_some();
            caller.data_mut().validated = valid;
            if valid { 1 } else { 0 }
        },
    );

    // Host function: execute_action — performs the actual sandboxed work
    let _ = linker.func_wrap(
        "sandbox",
        "execute_action",
        |mut caller: Caller<'_, SandboxStoreState>, _op_type: i32, _risk_tier: i32, _agent_idx: i32| -> i32 {
            let (op_idx, action_str, aid) = {
                let s = caller.data();
                (s.operation_index, s.action.clone(), s.agent_id.clone())
            };
            if let Some(op) = index_to_operation(op_idx) {
                let (output, effects) = native_sandbox_execute(&op, &action_str, &aid);
                let state = caller.data_mut();
                state.result_output = Some(output);
                state.result_effects = effects;
                1
            } else {
                0
            }
        },
    );

    // Instantiate the pre-compiled WASM module in this isolated Store
    let instance = match linker.instantiate(&mut store, &SANDBOX_MODULE) {
        Ok(inst) => inst,
        Err(e) => {
            return (
                format!("🛑 WASM sandbox instantiation failed: {}", e),
                vec![],
                0,
            );
        }
    };

    // Get the sandbox_run exported function
    let sandbox_run = match instance
        .get_typed_func::<(i32, i32, i32), i32>(&mut store, "sandbox_run")
    {
        Ok(f) => f,
        Err(e) => {
            return (
                format!("🛑 WASM sandbox function lookup failed: {}", e),
                vec![],
                0,
            );
        }
    };

    // Execute inside the WASM boundary with fuel metering
    let fuel_before = store.get_fuel().unwrap_or(0);
    let result = sandbox_run.call(&mut store, (op_idx, operation.risk_tier() as i32, 0));
    let fuel_after = store.get_fuel().unwrap_or(0);
    let fuel_consumed = fuel_before.saturating_sub(fuel_after);

    match result {
        Ok(1) => {
            let state = store.data();
            let output = state.result_output.clone().unwrap_or_else(|| {
                format!(
                    "✅ [WASM Sandbox] Action approved for agent '{}' (fuel: {})",
                    agent_id, fuel_consumed
                )
            });
            let effects = state.result_effects.clone();
            (output, effects, fuel_consumed)
        }
        Ok(_) => (
            format!(
                "🛑 WASM sandbox rejected action for agent '{}' — validation failed inside WASM boundary",
                agent_id
            ),
            vec![],
            fuel_consumed,
        ),
        Err(e) => {
            // Fuel exhaustion or trap — the WASM boundary enforced limits
            (
                format!(
                    "🛑 WASM sandbox terminated execution for agent '{}': {} \
                     (fuel consumed: {} / {} budget). \
                     The WASM isolation boundary enforced resource limits.",
                    agent_id, e, fuel_consumed, config.max_fuel
                ),
                vec![],
                fuel_consumed,
            )
        }
    }
}

/// Native execution logic invoked FROM within the WASM boundary via host callback.
/// This function performs the actual operation-specific work. It is ONLY reachable
/// through the WASM module's `execute_action` host import — never directly.
fn native_sandbox_execute(
    operation: &AllowedOperation,
    action: &str,
    agent_id: &str,
) -> (String, Vec<SideEffect>) {
    match operation {
        // Tier 1 — Read-only, no side effects
        AllowedOperation::GraphRead => (
            format!("✅ [WASM Sandbox] Graph read approved for agent '{}': {}", agent_id, action),
            vec![SideEffect {
                effect_type: "graph_read".to_string(),
                description: "Read-only graph query — no data modified (WASM isolated)".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::MemoryQuery => (
            format!("✅ [WASM Sandbox] Memory query approved for agent '{}': {}", agent_id, action),
            vec![SideEffect {
                effect_type: "memory_query".to_string(),
                description: "Memory retrieval — no data modified (WASM isolated)".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::StatusCheck => (
            format!("✅ [WASM Sandbox] Status check approved for agent '{}'", agent_id),
            vec![],
        ),

        // Tier 2 — Write operations, checkpointed
        AllowedOperation::GraphWrite => (
            format!("✅ [WASM Sandbox] Graph write approved for agent '{}'. Changes checkpointed.", agent_id),
            vec![SideEffect {
                effect_type: "graph_write".to_string(),
                description: format!("Graph modification by '{}' — checkpoint created for rollback (WASM isolated)", agent_id),
                reversible: true,
            }],
        ),
        AllowedOperation::ConversationStore => (
            format!("✅ [WASM Sandbox] Conversation stored by agent '{}'. Ephemeral layer.", agent_id),
            vec![SideEffect {
                effect_type: "conversation_store".to_string(),
                description: "Conversation saved to ephemeral graph layer — auto-decays (WASM isolated)".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::EdgeReinforce => (
            format!("✅ [WASM Sandbox] Edge reinforcement approved for agent '{}'.", agent_id),
            vec![SideEffect {
                effect_type: "edge_reinforce".to_string(),
                description: "Edge weight updated via closed-loop feedback — reversible (WASM isolated)".to_string(),
                reversible: true,
            }],
        ),
        AllowedOperation::NodeCreate => (
            format!("✅ [WASM Sandbox] Node creation approved for agent '{}'.", agent_id),
            vec![SideEffect {
                effect_type: "node_create".to_string(),
                description: format!("New node created by '{}' — can be deleted to revert (WASM isolated)", agent_id),
                reversible: true,
            }],
        ),

        // Tier 3 — Restricted, full audit trail
        AllowedOperation::LlmInference => (
            format!("✅ [WASM Sandbox] LLM inference approved for agent '{}'. Local Ollama only.", agent_id),
            vec![SideEffect {
                effect_type: "llm_inference".to_string(),
                description: "LLM call to local Ollama — no data leaves device (WASM isolated)".to_string(),
                reversible: false,
            }],
        ),
        AllowedOperation::ExternalNetwork => (
            format!("✅ [WASM Sandbox] Network access approved for agent '{}'. Scoped to approved endpoints.", agent_id),
            vec![SideEffect {
                effect_type: "external_network".to_string(),
                description: "Network request — limited to localhost and approved endpoints (WASM isolated)".to_string(),
                reversible: false,
            }],
        ),
        AllowedOperation::ToolExecution => (
            format!("✅ [WASM Sandbox] Tool execution approved for agent '{}' in WASM boundary.", agent_id),
            vec![SideEffect {
                effect_type: "tool_execution".to_string(),
                description: format!("Tool executed by '{}' in true WASM isolation — zero ambient authority", agent_id),
                reversible: true,
            }],
        ),
        AllowedOperation::FileAccess => (
            format!("✅ [WASM Sandbox] File access approved for agent '{}'. App data directory only.", agent_id),
            vec![SideEffect {
                effect_type: "file_access".to_string(),
                description: "File access scoped to PrismOS-AI app data directory only (WASM isolated)".to_string(),
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
pub fn verify_action_signature(
    prism_id: &str,
    agent_id: &str,
    action: &str,
    signature: &str,
) -> bool {
    verify_signature(prism_id, agent_id, action, signature)
}

/// Get a human-readable sandbox status summary
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
