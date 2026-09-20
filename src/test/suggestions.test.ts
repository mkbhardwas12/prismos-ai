import { describe, it, expect } from "vitest";
import { generateGraphSuggestions } from "../lib/suggestions";
import type { SpectrumNode } from "../types";

const record = (
  id: string,
  node_type: string,
  label: string,
): SpectrumNode => ({
  id,
  node_type,
  label,
  content: "Synthetic test content",
  layer: "context",
  access_count: 1,
  last_accessed: "2026-09-08T12:00:00Z",
  created_at: "2026-09-08T12:00:00Z",
  updated_at: "2026-09-08T12:00:00Z",
  connections: [],
});

describe("suggestion evidence isolation", () => {
  it("does not make a legacy suggestion into a recent note or knowledge hub", () => {
    const legacy = {
      ...record("legacy", "suggestion", "Do not recycle this generated prompt"),
      connections: ["a", "b", "c"],
      last_accessed: "2026-09-09T12:00:00Z",
    };
    const note = record("note", "note", "Recorded review evidence");
    const result = generateGraphSuggestions([legacy, note], []);
    expect(result.some((item) => item.id === "graph-recent-note")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Do not recycle");
    expect(result.some((item) => item.id.includes("legacy"))).toBe(false);
  });

  it("uses harmless fallback cards when only legacy suggestions exist", () => {
    const result = generateGraphSuggestions(
      [record("legacy", "suggestion", "Old generated prompt")],
      [],
    );
    expect(result).toHaveLength(3);
    expect(result.every((item) => item.id.startsWith("def-"))).toBe(true);
  });
});
