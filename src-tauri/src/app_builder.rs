// App Builder — multi-file local web-app projects from a chat request.
//
// "Build me a todo app" / "create a website for my bakery" produces a
// structured spec (name + files + entry) from the local model; this module
// writes it as a real project folder under Downloads/prismos-apps/ and the
// frontend opens the entry page in the user's default browser. Static web
// tech only — HTML, CSS, JS modules, JSON, SVG — so the result runs with zero
// toolchain and zero network, preserving the offline invariant. The only
// place generated code ever executes is the user's own browser after they
// (or the app, visibly) open it. Never shell scripts, never executables.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::doc_generator::{output_dir, safe_stem};

// ─── Spec types (produced by the LLM, deserialized here) ─────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppFile {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppSpec {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Relative path of the page to open first. Defaults to "index.html".
    #[serde(default)]
    pub entry: String,
    #[serde(default)]
    pub files: Vec<AppFile>,
}

/// Result returned to the frontend after the project is written.
#[derive(Debug, Clone, Serialize)]
pub struct GeneratedApp {
    pub dir: String,
    pub entry_path: String,
    pub name: String,
    pub files: Vec<String>,
}

// ─── Limits & allowlist ──────────────────────────────────────────────────────

/// File types an app project may contain. Inert text + web assets only —
/// nothing directly executable by the OS. No `.mjs`: apps open from file://
/// where module scripts are blocked by module-CORS, so only classic scripts
/// can actually run.
const APP_EXTS: &[&str] = &["html", "css", "js", "json", "svg", "md", "txt"];
const MAX_FILES: usize = 20;
const MAX_TOTAL_BYTES: usize = 1_000_000; // 1 MB across the whole project
const MAX_PATH_DEPTH: usize = 3;

/// Validate a project-relative path: no traversal, no absolute paths, no
/// hidden files, shallow depth, allowlisted extension.
fn validate_rel_path(p: &str) -> Result<(), String> {
    if p.trim().is_empty() {
        return Err("A file in the spec has an empty path.".to_string());
    }
    if p.len() > 120 {
        return Err(format!("File path too long: {p}"));
    }
    if p.starts_with('/') || p.starts_with('~') || p.contains("..") || p.contains('\\') || p.contains(':') {
        return Err(format!("Unsafe file path rejected: {p}"));
    }
    if p.matches('/').count() > MAX_PATH_DEPTH {
        return Err(format!("File path too deep: {p}"));
    }
    for seg in p.split('/') {
        if seg.is_empty() || seg.starts_with('.') {
            return Err(format!("Unsafe path segment in: {p}"));
        }
        if !seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return Err(format!("Unsupported characters in path: {p}"));
        }
    }
    let ext = p.rsplit('.').next().unwrap_or("").to_lowercase();
    if !APP_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported file type '.{ext}' in app project (allowed: {}).",
            APP_EXTS.join(", ")
        ));
    }
    Ok(())
}

/// Case-insensitive ASCII substring search (byte-safe: ASCII needles only).
fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// Content-Security-Policy injected into every generated HTML page.
/// Defense-in-depth for the offline promise: even if the model disobeys the
/// prompt and references a remote script/style/image/beacon, the browser
/// refuses to load it. Inline code and local (file:/data:/blob:) assets keep
/// working; fetch/XHR/WebSocket and form posts are blocked outright.
const APP_CSP_META: &str = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'unsafe-inline' data: blob: file:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";

/// Insert the CSP meta right after `<head…>` (or prepend when there is no
/// head). Pages that already carry a CSP are left alone.
fn inject_csp(html: &str) -> String {
    if find_ci(html, "content-security-policy").is_some() {
        return html.to_string();
    }
    if let Some(head_pos) = find_ci(html, "<head") {
        if let Some(rel_close) = html.as_bytes()[head_pos..].iter().position(|&b| b == b'>') {
            let insert_at = head_pos + rel_close + 1;
            let mut out = String::with_capacity(html.len() + APP_CSP_META.len());
            out.push_str(&html[..insert_at]);
            out.push_str(APP_CSP_META);
            out.push_str(&html[insert_at..]);
            return out;
        }
    }
    format!("{APP_CSP_META}{html}")
}

fn is_html_path(p: &str) -> bool {
    let lower = p.to_lowercase();
    lower.ends_with(".html") || lower.ends_with(".htm")
}

// ─── Generation ──────────────────────────────────────────────────────────────

