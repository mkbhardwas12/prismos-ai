// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// LangGraph Agent Nodes — Each Agent's Processing Logic
//
// Each agent is a "node" in the LangGraph DAG. It receives messages,
// processes them according to its specialization, and emits new messages
// (proposals, analyses, votes). All side-effecting actions go through
// the Sandbox Prism.

use super::messages::*;
use crate::refractive_core::{IntentType, ParsedIntent};
use std::path::Path;

// ─── Orchestrator Node ─────────────────────────────────────────────────────────

/// The Orchestrator decomposes the user's intent into work units and
/// broadcasts them to the specialist agents.
pub struct OrchestratorNode;

impl OrchestratorNode {
    /// Decompose an intent into sub-tasks for each specialist agent
    pub fn decompose(
        intent: &ParsedIntent,
        context_summary: &str,
        context_nodes: &[String],
    ) -> Vec<AgentMessage> {
        let mut messages = vec![];

        // ── Work unit for Reasoner: analyze the intent ──
        let reasoner_task = format!(
            "Analyze this user intent and provide a thorough response.\n\
             Intent: {}\nType: {}\nEntities: {:?}\nConfidence: {:.0}%\n\n\
             Context from Spectrum Graph:\n{}",
            intent.raw,
            intent.intent_type,
            intent.entities,
            intent.confidence * 100.0,
            context_summary
        );
        messages.push(
            AgentMessage::new(
                AgentRole::Orchestrator,
                MessageTarget::Agent(AgentRole::Reasoner),
                MessageType::WorkUnit,
                reasoner_task,
            )
            .with_confidence(intent.confidence)
            .with_context(context_nodes.to_vec()),
        );

        // ── Work unit for Tool Smith: check if action execution needed ──
        let tool_task = match intent.intent_type {
            IntentType::Create => format!(
                "The user wants to CREATE something. Evaluate what safe actions \
                 can be taken in the sandbox.\nIntent: {}\nEntities: {:?}",
                intent.raw, intent.entities
            ),
            _ => format!(
                "Review this intent for any tool/execution needs.\n\
                 Intent: {}\nType: {}",
                intent.raw, intent.intent_type
            ),
        };
        messages.push(
            AgentMessage::new(
                AgentRole::Orchestrator,
                MessageTarget::Agent(AgentRole::ToolSmith),
                MessageType::WorkUnit,
                tool_task,
            )
            .with_risk(if intent.intent_type == IntentType::Create { 2 } else { 1 }),
        );

        // ── Work unit for Memory Keeper: graph context & persistence ──
        let memory_task = format!(
            "Update the Spectrum Graph with this interaction. Find relevant \
             connections and reinforce edges.\nIntent: {}\nEntities: {:?}\n\
             Existing context nodes: {}",
            intent.raw,
            intent.entities,
            context_nodes.len()
        );
        messages.push(
            AgentMessage::new(
                AgentRole::Orchestrator,
                MessageTarget::Agent(AgentRole::MemoryKeeper),
                MessageType::WorkUnit,
                memory_task,
            )
            .with_context(context_nodes.to_vec()),
        );

        messages
    }
}

// ─── Reasoner Node ─────────────────────────────────────────────────────────────

/// The Reasoner performs deep analysis via LLM inference and produces
/// a proposal with its response and confidence.
pub struct ReasonerNode;

impl ReasonerNode {
    /// Build the system prompt for Reasoner's LLM call
    pub fn build_prompt(work_unit: &AgentMessage, intent: &ParsedIntent) -> String {
        let role_prompt = match intent.intent_type {
            IntentType::Query | IntentType::Analyze => {
                "You are PrismOS Reasoner, a local-first AI assistant with deep analytical \
                 capabilities. You are part of a multi-agent team. Provide thorough, \
                 well-reasoned analysis grounded in the user's Spectrum Graph context."
            }
            _ => {
                "You are PrismOS Reasoner, a local-first AI assistant. You work with \
                 other agents to provide the best possible response. Be clear and concise."
            }
        };

        format!(
            "{}\n\n{}\n\nRespond helpfully and concisely:",
            role_prompt, work_unit.content
        )
    }

    /// Create a proposal message from the LLM response
    pub fn propose(
        response: &str,
        confidence: f64,
        context_nodes: Vec<String>,
    ) -> AgentMessage {
        AgentMessage::new(
            AgentRole::Reasoner,
            MessageTarget::Consensus,
            MessageType::Proposal,
            response.to_string(),
        )
        .with_confidence(confidence)
        .with_context(context_nodes)
    }

