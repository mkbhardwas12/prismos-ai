// PrismOS-AI — MainView Component Tests (FTW removed, transparency toggle)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MainView from "../components/MainView";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

const useChatMock = vi.hoisted(() => vi.fn());
const useOllamaMock = vi.hoisted(() => vi.fn());

// Mock all child components to isolate MainView logic
vi.mock("../components/IntentInput", () => ({
  default: vi.fn(() => <div data-testid="intent-input" />),
}));
vi.mock("../components/DailyBrief", () => ({
  default: vi.fn(() => <div data-testid="daily-brief" />),
}));
vi.mock("../components/UserGuide", () => ({
  default: vi.fn(() => null),
}));
vi.mock("../components/SuggestionCard", () => ({
  default: vi.fn(() => null),
}));
vi.mock("../hooks/useVoice", () => ({
  useVoice: () => ({ speak: vi.fn(), stop: vi.fn() }),
}));
vi.mock("../hooks/useChat", () => ({
  useChat: useChatMock,
}));
vi.mock("../hooks/useSuggestions", () => ({
  useSuggestions: () => ({
    suggestions: [],
    messageSuggestions: {},
    proactiveSuggestions: [],
    refreshSuggestions: vi.fn(),
  }),
}));
vi.mock("../hooks/useOllama", () => ({
  useOllama: useOllamaMock,
  RECOMMENDED_MODELS: [],
}));
vi.mock("framer-motion", () => ({
  motion: {
    div: vi.fn(({
      children,
      layout: _layout,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: any) => <div {...props}>{children}</div>),
  },
  AnimatePresence: vi.fn(({ children }: any) => <>{children}</>),
}));

const defaultSettings: AppSettings = {
  ollamaUrl: "http://localhost:11434",
  defaultModel: "qwen3:4b",
  theme: "dark",
  maxTokens: 2048,
  voiceInputEnabled: false,
  voiceOutputEnabled: false,
  emailSummaryEnabled: false,
  calendarEnabled: false,
  financeEnabled: false,
  defaultView: "chat",
};

const defaultProps = {
  ollamaConnected: true,
  settings: defaultSettings,
  onSettingsChange: vi.fn(),
  onIntentProcessed: vi.fn(),
  liveAgentSteps: [],
  clearLiveSteps: vi.fn(),
  startupSuggestions: [],
  dailyGreeting: "Good morning!",
};

describe("MainView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(invoke).mockImplementation(async () => "{}");
    useOllamaMock.mockReturnValue({
      availableModels: [],
      modelDropdownOpen: false,
      modelDropdownRef: { current: null },
      wizardExpanded: false,
      pullingModel: null,
      pullProgress: "",
      pullPercent: 0,
      setModelDropdownOpen: vi.fn(),
      setWizardExpanded: vi.fn(),
      selectModel: vi.fn(),
      pullModelFromDropdown: vi.fn(),
      getSetupStep: () => "ready",
    });
    useChatMock.mockReturnValue({
      messages: [
        {
          id: "msg1",
          role: "ai",
          content: "Hello world",
          timestamp: new Date(),
          transparency: {
            query_type: "general",
            applied_band: "green",
            context_nodes_used: 3,
            model_used: "qwen3:4b",
            domain_detected: "Engineering",
          },
        },
      ],
      isProcessing: false,
      processingPhase: "",
      processingElapsed: 0,
      handleIntent: vi.fn(),
      clearConversation: vi.fn(),
      conversationRef: { current: null },
    });
  });

  it("offline badge retries the connection when clicked", async () => {
    const onRetryConnection = vi.fn();
    await act(async () => {
      render(<MainView {...defaultProps} ollamaConnected={false} onRetryConnection={onRetryConnection} />);
    });
    expect(screen.getByText(/Ollama Offline/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText(/Ollama Offline/));
    });
    expect(onRetryConnection).toHaveBeenCalledTimes(1);
  });

  it("connected badge does not trigger a connection retry", async () => {
    const onRetryConnection = vi.fn();
    await act(async () => {
      render(<MainView {...defaultProps} onRetryConnection={onRetryConnection} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText(/qwen3:4b/));
    });
    // Connected → click is the model-dropdown toggle (mocked hook), never a retry
    expect(onRetryConnection).not.toHaveBeenCalled();
  });

  it("does NOT render first-time-wizard modal", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    // showFirstTimeWizard removed — no FTW modal should be rendered
    expect(screen.queryByText("Welcome to PrismOS-AI")).not.toBeInTheDocument();
    expect(screen.queryByText(/First Time Wizard/i)).not.toBeInTheDocument();
  });

  it("renders transparency toggle button for AI messages", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    expect(screen.getByText(/Why this response/)).toBeInTheDocument();
  });

  it("expands transparency details on toggle click", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    const toggleBtn = screen.getByText(/Why this response/);
    fireEvent.click(toggleBtn);
    // After clicking, the transparency bar should expand showing chips
    expect(screen.getByText(/general/)).toBeInTheDocument(); // query_type
    expect(screen.getByText(/green/)).toBeInTheDocument(); // applied_band
    expect(screen.getByText(/3 nodes/)).toBeInTheDocument(); // context_nodes_used
    expect(screen.getAllByText(/qwen3:4b/).length).toBeGreaterThanOrEqual(2); // model in header + transparency chip
    expect(screen.getByText(/Engineering/)).toBeInTheDocument(); // domain_detected
  });

  it("collapses transparency on second click", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    const toggleBtn = screen.getByText(/Why this response/);
    fireEvent.click(toggleBtn);
    expect(screen.getByText(/general/)).toBeInTheDocument();
    fireEvent.click(toggleBtn);
    // After second click, detailed chips should be hidden
    expect(screen.queryByText(/3 nodes/)).not.toBeInTheDocument();
  });

  it("renders Intent Console header", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    expect(screen.getByText(/Intent Console/)).toBeInTheDocument();
  });

  it("makes Live knowledge an explicit persistent consent control", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });

    const control = screen.getByRole("button", { name: /Local knowledge/i });
    expect(control).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(control);
    expect(screen.getByRole("button", { name: /Live knowledge/i })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("prismos-auto-research")).toBe("true");
  });

  it("offers already-installed modern models without downloading them", async () => {
    const selectModel = vi.fn();
    useOllamaMock.mockReturnValue({
      availableModels: [
        { name: "mistral:latest", size: 4_400_000_000 },
        { name: "qwen3:4b", size: 2_500_000_000 },
        { name: "qwen3:30b-a3b", size: 19_000_000_000 },
      ],
      modelDropdownOpen: false,
      modelDropdownRef: { current: null },
      wizardExpanded: false,
      pullingModel: null,
      pullProgress: "",
      pullPercent: 0,
      setModelDropdownOpen: vi.fn(),
      setWizardExpanded: vi.fn(),
      selectModel,
      pullModelFromDropdown: vi.fn(),
      getSetupStep: () => "ready",
    });

    await act(async () => {
      render(
        <MainView
          {...defaultProps}
          settings={{ ...defaultSettings, defaultModel: "mistral:latest" }}
        />,
      );
    });

    expect(screen.getByText(/Newer installed model ready/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /qwen3:30b-a3b.*deep/i }));
    expect(selectModel).toHaveBeenCalledWith("qwen3:30b-a3b");
  });

  it("renders DailyBrief component", async () => {
    await act(async () => {
      render(<MainView {...defaultProps} />);
    });
    expect(screen.getByTestId("daily-brief")).toBeInTheDocument();
  });

  it("shows one updating activity row per workflow role while processing", async () => {
    useChatMock.mockReturnValue({
      messages: [],
      isProcessing: true,
      processingPhase: "Refracting your intent…",
      processingElapsed: 12,
      handleIntent: vi.fn(),
      clearConversation: vi.fn(),
      conversationRef: { current: null },
    });

    await act(async () => {
      render(
        <MainView
          {...defaultProps}
          liveAgentSteps={[
            {
              schema_version: 1,
              task_id: "task-1",
              agent: "Orchestrator",
              action: "Decomposing request…",
              status: "thinking",
              phase: "orchestrate",
              iteration: 0,
              elapsed_ms: 100,
            },
            {
              schema_version: 1,
              task_id: "task-1",
              agent: "Orchestrator",
              action: "Workflow stages prepared",
              status: "completed",
              phase: "orchestrate",
              iteration: 0,
              elapsed_ms: 850,
            },
            {
              schema_version: 1,
              task_id: "task-1",
              agent: "Reasoner",
              action: "Drafting the answer…",
              status: "thinking",
              phase: "build",
              iteration: 1,
              elapsed_ms: 1_200,
            },
          ]}
        />,
      );
    });

    expect(screen.getAllByText("Orchestrator")).toHaveLength(1);
    expect(screen.getByText("Workflow stages prepared")).toBeInTheDocument();
    expect(screen.queryByText("Decomposing request…")).not.toBeInTheDocument();
    expect(screen.getByText("Reasoner")).toBeInTheDocument();
    expect(screen.getByText("Drafting the answer…")).toBeInTheDocument();
    expect(screen.getByText("1 working · 1 done")).toBeInTheDocument();
  });

  it("keeps the completed decision trace inspectable until it is dismissed or a new task starts", async () => {
    useChatMock.mockReturnValue({
      messages: [{ id: "done", role: "ai", content: "Finished", timestamp: new Date() }],
      isProcessing: false,
      processingPhase: "",
      processingElapsed: 0,
      handleIntent: vi.fn(),
      clearConversation: vi.fn(),
      conversationRef: { current: null },
    });

    await act(async () => {
      render(
        <MainView
          {...defaultProps}
          liveAgentSteps={[
            {
              schema_version: 1,
              task_id: "task-finished",
              agent: "Sandbox Prism",
              action: "Workflow complete — response finalized",
              status: "completed",
              phase: "execute",
              iteration: 0,
              elapsed_ms: 2_500,
              decision: {
                kind: "finalization",
                approved: true,
                validated: true,
                attempts_used: 2,
                max_attempts: 3,
              },
            },
          ]}
        />,
      );
    });

    expect(screen.getByText("Decision trace ready")).toBeInTheDocument();
    expect(screen.getByText("Trace complete · 1 role")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss decision trace" })).toBeInTheDocument();
  });
});
