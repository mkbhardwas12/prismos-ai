//! Local MLX/Ollama toolchain smoke validation.
//!
//! The app launches only a synthetic-data smoke run after explicit user action.
//! Personal feedback harvesting and full training remain disabled until dataset
//! consent/review, secret and PII handling, private output selection, and an
//! OS-level cross-process lock exist. Nothing promotes a model automatically.

use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// A single process-local flywheel run may exist at a time. This is intentionally
/// not a queue: every round must result from a separate, explicit invocation.
static FLYWHEEL_RUNNING: AtomicBool = AtomicBool::new(false);

struct FlywheelRunReservation;

impl FlywheelRunReservation {
    fn acquire() -> Result<Self, String> {
        FLYWHEEL_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| {
                "A flywheel round is already running. Wait for the flywheel-done event before explicitly starting another round."
                    .to_string()
            })
    }
}

impl Drop for FlywheelRunReservation {
    fn drop(&mut self) {
        FLYWHEEL_RUNNING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FlywheelMode {
    Smoke,
    Full,
}

impl FlywheelMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "smoke" => Ok(Self::Smoke),
            "full" => Ok(Self::Full),
            _ => Err("Unknown flywheel mode (use exactly 'smoke' or 'full').".to_string()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Smoke => "smoke",
            Self::Full => "full",
        }
    }
}

/// Parse and validate every user-controlled process argument before a script is
/// located or a child process is launched.
fn build_run_args(
    mode: &str,
    base: Option<String>,
    eval_base: Option<String>,
    judge: Option<String>,
    exact: Option<bool>,
) -> Result<(FlywheelMode, Vec<String>), String> {
    let mode = FlywheelMode::parse(mode)?;

    match mode {
        FlywheelMode::Smoke => {
            if base.is_some() || eval_base.is_some() || judge.is_some() || exact == Some(true) {
                return Err(
                    "Smoke mode does not accept base, evaluation-base, judge, or exact-mode arguments."
                        .to_string(),
                );
            }
            Ok((mode, vec!["--smoke".to_string()]))
        }
        FlywheelMode::Full => Err(
            "Full personal-data training is disabled until PrismOS ships explicit dataset preview/consent, secret and PII review, a private output destination, and an OS-level cross-process lock. Use smoke mode for synthetic toolchain validation."
                .to_string(),
        ),
    }
}

/// The only accepted flywheel directory is the source tree used to compile this
/// binary. Never search the process current directory: a project opened from an
/// untrusted folder must not be able to supply an executable training script.
fn compiled_scripts_dir() -> Option<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest.parent().map(|repo| repo.join("scripts/flywheel"))
}

const TRUSTED_FLYWHEEL_SOURCES: &[(&str, &[u8])] = &[
    (
        "run_flywheel.sh",
        include_bytes!("../../scripts/flywheel/run_flywheel.sh"),
    ),
    (
        "harvest.py",
        include_bytes!("../../scripts/flywheel/harvest.py"),
    ),
    (
        "train_lora.py",
        include_bytes!("../../scripts/flywheel/train_lora.py"),
    ),
    (
        "eval_gate.py",
        include_bytes!("../../scripts/flywheel/eval_gate.py"),
    ),
];

fn verify_script_bundle(dir: &Path) -> Result<(), String> {
    for (name, expected) in TRUSTED_FLYWHEEL_SOURCES {
        let path = dir.join(name);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Trusted flywheel source '{name}' is unavailable: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Trusted flywheel source '{name}' must be a regular non-symlink file."
            ));
        }
        if metadata.len() != expected.len() as u64 {
            return Err(format!(
                "Flywheel source '{name}' changed after PrismOS was compiled; rebuild from the reviewed source tree before running it."
            ));
        }
        let actual = std::fs::read(&path)
            .map_err(|error| format!("Failed to verify flywheel source '{name}': {error}"))?;
        if actual.as_slice() != *expected {
            return Err(format!(
                "Flywheel source '{name}' changed after PrismOS was compiled; rebuild from the reviewed source tree before running it."
            ));
        }
    }
    Ok(())
}

/// Locate the flywheel scripts directory, if present.
pub fn find_scripts_dir() -> Option<PathBuf> {
    compiled_scripts_dir().filter(|dir| verify_script_bundle(dir).is_ok())
}

