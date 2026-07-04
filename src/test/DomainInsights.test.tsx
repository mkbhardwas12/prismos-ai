// PrismOS-AI — DomainInsights Component Tests (Recommended Model Display)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import DomainInsights from "../components/DomainInsights";
import { invoke } from "@tauri-apps/api/core";

function mockDomainProfile(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    primary_domain: "Engineering",
    confidence: 0.75,
    total_queries: 25,
    domain_counts: {
      Engineering: 15,
      Science: 5,
      General: 5,
    },
    ...overrides,
  });
}

describe("DomainInsights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when total_queries < 5", async () => {
    vi.mocked(invoke).mockResolvedValue(
      JSON.stringify({ primary_domain: "General", confidence: 0.1, total_queries: 3, domain_counts: { General: 3 } })
    );
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getByText(/Keep asking questions/)).toBeInTheDocument();
    });
    expect(screen.getByText(/3\/5 queries analyzed/)).toBeInTheDocument();
  });

  it("shows primary domain when enough queries", async () => {
    vi.mocked(invoke).mockResolvedValue(mockDomainProfile());
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Software & Engineering").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/75% confidence/)).toBeInTheDocument();
    });
  });

  it("shows recommended model for Engineering domain", async () => {
    vi.mocked(invoke).mockResolvedValue(mockDomainProfile());
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getByText("qwen2.5-coder:7b")).toBeInTheDocument();
      expect(screen.getByText(/we recommend/)).toBeInTheDocument();
    });
  });

  it("hides recommended model when confidence < 0.3", async () => {
    vi.mocked(invoke).mockResolvedValue(
      mockDomainProfile({ confidence: 0.2 })
    );
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Software & Engineering").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/we recommend/)).not.toBeInTheDocument();
  });

  it("hides recommended model when domain is General", async () => {
    vi.mocked(invoke).mockResolvedValue(
      mockDomainProfile({ primary_domain: "General", confidence: 0.8 })
    );
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getAllByText("General").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText(/we recommend/)).not.toBeInTheDocument();
  });

  it("renders domain distribution bars", async () => {
    vi.mocked(invoke).mockResolvedValue(mockDomainProfile());
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      // Names appear in multiple places (primary, distribution, recommendation text)
      expect(screen.getAllByText("Software & Engineering").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Science & Math").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("General").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows correct recommended model per domain", async () => {
    // Test Medical domain
    vi.mocked(invoke).mockResolvedValue(
      mockDomainProfile({ primary_domain: "Medical", domain_counts: { Medical: 20 } })
    );
    await act(async () => {
      render(<DomainInsights />);
    });
    await waitFor(() => {
      expect(screen.getByText("qwen3:14b")).toBeInTheDocument();
    });
  });

  it("handles invoke error gracefully (shows empty state)", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("DB error"));
    await act(async () => {
      render(<DomainInsights />);
    });
    // On error, profile stays null, and null profile renders nothing (returns null)
    // Wait for loading to finish
    await waitFor(() => {
      // profile is null after error, and !profile is true, but total_queries check:
      // the component returns null when loading, and shows empty state when !profile
      // Actually: if(!profile || profile.total_queries < 5) shows the Domain Expertise card
      // But if profile is null, we still get the card. Let's just check it renders safely.
      expect(screen.queryByText(/Keep asking questions/)).toBeInTheDocument();
    });
  });
});
