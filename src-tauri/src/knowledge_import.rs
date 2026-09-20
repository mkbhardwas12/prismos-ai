//! Explicit, local-only import of reviewed Markdown knowledge packs.
//!
//! A manifest binds each reviewed document to its SHA-256 digest. Preflight
//! reads and validates the complete pack before opening the graph. Dry runs
//! never open SQLite. Applying a source uses the graph's atomic, idempotent
//! source-indexing API; a failed run can be retried without duplicating nodes.

use crate::{doc_chunker, spectrum_graph::SpectrumGraph};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const FORMAT: &str = "prismos-knowledge-pack-v1";
const MAX_DOCUMENTS: usize = 64;
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
const MAX_PACK_BYTES: usize = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    DryRun,
    Apply,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackManifest {
    format: String,
    pack_id: String,
    documents: Vec<ReviewedDocument>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReviewedDocument {
    file: String,
    reviewed: bool,
    sha256: String,
}

#[derive(Debug, Serialize)]
pub struct SourceImportReport {
    pub source: String,
    pub chunks: usize,
    /// Empty on dry runs: no persistent nodes have been created.
    pub chunk_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PackImportReport {
    pub mode: String,
    pub pack_id: String,
    /// Sources processed, including unchanged sources on repeated imports.
    pub documents: usize,
    pub chunks: usize,
    pub sources: Vec<SourceImportReport>,
}

struct PreparedPack {
    app_dir: PathBuf,
    pack_id: String,
    documents: Vec<doc_chunker::ChunkedDocument>,
}

fn existing_directory(path: &Path, description: &str) -> Result<PathBuf, String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| format!("{description} must already exist"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "{description} must be a real directory, not a symbolic link"
        ));
    }
    path.canonicalize()
        .map_err(|_| format!("Cannot resolve {description}"))
}

fn read_regular_utf8(path: &Path, limit: usize, description: &str) -> Result<String, String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| format!("Missing {description}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!(
            "{description} must be a regular file, not a symbolic link"
        ));
    }
    if metadata.len() > limit as u64 {
        return Err(format!("{description} exceeds its {limit}-byte limit"));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| format!("Cannot read {description}"))?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("Cannot read {description}"))?;
    if bytes.len() > limit {
        return Err(format!("{description} exceeds its {limit}-byte limit"));
    }
    String::from_utf8(bytes).map_err(|_| format!("{description} must be UTF-8 text"))
}