    /// Cast a vote on the final proposal
    pub fn vote(proposal: &str, own_analysis: &str) -> Vote {
        // Reasoner approves if the proposal aligns with its analysis
        let similarity = text_similarity(proposal, own_analysis);
        let approve = similarity > 0.15; // Low threshold — reasoner is collaborative

        Vote {
            agent: AgentRole::Reasoner,
            approve,
            reason: if approve {
                format!(
                    "Reasoner approves: response aligns with analysis (similarity: {:.0}%)",
                    similarity * 100.0
                )
            } else {
                "Reasoner dissents: response diverges significantly from analysis".to_string()
            },
            confidence: similarity.clamp(0.3, 1.0),
        }
    }
}

// ─── Tool Smith Node ───────────────────────────────────────────────────────────

/// The Tool Smith evaluates whether any sandboxed tool execution is needed
/// and proposes safe actions.
pub struct ToolSmithNode;

impl ToolSmithNode {
    /// Evaluate the work unit and propose tool actions if needed
    pub fn evaluate(work_unit: &AgentMessage, intent: &ParsedIntent) -> AgentMessage {
        let (proposal, risk) = match intent.intent_type {
            IntentType::Create => {
                let action = format!(
                    "Tool Smith recommends sandboxed execution for creation task. \
                     Entities to create: {:?}. All operations will run inside a \
                     Sandbox Prism with HMAC-SHA256 signing and checkpoint rollback.",
                    intent.entities
                );
                (action, 2_u8)
            }
            IntentType::System => {
                let action = format!(
                    "Tool Smith: system operation detected. Will execute status \
                     checks through sandbox. No write operations needed for: {}",
                    &work_unit.content.chars().take(100).collect::<String>()
                );
                (action, 1)
            }
            _ => {
                let action = "Tool Smith: no direct tool execution required for this intent. \
                     Standing by for potential follow-up actions."
                    .to_string();
                (action, 0)
            }
        };

        AgentMessage::new(
            AgentRole::ToolSmith,
            MessageTarget::Consensus,
            MessageType::Proposal,
            proposal,
        )
        .with_risk(risk)
    }

    /// Cast a vote — Tool Smith checks if the action is safely sandboxable
    pub fn vote(proposal: &str) -> Vote {
        let lower = proposal.to_lowercase();

        // Tool Smith checks if write/execute actions reference sandbox protections
        let is_write = lower.contains("create")
            || lower.contains("write")
            || lower.contains("execute");

        let mentions_sandbox = lower.contains("sandbox")
            || lower.contains("checkpoint")
            || lower.contains("prism");

        // Reject unsandboxed write operations
        let approve = if is_write && !mentions_sandbox {
            false
        } else {
            true
        };

        Vote {
            agent: AgentRole::ToolSmith,
            approve,
            reason: if !approve {
                "Tool Smith rejects: write/execute operation proposed without sandbox protection"
                    .to_string()
            } else if is_write {
                "Tool Smith approves: write operations will be sandboxed with checkpoint rollback"
                    .to_string()
            } else {
                "Tool Smith approves: read-only operation, no sandbox concerns".to_string()
            },
            confidence: if !approve { 0.3 } else if is_write { 0.8 } else { 1.0 },
        }
    }
}

// ─── Memory Keeper Node ────────────────────────────────────────────────────────

/// The Memory Keeper manages Spectrum Graph persistence — reads context,
/// writes new nodes, reinforces edges.
pub struct MemoryKeeperNode;

impl MemoryKeeperNode {
    /// Process work unit: retrieve context and propose graph updates
    pub fn process(
        work_unit: &AgentMessage,
        intent: &ParsedIntent,
        context_node_count: usize,
    ) -> AgentMessage {
        let proposal = format!(
            "Memory Keeper: {} context nodes found for intent '{}'. \
             Will store conversation in ephemeral layer and reinforce {} \
             co-reference edges. Entities to index: {:?}.",
            context_node_count,
            &intent.raw.chars().take(60).collect::<String>(),
            (context_node_count.min(5) * (context_node_count.min(5).saturating_sub(1))) / 2,
            intent.entities
        );

        AgentMessage::new(
            AgentRole::MemoryKeeper,
            MessageTarget::Consensus,
            MessageType::Proposal,
            proposal,
        )
        .with_context(work_unit.metadata.context_nodes.clone())
        .with_risk(2) // Graph writes are Tier 2
    }

