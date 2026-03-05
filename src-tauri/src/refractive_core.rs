// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Refractive Core — NPU-Accelerated Multi-Agent Orchestration Engine
//
// The Refractive Core is the central nervous system of PrismOS-AI.
// Architecture:
//   1. Ingest raw user input
//   2. Apply Intent Lens decomposition (NLU → structured intent)
//   3. Query Spectrum Graph for contextual memory (graph-aware retrieval)
//   4. Route through agent pipeline (5 specialized agents)
//   5. Update Spectrum Graph edges with closed-loop feedback
//   6. Spawn LangGraph agents for complex multi-step tasks
//   7. Return refractive result with side effects & provenance
//
// NPU acceleration: uses SIMD-optimized scoring when available,
// falls back to standard CPU f64 arithmetic otherwise.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;

// ─── Agent Definitions ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub role: String,
    pub status: AgentStatus,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentStatus {
    Idle,
    Processing,
    Waiting,
    Error,
}

// ─── Intent Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedIntent {
    pub raw: String,
    pub intent_type: IntentType,
    pub entities: Vec<String>,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum IntentType {
    Query,
    Create,
    Analyze,
    Connect,
    System,
}

impl std::fmt::Display for IntentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IntentType::Query => write!(f, "Query"),
            IntentType::Create => write!(f, "Create"),
            IntentType::Analyze => write!(f, "Analyze"),
            IntentType::Connect => write!(f, "Connect"),
            IntentType::System => write!(f, "System"),
        }
    }
}

// ─── Refractive Result ─────────────────────────────────────────────────────────

/// Full result from the Refractive Core pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefractiveResult {
    pub response: String,
    pub intent: ParsedIntent,
    pub agent_used: String,
    pub context_nodes: Vec<String>,      // node IDs from Spectrum Graph context
    pub edges_reinforced: Vec<String>,   // edge IDs that were reinforced
    pub anticipations: Vec<String>,      // anticipated need suggestions
    pub processing_time_ms: u64,
    pub npu_accelerated: bool,
    pub collaboration: Option<CollaborationSummary>,  // LangGraph multi-agent trace
}

/// Compact summary of multi-agent collaboration for frontend display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollaborationSummary {
    pub session_id: String,
    pub phase: String,
    pub pipeline_trace: Vec<TraceSummary>,
    pub consensus_approved: bool,
    pub consensus_summary: String,
    pub vote_count: usize,
    pub approve_count: usize,
    pub reject_count: usize,
    pub message_count: usize,
    pub debate: Option<DebateFrontendSummary>,
}

/// Compact debate info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateFrontendSummary {
    pub rounds: usize,
    pub total_arguments: usize,
    pub positions: usize,
    pub challenges: usize,
    pub rebuttals: usize,
    pub supports: usize,
    pub agreement_score: f64,
    pub resolved: bool,
    pub arguments: Vec<ArgumentFrontendSummary>,
}

/// A single argument for frontend display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentFrontendSummary {
    pub agent: String,
    pub argument_type: String,
    pub target: Option<String>,
    pub content: String,
    pub confidence: f64,
}

/// A single step in the pipeline trace for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceSummary {
    pub agent: String,
    pub action: String,
    pub status: String,
}

// ─── NPU Scoring Engine ────────────────────────────────────────────────────────

/// NPU-accelerated (or CPU fallback) scoring engine for intent relevance.
/// On systems with AVX2/NEON, uses SIMD-optimized f64 vector ops.
/// Falls back to scalar f64 arithmetic on all other platforms.
struct NpuScorer {
    accelerated: bool,
}

impl NpuScorer {
    fn new() -> Self {
        // Detect hardware acceleration capabilities
        let accelerated = Self::detect_simd_support();
        if accelerated {
            eprintln!("[RefractiveCore] NPU/SIMD acceleration: ENABLED");
        } else {
            eprintln!("[RefractiveCore] NPU/SIMD acceleration: CPU fallback");
        }
        Self { accelerated }
    }

    /// Detect SIMD support at runtime
    fn detect_simd_support() -> bool {
        #[cfg(target_arch = "x86_64")]
        {
            // Check for AVX2 support on x86_64
            is_x86_feature_detected!("avx2")
        }
        #[cfg(target_arch = "aarch64")]
        {
            // AArch64 always has NEON
            true
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            false
        }
    }

