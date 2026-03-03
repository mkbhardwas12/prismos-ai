// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// LangGraph Messages — Structured Inter-Agent Communication Protocol
//
// Agents communicate through typed messages that carry proposals, votes,
// and execution results. Every message is attributable to a specific agent
// and timestamped for auditability.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Agent Message Types ───────────────────────────────────────────────────────

/// Unique identifier for each agent in the collaboration graph
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum AgentRole {
    Orchestrator,
    Reasoner,
    ToolSmith,
    MemoryKeeper,
    Sentinel,
}

impl AgentRole {
    #[allow(dead_code)]
    pub fn id(&self) -> &'static str {
        match self {
            Self::Orchestrator => "orchestrator",
            Self::Reasoner => "reasoner",
            Self::ToolSmith => "tool_smith",
            Self::MemoryKeeper => "memory_keeper",
            Self::Sentinel => "sentinel",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Orchestrator => "Orchestrator",
            Self::Reasoner => "Reasoner",
            Self::ToolSmith => "Tool Smith",
            Self::MemoryKeeper => "Memory Keeper",
            Self::Sentinel => "Sentinel",
        }
    }
}

/// A structured message passed between agents during collaboration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub from: AgentRole,
    pub to: MessageTarget,
    pub msg_type: MessageType,
    pub content: String,
    pub timestamp: String,
    pub metadata: MessageMetadata,
}

/// Who the message is addressed to
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageTarget {
    Agent(AgentRole),
    Broadcast, // All agents
    Consensus, // Consensus round
}

/// The semantic type of a message
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageType {
    /// Orchestrator decomposes an intent into sub-tasks
    WorkUnit,
    /// An agent proposes an action or response
    Proposal,
    /// An agent's analysis/reasoning output
    Analysis,
    /// Security review from Sentinel
    SecurityReview,
    /// Vote on a proposal (approve/reject with reason)
    Vote,
    /// Final consensus result
    ConsensusResult,
    /// Execution result after Sandbox Prism
    ExecutionResult,
    /// Collaboration status update for UI
    StatusUpdate,
}

/// Additional context carried with each message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageMetadata {
    /// Confidence score (0.0–1.0) in the message content
    pub confidence: f64,
    /// Risk tier of the proposed action (0 = info, 1–3 = sandbox tiers)
    pub risk_tier: u8,
    /// Which Spectrum Graph nodes are referenced
    pub context_nodes: Vec<String>,
    /// Free-form key-value tags
    pub tags: Vec<String>,
}

impl Default for MessageMetadata {
    fn default() -> Self {
        Self {
            confidence: 1.0,
            risk_tier: 0,
            context_nodes: vec![],
            tags: vec![],
        }
    }
}

impl AgentMessage {
    pub fn new(
        from: AgentRole,
        to: MessageTarget,
        msg_type: MessageType,
        content: String,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            from,
            to,
            msg_type,
            content,
            timestamp: Utc::now().to_rfc3339(),
            metadata: MessageMetadata::default(),
        }
    }

    #[allow(dead_code)]
    pub fn with_metadata(mut self, metadata: MessageMetadata) -> Self {
        self.metadata = metadata;
        self
    }

    pub fn with_confidence(mut self, confidence: f64) -> Self {
        self.metadata.confidence = confidence;
        self
    }

    pub fn with_risk(mut self, tier: u8) -> Self {
        self.metadata.risk_tier = tier;
        self
    }

    pub fn with_context(mut self, nodes: Vec<String>) -> Self {
        self.metadata.context_nodes = nodes;
        self
    }
}

// ─── Vote ──────────────────────────────────────────────────────────────────────

/// An agent's vote during the consensus round
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    pub agent: AgentRole,
    pub approve: bool,
    pub reason: String,
    pub confidence: f64,
}

/// Result of a consensus round
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsensusOutcome {
    pub approved: bool,
    pub votes: Vec<Vote>,
    pub approve_count: usize,
    pub reject_count: usize,
    pub summary: String,
}

// ─── Collaboration Session ─────────────────────────────────────────────────────

/// Tracks the full multi-agent collaboration for a single intent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollaborationSession {
    pub session_id: String,
    pub intent: String,
    pub messages: Vec<AgentMessage>,
    pub votes: Vec<Vote>,
    pub consensus: Option<ConsensusOutcome>,
    pub current_phase: CollaborationPhase,
    pub pipeline_trace: Vec<PipelineStep>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// Which phase of the collaboration pipeline we're in
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CollaborationPhase {
    Orchestrating,
    Analyzing,
    Proposing,
    SecurityReview,
    Voting,
    Executing,
    Completed,
    Failed,
}

impl CollaborationPhase {
    #[allow(dead_code)]
    pub fn label(&self) -> &'static str {
        match self {
            Self::Orchestrating => "Orchestrator decomposing intent",
            Self::Analyzing => "Agents analyzing",
            Self::Proposing => "Agents proposing actions",
            Self::SecurityReview => "Sentinel reviewing security",
            Self::Voting => "Consensus vote in progress",
            Self::Executing => "Executing through Sandbox Prism",
            Self::Completed => "Collaboration complete",
            Self::Failed => "Collaboration failed",
        }
    }
}

/// A single step in the pipeline trace (for UI display)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineStep {
    pub agent: String,
    pub action: String,
    pub status: StepStatus,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StepStatus {
    Pending,
    Active,
    Completed,
    Failed,
}

impl CollaborationSession {
    pub fn new(intent: &str) -> Self {
        Self {
            session_id: Uuid::new_v4().to_string(),
            intent: intent.to_string(),
            messages: vec![],
            votes: vec![],
            consensus: None,
            current_phase: CollaborationPhase::Orchestrating,
            pipeline_trace: vec![],
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
        }
    }

    pub fn add_message(&mut self, msg: AgentMessage) {
        self.messages.push(msg);
    }

    pub fn add_vote(&mut self, vote: Vote) {
        self.votes.push(vote);
    }

    pub fn push_trace(&mut self, agent: &str, action: &str, status: StepStatus) {
        self.pipeline_trace.push(PipelineStep {
            agent: agent.to_string(),
            action: action.to_string(),
            status,
            timestamp: Utc::now().to_rfc3339(),
        });
    }

    pub fn complete_trace_step(&mut self, agent: &str) {
        for step in self.pipeline_trace.iter_mut().rev() {
            if step.agent == agent && step.status == StepStatus::Active {
                step.status = StepStatus::Completed;
                break;
            }
        }
    }

    pub fn complete(&mut self) {
        self.current_phase = CollaborationPhase::Completed;
        self.completed_at = Some(Utc::now().to_rfc3339());
    }

    #[allow(dead_code)]
    pub fn fail(&mut self) {
        self.current_phase = CollaborationPhase::Failed;
        self.completed_at = Some(Utc::now().to_rfc3339());
    }
}
