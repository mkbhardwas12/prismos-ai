//! Safe, explicit whole-project knowledge ingestion.
//!
//! Scanning is two-phase: `scan_project` reads metadata only and returns an
//! approval token/preview; `prepare_index` reads the already-approved candidate
//! set, redacts likely credentials, and emits deterministic source chunks. It
//! never follows symlinks and never writes inside a source project.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{File, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".secrets",
    "secrets",
    "credentials",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    "coverage",
    ".idea",
    "Pods",
    "DerivedData",
    "vendor",
    ".cargo",
    ".gradle",
    ".terraform",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".cache",
    "tmp",
    "temp",
];

const TEXT_EXTENSIONS: &[&str] = &[
    "rs",
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "go",
    "java",
    "kt",
    "swift",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "rb",
    "php",
    "sh",
    "zsh",
    "bash",
    "ps1",
    "sql",
    "html",
    "css",
    "scss",
    "json",
    "yaml",
    "yml",
    "toml",
    "xml",
    "md",
    "mdx",
    "txt",
    "ini",
    "cfg",
    "conf",
    "properties",
    "gradle",
    "tf",
    "vue",
    "svelte",
    "graphql",
    "proto",
    "dockerignore",
    "gitignore",
];

const WELL_KNOWN_TEXT_FILES: &[&str] = &[
    "dockerfile",
    "makefile",
    "justfile",
    "procfile",
    "gemfile",
    "rakefile",
    "license",
    "notice",
    ".gitignore",
    ".dockerignore",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeScanOptions {
    pub max_walk_files: usize,
    pub max_candidate_files: usize,
    pub max_total_bytes: u64,
    pub max_file_bytes: u64,
    pub max_depth: usize,
    pub max_chunks: usize,
}

impl Default for KnowledgeScanOptions {
    fn default() -> Self {
        Self {
            max_walk_files: 25_000,
            max_candidate_files: 2_500,
            max_total_bytes: 64 * 1024 * 1024,
            max_file_bytes: 512 * 1024,
            max_depth: 16,
            max_chunks: 8_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CandidateFile {
    pub relative_path: String,
    pub size_bytes: u64,
    pub modified_at_ns: Option<u128>,
    pub file_identity: Option<String>,
    pub priority: i64,
}

#[derive(Debug, Clone)]
pub struct PendingKnowledgeScan {
    pub scan_id: String,
    pub source_id: String,
    pub project_name: String,
    pub canonical_root: PathBuf,
    pub candidates: Vec<CandidateFile>,
    pub options: KnowledgeScanOptions,
    pub total_files_seen: usize,
    pub total_candidate_bytes: u64,
    pub skipped_sensitive_files: usize,
    pub skipped_dirs: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeScanPreview {
    pub scan_id: String,
    pub source_id: String,
    pub project_name: String,
    pub root_path: String,
    pub total_files_seen: usize,
    pub candidate_files: usize,
    pub candidate_paths: Vec<String>,
    pub total_candidate_bytes: u64,
    pub skipped_sensitive_files: usize,
    pub skipped_dirs: Vec<String>,
    pub truncated: bool,
}

impl PendingKnowledgeScan {
    pub fn preview(&self) -> KnowledgeScanPreview {
        KnowledgeScanPreview {
            scan_id: self.scan_id.clone(),
            source_id: self.source_id.clone(),
            project_name: self.project_name.clone(),
            root_path: self.canonical_root.display().to_string(),
            total_files_seen: self.total_files_seen,
            candidate_files: self.candidates.len(),
            candidate_paths: self
                .candidates
                .iter()
                .take(100)
                .map(|candidate| candidate.relative_path.clone())
                .collect(),
            total_candidate_bytes: self.total_candidate_bytes,
            skipped_sensitive_files: self.skipped_sensitive_files,
            skipped_dirs: self.skipped_dirs.clone(),
            truncated: self.truncated,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedKnowledgeChunk {
    pub id: String,
    pub label: String,
    pub content: String,
    pub relative_path: String,
    pub content_hash: String,
    pub chunk_index: usize,
    pub total_chunks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedKnowledgeIndex {
    pub source_id: String,
    pub project_name: String,
    pub root_path: String,
    pub indexed_at: String,
    pub file_count: usize,
    pub chunk_count: usize,
    pub bytes_indexed: u64,
    pub skipped_files: usize,
    pub errors: Vec<String>,
    pub complete: bool,
    pub chunks: Vec<PreparedKnowledgeChunk>,
}

pub fn scan_project(
    root_input: &str,
    options: KnowledgeScanOptions,
) -> Result<PendingKnowledgeScan, String> {
    let expanded = expand_path(root_input)?;
    let original_meta = std::fs::symlink_metadata(&expanded)
        .map_err(|e| format!("Cannot inspect {}: {e}", expanded.display()))?;
    if original_meta.file_type().is_symlink() {
        return Err("Knowledge roots cannot be symbolic links".into());
    }
    let root = expanded
        .canonicalize()
        .map_err(|e| format!("Project path not found: {} ({e})", expanded.display()))?;
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", root.display()));
    }
    if root.parent().is_none() {
        return Err("Refusing to scan the filesystem root".into());
    }
    let canonical_home = dirs::home_dir().and_then(|home| home.canonicalize().ok());
    if canonical_home.as_ref().is_some_and(|home| home == &root) {
        return Err(
            "Refusing to scan the entire home directory; choose a project or projects folder"
                .into(),
        );
    }

    let mut walk_entries_seen = 0usize;
    let mut total_files_seen = 0usize;
    let mut skipped_sensitive_files = 0usize;
    let mut skipped_dir_set = HashSet::new();
    let mut all_candidates = Vec::new();
    let mut truncated = false;

    let walker = WalkDir::new(&root)
        .max_depth(options.max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if !entry.file_type().is_dir() {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if SKIP_DIRS
                .iter()
                .any(|skip| skip.eq_ignore_ascii_case(&name))
            {
                skipped_dir_set.insert(name.to_string());
                return false;
            }
            true
        });

    for entry_result in walker {
        let entry = entry_result
            .map_err(|error| format!("Could not completely scan the approved root: {error}"))?;
        walk_entries_seen += 1;
        if walk_entries_seen > options.max_walk_files {
            truncated = true;
            break;
        }
        if !entry.file_type().is_file() || entry.file_type().is_symlink() {
            continue;
        }
        total_files_seen += 1;
        let path = entry.path();
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| format!("Path escaped approved root: {}", path.display()))?;
        if is_sensitive_path(relative) {
            skipped_sensitive_files += 1;
            continue;
        }
        if !is_supported_text_path(relative) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        if metadata.len() == 0 || metadata.len() > options.max_file_bytes {
            continue;
        }
        let relative_path = relative
            .to_str()
            .ok_or_else(|| {
                format!(
                    "Cannot safely identify a non-UTF-8 path under {}",
                    root.display()
                )
            })?
            .replace('\\', "/");
        all_candidates.push(CandidateFile {
            priority: priority_score(&relative_path, metadata.len()),
            relative_path,
            size_bytes: metadata.len(),
            modified_at_ns: modified_at_ns(&metadata),
            file_identity: file_identity(&metadata),
        });
    }

    all_candidates.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    let mut candidates = Vec::new();
    let mut total_candidate_bytes = 0u64;
    for candidate in all_candidates {
        if candidates.len() >= options.max_candidate_files
            || total_candidate_bytes.saturating_add(candidate.size_bytes) > options.max_total_bytes
        {
            truncated = true;
            continue;
        }
        total_candidate_bytes += candidate.size_bytes;
        candidates.push(candidate);
    }

    let project_name = root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());
    let source_id = format!("project-{}", short_hash(&root.display().to_string(), 24));
    let mut skipped_dirs: Vec<String> = skipped_dir_set.into_iter().collect();
    skipped_dirs.sort();

    Ok(PendingKnowledgeScan {
        scan_id: uuid::Uuid::new_v4().to_string(),
        source_id,
        project_name,
        canonical_root: root,
        candidates,
        options,
        total_files_seen,
        total_candidate_bytes,
        skipped_sensitive_files,
        skipped_dirs,
        truncated,
    })
}

pub fn prepare_index(scan: &PendingKnowledgeScan) -> PreparedKnowledgeIndex {
    if let Err(reason) = ensure_content_ingestion_supported() {
        return PreparedKnowledgeIndex {
            source_id: scan.source_id.clone(),
            project_name: scan.project_name.clone(),
            root_path: scan.canonical_root.display().to_string(),
            indexed_at: chrono::Utc::now().to_rfc3339(),
            file_count: 0,
            chunk_count: 0,
            bytes_indexed: 0,
            skipped_files: scan
                .skipped_sensitive_files
                .saturating_add(scan.candidates.len()),
            errors: vec![reason],
            complete: false,
            chunks: Vec::new(),
        };
    }

    let mut chunks = Vec::new();
    let mut errors = Vec::new();
    let mut file_count = 0usize;
    let mut bytes_indexed = 0u64;
    let mut skipped_files = scan.skipped_sensitive_files;

    let mut complete = !scan.truncated;
    if scan.truncated {
        push_error(
            &mut errors,
            "The metadata scan exceeded a safety budget; choose a narrower root and scan again"
                .into(),
        );
    }

    for (candidate_index, candidate) in scan.candidates.iter().enumerate() {
        if chunks.len() >= scan.options.max_chunks {
            complete = false;
            skipped_files =
                skipped_files.saturating_add(scan.candidates.len().saturating_sub(candidate_index));
            push_error(
                &mut errors,
                "The chunk budget was reached; choose a narrower root and scan again".into(),
            );
            break;
        }
        let path = scan.canonical_root.join(&candidate.relative_path);
        let safe_path = match validate_candidate_path(&scan.canonical_root, &path) {
            Ok(path) => path,
            Err(error) => {
                complete = false;
                skipped_files += 1;
                push_error(&mut errors, format!("{}: {error}", candidate.relative_path));
                continue;
            }
        };
        // Open once, validate the opened handle, then read through that same
        // handle. This prevents a path replacement from redirecting the read
        // after validation.
        let mut file = match File::open(&safe_path) {
            Ok(file) => file,
            Err(error) => {
                complete = false;
                skipped_files += 1;
                push_error(&mut errors, format!("{}: {error}", candidate.relative_path));
                continue;
            }
        };
        let metadata = match file.metadata() {
            Ok(metadata) if candidate_matches_metadata(candidate, &metadata) => metadata,
            Ok(_) => {
                complete = false;
                skipped_files += 1;
                push_error(
                    &mut errors,
                    format!(
                        "{}: changed after preview; scan again before indexing",
                        candidate.relative_path
                    ),
                );
                continue;
            }
            Err(error) => {
                complete = false;
                skipped_files += 1;
                push_error(&mut errors, format!("{}: {error}", candidate.relative_path));
                continue;
            }
        };
        if bytes_indexed.saturating_add(metadata.len()) > scan.options.max_total_bytes {
            complete = false;
            skipped_files += 1;
            push_error(
                &mut errors,
                format!("{}: approved byte limit reached", candidate.relative_path),
            );
            continue;
        }
        let read_limit = scan
            .options
            .max_file_bytes
            .min(scan.options.max_total_bytes.saturating_sub(bytes_indexed));
        let mut bytes = Vec::with_capacity(metadata.len().min(read_limit) as usize);
        let read_result = (&mut file)
            .take(read_limit.saturating_add(1))
            .read_to_end(&mut bytes);
        if let Err(error) = read_result {
            complete = false;
            skipped_files += 1;
            push_error(&mut errors, format!("{}: {error}", candidate.relative_path));
            continue;
        }
        if bytes.len() as u64 > read_limit {
            complete = false;
            skipped_files += 1;
            push_error(
                &mut errors,
                format!(
                    "{}: grew beyond the approved byte limit; scan again",
                    candidate.relative_path
                ),
            );
            continue;
        }
        let post_read_metadata = match file.metadata() {
            Ok(metadata) if candidate_matches_metadata(candidate, &metadata) => metadata,
            Ok(_) => {
                complete = false;
                skipped_files += 1;
                push_error(
                    &mut errors,
                    format!(
                        "{}: changed while being read; scan again before indexing",
                        candidate.relative_path
                    ),
                );
                continue;
            }
            Err(error) => {
                complete = false;
                skipped_files += 1;
                push_error(&mut errors, format!("{}: {error}", candidate.relative_path));
                continue;
            }
        };
        if post_read_metadata.len() != bytes.len() as u64 {
            complete = false;
            skipped_files += 1;
            push_error(
                &mut errors,
                format!(
                    "{}: changed while being read; scan again before indexing",
                    candidate.relative_path
                ),
            );
            continue;
        }
        if bytes.contains(&0) {
            skipped_files += 1;
            continue;
        }
        let file_bytes = bytes.len() as u64;
        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => {
                skipped_files += 1;
                continue;
            }
        };
        let redacted = redact_sensitive_content(&text);
        if redacted.trim().is_empty() {
            skipped_files += 1;
            continue;
        }
        let document = crate::doc_chunker::chunk_document(&redacted, &candidate.relative_path);
        let available = scan.options.max_chunks.saturating_sub(chunks.len());
        let total_chunks = document.chunks.len();
        if total_chunks > available {
            complete = false;
            skipped_files =
                skipped_files.saturating_add(scan.candidates.len().saturating_sub(candidate_index));
            push_error(
                &mut errors,
                format!(
                    "{}: the chunk budget would split this file; choose a narrower root and scan again",
                    candidate.relative_path
                ),
            );
            break;
        }
        for (chunk_index, chunk) in document.chunks.into_iter().enumerate() {
            let content_hash = full_hash(&chunk.content);
            let id = format!(
                "knowledge-{}",
                short_hash(
                    &format!(
                        "{}\0{}\0{}",
                        scan.source_id, candidate.relative_path, chunk_index
                    ),
                    32,
                )
            );
            chunks.push(PreparedKnowledgeChunk {
                id,
                label: format!(
                    "{} · {}/{} [{}/{}]",
                    scan.project_name,
                    scan.source_id,
                    candidate.relative_path,
                    chunk_index + 1,
                    total_chunks
                ),
                content: format!(
                    "Project: {}\nProject source: {}\nSource: {}/{}\nChunk: {}/{}\nContent hash: {}\n\n{}",
                    scan.project_name,
                    scan.source_id,
                    scan.source_id,
                    candidate.relative_path,
                    chunk_index + 1,
                    total_chunks,
                    content_hash,
                    chunk.content
                ),
                relative_path: candidate.relative_path.clone(),
                content_hash,
                chunk_index,
                total_chunks,
            });
        }
        file_count += 1;
        bytes_indexed = bytes_indexed.saturating_add(file_bytes);
    }

    PreparedKnowledgeIndex {
        source_id: scan.source_id.clone(),
        project_name: scan.project_name.clone(),
        root_path: scan.canonical_root.display().to_string(),
        indexed_at: chrono::Utc::now().to_rfc3339(),
        file_count,
        chunk_count: chunks.len(),
        bytes_indexed,
        skipped_files,
        errors,
        complete,
        chunks,
    }
}

/// Content ingestion requires a stable identity from the same opened file
/// handle used for the read. The current implementation has that primitive on
/// Unix. Other platforms fail closed until an equivalent reparse-point-safe
/// handle check is implemented.
pub fn ensure_content_ingestion_supported() -> Result<(), String> {
    #[cfg(unix)]
    {
        Ok(())
    }
    #[cfg(not(unix))]
    {
        Err(
            "Project Knowledge content indexing is unavailable on this platform until same-handle file identity validation is implemented"
                .into(),
        )
    }
}

fn modified_at_ns(metadata: &Metadata) -> Option<u128> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_nanos())
}

#[cfg(unix)]
fn file_identity(metadata: &Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn file_identity(_metadata: &Metadata) -> Option<String> {
    None
}

fn candidate_matches_metadata(candidate: &CandidateFile, metadata: &Metadata) -> bool {
    metadata.is_file()
        && !metadata.file_type().is_symlink()
        && metadata.len() == candidate.size_bytes
        && modified_at_ns(metadata) == candidate.modified_at_ns
        && file_identity(metadata) == candidate.file_identity
}

fn expand_path(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Choose a project folder first".into());
    }
    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".into());
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home| home.join(rest))
            .ok_or_else(|| "Cannot resolve home directory".into());
    }
    Ok(PathBuf::from(trimmed))
}

fn validate_candidate_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("not a regular, non-symlink file".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("resolved outside the approved root".into());
    }
    Ok(canonical)
}

