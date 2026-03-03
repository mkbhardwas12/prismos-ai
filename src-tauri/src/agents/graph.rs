// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
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
use crate::refractive_core::{IntentType, ParsedIntent, RefractiveResult};
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

/// Determine the primary agent based on intent type
#[allow(dead_code)]
fn determine_primary_agent(intent: &ParsedIntent) -> String {
    match intent.intent_type {
        IntentType::Query | IntentType::Analyze => "reasoner".to_string(),
        IntentType::Create => "tool_smith".to_string(),
        IntentType::Connect => "memory_keeper".to_string(),
        IntentType::System => "sentinel".to_string(),
    }
}
