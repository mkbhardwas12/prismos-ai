// LangGraph Workflow Engine — Formal State-Graph Multi-Agent Orchestration
//
// This module implements a formal LangGraph-style state graph for
// multi-agent collaboration. Agents traverse a typed state machine
// with conditional edges, a single model draft, deterministic role checks, and
// a policy gate. Every state transition is checkpointed
// for auditability.
//
// Architecture:
//   StateGraph — defines nodes (agents) + edges (transitions)
//   WorkflowEngine — executes the graph with state management
//   DebateResult — legacy wire envelope for deterministic workflow checks
//   Policy gate — operational checks, never independent factual verification
//
// All side-effecting actions go through the Sandbox Prism.

use super::messages::*;
use super::nodes::*;
use crate::refractive_core::{IntentType, ParsedIntent};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;
use uuid::Uuid;

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE AGENT ACTIVITY EVENT — emitted to frontend for real-time collaboration
// ═══════════════════════════════════════════════════════════════════════════════

/// Event payload emitted to the frontend during workflow execution so the UI
/// can show real-time "Reasoner is analyzing…", "Consensus reached", etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActivityEvent {
    pub agent: String,
    pub action: String,
    /// "started" | "thinking" | "completed"
    pub status: String,
    /// Workflow phase: orchestrate | analyze | debate | review | vote | execute
    pub phase: String,
}

/// Helper: fire an `agent-activity` event (silently ignores errors)
fn emit_activity(app: &tauri::AppHandle, agent: &str, action: &str, status: &str, phase: &str) {
    let _ = app.emit(
        "agent-activity",
        AgentActivityEvent {
            agent: agent.to_string(),
            action: action.to_string(),
            status: status.to_string(),
            phase: phase.to_string(),
        },
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATE GRAPH — Typed state machine for agent collaboration
// ═══════════════════════════════════════════════════════════════════════════════

/// A node in the state graph — each represents an agent or decision point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub node_type: GraphNodeType,
    pub agent: Option<AgentRole>,
    pub description: String,
}

/// The type of graph node — processing, routing, or terminal
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GraphNodeType {
    /// An agent processing node
    Agent,
    /// A conditional routing node (fan-out)
    Router,
    /// Parallel branch entry (all children execute concurrently)
    ParallelFanOut,
    /// Parallel branch join (waits for all branches)
    ParallelFanIn,
    /// Debate round node
    Debate,
    /// Consensus voting node
    Consensus,
    /// Terminal node — workflow ends here
    Terminal,
}

/// An edge in the state graph — defines transition between nodes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub condition: Option<EdgeCondition>,
    pub label: String,
}

/// Condition that must be met for an edge to be traversed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeCondition {
    /// Always traverse this edge
    Always,
    /// Only if the intent type matches
    IntentType(String),
    /// Only if consensus was approved
    ConsensusApproved,
    /// Only if consensus was rejected
    ConsensusRejected,
    /// Only if risk tier is at or above threshold
    RiskAbove(u8),
    /// Only if debate round reached agreement
    DebateResolved,
    /// Only if debate round did NOT reach agreement
    DebateUnresolved,
}

/// The state graph definition — built once, executed many times
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateGraph {
    pub id: String,
    pub name: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub entry_node: String,
}

impl StateGraph {
    /// Build the default PrismOS-AI multi-agent collaboration graph
    pub fn default_collaboration_graph() -> Self {
        let mut graph = Self {
            id: Uuid::new_v4().to_string(),
            name: "PrismOS-AI Multi-Agent Collaboration".to_string(),
            nodes: vec![],
            edges: vec![],
            entry_node: "orchestrator".to_string(),
        };

        // ── Define nodes ──
        graph.add_node(GraphNode {
            id: "orchestrator".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::Orchestrator),
            description: "Decomposes intent into work units".into(),
        });

        graph.add_node(GraphNode {
            id: "parallel_analyze".into(),
            node_type: GraphNodeType::ParallelFanOut,
            agent: None,
            description: "One model draft alongside deterministic tool/context checks".into(),
        });

