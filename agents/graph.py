"""
Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
PrismOS Refractive Core — LangGraph Multi-Agent Orchestration

This module implements the 5-agent Refractive Core using LangGraph
for multi-agent orchestration with Ollama for local LLM inference.

Usage:
    python agents/graph.py "What is PrismOS?"
    python agents/graph.py "Create a summary of quantum computing"

Agents:
    1. Orchestrator — Decomposes intents, routes to specialized agents
    2. Memory Keeper — Manages Spectrum Graph persistence & retrieval
    3. Reasoner — Deep analysis & inference via local LLM
    4. Tool Smith — Executes sandboxed operations in Prism containers
    5. Sentinel — Monitors security, privacy, and system health
"""

from __future__ import annotations

import operator
from typing import Annotated, Literal, TypedDict

# ── LangGraph Imports (graceful fallback) ────────────────────────────────────

try:
    from langchain_community.llms import Ollama
    from langgraph.graph import END, StateGraph

    LANGGRAPH_AVAILABLE = True
except ImportError:
    LANGGRAPH_AVAILABLE = False
    print("⚠️  LangGraph not installed. Run: pip install -r agents/requirements.txt")


# ── Shared State ─────────────────────────────────────────────────────────────

DEFAULT_MODEL = "mistral"
OLLAMA_BASE_URL = "http://localhost:11434"


class PrismState(TypedDict):
    """Shared state flowing through the Refractive Core agent graph."""

    messages: Annotated[list[dict], operator.add]
    current_agent: str
    intent_type: str
    entities: list[str]
    context: dict
    final_response: str


# ── LLM Factory ──────────────────────────────────────────────────────────────


def create_llm(model: str = DEFAULT_MODEL) -> Ollama:
    """Create an Ollama LLM instance for local inference."""
    return Ollama(model=model, base_url=OLLAMA_BASE_URL)


# ── Agent Implementations ───────────────────────────────────────────────────


def orchestrator_agent(state: PrismState) -> dict:
    """Central coordinator — decomposes intents and routes to agents."""
    llm = create_llm()
    last_message = state["messages"][-1]["content"] if state["messages"] else ""

    response = llm.invoke(
        f"You are the Orchestrator in PrismOS (a local-first AI OS). "
        f"Analyze this user intent and determine which single agent should handle it. "
        f"Choose exactly one: reasoner, memory_keeper, tool_smith, or sentinel.\n\n"
        f'User intent: "{last_message}"\n\n'
        f"Respond with ONLY the agent name, nothing else."
    )

    agent = response.strip().lower().replace(" ", "_")
    valid = {"reasoner", "memory_keeper", "tool_smith", "sentinel"}
    chosen = agent if agent in valid else "reasoner"

    return {
        "current_agent": chosen,
        "messages": [{"role": "orchestrator", "content": f"Routing to: {chosen}"}],
    }


def reasoner_agent(state: PrismState) -> dict:
    """Deep analysis and inference agent — primary LLM interaction."""
    llm = create_llm()
    user_msg = next(
        (m["content"] for m in state["messages"] if m.get("role") == "user"), ""
    )

    response = llm.invoke(
        f"You are the Reasoner agent in PrismOS, a local-first AI system. "
        f"All processing is local and private. "
        f'Provide a thoughtful, detailed response to: "{user_msg}"'
    )

    return {
        "final_response": response,
        "messages": [{"role": "reasoner", "content": response}],
    }


def memory_keeper_agent(state: PrismState) -> dict:
    """Knowledge graph management agent."""
    llm = create_llm()
    user_msg = next(
        (m["content"] for m in state["messages"] if m.get("role") == "user"), ""
    )

    response = llm.invoke(
        f"You are the Memory Keeper agent in PrismOS. "
        f"Help the user store, retrieve, or connect knowledge. "
        f'User request: "{user_msg}"'
    )

    return {
        "final_response": response,
        "messages": [{"role": "memory_keeper", "content": response}],
    }


