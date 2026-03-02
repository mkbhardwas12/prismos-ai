// Patent Pending — US 63/993,589 (Feb 28, 2026)
// LangGraph Execution Engine — Multi-Agent Collaboration Workflow
//
// This is the core LangGraph DAG executor. It orchestrates the full
// multi-agent collaboration pipeline:
//
//   1. ORCHESTRATE  — Decompose intent into work units
//   2. ANALYZE      — Reasoner + Tool Smith + Memory Keeper process in parallel
//   3. REVIEW       — Sentinel reviews all proposals for security
//   4. VOTE         — All agents vote (majority + Sentinel non-veto required)
//   5. EXECUTE      — Winning proposal runs through Sandbox Prism
//   6. PERSIST      — Memory Keeper updates Spectrum Graph
//
// The entire workflow is synchronous per-intent and returns a complete
// CollaborationSession with full audit trail.

use super::messages::*;
use super::nodes::*;
use crate::refractive_core::{IntentType, ParsedIntent, RefractiveResult};
use std::path::Path;
use std::time::Instant;

// ─── LangGraph DAG Executor ────────────────────────────────────────────────────

/// Execute the full LangGraph multi-agent collaboration pipeline.
///
/// Returns (RefractiveResult, CollaborationSession) — the final response
/// and the complete collaboration audit trail.
pub async fn execute_collaboration(
    intent: ParsedIntent,
    context_summary: &str,
    context_node_ids: &[String],
    scored_context: &[(String, f64)],
    npu_accelerated: bool,
    app_dir: &Path,
) -> Result<
    (RefractiveResult, CollaborationSession),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let start = Instant::now();
    let mut session = CollaborationSession::new(&intent.raw);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: ORCHESTRATE — Decompose intent into work units
    // ═══════════════════════════════════════════════════════════════════════
    session.current_phase = CollaborationPhase::Orchestrating;
    session.push_trace("Orchestrator", "Decomposing intent", StepStatus::Active);

    let work_units = OrchestratorNode::decompose(&intent, context_summary, context_node_ids);
    for unit in &work_units {
        session.add_message(unit.clone());
    }

    session.complete_trace_step("Orchestrator");
    eprintln!(
        "[LangGraph] Phase 1: Orchestrator decomposed intent into {} work units",
        work_units.len()
    );

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: ANALYZE — Specialists process their work units (in parallel)
    // ═══════════════════════════════════════════════════════════════════════
    session.current_phase = CollaborationPhase::Analyzing;

    // ── 2a: Reasoner analyzes via LLM ──
    session.push_trace("Reasoner", "Analyzing intent via LLM", StepStatus::Active);

    let reasoner_work = work_units
        .iter()
        .find(|m| m.to == MessageTarget::Agent(AgentRole::Reasoner))
        .cloned();

    let llm_response = if let Some(ref work) = reasoner_work {
        // Sandbox gate: validate LLM inference for reasoner
        let llm_action = "llm_inference:generate:model=mistral:agent=reasoner";
        let prism_name = format!("collab_reasoner_{}", &session.session_id[..8]);
        let mut prism = crate::sandbox_prism::create_prism_for_agent(&prism_name, "reasoner");
        let sandbox_result = crate::sandbox_prism::execute_in_sandbox_for_agent(
            &mut prism, llm_action, "reasoner",
        );

        if sandbox_result.success {
            let prompt = ReasonerNode::build_prompt(work, &intent);
            match crate::ollama_bridge::generate("mistral", &prompt).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[LangGraph] Ollama unavailable: {}", e);
                    format!(
                        "⚡ [Offline Mode — Multi-Agent] Processed locally through Spectrum Graph.\n\n\
                         Intent: {} | Type: {} | Context nodes: {}\n\n\
                         💡 Start Ollama for full AI responses: `ollama serve`",
                        intent.raw, intent.intent_type, context_node_ids.len()
                    )
                }
            }
        } else {
            format!("🛡️ [Sandbox] LLM inference denied for Reasoner: {}", sandbox_result.output)
        }
    } else {
        "Reasoner: no work unit received".to_string()
    };

    let reasoner_confidence = if llm_response.contains("Offline") { 0.5 } else { 0.85 };
    let reasoner_proposal =
        ReasonerNode::propose(&llm_response, reasoner_confidence, context_node_ids.to_vec());
    session.add_message(reasoner_proposal.clone());
    session.complete_trace_step("Reasoner");

    // ── 2b: Tool Smith evaluates ──
    session.push_trace("Tool Smith", "Evaluating tool needs", StepStatus::Active);

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
    session.complete_trace_step("Tool Smith");

    // ── 2c: Memory Keeper processes ──
    session.push_trace("Memory Keeper", "Processing graph context", StepStatus::Active);

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
    session.complete_trace_step("Memory Keeper");

    eprintln!(
        "[LangGraph] Phase 2: All 3 specialists completed analysis"
    );

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: SECURITY REVIEW — Sentinel validates all proposals
    // ═══════════════════════════════════════════════════════════════════════
    session.current_phase = CollaborationPhase::SecurityReview;
    session.push_trace("Sentinel", "Security review", StepStatus::Active);

    let all_proposals = vec![
        reasoner_proposal.clone(),
        tool_smith_proposal.clone(),
        memory_keeper_proposal.clone(),
    ];
    let security_review = SentinelNode::review(&all_proposals, &intent);
    session.add_message(security_review);
    session.complete_trace_step("Sentinel");

    eprintln!("[LangGraph] Phase 3: Sentinel security review complete");

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: VOTING — All agents vote on the proposals
    // ═══════════════════════════════════════════════════════════════════════
    session.current_phase = CollaborationPhase::Voting;
    session.push_trace("Consensus", "Voting round", StepStatus::Active);

    // Collect votes from all 5 agents
    let orchestrator_vote = Vote {
        agent: AgentRole::Orchestrator,
        approve: true, // Orchestrator generally approves its own decomposition
        reason: "Orchestrator approves: workflow executed as planned".to_string(),
        confidence: 0.9,
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
        // Also record votes as messages for the audit trail
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
    session.complete_trace_step("Consensus");

    eprintln!(
        "[LangGraph] Phase 4: Consensus — approved={}, votes={}/{}",
        consensus.approved, consensus.approve_count, votes.len()
    );

    // Record consensus result as a message
    session.add_message(AgentMessage::new(
        AgentRole::Orchestrator,
        MessageTarget::Broadcast,
        MessageType::ConsensusResult,
        consensus.summary.clone(),
    ));

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: EXECUTE — Run through Sandbox Prism if approved
    // ═══════════════════════════════════════════════════════════════════════
    session.current_phase = CollaborationPhase::Executing;
    session.push_trace("Sandbox Prism", "Executing approved actions", StepStatus::Active);

    let final_response;
    let mut edges_reinforced = vec![];
    let agent_used;

    if consensus.approved {
        // Use the Reasoner's LLM response as the final output
        final_response = llm_response.clone();
        agent_used = determine_primary_agent(&intent);

        // Memory Keeper persists graph updates through sandbox
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
                eprintln!("[LangGraph] Memory Keeper graph update failed: {}", e);
            }
        }
    } else {
        // Consensus rejected — return a safe fallback
        final_response = format!(
            "🛡️ Multi-agent consensus was not reached for this request.\n\n\
             {}\n\n\
             Your data remains safe. The Sandbox Prism prevented any unverified action.",
            consensus.summary
        );
        agent_used = "orchestrator".to_string();
    }

    session.complete_trace_step("Sandbox Prism");

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: COMPLETE — Build final result
    // ═══════════════════════════════════════════════════════════════════════
    session.complete();

    // Record execution result
    session.add_message(AgentMessage::new(
        AgentRole::Orchestrator,
        MessageTarget::Broadcast,
        MessageType::ExecutionResult,
        format!(
            "Collaboration complete. Consensus: {}. Agents: {}. Edges reinforced: {}.",
            if consensus.approved { "APPROVED" } else { "REJECTED" },
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

    let result = RefractiveResult {
        response: final_response,
        intent,
        agent_used,
        context_nodes: context_node_ids.to_vec(),
        edges_reinforced,
        anticipations,
        processing_time_ms: elapsed,
        npu_accelerated,
        collaboration: None, // Filled in by RefractiveEngine::refract()
    };

    Ok((result, session))
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
