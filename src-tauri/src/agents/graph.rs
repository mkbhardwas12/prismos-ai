// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
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

use super::langgraph_workflow::WorkflowEngine;
use super::messages::*;
use crate::refractive_core::{ParsedIntent, RefractiveResult};
use std::path::Path;
use std::time::Instant;

// ─── LangGraph DAG Executor ────────────────────────────────────────────────────

/// Execute the full LangGraph multi-agent collaboration pipeline.
///
/// Delegates to the WorkflowEngine which provides formal state-graph
/// execution with debate rounds, conditional edges, and checkpointing.
///
/// Returns (RefractiveResult, CollaborationSession, Option<WorkflowState>) — the final response,
/// the collaboration audit trail, and the workflow state with debate data.
pub async fn execute_collaboration(
    intent: ParsedIntent,
    context_summary: &str,
    context_node_ids: &[String],
    scored_context: &[(String, f64)],
    npu_accelerated: bool,
    app_dir: &Path,
    app_handle: tauri::AppHandle,
    model: &str,
) -> Result<
    (RefractiveResult, CollaborationSession, Option<super::langgraph_workflow::WorkflowState>),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let start = Instant::now();

    // ── Execute through the formal LangGraph workflow engine ──
    let (result, workflow_state) = WorkflowEngine::execute(
        intent.clone(),
        context_summary,
        context_node_ids,
        scored_context,
        npu_accelerated,
        app_dir,
        app_handle,
        model,
    )
    .await?;

    // ── Build a CollaborationSession from the workflow state ──
    let mut session = CollaborationSession::new(&intent.raw);

    // Reconstruct pipeline trace from workflow transitions
    for node_id in &workflow_state.visited_nodes {
        let action = match node_id.as_str() {
            "orchestrator" => "Decomposing intent",
            "parallel_analyze" => "Fan-out to specialists",
            "reasoner" => "Analyzing intent via LLM",
            "tool_smith" => "Evaluating tool needs",
            "memory_keeper" => "Processing graph context",
            "parallel_join" => "Collecting proposals",
            "debate" => "Agents debating proposals",
            "sentinel_review" => "Security review",
            "consensus" => "Voting round",
            "execute" => "Executing through Sandbox Prism",
            "rejected" => "Consensus rejected — safe fallback",
            _ => "Processing",
        };
        let agent_name = match node_id.as_str() {
            "orchestrator" => "Orchestrator",
            "reasoner" => "Reasoner",
            "tool_smith" => "Tool Smith",
            "memory_keeper" => "Memory Keeper",
            "sentinel_review" => "Sentinel",
            "debate" => "Debate",
            "consensus" => "Consensus",
            "parallel_analyze" | "parallel_join" => "Pipeline",
            "execute" => "Sandbox Prism",
            "rejected" => "Sandbox Prism",
            _ => node_id,
        };
        session.push_trace(agent_name, action, StepStatus::Completed);
    }

    // Copy consensus from workflow
    if let Some(ref consensus) = workflow_state.consensus {
        session.consensus = Some(consensus.clone());
        for vote in &consensus.votes {
            session.add_vote(vote.clone());
        }
    }

    // Reconstruct message count from workflow state:
    // proposals + debate arguments + consensus messages give the real count
    let proposal_count = workflow_state.proposals.len();
    let debate_count = workflow_state.debate.as_ref().map(|d| d.arguments.len()).unwrap_or(0);
    let vote_count = session.votes.len();
    // Add synthetic messages so the frontend shows the correct count
    for prop in &workflow_state.proposals {
        session.add_message(prop.clone());
    }
    // Add debate arguments as messages
    if let Some(ref debate) = workflow_state.debate {
        for arg in &debate.arguments {
            session.add_message(AgentMessage::new(
                arg.from.clone(),
                MessageTarget::Broadcast,
                MessageType::Proposal,
                arg.content.clone(),
            ));
        }
    }

    eprintln!(
        "[LangGraph] Session messages reconstructed: {} proposals + {} debate args + {} votes",
        proposal_count, debate_count, vote_count
    );

    session.current_phase = if workflow_state.status == super::langgraph_workflow::WorkflowStatus::Approved {
        CollaborationPhase::Completed
    } else if workflow_state.status == super::langgraph_workflow::WorkflowStatus::Rejected {
        CollaborationPhase::Failed
    } else {
        CollaborationPhase::Completed
    };
    session.complete();

    eprintln!(
        "[LangGraph] Workflow complete in {}ms — {} nodes visited, {} transitions, debate: {} arguments",
        start.elapsed().as_millis(),
        workflow_state.visited_nodes.len(),
        workflow_state.transitions.len(),
        workflow_state.debate.as_ref().map(|d| d.arguments.len()).unwrap_or(0)
    );

    Ok((result, session, Some(workflow_state)))
}
