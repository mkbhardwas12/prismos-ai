// BrainWrapped Component Tests — verifies the shareable cognitive story UI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import BrainWrapped from "../components/BrainWrapped";
import type { BrainSnapshot } from "../types";

const mockSnapshot: BrainSnapshot = {
  fingerprint: {
    hash: "a1b2c3d4e5f6a7b8",
    palette: ["hsl(200, 70%, 55%)", "hsl(260, 75%, 60%)", "hsl(320, 65%, 50%)", "hsl(20, 70%, 55%)", "hsl(80, 75%, 60%)"],
    shape_points: [[50, 18], [76, 38], [66, 70], [34, 70], [24, 38]],
    rotation: 1.234,
    archetype: "The Architect",
    archetype_tagline: "Often prefers structured, first-principles responses",
    seed: 20210,
  },
  profile: {
    depth: 0.85,
    creativity: 0.40,
    formality: 0.70,
    technical_level: 0.85,
    example_preference: 0.50,
    interaction_count: 142,
    last_updated: "2026-04-18T00:00:00Z",
  },
  axis_labels: {
    depth: "Prefers depth",
    creativity: "Prefers literal",
    formality: "Prefers formal",
    technical_level: "Specialized Vocabulary",
    example_preference: "Balanced examples",
  },
  drift: null,
  evolution_summary: "The response-preference profile is still calibrating.",
  top_currents: [
    { theme: "You ask about Coding every Monday", frequency: 4, momentum: "rising" },
    { theme: "You ask about Reasoning every Wednesday", frequency: 3, momentum: "steady" },
  ],
  prophecy_count: 7,
  top_prophecies: [
    {
      source_id: "n1", target_id: "n2",
      source_label: "React hooks", target_label: "Async patterns",
      probability: 0.82, reason: "shared keywords", evidence_type: "keyword_overlap",
    },
  ],
  refraction: null,
  stats: {
    total_intents: 142,
    total_nodes: 87,
    total_edges: 134,
    days_active: 21,
    interactions: 142,
    favorite_archetype_phrase: "Often prefers structured, first-principles responses",
  },
  generated_at: "2026-04-18T00:00:00Z",
  schema_version: 1,
};

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(JSON.stringify(mockSnapshot));
});

describe("BrainWrapped", () => {
  it("shows loading state before snapshot arrives", async () => {
    invokeMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<BrainWrapped onClose={vi.fn()} />);
    expect(screen.getByText(/Building your interaction-profile story/i)).toBeInTheDocument();
  });

  it("renders fingerprint slide first", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("An illustrated interaction profile.")).toBeInTheDocument());
    expect(screen.getByText(mockSnapshot.fingerprint.hash)).toBeInTheDocument();
  });

  it("displays the illustrated profile label without a personality claim", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("An illustrated interaction profile.")).toBeInTheDocument());
    // Advance to slide 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByText("The Architect")).toBeInTheDocument()
    );
    expect(
      screen.getByText(/Often prefers structured/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/not a personality assessment/i)).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    render(<BrainWrapped onClose={onClose} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates to a specific slide via progress dots", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    const dots = screen.getAllByRole("button", { name: /Go to slide/i });
    expect(dots).toHaveLength(7);
    fireEvent.click(dots[6]);
    await waitFor(() =>
      expect(screen.getByText("By the numbers.")).toBeInTheDocument()
    );
  });

  it("labels candidate-link percentages as heuristic scores", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    const dots = screen.getAllByRole("button", { name: /Go to slide/i });
    fireEvent.click(dots[5]);
    await waitFor(() => expect(screen.getByText(/CANDIDATE LINKS/)).toBeInTheDocument());
    expect(screen.getByText("82% heuristic score")).toBeInTheDocument();
  });

  it("renders watermark on every slide", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    expect(screen.getByText(/PrismOS-AI/)).toBeInTheDocument();
    expect(screen.getByText(/local profile · share intentionally/i)).toBeInTheDocument();
  });

  it("calls invoke('generate_brain_snapshot') on mount", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("generate_brain_snapshot")
    );
  });

  it("renders error state when snapshot generation fails", async () => {
    invokeMock.mockRejectedValueOnce("DB locked");
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't generate your profile story/i)).toBeInTheDocument()
    );
  });

  it("includes share buttons", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    expect(screen.getByText(/Save Slide/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy Signature/i)).toBeInTheDocument();
    expect(screen.getByText(/Share My Profile/i)).toBeInTheDocument();
  });

  it("advances slides via right arrow key", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));

    // Slide 1 → 2 (Archetype)
    act(() => fireEvent.keyDown(window, { key: "ArrowRight" }));
    await waitFor(() => screen.getByText("The Architect"));

    // Slide 2 → 3 (Axes)
    act(() => fireEvent.keyDown(window, { key: "ArrowRight" }));
    await waitFor(() => screen.getByText("How your response preferences are tuned."));
  });

  it("displays lifetime stats on final slide", async () => {
    render(<BrainWrapped onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("An illustrated interaction profile."));
    const dots = screen.getAllByRole("button", { name: /Go to slide/i });
    fireEvent.click(dots[6]);
    await waitFor(() => screen.getByText("By the numbers."));
    expect(screen.getAllByText("142").length).toBeGreaterThan(0); // intents/interactions
    expect(screen.getByText("87")).toBeInTheDocument();    // nodes
    expect(screen.getByText("21")).toBeInTheDocument();    // days
  });
});
