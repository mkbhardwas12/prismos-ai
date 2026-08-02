// Workflow Trace Adapter — sequential model loop + deterministic role checks
//
// WorkflowEngine owns the real bounded plan/build/judge/refine loop. This
// adapter preserves older state-graph and trace shapes without claiming that
// each compatibility role is an independent model:
//
//   1. PLAN/BUILD   — sequential model calls produce criteria and a candidate
//   2. CHECK        — deterministic memory, action-policy, and security checks
//   3. JUDGE        — a sequential Critic scores and may request refinement
//   4. TRACE        — compatibility proposals/votes describe the completed path
//   5. PERSIST      — approved conversation state updates the Spectrum Graph
//
// The entire workflow is synchronous per-intent and returns a complete
// CollaborationSession with full audit trail.

use super::langgraph_workflow::WorkflowEngine;
use super::messages::*;
use crate::refractive_core::{ParsedIntent, RefractiveResult};
use std::path::Path;
use std::time::Instant;

// ─── LangGraph DAG Executor ────────────────────────────────────────────────────

/// Execute the bounded workflow and construct its compatibility trace.
///
/// Delegates to the WorkflowEngine which provides formal state-graph
/// execution with debate rounds, conditional edges, and checkpointing.
///
/// Returns (RefractiveResult, CollaborationSession, Option<WorkflowState>) — the final response,
/// the collaboration audit trail, and the workflow state with debate data.
#[allow(clippy::too_many_arguments)] // Compatibility boundary shared with WorkflowEngine::execute.
pub async fn execute_collaboration(
    intent: ParsedIntent,
    context_summary: &str,
    context_node_ids: &[String],
    scored_context: &[(String, f64)],
    simd_accelerated: bool,
    app_dir: &Path,
    app_handle: tauri::AppHandle,
    model: &str,
    request_id: &str,
) -> Result<
    (
        RefractiveResult,
        CollaborationSession,
        Option<super::langgraph_workflow::WorkflowState>,
    ),
    Box<dyn std::error::Error + Send + Sync>,
> {
    let start = Instant::now();

    // ── Execute through the formal LangGraph workflow engine ──
    let (result, workflow_state) = WorkflowEngine::execute(
        intent.clone(),
        context_summary,
        context_node_ids,
        scored_context,
        simd_accelerated,
        app_dir,
        app_handle,
        model,
        request_id,
    )
    .await?;

    // ── Build a CollaborationSession from the workflow state ──
    let mut session = CollaborationSession::new(&intent.raw);

    // Reconstruct pipeline trace from workflow transitions
    for node_id in &workflow_state.visited_nodes {
        let action = match node_id.as_str() {
            "orchestrator" => "Decomposing intent",
            "parallel_analyze" => "Evaluating deterministic role checks",
            "reasoner" => "Building candidate via local model",
            "tool_smith" => "Evaluating modeled action policy",
            "memory_keeper" => "Reviewing retrieved graph context",
            "parallel_join" => "Collecting check results",
            "debate" => "Comparing deterministic role positions",
            "sentinel_review" => "Security review",
            "consensus" => "Recording heuristic decision",
            "execute" => "Finalizing approved candidate",
            "rejected" => "Policy rejected — safe fallback",
            _ => "Processing",
        };
        let agent_name = match node_id.as_str() {
            "orchestrator" => "Workflow",
            "reasoner" => "Local Model",
            "tool_smith" => "Action Policy",
            "memory_keeper" => "Knowledge Check",
            "sentinel_review" => "Security Check",
            "debate" => "Comparison",
            "consensus" => "Decision",
            "parallel_analyze" | "parallel_join" => "Workflow",
            "execute" => "Workflow",
            "rejected" => "Workflow",
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
    let debate_count = workflow_state
        .debate
        .as_ref()
        .map(|d| d.arguments.len())
        .unwrap_or(0);
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

    session.current_phase =
        if workflow_state.status == super::langgraph_workflow::WorkflowStatus::Approved {
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
