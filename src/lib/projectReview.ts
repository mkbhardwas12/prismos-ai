// projectReview — detect "review my project/code" requests and format results.
//
// The actual review is gated: a metadata-only scan runs first, the user must
// approve the scope in the UI, and only then does the read-only review run.

export interface ReviewDetection {
  /** Absolute or ~-relative path the user pointed at, if any */
  path: string | null;
}

/**
 * Detect a whole-project / code review request. Requires a review-ish verb and
 * a code/project noun. Extracts a path if one is present in the message.
 */
export function detectReviewRequest(input: string): ReviewDetection | null {
  const t = input.toLowerCase();
  const reviewVerb = /\b(review|audit|analy[sz]e|inspect|assess|evaluate|check)\b/.test(t);
  const codeNoun = /\b(project|codebase|code|repo|repository|source|folder|directory)\b/.test(t);
  if (!reviewVerb || !codeNoun) return null;

  const path = extractPath(input);
  return { path };
}

/** Pull the first path-looking token (/abs/path or ~/path) from the message. */
export function extractPath(input: string): string | null {
  const match = input.match(/(?:^|[\s"'`(])((?:~|\/)[\w.\-~/ ]*[\w\-/])/);
  if (!match) return null;
  // Trim trailing punctuation the regex may have swallowed via spaces
  return match[1].replace(/[\s]+$/, "");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ReportFinding {
  severity: string;
  file: string;
  title: string;
  detail: string;
  recommendation: string;
  source: string;
}

interface ReportGate {
  gate: string;
  status: string;
  detail: string;
}

export interface ReviewReportPayload {
  project_name: string;
  root: string;
  model: string;
  gates: ReportGate[];
  findings: ReportFinding[];
  files_scanned: number;
  files_reviewed_by_llm: number;
  duration_ms: number;
  severity_counts: Record<string, number>;
  report_docx_path: string;
  report_docx_filename: string;
  read_only_guarantee: string;
}

const SEV_ICONS: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
  info: "⚪",
};

/** Render the review report as chat markdown (full report is in the .docx). */
export function formatReportMarkdown(r: ReviewReportPayload): string {
  const lines: string[] = [];
  lines.push(`## 🔍 Code Review — ${r.project_name}`);
  lines.push("");
  lines.push(
    `Scanned **${r.files_scanned} files** (${r.files_reviewed_by_llm} deep-reviewed by \`${r.model}\`) in ${(r.duration_ms / 1000).toFixed(1)}s.`,
  );
  lines.push("");

  const counts = ["critical", "high", "medium", "low", "info"]
    .filter((s) => (r.severity_counts[s] ?? 0) > 0)
    .map((s) => `${SEV_ICONS[s]} ${r.severity_counts[s]} ${s}`);
  lines.push(counts.length > 0 ? counts.join(" · ") : "✅ No findings — clean review.");
  lines.push("");

  lines.push("**Gates**");
  for (const g of r.gates) {
    lines.push(`- ✅ ${g.gate}: ${g.detail}`);
  }
  lines.push("");

  const top = r.findings.filter((f) => f.severity !== "info").slice(0, 10);
  if (top.length > 0) {
    lines.push("**Top findings**");
    for (const f of top) {
      lines.push(`- ${SEV_ICONS[f.severity] ?? "⚪"} **${f.title}** — \`${f.file}\`: ${f.detail}`);
    }
    lines.push("");
  }

  lines.push(`🔒 ${r.read_only_guarantee}`);
  lines.push("");
  lines.push(`───\n🔍 Project Review · read-only · full report in **${r.report_docx_filename}** · 100% local`);
  return lines.join("\n");
}
