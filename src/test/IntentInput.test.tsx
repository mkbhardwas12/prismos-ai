// PrismOS-AI — IntentInput Component Tests

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntentInput from "../components/IntentInput";
import { invoke } from "@tauri-apps/api/core";
import { waitFor } from "@testing-library/react";

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

  it("transcribes a dropped recording offline and submits the transcript as the attached document", async () => {
    const onSubmit = vi.fn();
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (cmd === "audio_sidecar_status") return JSON.stringify({ ready: true, cli_path: "/opt/homebrew/bin/whisper-cli", ffmpeg_path: null, model_path: "/m/ggml-base.en.bin", models_dir: "/m", install_hint: "" });
      if (cmd === "transcribe_audio_bytes") {
        expect((args as { fileName: string; data: string }).fileName).toBe("standup.m4a");
        expect((args as { data: string }).data).toBe(btoa("fake-audio"));
        return JSON.stringify({ text: "We ship Friday. Ana owns the release notes.", language: "auto", duration_ms: 900, engine: "whisper.cpp (local sidecar)", audio_seconds: 61.4 });
      }
      return "{}";
    });
    const { container } = render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const file = new File(["fake-audio"], "standup.m4a", { type: "audio/mp4" });
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [file], types: ["Files"] } });
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("Summarize this recording: key points, decisions, and action items."));
    await waitFor(() => expect(screen.getByText(/Transcript · 61s/)).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [prompt, image, doc] = onSubmit.mock.calls[0];
    expect(prompt).toContain("Summarize this recording");
    expect(image).toBeUndefined();
    expect(doc).toBe("[Audio: standup.m4a | 61s | transcribed offline by whisper.cpp (local sidecar)]\n\nWe ship Friday. Ana owns the release notes.");
  });

  it("tells the user how to install the transcriber instead of failing silently", async () => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "audio_sidecar_status") return JSON.stringify({ ready: false, cli_path: null, ffmpeg_path: null, model_path: null, models_dir: "/m", install_hint: "Install whisper.cpp (macOS: `brew install whisper-cpp`)." });
      throw new Error(`unexpected ${cmd}`);
    });
    const { container } = render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [new File(["x"], "memo.wav")], types: ["Files"] } });
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("whisper.cpp is not installed"));
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "transcribe_audio_bytes")).toBe(false);
  });

  it("attaches several dropped documents as separate sources and submits them together", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const a = new File(["Alpha notes"], "a.md", { type: "text/markdown" });
    const b = new File(["Beta notes"], "b.log", { type: "text/plain" });
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [a, b], types: ["Files"] } });
    await waitFor(() => expect(screen.getByText(/2 sources · the answer cites the passages it uses/)).toBeInTheDocument());
    expect(screen.getByRole("textbox")).toHaveValue("Compare these sources: where do they agree and where do they differ?");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith(
      "Compare these sources: where do they agree and where do they differ?",
      undefined,
      "[File: a.md]\nAlpha notes\n\n[File: b.log]\nBeta notes",
    );
  });

  it("removes one source and keeps the rest", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    const files = [new File(["One"], "one.txt"), new File(["Two"], "two.txt"), new File(["Three"], "three.txt")];
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files, types: ["Files"] } });
    await waitFor(() => expect(screen.getByText(/3 sources/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remove two.txt" }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "What differs?{enter}");
    expect(onSubmit).toHaveBeenCalledWith("What differs?", undefined, "[File: one.txt]\nOne\n\n[File: three.txt]\nThree");
  });

  it("lets the picker choose several files, including logs and SAP profiles", () => {
    const { container } = render(<IntentInput onSubmit={vi.fn()} isProcessing={false} />);
    const picker = container.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    expect(picker.accept).toContain(".log");
    expect(picker.accept).toContain(".pfl");
    expect(picker.accept).toContain(".ini");
  });

  it("waits for every file to finish before sending", async () => {
    const onSubmit = vi.fn();
    let finish: (value: string) => void = () => {};
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "audio_sidecar_status") return JSON.stringify({ ready: true, cli_path: "/w", ffmpeg_path: null, model_path: "/m", models_dir: "/m", install_hint: "" });
      if (cmd === "transcribe_audio_bytes") return new Promise<string>((resolve) => { finish = resolve; });
      return "{}";
    });
    const { container } = render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [new File(["notes"], "notes.md"), new File(["x"], "call.m4a")], types: ["Files"] } });
    await waitFor(() => expect(screen.getByText(/Transcribing locally/)).toBeInTheDocument());
    await userEvent.type(screen.getByRole("textbox"), "{enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /send intent/i })).toBeDisabled();
    finish(JSON.stringify({ text: "We agreed.", engine: "whisper.cpp", audio_seconds: 5 }));
    await waitFor(() => expect(screen.getByText(/2 sources/)).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][2]).toContain("[Audio: call.m4a | 5s | transcribed offline by whisper.cpp]");
  });

  it("cleans brackets out of file names so sources stay separate", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<IntentInput onSubmit={onSubmit} isProcessing={false} />);
    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [new File(["Plan"], "plan.md"), new File(["Budget"], "budget [final].md")], types: ["Files"] } });
    await waitFor(() => expect(screen.getByText(/2 sources/)).toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit.mock.calls[0][2]).toBe("[File: plan.md]\nPlan\n\n[File: budget final .md]\nBudget");
  });
});