        graph.add_node(GraphNode {
            id: "reasoner".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::Reasoner),
            description: "Deep analysis via LLM inference".into(),
        });

        graph.add_node(GraphNode {
            id: "tool_smith".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::ToolSmith),
            description: "Evaluates tool/execution needs".into(),
        });

        graph.add_node(GraphNode {
            id: "memory_keeper".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::MemoryKeeper),
            description: "Processes graph context & persistence".into(),
        });

        graph.add_node(GraphNode {
            id: "parallel_join".into(),
            node_type: GraphNodeType::ParallelFanIn,
            agent: None,
            description: "Fan-in: collect all specialist proposals".into(),
        });

        graph.add_node(GraphNode {
            id: "debate".into(),
            node_type: GraphNodeType::Debate,
            agent: None,
            description: "Deterministic workflow checks; no independent factual review".into(),
        });

        graph.add_node(GraphNode {
            id: "sentinel_review".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::Sentinel),
            description: "Keyword-based policy screening, not factual validation".into(),
        });

        graph.add_node(GraphNode {
            id: "consensus".into(),
            node_type: GraphNodeType::Consensus,
            agent: None,
            description: "Policy gate: role checks + Sentinel non-veto".into(),
        });

        graph.add_node(GraphNode {
            id: "execute".into(),
            node_type: GraphNodeType::Terminal,
            agent: None,
            description: "Return text draft and attempt policy-gated local memory update".into(),
        });

        graph.add_node(GraphNode {
            id: "rejected".into(),
            node_type: GraphNodeType::Terminal,
            agent: None,
            description: "Consensus rejected — safe fallback response".into(),
        });

        // ── Define edges ──
        graph.add_edge(GraphEdge {
            from: "orchestrator".into(),
            to: "parallel_analyze".into(),
            condition: Some(EdgeCondition::Always),
            label: "broadcast work units".into(),
        });

        // Fan-out to all specialists
        graph.add_edge(GraphEdge {
            from: "parallel_analyze".into(),
            to: "reasoner".into(),
            condition: Some(EdgeCondition::Always),
            label: "analyze via LLM".into(),
        });
        graph.add_edge(GraphEdge {
            from: "parallel_analyze".into(),
            to: "tool_smith".into(),
            condition: Some(EdgeCondition::Always),
            label: "evaluate tools".into(),
        });
        graph.add_edge(GraphEdge {
            from: "parallel_analyze".into(),
            to: "memory_keeper".into(),
            condition: Some(EdgeCondition::Always),
            label: "process context".into(),
        });

        // Fan-in from all specialists
        graph.add_edge(GraphEdge {
            from: "reasoner".into(),
            to: "parallel_join".into(),
            condition: Some(EdgeCondition::Always),
            label: "reasoner proposal".into(),
        });
        graph.add_edge(GraphEdge {
            from: "tool_smith".into(),
            to: "parallel_join".into(),
            condition: Some(EdgeCondition::Always),
            label: "tool smith proposal".into(),
        });
        graph.add_edge(GraphEdge {
            from: "memory_keeper".into(),
            to: "parallel_join".into(),
            condition: Some(EdgeCondition::Always),
            label: "memory keeper proposal".into(),
        });

        // Proposals collected → debate round
        graph.add_edge(GraphEdge {
            from: "parallel_join".into(),
            to: "debate".into(),
            condition: Some(EdgeCondition::Always),
            label: "proposals collected".into(),
        });

        // After debate → sentinel security review
        graph.add_edge(GraphEdge {
            from: "debate".into(),
            to: "sentinel_review".into(),
            condition: Some(EdgeCondition::Always),
            label: "debate complete".into(),
        });

        // Sentinel → consensus vote
        graph.add_edge(GraphEdge {
            from: "sentinel_review".into(),
            to: "consensus".into(),
            condition: Some(EdgeCondition::Always),
            label: "security review done".into(),
        });

        // Consensus → execute (if approved)
        graph.add_edge(GraphEdge {
            from: "consensus".into(),
            to: "execute".into(),
            condition: Some(EdgeCondition::ConsensusApproved),
            label: "approved → execute".into(),
        });

        // Consensus → rejected (if rejected)
        graph.add_edge(GraphEdge {
            from: "consensus".into(),
            to: "rejected".into(),
            condition: Some(EdgeCondition::ConsensusRejected),
            label: "rejected → fallback".into(),
        });

        graph
    }

    fn add_node(&mut self, node: GraphNode) {
        self.nodes.push(node);
    }

    fn add_edge(&mut self, edge: GraphEdge) {
        self.edges.push(edge);
    }

    /// Get outgoing edges from a node
    #[allow(dead_code)]
    pub fn outgoing_edges(&self, node_id: &str) -> Vec<&GraphEdge> {
        self.edges.iter().filter(|e| e.from == node_id).collect()
    }

    /// Get a node by ID
    #[allow(dead_code)]
    pub fn get_node(&self, id: &str) -> Option<&GraphNode> {
        self.nodes.iter().find(|n| n.id == id)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBATE ROUND — Agents challenge and rebut each other's proposals
// ═══════════════════════════════════════════════════════════════════════════════

/// A single argument in a debate round
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateArgument {
    pub id: String,
    pub from: AgentRole,
    pub argument_type: ArgumentType,
    pub target_agent: Option<AgentRole>,
    pub content: String,
    pub confidence: f64,
    pub timestamp: String,
}

/// The type of argument in a debate
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ArgumentType {
    /// Initial position statement
    Position,
    /// Challenge to another agent's position
    Challenge,
    /// Rebuttal to a challenge
    Rebuttal,
    /// Agreement with another agent
    Support,
    /// Concession — agent changes position
    Concession,
}

/// Result of a full debate round
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateResult {
    pub round_id: String,
    pub arguments: Vec<DebateArgument>,
    pub rounds_completed: usize,
    pub max_rounds: usize,
    pub resolved: bool,
    pub winning_position: Option<String>,
    pub agreement_score: f64,
    pub summary: String,
}

/// Produce a deterministic workflow-check record in the legacy debate envelope.
/// No extra model is called, no dialogue is invented, and no fact-check occurs.
pub fn run_debate(
    proposals: &[AgentMessage],
    _intent: &ParsedIntent,
    max_rounds: usize,
) -> DebateResult {
    let arguments = if max_rounds == 0 {
        vec![]
    } else {
        proposals.iter().map(|proposal| {
            let content = match proposal.from {
                AgentRole::Reasoner => format!(
                    "Model draft received: {} characters. Factual accuracy is unvalidated; no independent reviewer was called.",
                    proposal.content.chars().count()
                ),
                AgentRole::MemoryKeeper => format!(
                    "Deterministic context check: {} retrieved nodes available. Source count does not establish relevance or factual support.",
                    proposal.metadata.context_nodes.len()
                ),
                AgentRole::ToolSmith => format!(
                    "Deterministic tool-policy assessment: risk tier {}. No tool execution or artifact was verified by this check.",
                    proposal.metadata.risk_tier
                ),
                _ => format!(
                    "Deterministic role-check record for {}. This is not independent model analysis or factual verification.",
                    proposal.from.display_name()
                ),
            };
            DebateArgument {
                id: Uuid::new_v4().to_string(),
                from: proposal.from.clone(),
                // Preserve the wire format; this is a check record, not dialogue.
                argument_type: ArgumentType::Position,
                target_agent: None,
                content,
                confidence: 0.0,
                timestamp: Utc::now().to_rfc3339(),
            }
        }).collect::<Vec<_>>()
    };
    DebateResult {
        round_id: Uuid::new_v4().to_string(),
        rounds_completed: usize::from(!arguments.is_empty()),
        max_rounds,
        resolved: false, // no factual debate has been conducted or resolved
        winning_position: None,
        agreement_score: 0.0, // unknown, not a fabricated consensus percentage
        summary: format!(
            "Workflow checks: {} records; one model draft plus deterministic role checks. Factual accuracy: unvalidated. No model debate or independent fact-check was performed.",
            arguments.len()
        ),
        arguments,
    }
}

/// Summarize a proposal to a short debate-friendly statement
#[cfg(test)]
fn summarize_proposal(content: &str) -> String {
    let truncated: String = content.chars().take(200).collect();
    if content.len() > 200 {
        format!("{}...", truncated)
    } else {
        truncated
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKFLOW ENGINE — Executes the state graph with full audit trail
// ═══════════════════════════════════════════════════════════════════════════════

/// Current state of the workflow execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowState {
    pub workflow_id: String,
    pub graph_id: String,
    pub current_node: String,
    pub visited_nodes: Vec<String>,
    pub transitions: Vec<StateTransition>,
    pub proposals: Vec<AgentMessage>,
    pub debate: Option<DebateResult>,
    pub consensus: Option<ConsensusOutcome>,
    pub status: WorkflowStatus,
    pub checkpoints: Vec<WorkflowCheckpoint>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// A single state transition in the workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateTransition {
    pub from_node: String,
    pub to_node: String,
    pub edge_label: String,
    pub timestamp: String,
    pub duration_ms: u64,
}

/// Status of the workflow execution
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkflowStatus {
    Running,
    DebateInProgress,
    VotingInProgress,
    Approved,
    Rejected,
    Failed,
}

/// Checkpoint for audit trail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowCheckpoint {
    pub node_id: String,
    pub state_hash: String,
    pub timestamp: String,
}

/// Extended collaboration summary for frontend (includes debate)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSummary {
    pub workflow_id: String,
    pub status: String,
    pub current_node: String,
    pub transitions: Vec<TransitionSummary>,
    pub debate_summary: Option<DebateSummary>,
    pub consensus_approved: bool,
    pub consensus_summary: String,
    pub vote_count: usize,
    pub approve_count: usize,
    pub reject_count: usize,
    pub message_count: usize,
    pub total_arguments: usize,
    pub agreement_score: f64,
}

