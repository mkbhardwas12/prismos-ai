// researchBridge — typed access to the DMZ research bridge (isolated web egress).
//
// The PrismOS core never egresses. These commands drive a separate, isolated
// sidecar that reaches the web ONLY when you explicitly consent (allowEgress),
// off by default. Retrieved text lands fenced as untrusted with a fetch receipt,
// which you can observe here. See scripts/research_bridge/README.md.

import { invoke } from "@tauri-apps/api/core";

export interface ResearchReceipt {
  url: string;
  final_url: string;
  host: string;
  pinned_ip?: string;
  status: number;
  content_type?: string;
  content_encoding?: string;
  fetched_at: string;
  ingress_bytes: number;
  content_sha256: string;
  truncated?: boolean;
  robots_respected?: boolean;
  title?: string;
  egress?: string;
}

export interface ResearchRun {
  requested: number;
  receipts: ResearchReceipt[];
  log: string;
  egress_consented: boolean;
}

/**
 * Drive the bridge for one or more http(s) URLs. Reaches the web ONLY if
 * `allowEgress` is true (the consent gate). `ingest` also seeds the fenced
 * content into the knowledge graph as research-* nodes.
 */
export function runResearchBridge(
  urls: string[],
  allowEgress: boolean,
  ingest: boolean,
): Promise<ResearchRun> {
  return invoke<ResearchRun>("run_research_bridge", { urls, allowEgress, ingest });
}

/** Read the local fetch receipts (no network) — the observable audit record. */
export function listResearchReceipts(): Promise<ResearchReceipt[]> {
  return invoke<ResearchReceipt[]>("list_research_receipts");
}
