// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Test Setup — Vitest + JSDOM + Testing Library

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock Tauri's invoke API so tests don't need a running Tauri backend
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("{}"),
}));

// Mock Tauri window API (used by TitleBar + App)
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
  })),
}));

// Mock Tauri path API
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
}));

// Mock Tauri event API (listen / emit)
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri shell plugin
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

// Mock window.__TAURI_INTERNALS__ for Tauri v2
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: vi.fn().mockResolvedValue("{}"),
    transformCallback: vi.fn(() => 0),
    metadata: { currentWebview: { label: "main" } },
  },
  writable: true,
});

// Mock ResizeObserver (not available in jsdom)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}