fn is_supported_text_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if WELL_KNOWN_TEXT_FILES.contains(&name.as_str()) {
        return true;
    }
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .is_some_and(|extension| TEXT_EXTENSIONS.contains(&extension.as_str()))
}

fn is_sensitive_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let has_sensitive_directory = path.components().any(|component| {
        let component = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        matches!(
            component.as_str(),
            "secrets" | ".secrets" | "credentials" | ".credentials"
        )
    });
    name == ".env"
        || name.starts_with(".env.")
        || name.starts_with(".env-")
        || name.starts_with("credentials.")
        || name.starts_with("credential.")
        || name.starts_with("secrets.")
        || name.starts_with("secret.")
        || name.starts_with("service-account.")
        || name.starts_with("service_account.")
        || has_sensitive_directory
        || matches!(
            extension.as_str(),
            "pem" | "key" | "p12" | "pfx" | "jks" | "keystore"
        )
        || matches!(
            name.as_str(),
            "id_rsa"
                | "id_ed25519"
                | "credentials.json"
                | "credentials.yml"
                | "credentials.yaml"
                | "secrets.json"
                | "secrets.yml"
                | "secrets.yaml"
                | "service-account.json"
                | "service_account.json"
                | ".npmrc"
                | ".pypirc"
        )
}