/// Read-only assessment of synthetic smoke-test readiness.
#[derive(Debug, Clone, Serialize)]
pub struct FlywheelStatus {
    /// Path to `scripts/flywheel`, or None when running without the source tree.
    pub scripts_dir: Option<String>,
    /// Does the expected Python launcher exist in the flywheel venv? This is a
    /// lightweight presence check, not proof that every MLX import will work.
    pub mlx_available: bool,
    /// Do the visible synthetic-smoke prerequisites appear present?
    pub smoke_ready: bool,
    /// Full personal-data training is intentionally unavailable.
    pub full_training_enabled: bool,
    /// Whether this PrismOS process already owns an active flywheel child.
    pub run_in_progress: bool,
    /// The honest offline caveat about base-weight acquisition.
    pub offline_note: String,
    /// One-line, human-readable guidance.
    pub summary: String,
}

/// Lightweight check that the flywheel venv exists (a full `import mlx_lm` check
/// runs at launch time, not on every status poll).
fn mlx_venv_present(dir: &Path) -> bool {
    dir.join(".venv/bin/python3").exists() || dir.join(".venv/bin/python").exists()
}

/// Assess synthetic smoke readiness. This never reads the personal graph DB.
pub fn status(_app_dir: &Path) -> FlywheelStatus {
    let scripts_dir = find_scripts_dir();
    let mlx_available = scripts_dir
        .as_deref()
        .map(mlx_venv_present)
        .unwrap_or(false);
    let run_in_progress = FLYWHEEL_RUNNING.load(Ordering::Acquire);
    let smoke_ready = scripts_dir.is_some() && mlx_available && !run_in_progress;

    let summary = if run_in_progress {
        "A user-started synthetic smoke run is active. Wait for completion before starting another."
            .to_string()
    } else if scripts_dir.is_none() {
        "Synthetic smoke scripts were not found; this build cannot validate the training toolchain."
            .to_string()
    } else if !mlx_available {
        "The expected scripts/flywheel/.venv Python launcher was not found. Install and verify MLX before starting a synthetic smoke run.".to_string()
    } else {
        "Synthetic smoke prerequisites are visible. The run uses generic temporary examples only; full personal-data training remains disabled."
            .to_string()
    };

    FlywheelStatus {
        scripts_dir: scripts_dir.map(|p| p.display().to_string()),
        mlx_available,
        smoke_ready,
        full_training_enabled: false,
        run_in_progress,
        offline_note: "Synthetic data preparation, smoke training, and disposable packaging run on-device. \
                       The tiny smoke base may be downloaded from Hugging Face on first use \
                       unless already cached. No personal feedback is read and no Ollama model is registered."
            .to_string(),
        summary,
    }
}

/// Returned immediately when a round is launched (the round itself streams
/// progress via `flywheel-log` events and finishes with `flywheel-done`).
#[derive(Debug, Clone, Serialize)]
pub struct FlywheelRunStarted {
    pub started: bool,
    pub mode: String,
    pub scripts_dir: String,
    pub message: String,
}

/// A single streamed line from the running flywheel script.
#[derive(Debug, Clone, Serialize)]
struct FlywheelLog {
    stream: String, // "stdout" | "stderr"
    line: String,
}

/// Terminal event for a flywheel round.
#[derive(Debug, Clone, Serialize)]
struct FlywheelDone {
    /// Child exit status only. A zero exit does not prove that the evaluation
    /// passed and never means that PrismOS promoted a model.
    exit_code: i32,
    success: bool,
    process_completed: bool,
    message: String,
}

