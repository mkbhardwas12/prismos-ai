// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS Test Setup — Vitest + JSDOM + Testing Library

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock Tauri's invoke API so tests don't need a running Tauri backend
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("{}"),
}));

// Mock Tauri path API
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
}));

// Mock window.__TAURI_INTERNALS__ for Tauri v2
Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: vi.fn().mockResolvedValue("{}"),
    metadata: { currentWebview: { label: "main" } },
  },
  writable: true,
});
