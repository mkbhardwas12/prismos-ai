// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI LangGraph Multi-Agent Collaboration Framework
//
// This module implements the LangGraph-style multi-agent workflow described
// in the patent. Five specialized agents collaborate through a structured
// message-passing protocol with voting/consensus before any final action.
//
// Workflow DAG (Directed Acyclic Graph):
//
//   ┌──────────────┐
//   │  Orchestrator │ ← Entry node: decomposes intent
//   └──────┬───────┘
//          │ broadcasts WorkUnit to all specialists
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
//               │   Execute    │ ← Final action through Sandbox Prism
//               └──────────────┘
//
// All data stays local. No telemetry. No cloud dependency.

pub mod graph;
pub mod langgraph_workflow;
pub mod messages;
pub mod nodes;