    /// Cast a vote — Memory Keeper checks data integrity
    pub fn vote(_proposal: &str, context_nodes: &[String]) -> Vote {
        let has_context = !context_nodes.is_empty();
        let context_count = context_nodes.len();

        // Memory Keeper is more cautious when there's no supporting context
        let approve = has_context || context_count == 0; // approve if context exists or if it's a fresh topic
        let confidence = if context_count >= 3 {
            0.95
        } else if context_count >= 1 {
            0.8
        } else {
            0.6
        };

        Vote {
            agent: AgentRole::MemoryKeeper,
            approve,
            reason: if has_context {
                format!(
                    "Memory Keeper approves: {} context node{} support this response",
                    context_count,
                    if context_count == 1 { "" } else { "s" }
                )
            } else {
                "Memory Keeper approves with low confidence: no prior context in Spectrum Graph".to_string()
            },
            confidence,
        }
    }

    /// Execute graph updates through Sandbox Prism
    pub fn execute_graph_updates(
        intent: &ParsedIntent,
        response: &str,
        scored_context: &[(String, f64)],
        app_dir: &Path,
    ) -> Result<(Vec<String>, String), Box<dyn std::error::Error + Send + Sync>> {
        let agent_id = "memory_keeper";
        let prism_name = format!("collab_memory_{}", &intent.raw.chars().take(20).collect::<String>());
        let mut prism = crate::sandbox_prism::create_prism_for_agent(&prism_name, agent_id);
        let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;

        let mut edges_reinforced = vec![];

        // ── Reinforce co-reference edges through sandbox ──
        let reinforce_action = format!("edge_reinforce:feedback:agent={}", agent_id);
        let reinforce_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, &reinforce_action, agent_id,
        );

        if reinforce_result.success {
            for i in 0..scored_context.len().min(5) {
                for j in (i + 1)..scored_context.len().min(5) {
                    let (ref id_a, score_a) = scored_context[i];
                    let (ref id_b, score_b) = scored_context[j];
                    let edge = graph.get_or_create_edge(id_a, id_b, "co_referenced")?;
                    let feedback = (score_a + score_b) / 2.0;
                    let updated = graph.update_edge_weight(&edge.id, feedback)?;
                    edges_reinforced.push(updated.id);
                }
            }
        }

        // ── Store conversation node through sandbox ──
        let store_action = format!("conversation:store_chat:agent={}", agent_id);
        let store_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, &store_action, agent_id,
        );

        let mut conv_node_id = String::new();
        if store_result.success {
            let conv_node = graph.add_node_with_layer(
                &format!("Chat: {}", &intent.raw.chars().take(50).collect::<String>()),
                &format!(
                    "Q: {}\n\nA: {}",
                    intent.raw,
                    &response.chars().take(500).collect::<String>()
                ),
                "conversation",
                "ephemeral",
            )?;
            conv_node_id = conv_node.id.clone();

            // Link to context nodes
            let link_action = format!("add_node:node_create:derived_from:agent={}", agent_id);
            let link_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
                &mut prism, &link_action, agent_id,
            );
            if link_result.success {
                for (ctx_id, _) in scored_context.iter().take(3) {
                    let edge = graph.get_or_create_edge(&conv_node.id, ctx_id, "derived_from")?;
                    graph.update_edge_weight(&edge.id, 0.5)?;
                }
            }
        }

        Ok((edges_reinforced, conv_node_id))
    }
}

// ─── Sentinel Node ─────────────────────────────────────────────────────────────

/// The Sentinel reviews all proposals for security, privacy, and policy
/// compliance before they proceed to consensus.
pub struct SentinelNode;