fn priority_score(relative_path: &str, bytes: u64) -> i64 {
    let path = relative_path.to_lowercase();
    let name = path.rsplit('/').next().unwrap_or(&path);
    let mut score = 0i64;
    if name.starts_with("readme") || name == "cargo.toml" || name == "package.json" {
        score += 1_000;
    }
    if matches!(
        name,
        "pyproject.toml" | "go.mod" | "pom.xml" | "build.gradle" | "dockerfile"
    ) {
        score += 800;
    }
    if path.starts_with("docs/") || path.contains("/docs/") {
        score += 500;
    }
    if ["main.", "lib.", "app.", "index.", "server."]
        .iter()
        .any(|prefix| name.starts_with(prefix))
    {
        score += 400;
    }
    if path.contains("test") || path.contains("fixture") || path.ends_with(".lock") {
        score -= 300;
    }
    score + (bytes as i64 / 4096).min(100)
}

fn redact_sensitive_content(text: &str) -> String {
    const KEYS: &[&str] = &[
        "api_key",
        "apikey",
        "secret",
        "password",
        "passwd",
        "token",
        "private_key",
        "client_secret",
        "access_key",
        "auth_key",
        "authorization",
        "database_url",
        "db_url",
        "connection_string",
        "dsn",
    ];
    let mut output = Vec::new();
    let mut in_private_key = false;
    for line in text.lines() {
        let upper = line.to_ascii_uppercase();
        if upper.contains("BEGIN ") && upper.contains("PRIVATE KEY") {
            in_private_key = true;
            output.push("[REDACTED PRIVATE KEY BLOCK]".to_string());
            continue;
        }
        if in_private_key {
            if upper.contains("END ") && upper.contains("PRIVATE KEY") {
                in_private_key = false;
            }
            continue;
        }

        let line = redact_xml_secret_values(line, KEYS);
        let lower = line.to_ascii_lowercase();
        let separator = line.find('=').or_else(|| line.find(':'));
        if let Some(index) = separator {
            let key = lower[..index].trim();
            let value = line[index + 1..].trim();
            let looks_sensitive = KEYS.iter().any(|needle| key.contains(needle));
            let is_reference = is_safe_secret_reference(value);
            if looks_sensitive && !is_reference {
                output.push(format!(
                    "{}{} [REDACTED]",
                    &line[..index],
                    &line[index..=index]
                ));
                continue;
            }
        }
        output.push(redact_inline_token_literals(&line));
    }
    output.join("\n")
}

