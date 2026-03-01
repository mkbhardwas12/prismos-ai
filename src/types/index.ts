// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS — Type Definitions

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "Idle" | "Processing" | "Waiting" | "Error";
  description: string;
}

export interface SpectrumNode {
  id: string;
  label: string;
  content: string;
  node_type: string;
  created_at: string;
  updated_at: string;
  connections: string[];
}

export interface SpectrumEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  created_at: string;
}

export interface ParsedIntent {
  raw: string;
  intent_type: string;
  entities: string[];
  confidence: number;
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  agent?: string;
}

export interface AppSettings {
  ollamaUrl: string;
  defaultModel: string;
  theme: "dark" | "light";
  maxTokens: number;
}

export interface Prism {
  id: string;
  name: string;
  status: string;
  created_at: string;
  checkpoints: Checkpoint[];
}

export interface Checkpoint {
  id: string;
  prism_id: string;
  state_hash: string;
  created_at: string;
}