/// Compact transition info for frontend
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitionSummary {
    pub from: String,
    pub to: String,
    pub label: String,
    pub duration_ms: u64,
}

/// Compact debate info for frontend
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebateSummary {
    pub rounds: usize,
    pub total_arguments: usize,
    pub positions: usize,
    pub challenges: usize,
    pub rebuttals: usize,
    pub supports: usize,
    pub agreement_score: f64,
    pub resolved: bool,
    pub arguments: Vec<ArgumentSummary>,
}

/// A single argument for frontend display
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArgumentSummary {
    pub agent: String,
    pub argument_type: String,
    pub target: Option<String>,
    pub content: String,
    pub confidence: f64,
}

/// The Workflow Engine executes the full LangGraph pipeline
pub struct WorkflowEngine;

impl WorkflowEngine {
    /// Execute the full LangGraph workflow for an intent
    // The workflow boundary intentionally keeps its inputs explicit.
    #[allow(clippy::too_many_arguments)]
    pub async fn execute(
        intent: ParsedIntent,
        context_summary: &str,
        context_node_ids: &[String],
        scored_context: &[(String, f64)],
        npu_accelerated: bool,
        app_dir: &Path,
        app_handle: tauri::AppHandle,
        model: &str,
    ) -> Result<
        (crate::refractive_core::RefractiveResult, WorkflowState),
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let graph = StateGraph::default_collaboration_graph();
        let start = std::time::Instant::now();

        let mut state = WorkflowState {
            workflow_id: Uuid::new_v4().to_string(),
            graph_id: graph.id.clone(),
            current_node: graph.entry_node.clone(),
            visited_nodes: vec![],
            transitions: vec![],
            proposals: vec![],
            debate: None,
            consensus: None,
            status: WorkflowStatus::Running,
            checkpoints: vec![],
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
        };

        // Create a collaboration session for message tracking
        let mut session = CollaborationSession::new(&intent.raw);

        // ═══════════════════════════════════════════════════════════════
        // NODE 1: ORCHESTRATOR — Decompose intent
        // ═══════════════════════════════════════════════════════════════
        let node_start = std::time::Instant::now();
        state.visit_node("orchestrator");
        session.current_phase = CollaborationPhase::Orchestrating;
        session.push_trace("Orchestrator", "Decomposing intent", StepStatus::Active);
        emit_activity(&app_handle, "Orchestrator", "Decomposing intent into work units…", "thinking", "orchestrate");

        let work_units =
            OrchestratorNode::decompose(&intent, context_summary, context_node_ids);
        for unit in &work_units {
            session.add_message(unit.clone());
        }
        session.complete_trace_step("Orchestrator");
        state.checkpoint("orchestrator");
        state.transition("orchestrator", "parallel_analyze", "broadcast work units", node_start);
        emit_activity(&app_handle, "Orchestrator", &format!("Dispatched {} work units to specialists", work_units.len()), "completed", "orchestrate");

        eprintln!(
            "[LangGraph-WF] Orchestrator decomposed intent → {} work units",
            work_units.len()
        );

        // ═══════════════════════════════════════════════════════════════
        // NODE 2: PARALLEL FAN-OUT — Specialists analyze simultaneously
        // ═══════════════════════════════════════════════════════════════
        state.visit_node("parallel_analyze");
        session.current_phase = CollaborationPhase::Analyzing;

        // ── Prepare work units for all three specialists ──
        let reasoner_work = work_units
            .iter()
            .find(|m| m.to == MessageTarget::Agent(AgentRole::Reasoner))
            .cloned();
        let tool_smith_work = work_units
            .iter()
            .find(|m| matches!(m.to, MessageTarget::Agent(AgentRole::ToolSmith)))
            .cloned();
        let memory_keeper_work = work_units
            .iter()
            .find(|m| matches!(m.to, MessageTarget::Agent(AgentRole::MemoryKeeper)))
            .cloned();

        // Push all trace entries before the parallel section
        session.push_trace("Reasoner", "Analyzing intent via LLM", StepStatus::Active);
        session.push_trace("Tool Smith", "Evaluating tool needs", StepStatus::Active);
        session.push_trace("Memory Keeper", "Processing graph context", StepStatus::Active);
        emit_activity(&app_handle, "Reasoner", "Analyzing intent via LLM…", "thinking", "analyze");
        emit_activity(&app_handle, "Tool Smith", "Evaluating tool and execution needs…", "thinking", "analyze");
        emit_activity(&app_handle, "Memory Keeper", "Querying Spectrum Graph for context…", "thinking", "analyze");

        let parallel_start = std::time::Instant::now();
        let wf_id_prefix = state.workflow_id[..8].to_string();
        let intent_for_ts = intent.clone();
        let intent_for_mk = intent.clone();
        let ctx_len = context_node_ids.len();

        // ── Per-role model routing (smart_router) ──
        // Give the Reasoner the best locally-installed model for THIS task kind:
        // analysis → reasoning lane, code → code lane, otherwise keep the user's
        // model (normal chat is unchanged). Falls back to the user's model when no
        // specialist is installed, and surfaces any swap in the activity feed.
        let raw_lower = intent.raw.to_lowercase();
        let is_code_intent = [
            "code", "function", "debug", "compile", "algorithm", "implement",
            "refactor", "programming", "bug", "api", "endpoint", "rust",
            "python", "javascript", "typescript",
        ]
        .iter()
        .any(|kw| raw_lower.contains(kw));
        let reasoner_task = if is_code_intent {
            crate::smart_router::TaskKind::Code
        } else if matches!(intent.intent_type, crate::refractive_core::IntentType::Analyze) {
            crate::smart_router::TaskKind::Reasoning
        } else {
            crate::smart_router::TaskKind::General
        };
        let model_name = if matches!(reasoner_task, crate::smart_router::TaskKind::General) {
            model.to_string()
        } else {
            let available = crate::ollama_bridge::list_models(None).await.unwrap_or_default();
            let model_names: Vec<String> = available.into_iter().map(|m| m.name).collect();
            let decision = crate::smart_router::route_for_task(model, reasoner_task, &model_names);
            if decision.auto_swapped {
                emit_activity(
                    &app_handle,
                    "Reasoner",
                    &format!("Routing to {} — {}", decision.model, decision.reason),
                    "thinking",
                    "analyze",
                );
                eprintln!(
                    "[LangGraph-WF] Reasoner routed {} → {} ({})",
                    model, decision.model, decision.reason
                );
            }
            decision.model
        };