/// Write the app project to Downloads/prismos-apps/<name>/, refusing anything
/// outside the limits above. Returns the written project's metadata.
pub fn generate_app(spec: &AppSpec) -> Result<GeneratedApp, String> {
    if spec.files.is_empty() {
        return Err("App spec has no files.".to_string());
    }
    if spec.files.len() > MAX_FILES {
        return Err(format!(
            "App spec has {} files — the limit is {MAX_FILES}. Ask for a simpler app.",
            spec.files.len()
        ));
    }
    let total: usize = spec.files.iter().map(|f| f.content.len()).sum();
    if total > MAX_TOTAL_BYTES {
        return Err("App project exceeds the 1 MB size limit.".to_string());
    }
    for f in &spec.files {
        validate_rel_path(&f.path)?;
        if f.content.trim().is_empty() {
            return Err(format!("File '{}' has no content.", f.path));
        }
    }
    // Duplicate paths would silently overwrite each other.
    {
        let mut seen = std::collections::HashSet::new();
        for f in &spec.files {
            if !seen.insert(f.path.to_lowercase()) {
                return Err(format!("Duplicate file path in spec: {}", f.path));
            }
        }
    }

    let entry = if spec.entry.trim().is_empty() {
        "index.html".to_string()
    } else {
        spec.entry.trim().to_string()
    };
    if !spec.files.iter().any(|f| f.path == entry) {
        return Err(format!("Entry file '{entry}' is not among the project files."));
    }
    // The entry is handed to the OS opener as "open in browser" — a non-HTML
    // entry would launch an editor (or nothing) while we report success.
    if !is_html_path(&entry) {
        return Err(format!("Entry file must be an .html page (got '{entry}')."));
    }

    // Project folder: Downloads/prismos-apps/<stem>[-n]
    let stem = safe_stem(&spec.name, "web-app");
    let base = output_dir().join("prismos-apps");
    std::fs::create_dir_all(&base).map_err(|e| format!("Failed to create app folder: {e}"))?;
    let mut dir: PathBuf = base.join(&stem);
    let mut n = 2;
    while dir.exists() {
        dir = base.join(format!("{stem}-{n}"));
        n += 1;
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create project folder: {e}"))?;

    let mut written: Vec<String> = Vec::new();
    for f in &spec.files {
        let target = dir.join(&f.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create folder for {}: {e}", f.path))?;
        }
        // HTML pages get the offline CSP injected — see APP_CSP_META.
        let content = if is_html_path(&f.path) {
            inject_csp(&f.content)
        } else {
            f.content.clone()
        };
        std::fs::write(&target, &content)
            .map_err(|e| format!("Failed to write {}: {e}", f.path))?;
        written.push(f.path.clone());
    }

    Ok(GeneratedApp {
        entry_path: dir.join(&entry).to_string_lossy().to_string(),
        dir: dir.to_string_lossy().to_string(),
        name: if spec.name.trim().is_empty() { stem } else { spec.name.clone() },
        files: written,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_with(files: Vec<(&str, &str)>) -> AppSpec {
        AppSpec {
            name: "Test App".into(),
            description: "d".into(),
            entry: String::new(),
            files: files
                .into_iter()
                .map(|(p, c)| AppFile { path: p.into(), content: c.into() })
                .collect(),
        }
    }

    #[test]
    fn rejects_traversal_absolute_and_hidden_paths() {
        assert!(validate_rel_path("../evil.html").is_err());
        assert!(validate_rel_path("/etc/passwd.txt").is_err());
        assert!(validate_rel_path("a/../../b.js").is_err());
        assert!(validate_rel_path(".htaccess").is_err());
        assert!(validate_rel_path("a/.hidden/x.js").is_err());
        assert!(validate_rel_path("c:\\windows\\x.js").is_err());
        assert!(validate_rel_path("ok/x.sh").is_err()); // extension not allowed
        assert!(validate_rel_path("index.html").is_ok());
        assert!(validate_rel_path("js/app.js").is_ok());
        assert!(validate_rel_path("assets/logo.svg").is_ok());
    }

    #[test]
    fn generates_project_and_defaults_entry() {
        let spec = spec_with(vec![
            ("index.html", "<html><body>hi</body></html>"),
            ("styles.css", "body{}"),
            ("app.js", "console.log(1)"),
        ]);
        let out = generate_app(&spec).expect("app generation");
        assert!(out.entry_path.ends_with("index.html"));
        assert_eq!(out.files.len(), 3);
        assert!(std::path::Path::new(&out.entry_path).exists());
        let _ = std::fs::remove_dir_all(&out.dir);
    }

    #[test]
    fn refuses_missing_entry_and_duplicates() {
        let spec = spec_with(vec![("main.html", "<html/>")]);
        // entry defaults to index.html which is absent
        assert!(generate_app(&spec).is_err());

        let dup = spec_with(vec![("index.html", "a"), ("INDEX.html", "b")]);
        assert!(generate_app(&dup).is_err());
    }

    #[test]
    fn refuses_non_html_entry() {
        let mut spec = spec_with(vec![("index.html", "<html/>"), ("app.js", "x()")]);
        spec.entry = "app.js".into();
        let err = generate_app(&spec).unwrap_err();
        assert!(err.contains(".html"), "unexpected error: {err}");
    }

    #[test]
    fn injects_offline_csp_into_html_only() {
        let spec = spec_with(vec![
            ("index.html", "<!DOCTYPE html><html><head><title>t</title></head><body>hi</body></html>"),
            ("styles.css", "body{}"),
        ]);
        let out = generate_app(&spec).expect("app generation");
        let html = std::fs::read_to_string(&out.entry_path).unwrap();
        assert!(html.contains("Content-Security-Policy"), "CSP missing");
        assert!(html.find("<head>").unwrap() < html.find("Content-Security-Policy").unwrap());
        let css = std::fs::read_to_string(std::path::Path::new(&out.dir).join("styles.css")).unwrap();
        assert!(!css.contains("Content-Security-Policy"));
        let _ = std::fs::remove_dir_all(&out.dir);
    }

    #[test]
    fn csp_injection_handles_missing_head_and_existing_policy() {
        // no <head>: meta is prepended
        let no_head = inject_csp("<p>bare</p>");
        assert!(no_head.starts_with(APP_CSP_META));
        // existing policy is respected, not duplicated
        let existing = "<html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"></head></html>";
        assert_eq!(inject_csp(existing), existing);
    }
}