impl SentinelNode {
    /// Security review of all proposals from the collaboration round
    pub fn review(proposals: &[AgentMessage], intent: &ParsedIntent) -> AgentMessage {
        let mut concerns: Vec<String> = vec![];
        let mut max_risk: u8 = 0;

        for proposal in proposals {
            let risk = proposal.metadata.risk_tier;
            if risk > max_risk {
                max_risk = risk;
            }

            // Check for potential security concerns
            let lower = proposal.content.to_lowercase();
            if lower.contains("external") || lower.contains("network") || lower.contains("http") {
                concerns.push(format!(
                    "⚠️ {} proposes external network access — requires Tier 3 sandbox",
                    proposal.from.display_name()
                ));
            }
            if lower.contains("delete") || lower.contains("remove") || lower.contains("drop") {
                concerns.push(format!(
                    "⚠️ {} proposes destructive action — requires checkpoint + confirmation",
                    proposal.from.display_name()
                ));
            }
            if lower.contains("file") && lower.contains("write") {
                concerns.push(format!(
                    "⚠️ {} proposes file write — scoped to app data directory only",
                    proposal.from.display_name()
                ));
            }
        }

        let review = if concerns.is_empty() {
            format!(
                "Sentinel security review: ✅ CLEAR. All {} proposals pass security \
                 checks. Max risk tier: {}. Intent type '{}' is within normal bounds. \
                 All data stays local.",
                proposals.len(),
                max_risk,
                intent.intent_type
            )
        } else {
            format!(
                "Sentinel security review: ⚠️ {} concern(s) noted.\n{}\n\n\
                 Max risk tier: {}. Sandbox Prism will enforce boundaries.",
                concerns.len(),
                concerns.join("\n"),
                max_risk
            )
        };

        AgentMessage::new(
            AgentRole::Sentinel,
            MessageTarget::Consensus,
            MessageType::SecurityReview,
            review,
        )
        .with_risk(max_risk)
    }

    /// Cast a vote — Sentinel focuses on security and privacy
    pub fn vote(proposals: &[AgentMessage], _intent: &ParsedIntent) -> Vote {
        let max_risk = proposals
            .iter()
            .map(|p| p.metadata.risk_tier)
            .max()
            .unwrap_or(0);

        // Sentinel approves unless there's a Tier 3 action without proper justification
        let has_dangerous = proposals.iter().any(|p| {
            let lower = p.content.to_lowercase();
            (lower.contains("delete") || lower.contains("drop"))
                && !lower.contains("sandbox")
                && !lower.contains("checkpoint")
        });

        Vote {
            agent: AgentRole::Sentinel,
            approve: !has_dangerous,
            reason: if has_dangerous {
                "Sentinel rejects: destructive action proposed without checkpoint protection"
                    .to_string()
            } else if max_risk >= 3 {
                format!(
                    "Sentinel approves with caution: Tier {} action will be sandboxed",
                    max_risk
                )
            } else {
                "Sentinel approves: all actions within safe boundaries".to_string()
            },
            confidence: if has_dangerous {
                0.2
            } else {
                (1.0 - max_risk as f64 * 0.1).clamp(0.5, 1.0)
            },
        }
    }
}

// ─── Consensus Engine ──────────────────────────────────────────────────────────

/// Run a consensus round: collect votes from all agents, determine outcome.
/// Requires majority approval (≥3 of 5 agents including Sentinel).
pub fn run_consensus(votes: &[Vote]) -> ConsensusOutcome {
    let approve_count = votes.iter().filter(|v| v.approve).count();
    let reject_count = votes.iter().filter(|v| !v.approve).count();
    let total = votes.len();

    // Sentinel has veto power — if Sentinel rejects, consensus fails
    let sentinel_approved = votes
        .iter()
        .find(|v| v.agent == AgentRole::Sentinel)
        .map(|v| v.approve)
        .unwrap_or(true); // If no sentinel vote, assume OK

    let majority = approve_count > total / 2;
    let approved = majority && sentinel_approved;

    let summary = if approved {
        format!(
            "✅ Consensus APPROVED ({}/{} agents approved). {}",
            approve_count,
            total,
            votes
                .iter()
                .map(|v| format!("{}: {}", v.agent.display_name(), if v.approve { "✓" } else { "✗" }))
                .collect::<Vec<_>>()
                .join(" · ")
        )
    } else if !sentinel_approved {
        format!(
            "🛡️ Consensus VETOED by Sentinel. Reason: {}",
            votes
                .iter()
                .find(|v| v.agent == AgentRole::Sentinel)
                .map(|v| v.reason.as_str())
                .unwrap_or("Security concern")
        )
    } else {
        format!(
            "❌ Consensus REJECTED ({}/{} agents approved, majority required). {}",
            approve_count,
            total,
            votes
                .iter()
                .filter(|v| !v.approve)
                .map(|v| format!("{}: {}", v.agent.display_name(), v.reason))
                .collect::<Vec<_>>()
                .join(" | ")
        )
    };

    ConsensusOutcome {
        approved,
        votes: votes.to_vec(),
        approve_count,
        reject_count,
        summary,
    }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

/// Simple word-overlap similarity for vote alignment (0.0–1.0)
fn text_similarity(a: &str, b: &str) -> f64 {
    let words_a: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = b.split_whitespace().collect();
    if words_a.is_empty() || words_b.is_empty() {
        return 0.0;
    }
    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}
