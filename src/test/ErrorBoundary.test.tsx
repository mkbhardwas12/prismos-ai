// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — ErrorBoundary Tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../components/ErrorBoundary";

// Component that throws on render
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test render crash");
  return <div data-testid="child">Child rendered OK</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress React error boundary console.error noise
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Child rendered OK")).toBeInTheDocument();
  });

  it("catches rendering errors and shows fallback UI", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows the fallbackView name in the error message", () => {
    render(
      <ErrorBoundary fallbackView="Settings">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(
      screen.getByText("The Settings view encountered an error.")
    ).toBeInTheDocument();
  });

  it("shows error details in a disclosure", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    // The details element should contain the error message
    const details = screen.getByText("Error details");
    expect(details).toBeInTheDocument();
    expect(screen.getByText("Test render crash")).toBeInTheDocument();
  });

  it("'Try Again' button is present and clickable", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );

    const tryAgainBtn = screen.getByText("Try Again");
    expect(tryAgainBtn).toBeInTheDocument();
    expect(tryAgainBtn.tagName).toBe("BUTTON");
    // Clicking should not itself throw
    expect(() => fireEvent.click(tryAgainBtn)).not.toThrow();
  });

  it("has a Reload App button", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText("Reload App")).toBeInTheDocument();
  });
});
