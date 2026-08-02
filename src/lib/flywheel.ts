// flywheel — typed frontend access to synthetic MLX/Ollama smoke validation.
//
// Full training on personal response history is disabled. Smoke mode creates
// generic examples in a temporary private workspace and promotes nothing.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface FlywheelStatus {
  scripts_dir: string | null;
  mlx_available: boolean;
  smoke_ready: boolean;
  full_training_enabled: false;
  run_in_progress: boolean;
  offline_note: string;
  summary: string;
}

export interface FlywheelRunStarted {
  started: boolean;
  mode: string;
  scripts_dir: string;
  message: string;
}

export type FlywheelMode = "smoke";

export interface FlywheelLogEvent {
  stream: "stdout" | "stderr";
  line: string;
}

export interface FlywheelDoneEvent {
  exit_code: number;
  success: boolean;
}

/** Read-only: can the synthetic training-toolchain smoke test run now? */
export function flywheelStatus(): Promise<FlywheelStatus> {
  return invoke<FlywheelStatus>("flywheel_status");
}

/**
 * Launch one explicit synthetic smoke run. The optional arguments remain only
 * for command-shape compatibility and must be omitted; full mode is unavailable.
 * Resolves as soon as the process starts — subscribe with `onFlywheelLog` /
 * `onFlywheelDone` for progress.
 */
export function runFlywheel(
  mode: FlywheelMode,
  opts?: { base?: string; evalBase?: string; judge?: string; exact?: boolean },
): Promise<FlywheelRunStarted> {
  return invoke<FlywheelRunStarted>("run_flywheel", {
    mode,
    base: opts?.base ?? null,
    evalBase: opts?.evalBase ?? null,
    judge: opts?.judge ?? null,
    exact: opts?.exact ?? null,
  });
}

/** Subscribe to streamed training log lines. Returns an unlisten function. */
export function onFlywheelLog(cb: (e: FlywheelLogEvent) => void): Promise<UnlistenFn> {
  return listen<FlywheelLogEvent>("flywheel-log", (evt) => cb(evt.payload));
}

/** Subscribe to the terminal event for a round. Returns an unlisten function. */
export function onFlywheelDone(cb: (e: FlywheelDoneEvent) => void): Promise<UnlistenFn> {
  return listen<FlywheelDoneEvent>("flywheel-done", (evt) => cb(evt.payload));
}
