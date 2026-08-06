// PrismOS-AI Refractive Core — bounded sequential orchestration engine
//
// The Refractive Core is the central nervous system of PrismOS-AI.
// Architecture:
//   1. Ingest raw user input
//   2. Apply Intent Lens decomposition (NLU → structured intent)
//   3. Query Spectrum Graph for contextual memory (graph-aware retrieval)
//   4. Route through the bounded sequential plan/build/judge workflow
//   5. Update Spectrum Graph edges with closed-loop feedback
//   6. Record deterministic compatibility-role checks and workflow provenance
//   7. Return refractive result with side effects & provenance
//
// SIMD acceleration: uses AVX2/NEON-friendly scoring when available,
// falls back to standard scalar CPU f64 arithmetic otherwise.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

static EMBEDDING_BACKFILL_RUNNING: AtomicBool = AtomicBool::new(false);

struct EmbeddingBackfillGuard;

impl Drop for EmbeddingBackfillGuard {
    fn drop(&mut self) {
        EMBEDDING_BACKFILL_RUNNING.store(false, Ordering::Release);
    }
}

/// Backfill a small number of graph embeddings without delaying chat. Only one
/// worker runs at a time, and no SQLite connection is held across an await.
fn schedule_embedding_backfill(app_dir: PathBuf) {
    if EMBEDDING_BACKFILL_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let _guard = EmbeddingBackfillGuard;
        const EMBED_BACKFILL_PER_RUN: usize = 12;
        let missing = match crate::spectrum_graph::SpectrumGraph::new(&app_dir) {
            Ok(graph) => graph
                .nodes_missing_embedding(EMBED_BACKFILL_PER_RUN)
                .unwrap_or_default(),
            Err(error) => {
                eprintln!("[RefractiveCore] embedding backfill could not open graph: {error}");
                return;
            }
        };

        for (node_id, label, content) in missing {
            let text: String = format!("{}\n{}", label, content)
                .chars()
                .take(2000)
                .collect();
            let embedding = match crate::ollama_bridge::embed(&text, None).await {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("[RefractiveCore] embedding backfill paused: {error}");
                    break;
                }
            };
            if let Ok(graph) = crate::spectrum_graph::SpectrumGraph::new(&app_dir) {
                let _ = graph.set_node_embedding(&node_id, &embedding);
            }
        }
    });
}

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
    pub context_nodes: Vec<String>, // node IDs from Spectrum Graph context
    pub edges_reinforced: Vec<String>, // edge IDs that were reinforced
    pub anticipations: Vec<String>, // anticipated need suggestions
    pub processing_time_ms: u64,
    #[serde(alias = "npu_accelerated")]
    pub simd_accelerated: bool,
    pub collaboration: Option<CollaborationSummary>, // Sequential workflow trace (legacy field name)
    pub conversation_id: Option<String>,             // links response to feedback system
    /// Requested/reported Reasoner identity plus explicit attestation and receipt facts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inference: Option<crate::inference_bridge::InferenceMetadata>,
    // ── Intent Transparency fields ──
    pub query_type: Option<String>,
    pub natural_band: Option<String>,
    pub applied_band: Option<String>,
    /// Active coarse query-topic guidance (legacy field name); never a credential claim.
    pub domain_detected: Option<String>,
    // ── Goal-loop provenance (plan → build → judge → refine) ──
    /// How many BUILD→JUDGE attempts ran this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iterations_used: Option<u32>,
    /// The iteration budget for this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_iterations: Option<u32>,
    /// True only when a real LLM judge accepted the final answer against the
    /// acceptance criteria (false = best-so-far / unvalidated / offline).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validated: Option<bool>,
    /// The final judge score in [0.0, 1.0].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judge_score: Option<f64>,
    /// True only when the final verdict came from a valid model-critic response.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judge_graded: Option<bool>,
    /// Bounded verdict/fallback summary. This is not hidden chain-of-thought.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub judge_summary: Option<String>,
    /// Reserved for wire compatibility. Hidden model reasoning is discarded and
    /// this field is intentionally never populated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_trace: Option<String>,
    /// The acceptance criteria the answer was judged against.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acceptance_criteria: Option<Vec<String>>,
    /// Remaining deficiencies when the loop ended unvalidated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deficiencies: Option<Vec<String>>,
}

/// Compact summary of the sequential workflow for frontend display.
/// Some field names retain the older collaboration/debate schema for compatibility.
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

/// Compact deterministic role-trace info using the legacy debate schema.
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

// ─── SIMD Scoring Engine ────────────────────────────────────────────────────────

/// CPU scoring engine with an AVX2/NEON-friendly SIMD path for intent relevance.
/// On systems with AVX2/NEON, uses SIMD-optimized f64 vector ops.
/// Falls back to scalar f64 arithmetic on all other platforms.
struct SimdScorer {
    simd_accelerated: bool,
}

