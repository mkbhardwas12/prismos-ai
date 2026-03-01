// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Refractive Core — Multi-Agent Orchestration Engine
//
// The Refractive Core is the central nervous system of PrismOS.
// It decomposes user intents and routes them through a pipeline
// of 5 specialized agents, each with distinct capabilities.

use serde::{Deserialize, Serialize};

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

// ─── Core Agent Registry ───────────────────────────────────────────────────────

/// Returns the 5 core PrismOS agents
pub fn get_agents() -> Vec<Agent> {
    vec![
        Agent {
            id: "orchestrator".into(),
            name: "Orchestrator".into(),
            role: "Routes intents and coordinates agent workflows".into(),
            status: AgentStatus::Idle,
            description: "Central coordinator that decomposes user intents and dispatches to specialized agents".into(),
        },
        Agent {
            id: "memory_keeper".into(),
            name: "Memory Keeper".into(),
            role: "Manages Spectrum Graph persistence and retrieval".into(),
            status: AgentStatus::Idle,
            description: "Handles all read/write operations to the Spectrum Graph, including semantic search and relationship mapping".into(),
        },
        Agent {
            id: "reasoner".into(),
            name: "Reasoner".into(),
            role: "Performs deep analysis and inference via LLM".into(),
            status: AgentStatus::Idle,
            description: "Interfaces with Ollama for local LLM inference, chain-of-thought reasoning, and content generation".into(),
        },
        Agent {
            id: "tool_smith".into(),
            name: "Tool Smith".into(),
            role: "Executes sandboxed operations in Prism containers".into(),
            status: AgentStatus::Idle,
            description: "Manages WASM sandboxes for safe code execution, file operations, and tool use".into(),
        },
        Agent {
            id: "sentinel".into(),
            name: "Sentinel".into(),
            role: "Monitors security, privacy, and system health".into(),
            status: AgentStatus::Idle,
            description: "Validates all operations against privacy policies, manages encryption, and monitors resource usage".into(),
        },
    ]
}

// ─── Intent Routing ────────────────────────────────────────────────────────────

/// Route a parsed intent through the Refractive Core agent pipeline
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
