// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI — IntentInput Component Tests

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntentInput from "../components/IntentInput";

describe("IntentInput", () => {
  it("renders the input textarea", () => {
    render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    expect(screen.getByPlaceholderText(/ask|type|intent/i)).toBeInTheDocument();
  });

  it("calls onSubmit when user types and presses Enter", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "What is PrismOS-AI?{enter}");
    expect(onSubmit).toHaveBeenCalledWith("What is PrismOS-AI?", undefined, undefined);
  });

  it("does NOT submit when processing is in progress", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={true} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "test{enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does NOT submit empty input", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears input after successful submit", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "Hello{enter}");
    expect(textarea.value).toBe("");
  });

  it("fills input from pendingIntent prop", () => {
    const onConsumed = vi.fn();
    render(
      <IntentInput
        onSubmit={vi.fn()}
        isProcessing={false}
        pendingIntent="Suggested intent"
        onPendingConsumed={onConsumed}
      />
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Suggested intent");
    expect(onConsumed).toHaveBeenCalled();
  });

  it("shows send button", () => {
    render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    const sendBtn = screen.getByRole("button", { name: /send intent/i });
    expect(sendBtn).toBeInTheDocument();
  });
});