fn is_safe_secret_reference(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(trimmed)
        .trim();
    let lower = unquoted.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "placeholder" | "[redacted]" | "example" | "example-value"
    ) {
        return true;
    }
    if unquoted.starts_with("${") && unquoted.ends_with('}') {
        let variable = &unquoted[2..unquoted.len() - 1];
        return !variable.is_empty()
            && variable
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_');
    }
    if let Some(variable) = unquoted.strip_prefix("process.env.") {
        return !variable.is_empty()
            && variable
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_');
    }
    false
}

fn redact_xml_secret_values(line: &str, keys: &[&str]) -> String {
    let mut result = line.to_string();
    for key in keys {
        let opening = format!("<{key}>");
        let closing = format!("</{key}>");
        let mut search_start = 0usize;
        loop {
            let lower = result.to_ascii_lowercase();
            let Some(relative_start) = lower[search_start..].find(&opening) else {
                break;
            };
            let start = search_start + relative_start;
            let value_start = start + opening.len();
            let Some(relative_end) = lower[value_start..].find(&closing) else {
                break;
            };
            let value_end = value_start + relative_end;
            result.replace_range(value_start..value_end, "[REDACTED]");
            search_start = value_start + "[REDACTED]".len() + closing.len();
            if search_start >= result.len() {
                break;
            }
        }
    }
    result
}