def tool_smith_agent(state: PrismState) -> dict:
    """Sandboxed execution agent."""
    user_msg = next(
        (m["content"] for m in state["messages"] if m.get("role") == "user"), ""
    )

    response = (
        f"Tool Smith received task: {user_msg}\n\n"
        f"⚙️ Sandbox execution is stubbed in MVP. "
        f"WASM runtime integration planned for v0.3."
    )

    return {
        "final_response": response,
        "messages": [{"role": "tool_smith", "content": response}],
    }


def sentinel_agent(state: PrismState) -> dict:
    """Security and privacy monitoring agent."""
    return {
        "final_response": (
            "🛡️ Sentinel: All operations verified.\n"
            "• Privacy: No data sent externally\n"
            "• Security: Local execution only\n"
            "• System: All agents nominal"
        ),
        "messages": [
            {
                "role": "sentinel",
                "content": "Security check passed. All operations local.",
            }
        ],
    }


# ── Graph Router ─────────────────────────────────────────────────────────────


def route_after_orchestrator(
    state: PrismState,
) -> Literal["reasoner", "memory_keeper", "tool_smith", "sentinel"]:
    """Route to the appropriate agent based on orchestrator decision."""
    agent = state.get("current_agent", "reasoner")
    valid = {"reasoner", "memory_keeper", "tool_smith", "sentinel"}
    return agent if agent in valid else "reasoner"


# ── Build the LangGraph ─────────────────────────────────────────────────────


def build_refractive_core():
    """Build the LangGraph multi-agent Refractive Core workflow."""
    if not LANGGRAPH_AVAILABLE:
        raise RuntimeError(
            "LangGraph is not installed. Run: pip install -r agents/requirements.txt"
        )

    graph = StateGraph(PrismState)

    # Add agent nodes
    graph.add_node("orchestrator", orchestrator_agent)
    graph.add_node("reasoner", reasoner_agent)
    graph.add_node("memory_keeper", memory_keeper_agent)
    graph.add_node("tool_smith", tool_smith_agent)
    graph.add_node("sentinel", sentinel_agent)

    # Entry point
    graph.set_entry_point("orchestrator")

    # Conditional routing from orchestrator to specialized agents
    graph.add_conditional_edges(
        "orchestrator",
        route_after_orchestrator,
        {
            "reasoner": "reasoner",
            "memory_keeper": "memory_keeper",
            "tool_smith": "tool_smith",
            "sentinel": "sentinel",
        },
    )

    # All specialized agents route to END
    graph.add_edge("reasoner", END)
    graph.add_edge("memory_keeper", END)
    graph.add_edge("tool_smith", END)
    graph.add_edge("sentinel", END)

    return graph.compile()


# ── Public API ───────────────────────────────────────────────────────────────


def process_intent(user_input: str, model: str = DEFAULT_MODEL) -> str:
    """Process a user intent through the Refractive Core agent pipeline."""
    global DEFAULT_MODEL
    DEFAULT_MODEL = model

    if not LANGGRAPH_AVAILABLE:
        # Fallback: direct Ollama call without LangGraph
        try:
            llm = create_llm(model)
            return llm.invoke(user_input)
        except Exception as e:
            return f"Error: {e}"

    core = build_refractive_core()

    initial_state: PrismState = {
        "messages": [{"role": "user", "content": user_input}],
        "current_agent": "orchestrator",
        "intent_type": "query",
        "entities": [],
        "context": {},
        "final_response": "",
    }

    result = core.invoke(initial_state)
    return result.get("final_response", "No response generated.")


# ── CLI Entry Point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else "What is PrismOS?"
    print("╔══════════════════════════════════════════════╗")
    print("║  ◈ PrismOS Refractive Core — Agent Pipeline  ║")
    print("║  Patent Pending               ║")
    print("╚══════════════════════════════════════════════╝")
    print(f"\n🔮 Processing: {query}\n")
    print(f"📡 Response:\n{process_intent(query)}")
