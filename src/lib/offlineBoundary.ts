// offlineBoundary — typed access to the honest network-boundary report.
//
// The core AI client uses a loopback Ollama route by default and the knowledge
// graph stays local. This surfaces the fuller truth — including the few
// opt-in integrations that can reach off-device — so the UI can state the
// boundary precisely instead of an absolute claim. See docs/OFFLINE_KNOWLEDGE.md.

import { invoke } from "@tauri-apps/api/core";

export interface OptionalEgress {
  feature: string;
  destination: string;
  trigger: string;
  data_sent: string;
}

export interface OfflineBoundaryReport {
  /** PrismOS client-route policy only; not a daemon/runtime zero-egress receipt. */
  core_local_only: boolean;
  ollama_endpoint: string;
  ollama_management_endpoint: string;
  remote_ollama_opt_in: boolean;
  no_telemetry: boolean;
  no_web_crawler: boolean;
  local_corpus_ingestion: string;
  optional_egress: OptionalEgress[];
  summary: string;
}

/** Fetch the honest offline-boundary report from the backend. */
export function offlineBoundaryReport(ollamaUrl?: string | null): Promise<OfflineBoundaryReport> {
  return invoke<OfflineBoundaryReport>("offline_boundary_report", { ollamaUrl: ollamaUrl ?? null });
}