        // ── Run all three specialists concurrently via tokio::join! ──
        // Reasoner awaits the LLM network call while Tool Smith and Memory
        // Keeper complete their synchronous evaluations in the same task.
        let (llm_response, tool_smith_proposal, memory_keeper_proposal) = tokio::join!(
            // 2a: Reasoner — async LLM inference (I/O-bound, yields at .await)
            async {
                if let Some(ref work) = reasoner_work {
                    let llm_action = format!("llm_inference:generate:model={}:agent=reasoner", model_name);
                    let prism_name = format!("wf_reasoner_{}", wf_id_prefix);
                    let mut prism =
                        crate::sandbox_prism::create_prism_for_agent(&prism_name, "reasoner");
                    let sandbox_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
                        &mut prism,
                        &llm_action,
                        "reasoner",
                    );
                    if sandbox_result.success {
                        let (mut system_prompt, user_content) = ReasonerNode::build_prompt(work, &intent);

                        // Apply Cognitive Imprint — context-aware band selection
                        // Uses the Query-Type × Cognitive-Profile Matrix to pick the
                        // optimal reasoning style for this specific question + user combo.
                        if let Ok(g) = crate::spectrum_graph::SpectrumGraph::new(app_dir) {
                            if let Ok(profile) = g.get_cognitive_profile() {
                                let mods = profile.prompt_modifiers_for_query(&intent.raw);
                                if !mods.is_empty() {
                                    system_prompt.push_str(&mods);
                                }
                            }
                        }

                        // Retrieve few-shot examples from highly-rated past responses
                        let few_shots = crate::spectrum_graph::SpectrumGraph::new(app_dir)
                            .ok()
                            .and_then(|g| g.get_good_examples(&intent.raw, 2).ok())
                            .filter(|v| !v.is_empty());

                        // Reasoning lane opts into a thinking trace: the bridge
                        // translates the /think directive into Ollama's `think`
                        // flag and strips it from the prompt. Everyday lanes on
                        // hybrid models keep thinking off for fast, clean answers.
                        let user_content = if matches!(reasoner_task, crate::smart_router::TaskKind::Reasoning) {
                            format!("{} /think", user_content)
                        } else {
                            user_content
                        };
                        match crate::ollama_bridge::chat(&model_name, &system_prompt, &user_content, None, None, few_shots).await {
                            Ok(r) if !r.trim().is_empty() => Ok(r),
                            Ok(_) => Err("The model returned an empty draft. No answer or knowledge was saved.".to_string()),
                            Err(e) => {
                                let err_text = e.to_string();
                                let lower = err_text.to_lowercase();
                                // Distinguish "model not installed" from "Ollama is down".
                                // Ollama answers HTTP 404 with `model '<name>' not found`
                                // when the tag isn't pulled; any HTTP status back means
                                // the daemon is up — so confirm with is_available().
                                let looks_like_missing_model = lower.contains("not found")
                                    || lower.contains("no such model")
                                    || lower.contains("(404");
                                let ollama_up = crate::ollama_bridge::is_available(None)
                                    .await
                                    .unwrap_or(false);
                                if looks_like_missing_model && ollama_up {
                                    eprintln!(
                                        "[LangGraph-WF] model not installed: {} ({})",
                                        model_name, err_text
                                    );
                                    Err(format!(
                                        "The model `{model}` isn't installed.\n\n\
                                         • Pull it:  `ollama pull {model}`\n\
                                         • Or pick an installed model in Settings → Model.\n\n\
                                         Ollama is running — only this model is missing. \
                                         Your data stays local.",
                                        model = model_name
                                    ))
                                } else {
                                    eprintln!("[LangGraph-WF] Ollama unavailable: {}", err_text);
                                    Err("I'm currently unable to reach the AI model. \
                                         Please make sure Ollama is running:\n\n\
                                         1. Open a terminal\n\
                                         2. Run `ollama serve`\n\
                                         3. Try your question again\n\n\
                                         Your data is safe — everything stays local."
                                        .to_string())
                                }
                            }
                        }
                    } else {
                        Err(format!(
                            "🛡️ [Sandbox] LLM inference denied for Reasoner: {}",
                            sandbox_result.output
                        ))
                    }
                } else {
                    Err("Reasoner: no work unit received".to_string())
                }
            },
            // 2b: Tool Smith — sync evaluation (completes instantly)
            async {
                let proposal = if let Some(ref work) = tool_smith_work {
                    ToolSmithNode::evaluate(work, &intent_for_ts)
                } else {
                    AgentMessage::new(
                        AgentRole::ToolSmith,
                        MessageTarget::Consensus,
                        MessageType::Proposal,
                        "Tool Smith: no tool execution required".to_string(),
                    )
                };
                emit_activity(&app_handle, "Tool Smith", "Deterministic tool-policy check complete; no tool executed", "completed", "analyze");
                proposal
            },
            // 2c: Memory Keeper — sync processing (completes instantly)
            async {
                let proposal = if let Some(ref work) = memory_keeper_work {
                    MemoryKeeperNode::process(work, &intent_for_mk, ctx_len)
                } else {
                    AgentMessage::new(
                        AgentRole::MemoryKeeper,
                        MessageTarget::Consensus,
                        MessageType::Proposal,
                        "Memory Keeper: no graph updates needed".to_string(),
                    )
                };
                emit_activity(&app_handle, "Memory Keeper", "Context-availability check complete; factual support unvalidated", "completed", "analyze");
                proposal
            }
        );

        // Errors are not model answers and must not be approved or learned.
        let llm_response = llm_response.map_err(|message| -> Box<dyn std::error::Error + Send + Sync> {
            message.into()
        })?;

        // ── Record Reasoner results ──
        // No independent factual validation or calibrated confidence is available.
        let reasoner_confidence = 0.0;
        let reasoner_proposal =
            ReasonerNode::propose(&llm_response, reasoner_confidence, context_node_ids.to_vec());
        state.visit_node("reasoner");
        session.add_message(reasoner_proposal.clone());
        state.proposals.push(reasoner_proposal.clone());
        session.complete_trace_step("Reasoner");
        state.checkpoint("reasoner");
        state.transition("reasoner", "parallel_join", "reasoner proposal", parallel_start);
        emit_activity(&app_handle, "Reasoner", "Analysis complete — proposal ready", "completed", "analyze");

        // ── Record Tool Smith results ──
        state.visit_node("tool_smith");
        session.add_message(tool_smith_proposal.clone());
        state.proposals.push(tool_smith_proposal.clone());
        session.complete_trace_step("Tool Smith");
        state.checkpoint("tool_smith");
        state.transition("tool_smith", "parallel_join", "tool smith proposal", parallel_start);

        // ── Record Memory Keeper results ──
        state.visit_node("memory_keeper");
        session.add_message(memory_keeper_proposal.clone());
        state.proposals.push(memory_keeper_proposal.clone());
        session.complete_trace_step("Memory Keeper");
        state.checkpoint("memory_keeper");
        state.transition("memory_keeper", "parallel_join", "memory keeper proposal", parallel_start);

        eprintln!("[LangGraph-WF] All 3 specialists completed analysis (parallel via tokio::join!)");

        // ═══════════════════════════════════════════════════════════════
        // NODE 3: PARALLEL JOIN + DEBATE — Agents debate proposals
        // ═══════════════════════════════════════════════════════════════
        let debate_start = std::time::Instant::now();
        state.visit_node("parallel_join");
        state.visit_node("debate");
        state.status = WorkflowStatus::DebateInProgress;
        session.current_phase = CollaborationPhase::Proposing;
        session.push_trace("Workflow checks", "Deterministic role checks (not fact-checking)", StepStatus::Active);
        emit_activity(&app_handle, "Workflow checks", "Reviewing deterministic role checks; no model debate…", "thinking", "debate");

        let all_proposals = vec![
            reasoner_proposal.clone(),
            tool_smith_proposal.clone(),
            memory_keeper_proposal.clone(),
        ];

        let debate_result = run_debate(&all_proposals, &intent, 1);

        // Emit individual debate arguments for live log
        for arg in &debate_result.arguments {
            let arg_label = match arg.argument_type {
                ArgumentType::Position => "check record",
                ArgumentType::Challenge => "check concern",
                ArgumentType::Rebuttal => "check response",
                ArgumentType::Support => "check support",
                ArgumentType::Concession => "check update",
            };
            let target_str = arg.target_agent.as_ref()
                .map(|t| format!(" → {}", t.display_name()))
                .unwrap_or_default();
            emit_activity(
                &app_handle,
                arg.from.display_name(),
                &format!("{}{}: {}", arg_label, target_str, arg.content.chars().take(80).collect::<String>()),
                "thinking",
                "debate",
            );
        }

        // Record debate arguments as messages
        for arg in &debate_result.arguments {
            let msg_type = match arg.argument_type {
                ArgumentType::Position => MessageType::Proposal,
                ArgumentType::Challenge | ArgumentType::Rebuttal => MessageType::Analysis,
                ArgumentType::Support | ArgumentType::Concession => MessageType::StatusUpdate,
            };
            session.add_message(
                AgentMessage::new(
                    arg.from.clone(),
                    MessageTarget::Consensus,
                    msg_type,
                    arg.content.clone(),
                )
                .with_confidence(arg.confidence),
            );
        }

        state.debate = Some(debate_result.clone());
        session.complete_trace_step("Workflow checks");
        state.checkpoint("debate");
        state.transition("debate", "sentinel_review", "debate complete", debate_start);
        emit_activity(
            &app_handle,
            "Workflow checks",
            "Role checks recorded; answer remains factually unvalidated",
            "completed",
            "debate",
        );

        eprintln!(
            "[LangGraph-WF] Debate: {} rounds, {} arguments, agreement {:.0}%",
            debate_result.rounds_completed,
            debate_result.arguments.len(),
            debate_result.agreement_score * 100.0
        );

        // ═══════════════════════════════════════════════════════════════
        // NODE 4: SENTINEL REVIEW — Security gate
        // ═══════════════════════════════════════════════════════════════
        let sentinel_start = std::time::Instant::now();
        state.visit_node("sentinel_review");
        session.current_phase = CollaborationPhase::SecurityReview;
        session.push_trace("Sentinel", "Security review", StepStatus::Active);
        emit_activity(&app_handle, "Sentinel", "Reviewing all proposals for security…", "thinking", "review");

        let security_review = SentinelNode::review(&all_proposals, &intent);
        let sentinel_passed = security_review.content.contains("✅ CLEAR");
        session.add_message(security_review);
        session.complete_trace_step("Sentinel");
        state.checkpoint("sentinel_review");
        state.transition("sentinel_review", "consensus", "security review done", sentinel_start);
        emit_activity(
            &app_handle,
            "Sentinel",
            if sentinel_passed { "Security review passed ✓" } else { "Security review flagged ⚠️ concerns" },
            "completed",
            "review",
        );

        eprintln!("[LangGraph-WF] Sentinel security review complete");

        // ═══════════════════════════════════════════════════════════════
        // NODE 5: CONSENSUS — Weighted voting with debate influence
        // ═══════════════════════════════════════════════════════════════
        let vote_start = std::time::Instant::now();
        state.visit_node("consensus");
        state.status = WorkflowStatus::VotingInProgress;
        session.current_phase = CollaborationPhase::Voting;
        session.push_trace("Consensus", "Deterministic policy gate", StepStatus::Active);
        emit_activity(&app_handle, "Consensus", "Applying role-policy checks (not independent model reviews)…", "thinking", "vote");

        let orchestrator_vote = Vote {
            agent: AgentRole::Orchestrator,
            approve: true,
            reason: "Routing check passed; factual accuracy is unvalidated".to_string(),
            confidence: 0.0,
        };
        let reasoner_vote = ReasonerNode::vote(&llm_response, &reasoner_proposal.content);
        let tool_smith_vote = ToolSmithNode::vote(&llm_response);
        let memory_keeper_vote = MemoryKeeperNode::vote(&llm_response, context_node_ids);
        let sentinel_vote = SentinelNode::vote(&all_proposals, &intent);

        let votes = vec![
            orchestrator_vote,
            reasoner_vote,
            tool_smith_vote,
            memory_keeper_vote,
            sentinel_vote,
        ];

        for vote in &votes {
            session.add_vote(vote.clone());
            session.add_message(AgentMessage::new(
                vote.agent.clone(),
                MessageTarget::Consensus,
                MessageType::Vote,
                format!(
                    "{}: {} (confidence: {:.0}%)",
                    if vote.approve { "APPROVE" } else { "REJECT" },
                    vote.reason,
                    vote.confidence * 100.0
                ),
            ));
        }

        let consensus = run_consensus(&votes);
        session.consensus = Some(consensus.clone());
        state.consensus = Some(consensus.clone());
        session.complete_trace_step("Consensus");
        emit_activity(
            &app_handle,
            "Consensus",
            &format!("Policy gate {} — {}/{} role checks passed; not a fact-check", if consensus.approved { "passed" } else { "rejected" }, consensus.approve_count, votes.len()),
            "completed",
            "vote",
        );

        // Record consensus message
        session.add_message(AgentMessage::new(
            AgentRole::Orchestrator,
            MessageTarget::Broadcast,
            MessageType::ConsensusResult,
            consensus.summary.clone(),
        ));

        let target_node = if consensus.approved {
            state.status = WorkflowStatus::Approved;
            "execute"
        } else {
            state.status = WorkflowStatus::Rejected;
            "rejected"
        };
        state.transition("consensus", target_node, &format!("{} → {}", if consensus.approved { "approved" } else { "rejected" }, target_node), vote_start);

        eprintln!(
            "[LangGraph-WF] Consensus: approved={}, votes={}/{}",
            consensus.approved, consensus.approve_count, votes.len()
        );

        // ═══════════════════════════════════════════════════════════════
        // NODE 6: EXECUTE or REJECT
        // ═══════════════════════════════════════════════════════════════
        let _exec_start = std::time::Instant::now();
        state.visit_node(target_node);
        session.current_phase = CollaborationPhase::Executing;
        session.push_trace("Sandbox Prism", "Finalizing response and local memory", StepStatus::Active);
        emit_activity(&app_handle, "Sandbox Prism", "Finalizing text response; checking local memory-write policy…", "thinking", "execute");

        let final_response;
        let mut edges_reinforced = vec![];
        let mut conversation_id: Option<String> = None;
        let agent_used;

        if consensus.approved {
            final_response = format!("{}\n\n---\nEvidence status: unvalidated model draft · deterministic workflow checks, not independent fact-checking.", llm_response);
            agent_used = determine_primary_agent(&intent);

            match MemoryKeeperNode::execute_graph_updates(
                &intent,
                &final_response,
                scored_context,
                app_dir,
            ) {
                Ok((edges, conv_id)) => {
                    edges_reinforced = edges;
                    conversation_id = Some(conv_id);
                }
                Err(e) => {
                    eprintln!("[LangGraph-WF] Memory Keeper graph update failed: {}", e);
                }
            }
        } else {
            final_response = "I wasn't able to confidently answer this request — \
                my safety checks flagged it for review. Could you try rephrasing \
                your question? Your data remains safe and nothing was changed."
                .to_string();
            agent_used = "orchestrator".to_string();
        }

        session.complete_trace_step("Sandbox Prism");
        session.complete();
        state.checkpoint(target_node);
        state.completed_at = Some(Utc::now().to_rfc3339());
        emit_activity(&app_handle, "Sandbox Prism", "Workflow complete; no tool execution or artifact creation verified in this text lane", "completed", "execute");

        // Record execution result
        session.add_message(AgentMessage::new(
            AgentRole::Orchestrator,
            MessageTarget::Broadcast,
            MessageType::ExecutionResult,
            format!(
                "Workflow complete. Consensus: {}. Debate: {}. Agents: {}. Edges: {}.",
                if consensus.approved {
                    "APPROVED"
                } else {
                    "REJECTED"
                },
                if debate_result.resolved {
                    "RESOLVED"
                } else {
                    "UNRESOLVED"
                },
                votes.len(),
                edges_reinforced.len()
            ),
        ));

        // Get anticipatory suggestions
        let anticipations = match crate::spectrum_graph::SpectrumGraph::new(app_dir) {
            Ok(graph) => graph
                .anticipate_needs()
                .unwrap_or_default()
                .into_iter()
                .take(3)
                .map(|n| n.suggestion)
                .collect(),
            Err(_) => vec![],
        };

        let elapsed = start.elapsed().as_millis() as u64;

        let result = crate::refractive_core::RefractiveResult {
            response: final_response,
            intent,
            agent_used,
            context_nodes: context_node_ids.to_vec(),
            edges_reinforced,
            anticipations,
            processing_time_ms: elapsed,
            npu_accelerated,
            collaboration: None, // Filled by caller with WorkflowSummary conversion
            conversation_id,
            query_type: None,    // Filled by refractive_core::refract()
            natural_band: None,  // Filled by refractive_core::refract()
            applied_band: None,  // Filled by refractive_core::refract()
            domain_detected: None, // Filled by refractive_core::refract()
        };

        Ok((result, state))
    }

    /// Convert a WorkflowState into a compact WorkflowSummary for the frontend
    #[allow(dead_code)]
    pub fn summarize(state: &WorkflowState, session: &CollaborationSession) -> WorkflowSummary {
        let debate_summary = state.debate.as_ref().map(|d| DebateSummary {
            rounds: d.rounds_completed,
            total_arguments: d.arguments.len(),
            positions: d
                .arguments
                .iter()
                .filter(|a| a.argument_type == ArgumentType::Position)
                .count(),
            challenges: d
                .arguments
                .iter()
                .filter(|a| a.argument_type == ArgumentType::Challenge)
                .count(),
            rebuttals: d
                .arguments
                .iter()
                .filter(|a| a.argument_type == ArgumentType::Rebuttal)
                .count(),
            supports: d
                .arguments
                .iter()
                .filter(|a| a.argument_type == ArgumentType::Support)
                .count(),
            agreement_score: d.agreement_score,
            resolved: d.resolved,
            arguments: d
                .arguments
                .iter()
                .map(|a| ArgumentSummary {
                    agent: a.from.display_name().to_string(),
                    argument_type: format!("{:?}", a.argument_type),
                    target: a.target_agent.as_ref().map(|t| t.display_name().to_string()),
                    content: a.content.clone(),
                    confidence: a.confidence,
                })
                .collect(),
        });

        let consensus = state.consensus.as_ref();

        WorkflowSummary {
            workflow_id: state.workflow_id.clone(),
            status: format!("{:?}", state.status),
            current_node: state.current_node.clone(),
            transitions: state
                .transitions
                .iter()
                .map(|t| TransitionSummary {
                    from: t.from_node.clone(),
                    to: t.to_node.clone(),
                    label: t.edge_label.clone(),
                    duration_ms: t.duration_ms,
                })
                .collect(),
            debate_summary,
            consensus_approved: consensus.map(|c| c.approved).unwrap_or(false),
            consensus_summary: consensus
                .map(|c| c.summary.clone())
                .unwrap_or_default(),
            vote_count: session.votes.len(),
            approve_count: consensus.map(|c| c.approve_count).unwrap_or(0),
            reject_count: consensus.map(|c| c.reject_count).unwrap_or(0),
            message_count: session.messages.len(),
            total_arguments: state
                .debate
                .as_ref()
                .map(|d| d.arguments.len())
                .unwrap_or(0),
            agreement_score: state
                .debate
                .as_ref()
                .map(|d| d.agreement_score)
                .unwrap_or(1.0),
        }
    }
}

