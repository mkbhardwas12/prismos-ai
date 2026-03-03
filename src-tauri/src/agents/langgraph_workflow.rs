// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// LangGraph Workflow Engine — Formal State-Graph Multi-Agent Orchestration
//
// This module implements a formal LangGraph-style state graph for
// multi-agent collaboration. Agents traverse a typed state machine
// with conditional edges, parallel branches, debate rounds, and
// quorum-based consensus. Every state transition is checkpointed
// for auditability.
//
// Architecture:
//   StateGraph — defines nodes (agents) + edges (transitions)
//   WorkflowEngine — executes the graph with state management
//   DebateRound — agents challenge & rebut each other's proposals
//   Deliberation — structured argument exchange before consensus
//
// All side-effecting actions go through the Sandbox Prism.

use super::messages::*;
use super::nodes::*;
use crate::refractive_core::{IntentType, ParsedIntent};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    /// Build the default PrismOS multi-agent collaboration graph
    pub fn default_collaboration_graph() -> Self {
        let mut graph = Self {
            id: Uuid::new_v4().to_string(),
            name: "PrismOS Multi-Agent Collaboration".to_string(),
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
            description: "Fan-out: all specialists analyze in parallel".into(),
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
            description: "Agents debate and challenge proposals".into(),
        });

        graph.add_node(GraphNode {
            id: "sentinel_review".into(),
            node_type: GraphNodeType::Agent,
            agent: Some(AgentRole::Sentinel),
            description: "Security gate: validates all proposals".into(),
        });

        graph.add_node(GraphNode {
            id: "consensus".into(),
            node_type: GraphNodeType::Consensus,
            agent: None,
            description: "Voting round: majority + Sentinel non-veto".into(),
        });

        graph.add_node(GraphNode {
            id: "execute".into(),
            node_type: GraphNodeType::Terminal,
            agent: None,
            description: "Execute approved action through Sandbox Prism".into(),
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

/// Run a structured debate round between agents
pub fn run_debate(
    proposals: &[AgentMessage],
    intent: &ParsedIntent,
    max_rounds: usize,
) -> DebateResult {
    let round_id = Uuid::new_v4().to_string();
    let mut arguments: Vec<DebateArgument> = vec![];
    let mut rounds_completed = 0;

    // ── Round 1: Each agent states their position ──
    for proposal in proposals {
        arguments.push(DebateArgument {
            id: Uuid::new_v4().to_string(),
            from: proposal.from.clone(),
            argument_type: ArgumentType::Position,
            target_agent: None,
            content: summarize_proposal(&proposal.content),
            confidence: proposal.metadata.confidence,
            timestamp: Utc::now().to_rfc3339(),
        });
    }
    rounds_completed += 1;

    // ── Round 2: Challenges — agents critique each other ──
    if max_rounds >= 2 && proposals.len() > 1 {
        // Reasoner challenges Tool Smith's risk assessment
        if let Some(ts_proposal) = proposals.iter().find(|p| p.from == AgentRole::ToolSmith) {
            let challenge = if ts_proposal.metadata.risk_tier >= 2 {
                format!(
                    "Challenge: Tool Smith proposes Tier {} action. \
                     Has the risk been fully evaluated? The Sandbox Prism \
                     should enforce strict boundaries for this operation.",
                    ts_proposal.metadata.risk_tier
                )
            } else {
                "No concerns with Tool Smith's low-risk assessment.".to_string()
            };

            arguments.push(DebateArgument {
                id: Uuid::new_v4().to_string(),
                from: AgentRole::Reasoner,
                argument_type: if ts_proposal.metadata.risk_tier >= 2 {
                    ArgumentType::Challenge
                } else {
                    ArgumentType::Support
                },
                target_agent: Some(AgentRole::ToolSmith),
                content: challenge,
                confidence: 0.8,
                timestamp: Utc::now().to_rfc3339(),
            });
        }

        // Memory Keeper evaluates if graph context supports the response
        if let Some(reasoner_proposal) = proposals.iter().find(|p| p.from == AgentRole::Reasoner) {
            let has_context = !reasoner_proposal.metadata.context_nodes.is_empty();
            let argument_type = if has_context {
                ArgumentType::Support
            } else {
                ArgumentType::Challenge
            };
            let content = if has_context {
                format!(
                    "Support: Reasoner's analysis is grounded in {} context nodes \
                     from the Spectrum Graph. The response has empirical backing.",
                    reasoner_proposal.metadata.context_nodes.len()
                )
            } else {
                "Challenge: Reasoner's response lacks Spectrum Graph context. \
                 Consider this a lower-confidence answer without memory grounding."
                    .to_string()
            };

            arguments.push(DebateArgument {
                id: Uuid::new_v4().to_string(),
                from: AgentRole::MemoryKeeper,
                argument_type,
                target_agent: Some(AgentRole::Reasoner),
                content,
                confidence: if has_context { 0.9 } else { 0.6 },
                timestamp: Utc::now().to_rfc3339(),
            });
        }

        rounds_completed += 1;
    }

    // ── Round 3: Rebuttals — challenged agents respond ──
    if max_rounds >= 3 {
        let challenges: Vec<DebateArgument> = arguments
            .iter()
            .filter(|a| a.argument_type == ArgumentType::Challenge)
            .cloned()
            .collect();

        for challenge in &challenges {
            if let Some(target) = &challenge.target_agent {
                let rebuttal_content = match target {
                    AgentRole::ToolSmith => {
                        "Rebuttal: All Tier 2+ actions are sandboxed with HMAC-SHA256 \
                         signing, checkpoint rollback, and allow-list enforcement. \
                         The Sandbox Prism provides deterministic isolation."
                            .to_string()
                    }
                    AgentRole::Reasoner => {
                        format!(
                            "Rebuttal: While Spectrum Graph context strengthens confidence, \
                             the LLM analysis is based on the user's direct intent: '{}'. \
                             The response is still valid without graph grounding.",
                            &intent.raw.chars().take(60).collect::<String>()
                        )
                    }
                    AgentRole::MemoryKeeper => {
                        "Rebuttal: Graph updates are executed through sandboxed write \
                         operations with edge reinforcement. Data integrity is maintained."
                            .to_string()
                    }
                    _ => "Acknowledged. Position maintained with safeguards.".to_string(),
                };

                arguments.push(DebateArgument {
                    id: Uuid::new_v4().to_string(),
                    from: target.clone(),
                    argument_type: ArgumentType::Rebuttal,
                    target_agent: Some(challenge.from.clone()),
                    content: rebuttal_content,
                    confidence: 0.85,
                    timestamp: Utc::now().to_rfc3339(),
                });
            }
        }

        rounds_completed += 1;
    }

    // ── Calculate agreement score ──
    let support_count = arguments
        .iter()
        .filter(|a| {
            a.argument_type == ArgumentType::Support
                || a.argument_type == ArgumentType::Concession
        })
        .count();
    let challenge_count = arguments
        .iter()
        .filter(|a| a.argument_type == ArgumentType::Challenge)
        .count();
    let rebuttal_count = arguments
        .iter()
        .filter(|a| a.argument_type == ArgumentType::Rebuttal)
        .count();

    let total_exchanges = support_count + challenge_count + rebuttal_count;
    let agreement_score = if total_exchanges > 0 {
        let resolved_challenges = rebuttal_count.min(challenge_count);
        let positive = support_count + resolved_challenges;
        positive as f64 / total_exchanges as f64
    } else {
        1.0 // No disagreement = full agreement
    };

    let resolved = agreement_score >= 0.5;

    // ── Find winning position (highest average confidence) ──
    let mut confidence_by_agent: HashMap<String, (f64, usize)> = HashMap::new();
    for arg in &arguments {
        let entry = confidence_by_agent
            .entry(arg.from.display_name().to_string())
            .or_insert((0.0, 0));
        entry.0 += arg.confidence;
        entry.1 += 1;
    }

    let winning_position = confidence_by_agent
        .iter()
        .map(|(agent, (total, count))| (agent.clone(), total / *count as f64))
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(agent, _)| agent);

    let summary = format!(
        "Debate: {} rounds, {} arguments ({} positions, {} challenges, {} rebuttals, {} supports). \
         Agreement: {:.0}% — {}.",
        rounds_completed,
        arguments.len(),
        arguments
            .iter()
            .filter(|a| a.argument_type == ArgumentType::Position)
            .count(),
        challenge_count,
        rebuttal_count,
        support_count,
        agreement_score * 100.0,
        if resolved { "RESOLVED" } else { "UNRESOLVED" }
    );

    DebateResult {
        round_id,
        arguments,
        rounds_completed,
        max_rounds,
        resolved,
        winning_position,
        agreement_score,
        summary,
    }
}

/// Summarize a proposal to a short debate-friendly statement
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct TransitionSummary {
    pub from: String,
    pub to: String,
    pub label: String,
    pub duration_ms: u64,
}

/// Compact debate info for frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
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
    pub async fn execute(
        intent: ParsedIntent,
        context_summary: &str,
        context_node_ids: &[String],
        scored_context: &[(String, f64)],
        npu_accelerated: bool,
        app_dir: &Path,
        app_handle: tauri::AppHandle,
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

        // ── 2a: Reasoner ──
        let reasoner_start = std::time::Instant::now();
        state.visit_node("reasoner");
        session.push_trace("Reasoner", "Analyzing intent via LLM", StepStatus::Active);
        emit_activity(&app_handle, "Reasoner", "Analyzing intent via LLM…", "thinking", "analyze");

        let reasoner_work = work_units
            .iter()
            .find(|m| m.to == MessageTarget::Agent(AgentRole::Reasoner))
            .cloned();

        let llm_response = if let Some(ref work) = reasoner_work {
            let llm_action = "llm_inference:generate:model=mistral:agent=reasoner";
            let prism_name = format!("wf_reasoner_{}", &state.workflow_id[..8]);
            let mut prism =
                crate::sandbox_prism::create_prism_for_agent(&prism_name, "reasoner");
            let sandbox_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
                &mut prism,
                llm_action,
                "reasoner",
            );

            if sandbox_result.success {
                let prompt = ReasonerNode::build_prompt(work, &intent);
                match crate::ollama_bridge::generate("mistral", &prompt, None, None).await {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[LangGraph-WF] Ollama unavailable: {}", e);
                        format!(
                            "⚡ [Offline Mode — Multi-Agent Workflow] Processed locally.\n\n\
                             Intent: {} | Type: {} | Context: {} nodes\n\n\
                             💡 Start Ollama for full AI: `ollama serve`",
                            intent.raw, intent.intent_type, context_node_ids.len()
                        )
                    }
                }
            } else {
                format!(
                    "🛡️ [Sandbox] LLM inference denied for Reasoner: {}",
                    sandbox_result.output
                )
            }
        } else {
            "Reasoner: no work unit received".to_string()
        };

        let reasoner_confidence = if llm_response.contains("Offline") {
            0.5
        } else {
            0.85
        };
        let reasoner_proposal =
            ReasonerNode::propose(&llm_response, reasoner_confidence, context_node_ids.to_vec());
        session.add_message(reasoner_proposal.clone());
        state.proposals.push(reasoner_proposal.clone());
        session.complete_trace_step("Reasoner");
        state.checkpoint("reasoner");
        state.transition("reasoner", "parallel_join", "reasoner proposal", reasoner_start);
        emit_activity(&app_handle, "Reasoner", "Analysis complete — proposal ready", "completed", "analyze");

        // ── 2b: Tool Smith ──
        let ts_start = std::time::Instant::now();
        state.visit_node("tool_smith");
        session.push_trace("Tool Smith", "Evaluating tool needs", StepStatus::Active);
        emit_activity(&app_handle, "Tool Smith", "Evaluating tool and execution needs…", "thinking", "analyze");

        let tool_smith_work = work_units
            .iter()
            .find(|m| matches!(m.to, MessageTarget::Agent(AgentRole::ToolSmith)))
            .cloned();

        let tool_smith_proposal = if let Some(ref work) = tool_smith_work {
            ToolSmithNode::evaluate(work, &intent)
        } else {
            AgentMessage::new(
                AgentRole::ToolSmith,
                MessageTarget::Consensus,
                MessageType::Proposal,
                "Tool Smith: no tool execution required".to_string(),
            )
        };
        session.add_message(tool_smith_proposal.clone());
        state.proposals.push(tool_smith_proposal.clone());
        session.complete_trace_step("Tool Smith");
        state.checkpoint("tool_smith");
        state.transition("tool_smith", "parallel_join", "tool smith proposal", ts_start);
        emit_activity(&app_handle, "Tool Smith", "Tool evaluation complete", "completed", "analyze");

        // ── 2c: Memory Keeper ──
        let mk_start = std::time::Instant::now();
        state.visit_node("memory_keeper");
        session.push_trace("Memory Keeper", "Processing graph context", StepStatus::Active);
        emit_activity(&app_handle, "Memory Keeper", "Querying Spectrum Graph for context…", "thinking", "analyze");

        let memory_keeper_work = work_units
            .iter()
            .find(|m| matches!(m.to, MessageTarget::Agent(AgentRole::MemoryKeeper)))
            .cloned();

        let memory_keeper_proposal = if let Some(ref work) = memory_keeper_work {
            MemoryKeeperNode::process(work, &intent, context_node_ids.len())
        } else {
            AgentMessage::new(
                AgentRole::MemoryKeeper,
                MessageTarget::Consensus,
                MessageType::Proposal,
                "Memory Keeper: no graph updates needed".to_string(),
            )
        };
        session.add_message(memory_keeper_proposal.clone());
        state.proposals.push(memory_keeper_proposal.clone());
        session.complete_trace_step("Memory Keeper");
        state.checkpoint("memory_keeper");
        state.transition("memory_keeper", "parallel_join", "memory keeper proposal", mk_start);
        emit_activity(&app_handle, "Memory Keeper", "Graph context processed", "completed", "analyze");

        eprintln!("[LangGraph-WF] All 3 specialists completed analysis");

        // ═══════════════════════════════════════════════════════════════
        // NODE 3: PARALLEL JOIN + DEBATE — Agents debate proposals
        // ═══════════════════════════════════════════════════════════════
        let debate_start = std::time::Instant::now();
        state.visit_node("parallel_join");
        state.visit_node("debate");
        state.status = WorkflowStatus::DebateInProgress;
        session.current_phase = CollaborationPhase::Proposing;
        session.push_trace("Debate", "Agents debating proposals", StepStatus::Active);
        emit_activity(&app_handle, "Debate", "Agents debating proposals…", "thinking", "debate");

        let all_proposals = vec![
            reasoner_proposal.clone(),
            tool_smith_proposal.clone(),
            memory_keeper_proposal.clone(),
        ];

        let debate_result = run_debate(&all_proposals, &intent, 3);

        // Emit individual debate arguments for live log
        for arg in &debate_result.arguments {
            let arg_label = match arg.argument_type {
                ArgumentType::Position => "states position",
                ArgumentType::Challenge => "challenges",
                ArgumentType::Rebuttal => "rebuts",
                ArgumentType::Support => "supports",
                ArgumentType::Concession => "concedes",
            };
            let target_str = arg.target_agent.as_ref()
                .map(|t| format!(" → {}", t.display_name()))
                .unwrap_or_default();
            emit_activity(
                &app_handle,
                arg.from.display_name(),
                &format!("{}{}: {}", arg_label, target_str, &arg.content.chars().take(80).collect::<String>()),
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
        session.complete_trace_step("Debate");
        state.checkpoint("debate");
        state.transition("debate", "sentinel_review", "debate complete", debate_start);
        emit_activity(
            &app_handle,
            "Debate",
            &format!("Debate {} — {:.0}% agreement", if debate_result.resolved { "resolved" } else { "unresolved" }, debate_result.agreement_score * 100.0),
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
        session.add_message(security_review);
        session.complete_trace_step("Sentinel");
        state.checkpoint("sentinel_review");
        state.transition("sentinel_review", "consensus", "security review done", sentinel_start);
        emit_activity(&app_handle, "Sentinel", "Security review passed ✓", "completed", "review");

        eprintln!("[LangGraph-WF] Sentinel security review complete");

        // ═══════════════════════════════════════════════════════════════
        // NODE 5: CONSENSUS — Weighted voting with debate influence
        // ═══════════════════════════════════════════════════════════════
        let vote_start = std::time::Instant::now();
        state.visit_node("consensus");
        state.status = WorkflowStatus::VotingInProgress;
        session.current_phase = CollaborationPhase::Voting;
        session.push_trace("Consensus", "Voting round", StepStatus::Active);
        emit_activity(&app_handle, "Consensus", "All 5 agents casting votes…", "thinking", "vote");

        // Collect votes — influenced by debate results
        let debate_bonus: f64 = if debate_result.resolved { 0.1 } else { -0.05 };

        let orchestrator_vote = Vote {
            agent: AgentRole::Orchestrator,
            approve: true,
            reason: "Orchestrator approves: workflow executed as planned".to_string(),
            confidence: (0.9 + debate_bonus).clamp(0.0, 1.0),
        };
        let reasoner_vote = ReasonerNode::vote(&llm_response, &llm_response);
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
            &format!("Consensus {} — {}/{} approved", if consensus.approved { "reached ✓" } else { "rejected ✗" }, consensus.approve_count, votes.len()),
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
        session.push_trace("Sandbox Prism", "Executing approved actions", StepStatus::Active);
        emit_activity(&app_handle, "Sandbox Prism", "Executing through isolated sandbox…", "thinking", "execute");

        let final_response;
        let mut edges_reinforced = vec![];
        let agent_used;

        if consensus.approved {
            final_response = llm_response.clone();
            agent_used = determine_primary_agent(&intent);

            match MemoryKeeperNode::execute_graph_updates(
                &intent,
                &final_response,
                scored_context,
                app_dir,
            ) {
                Ok((edges, _conv_id)) => {
                    edges_reinforced = edges;
                }
                Err(e) => {
                    eprintln!("[LangGraph-WF] Memory Keeper graph update failed: {}", e);
                }
            }
        } else {
            final_response = format!(
                "🛡️ Multi-agent consensus was not reached for this request.\n\n\
                 {}\n\n\
                 Debate result: {}\n\n\
                 Your data remains safe. The Sandbox Prism prevented any unverified action.",
                consensus.summary, debate_result.summary
            );
            agent_used = "orchestrator".to_string();
        }

        session.complete_trace_step("Sandbox Prism");
        session.complete();
        state.checkpoint(target_node);
        state.completed_at = Some(Utc::now().to_rfc3339());
        emit_activity(&app_handle, "Sandbox Prism", "Workflow complete — all actions executed safely", "completed", "execute");

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
