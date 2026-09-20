// File Indexer — Local RAG: Watch directories, extract text, ingest into Spectrum Graph
//
// Watches user-configured directories (default: ~/Documents/PrismDocs) for file
// changes. When files are added or modified, extracts full text and indexes
// source-linked chunks into the Spectrum Graph — giving PrismOS-AI awareness
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
    generation: u64,
    last_scan: Option<String>,
}

impl FileIndexer {
    pub fn new() -> Self {
        Self {
            watch_paths: Vec::new(),
            indexed_files: HashMap::new(),
            watcher: None,
            generation: 0,
            last_scan: None,
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
            last_scan: self.last_scan.clone(),
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
        // Resolve the selected roots once; event paths must stay inside them.
        let mut roots = Vec::new();
        for path in &paths {
            if !path.exists() {
                std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
            }
            let root = path.canonicalize().map_err(|e| e.to_string())?;
            if !root.is_dir() { return Err("Watch path must be a directory".to_string()); }
            roots.push(root);
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

        for path in &roots {
            watcher
                .watch(path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", path.display(), e))?;
        }

        self.watch_paths = roots;
        self.watcher = Some(watcher);
        self.generation = self.generation.wrapping_add(1);

        Ok(rx)
    }

    /// Stop watching directories
    pub fn stop_watching(&mut self) {
        self.watcher = None;
        self.watch_paths.clear();
        self.generation = self.generation.wrapping_add(1);
    }

    pub fn generation(&self) -> u64 { self.generation }

    /// Reject queued events from earlier watches and symbolic-link escapes.
    pub fn accepts_event(&self, path: &Path, generation: u64) -> bool {
        self.watcher.is_some() && self.generation == generation && is_indexable(path)
            && path.canonicalize().is_ok_and(|p| self.watch_paths.iter().any(|root| p.starts_with(root)))
    }

    /// Perform initial scan of all watched directories
    pub fn initial_scan(&mut self) -> Vec<PathBuf> {
        let mut files = Vec::new();

        for watch_path in &self.watch_paths.clone() {
            for entry in WalkDir::new(watch_path)
                .max_depth(5)
                .follow_links(false)
                .into_iter()
                .filter_entry(|entry| !is_ignored_component(entry.path()))
                .filter_map(|e| e.ok())
            {
                let path = entry.path().to_path_buf();
                if is_indexable(&path) {
                    files.push(path);
                }
            }
        }

        self.last_scan = Some(chrono::Utc::now().to_rfc3339());
        files
    }

    /// Index a single file — extract content and create an IndexedFile record
    pub fn index_file(&mut self, path: &Path) -> Result<IndexedFile, String> {
        let (indexed, _) = Self::read_indexed_file(path)?;
        self.indexed_files.insert(path.to_path_buf(), indexed.clone());
        Ok(indexed)
    }

    /// The initial scan and file-change worker share exactly this ingestion path.
    pub fn index_file_to_graph(
        &mut self,
        path: &Path,
        graph: &crate::spectrum_graph::SpectrumGraph,
    ) -> Result<IndexedFile, String> {
        if !is_indexable(path) { return Err("File is not an indexable regular text file".to_string()); }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let (mut indexed, text) = Self::read_indexed_file(&path)?;
        let document = crate::doc_chunker::chunk_document(&text, &indexed.path);
        let ids = crate::doc_chunker::index_chunks_to_graph(graph, &document).map_err(|e| e.to_string())?;
        indexed.node_id = ids.first().cloned();
        self.indexed_files.insert(path, indexed.clone());
        self.last_scan = Some(indexed.indexed_at.clone());
        Ok(indexed)
    }

    fn read_indexed_file(path: &Path) -> Result<(IndexedFile, String), String> {
        if !is_indexable(path) { return Err("File is not an indexable regular text file".to_string()); }
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
            let mut end = MAX_CONTENT_LENGTH;
            while !content.is_char_boundary(end) {
                end -= 1;
            }
            format!(
                "{}…\n[truncated — {} chars total]",
                &content[..end],
                content.len()
            )
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

        Ok((indexed, content))
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
    if !path.symlink_metadata().is_ok_and(|meta| meta.is_file() && !meta.file_type().is_symlink())
        || path.ancestors().any(is_ignored_component)
    {
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

fn is_ignored_component(path: &Path) -> bool {
    matches!(path.file_name().and_then(|name| name.to_str()),
        Some(".git" | ".ssh" | ".gnupg" | "node_modules" | "target" | ".venv"))
}

/// Get the user's home/Documents directory cross-platform
fn dirs_next() -> Option<PathBuf> {
    dirs::home_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_file_truncates_at_utf8_boundary() {
        let temp_dir = tempfile::tempdir().expect("temp directory");
        let path = temp_dir.path().join("unicode.md");
        let prefix = "a".repeat(MAX_CONTENT_LENGTH - 1);
        std::fs::write(&path, format!("{prefix}→tail")).expect("write fixture");

        let mut indexer = FileIndexer::new();
        let indexed = indexer.index_file(&path).expect("index UTF-8 file");

        assert!(indexed.content_preview.starts_with(&prefix));
        assert!(indexed.content_preview.contains("[truncated"));
        assert!(!indexed.content_preview.contains('→'));
    }

    #[test]
    fn full_file_indexing_retrieves_text_beyond_preview_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("long.md");
        std::fs::write(&path, format!("{}\n\nuniquetailfact retained", "intro paragraph. ".repeat(400))).unwrap();
        let graph_dir = tempfile::tempdir().unwrap();
        let graph = crate::spectrum_graph::SpectrumGraph::new(graph_dir.path()).unwrap();
        let mut indexer = FileIndexer::new();
        let first = indexer.index_file_to_graph(&path, &graph).unwrap();
        assert!(!first.content_preview.contains("uniquetailfact"));
        assert!(first.node_id.is_some());
        assert!(graph.query_intent("uniquetailfact", "query", &[]).unwrap().iter().any(|hit| hit.node.content.contains("uniquetailfact")));
        let before = graph.get_full_graph().unwrap();
        indexer.index_file_to_graph(&path, &graph).unwrap();
        let after = graph.get_full_graph().unwrap();
        assert_eq!(before.nodes.len(), after.nodes.len());
        assert_eq!(before.edges.len(), after.edges.len());
        assert!(indexer.get_indexed_files()[0].node_id.is_some());
    }

    #[test]
    fn watched_changes_reach_receiver_and_old_generations_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("changed.md");
        let mut indexer = FileIndexer::new();
        let receiver = indexer.start_watching(vec![directory.path().to_path_buf()]).unwrap();
        let generation = indexer.generation();
        std::fs::write(&path, "initial fact").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let event = receiver.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())).unwrap();
            if event.file_name() == path.file_name() {
                assert!(indexer.accepts_event(&event, generation));
                break;
            }
        }
        indexer.stop_watching();
        assert!(!indexer.accepts_event(&path, generation));
    }

    #[cfg(unix)]
    #[test]
    fn scan_does_not_follow_symlinks_or_repository_internals() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("outside.md");
        std::fs::write(&secret, "outside fixture").unwrap();
        std::os::unix::fs::symlink(&secret, directory.path().join("linked.md")).unwrap();
        std::fs::create_dir(directory.path().join(".git")).unwrap();
        std::fs::write(directory.path().join(".git/config.json"), "{}").unwrap();
        let mut indexer = FileIndexer::new();
        let _receiver = indexer.start_watching(vec![directory.path().to_path_buf()]).unwrap();
        assert!(indexer.initial_scan().is_empty());
    }
}
