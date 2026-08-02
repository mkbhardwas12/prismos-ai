// PrismOS-AI bounded sequential workflow compatibility module
//
// This module implements a LangGraph-style workflow. The Reasoner performs the
// model call; the other named roles, debate, and votes are deterministic stages
// that exchange structured messages before the final response.
//
// Deterministic workflow trace (the named roles are not parallel model agents):
//
//   ┌──────────────┐
//   │  Orchestrator │ ← Entry node: decomposes intent
//   └──────┬───────┘
//          │ prepares deterministic role inputs
//          ├──────────────┬──────────────┐
//          ▼              ▼              ▼
//   ┌──────────┐  ┌────────────┐  ┌───────────┐
//   │ Reasoner │  │ Tool Smith │  │ Mem Keeper │
//   └────┬─────┘  └─────┬──────┘  └─────┬─────┘
//        │              │               │
//        └──────────────┼───────────────┘
//                       ▼
//               ┌──────────────┐
//               │   Sentinel   │ ← Security gate: validates all proposals
//               └──────┬───────┘
//                      ▼
//               ┌──────────────┐
//               │  Consensus   │ ← Voting round: majority required
//               └──────┬───────┘
//                      ▼
//               ┌──────────────┐
//               │   Execute    │ ← Final response under action policy
//               └──────────────┘
//
// Ollama is loopback-only by default. Explicit remote opt-in and separate
// integrations have their own network boundaries.

pub mod graph;
pub mod langgraph_workflow;
pub mod messages;
pub mod nodes;