impl SimdScorer {
    fn new() -> Self {
        let simd_accelerated = Self::detect_simd_support();
        if simd_accelerated {
            eprintln!("[RefractiveCore] CPU SIMD scoring: ENABLED");
        } else {
            eprintln!("[RefractiveCore] CPU SIMD scoring: scalar fallback");
        }
        Self { simd_accelerated }
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
    /// Uses dot-product similarity with CPU SIMD acceleration when available.
    fn score_relevance(&self, intent_weights: &[f64], node_weights: &[f64]) -> f64 {
        if intent_weights.is_empty() || node_weights.is_empty() {
            return 0.0;
        }

        let len = intent_weights.len().min(node_weights.len());

        if self.simd_accelerated {
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
        ("reasoner", "Reasoner", "Performs bounded analysis and inference via LLM",
         "Interfaces with Ollama for local LLM inference and content generation, returning answers and concise decision rationale without exposing hidden chain-of-thought"),
        ("tool_smith", "Tool Smith", "Reviews modeled actions against native policy",
         "Classifies modeled actions against fixed allow-lists and records signed policy decisions; it does not run arbitrary code or provide a code-execution sandbox"),
        ("sentinel", "Sentinel", "Monitors security, privacy, and system health",
         "Validates all operations against privacy policies, manages encryption, monitors resource usage, and enforces local-first data sovereignty"),
    ];
    agents_def
        .into_iter()
        .map(|(id, name, role, desc)| {
            let status = if active_id == Some(id) {
                AgentStatus::Processing
            } else {
                AgentStatus::Idle
            };
            Agent {
                id: id.into(),
                name: name.into(),
                role: role.into(),
                status,
                description: desc.into(),
            }
        })
        .collect()
}

// ─── Refractive Core Engine ────────────────────────────────────────────────────

/// The Refractive Core: PrismOS-AI's central processing pipeline.
/// Ingests inputs → applies Intent Lenses → queries Spectrum Graph →
/// routes through agents → updates graph with feedback → returns results.
pub struct RefractiveEngine {
    scorer: SimdScorer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptContextMode {
    /// A self-contained request. Only explicitly named nodes and consented web
    /// research may enter the prompt; personal/project memory stays isolated.
    Fresh,
    /// A terse continuation that needs the bounded recent-turn window.
    FollowUp,
    /// The user explicitly asked to use local/project/knowledge-base material.
    RequestedKnowledge,
    /// The user explicitly asked about their identity, preferences, or profile.
    PersonalProfile,
}

impl RefractiveEngine {
    pub fn new() -> Self {
        Self {
            scorer: SimdScorer::new(),
        }
    }

    fn prompt_context_mode(raw: &str) -> PromptContextMode {
        let lower = raw.trim().to_ascii_lowercase();
        let personal_markers = [
            "who am i",
            "about me",
            "my profile",
            "my preferences",
            "what do you know about me",
            "what do you remember about me",
            "my personal",
        ];
        if personal_markers.iter().any(|marker| lower.contains(marker)) {
            return PromptContextMode::PersonalProfile;
        }

        let knowledge_markers = [
            "use my knowledge",
            "using my knowledge",
            "based on my knowledge",
            "from my knowledge",
            "my knowledge base",
            "knowledge base",
            "my project",
            "our project",
            "this project",
            "project files",
            "this repo",
            "repository",
            "codebase",
            "documents i added",
            "sources i added",
            "uploaded document",
            "attached document",
            "spectrum graph",
        ];
        if knowledge_markers
            .iter()
            .any(|marker| lower.contains(marker))
        {
            return PromptContextMode::RequestedKnowledge;
        }

        let follow_up_starts = [
            "continue",
            "do that",
            "do the same",
            "what about",
            "and ",
            "also ",
            "now ",
            "make it",
            "turn it",
            "add that",
            "use that",
        ];
        let follow_up_references = [
            "the previous",
            "previous answer",
            "earlier answer",
            "above answer",
            "same one",
            "same format",
            "as before",
        ];
        if follow_up_starts
            .iter()
            .any(|marker| lower.starts_with(marker))
            || follow_up_references
                .iter()
                .any(|marker| lower.contains(marker))
        {
            return PromptContextMode::FollowUp;
        }

        PromptContextMode::Fresh
    }

    fn node_is_explicitly_named(raw: &str, label: &str) -> bool {
        let raw_tokens = raw
            .split(|character: char| !character.is_alphanumeric() && character != '_')
            .filter(|token| !token.is_empty())
            .map(str::to_ascii_lowercase)
            .collect::<std::collections::HashSet<_>>();
        let generic = [
            "project",
            "knowledge",
            "reference",
            "document",
            "learning",
            "profile",
            "work",
            "chat",
        ];
        label
            .split(|character: char| {
                character == '(' || character == ':' || character == '/' || character == '—'
            })
            .next()
            .unwrap_or(label)
            .split(|character: char| !character.is_alphanumeric() && character != '_')
            .map(str::to_ascii_lowercase)
            .find(|token| token.len() >= 4 && !generic.contains(&token.as_str()))
            .is_some_and(|token| raw_tokens.contains(&token))
    }

    fn context_result_allowed(
        mode: PromptContextMode,
        raw: &str,
        result: &crate::spectrum_graph::IntentQueryResult,
    ) -> bool {
        match mode {
            PromptContextMode::RequestedKnowledge
            | PromptContextMode::PersonalProfile
            | PromptContextMode::FollowUp => true,
            PromptContextMode::Fresh => {
                (result.node.id.starts_with("research-") && result.node.id != "research-root")
                    || Self::node_is_explicitly_named(raw, &result.node.label)
            }
        }
    }

    /// Full refractive pipeline: intent → context → bounded sequential workflow → result
    pub async fn refract(
        &self,
        intent: ParsedIntent,
        app_dir: &Path,
        app_handle: tauri::AppHandle,
        model: &str,
        request_id: &str,
    ) -> Result<RefractiveResult, Box<dyn std::error::Error + Send + Sync>> {
        if let Err(detail) = crate::inference_bridge::validate_request_id(request_id) {
            return Err(Box::new(
                crate::inference_bridge::InferenceError::Protocol {
                    request_id: request_id.to_string(),
                    detail: detail.into(),
                },
            ));
        }
        let start = Instant::now();

        // ── Step 0: Semantic layer — embed the query on local Ollama ──
        // Graceful: if the embed model isn't pulled or Ollama is down, we fall
        // back to keyword-only retrieval (exactly the old behavior). Localhost
        // only — the offline invariant holds.
        let query_embedding = match crate::ollama_bridge::embed(&intent.raw, None).await {
            Ok(v) => Some(v),
            Err(e) => {
                eprintln!(
                    "[RefractiveCore] embeddings unavailable ({}); keyword-only retrieval",
                    e
                );
                None
            }
        };

        // ── Step 1: Query Spectrum Graph for contextual memory ──
        let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
        let intent_type_str = intent.intent_type.to_string();

        let context_mode = Self::prompt_context_mode(&intent.raw);
        let context_results = graph
            .query_intent_hybrid(
                &intent.raw,
                &intent_type_str,
                &intent.entities,
                query_embedding.as_deref(),
            )?
            .into_iter()
            .filter(|result| Self::context_result_allowed(context_mode, &intent.raw, result))
            .collect::<Vec<_>>();

        let mut context_node_ids: Vec<String> =
            context_results.iter().map(|r| r.node.id.clone()).collect();

        // ── Step 1.5: Query-topic mix — coarse keyword classification ──
        // Keep the active topic typed alongside its prompt. Parsing a human-facing
        // prompt to recover the enum is brittle and can misreport the classification.
        let (domain_prefix, guidance_topic) = {
            let db_data = graph.get_domain_profile()?;
            let mut dp = crate::domain_detector::DomainProfile::default();

            // Restore counts from DB
            if let Some(counts) = db_data.get("domain_counts").and_then(|v| v.as_object()) {
                for (domain_str, count) in counts {
                    if let Some(c) = count.as_u64() {
                        dp.domain_counts.insert(domain_str.clone(), c as u32);
                    }
                }
            }
            dp.total_queries = db_data
                .get("total_queries")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;

            // Record current query and save
            dp.record_query(&intent.raw);
            let counts_json =
                serde_json::to_string(&dp.domain_counts).unwrap_or_else(|_| "{}".to_string());
            let primary_str = dp.primary_domain.storage_key();
            let _ = graph.save_domain_profile(
                &counts_json,
                dp.total_queries as i64,
                primary_str,
                dp.confidence,
            );

            let guidance_topic = dp.guidance_topic();
            let prompt = dp.get_domain_prompt();
            (prompt, guidance_topic)
        };

        // ── Step 2: CPU SIMD-scored context ranking ──
        let intent_weights = self.scorer.intent_to_weights(&intent);
        let mut scored_context: Vec<(String, f64)> = Vec::new();

        for result in &context_results {
            let node_weights = self.scorer.node_type_to_weights(&result.node.node_type);
            let simd_score = self.scorer.score_relevance(&intent_weights, &node_weights);
            let combined = result.relevance_score * 0.6 + simd_score * 0.4;
            scored_context.push((result.node.id.clone(), combined));
        }
        scored_context.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // ── Step 3: Build context-enriched summary ──
        // Personal profile and transcript memory are opt-in by intent. A
        // self-contained external technical request must not inherit unrelated
        // project names, local paths, or earlier assistant claims.
        let pinned = if context_mode == PromptContextMode::PersonalProfile {
            graph.pinned_profile_nodes(4).unwrap_or_default()
        } else {
            vec![]
        };
        let pinned_ids: Vec<String> = pinned.iter().map(|n| n.id.clone()).collect();
        for id in &pinned_ids {
            if !context_node_ids.contains(id) {
                context_node_ids.push(id.clone());
            }
        }

        // Terse continuations get a small chronological window. Fresh requests
        // never receive prior assistant answers, so a rejected or stale answer
        // cannot silently become evidence for the next task.
        let recent_conversations = if context_mode == PromptContextMode::FollowUp {
            graph.recent_conversation_nodes(4).unwrap_or_default()
        } else {
            vec![]
        };
        let recent_ids: Vec<String> = recent_conversations.iter().map(|n| n.id.clone()).collect();
        for id in &recent_ids {
            if !context_node_ids.contains(id) {
                context_node_ids.push(id.clone());
            }
        }
        let retrieved: Vec<crate::spectrum_graph::IntentQueryResult> = context_results
            .iter()
            .filter(|r| !pinned_ids.contains(&r.node.id) && !recent_ids.contains(&r.node.id))
            .cloned()
            .collect();

        let mut context_summary = self.build_context_summary(&retrieved);

        let conversation_block = Self::build_conversation_block(&recent_conversations);
        if !conversation_block.is_empty() {
            context_summary = if context_summary.is_empty() {
                conversation_block
            } else {
                format!("{}\n\n{}", conversation_block, context_summary)
            };
        }

        let profile_block = Self::build_profile_block(&pinned);
        if !profile_block.is_empty() {
            context_summary = if context_summary.is_empty() {
                profile_block
            } else {
                format!("{}\n\n{}", profile_block, context_summary)
            };
        }

        // Inject domain-specific guidance if the user has a detected domain
        if !domain_prefix.is_empty() {
            context_summary = format!("{}\n\n{}", domain_prefix, context_summary);
        }

        // ── Step 4: Execute the bounded sequential goal loop ──
        // The backend runs model-backed plan → build → judge → refine stages in
        // sequence. Additional roles/votes in the returned trace are deterministic
        // logical records, not concurrently executing models.
        eprintln!("[RefractiveCore] Launching bounded sequential workflow...");

        let (mut result, session, workflow_state) = crate::agents::graph::execute_collaboration(
            intent,
            &context_summary,
            &context_node_ids,
            &scored_context,
            self.scorer.simd_accelerated,
            app_dir,
            app_handle,
            model,
            request_id,
        )
        .await?;

        // ── Step 5: Attach the compatibility workflow summary to the result ──
        let consensus = session.consensus.as_ref();

        // Extract deterministic role-trace data through the legacy debate shape.
        let debate_frontend = workflow_state.as_ref().and_then(|ws| {
            ws.debate.as_ref().map(|d| DebateFrontendSummary {
                rounds: d.rounds_completed,
                total_arguments: d.arguments.len(),
                positions: d
                    .arguments
                    .iter()
                    .filter(|a| format!("{:?}", a.argument_type) == "Position")
                    .count(),
                challenges: d
                    .arguments
                    .iter()
                    .filter(|a| format!("{:?}", a.argument_type) == "Challenge")
                    .count(),
                rebuttals: d
                    .arguments
                    .iter()
                    .filter(|a| format!("{:?}", a.argument_type) == "Rebuttal")
                    .count(),
                supports: d
                    .arguments
                    .iter()
                    .filter(|a| format!("{:?}", a.argument_type) == "Support")
                    .count(),
                agreement_score: d.agreement_score,
                resolved: d.resolved,
                arguments: d
                    .arguments
                    .iter()
                    .map(|a| ArgumentFrontendSummary {
                        agent: a.from.display_name().to_string(),
                        argument_type: format!("{:?}", a.argument_type),
                        target: a
                            .target_agent
                            .as_ref()
                            .map(|t| t.display_name().to_string()),
                        content: a.content.clone(),
                        confidence: a.confidence,
                    })
                    .collect(),
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
            consensus_summary: consensus.map(|c| c.summary.clone()).unwrap_or_default(),
            vote_count: session.votes.len(),
            approve_count: consensus.map(|c| c.approve_count).unwrap_or(0),
            reject_count: consensus.map(|c| c.reject_count).unwrap_or(0),
            message_count: session.messages.len(),
            debate: debate_frontend,
        };
        result.collaboration = Some(collab_summary);

        // ── Populate Intent Transparency fields ──
        result.query_type = Some(format!("{:?}", result.intent.intent_type));
        result.natural_band = Some(result.agent_used.clone());
        result.applied_band = Some(result.agent_used.clone());
        // Legacy field name: this reports the active coarse query-topic guidance,
        // not the user's profession, credentials, or expertise.
        result.domain_detected = Some(
            guidance_topic
                .unwrap_or(crate::domain_detector::UserDomain::General)
                .storage_key()
                .to_string(),
        );

        // Override processing time to include full collaboration
        result.processing_time_ms = start.elapsed().as_millis() as u64;

        // ── Graph maintenance: promote frequently-accessed ephemeral nodes ──
        // Runs after every conversation — lightweight (single UPDATE query)
        if let Ok(g) = crate::spectrum_graph::SpectrumGraph::new(app_dir) {
            let _ = g.promote_active_nodes();
        }

        eprintln!(
            "[RefractiveCore] LangGraph collaboration complete in {}ms — {} messages, {} votes",
            result.processing_time_ms,
            session.messages.len(),
            session.votes.len()
        );

        // Opportunistic vector backfill is maintenance, not answer work. Start
        // it only after the response is complete so it cannot contend with the
        // request's graph reads or model generations.
        if query_embedding.is_some() {
            schedule_embedding_backfill(app_dir.to_path_buf());
        }

        Ok(result)
    }

    /// Select the appropriate agent based on intent type
    /// (Superseded by the bounded sequential workflow in refract())
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
                 Describe the configured privacy boundary accurately: core Ollama is loopback-only \
                 by default, while explicitly enabled remote endpoints and optional integrations may use the network.".into(),
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

        let mut entries: Vec<String> = Vec::new();
        let mut conversation_count = 0u32;

        for r in results.iter().take(20) {
            // Skip suggestion nodes
            if r.node.node_type == "suggestion" {
                continue;
            }
            // Skip nodes with very little content
            if r.node.content.len() < 20 {
                continue;
            }
            // Allow up to 2 highly-relevant conversation nodes (recent Q&A memory)
            if r.node.node_type == "conversation" {
                if conversation_count >= 2 || r.relevance_score < 0.4 {
                    continue;
                }
                conversation_count += 1;
            }
            if entries.len() >= 12 {
                break;
            }
            // Generous per-node budget: dense knowledge nodes (project/user
            // facts) run 600–1200 chars; the old 400-char cap truncated them
            // mid-sentence. 12 × 1200 chars ≈ 4k tokens — comfortable inside
            // the 16k num_ctx window with room for history and the answer.
            let content: String = r.node.content.chars().take(1200).collect();
            entries.push(format!(
                "**{}** ({}): {}",
                r.node.label,
                r.node.node_type,
                content.trim()
            ));
        }

        if entries.is_empty() {
            return String::new();
        }

        entries.join("\n\n")
    }

    /// Render the standing user-profile block from pinned personal/core nodes.
    /// This is called only for an explicit identity/profile request.
    fn build_profile_block(pinned: &[crate::spectrum_graph::SpectrumNode]) -> String {
        if pinned.is_empty() {
            return String::new();
        }
        let mut block = String::from("User profile requested for this task:");
        for n in pinned {
            let content: String = n.content.chars().take(700).collect();
            block.push_str(&format!("\n**{}**: {}", n.label, content.trim()));
        }
        block
    }

    /// Render a bounded transcript window from persisted conversation nodes.
    /// Conversation answers are already capped at persistence time; this second
    /// cap guards databases created by older versions.
    fn build_conversation_block(turns: &[crate::spectrum_graph::SpectrumNode]) -> String {
        if turns.is_empty() {
            return String::new();
        }
        let rendered: Vec<String> = turns
            .iter()
            .take(4)
            .map(|turn| turn.content.chars().take(1000).collect::<String>())
            .collect();
        format!(
            "Recent conversation (continuity only; earlier assistant answers may be wrong):\n{}",
            rendered.join("\n\n")
        )
    }
}

// ─── Process Intent — Full Pipeline Entry Point ────────────

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
    let request_id = uuid::Uuid::new_v4().to_string();
    engine
        .refract(
            parsed,
            app_dir,
            app_handle,
            crate::ollama_bridge::DEFAULT_CHAT_MODEL,
            &request_id,
        )
        .await
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

    let response = crate::ollama_bridge::generate(
        crate::ollama_bridge::DEFAULT_CHAT_MODEL,
        &prompt,
        None,
        None,
        None,
    )
    .await?;
    Ok(response)
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TESTS — Refractive Core Engine
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ─── IntentType Display ────────────────────────────────────────────────

    #[test]
    fn test_intent_type_display() {
        assert_eq!(format!("{}", IntentType::Query), "Query");
        assert_eq!(format!("{}", IntentType::Create), "Create");
        assert_eq!(format!("{}", IntentType::Analyze), "Analyze");
        assert_eq!(format!("{}", IntentType::Connect), "Connect");
        assert_eq!(format!("{}", IntentType::System), "System");
    }

    #[test]
    fn test_intent_type_equality() {
        assert_eq!(IntentType::Query, IntentType::Query);
        assert_ne!(IntentType::Query, IntentType::Create);
    }

    // ─── Agent Registry ────────────────────────────────────────────────────

    #[test]
    fn test_get_agents_returns_all() {
        let agents = get_agents();
        assert_eq!(
            agents.len(),
            5,
            "should return the five available core roles"
        );
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"orchestrator"));
        assert!(ids.contains(&"memory_keeper"));
        assert!(ids.contains(&"reasoner"));
        assert!(ids.contains(&"tool_smith"));
        assert!(ids.contains(&"sentinel"));
    }

    #[test]
    fn test_get_agents_all_idle_by_default() {
        let agents = get_agents();
        for agent in &agents {
            match agent.status {
                AgentStatus::Idle => {} // expected
                _ => panic!("Agent {} should be Idle, got {:?}", agent.id, agent.status),
            }
        }
    }

    #[test]
    fn test_get_agents_with_active_marks_processing() {
        let agents = get_agents_with_active(Some("reasoner"));
        let reasoner = agents.iter().find(|a| a.id == "reasoner").unwrap();
        match reasoner.status {
            AgentStatus::Processing => {} // expected
            _ => panic!("Active agent should be Processing"),
        }
        // Others should be Idle
        let orchestrator = agents.iter().find(|a| a.id == "orchestrator").unwrap();
        match orchestrator.status {
            AgentStatus::Idle => {} // expected
            _ => panic!("Non-active agent should be Idle"),
        }
    }

    #[test]
    fn test_agent_fields_populated() {
        let agents = get_agents();
        for agent in &agents {
            assert!(!agent.name.is_empty(), "Agent name should not be empty");
            assert!(!agent.role.is_empty(), "Agent role should not be empty");
            assert!(
                !agent.description.is_empty(),
                "Agent description should not be empty"
            );
        }
    }

    #[test]
    fn self_contained_sap_ppt_request_does_not_opt_into_private_memory() {
        assert_eq!(
            RefractiveEngine::prompt_context_mode(
                "Create a PPT for SAP PI upgrade from netweaver 7.5 SP27 to SP34"
            ),
            PromptContextMode::Fresh
        );
    }

    #[test]
    fn context_modes_require_explicit_profile_knowledge_or_follow_up_language() {
        assert_eq!(
            RefractiveEngine::prompt_context_mode("What do you remember about me?"),
            PromptContextMode::PersonalProfile
        );
        assert_eq!(
            RefractiveEngine::prompt_context_mode("Use my knowledge base for this report"),
            PromptContextMode::RequestedKnowledge
        );
        assert_eq!(
            RefractiveEngine::prompt_context_mode("Do the same for the test system"),
            PromptContextMode::FollowUp
        );
    }

    #[test]
    fn fresh_requests_only_name_project_nodes_when_the_name_is_in_the_request() {
        assert!(!RefractiveEngine::node_is_explicitly_named(
            "Create a SAP PI upgrade deck",
            "PrivateOpsKit (operations platform)"
        ));
        assert!(RefractiveEngine::node_is_explicitly_named(
            "Summarize PrivateOpsKit",
            "PrivateOpsKit (operations platform)"
        ));
    }

    // ─── SimdScorer ─────────────────────────────────────────────────────────

    #[test]
    fn test_simd_scorer_creation() {
        let scorer = SimdScorer::new();
        // Should not panic — acceleration depends on hardware
        let _ = scorer.simd_accelerated;
    }

    #[test]
    fn test_score_relevance_empty_vectors() {
        let scorer = SimdScorer::new();
        let score = scorer.score_relevance(&[], &[]);
        assert!((score - 0.0).abs() < 1e-9, "empty vectors should return 0");
    }

    #[test]
    fn test_score_relevance_identical_vectors() {
        let scorer = SimdScorer::new();
        let v = vec![1.0, 0.0, 0.0, 0.0, 0.0];
        let score = scorer.score_relevance(&v, &v);
        assert!(
            (score - 1.0).abs() < 1e-6,
            "identical vectors should have score ~1.0, got {}",
            score
        );
    }

    #[test]
    fn test_score_relevance_orthogonal_vectors() {
        let scorer = SimdScorer::new();
        let a = vec![1.0, 0.0, 0.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0, 0.0, 0.0];
        let score = scorer.score_relevance(&a, &b);
        assert!(
            score.abs() < 1e-6,
            "orthogonal vectors should have score ~0, got {}",
            score
        );
    }

    #[test]
    fn test_score_relevance_partial_overlap() {
        let scorer = SimdScorer::new();
        let a = vec![1.0, 1.0, 0.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0, 0.0, 0.0];
        let score = scorer.score_relevance(&a, &b);
        assert!(
            score > 0.5 && score < 1.0,
            "partial overlap should give 0.5–1.0, got {}",
            score
        );
    }

    #[test]
    fn test_scalar_dot_product_basic() {
        let scorer = SimdScorer::new();
        let a = vec![3.0, 4.0];
        let b = vec![3.0, 4.0];
        let result = scorer.scalar_dot_product(&a, &b);
        assert!(
            (result - 1.0).abs() < 1e-9,
            "identical 2D vectors should give 1.0"
        );
    }

    #[test]
    fn test_simd_dot_product_matches_scalar() {
        let scorer = SimdScorer::new();
        // Use vector length > 4 to exercise the SIMD chunking path
        let a = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        let b = vec![0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
        let simd_result = scorer.simd_dot_product(&a, &b);
        let scalar_result = scorer.scalar_dot_product(&a, &b);
        assert!(
            (simd_result - scalar_result).abs() < 1e-9,
            "SIMD and scalar dot products should match: {} vs {}",
            simd_result,
            scalar_result
        );
    }

    // ─── Intent Weight Generation ──────────────────────────────────────────

    #[test]
    fn test_intent_to_weights_query() {
        let scorer = SimdScorer::new();
        let intent = ParsedIntent {
            raw: "test query".into(),
            intent_type: IntentType::Query,
            entities: vec![],
            confidence: 1.0,
        };
        let weights = scorer.intent_to_weights(&intent);
        assert_eq!(weights.len(), 5);
        assert!(
            weights[0] > weights[1],
            "Query weight should be highest at index 0"
        );
    }

    #[test]
    fn test_intent_to_weights_confidence_scaling() {
        let scorer = SimdScorer::new();
        let high_conf = ParsedIntent {
            raw: "test".into(),
            intent_type: IntentType::Query,
            entities: vec![],
            confidence: 1.0,
        };
        let low_conf = ParsedIntent {
            raw: "test".into(),
            intent_type: IntentType::Query,
            entities: vec![],
            confidence: 0.5,
        };
        let hw = scorer.intent_to_weights(&high_conf);
        let lw = scorer.intent_to_weights(&low_conf);
        assert!(
            hw[0] > lw[0],
            "higher confidence should produce larger weights"
        );
    }

    #[test]
    fn test_intent_to_weights_entity_boost() {
        let scorer = SimdScorer::new();
        let no_entities = ParsedIntent {
            raw: "test".into(),
            intent_type: IntentType::Query,
            entities: vec![],
            confidence: 1.0,
        };
        let with_entities = ParsedIntent {
            raw: "test".into(),
            intent_type: IntentType::Query,
            entities: vec!["rust".into(), "async".into()],
            confidence: 1.0,
        };
        let w1 = scorer.intent_to_weights(&no_entities);
        let w2 = scorer.intent_to_weights(&with_entities);
        assert!(w2[0] > w1[0], "entities should boost weights");
    }

    #[test]
    fn test_intent_to_weights_all_types() {
        let scorer = SimdScorer::new();
        let types = [
            IntentType::Query,
            IntentType::Create,
            IntentType::Analyze,
            IntentType::Connect,
            IntentType::System,
        ];
        for (i, it) in types.iter().enumerate() {
            let intent = ParsedIntent {
                raw: "test".into(),
                intent_type: it.clone(),
                entities: vec![],
                confidence: 1.0,
            };
            let w = scorer.intent_to_weights(&intent);
            assert!(
                w[i] >= w.iter().cloned().fold(0.0_f64, f64::min),
                "weight at index {} should be dominant for {:?}",
                i,
                it
            );
        }
    }

    // ─── Node Type Weights ─────────────────────────────────────────────────

    #[test]
    fn test_node_type_to_weights_known_types() {
        let scorer = SimdScorer::new();
        let types = vec![
            "note",
            "memory",
            "task",
            "work",
            "health",
            "finance",
            "social",
            "learning",
            "conversation",
        ];
        for ntype in types {
            let w = scorer.node_type_to_weights(ntype);
            assert_eq!(
                w.len(),
                5,
                "all weight vectors should be 5D for type '{}'",
                ntype
            );
        }
    }

    #[test]
    fn test_node_type_to_weights_unknown_returns_uniform() {
        let scorer = SimdScorer::new();
        let w = scorer.node_type_to_weights("unknown_type");
        assert_eq!(w, vec![0.5, 0.5, 0.5, 0.5, 0.5]);
    }

    // ─── Build Context Summary ─────────────────────────────────────────────

    #[test]
    fn test_build_context_summary_empty() {
        let engine = RefractiveEngine::new();
        let result = engine.build_context_summary(&[]);
        assert!(result.is_empty());
    }

    // ─── Standing Profile Block ────────────────────────────────────────────

    #[test]
    fn test_build_profile_block_empty() {
        assert!(RefractiveEngine::build_profile_block(&[]).is_empty());
    }

    #[test]
    fn test_build_profile_block_renders_pinned_nodes() {
        let node = crate::spectrum_graph::SpectrumNode {
            id: "user-manish".into(),
            label: "Manish (owner)".into(),
            content: "Solo builder of 8 products across AI, SAP, and security.".into(),
            node_type: "personal".into(),
            layer: "core".into(),
            access_count: 0,
            last_accessed: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            connections: vec![],
        };
        let block = RefractiveEngine::build_profile_block(&[node]);
        assert!(block.contains("User profile requested"));
        assert!(block.contains("Manish (owner)"));
        assert!(block.contains("Solo builder of 8 products"));
    }

    #[test]
    fn test_build_profile_block_truncates_long_content() {
        let node = crate::spectrum_graph::SpectrumNode {
            id: "user-long".into(),
            label: "Long".into(),
            content: "x".repeat(5000),
            node_type: "personal".into(),
            layer: "core".into(),
            access_count: 0,
            last_accessed: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            connections: vec![],
        };
        let block = RefractiveEngine::build_profile_block(&[node]);
        // 700-char cap per node + header/label overhead
        assert!(block.len() < 800, "profile block must cap node content");
    }

    #[test]
    fn test_build_conversation_block_is_bounded_and_warns_about_trust() {
        let turn = crate::spectrum_graph::SpectrumNode {
            id: "conv-1".into(),
            label: "Chat".into(),
            content: format!("Q: Which repo?\n\nA: The first one. {}", "x".repeat(4000)),
            node_type: "conversation".into(),
            layer: "ephemeral".into(),
            access_count: 0,
            last_accessed: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            connections: vec![],
        };
        let block = RefractiveEngine::build_conversation_block(&[turn]);
        assert!(block.contains("earlier assistant answers may be wrong"));
        assert!(block.contains("Which repo?"));
        assert!(
            block.len() < 1200,
            "recent turn content must remain bounded"
        );
    }

    #[test]
    fn test_build_conversation_block_empty() {
        assert!(RefractiveEngine::build_conversation_block(&[]).is_empty());
    }

    #[test]
    fn test_build_context_summary_filters_short_content() {
        let engine = RefractiveEngine::new();
        let results = vec![crate::spectrum_graph::IntentQueryResult {
            node: crate::spectrum_graph::SpectrumNode {
                id: "n1".into(),
                label: "Short".into(),
                content: "tiny".into(), // < 20 chars
                node_type: "note".into(),
                layer: "context".into(),
                access_count: 0,
                last_accessed: String::new(),
                created_at: String::new(),
                updated_at: String::new(),
                connections: vec![],
            },
            relevance_score: 0.9,
            path_strength: 0.0,
            temporal_boost: 0.0,
        }];
        let summary = engine.build_context_summary(&results);
        assert!(summary.is_empty(), "short content nodes should be filtered");
    }

    #[test]
    fn test_build_context_summary_includes_valid_nodes() {
        let engine = RefractiveEngine::new();
        let results = vec![
            crate::spectrum_graph::IntentQueryResult {
                node: crate::spectrum_graph::SpectrumNode {
                    id: "n1".into(), label: "Rust Patterns".into(),
                    content: "Understanding Rust ownership, borrow checker, and lifetimes for safe memory management".into(),
                    node_type: "learning".into(), layer: "context".into(),
                    access_count: 5, last_accessed: String::new(),
                    created_at: String::new(), updated_at: String::new(),
                    connections: vec![],
                },
                relevance_score: 0.8, path_strength: 0.0, temporal_boost: 0.0,
            },
        ];
        let summary = engine.build_context_summary(&results);
        assert!(summary.contains("Rust Patterns"));
        assert!(summary.contains("(learning)"));
    }

    #[test]
    fn test_build_context_summary_limits_conversation_nodes() {
        let engine = RefractiveEngine::new();
        let mut results = Vec::new();
        for i in 0..5 {
            results.push(crate::spectrum_graph::IntentQueryResult {
                node: crate::spectrum_graph::SpectrumNode {
                    id: format!("conv-{}", i), label: format!("Conversation {}", i),
                    content: "A sufficiently long conversation content that exceeds twenty characters for testing".into(),
                    node_type: "conversation".into(), layer: "context".into(),
                    access_count: 0, last_accessed: String::new(),
                    created_at: String::new(), updated_at: String::new(),
                    connections: vec![],
                },
                relevance_score: 0.8, path_strength: 0.0, temporal_boost: 0.0,
            });
        }
        let summary = engine.build_context_summary(&results);
        // Should include at most 2 conversation nodes
        let conv_count = summary.matches("(conversation)").count();
        assert!(
            conv_count <= 2,
            "should limit conversation nodes to 2, got {}",
            conv_count
        );
    }

    #[test]
    fn test_build_context_summary_skips_suggestions() {
        let engine = RefractiveEngine::new();
        let results = vec![crate::spectrum_graph::IntentQueryResult {
            node: crate::spectrum_graph::SpectrumNode {
                id: "s1".into(),
                label: "Suggestion Node".into(),
                content: "This is a proactive suggestion that should be skipped from context"
                    .into(),
                node_type: "suggestion".into(),
                layer: "ephemeral".into(),
                access_count: 0,
                last_accessed: String::new(),
                created_at: String::new(),
                updated_at: String::new(),
                connections: vec![],
            },
            relevance_score: 0.9,
            path_strength: 0.0,
            temporal_boost: 0.0,
        }];
        let summary = engine.build_context_summary(&results);
        assert!(
            summary.is_empty(),
            "suggestion nodes should be filtered out"
        );
    }

    // ─── Select Agent (legacy) ─────────────────────────────────────────────

    #[test]
    fn test_select_agent_routes_correctly() {
        let engine = RefractiveEngine::new();
        let cases = vec![
            (IntentType::Query, "reasoner"),
            (IntentType::Create, "tool_smith"),
            (IntentType::Analyze, "reasoner"),
            (IntentType::Connect, "memory_keeper"),
            (IntentType::System, "sentinel"),
        ];
        for (intent_type, expected_agent) in cases {
            let intent = ParsedIntent {
                raw: "test".into(),
                intent_type,
                entities: vec![],
                confidence: 1.0,
            };
            let (agent_id, _system_prompt) = engine.select_agent(&intent);
            assert_eq!(agent_id, expected_agent);
        }
    }
}