fn redact_inline_token_literals(line: &str) -> String {
    let candidates: Vec<String> = line
        .split(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '\"' | '\'' | '`' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
                )
        })
        .map(|candidate| candidate.trim_matches(|c: char| matches!(c, ':' | '=' | '.')))
        .filter(|candidate| {
            let length = candidate.len();
            (candidate.starts_with("ghp_") && length >= 20)
                || (candidate.starts_with("github_pat_") && length >= 24)
                || (candidate.starts_with("sk-") && length >= 20)
                || (candidate.starts_with("xoxb-") && length >= 20)
                || (candidate.starts_with("xoxp-") && length >= 20)
                || (candidate.starts_with("AKIA") && length >= 16)
                || (candidate.starts_with("eyJ")
                    && candidate.matches('.').count() == 2
                    && length >= 30)
        })
        .map(ToString::to_string)
        .collect();

    let mut result = line.to_string();
    for candidate in candidates {
        result = result.replace(&candidate, "[REDACTED TOKEN]");
    }
    result
}

fn short_hash(value: &str, chars: usize) -> String {
    full_hash(value).chars().take(chars).collect()
}

fn full_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

fn push_error(errors: &mut Vec<String>, error: String) {
    if errors.len() < 100 {
        errors.push(error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_skips_sensitive_and_vendor_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("README.md"), "project overview").unwrap();
        std::fs::write(dir.path().join(".env"), "API_KEY=secret").unwrap();
        std::fs::write(dir.path().join(".env-local.toml"), "API_KEY=secret").unwrap();
        std::fs::write(dir.path().join("credentials.toml"), "token='secret'").unwrap();
        std::fs::create_dir(dir.path().join("secrets")).unwrap();
        std::fs::write(
            dir.path().join("secrets/config.json"),
            "{\"token\":\"secret\"}",
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();
        std::fs::write(dir.path().join("node_modules/pkg.js"), "vendor").unwrap();
        let scan = scan_project(
            dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        assert_eq!(scan.candidates.len(), 1);
        assert_eq!(scan.candidates[0].relative_path, "README.md");
        assert_eq!(scan.skipped_sensitive_files, 3);
        assert!(scan.skipped_dirs.iter().any(|name| name == "node_modules"));
        assert!(scan.skipped_dirs.iter().any(|name| name == "secrets"));
    }

    #[test]
    fn prepared_ids_are_stable_and_large_files_are_chunked() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("README.md"),
            "Rust orchestration knowledge. ".repeat(300),
        )
        .unwrap();
        let scan_one = scan_project(
            dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        let scan_two = scan_project(
            dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        let first = prepare_index(&scan_one);
        let second = prepare_index(&scan_two);
        assert!(first.chunks.len() > 1);
        assert_eq!(first.source_id, second.source_id);
        assert_eq!(first.chunks[0].id, second.chunks[0].id);
        assert_eq!(first.chunks[0].content_hash, second.chunks[0].content_hash);
        assert!(first.chunks[0]
            .content
            .contains(&format!("Source: {}/README.md", first.source_id)));
    }

    #[test]
    fn changed_file_requires_a_fresh_approval() {
        let dir = tempfile::tempdir().unwrap();
        let readme = dir.path().join("README.md");
        std::fs::write(&readme, "approved preview contents").unwrap();
        let scan = scan_project(
            dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();

        std::fs::write(
            &readme,
            "replacement contents written after preview with a different byte length",
        )
        .unwrap();
        let prepared = prepare_index(&scan);

        assert!(prepared.chunks.is_empty());
        assert_eq!(prepared.bytes_indexed, 0);
        assert!(!prepared.complete);
        assert!(prepared
            .errors
            .iter()
            .any(|error| error.contains("changed after preview")));
    }

    #[test]
    fn likely_literal_secrets_and_private_keys_are_redacted() {
        // Assemble the marker at runtime so the repository boundary scanner can
        // reject literal private-key blocks anywhere in tracked source.
        let private_key_block = [
            "-----BEGIN ",
            "PRIVATE",
            " KEY-----\nabc\n-----END ",
            "PRIVATE",
            " KEY-----",
        ]
        .concat();
        let input = format!(
            "api_key = \"real-value\"\npassword: hunter2\napi_key = process.env.KEY\n{}",
            private_key_block
        );
        let output = redact_sensitive_content(&input);
        assert!(!output.contains("real-value"));
        assert!(!output.contains("hunter2"));
        assert!(!output.contains("\nabc\n"));
        assert!(output.contains("process.env.KEY"));
        assert!(output.contains("[REDACTED PRIVATE KEY BLOCK]"));
    }

    #[test]
    fn common_xml_bearer_database_and_inline_tokens_are_redacted() {
        // Assemble the synthetic GitHub-shaped token at runtime so repository
        // secret scanners do not mistake the test fixture for a committed key.
        let fake_github_token = ["ghp", "_", "123456789012345678901234567890"].concat();
        let input = format!(
            "{}const token = '{}';\n{}",
            concat!(
                "<password>xml-hunter2</password>\n",
                "authorization: Bearer very-secret-bearer\n",
                "database_url = postgres://admin:password@db.example/app\n",
            ),
            fake_github_token,
            concat!(
                "api_key = \"literal-secret-${HOST}\"\n",
                "client_secret = env(\"KEY\", \"fallback-real-secret\")\n",
                "safe_url = postgres://localhost/app\n",
            ),
        );
        let output = redact_sensitive_content(&input);
        assert!(!output.contains("xml-hunter2"));
        assert!(!output.contains("very-secret-bearer"));
        assert!(!output.contains("admin:password"), "{output}");
        assert!(!output.contains(&fake_github_token));
        assert!(!output.contains("literal-secret-${HOST}"));
        assert!(!output.contains("fallback-real-secret"));
        assert!(output.contains("safe_url = postgres://localhost/app"));
    }

    #[test]
    fn refuses_home_and_filesystem_root() {
        let options = KnowledgeScanOptions::default();
        if let Some(home) = dirs::home_dir() {
            assert!(scan_project(home.to_str().unwrap(), options.clone()).is_err());
        }
        #[cfg(unix)]
        assert!(scan_project("/", options).is_err());
    }

    #[test]
    fn end_to_end_refresh_removes_old_facts_from_retrieval() {
        let source_dir = tempfile::tempdir().unwrap();
        let app_dir = tempfile::tempdir().unwrap();
        let readme = source_dir.path().join("README.md");
        std::fs::write(&readme, "The internal codename is legacyquartz.").unwrap();

        let sync = |graph: &crate::spectrum_graph::SpectrumGraph,
                    prepared: &PreparedKnowledgeIndex| {
            let records: Vec<crate::spectrum_graph::KnowledgeChunkRecord> = prepared
                .chunks
                .iter()
                .map(|chunk| crate::spectrum_graph::KnowledgeChunkRecord {
                    id: chunk.id.clone(),
                    label: chunk.label.clone(),
                    content: chunk.content.clone(),
                    source_path: chunk.relative_path.clone(),
                    content_hash: chunk.content_hash.clone(),
                })
                .collect();
            graph
                .sync_knowledge_source(
                    &prepared.source_id,
                    &prepared.project_name,
                    &prepared.root_path,
                    &prepared.indexed_at,
                    prepared.file_count,
                    prepared.bytes_indexed,
                    prepared.skipped_files,
                    prepared.errors.len(),
                    &records,
                )
                .unwrap();
        };

        let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir.path()).unwrap();
        let first_scan = scan_project(
            source_dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        let first = prepare_index(&first_scan);
        sync(&graph, &first);
        assert!(graph
            .query_intent("legacyquartz", "Query", &[])
            .unwrap()
            .iter()
            .any(|hit| hit.node.content.contains("legacyquartz")));

        std::fs::write(&readme, "The internal codename is modernzephyr.").unwrap();
        let second_scan = scan_project(
            source_dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        let second = prepare_index(&second_scan);
        sync(&graph, &second);

        assert!(!graph
            .query_intent("legacyquartz", "Query", &[])
            .unwrap()
            .iter()
            .any(|hit| hit.node.content.contains("legacyquartz")));
        assert!(graph
            .query_intent("modernzephyr", "Query", &[])
            .unwrap()
            .iter()
            .any(|hit| hit.node.content.contains("modernzephyr")));

        std::fs::remove_file(&readme).unwrap();
        let empty_scan = scan_project(
            source_dir.path().to_str().unwrap(),
            KnowledgeScanOptions::default(),
        )
        .unwrap();
        let empty = prepare_index(&empty_scan);
        assert!(empty.complete);
        assert!(empty.chunks.is_empty());
        sync(&graph, &empty);
        assert!(!graph
            .query_intent("modernzephyr", "Query", &[])
            .unwrap()
            .iter()
            .any(|hit| hit.node.content.contains("modernzephyr")));
    }
}