/// Launch one synthetic smoke run. Returns as soon as the process starts;
/// progress arrives via `flywheel-log` events and completion via `flywheel-done`.
///
/// `mode`:
///   * `"smoke"` — validate the toolchain on generic temporary examples.
///   * `"full"` — rejected before any process is spawned.
pub fn run(
    app: tauri::AppHandle,
    mode: &str,
    base: Option<String>,
    eval_base: Option<String>,
    judge: Option<String>,
    exact: Option<bool>,
) -> Result<FlywheelRunStarted, String> {
    let (mode, args) = build_run_args(mode, base, eval_base, judge, exact)?;
    let dir = compiled_scripts_dir().ok_or_else(|| {
        "The compile-time flywheel source directory could not be resolved.".to_string()
    })?;
    verify_script_bundle(&dir)?;
    let reservation = FlywheelRunReservation::acquire()?;

    let mut command = Command::new("/bin/bash");
    command
        .arg("run_flywheel.sh")
        .args(&args)
        .current_dir(&dir)
        // The Ollama CLI is used to register the candidate model. Pin it to a
        // numeric loopback origin so inherited OLLAMA_HOST cannot upload private
        // fine-tuned weights to a remote daemon. Proxy bypass is scoped to
        // loopback; base-weight downloads may still use the operator's proxy.
        .env("OLLAMA_HOST", "http://127.0.0.1:11434")
        .env("NO_PROXY", "localhost,127.0.0.1,::1")
        .env("no_proxy", "localhost,127.0.0.1,::1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to launch flywheel: {e}. Is bash available?"))?;

    // Stream stdout and stderr as events so the UI shows live progress.
    if let Some(out) = child.stdout.take() {
        let app_out = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = app_out.emit(
                    "flywheel-log",
                    FlywheelLog {
                        stream: "stdout".into(),
                        line,
                    },
                );
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let app_err = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                let _ = app_err.emit(
                    "flywheel-log",
                    FlywheelLog {
                        stream: "stderr".into(),
                        line,
                    },
                );
            }
        });
    }

    // Reap the child and announce completion.
    let app_done = app.clone();
    std::thread::spawn(move || {
        let done = match child.wait() {
            Ok(status) => {
                let success = status.success();
                FlywheelDone {
                    exit_code: status.code().unwrap_or(-1),
                    success,
                    process_completed: true,
                    message: if success {
                        "Synthetic smoke process exited successfully. This validates only the toolchain path; it does not establish model quality, and no model was promoted."
                            .to_string()
                    } else {
                        "Synthetic smoke process exited with an error. No personal feedback was read and no model was promoted; review the logs before retrying."
                            .to_string()
                    },
                }
            }
            Err(error) => FlywheelDone {
                exit_code: -1,
                success: false,
                process_completed: false,
                message: format!(
                    "PrismOS could not read the flywheel process result: {error}. No model was promoted automatically."
                ),
            },
        };
        // Release only after the child has terminated. Event delivery can fail
        // if the window has closed, but it must not leave the process locked.
        drop(reservation);
        let _ = app_done.emit("flywheel-done", done);
    });

    Ok(FlywheelRunStarted {
        started: true,
        mode: mode.as_str().to_string(),
        scripts_dir: dir.display().to_string(),
        message: "One user-requested flywheel process started. Watch flywheel-log and \
                  flywheel-done events. Process success is not an eval result, and \
                  this synthetic smoke run never reads personal feedback or promotes a model."
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_safe_without_db_or_scripts() {
        let tmp = std::env::temp_dir().join("prismos_flywheel_test_nonexistent");
        let s = status(&tmp);
        assert!(!s.full_training_enabled);
        assert_eq!(s.smoke_ready, s.scripts_dir.is_some() && s.mlx_available);
        assert!(!s.offline_note.is_empty());
        assert!(!s.summary.is_empty());
    }

    #[test]
    fn accepts_only_explicit_modes_and_expected_arguments() {
        let (mode, smoke_args) = build_run_args("smoke", None, None, None, None).unwrap();
        assert_eq!(mode, FlywheelMode::Smoke);
        assert_eq!(smoke_args, ["--smoke"]);

        let full_error = build_run_args(
            "full",
            Some("mlx-community/Qwen3-30B-A3B-Thinking-2507-4bit".to_string()),
            Some("qwen3:30b-a3b".to_string()),
            Some("qwen3:32b".to_string()),
            None,
        )
        .expect_err("full mode must fail before process launch");
        assert!(full_error.contains("disabled"));

        assert!(build_run_args("FULL", None, None, None, None).is_err());
        assert!(build_run_args(" full", None, None, None, None).is_err());
        assert!(build_run_args("smoke", Some("model".to_string()), None, None, None).is_err());
        assert!(build_run_args("smoke", None, None, Some("judge".to_string()), None).is_err());
        assert!(build_run_args("full", None, None, None, None).is_err());
    }

    #[test]
    fn process_local_reservation_rejects_overlap_and_releases_on_drop() {
        // Avoid poisoning other tests if an earlier assertion fails.
        FLYWHEEL_RUNNING.store(false, Ordering::Release);
        let first = FlywheelRunReservation::acquire().unwrap();
        assert!(FLYWHEEL_RUNNING.load(Ordering::Acquire));
        assert!(FlywheelRunReservation::acquire().is_err());
        drop(first);
        assert!(!FLYWHEEL_RUNNING.load(Ordering::Acquire));

        let next = FlywheelRunReservation::acquire().unwrap();
        drop(next);
    }

    #[test]
    fn only_the_compile_time_reviewed_script_bundle_is_accepted() {
        let trusted = compiled_scripts_dir().expect("compile-time scripts dir");
        verify_script_bundle(&trusted).expect("checked-in sources match embedded bytes");

        let untrusted = tempfile::tempdir().unwrap();
        for (name, expected) in TRUSTED_FLYWHEEL_SOURCES {
            std::fs::write(untrusted.path().join(name), expected).unwrap();
        }
        std::fs::write(
            untrusted.path().join("run_flywheel.sh"),
            b"#!/bin/sh\necho attacker\n",
        )
        .unwrap();
        assert!(verify_script_bundle(untrusted.path()).is_err());
    }
}