fn validate_database_targets(app_dir: &Path) -> Result<(), String> {
    for name in [
        "spectrum_graph.db",
        "spectrum_graph.db-wal",
        "spectrum_graph.db-shm",
        "spectrum_graph.db-journal",
    ] {
        match app_dir.join(name).symlink_metadata() {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return Err(format!("Refusing non-regular database target: {name}"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(format!("Cannot inspect database target: {name}")),
        }
    }
    Ok(())
}

fn prepare_pack(app_dir: &Path, pack_dir: &Path) -> Result<PreparedPack, String> {
    let app_dir = existing_directory(app_dir, "App directory")?;
    let pack_dir = existing_directory(pack_dir, "Pack directory")?;
    if app_dir == pack_dir {
        return Err("App directory and pack directory must be separate".into());
    }
    validate_database_targets(&app_dir)?;
    let manifest_text = read_regular_utf8(
        &pack_dir.join("manifest.json"),
        MAX_MANIFEST_BYTES,
        "manifest.json",
    )?;
    let manifest: PackManifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("Invalid knowledge manifest: {error}"))?;
    if manifest.format != FORMAT {
        return Err(format!("Manifest format must be {FORMAT}"));
    }
    if manifest.pack_id.is_empty()
        || manifest.pack_id.len() > 80
        || !manifest
            .pack_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || !manifest.pack_id.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err("pack_id must contain 1–80 lowercase letters, digits or hyphens and start with a letter or digit".into());
    }
    if manifest.documents.is_empty() || manifest.documents.len() > MAX_DOCUMENTS {
        return Err(format!(
            "Manifest must list 1–{MAX_DOCUMENTS} reviewed Markdown documents"
        ));
    }

    let mut listed = HashSet::new();
    let mut total_bytes = 0usize;
    let mut documents = Vec::with_capacity(manifest.documents.len());
    for entry in &manifest.documents {
        // Flat portable basenames make source identity independent of private
        // machine paths and prevent traversal, URI escaping and OS aliases.
        if entry.file.len() > 120
            || !entry.file.ends_with(".md")
            || entry.file.starts_with('.')
            || !entry.file.bytes().all(|b| {
                b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_' | b'.')
            })
            || entry.file.contains("..")
            || !listed.insert(entry.file.clone())
        {
            return Err(
                "Manifest files must be unique lowercase Markdown basenames without paths".into(),
            );
        }
        if !entry.reviewed {
            return Err(format!("Document is not marked reviewed: {}", entry.file));
        }
        if entry.sha256.len() != 64
            || !entry
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(format!(
                "Document requires a lowercase SHA-256 digest: {}",
                entry.file
            ));
        }
        let text = read_regular_utf8(&pack_dir.join(&entry.file), MAX_DOCUMENT_BYTES, &entry.file)?;
        if text.trim().is_empty() || text.contains('\0') {
            return Err(format!(
                "Document must contain nonempty Markdown text: {}",
                entry.file
            ));
        }
        let digest = format!("{:x}", Sha256::digest(text.as_bytes()));
        if digest != entry.sha256 {
            return Err(format!(
                "Review digest mismatch for {}; review the current text before importing",
                entry.file
            ));
        }
        total_bytes += text.len();
        if total_bytes > MAX_PACK_BYTES {
            return Err(format!(
                "Knowledge pack exceeds its {MAX_PACK_BYTES}-byte limit"
            ));
        }
        let source = format!("knowledge-pack://{}/{}", manifest.pack_id, entry.file);
        documents.push(doc_chunker::chunk_document(&text, &source));
    }

    // An unlisted Markdown file should not silently look like imported
    // knowledge. A flat pack also has no recursive or symbolic-link surprises.
    for result in fs::read_dir(&pack_dir).map_err(|_| "Cannot list pack directory")? {
        let entry = result.map_err(|_| "Cannot inspect pack entry")?;
        let file_type = entry.file_type().map_err(|_| "Cannot inspect pack entry")?;
        if file_type.is_symlink() || !file_type.is_file() {
            return Err("Pack directory must contain only regular files; nested directories and symbolic links are not accepted".into());
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err("Pack filenames must be valid UTF-8".into());
        };
        if name.to_ascii_lowercase().ends_with(".md") && !listed.contains(name) {
            return Err(format!("Unlisted Markdown document in pack: {name}"));
        }
    }
    Ok(PreparedPack {
        app_dir,
        pack_id: manifest.pack_id,
        documents,
    })
}

