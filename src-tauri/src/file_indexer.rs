// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// File Indexer — Local RAG: Watch directories, extract text, ingest into Spectrum Graph
//
// Watches user-configured directories (default: ~/Documents/PrismDocs) for file
// changes. When files are added or modified, extracts text content and injects
// summaries as nodes into the Spectrum Graph — giving PrismOS-AI awareness
// of local files without ever uploading them.
//
// Supported formats: .txt, .md, .json, .csv, .log, .rs, .py, .js, .ts, .toml, .yaml
// (Text-based files only — binary formats like .pdf require additional crates)

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use walkdir::WalkDir;

/// Supported text-based file extensions for indexing
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "txt", "md", "json", "csv", "log", "toml", "yaml", "yml",
    "rs", "py", "js", "ts", "tsx", "jsx", "html", "css",
    "sh", "bat", "ps1", "cfg", "ini", "xml", "sql",
];

/// Maximum file size to index (1 MB)
const MAX_FILE_SIZE: u64 = 1_048_576;

/// Maximum content length to store per node (truncate long files)
const MAX_CONTENT_LENGTH: usize = 4096;

/// An indexed file record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedFile {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size_bytes: u64,
    pub last_modified: String,
    pub content_preview: String,
    pub node_id: Option<String>,
    pub indexed_at: String,
}

/// Status of the file indexer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerStatus {
    pub running: bool,
    pub watch_paths: Vec<String>,
    pub indexed_count: usize,
    pub last_scan: Option<String>,
}

/// The file indexer state
pub struct FileIndexer {
    watch_paths: Vec<PathBuf>,
    indexed_files: HashMap<PathBuf, IndexedFile>,
    watcher: Option<RecommendedWatcher>,
}

impl FileIndexer {
    pub fn new() -> Self {
        Self {
            watch_paths: Vec::new(),
            indexed_files: HashMap::new(),
            watcher: None,
        }
    }

    /// Get the default watch directory: ~/Documents/PrismDocs
    pub fn default_watch_dir() -> PathBuf {
        let home = dirs_next().unwrap_or_else(|| PathBuf::from("."));
        home.join("Documents").join("PrismDocs")
    }

    /// Get the status of the indexer
    pub fn status(&self) -> IndexerStatus {
        IndexerStatus {
            running: self.watcher.is_some(),
            watch_paths: self.watch_paths.iter().map(|p| p.display().to_string()).collect(),
            indexed_count: self.indexed_files.len(),
            last_scan: None,
        }
    }

    /// Get list of indexed files
    pub fn get_indexed_files(&self) -> Vec<IndexedFile> {
        self.indexed_files.values().cloned().collect()
    }

    /// Start watching directories for changes
    /// Returns a receiver for file change events (path of changed files)
    pub fn start_watching(
        &mut self,
        paths: Vec<PathBuf>,
    ) -> Result<mpsc::Receiver<PathBuf>, String> {
        // Ensure directories exist
        for path in &paths {
            if !path.exists() {
                let _ = std::fs::create_dir_all(path);
            }
        }

        let (tx, rx) = mpsc::channel();
        let tx_clone = tx.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for path in event.paths {
                                if is_indexable(&path) {
                                    let _ = tx_clone.send(path);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create file watcher: {}", e))?;

        for path in &paths {
            watcher
                .watch(path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", path.display(), e))?;
        }

        self.watch_paths = paths;
        self.watcher = Some(watcher);

        Ok(rx)
    }

    /// Stop watching directories
    pub fn stop_watching(&mut self) {
        self.watcher = None;
        self.watch_paths.clear();
    }

    /// Perform initial scan of all watched directories
    pub fn initial_scan(&mut self) -> Vec<PathBuf> {
        let mut files = Vec::new();

        for watch_path in &self.watch_paths.clone() {
            for entry in WalkDir::new(watch_path)
                .max_depth(5)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let path = entry.path().to_path_buf();
                if is_indexable(&path) {
                    files.push(path);
                }
            }
        }

        files
    }

    /// Index a single file — extract content and create an IndexedFile record
    pub fn index_file(&mut self, path: &Path) -> Result<IndexedFile, String> {
        let metadata = std::fs::metadata(path)
            .map_err(|e| format!("Cannot read file metadata: {}", e))?;

        if metadata.len() > MAX_FILE_SIZE {
            return Err(format!("File too large: {} bytes (max {})", metadata.len(), MAX_FILE_SIZE));
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        // Truncate content for storage
        let content_preview = if content.len() > MAX_CONTENT_LENGTH {
            format!("{}…\n[truncated — {} chars total]", &content[..MAX_CONTENT_LENGTH], content.len())
        } else {
            content.clone()
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default())
            .unwrap_or_default();

        let now = chrono::Utc::now().to_rfc3339();

        let indexed = IndexedFile {
            path: path.display().to_string(),
            filename: filename.clone(),
            extension,
            size_bytes: metadata.len(),
            last_modified: modified,
            content_preview,
            node_id: None,
            indexed_at: now,
        };

        self.indexed_files.insert(path.to_path_buf(), indexed.clone());
        Ok(indexed)
    }

    /// Generate Spectrum Graph node content from an indexed file
    pub fn file_to_node_content(file: &IndexedFile) -> (String, String, String) {
        let label = format!("📄 {}", file.filename);
        let node_type = "document".to_string();

        // Create a structured content summary
        let content = format!(
            "Local file: {}\nPath: {}\nSize: {} bytes\nLast modified: {}\n\n---\n{}",
            file.filename,
            file.path,
            file.size_bytes,
            file.last_modified,
            file.content_preview
        );

        (label, content, node_type)
    }
}

/// Check if a file is indexable based on extension and size
fn is_indexable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
        return false;
    }

    // Check size
    path.metadata()
        .map(|m| m.len() <= MAX_FILE_SIZE)
        .unwrap_or(false)
}

/// Get the user's home/Documents directory cross-platform
fn dirs_next() -> Option<PathBuf> {
    dirs::home_dir()
}
