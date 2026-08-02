//! In-app driver for the standalone Research Bridge sidecar (the DMZ egress).
//!
//! PrismOS's core still never egresses. This module only *spawns the isolated
//! bridge process on demand* — and ONLY when the caller passes explicit consent
//! (`allow_egress = true`); otherwise the bridge refuses and nothing leaves the
//! machine. It then reads the bridge's local receipts so the UI can OBSERVE what
//! was fetched. On-demand only: nothing runs in the background.

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

const MAX_URLS: usize = 12;
const RUN_TIMEOUT: Duration = Duration::from_secs(150);

/// Locate `scripts/research_bridge/bridge.py` in a source checkout.
fn bridge_script() -> Option<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut cands = Vec::new();
    if let Some(repo) = manifest.parent() {
        cands.push(repo.join("scripts/research_bridge/bridge.py"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        cands.push(cwd.join("scripts/research_bridge/bridge.py"));
        if let Some(p) = cwd.parent() {
            cands.push(p.join("scripts/research_bridge/bridge.py"));
        }
    }
    cands.into_iter().find(|p| p.exists())
}

fn research_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Documents/PrismDocs/research")
}

/// Outcome of one research run (returned to the UI to observe).
#[derive(Debug, Clone, Serialize)]
pub struct ResearchRun {
    pub requested: usize,
    /// Receipts present after the run (newest first) — the observable record.
    pub receipts: Vec<Value>,
    /// Combined stdout+stderr of the bridge, for transparency.
    pub log: String,
    /// Whether the caller consented to egress this run.
    pub egress_consented: bool,
}

fn read_receipts(dir: &Path) -> Vec<Value> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.to_string_lossy().ends_with(".receipt.json") {
                if let Ok(s) = std::fs::read_to_string(&p) {
                    if let Ok(v) = serde_json::from_str::<Value>(&s) {
                        out.push(v);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| {
        let ka = b.get("fetched_at").and_then(|x| x.as_str()).unwrap_or("");
        let kb = a.get("fetched_at").and_then(|x| x.as_str()).unwrap_or("");
        ka.cmp(kb)
    });
    out
}

/// Read the receipts on disk without touching the network (for the panel).
pub fn list_receipts() -> Vec<Value> {
    read_receipts(&research_dir())
}

/// Drive the bridge for `urls`. Reaches the web ONLY if `allow_egress` is true.
pub async fn run(
    app_dir: &Path,
    urls: Vec<String>,
    allow_egress: bool,
    ingest: bool,
) -> Result<ResearchRun, String> {
    let script = bridge_script().ok_or_else(|| {
        "Research bridge not found (scripts/research_bridge/bridge.py). Runs only from a source checkout."
            .to_string()
    })?;
    if urls.is_empty() {
        return Err("no URLs given".into());
    }
    if urls.len() > MAX_URLS {
        return Err(format!("too many URLs (max {MAX_URLS} per run)"));
    }
    // Defense in depth: only http(s) reaches the bridge (which re-validates too).
    for u in &urls {
        let t = u.trim();
        if !(t.starts_with("http://") || t.starts_with("https://")) {
            return Err(format!("refused non-http(s) URL: {u}"));
        }
    }

    let db = app_dir.join("spectrum_graph.db");
    let mut args: Vec<String> = vec![script.to_string_lossy().into_owned()];
    // The consent gate: --allow-egress is passed ONLY when explicitly consented.
    if allow_egress {
        args.push("--allow-egress".into());
    }
    if ingest {
        args.push("--ingest".into());
    }
    args.push("--db".into());
    args.push(db.to_string_lossy().into_owned());
    args.push("--".into()); // stop flag parsing; URLs are positional
    args.extend(urls.iter().cloned());

    let child = tokio::process::Command::new("python3")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to launch research bridge: {e} (is python3 installed?)"))?;

    let output = match tokio::time::timeout(RUN_TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("research bridge error: {e}")),
        Err(_) => return Err("research timed out (the process was stopped)".into()),
    };
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    Ok(ResearchRun {
        requested: urls.len(),
        receipts: read_receipts(&research_dir()),
        log,
        egress_consented: allow_egress,
    })
}
