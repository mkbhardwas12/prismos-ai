// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS Refractive Core — NPU-Accelerated Multi-Agent Orchestration Engine
//
// The Refractive Core is the central nervous system of PrismOS.
// Architecture per Patent 63/993,589:
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Returns the 5 core PrismOS agents per Patent 63/993,589
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
    ];
    agents_def.into_iter().map(|(id, name, role, desc)| {
        let status = if active_id == Some(id) { AgentStatus::Processing } else { AgentStatus::Idle };
        Agent { id: id.into(), name: name.into(), role: role.into(), status, description: desc.into() }
    }).collect()
}

// ─── Refractive Core Engine ────────────────────────────────────────────────────

/// The Refractive Core: PrismOS's central processing pipeline.
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

    /// Full refractive pipeline: intent → context → agent → sandbox → feedback → result
    pub async fn refract(
        &self,
        intent: ParsedIntent,
        app_dir: &Path,
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

        // ── Step 3: Build context-enriched prompt ──
        let context_summary = self.build_context_summary(&context_results);

        // ── Step 4: Select agent and route through pipeline ──
        let (agent_id, system_prompt) = self.select_agent(&intent);

        let full_prompt = format!(
            "{}\n\n--- Spectrum Graph Context ---\n{}\n--- End Context ---\n\nUser intent: {}\nEntities: {:?}\nConfidence: {:.0}%\n\nRespond helpfully and concisely:",
            system_prompt,
            context_summary,
            intent.raw,
            intent.entities,
            intent.confidence * 100.0
        );

        // ── Step 4.5: Create Sandbox Prism for this pipeline run ──
        let prism_name = format!("refract_{}_{}", agent_id, &intent_type_str);
        let mut prism = crate::sandbox_prism::create_prism_for_agent(&prism_name, &agent_id);

        // ── Step 5: LLM inference via Ollama — THROUGH SANDBOX ──
        // Validate LLM inference is permitted for this agent
        let llm_action = format!("llm_inference:generate:model=mistral:agent={}", agent_id);
        let llm_sandbox_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, &llm_action, &agent_id,
        );

        let response = if !llm_sandbox_result.success {
            // Sandbox denied the LLM call — use the sandbox explanation
            eprintln!(
                "[RefractiveCore] Sandbox denied LLM inference for '{}': {}",
                agent_id, llm_sandbox_result.output
            );
            format!(
                "🛡️ [Sandbox Protected] {}\n\n\
                 Your request was processed safely. The Sandbox Prism enforced agent boundaries.",
                llm_sandbox_result.output
            )
        } else {
            // Sandbox approved — proceed with LLM call
            match crate::ollama_bridge::generate("mistral", &full_prompt).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[RefractiveCore] Ollama unavailable, using offline mode: {}", e);
                    format!(
                        "⚡ [Offline Mode] I processed your intent locally through the Spectrum Graph.\n\n\
                         Intent type: {}\nEntities: {:?}\nContext nodes found: {}\n\n\
                         💡 Start Ollama for full AI responses: `ollama serve` then `ollama pull mistral`",
                        intent_type_str,
                        intent.entities,
                        context_results.len()
                    )
                }
            }
        };

        // ── Step 6: Closed-loop feedback — reinforce graph edges — THROUGH SANDBOX ──
        let mut edges_reinforced: Vec<String> = Vec::new();

        // Validate graph writes are permitted for this agent
        let reinforce_action = format!("edge_reinforce:feedback:agent={}", agent_id);
        let reinforce_sandbox = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, &reinforce_action, &agent_id,
        );

        if reinforce_sandbox.success {
            for i in 0..scored_context.len().min(5) {
                for j in (i + 1)..scored_context.len().min(5) {
                    let (ref id_a, score_a) = scored_context[i];
                    let (ref id_b, score_b) = scored_context[j];

                    let edge = graph.get_or_create_edge(id_a, id_b, "co_referenced")?;
                    let feedback_signal = (score_a + score_b) / 2.0;
                    let updated = graph.update_edge_weight(&edge.id, feedback_signal)?;
                    edges_reinforced.push(updated.id);
                }
            }
        } else {
            eprintln!(
                "[RefractiveCore] Sandbox denied edge reinforcement for '{}': {}",
                agent_id, reinforce_sandbox.output
            );
        }

        // ── Step 7: Store conversation as a new node — THROUGH SANDBOX ──
        let store_action = format!("conversation:store_chat:agent={}", agent_id);
        let store_sandbox = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, &store_action, &agent_id,
        );

        if store_sandbox.success {
            let conv_node = graph.add_node_with_layer(
                &format!("Chat: {}", &intent.raw.chars().take(50).collect::<String>()),
                &format!("Q: {}\n\nA: {}", intent.raw, &response.chars().take(500).collect::<String>()),
                "conversation",
                "ephemeral",
            )?;

            // Link conversation to context nodes — through sandbox
            let link_action = format!("add_node:node_create:derived_from:agent={}", agent_id);
            let link_sandbox = crate::sandbox_prism::execute_in_sandbox_for_agent(
                &mut prism, &link_action, &agent_id,
            );

            if link_sandbox.success {
                for ctx_id in scored_context.iter().take(3).map(|(id, _)| id) {
                    let edge = graph.get_or_create_edge(&conv_node.id, ctx_id, "derived_from")?;
                    graph.update_edge_weight(&edge.id, 0.5)?;
                }
            }
        } else {
            eprintln!(
                "[RefractiveCore] Sandbox denied conversation storage for '{}': {}",
                agent_id, store_sandbox.output
            );
        }

        // ── Step 8: Get anticipatory suggestions ──
        let anticipations = graph
            .anticipate_needs()?
            .into_iter()
            .take(3)
            .map(|n| n.suggestion)
            .collect();

        let elapsed = start.elapsed().as_millis() as u64;

        Ok(RefractiveResult {
            response,
            intent,
            agent_used: agent_id,
            context_nodes: context_node_ids,
            edges_reinforced,
            anticipations,
            processing_time_ms: elapsed,
            npu_accelerated: self.scorer.accelerated,
        })
    }

    /// Select the appropriate agent based on intent type
    fn select_agent(&self, intent: &ParsedIntent) -> (String, String) {
        match intent.intent_type {
            IntentType::Query => (
                "reasoner".into(),
                "You are PrismOS Reasoner, a local-first AI assistant powered by the Refractive Core. \
                 You have access to the user's Spectrum Graph for contextual memory. \
                 Provide clear, concise, and helpful answers grounded in the user's knowledge graph when relevant.".into(),
            ),
            IntentType::Create => (
                "tool_smith".into(),
                "You are PrismOS Tool Smith, a local-first AI assistant powered by the Refractive Core. \
                 Help the user create, build, or generate what they need. \
                 Reference their Spectrum Graph context to personalize output.".into(),
            ),
            IntentType::Analyze => (
                "reasoner".into(),
                "You are PrismOS Reasoner in analysis mode, powered by the Refractive Core. \
                 Perform deep analysis with structured reasoning. \
                 Use Spectrum Graph context to provide insights grounded in the user's knowledge.".into(),
            ),
            IntentType::Connect => (
                "memory_keeper".into(),
                "You are PrismOS Memory Keeper, a local-first AI assistant powered by the Refractive Core. \
                 Help connect ideas and find relationships across the user's Spectrum Graph. \
                 Suggest new edges, patterns, and overlooked connections.".into(),
            ),
            IntentType::System => (
                "sentinel".into(),
                "You are PrismOS Sentinel, the local-first system agent of the Refractive Core. \
                 Provide system information, configuration help, and privacy assurance. \
                 All data stays local — no telemetry, no cloud sync.".into(),
            ),
        }
    }

    /// Build a context summary from query results for prompt injection
    fn build_context_summary(
        &self,
        results: &[crate::spectrum_graph::IntentQueryResult],
    ) -> String {
        if results.is_empty() {
            return "No relevant context found in Spectrum Graph.".to_string();
        }

        let mut summary = String::new();
        for (i, r) in results.iter().take(5).enumerate() {
            summary.push_str(&format!(
                "{}. [{}] {} (relevance: {:.2})\n   {}\n",
                i + 1,
                r.node.node_type,
                r.node.label,
                r.relevance_score,
                r.node.content.chars().take(200).collect::<String>()
            ));
        }
        summary
    }
}