    /// Compute relevance score between intent embedding and node embedding
    /// Uses dot-product similarity with NPU acceleration when available
    fn score_relevance(&self, intent_weights: &[f64], node_weights: &[f64]) -> f64 {
        if intent_weights.is_empty() || node_weights.is_empty() {
            return 0.0;
        }

        let len = intent_weights.len().min(node_weights.len());

        if self.accelerated {
            // SIMD-friendly: process in chunks of 4 for vectorization
            self.simd_dot_product(&intent_weights[..len], &node_weights[..len])
        } else {
            // Scalar fallback
            self.scalar_dot_product(&intent_weights[..len], &node_weights[..len])
        }
    }

    /// SIMD-optimized dot product (compiler will auto-vectorize with -C target-cpu=native)
    #[inline]
    fn simd_dot_product(&self, a: &[f64], b: &[f64]) -> f64 {
        let chunks = a.len() / 4;
        let mut sum0: f64 = 0.0;
        let mut sum1: f64 = 0.0;
        let mut sum2: f64 = 0.0;
        let mut sum3: f64 = 0.0;

        for i in 0..chunks {
            let base = i * 4;
            sum0 += a[base] * b[base];
            sum1 += a[base + 1] * b[base + 1];
            sum2 += a[base + 2] * b[base + 2];
            sum3 += a[base + 3] * b[base + 3];
        }

        let mut total = (sum0 + sum1) + (sum2 + sum3);

        // Handle remainder
        for i in (chunks * 4)..a.len() {
            total += a[i] * b[i];
        }

        // Normalize to [0, 1]
        let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
        let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
        if mag_a > 0.0 && mag_b > 0.0 {
            (total / (mag_a * mag_b)).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// Scalar dot product fallback
    #[inline]
    fn scalar_dot_product(&self, a: &[f64], b: &[f64]) -> f64 {
        let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
        let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
        if mag_a > 0.0 && mag_b > 0.0 {
            (dot / (mag_a * mag_b)).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// Generate a pseudo-embedding from intent keywords (until full embedding model is integrated)
    fn intent_to_weights(&self, intent: &ParsedIntent) -> Vec<f64> {
        // 5-dimensional weight vector: [query, create, analyze, connect, system]
        let mut weights = vec![0.0_f64; 5];
        match intent.intent_type {
            IntentType::Query => weights[0] = 1.0,
            IntentType::Create => weights[1] = 1.0,
            IntentType::Analyze => weights[2] = 1.0,
            IntentType::Connect => weights[3] = 1.0,
            IntentType::System => weights[4] = 1.0,
        }
        // Scale by confidence
        for w in &mut weights {
            *w *= intent.confidence;
        }
        // Add entity count signal
        let entity_signal = (intent.entities.len() as f64 * 0.1).min(0.5);
        for w in &mut weights {
            *w += entity_signal;
        }
        weights
    }

    /// Generate a pseudo-embedding from node type
    fn node_type_to_weights(&self, node_type: &str) -> Vec<f64> {
        match node_type {
            "note" | "memory" => vec![0.8, 0.2, 0.3, 0.4, 0.1],
            "task" => vec![0.3, 0.9, 0.2, 0.3, 0.1],
            "work" => vec![0.5, 0.7, 0.6, 0.5, 0.2],
            "health" => vec![0.4, 0.3, 0.5, 0.3, 0.1],
            "finance" => vec![0.5, 0.4, 0.8, 0.3, 0.2],
            "social" => vec![0.4, 0.3, 0.3, 0.9, 0.1],
            "learning" => vec![0.7, 0.5, 0.8, 0.4, 0.1],
            "conversation" => vec![0.6, 0.3, 0.4, 0.5, 0.1],
            _ => vec![0.5, 0.5, 0.5, 0.5, 0.5],
        }
    }
}

// ─── Core Agent Registry ───────────────────────────────────────────────────────

/// Returns the 5 core PrismOS-AI agents
pub fn get_agents() -> Vec<Agent> {
    get_agents_with_active(None)
}

/// Returns agents with one optionally marked as Processing
pub fn get_agents_with_active(active_id: Option<&str>) -> Vec<Agent> {
    let agents_def = vec![
        ("orchestrator", "Orchestrator", "Routes intents and coordinates agent workflows",
         "Central coordinator that decomposes user intents and dispatches to specialized agents via the Refractive Core pipeline"),
        ("memory_keeper", "Memory Keeper", "Manages Spectrum Graph persistence and retrieval",
         "Handles all read/write operations to the Spectrum Graph, including semantic search, relationship mapping, and closed-loop edge reinforcement"),
        ("reasoner", "Reasoner", "Performs deep analysis and inference via LLM",
         "Interfaces with Ollama for local LLM inference, chain-of-thought reasoning, and content generation with NPU-accelerated context scoring"),
        ("tool_smith", "Tool Smith", "Executes sandboxed operations in Prism containers",
         "Manages WASM sandboxes for safe code execution, file operations, and tool use within deterministic Prism boundaries"),
        ("sentinel", "Sentinel", "Monitors security, privacy, and system health",
         "Validates all operations against privacy policies, manages encryption, monitors resource usage, and enforces local-first data sovereignty"),
        ("email_keeper", "Email Keeper", "Summarizes unread emails locally (read-only IMAP)",
         "Connects to your IMAP mailbox in read-only mode, fetches envelope metadata only (subject + sender), and produces a private summary via local LLM. No email content ever leaves the sandbox."),
        ("calendar_keeper", "Calendar Keeper", "Reads local .ics calendars and summarizes today's schedule",
         "Parses local .ics (iCalendar) files in read-only mode, extracts today's events, detects scheduling conflicts, suggests free time blocks, and produces a private summary via local LLM. No calendar data ever leaves the sandbox."),
        ("finance_keeper", "Finance Keeper", "Tracks your stock watchlist with public market data",
         "Fetches read-only public market data for your ticker watchlist, summarizes price changes, identifies gainers and losers, and produces a private portfolio summary via local LLM. No trades are ever executed and no financial accounts are accessed."),
    ];
    agents_def.into_iter().map(|(id, name, role, desc)| {
        let status = if active_id == Some(id) { AgentStatus::Processing } else { AgentStatus::Idle };
        Agent { id: id.into(), name: name.into(), role: role.into(), status, description: desc.into() }
    }).collect()
}

// ─── Refractive Core Engine ────────────────────────────────────────────────────

/// The Refractive Core: PrismOS-AI's central processing pipeline.
/// Ingests inputs → applies Intent Lenses → queries Spectrum Graph →
/// routes through agents → updates graph with feedback → returns results.
pub struct RefractiveEngine {
    scorer: NpuScorer,
}

impl RefractiveEngine {
    pub fn new() -> Self {
        Self {
            scorer: NpuScorer::new(),
        }
    }

    /// Full refractive pipeline: intent → context → LangGraph multi-agent collaboration → result
    pub async fn refract(
        &self,
        intent: ParsedIntent,
        app_dir: &Path,
        app_handle: tauri::AppHandle,
        model: &str,
    ) -> Result<RefractiveResult, Box<dyn std::error::Error + Send + Sync>> {
        let start = Instant::now();

        // ── Step 1: Query Spectrum Graph for contextual memory ──
        let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
        let intent_type_str = intent.intent_type.to_string();

        let context_results = graph.query_intent(
            &intent.raw,
            &intent_type_str,
            &intent.entities,
        )?;

        let context_node_ids: Vec<String> =
            context_results.iter().map(|r| r.node.id.clone()).collect();

        // ── Step 2: NPU-scored context ranking ──
        let intent_weights = self.scorer.intent_to_weights(&intent);
        let mut scored_context: Vec<(String, f64)> = Vec::new();

        for result in &context_results {
            let node_weights = self.scorer.node_type_to_weights(&result.node.node_type);
            let npu_score = self.scorer.score_relevance(&intent_weights, &node_weights);
            let combined = result.relevance_score * 0.6 + npu_score * 0.4;
            scored_context.push((result.node.id.clone(), combined));
        }
        scored_context.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // ── Step 3: Build context-enriched summary ──
        let context_summary = self.build_context_summary(&context_results);

        // ── Step 4: Execute LangGraph multi-agent collaboration ──
        // All 5 agents collaborate: Orchestrator decomposes → Reasoner analyzes →
        // Tool Smith evaluates → Memory Keeper persists → Sentinel validates →
        // Consensus vote → Execute through Sandbox Prism
        eprintln!("[RefractiveCore] Launching LangGraph multi-agent collaboration...");

        let (mut result, session, workflow_state) = crate::agents::graph::execute_collaboration(
            intent,
            &context_summary,
            &context_node_ids,
            &scored_context,
            self.scorer.accelerated,
            app_dir,
            app_handle,
            model,
        )
        .await?;

        // ── Step 5: Attach collaboration summary to result ──
        let consensus = session.consensus.as_ref();

        // Extract debate data from workflow state
        let debate_frontend = workflow_state.as_ref().and_then(|ws| {
            ws.debate.as_ref().map(|d| {
                DebateFrontendSummary {
                    rounds: d.rounds_completed,
                    total_arguments: d.arguments.len(),
                    positions: d.arguments.iter().filter(|a| format!("{:?}", a.argument_type) == "Position").count(),
                    challenges: d.arguments.iter().filter(|a| format!("{:?}", a.argument_type) == "Challenge").count(),
                    rebuttals: d.arguments.iter().filter(|a| format!("{:?}", a.argument_type) == "Rebuttal").count(),
                    supports: d.arguments.iter().filter(|a| format!("{:?}", a.argument_type) == "Support").count(),
                    agreement_score: d.agreement_score,
                    resolved: d.resolved,
                    arguments: d.arguments.iter().map(|a| ArgumentFrontendSummary {
                        agent: a.from.display_name().to_string(),
                        argument_type: format!("{:?}", a.argument_type),
                        target: a.target_agent.as_ref().map(|t| t.display_name().to_string()),
                        content: a.content.clone(),
                        confidence: a.confidence,
                    }).collect(),
                }
            })
        });

        let collab_summary = CollaborationSummary {
            session_id: session.session_id.clone(),
            phase: format!("{:?}", session.current_phase),
            pipeline_trace: session
                .pipeline_trace
                .iter()
                .map(|s| TraceSummary {
                    agent: s.agent.clone(),
                    action: s.action.clone(),
                    status: format!("{:?}", s.status),
                })
                .collect(),
            consensus_approved: consensus.map(|c| c.approved).unwrap_or(false),
            consensus_summary: consensus
                .map(|c| c.summary.clone())
                .unwrap_or_default(),
            vote_count: session.votes.len(),
            approve_count: consensus.map(|c| c.approve_count).unwrap_or(0),
            reject_count: consensus.map(|c| c.reject_count).unwrap_or(0),
            message_count: session.messages.len(),
            debate: debate_frontend,
        };
        result.collaboration = Some(collab_summary);

        // Override processing time to include full collaboration
        result.processing_time_ms = start.elapsed().as_millis() as u64;

        eprintln!(
            "[RefractiveCore] LangGraph collaboration complete in {}ms — {} messages, {} votes",
            result.processing_time_ms,
            session.messages.len(),
            session.votes.len()
        );

        Ok(result)
    }

    /// Select the appropriate agent based on intent type
    /// (Superseded by LangGraph multi-agent collaboration in refract())
    #[allow(dead_code)]
    fn select_agent(&self, intent: &ParsedIntent) -> (String, String) {
        match intent.intent_type {
            IntentType::Query => (
                "reasoner".into(),
                "You are PrismOS-AI Reasoner, a local-first AI assistant powered by the Refractive Core. \
                 You have access to the user's Spectrum Graph for contextual memory. \
                 Provide clear, concise, and helpful answers grounded in the user's knowledge graph when relevant.".into(),
            ),
            IntentType::Create => (
                "tool_smith".into(),
                "You are PrismOS-AI Tool Smith, a local-first AI assistant powered by the Refractive Core. \
                 Help the user create, build, or generate what they need. \
                 Reference their Spectrum Graph context to personalize output.".into(),
            ),
            IntentType::Analyze => (
                "reasoner".into(),
                "You are PrismOS-AI Reasoner in analysis mode, powered by the Refractive Core. \
                 Perform deep analysis with structured reasoning. \
                 Use Spectrum Graph context to provide insights grounded in the user's knowledge.".into(),
            ),
            IntentType::Connect => (
                "memory_keeper".into(),
                "You are PrismOS-AI Memory Keeper, a local-first AI assistant powered by the Refractive Core. \
                 Help connect ideas and find relationships across the user's Spectrum Graph. \
                 Suggest new edges, patterns, and overlooked connections.".into(),
            ),
            IntentType::System => (
                "sentinel".into(),
                "You are PrismOS-AI Sentinel, the local-first system agent of the Refractive Core. \
                 Provide system information, configuration help, and privacy assurance. \
                 All data stays local — no telemetry, no cloud sync.".into(),
            ),
        }
    }

    /// Build a context summary from query results for prompt injection.
    /// Filters out conversation echo nodes (previous Q&A) that don't add value —
    /// only includes nodes with real domain content.
    fn build_context_summary(
        &self,
        results: &[crate::spectrum_graph::IntentQueryResult],
    ) -> String {
        if results.is_empty() {
            return String::new();
        }

        let mut summary = String::new();
        let mut count = 0;
        for r in results.iter().take(8) {
            // Skip conversation echo nodes — they just repeat previous Q&A
            if r.node.node_type == "conversation" {
                continue;
            }
            // Skip suggestion nodes
            if r.node.node_type == "suggestion" {
                continue;
            }
            // Skip nodes with very little content
            if r.node.content.len() < 20 {
                continue;
            }
            count += 1;
            if count > 5 {
                break;
            }
            summary.push_str(&format!(
                "- {} ({}): {}\n",
                r.node.label,
                r.node.node_type,
                r.node.content.chars().take(200).collect::<String>()
            ));
        }

        summary
    }
}

// ─── Process Intent — Full Pipeline Entry Point (Patent Pending) ────────────

/// Full process_intent entry point: parses raw input through Intent Lens,
/// then routes through the complete Refractive Core pipeline.
/// This is the primary Tauri command interface.
pub async fn process_intent_full(
    raw_input: &str,
    app_dir: &Path,
    app_handle: tauri::AppHandle,
) -> Result<RefractiveResult, Box<dyn std::error::Error + Send + Sync>> {
    let lens = crate::intent_lens::IntentLens::new();
    let parsed = lens.parse(raw_input);

    let engine = RefractiveEngine::new();
    engine.refract(parsed, app_dir, app_handle, "mistral").await
}

/// Get the full Spectrum Graph snapshot for frontend visualization.
/// Convenience wrapper around SpectrumGraph::get_full_graph().
#[allow(dead_code)]
pub fn get_spectrum_graph_snapshot(
    app_dir: &Path,
) -> Result<crate::spectrum_graph::GraphSnapshot, Box<dyn std::error::Error + Send + Sync>> {
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
    graph.get_full_graph()
}

/// Get all active agents with their current status
#[allow(dead_code)]
pub fn get_active_agents() -> Vec<Agent> {
    get_agents()
}

// ─── Legacy API — backwards compatible ─────────────────────────────────────────

/// Simple intent routing (legacy fallback — used when Ollama is available
/// but full pipeline isn't needed)
#[allow(dead_code)]
pub async fn route_intent(
    intent: ParsedIntent,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let system_prompt = match intent.intent_type {
        IntentType::Query => {
            "You are PrismOS-AI Reasoner, a local-first AI assistant. Provide a clear, concise, and helpful answer."
        }
        IntentType::Create => {
            "You are PrismOS-AI Tool Smith, a local-first AI assistant. Help the user create, build, or generate what they need."
        }
        IntentType::Analyze => {
            "You are PrismOS-AI Reasoner, a local-first AI assistant. Perform deep analysis with structured reasoning."
        }
        IntentType::Connect => {
            "You are PrismOS-AI Memory Keeper, a local-first AI assistant. Help connect ideas and find relationships."
        }
        IntentType::System => {
            "You are PrismOS-AI Sentinel, a local-first AI system agent. Provide system information and configuration help."
        }
    };

    let prompt = format!(
        "{}\n\n{}\n\nRespond helpfully and concisely:",
        system_prompt, intent.raw
    );

    let response = crate::ollama_bridge::generate("mistral", &prompt, None, None, None).await?;
    Ok(response)
}