/// Import a manifest-reviewed local pack. This function never fetches sources,
/// contacts a model, trains weights, or prints document contents. `reviewed`
/// records the pack author's review; it is not independent fact verification.
pub fn import_pack(
    app_dir: &Path,
    pack_dir: &Path,
    mode: ImportMode,
) -> Result<PackImportReport, String> {
    let pack = prepare_pack(app_dir, pack_dir)?;
    let mut report = PackImportReport {
        mode: if mode == ImportMode::Apply {
            "apply"
        } else {
            "dry-run"
        }
        .into(),
        pack_id: pack.pack_id,
        documents: pack.documents.len(),
        chunks: pack
            .documents
            .iter()
            .map(|document| document.chunks.len())
            .sum(),
        sources: Vec::new(),
    };
    if mode == ImportMode::DryRun {
        report.sources = pack
            .documents
            .iter()
            .map(|document| SourceImportReport {
                source: document.source.clone(),
                chunks: document.chunks.len(),
                chunk_ids: Vec::new(),
            })
            .collect();
        return Ok(report);
    }

    // Preflight is complete. No database was opened before this point.
    validate_database_targets(&pack.app_dir)?;
    let graph = SpectrumGraph::new(&pack.app_dir)
        .map_err(|error| format!("Cannot open local knowledge graph: {error}"))?;
    for (index, document) in pack.documents.iter().enumerate() {
        let ids = doc_chunker::index_chunks_to_graph(&graph, document).map_err(|error| {
            format!("Import failed for {} after {index} source(s): {error}. Completed sources are safe to reimport.", document.source)
        })?;
        report.sources.push(SourceImportReport {
            source: document.source.clone(),
            chunks: ids.len(),
            chunk_ids: ids,
        });
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_pack(directory: &Path, documents: &[(&str, &str)]) {
        let entries: Vec<_> = documents.iter().map(|(file, text)| {
            fs::write(directory.join(file), text).unwrap();
            serde_json::json!({ "file": file, "reviewed": true, "sha256": format!("{:x}", Sha256::digest(text.as_bytes())) })
        }).collect();
        fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "format": FORMAT, "pack_id": "test-pack", "documents": entries,
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn dry_run_never_creates_or_modifies_a_database() {
        let app = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        write_pack(
            pack.path(),
            &[("grounding.md", "# Grounding\nUse cited evidence.")],
        );
        let report = import_pack(app.path(), pack.path(), ImportMode::DryRun).unwrap();
        assert_eq!(report.documents, 1);
        assert!(report.sources[0].chunk_ids.is_empty());
        assert_eq!(fs::read_dir(app.path()).unwrap().count(), 0);
        {
            let graph = SpectrumGraph::new(app.path()).unwrap();
            graph
                .add_node("Existing", "Existing user note", "note")
                .unwrap();
        }
        let before = fs::read(app.path().join("spectrum_graph.db")).unwrap();
        import_pack(app.path(), pack.path(), ImportMode::DryRun).unwrap();
        assert_eq!(
            before,
            fs::read(app.path().join("spectrum_graph.db")).unwrap()
        );
    }

    #[test]
    fn repeated_apply_keeps_ids_edges_and_user_notes() {
        let app = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        write_pack(
            pack.path(),
            &[(
                "reasoning.md",
                &"A sourced reasoning guideline. ".repeat(200),
            )],
        );
        let graph = SpectrumGraph::new(app.path()).unwrap();
        let user = graph
            .add_node("User note", "Keep this personal note.", "note")
            .unwrap();
        let first = import_pack(app.path(), pack.path(), ImportMode::Apply).unwrap();
        let before = graph.get_full_graph().unwrap();
        let second = import_pack(app.path(), pack.path(), ImportMode::Apply).unwrap();
        let after = graph.get_full_graph().unwrap();
        assert_eq!(first.sources[0].chunk_ids, second.sources[0].chunk_ids);
        assert_eq!(before.nodes.len(), after.nodes.len());
        assert_eq!(before.edges.len(), after.edges.len());
        assert!(after
            .nodes
            .iter()
            .any(|node| node.id == user.id && node.content == user.content));
        assert_eq!(
            first.sources[0].source,
            "knowledge-pack://test-pack/reasoning.md"
        );
        assert!(after
            .nodes
            .iter()
            .all(|node| !node.content.contains(&pack.path().display().to_string())));
    }

    #[test]
    fn invalid_later_document_prevents_all_writes() {
        let app = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        write_pack(
            pack.path(),
            &[
                ("first.md", "First reviewed source"),
                ("second.md", "Second reviewed source"),
            ],
        );
        fs::write(pack.path().join("second.md"), "Changed after review").unwrap();
        assert!(import_pack(app.path(), pack.path(), ImportMode::Apply)
            .unwrap_err()
            .contains("digest mismatch"));
        assert_eq!(fs::read_dir(app.path()).unwrap().count(), 0);
    }

    #[test]
    fn unlisted_or_unreviewed_markdown_is_rejected() {
        let app = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        write_pack(pack.path(), &[("first.md", "Reviewed source")]);
        fs::write(pack.path().join("unreviewed.md"), "Not reviewed").unwrap();
        assert!(import_pack(app.path(), pack.path(), ImportMode::DryRun)
            .unwrap_err()
            .contains("Unlisted"));
        let clean = tempfile::tempdir().unwrap();
        write_pack(clean.path(), &[("first.md", "Reviewed source")]);
        let manifest_path = clean.path().join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["documents"][0]["reviewed"] = false.into();
        fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(import_pack(app.path(), clean.path(), ImportMode::Apply)
            .unwrap_err()
            .contains("not marked reviewed"));
        assert_eq!(fs::read_dir(app.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn symbolic_link_document_or_database_is_rejected() {
        let app = tempfile::tempdir().unwrap();
        let pack = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        write_pack(pack.path(), &[("first.md", "Reviewed source")]);
        let linked = pack.path().join("alias.md");
        std::os::unix::fs::symlink(pack.path().join("first.md"), &linked).unwrap();
        assert!(import_pack(app.path(), pack.path(), ImportMode::Apply).is_err());
        let clean = tempfile::tempdir().unwrap();
        write_pack(clean.path(), &[("first.md", "Reviewed source")]);
        let external_db = outside.path().join("external.db");
        fs::write(&external_db, "do not touch").unwrap();
        std::os::unix::fs::symlink(&external_db, app.path().join("spectrum_graph.db")).unwrap();
        assert!(import_pack(app.path(), clean.path(), ImportMode::Apply)
            .unwrap_err()
            .contains("database target"));
        assert_eq!(fs::read_to_string(external_db).unwrap(), "do not touch");
    }
}