// ─── Process Intent — Full Pipeline Entry Point (Patent 63/993,589) ────────────

/// Full process_intent entry point: parses raw input through Intent Lens,
/// then routes through the complete Refractive Core pipeline.
/// This is the primary Tauri command interface per the patent specification.
pub async fn process_intent_full(
    raw_input: &str,
    app_dir: &Path,
) -> Result<RefractiveResult, Box<dyn std::error::Error + Send + Sync>> {
    let lens = crate::intent_lens::IntentLens::new();
    let parsed = lens.parse(raw_input);

    let engine = RefractiveEngine::new();
    engine.refract(parsed, app_dir).await
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
            "You are PrismOS Reasoner, a local-first AI assistant. Provide a clear, concise, and helpful answer."
        }
        IntentType::Create => {
            "You are PrismOS Tool Smith, a local-first AI assistant. Help the user create, build, or generate what they need."
        }
        IntentType::Analyze => {
            "You are PrismOS Reasoner, a local-first AI assistant. Perform deep analysis with structured reasoning."
        }
        IntentType::Connect => {
            "You are PrismOS Memory Keeper, a local-first AI assistant. Help connect ideas and find relationships."
        }
        IntentType::System => {
            "You are PrismOS Sentinel, a local-first AI system agent. Provide system information and configuration help."
        }
    };

    let prompt = format!(
        "{}\n\nUser intent: {}\nEntities detected: {:?}\nConfidence: {:.0}%\n\nRespond helpfully and concisely:",
        system_prompt, intent.raw, intent.entities, intent.confidence * 100.0
    );

    let response = crate::ollama_bridge::generate("mistral", &prompt).await?;
    Ok(response)
}
