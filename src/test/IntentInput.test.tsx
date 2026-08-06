// PrismOS-AI — IntentInput Component Tests

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntentInput, { isSensitiveAttachmentName } from "../components/IntentInput";

describe("IntentInput", () => {
  it("renders the input textarea", () => {
    render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    expect(screen.getByPlaceholderText(/ask|type|intent/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/local loopback route/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/process it privately/i)).not.toBeInTheDocument();
  });

  it("calls onSubmit when user types and presses Enter", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const textarea = screen.getByRole("textbox");
    await userEvent.type(textarea, "What is PrismOS-AI?{enter}");
    expect(onSubmit).toHaveBeenCalledWith("What is PrismOS-AI?", undefined, undefined);
  });

  it("lets the user draft but does not submit while processing is in progress", async () => {
    const onSubmit = vi.fn();
    render(<IntentInput onSubmit={onSubmit} isProcessing={true} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await userEvent.type(textarea, "test{enter}");
    expect(textarea.value).toBe("test");
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

  it("excludes environment files from attachment selection and detects secret filenames", () => {
    const { container } = render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    const documentInput = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".docx"]');

    expect(documentInput?.accept.split(",")).not.toContain(".env");
    expect(documentInput?.accept.split(",")).not.toContain(".pdf");
    expect(documentInput?.accept.split(",")).not.toContain(".xls");
    expect(documentInput?.accept.split(",")).not.toContain(".xlsx");
    expect(isSensitiveAttachmentName(".env")).toBe(true);
    expect(isSensitiveAttachmentName(".env.production")).toBe(true);
    expect(isSensitiveAttachmentName("credentials.json")).toBe(true);
    expect(isSensitiveAttachmentName("id_ed25519")).toBe(true);
    expect(isSensitiveAttachmentName("private.pem")).toBe(true);
    expect(isSensitiveAttachmentName("meeting-notes.md")).toBe(false);
  });
});