impl WorkflowState {
    fn visit_node(&mut self, node_id: &str) {
        self.current_node = node_id.to_string();
        if !self.visited_nodes.contains(&node_id.to_string()) {
            self.visited_nodes.push(node_id.to_string());
        }
    }

    fn transition(
        &mut self,
        from: &str,
        to: &str,
        label: &str,
        start: std::time::Instant,
    ) {
        self.transitions.push(StateTransition {
            from_node: from.to_string(),
            to_node: to.to_string(),
            edge_label: label.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            duration_ms: start.elapsed().as_millis() as u64,
        });
    }

    fn checkpoint(&mut self, node_id: &str) {
        let state_data = format!(
            "{}:{}:{}",
            self.workflow_id,
            node_id,
            self.visited_nodes.len()
        );
        let hash = format!("{:x}", md5_simple(&state_data));
        self.checkpoints.push(WorkflowCheckpoint {
            node_id: node_id.to_string(),
            state_hash: hash,
            timestamp: Utc::now().to_rfc3339(),
        });
    }
}

/// Simple hash for checkpoint (not cryptographic — just for audit)
fn md5_simple(data: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in data.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Determine the primary agent based on intent type
fn determine_primary_agent(intent: &ParsedIntent) -> String {
    match intent.intent_type {
        IntentType::Query | IntentType::Analyze => "reasoner".to_string(),
        IntentType::Create => "tool_smith".to_string(),
        IntentType::Connect => "memory_keeper".to_string(),
        IntentType::System => "sentinel".to_string(),
    }
}

/// Get the state graph definition (for frontend visualization)
pub fn get_state_graph() -> StateGraph {
    StateGraph::default_collaboration_graph()
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TESTS — LangGraph Workflow Engine
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ─── StateGraph Construction ───────────────────────────────────────────

    #[test]
    fn test_default_collaboration_graph_has_11_nodes() {
        let graph = StateGraph::default_collaboration_graph();
        assert_eq!(graph.nodes.len(), 11, "default graph should have 11 nodes");
    }

    #[test]
    fn test_default_collaboration_graph_entry_node() {
        let graph = StateGraph::default_collaboration_graph();
        assert_eq!(graph.entry_node, "orchestrator");
    }

    #[test]
    fn test_default_graph_has_correct_node_types() {
        let graph = StateGraph::default_collaboration_graph();

        let agent_nodes: Vec<_> = graph.nodes.iter()
            .filter(|n| n.node_type == GraphNodeType::Agent).collect();
        assert_eq!(agent_nodes.len(), 5, "should have 5 agent nodes");

        let terminal_nodes: Vec<_> = graph.nodes.iter()
            .filter(|n| n.node_type == GraphNodeType::Terminal).collect();
        assert_eq!(terminal_nodes.len(), 2, "should have 2 terminal nodes");

        let debate_nodes: Vec<_> = graph.nodes.iter()
            .filter(|n| n.node_type == GraphNodeType::Debate).collect();
        assert_eq!(debate_nodes.len(), 1, "should have 1 debate node");

        let consensus_nodes: Vec<_> = graph.nodes.iter()
            .filter(|n| n.node_type == GraphNodeType::Consensus).collect();
        assert_eq!(consensus_nodes.len(), 1, "should have 1 consensus node");
    }

    #[test]
    fn test_default_graph_edges_count() {
        let graph = StateGraph::default_collaboration_graph();
        assert!(graph.edges.len() >= 11, "should have at least 11 edges, got {}", graph.edges.len());
    }

    // ─── Graph Traversal ───────────────────────────────────────────────────

    #[test]
    fn test_get_node_existing() {
        let graph = StateGraph::default_collaboration_graph();
        let node = graph.get_node("orchestrator");
        assert!(node.is_some());
        assert_eq!(node.unwrap().node_type, GraphNodeType::Agent);
    }

    #[test]
    fn test_get_node_nonexistent() {
        let graph = StateGraph::default_collaboration_graph();
        assert!(graph.get_node("nonexistent").is_none());
    }

    #[test]
    fn test_outgoing_edges_from_orchestrator() {
        let graph = StateGraph::default_collaboration_graph();
        let edges = graph.outgoing_edges("orchestrator");
        assert_eq!(edges.len(), 1, "orchestrator should have 1 outgoing edge");
        assert_eq!(edges[0].to, "parallel_analyze");
    }

    #[test]
    fn test_outgoing_edges_from_parallel_fanout() {
        let graph = StateGraph::default_collaboration_graph();
        let edges = graph.outgoing_edges("parallel_analyze");
        assert_eq!(edges.len(), 3, "parallel_analyze should fan-out to 3 agents");
    }

    #[test]
    fn test_consensus_has_two_outgoing_edges() {
        let graph = StateGraph::default_collaboration_graph();
        let edges = graph.outgoing_edges("consensus");
        assert_eq!(edges.len(), 2, "consensus should have approved + rejected edges");

        let conditions: Vec<_> = edges.iter().map(|e| e.condition.as_ref().unwrap()).collect();
        let has_approved = conditions.iter().any(|c| matches!(c, EdgeCondition::ConsensusApproved));
        let has_rejected = conditions.iter().any(|c| matches!(c, EdgeCondition::ConsensusRejected));
        assert!(has_approved, "should have ConsensusApproved edge");
        assert!(has_rejected, "should have ConsensusRejected edge");
    }

    // ─── get_state_graph ───────────────────────────────────────────────────

    #[test]
    fn test_get_state_graph_returns_valid() {
        let graph = get_state_graph();
        assert!(!graph.nodes.is_empty());
        assert!(!graph.edges.is_empty());
        assert!(!graph.id.is_empty());
    }

    // ─── Debate Engine ─────────────────────────────────────────────────────

    fn make_test_intent() -> ParsedIntent {
        ParsedIntent {
            raw: "What is Rust ownership?".into(),
            intent_type: IntentType::Query,
            entities: vec!["Rust".into(), "ownership".into()],
            confidence: 0.9,
        }
    }

    fn make_test_proposals() -> Vec<AgentMessage> {
        vec![
            AgentMessage::new(
                AgentRole::Reasoner,
                MessageTarget::Broadcast,
                MessageType::Proposal,
                "Rust uses ownership for memory safety without garbage collection.".into(),
            ).with_metadata(MessageMetadata {
                confidence: 0.9, risk_tier: 1,
                context_nodes: vec!["n1".into()], tags: vec![],
            }),
            AgentMessage::new(
                AgentRole::ToolSmith,
                MessageTarget::Broadcast,
                MessageType::Proposal,
                "No tools needed for this query. Read-only operation.".into(),
            ).with_metadata(MessageMetadata {
                confidence: 0.85, risk_tier: 1,
                context_nodes: vec![], tags: vec![],
            }),
            AgentMessage::new(
                AgentRole::MemoryKeeper,
                MessageTarget::Broadcast,
                MessageType::Proposal,
                "Found related context in Spectrum Graph about Rust patterns.".into(),
            ).with_metadata(MessageMetadata {
                confidence: 0.8, risk_tier: 1,
                context_nodes: vec!["n2".into(), "n3".into()], tags: vec![],
            }),
        ]
    }

    #[test]
    fn workflow_checks_are_one_pass_not_a_model_debate() {
        let result = run_debate(&make_test_proposals(), &make_test_intent(), 3);
        assert_eq!(result.rounds_completed, 1);
        assert_eq!(result.arguments.len(), 3);
        assert!(result.arguments.iter().all(|a| a.argument_type == ArgumentType::Position));
        assert!(result.arguments.iter().all(|a| a.target_agent.is_none()));
        assert!(result.arguments.iter().all(|a| a.confidence == 0.0));
        assert!(!result.resolved);
        assert_eq!(result.agreement_score, 0.0);
        assert!(result.winning_position.is_none());
        assert!(result.summary.contains("Factual accuracy: unvalidated"));
    }

    #[test]
    fn source_count_never_becomes_empirical_backing() {
        for count in [0, 1, 100] {
            let mut proposals = make_test_proposals();
            for proposal in &mut proposals {
                proposal.metadata.context_nodes = (0..count).map(|i| format!("n{i}")).collect();
            }
            let result = run_debate(&proposals, &make_test_intent(), 3);
            let content = result.arguments.iter().map(|a| a.content.as_str()).collect::<Vec<_>>().join(" ");
            assert!(content.contains("Source count does not establish"));
            assert!(!content.contains("empirical backing"));
            assert!(!content.contains("still valid without"));
            assert!(!result.resolved);
            assert_eq!(result.agreement_score, 0.0);
        }
    }

    #[test]
    fn workflow_checks_do_not_replay_model_reasoning_or_private_source_text() {
        let mut proposals = make_test_proposals();
        proposals[0].content = "SENSITIVE_DRAFT_CONTENT <think>hidden reasoning</think>".into();
        let result = run_debate(&proposals, &make_test_intent(), 3);
        assert!(result.arguments.iter().all(|a| !a.content.contains("SENSITIVE_DRAFT_CONTENT")));
        assert!(result.arguments.iter().all(|a| !a.content.contains("<think>")));
    }

    #[test]
    fn workflow_checks_respect_disabled_and_empty_inputs() {
        let disabled = run_debate(&make_test_proposals(), &make_test_intent(), 0);
        assert!(disabled.arguments.is_empty());
        assert_eq!(disabled.rounds_completed, 0);
        let empty = run_debate(&[], &make_test_intent(), 3);
        assert!(empty.arguments.is_empty());
        assert_eq!(empty.rounds_completed, 0);
        assert!(empty.winning_position.is_none());
        assert!(!empty.resolved);
    }

    // ─── Summarize Proposal ────────────────────────────────────────────────

    #[test]
    fn test_summarize_proposal_truncates() {
        let long = "a".repeat(300);
        let summary = summarize_proposal(&long);
        assert!(summary.len() <= 203, "should truncate to ~200 chars + '...'");
        assert!(summary.ends_with("..."));
    }

    #[test]
    fn test_summarize_proposal_short() {
        let short = "Short proposal";
        let summary = summarize_proposal(short);
        assert_eq!(summary, "Short proposal");
    }

    // ─── Helper Functions ──────────────────────────────────────────────────

    #[test]
    fn test_determine_primary_agent() {
        assert_eq!(determine_primary_agent(&ParsedIntent {
            raw: "".into(), intent_type: IntentType::Query,
            entities: vec![], confidence: 1.0,
        }), "reasoner");

        assert_eq!(determine_primary_agent(&ParsedIntent {
            raw: "".into(), intent_type: IntentType::Create,
            entities: vec![], confidence: 1.0,
        }), "tool_smith");

        assert_eq!(determine_primary_agent(&ParsedIntent {
            raw: "".into(), intent_type: IntentType::Connect,
            entities: vec![], confidence: 1.0,
        }), "memory_keeper");

        assert_eq!(determine_primary_agent(&ParsedIntent {
            raw: "".into(), intent_type: IntentType::System,
            entities: vec![], confidence: 1.0,
        }), "sentinel");
    }

    #[test]
    fn test_md5_simple_deterministic() {
        let h1 = md5_simple("test data");
        let h2 = md5_simple("test data");
        assert_eq!(h1, h2, "same input should produce same hash");
    }

    #[test]
    fn test_md5_simple_different_inputs() {
        let h1 = md5_simple("input A");
        let h2 = md5_simple("input B");
        assert_ne!(h1, h2, "different inputs should produce different hashes");
    }

    // ─── ArgumentType / GraphNodeType Equality ─────────────────────────────

    #[test]
    fn test_argument_type_equality() {
        assert_eq!(ArgumentType::Position, ArgumentType::Position);
        assert_ne!(ArgumentType::Position, ArgumentType::Challenge);
        assert_ne!(ArgumentType::Challenge, ArgumentType::Rebuttal);
        assert_ne!(ArgumentType::Rebuttal, ArgumentType::Support);
        assert_ne!(ArgumentType::Support, ArgumentType::Concession);
    }

    #[test]
    fn test_graph_node_type_equality() {
        assert_eq!(GraphNodeType::Agent, GraphNodeType::Agent);
        assert_ne!(GraphNodeType::Agent, GraphNodeType::Router);
        assert_ne!(GraphNodeType::Terminal, GraphNodeType::Consensus);
    }
}
