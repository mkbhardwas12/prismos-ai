// PrismOS Private Vault — full-fidelity, passphrase-encrypted disaster recovery.
//
// This is deliberately separate from You-Port and portable graph sync. Those
// formats omit managed project excerpts; a Private Vault contains the complete
// SQLite database and therefore must never be committed to a source repository.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use rusqlite::{ffi, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

const PACKAGE_MAGIC: &[u8] = b"PrismOS-Private-Vault\0";
const PAYLOAD_MAGIC: &[u8] = b"PrismOS-Vault-Payload\0";
const VAULT_VERSION: u16 = 1;
const KDF_SALT_BYTES: usize = 16;
const SHA256_BYTES: usize = 32;
const MIN_CIPHERTEXT_BYTES: usize = 12 + 16;

pub const MIN_VAULT_PASSPHRASE_CHARS: usize = 16;
pub const RESTORE_CONFIRMATION_PHRASE: &str = "RESTORE MY PRIVATE PRISMOS VAULT";
const DEFAULT_VAULT_EXTENSION: &str = "prismos-vault";

pub const MAX_VAULT_DATABASE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_VAULT_AUDIT_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_VAULT_PACKAGE_BYTES: u64 = 768 * 1024 * 1024;
const MAX_AUDIT_LINE_BYTES: usize = 256 * 1024;
const MAX_AUDIT_ENTRIES: usize = 1_000_000;
const AUDIT_HASH_VERSION_V1: u8 = 1;
const AUDIT_HASH_V1_DOMAIN: &[u8] = b"PrismOS-Audit-Entry-v1\0";
const MAX_CREATED_AT_BYTES: usize = 64;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024;

const LIVE_DATABASE_FILE: &str = "spectrum_graph.db";
const LIVE_AUDIT_FILE: &str = "prismos-audit.log";
const PENDING_DATABASE_FILE: &str = ".prismos-private-vault.pending.db";
const PENDING_AUDIT_FILE: &str = ".prismos-private-vault.pending.audit";
const PENDING_MANIFEST_FILE: &str = ".prismos-private-vault.pending.json";
const INSTALL_DATABASE_FILE: &str = ".prismos-private-vault.install.db";
const INSTALL_AUDIT_FILE: &str = ".prismos-private-vault.install.audit";
const STAGE_DATABASE_FILE: &str = ".prismos-private-vault.stage.db";
const STAGE_AUDIT_FILE: &str = ".prismos-private-vault.stage.audit";
const STAGE_MANIFEST_FILE: &str = ".prismos-private-vault.stage.json";
const ROLLBACK_DATABASE_FILE: &str = ".prismos-private-vault.rollback.db";
const ROLLBACK_WAL_FILE: &str = ".prismos-private-vault.rollback.db-wal";
const ROLLBACK_SHM_FILE: &str = ".prismos-private-vault.rollback.db-shm";
const ROLLBACK_AUDIT_FILE: &str = ".prismos-private-vault.rollback.audit";

type VaultResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateVaultExportResult {
    pub success: bool,
    pub destination: String,
    pub created_at: String,
    pub database_bytes: u64,
    pub audit_bytes: u64,
    pub package_bytes: u64,
    pub audit_included: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateVaultStageResult {
    pub success: bool,
    pub restart_required: bool,
    pub created_at: String,
    pub database_bytes: u64,
    pub audit_bytes: u64,
    pub audit_included: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateVaultStartupResult {
    pub applied: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingRestoreManifest {
    format: String,
    version: u16,
    created_at: String,
    database_bytes: u64,
    database_sha256: String,
    audit_included: bool,
    audit_bytes: u64,
    audit_sha256: Option<String>,
}

#[derive(Debug)]
struct ValidatedPayload<'a> {
    created_at: String,
    database: &'a [u8],
    audit: Option<&'a [u8]>,
    database_sha256: [u8; SHA256_BYTES],
    audit_sha256: Option<[u8; SHA256_BYTES]>,
}

#[derive(Debug)]
struct DatabaseValidation {
    schema_version: u32,
    schema_objects: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuditEntry {
    #[serde(default)]
    hash_version: u8,
    index: u64,
    timestamp: String,
    action: String,
    actor: String,
    details: String,
    prev_hash: String,
    hash: String,
}

struct ByteReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn take(&mut self, length: usize, field: &str) -> VaultResult<&'a [u8]> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| format!("{field} length overflow"))?;
        if end > self.bytes.len() {
            return Err(format!("Private vault is truncated while reading {field}").into());
        }
        let value = &self.bytes[self.position..end];
        self.position = end;
        Ok(value)
    }

    fn u16(&mut self, field: &str) -> VaultResult<u16> {
        let bytes: [u8; 2] = self.take(2, field)?.try_into()?;
        Ok(u16::from_be_bytes(bytes))
    }

    fn u32(&mut self, field: &str) -> VaultResult<u32> {
        let bytes: [u8; 4] = self.take(4, field)?.try_into()?;
        Ok(u32::from_be_bytes(bytes))
    }

    fn u64(&mut self, field: &str) -> VaultResult<u64> {
        let bytes: [u8; 8] = self.take(8, field)?.try_into()?;
        Ok(u64::from_be_bytes(bytes))
    }

    fn finish(&self) -> VaultResult<()> {
        if self.position != self.bytes.len() {
            return Err("Private vault contains unexpected trailing bytes".into());
        }
        Ok(())
    }
}

fn validate_vault_passphrase(passphrase: &str) -> VaultResult<()> {
    let characters = passphrase.chars().count();
    if characters < MIN_VAULT_PASSPHRASE_CHARS {
        return Err(format!(
            "Private-vault passphrases must contain at least {MIN_VAULT_PASSPHRASE_CHARS} characters"
        )
        .into());
    }
    if passphrase.len() > 1024 {
        return Err("Private-vault passphrase is too long".into());
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> [u8; SHA256_BYTES] {
    Sha256::digest(bytes).into()
}

fn hex_sha256(hash: &[u8; SHA256_BYTES]) -> String {
    hex::encode(hash)
}

fn parse_hex_sha256(value: &str, field: &str) -> VaultResult<[u8; SHA256_BYTES]> {
    if value.len() != SHA256_BYTES * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(format!("Invalid {field} hash").into());
    }
    let decoded = hex::decode(value)?;
    Ok(decoded
        .try_into()
        .map_err(|_| format!("Invalid {field} hash length"))?)
}

fn checked_usize(value: u64, field: &str) -> VaultResult<usize> {
    usize::try_from(value).map_err(|_| format!("{field} is too large for this platform").into())
}

fn ensure_private_directory(app_dir: &Path) -> VaultResult<()> {
    match fs::symlink_metadata(app_dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("App data path must be a regular, non-symlink directory".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(app_dir)?;
            let metadata = fs::symlink_metadata(app_dir)?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("App data path became an unsafe directory".into());
            }
        }
        Err(error) => return Err(error.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(app_dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn reject_symlink_or_non_file(path: &Path, label: &str) -> VaultResult<fs::Metadata> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("Cannot inspect {label}: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} must be a regular, non-symlink file").into());
    }
    Ok(metadata)
}

fn path_exists_without_following(path: &Path) -> VaultResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn ensure_absent(path: &Path, label: &str) -> VaultResult<()> {
    if path_exists_without_following(path)? {
        return Err(format!("{label} already exists; refusing to overwrite it").into());
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> VaultResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn create_private_file(path: &Path) -> VaultResult<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    if let Err(error) = set_private_file_permissions(path) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(file)
}

fn write_new_private_file(path: &Path, bytes: &[u8]) -> VaultResult<()> {
    let mut file = create_private_file(path)?;
    if let Err(error) = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()
    })() {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}

fn sync_directory(path: &Path) -> VaultResult<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()?;
    }
    Ok(())
}

fn same_file_identity(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return false;
        }
    }
    true
}

fn read_regular_file_bounded(path: &Path, max_bytes: u64, label: &str) -> VaultResult<Vec<u8>> {
    let before = reject_symlink_or_non_file(path, label)?;
    if before.len() > max_bytes {
        return Err(format!("{label} exceeds the {max_bytes}-byte limit").into());
    }
    let mut file = File::open(path)?;
    let opened_before = file.metadata()?;
    if !same_file_identity(&before, &opened_before) {
        return Err(format!("{label} changed before it could be read").into());
    }
    let capacity = checked_usize(before.len().min(max_bytes), label)?;
    let mut bytes = Vec::with_capacity(capacity);
    (&mut file)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("{label} grew beyond the {max_bytes}-byte limit").into());
    }
    let opened_after = file.metadata()?;
    if !same_file_identity(&opened_before, &opened_after)
        || bytes.len() as u64 != opened_after.len()
    {
        return Err(format!("{label} changed while it was being read").into());
    }
    Ok(bytes)
}

fn ensure_destination_outside_git(destination: &Path) -> VaultResult<PathBuf> {
    let parent = destination
        .parent()
        .ok_or("Private-vault destination must have a parent directory")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Cannot resolve vault destination directory: {error}"))?;
    let file_name = destination
        .file_name()
        .ok_or("Private-vault destination requires a file name")?;
    if file_name.is_empty() {
        return Err("Private-vault destination requires a file name".into());
    }
    if destination.extension().and_then(|value| value.to_str()) != Some(DEFAULT_VAULT_EXTENSION) {
        return Err(
            format!("Private-vault destination must end in .{DEFAULT_VAULT_EXTENSION}").into(),
        );
    }
    for ancestor in canonical_parent.ancestors() {
        let marker = ancestor.join(".git");
        match fs::symlink_metadata(&marker) {
            Ok(_) => return Err(
                "Private vaults contain personal data and cannot be written inside a Git worktree"
                    .into(),
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(canonical_parent.join(file_name))
}

fn ensure_directory_outside_git(directory: &Path, label: &str) -> VaultResult<()> {
    let canonical = directory
        .canonicalize()
        .map_err(|error| format!("Cannot resolve {label}: {error}"))?;
    for ancestor in canonical.ancestors() {
        match fs::symlink_metadata(ancestor.join(".git")) {
            Ok(_) => {
                return Err(format!(
                    "{label} cannot be inside a Git worktree because private-vault data must never enter source control"
                )
                .into())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn read_optional_audit(app_dir: &Path) -> VaultResult<Option<Vec<u8>>> {
    let path = app_dir.join(LIVE_AUDIT_FILE);
    if !path_exists_without_following(&path)? {
        return Ok(None);
    }
    let bytes = read_regular_file_bounded(&path, MAX_VAULT_AUDIT_BYTES, "audit log")?;
    validate_audit_bytes(&bytes)?;
    Ok(Some(bytes))
}

fn compute_audit_entry_hash(entry: &AuditEntry) -> VaultResult<String> {
    let mut hasher = Sha256::new();
    match entry.hash_version {
        0 => {
            hasher.update(entry.index.to_le_bytes());
            hasher.update(entry.timestamp.as_bytes());
            hasher.update(entry.action.as_bytes());
            hasher.update(entry.actor.as_bytes());
            hasher.update(entry.details.as_bytes());
            hasher.update(entry.prev_hash.as_bytes());
        }
        AUDIT_HASH_VERSION_V1 => {
            hasher.update(AUDIT_HASH_V1_DOMAIN);
            hasher.update([entry.hash_version]);
            hasher.update(entry.index.to_le_bytes());
            for value in [
                entry.timestamp.as_bytes(),
                entry.action.as_bytes(),
                entry.actor.as_bytes(),
                entry.details.as_bytes(),
                entry.prev_hash.as_bytes(),
            ] {
                let length = u64::try_from(value.len())
                    .map_err(|_| "Audit hash field length exceeds u64")?;
                hasher.update(length.to_le_bytes());
                hasher.update(value);
            }
        }
        version => return Err(format!("Unsupported audit hash version {version}").into()),
    }
    Ok(hex::encode(hasher.finalize()))
}

fn validate_audit_bytes(bytes: &[u8]) -> VaultResult<()> {
    if bytes.is_empty() {
        return Err("Included audit log is empty".into());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "Audit log is not valid UTF-8")?;
    let mut expected_prev_hash = "0".repeat(64);
    let mut expected_index = 0_u64;
    let mut previous_hash_version = 0_u8;
    let mut count = 0_usize;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        count = count.checked_add(1).ok_or("Audit entry count overflow")?;
        if count > MAX_AUDIT_ENTRIES {
            return Err("Audit log contains too many entries".into());
        }
        if line.len() > MAX_AUDIT_LINE_BYTES {
            return Err("Audit log contains an oversized entry".into());
        }
        let entry: AuditEntry = serde_json::from_str(line)
            .map_err(|error| format!("Invalid audit entry {expected_index}: {error}"))?;
        if entry.index != expected_index {
            return Err(format!("Audit entry index {} is out of sequence", entry.index).into());
        }
        if entry.hash_version > AUDIT_HASH_VERSION_V1 {
            return Err(format!(
                "Audit entry {} uses unsupported hash version {}",
                entry.index, entry.hash_version
            )
            .into());
        }
        if entry.hash_version < previous_hash_version {
            return Err(format!(
                "Audit hash version downgrade at entry {}: {} to {}",
                entry.index, previous_hash_version, entry.hash_version
            )
            .into());
        }
        DateTime::parse_from_rfc3339(&entry.timestamp)
            .map_err(|_| format!("Audit entry {} has an invalid timestamp", entry.index))?;
        if entry.timestamp.len() > 128
            || entry.action.is_empty()
            || entry.action.len() > 256
            || entry.actor.is_empty()
            || entry.actor.len() > 256
            || entry.details.len() > 128 * 1024
        {
            return Err(format!("Audit entry {} exceeds field limits", entry.index).into());
        }
        parse_hex_sha256(&entry.prev_hash, "audit previous")?;
        parse_hex_sha256(&entry.hash, "audit entry")?;
        if entry.prev_hash != expected_prev_hash {
            return Err(format!("Audit chain breaks at entry {}", entry.index).into());
        }
        let recomputed = compute_audit_entry_hash(&entry)
            .map_err(|error| format!("Audit entry {}: {error}", entry.index))?;
        if recomputed != entry.hash {
            return Err(format!("Audit hash mismatch at entry {}", entry.index).into());
        }
        expected_prev_hash = entry.hash;
        previous_hash_version = entry.hash_version;
        expected_index = expected_index
            .checked_add(1)
            .ok_or("Audit index overflow")?;
    }
    if count == 0 {
        return Err("Included audit log has no entries".into());
    }
    Ok(())
}

fn expected_table_columns() -> HashMap<&'static str, BTreeSet<&'static str>> {
    HashMap::from([
        (
            "nodes",
            BTreeSet::from([
                "id",
                "label",
                "content",
                "node_type",
                "layer",
                "embedding",
                "access_count",
                "last_accessed",
                "created_at",
                "updated_at",
                "knowledge_source_id",
                "source_path",
                "content_hash",
                "source_generation",
            ]),
        ),
        (
            "edges",
            BTreeSet::from([
                "id",
                "source_id",
                "target_id",
                "relation",
                "weight",
                "momentum",
                "reinforcements",
                "last_reinforced",
                "created_at",
            ]),
        ),
        (
            "intent_log",
            BTreeSet::from([
                "id",
                "raw_input",
                "intent_type",
                "matched_nodes",
                "confidence",
                "created_at",
            ]),
        ),
        (
            "feedback",
            BTreeSet::from(["id", "edge_id", "signal", "source", "created_at"]),
        ),
        (
            "response_feedback",
            BTreeSet::from([
                "id",
                "conversation_id",
                "question",
                "response",
                "rating",
                "context_nodes",
                "model",
                "created_at",
            ]),
        ),
        (
            "cognitive_profile",
            BTreeSet::from([
                "id",
                "depth",
                "creativity",
                "formality",
                "technical_level",
                "example_preference",
                "interaction_count",
                "last_updated",
            ]),
        ),
        (
            "cognitive_timeline",
            BTreeSet::from([
                "id",
                "iso_week",
                "depth",
                "creativity",
                "formality",
                "technical_level",
                "example_preference",
                "interaction_count",
                "snapshot_at",
            ]),
        ),
        (
            "dismissed_predictions",
            BTreeSet::from(["id", "source_id", "target_id", "dismissed_at"]),
        ),
        (
            "refraction_log",
            BTreeSet::from([
                "id",
                "query",
                "query_type",
                "natural_band",
                "applied_band",
                "user_override",
                "created_at",
            ]),
        ),
        (
            "agent_memory",
            BTreeSet::from([
                "id",
                "agent_name",
                "memory_key",
                "memory_value",
                "content_hash",
                "created_at",
                "updated_at",
            ]),
        ),
        (
            "domain_profile",
            BTreeSet::from([
                "id",
                "domain_counts",
                "total_queries",
                "primary_domain",
                "confidence",
                "last_updated",
            ]),
        ),
        (
            "model_performance",
            BTreeSet::from([
                "id",
                "model_name",
                "domain",
                "latency_ms",
                "satisfaction",
                "query_type",
                "created_at",
            ]),
        ),
        (
            "knowledge_sources",
            BTreeSet::from([
                "id",
                "name",
                "root_path",
                "file_count",
                "chunk_count",
                "bytes_indexed",
                "skipped_files",
                "error_count",
                "status",
                "last_indexed",
                "updated_at",
            ]),
        ),
        (
            "prismos_internal_migrations",
            BTreeSet::from(["id", "applied_at"]),
        ),
    ])
}

fn allowed_index_names() -> BTreeSet<&'static str> {
    BTreeSet::from([
        "idx_edges_source",
        "idx_edges_target",
        "idx_edges_weight",
        "idx_nodes_type",
        "idx_nodes_layer",
        "idx_nodes_updated",
        "idx_nodes_access",
        "idx_nodes_knowledge_source",
        "idx_nodes_source_path",
        "idx_nodes_content_hash",
        "idx_intent_log_type",
        "idx_intent_log_time",
        "idx_feedback_edge",
        "idx_response_fb_conv",
        "idx_response_fb_rating",
        "idx_cognitive_timeline_week",
        "idx_refraction_log_time",
        "idx_agent_memory_agent",
        "idx_agent_memory_hash",
        "idx_model_performance_model",
        "idx_domain_profile_domain",
        "idx_knowledge_sources_path",
    ])
}

fn strip_sql_whitespace(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_ascii_whitespace())
        .flat_map(char::to_lowercase)
        .collect()
}

fn expected_trigger_sql(name: &str) -> Option<&'static str> {
    match name {
        "nodes_fts_ai" => Some(
            "CREATE TRIGGER nodes_fts_ai AFTER INSERT ON nodes BEGIN
             INSERT INTO nodes_fts(rowid, label, content)
             VALUES (new.rowid, new.label, new.content);
             END",
        ),
        "nodes_fts_ad" => Some(
            "CREATE TRIGGER nodes_fts_ad AFTER DELETE ON nodes BEGIN
             INSERT INTO nodes_fts(nodes_fts, rowid, label, content)
             VALUES ('delete', old.rowid, old.label, old.content);
             END",
        ),
        "nodes_fts_au" => Some(
            "CREATE TRIGGER nodes_fts_au AFTER UPDATE OF label, content ON nodes BEGIN
             INSERT INTO nodes_fts(nodes_fts, rowid, label, content)
             VALUES ('delete', old.rowid, old.label, old.content);
             INSERT INTO nodes_fts(rowid, label, content)
             VALUES (new.rowid, new.label, new.content);
             END",
        ),
        _ => None,
    }
}

fn deserialize_database(bytes: &[u8]) -> VaultResult<Connection> {
    if bytes.len() > i64::MAX as usize {
        return Err("Database is too large for SQLite deserialization".into());
    }
    let connection = Connection::open_in_memory()?;
    let raw = unsafe { ffi::sqlite3_malloc64(bytes.len() as u64) as *mut u8 };
    let pointer =
        NonNull::new(raw).ok_or("SQLite could not allocate database validation memory")?;
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.as_ptr(), bytes.len());
    }
    let schema = b"main\0";
    // A database backed up while the live connection uses WAL retains that
    // journal-mode flag in page 1. SQLite cannot attach such an image as a
    // read-only deserialized database because there is no filesystem WAL to
    // open. Keep the isolated in-memory image resizeable, then immediately set
    // query_only before inspecting any untrusted schema.
    let flags = ffi::SQLITE_DESERIALIZE_FREEONCLOSE | ffi::SQLITE_DESERIALIZE_RESIZEABLE;
    let result = unsafe {
        ffi::sqlite3_deserialize(
            connection.handle(),
            schema.as_ptr().cast(),
            pointer.as_ptr(),
            bytes.len() as i64,
            bytes.len() as i64,
            flags,
        )
    };
    if result != ffi::SQLITE_OK {
        unsafe { ffi::sqlite3_free(pointer.as_ptr().cast()) };
        return Err(format!("SQLite rejected the restored database (error {result})").into());
    }
    connection.execute_batch("PRAGMA trusted_schema=OFF;")?;
    Ok(connection)
}

fn validate_database_bytes(bytes: &[u8]) -> VaultResult<DatabaseValidation> {
    if bytes.len() < 100 || bytes.len() as u64 > MAX_VAULT_DATABASE_BYTES {
        return Err("Restored database is outside the supported size bounds".into());
    }
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Restored database does not have a valid SQLite header".into());
    }

    let connection = deserialize_database(bytes)?;
    let integrity: String =
        connection.query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(
            format!("Restored database failed SQLite integrity validation: {integrity}").into(),
        );
    }
    let mut foreign_keys = connection.prepare("PRAGMA foreign_key_check")?;
    if foreign_keys.query([])?.next()?.is_some() {
        return Err("Restored database contains broken foreign-key references".into());
    }
    drop(foreign_keys);
    connection.execute_batch("PRAGMA query_only=ON;")?;

    let expected_tables = expected_table_columns();
    let allowed_indexes = allowed_index_names();
    let fts_shadow_tables = BTreeSet::from([
        "nodes_fts_data",
        "nodes_fts_idx",
        "nodes_fts_docsize",
        "nodes_fts_config",
    ]);
    let expected_fts_sql = strip_sql_whitespace(
        "CREATE VIRTUAL TABLE nodes_fts USING fts5(
         label, content, content='nodes', content_rowid='rowid', tokenize='unicode61')",
    );

    let mut statement = connection.prepare(
        "SELECT type, name, COALESCE(sql, '')
         FROM sqlite_schema
         ORDER BY type, name",
    )?;
    let objects = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut observed_tables = BTreeSet::new();
    let mut has_fts = false;
    let mut object_count = 0_u32;
    let mut schema_text_bytes = 0_usize;
    for object in objects {
        let (object_type, name, sql) = object?;
        object_count = object_count
            .checked_add(1)
            .ok_or("Schema object count overflow")?;
        if object_count > 256 {
            return Err("Restored database contains too many schema objects".into());
        }
        schema_text_bytes = schema_text_bytes
            .checked_add(sql.len())
            .ok_or("Schema text size overflow")?;
        if schema_text_bytes > 2 * 1024 * 1024 || name.len() > 256 || sql.len() > 256 * 1024 {
            return Err("Restored database schema exceeds validation bounds".into());
        }

        match object_type.as_str() {
            "table" if expected_tables.contains_key(name.as_str()) => {
                observed_tables.insert(name.clone());
            }
            "table" if name == "nodes_fts" => {
                if strip_sql_whitespace(&sql) != expected_fts_sql {
                    return Err("Restored database has an unexpected full-text schema".into());
                }
                has_fts = true;
            }
            "table" if fts_shadow_tables.contains(name.as_str()) => {}
            "index" if name.starts_with("sqlite_autoindex_") && sql.is_empty() => {}
            "index" if allowed_indexes.contains(name.as_str()) => {}
            "trigger" => {
                let expected = expected_trigger_sql(&name).ok_or_else(|| {
                    format!("Restored database contains an unknown trigger '{name}'")
                })?;
                if strip_sql_whitespace(&sql) != strip_sql_whitespace(expected) {
                    return Err(format!("Restored database trigger '{name}' was modified").into());
                }
            }
            _ => {
                return Err(format!(
                    "Restored database contains unsupported schema object {object_type} '{name}'"
                )
                .into())
            }
        }
    }

    let required_tables: BTreeSet<String> = expected_tables
        .keys()
        .map(|name| (*name).to_string())
        .collect();
    if observed_tables != required_tables {
        return Err("Restored database is missing required PrismOS tables".into());
    }
    let has_any_fts_shadow = fts_shadow_tables.iter().any(|name| {
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                [*name],
                |row| row.get::<_, bool>(0),
            )
            .unwrap_or(false)
    });
    if has_fts != has_any_fts_shadow {
        return Err("Restored database has an incomplete full-text index schema".into());
    }
    if has_fts {
        for name in &fts_shadow_tables {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
                [*name],
                |row| row.get(0),
            )?;
            if !exists {
                return Err("Restored database has an incomplete full-text index".into());
            }
        }
        for trigger in ["nodes_fts_ai", "nodes_fts_ad", "nodes_fts_au"] {
            let exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?1)",
                [trigger],
                |row| row.get(0),
            )?;
            if !exists {
                return Err("Restored database is missing a full-text maintenance trigger".into());
            }
        }
    }

    for (table, expected_columns) in &expected_tables {
        let mut column_statement =
            connection.prepare("SELECT name FROM pragma_table_info(?1) ORDER BY name")?;
        let columns = column_statement
            .query_map([*table], |row| row.get::<_, String>(0))?
            .collect::<Result<BTreeSet<_>, _>>()?;
        let expected: BTreeSet<String> = expected_columns
            .iter()
            .map(|name| (*name).to_string())
            .collect();
        if columns != expected {
            return Err(format!(
                "Restored database table '{table}' has an unexpected column layout"
            )
            .into());
        }
    }

    let schema_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let schema_version = u32::try_from(schema_version)
        .map_err(|_| "Restored database has an invalid schema version")?;
    Ok(DatabaseValidation {
        schema_version,
        schema_objects: object_count,
    })
}

fn build_payload(
    created_at: &str,
    database: &[u8],
    audit: Option<&[u8]>,
    database_validation: &DatabaseValidation,
) -> VaultResult<Zeroizing<Vec<u8>>> {
    if created_at.len() > MAX_CREATED_AT_BYTES {
        return Err("Vault timestamp exceeds its format bound".into());
    }
    let created_len = u16::try_from(created_at.len())?;
    let database_len = u64::try_from(database.len())?;
    if database_len > MAX_VAULT_DATABASE_BYTES {
        return Err("Database exceeds the private-vault limit".into());
    }
    let audit_len = match audit {
        Some(bytes) => {
            let length = u64::try_from(bytes.len())?;
            if length == 0 || length > MAX_VAULT_AUDIT_BYTES {
                return Err("Audit log exceeds the private-vault bounds".into());
            }
            length
        }
        None => u64::MAX,
    };
    let database_hash = sha256(database);
    let audit_hash = audit.map(sha256).unwrap_or([0; SHA256_BYTES]);
    let audit_size = audit.map_or(0_usize, <[u8]>::len);
    let capacity = PAYLOAD_MAGIC
        .len()
        .checked_add(2 + 2 + 4 + 4 + 8 + 8 + SHA256_BYTES * 2)
        .and_then(|value| value.checked_add(created_at.len()))
        .and_then(|value| value.checked_add(database.len()))
        .and_then(|value| value.checked_add(audit_size))
        .ok_or("Private-vault payload size overflow")?;
    if capacity as u64 > MAX_VAULT_PACKAGE_BYTES {
        return Err("Private-vault plaintext exceeds the package limit".into());
    }

    let mut payload = Zeroizing::new(Vec::with_capacity(capacity));
    payload.extend_from_slice(PAYLOAD_MAGIC);
    payload.extend_from_slice(&VAULT_VERSION.to_be_bytes());
    payload.extend_from_slice(&created_len.to_be_bytes());
    payload.extend_from_slice(&database_validation.schema_version.to_be_bytes());
    payload.extend_from_slice(&database_validation.schema_objects.to_be_bytes());
    payload.extend_from_slice(&database_len.to_be_bytes());
    payload.extend_from_slice(&audit_len.to_be_bytes());
    payload.extend_from_slice(&database_hash);
    payload.extend_from_slice(&audit_hash);
    payload.extend_from_slice(created_at.as_bytes());
    payload.extend_from_slice(database);
    if let Some(audit) = audit {
        payload.extend_from_slice(audit);
    }
    Ok(payload)
}

fn parse_and_validate_payload(payload: &[u8]) -> VaultResult<ValidatedPayload<'_>> {
    let mut reader = ByteReader::new(payload);
    if reader.take(PAYLOAD_MAGIC.len(), "payload magic")? != PAYLOAD_MAGIC {
        return Err("Private-vault payload has an invalid signature".into());
    }
    if reader.u16("payload version")? != VAULT_VERSION {
        return Err("Unsupported private-vault payload version".into());
    }
    let created_len = reader.u16("timestamp length")? as usize;
    if created_len == 0 || created_len > MAX_CREATED_AT_BYTES {
        return Err("Private-vault timestamp length is invalid".into());
    }
    let stored_schema_version = reader.u32("schema version")?;
    let stored_schema_objects = reader.u32("schema object count")?;
    if stored_schema_objects == 0 || stored_schema_objects > 256 {
        return Err("Private-vault schema object count is invalid".into());
    }
    let database_len_u64 = reader.u64("database length")?;
    if !(100..=MAX_VAULT_DATABASE_BYTES).contains(&database_len_u64) {
        return Err("Private-vault database length is outside supported bounds".into());
    }
    let audit_len_u64 = reader.u64("audit length")?;
    if audit_len_u64 != u64::MAX && (audit_len_u64 == 0 || audit_len_u64 > MAX_VAULT_AUDIT_BYTES) {
        return Err("Private-vault audit length is outside supported bounds".into());
    }
    let stored_database_hash: [u8; SHA256_BYTES] =
        reader.take(SHA256_BYTES, "database hash")?.try_into()?;
    let stored_audit_hash: [u8; SHA256_BYTES] =
        reader.take(SHA256_BYTES, "audit hash")?.try_into()?;
    let created_at_bytes = reader.take(created_len, "created timestamp")?;
    let created_at = std::str::from_utf8(created_at_bytes)
        .map_err(|_| "Private-vault timestamp is not UTF-8")?
        .to_string();
    DateTime::parse_from_rfc3339(&created_at)
        .map_err(|_| "Private-vault timestamp is not RFC 3339")?;
    let database_len = checked_usize(database_len_u64, "database length")?;
    let database = reader.take(database_len, "database")?;
    let audit = if audit_len_u64 == u64::MAX {
        if stored_audit_hash != [0; SHA256_BYTES] {
            return Err("Private-vault absent audit log has a non-empty hash".into());
        }
        None
    } else {
        let audit_len = checked_usize(audit_len_u64, "audit length")?;
        Some(reader.take(audit_len, "audit log")?)
    };
    reader.finish()?;

    let database_hash = sha256(database);
    if database_hash != stored_database_hash {
        return Err("Private-vault database checksum mismatch".into());
    }
    let audit_hash = match audit {
        Some(bytes) => {
            let hash = sha256(bytes);
            if hash != stored_audit_hash {
                return Err("Private-vault audit checksum mismatch".into());
            }
            validate_audit_bytes(bytes)?;
            Some(hash)
        }
        None => None,
    };
    let database_validation = validate_database_bytes(database)?;
    if database_validation.schema_version != stored_schema_version
        || database_validation.schema_objects != stored_schema_objects
    {
        return Err("Private-vault database schema metadata does not match its contents".into());
    }

    Ok(ValidatedPayload {
        created_at,
        database,
        audit,
        database_sha256: database_hash,
        audit_sha256: audit_hash,
    })
}

fn encrypt_package(payload: &[u8], passphrase: &str) -> VaultResult<Vec<u8>> {
    validate_vault_passphrase(passphrase)?;
    let salt_base64 = crate::you_port::generate_kdf_salt()?;
    let salt = BASE64.decode(&salt_base64)?;
    if salt.len() != KDF_SALT_BYTES {
        return Err("Generated private-vault KDF salt has an invalid length".into());
    }
    let mut key = crate::you_port::derive_passphrase_key(
        passphrase,
        &salt_base64,
        crate::you_port::PASSPHRASE_KDF_ITERATIONS,
    )?;
    let ciphertext_result = crate::you_port::aes_encrypt(&key, payload);
    key.zeroize();
    let ciphertext = ciphertext_result?;
    let ciphertext_len = u64::try_from(ciphertext.len())?;
    let package_len = PACKAGE_MAGIC
        .len()
        .checked_add(2 + 4 + KDF_SALT_BYTES + 8 + SHA256_BYTES)
        .and_then(|value| value.checked_add(ciphertext.len()))
        .ok_or("Private-vault package size overflow")?;
    if package_len as u64 > MAX_VAULT_PACKAGE_BYTES {
        return Err("Encrypted private vault exceeds the package limit".into());
    }
    let ciphertext_hash = sha256(&ciphertext);
    let mut package = Vec::with_capacity(package_len);
    package.extend_from_slice(PACKAGE_MAGIC);
    package.extend_from_slice(&VAULT_VERSION.to_be_bytes());
    package.extend_from_slice(&crate::you_port::PASSPHRASE_KDF_ITERATIONS.to_be_bytes());
    package.extend_from_slice(&salt);
    package.extend_from_slice(&ciphertext_len.to_be_bytes());
    package.extend_from_slice(&ciphertext_hash);
    package.extend_from_slice(&ciphertext);
    Ok(package)
}

fn decrypt_package(package: &[u8], passphrase: &str) -> VaultResult<Zeroizing<Vec<u8>>> {
    validate_vault_passphrase(passphrase)?;
    if package.len() as u64 > MAX_VAULT_PACKAGE_BYTES {
        return Err("Private-vault package exceeds the supported size limit".into());
    }
    let mut reader = ByteReader::new(package);
    if reader.take(PACKAGE_MAGIC.len(), "package magic")? != PACKAGE_MAGIC {
        return Err("File is not a PrismOS Private Vault".into());
    }
    if reader.u16("package version")? != VAULT_VERSION {
        return Err("Unsupported private-vault package version".into());
    }
    let iterations = reader.u32("KDF iterations")?;
    if iterations != crate::you_port::PASSPHRASE_KDF_ITERATIONS {
        return Err("Unsupported private-vault KDF parameters".into());
    }
    let salt = reader.take(KDF_SALT_BYTES, "KDF salt")?;
    let ciphertext_len_u64 = reader.u64("ciphertext length")?;
    if ciphertext_len_u64 < MIN_CIPHERTEXT_BYTES as u64
        || ciphertext_len_u64 > MAX_VAULT_PACKAGE_BYTES
    {
        return Err("Private-vault ciphertext length is outside supported bounds".into());
    }
    let stored_ciphertext_hash: [u8; SHA256_BYTES] =
        reader.take(SHA256_BYTES, "ciphertext hash")?.try_into()?;
    let ciphertext_len = checked_usize(ciphertext_len_u64, "ciphertext length")?;
    let ciphertext = reader.take(ciphertext_len, "ciphertext")?;
    reader.finish()?;
    if sha256(ciphertext) != stored_ciphertext_hash {
        return Err("Private-vault ciphertext checksum mismatch".into());
    }

    let salt_base64 = BASE64.encode(salt);
    let mut key = crate::you_port::derive_passphrase_key(passphrase, &salt_base64, iterations)?;
    let plaintext_result = crate::you_port::aes_decrypt(&key, ciphertext);
    key.zeroize();
    let plaintext = plaintext_result
        .map_err(|_| "Private-vault authentication failed (wrong passphrase or tampered file)")?;
    if plaintext.len() as u64 > MAX_VAULT_PACKAGE_BYTES {
        return Err("Decrypted private-vault payload exceeds the supported size limit".into());
    }
    Ok(Zeroizing::new(plaintext))
}

fn write_package_without_overwrite(destination: &Path, bytes: &[u8]) -> VaultResult<()> {
    ensure_absent(destination, "Private-vault destination")?;
    let parent = destination
        .parent()
        .ok_or("Vault destination has no parent")?;
    let temporary = parent.join(format!(".prismos-vault-{}.part", Uuid::new_v4()));
    ensure_absent(&temporary, "Private-vault temporary file")?;
    write_new_private_file(&temporary, bytes)?;
    let link_result = fs::hard_link(&temporary, destination);
    if let Err(error) = link_result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Cannot publish private vault without overwriting: {error}").into());
    }
    if let Err(error) = set_private_file_permissions(destination) {
        let _ = fs::remove_file(destination);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::remove_file(&temporary) {
        let _ = fs::remove_file(destination);
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    sync_directory(parent)?;
    Ok(())
}

/// Export a full-fidelity encrypted vault. `destination` must be in an existing
/// directory outside every Git worktree, and it must not already exist.
pub fn export_private_vault(
    graph: &crate::spectrum_graph::SpectrumGraph,
    app_dir: &Path,
    destination: &Path,
    passphrase: &str,
) -> VaultResult<PrivateVaultExportResult> {
    validate_vault_passphrase(passphrase)?;
    ensure_private_directory(app_dir)?;
    let destination = ensure_destination_outside_git(destination)?;
    ensure_absent(&destination, "Private-vault destination")?;

    let database = Zeroizing::new(graph.full_database_backup_bytes(MAX_VAULT_DATABASE_BYTES)?);
    let validation = validate_database_bytes(&database)?;
    let audit = read_optional_audit(app_dir)?.map(Zeroizing::new);
    let created_at = Utc::now().to_rfc3339();
    let payload = build_payload(
        &created_at,
        &database,
        audit.as_deref().map(Vec::as_slice),
        &validation,
    )?;
    let package = encrypt_package(&payload, passphrase)?;
    write_package_without_overwrite(&destination, &package)?;

    Ok(PrivateVaultExportResult {
        success: true,
        destination: destination.to_string_lossy().to_string(),
        created_at,
        database_bytes: database.len() as u64,
        audit_bytes: audit.as_ref().map_or(0, |bytes| bytes.len() as u64),
        package_bytes: package.len() as u64,
        audit_included: audit.is_some(),
        message: "Encrypted private vault created outside Git. Store the vault and its passphrase separately.".into(),
    })
}

fn publish_staged_file(temporary: &Path, destination: &Path) -> VaultResult<()> {
    ensure_absent(destination, "Pending restore file")?;
    fs::hard_link(temporary, destination)?;
    set_private_file_permissions(destination)?;
    fs::remove_file(temporary)?;
    Ok(())
}

fn remove_internal_file(path: &Path) -> VaultResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "Refusing to remove unsafe private-vault control path {}",
                    path.display()
                )
                .into());
            }
            fs::remove_file(path)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn pending_control_paths(app_dir: &Path) -> [PathBuf; 12] {
    [
        app_dir.join(PENDING_DATABASE_FILE),
        app_dir.join(PENDING_AUDIT_FILE),
        app_dir.join(PENDING_MANIFEST_FILE),
        app_dir.join(INSTALL_DATABASE_FILE),
        app_dir.join(INSTALL_AUDIT_FILE),
        app_dir.join(ROLLBACK_DATABASE_FILE),
        app_dir.join(ROLLBACK_WAL_FILE),
        app_dir.join(ROLLBACK_SHM_FILE),
        app_dir.join(ROLLBACK_AUDIT_FILE),
        app_dir.join(STAGE_DATABASE_FILE),
        app_dir.join(STAGE_AUDIT_FILE),
        app_dir.join(STAGE_MANIFEST_FILE),
    ]
}

/// Discard every in-app pending/install/stage/rollback restore artifact before
/// an explicit Clear All operation erases the live graph. This prevents a
/// previously staged or interrupted restore from resurrecting cleared data on
/// the next launch. External vault files are intentionally outside this scope.
pub fn discard_restore_control_artifacts(app_dir: &Path) -> VaultResult<usize> {
    let paths = pending_control_paths(app_dir);
    let mut present = 0usize;

    // Validate the complete set before deleting any member so an unexpected
    // directory or symlink fails closed without following it or leaving a
    // selectively cleaned restore set.
    for path in &paths {
        match fs::symlink_metadata(path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(format!(
                        "Refusing to clear unsafe private-vault control path {}",
                        path.display()
                    )
                    .into());
                }
                present = present.saturating_add(1);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }

    for path in paths {
        remove_internal_file(&path)?;
    }
    sync_directory(app_dir)?;
    Ok(present)
}

fn validate_restore_paths_are_not_links(app_dir: &Path) -> VaultResult<()> {
    let mut paths = pending_control_paths(app_dir).to_vec();
    paths.extend([
        app_dir.join(LIVE_DATABASE_FILE),
        app_dir.join(format!("{LIVE_DATABASE_FILE}-wal")),
        app_dir.join(format!("{LIVE_DATABASE_FILE}-shm")),
        app_dir.join(LIVE_AUDIT_FILE),
    ]);
    for path in paths {
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_file() {
                    return Err(format!(
                        "Private-vault restore path {} is not a regular non-symlink file",
                        path.display()
                    )
                    .into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Decrypt and fully validate a vault, then stage its database and optional
/// audit log in the private app-data directory. The running database is never
/// modified here. A restart is required so the startup swap can occur before
/// SQLite opens the live file.
pub fn stage_private_vault_restore(
    app_dir: &Path,
    package_path: &Path,
    passphrase: &str,
    confirmation: &str,
) -> VaultResult<PrivateVaultStageResult> {
    if confirmation != RESTORE_CONFIRMATION_PHRASE {
        return Err(format!(
            "Restore not staged. Type the exact confirmation phrase: {RESTORE_CONFIRMATION_PHRASE}"
        )
        .into());
    }
    validate_vault_passphrase(passphrase)?;
    ensure_private_directory(app_dir)?;
    ensure_directory_outside_git(app_dir, "Private-vault restore staging directory")?;
    for path in pending_control_paths(app_dir) {
        if path_exists_without_following(&path)? {
            return Err(
                "A pending or interrupted private-vault restore already exists; restart PrismOS before staging another"
                    .into(),
            );
        }
    }

    let package = read_regular_file_bounded(
        package_path,
        MAX_VAULT_PACKAGE_BYTES,
        "private-vault package",
    )?;
    let plaintext = decrypt_package(&package, passphrase)?;
    let payload = parse_and_validate_payload(&plaintext)?;

    let manifest = PendingRestoreManifest {
        format: "prismos-private-vault-pending-v1".into(),
        version: VAULT_VERSION,
        created_at: payload.created_at.clone(),
        database_bytes: payload.database.len() as u64,
        database_sha256: hex_sha256(&payload.database_sha256),
        audit_included: payload.audit.is_some(),
        audit_bytes: payload.audit.map_or(0, |bytes| bytes.len() as u64),
        audit_sha256: payload.audit_sha256.as_ref().map(hex_sha256),
    };
    let manifest_bytes = serde_json::to_vec(&manifest)?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("Pending restore manifest exceeds its size bound".into());
    }

    let database_temp = app_dir.join(STAGE_DATABASE_FILE);
    let audit_temp = app_dir.join(STAGE_AUDIT_FILE);
    let manifest_temp = app_dir.join(STAGE_MANIFEST_FILE);
    let pending_database = app_dir.join(PENDING_DATABASE_FILE);
    let pending_audit = app_dir.join(PENDING_AUDIT_FILE);
    let pending_manifest = app_dir.join(PENDING_MANIFEST_FILE);

    let stage_result = (|| -> VaultResult<()> {
        write_new_private_file(&database_temp, payload.database)?;
        if let Some(audit) = payload.audit {
            write_new_private_file(&audit_temp, audit)?;
        }
        write_new_private_file(&manifest_temp, &manifest_bytes)?;
        publish_staged_file(&database_temp, &pending_database)?;
        if payload.audit.is_some() {
            publish_staged_file(&audit_temp, &pending_audit)?;
        }
        // Manifest is published last: its presence is the commit marker for a
        // complete pending restore.
        publish_staged_file(&manifest_temp, &pending_manifest)?;
        sync_directory(app_dir)?;
        Ok(())
    })();
    if let Err(error) = stage_result {
        for path in [
            database_temp,
            audit_temp,
            manifest_temp,
            pending_database,
            pending_audit,
            pending_manifest,
        ] {
            let _ = remove_internal_file(&path);
        }
        return Err(error);
    }

    Ok(PrivateVaultStageResult {
        success: true,
        restart_required: true,
        created_at: payload.created_at,
        database_bytes: payload.database.len() as u64,
        audit_bytes: payload.audit.map_or(0, |bytes| bytes.len() as u64),
        audit_included: payload.audit.is_some(),
        message: "Private vault validated and staged. Restart PrismOS to apply it before the database opens.".into(),
    })
}

fn read_pending_manifest(app_dir: &Path) -> VaultResult<Option<PendingRestoreManifest>> {
    let path = app_dir.join(PENDING_MANIFEST_FILE);
    if !path_exists_without_following(&path)? {
        return Ok(None);
    }
    let bytes = read_regular_file_bounded(&path, MAX_MANIFEST_BYTES, "pending restore manifest")?;
    let manifest: PendingRestoreManifest = serde_json::from_slice(&bytes)?;
    if manifest.format != "prismos-private-vault-pending-v1"
        || manifest.version != VAULT_VERSION
        || manifest.database_bytes < 100
        || manifest.database_bytes > MAX_VAULT_DATABASE_BYTES
        || manifest.audit_bytes > MAX_VAULT_AUDIT_BYTES
        || manifest.audit_included != manifest.audit_sha256.is_some()
        || (!manifest.audit_included && manifest.audit_bytes != 0)
        || (manifest.audit_included && manifest.audit_bytes == 0)
    {
        return Err("Pending private-vault restore manifest is invalid".into());
    }
    DateTime::parse_from_rfc3339(&manifest.created_at)
        .map_err(|_| "Pending private-vault manifest has an invalid timestamp")?;
    parse_hex_sha256(&manifest.database_sha256, "pending database")?;
    if let Some(hash) = &manifest.audit_sha256 {
        parse_hex_sha256(hash, "pending audit")?;
    }
    Ok(Some(manifest))
}

#[allow(clippy::type_complexity)] // Return pair keeps database and optional audit bytes zeroizing.
fn read_and_validate_pending(
    app_dir: &Path,
    manifest: &PendingRestoreManifest,
) -> VaultResult<(Zeroizing<Vec<u8>>, Option<Zeroizing<Vec<u8>>>)> {
    let database = Zeroizing::new(read_regular_file_bounded(
        &app_dir.join(PENDING_DATABASE_FILE),
        MAX_VAULT_DATABASE_BYTES,
        "pending restored database",
    )?);
    if database.len() as u64 != manifest.database_bytes
        || hex_sha256(&sha256(&database)) != manifest.database_sha256
    {
        return Err("Pending restored database does not match its manifest".into());
    }
    validate_database_bytes(&database)?;

    let audit = if manifest.audit_included {
        let bytes = Zeroizing::new(read_regular_file_bounded(
            &app_dir.join(PENDING_AUDIT_FILE),
            MAX_VAULT_AUDIT_BYTES,
            "pending restored audit log",
        )?);
        if bytes.len() as u64 != manifest.audit_bytes
            || hex_sha256(&sha256(&bytes)) != manifest.audit_sha256.as_deref().unwrap_or("")
        {
            return Err("Pending restored audit log does not match its manifest".into());
        }
        validate_audit_bytes(&bytes)?;
        Some(bytes)
    } else {
        if path_exists_without_following(&app_dir.join(PENDING_AUDIT_FILE))? {
            return Err("Unexpected pending audit file for a vault without an audit log".into());
        }
        None
    };
    Ok((database, audit))
}

fn live_restore_matches(app_dir: &Path, manifest: &PendingRestoreManifest) -> VaultResult<bool> {
    let database_path = app_dir.join(LIVE_DATABASE_FILE);
    if !path_exists_without_following(&database_path)? {
        return Ok(false);
    }
    let database = read_regular_file_bounded(
        &database_path,
        MAX_VAULT_DATABASE_BYTES,
        "live restored database",
    )?;
    if database.len() as u64 != manifest.database_bytes
        || hex_sha256(&sha256(&database)) != manifest.database_sha256
        || validate_database_bytes(&database).is_err()
    {
        return Ok(false);
    }
    let audit_path = app_dir.join(LIVE_AUDIT_FILE);
    if manifest.audit_included {
        if !path_exists_without_following(&audit_path)? {
            return Ok(false);
        }
        let audit = read_regular_file_bounded(
            &audit_path,
            MAX_VAULT_AUDIT_BYTES,
            "live restored audit log",
        )?;
        Ok(audit.len() as u64 == manifest.audit_bytes
            && hex_sha256(&sha256(&audit)) == manifest.audit_sha256.as_deref().unwrap_or("")
            && validate_audit_bytes(&audit).is_ok())
    } else {
        Ok(!path_exists_without_following(&audit_path)?)
    }
}

fn rename_regular_file(source: &Path, destination: &Path, label: &str) -> VaultResult<()> {
    reject_symlink_or_non_file(source, label)?;
    ensure_absent(destination, label)?;
    fs::rename(source, destination)?;
    Ok(())
}

fn move_live_files_to_rollback(app_dir: &Path) -> VaultResult<()> {
    let mappings = [
        (LIVE_DATABASE_FILE.to_string(), ROLLBACK_DATABASE_FILE),
        (format!("{LIVE_DATABASE_FILE}-wal"), ROLLBACK_WAL_FILE),
        (format!("{LIVE_DATABASE_FILE}-shm"), ROLLBACK_SHM_FILE),
        (LIVE_AUDIT_FILE.to_string(), ROLLBACK_AUDIT_FILE),
    ];
    for (live_name, rollback_name) in mappings {
        let live = app_dir.join(&live_name);
        let rollback = app_dir.join(rollback_name);
        if path_exists_without_following(&rollback)? {
            reject_symlink_or_non_file(&rollback, "private-vault rollback file")?;
            if path_exists_without_following(&live)? {
                return Err(format!(
                    "Interrupted restore left both live and rollback files for {live_name}; refusing an ambiguous overwrite"
                )
                .into());
            }
        } else if path_exists_without_following(&live)? {
            rename_regular_file(&live, &rollback, "live PrismOS data file")?;
        }
    }
    Ok(())
}

fn restore_rollback_files(app_dir: &Path) -> VaultResult<()> {
    let mappings = [
        (ROLLBACK_DATABASE_FILE, LIVE_DATABASE_FILE.to_string()),
        (ROLLBACK_WAL_FILE, format!("{LIVE_DATABASE_FILE}-wal")),
        (ROLLBACK_SHM_FILE, format!("{LIVE_DATABASE_FILE}-shm")),
        (ROLLBACK_AUDIT_FILE, LIVE_AUDIT_FILE.to_string()),
    ];
    for (rollback_name, live_name) in mappings {
        let rollback = app_dir.join(rollback_name);
        if path_exists_without_following(&rollback)? {
            let live = app_dir.join(live_name);
            if path_exists_without_following(&live)? {
                remove_internal_file(&live)?;
            }
            rename_regular_file(&rollback, &live, "private-vault rollback file")?;
        }
    }
    sync_directory(app_dir)?;
    Ok(())
}

fn cleanup_rollback_files(app_dir: &Path) -> VaultResult<()> {
    for name in [
        ROLLBACK_DATABASE_FILE,
        ROLLBACK_WAL_FILE,
        ROLLBACK_SHM_FILE,
        ROLLBACK_AUDIT_FILE,
        INSTALL_DATABASE_FILE,
        INSTALL_AUDIT_FILE,
    ] {
        remove_internal_file(&app_dir.join(name))?;
    }
    sync_directory(app_dir)?;
    Ok(())
}

fn file_matches_manifest_component(
    path: &Path,
    expected_len: u64,
    expected_hash: &str,
    max_bytes: u64,
    label: &str,
) -> VaultResult<bool> {
    if !path_exists_without_following(path)? {
        return Ok(false);
    }
    let bytes = read_regular_file_bounded(path, max_bytes, label)?;
    Ok(bytes.len() as u64 == expected_len && hex_sha256(&sha256(&bytes)) == expected_hash)
}

fn recover_partial_interrupted_apply(
    app_dir: &Path,
    manifest: &PendingRestoreManifest,
) -> VaultResult<()> {
    if !any_rollback_exists(app_dir)? {
        return Ok(());
    }

    let live_database = app_dir.join(LIVE_DATABASE_FILE);
    let rollback_database = app_dir.join(ROLLBACK_DATABASE_FILE);
    if path_exists_without_following(&rollback_database)?
        && path_exists_without_following(&live_database)?
    {
        if !file_matches_manifest_component(
            &live_database,
            manifest.database_bytes,
            &manifest.database_sha256,
            MAX_VAULT_DATABASE_BYTES,
            "partially installed database",
        )? {
            return Err(
                "Interrupted restore left an unrecognized live database beside its rollback copy"
                    .into(),
            );
        }
        remove_internal_file(&live_database)?;
    }

    let live_audit = app_dir.join(LIVE_AUDIT_FILE);
    let rollback_audit = app_dir.join(ROLLBACK_AUDIT_FILE);
    if path_exists_without_following(&rollback_audit)?
        && path_exists_without_following(&live_audit)?
    {
        let Some(expected_hash) = manifest.audit_sha256.as_deref() else {
            return Err(
                "Interrupted restore left an unexpected live audit log beside its rollback copy"
                    .into(),
            );
        };
        if !file_matches_manifest_component(
            &live_audit,
            manifest.audit_bytes,
            expected_hash,
            MAX_VAULT_AUDIT_BYTES,
            "partially installed audit log",
        )? {
            return Err(
                "Interrupted restore left an unrecognized live audit log beside its rollback copy"
                    .into(),
            );
        }
        remove_internal_file(&live_audit)?;
    }

    for (live_name, rollback_name) in [
        (format!("{LIVE_DATABASE_FILE}-wal"), ROLLBACK_WAL_FILE),
        (format!("{LIVE_DATABASE_FILE}-shm"), ROLLBACK_SHM_FILE),
    ] {
        if path_exists_without_following(&app_dir.join(rollback_name))?
            && path_exists_without_following(&app_dir.join(&live_name))?
        {
            return Err(format!(
                "Interrupted restore left ambiguous live and rollback sidecars for {live_name}"
            )
            .into());
        }
    }

    restore_rollback_files(app_dir)
}

fn any_rollback_exists(app_dir: &Path) -> VaultResult<bool> {
    for name in [
        ROLLBACK_DATABASE_FILE,
        ROLLBACK_WAL_FILE,
        ROLLBACK_SHM_FILE,
        ROLLBACK_AUDIT_FILE,
    ] {
        if path_exists_without_following(&app_dir.join(name))? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn remove_live_sidecars(app_dir: &Path) -> VaultResult<()> {
    for name in [
        format!("{LIVE_DATABASE_FILE}-wal"),
        format!("{LIVE_DATABASE_FILE}-shm"),
    ] {
        remove_internal_file(&app_dir.join(name))?;
    }
    Ok(())
}

fn finalize_interrupted_restore(
    app_dir: &Path,
    manifest: &PendingRestoreManifest,
) -> VaultResult<PrivateVaultStartupResult> {
    if !live_restore_matches(app_dir, manifest)? {
        return Err("Interrupted private-vault restore is not complete".into());
    }
    remove_live_sidecars(app_dir)?;
    remove_internal_file(&app_dir.join(PENDING_DATABASE_FILE))?;
    remove_internal_file(&app_dir.join(PENDING_AUDIT_FILE))?;
    remove_internal_file(&app_dir.join(PENDING_MANIFEST_FILE))?;
    let cleanup = cleanup_rollback_files(app_dir);
    let message = match cleanup {
        Ok(()) => "Private-vault restore completed after recovering an interrupted startup swap.".into(),
        Err(error) => format!(
            "Private-vault restore completed, but an old protected rollback copy could not be removed: {error}"
        ),
    };
    Ok(PrivateVaultStartupResult {
        applied: true,
        message,
    })
}

/// Apply a previously validated pending restore. This must be called during
/// application startup *before* `SpectrumGraph::new` (or any other SQLite
/// connection) opens `spectrum_graph.db`.
pub fn apply_pending_private_vault_restore(
    app_dir: &Path,
) -> VaultResult<PrivateVaultStartupResult> {
    ensure_private_directory(app_dir)?;
    ensure_directory_outside_git(app_dir, "Private-vault restore directory")?;
    validate_restore_paths_are_not_links(app_dir)?;
    let manifest = match read_pending_manifest(app_dir)? {
        Some(manifest) => manifest,
        None => {
            // A removed manifest is the commit marker for a completed swap. If
            // a crash happened during post-commit cleanup, the live database is
            // authoritative and only fixed-name rollback files remain.
            if any_rollback_exists(app_dir)? {
                if !path_exists_without_following(&app_dir.join(LIVE_DATABASE_FILE))? {
                    restore_rollback_files(app_dir)?;
                    return Ok(PrivateVaultStartupResult {
                        applied: false,
                        message:
                            "Recovered the prior database from an interrupted private-vault swap."
                                .into(),
                    });
                }
                let cleanup = cleanup_rollback_files(app_dir);
                return Ok(PrivateVaultStartupResult {
                    applied: false,
                    message: match cleanup {
                        Ok(()) => "Finished private-vault post-restore cleanup.".into(),
                        Err(error) => {
                            format!("Private-vault cleanup still needs attention: {error}")
                        }
                    },
                });
            }
            for name in [
                PENDING_DATABASE_FILE,
                PENDING_AUDIT_FILE,
                STAGE_DATABASE_FILE,
                STAGE_AUDIT_FILE,
                STAGE_MANIFEST_FILE,
                INSTALL_DATABASE_FILE,
                INSTALL_AUDIT_FILE,
            ] {
                remove_internal_file(&app_dir.join(name))?;
            }
            return Ok(PrivateVaultStartupResult {
                applied: false,
                message: "No pending private-vault restore.".into(),
            });
        }
    };

    let pending_database_exists =
        path_exists_without_following(&app_dir.join(PENDING_DATABASE_FILE))?;
    if (!pending_database_exists || any_rollback_exists(app_dir)?)
        && live_restore_matches(app_dir, &manifest)?
    {
        return finalize_interrupted_restore(app_dir, &manifest);
    }
    if !pending_database_exists {
        if any_rollback_exists(app_dir)? {
            restore_rollback_files(app_dir)?;
        }
        return Err(
            "Pending private-vault database is missing; the prior live database was recovered when possible"
                .into(),
        );
    }

    let (database, audit) = read_and_validate_pending(app_dir, &manifest)?;
    if any_rollback_exists(app_dir)? {
        recover_partial_interrupted_apply(app_dir, &manifest)?;
    }
    let manifest_bytes = serde_json::to_vec(&manifest)?;
    let install_database = app_dir.join(INSTALL_DATABASE_FILE);
    let install_audit = app_dir.join(INSTALL_AUDIT_FILE);
    remove_internal_file(&install_database)?;
    remove_internal_file(&install_audit)?;

    let mut database_installed = false;
    let mut audit_installed = false;
    let apply_result = (|| -> VaultResult<()> {
        move_live_files_to_rollback(app_dir)?;

        write_new_private_file(&install_database, &database)?;
        fs::rename(&install_database, app_dir.join(LIVE_DATABASE_FILE))?;
        database_installed = true;
        set_private_file_permissions(&app_dir.join(LIVE_DATABASE_FILE))?;

        if let Some(audit) = &audit {
            write_new_private_file(&install_audit, audit)?;
            fs::rename(&install_audit, app_dir.join(LIVE_AUDIT_FILE))?;
            audit_installed = true;
            set_private_file_permissions(&app_dir.join(LIVE_AUDIT_FILE))?;
        }
        remove_live_sidecars(app_dir)?;
        sync_directory(app_dir)?;

        // Remove staged plaintext first and the manifest commit marker last.
        remove_internal_file(&app_dir.join(PENDING_DATABASE_FILE))?;
        remove_internal_file(&app_dir.join(PENDING_AUDIT_FILE))?;
        remove_internal_file(&app_dir.join(PENDING_MANIFEST_FILE))?;
        Ok(())
    })();

    if let Err(apply_error) = apply_result {
        if database_installed {
            let _ = remove_internal_file(&app_dir.join(LIVE_DATABASE_FILE));
        }
        if audit_installed {
            let _ = remove_internal_file(&app_dir.join(LIVE_AUDIT_FILE));
        }
        let _ = remove_internal_file(&install_database);
        let _ = remove_internal_file(&install_audit);
        if !path_exists_without_following(&app_dir.join(PENDING_DATABASE_FILE))? {
            let _ = write_new_private_file(&app_dir.join(PENDING_DATABASE_FILE), &database);
        }
        if let Some(audit) = &audit {
            if !path_exists_without_following(&app_dir.join(PENDING_AUDIT_FILE))? {
                let _ = write_new_private_file(&app_dir.join(PENDING_AUDIT_FILE), audit);
            }
        }
        if !path_exists_without_following(&app_dir.join(PENDING_MANIFEST_FILE))? {
            let _ = write_new_private_file(&app_dir.join(PENDING_MANIFEST_FILE), &manifest_bytes);
        }
        let rollback_result = restore_rollback_files(app_dir);
        return match rollback_result {
            Ok(()) => Err(format!(
                "Private-vault restore failed and the prior data was restored: {apply_error}"
            )
            .into()),
            Err(rollback_error) => Err(format!(
                "Private-vault restore failed ({apply_error}); automatic rollback also failed ({rollback_error}). Do not start PrismOS again until the protected rollback files are recovered."
            )
            .into()),
        };
    }

    let cleanup = cleanup_rollback_files(app_dir);
    let directory_sync = sync_directory(app_dir);
    let message = match (cleanup, directory_sync) {
        (Ok(()), Ok(())) => {
            "Private vault restored successfully before database startup.".to_string()
        }
        (cleanup, directory_sync) => format!(
            "Private vault restored, but protected post-restore cleanup needs attention: cleanup={:?}, directory_sync={:?}",
            cleanup.err(),
            directory_sync.err()
        ),
    };
    Ok(PrivateVaultStartupResult {
        applied: true,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spectrum_graph::KnowledgeChunkRecord;

    const TEST_PASSPHRASE: &str = "correct horse battery prism vault";

    fn legacy_genesis_without_hash_version() -> (AuditEntry, String) {
        let mut entry = AuditEntry {
            hash_version: 0,
            index: 0,
            timestamp: "2026-08-01T00:00:00Z".into(),
            action: "genesis".into(),
            actor: "system".into(),
            details: "legacy private-vault fixture".into(),
            prev_hash: "0".repeat(64),
            hash: String::new(),
        };
        entry.hash = compute_audit_entry_hash(&entry).unwrap();
        let line = serde_json::json!({
            "index": entry.index,
            "timestamp": &entry.timestamp,
            "action": &entry.action,
            "actor": &entry.actor,
            "details": &entry.details,
            "prev_hash": &entry.prev_hash,
            "hash": &entry.hash,
        })
        .to_string();
        (entry, line)
    }

    fn fixture_with_private_data() -> (
        tempfile::TempDir,
        crate::spectrum_graph::SpectrumGraph,
        PathBuf,
    ) {
        let source = tempfile::tempdir().unwrap();
        let graph = crate::spectrum_graph::SpectrumGraph::new(source.path()).unwrap();
        let now = Utc::now().to_rfc3339();
        graph
            .sync_knowledge_source(
                "project-private-test",
                "Private Test Project",
                "/private/projects/example",
                &now,
                1,
                31,
                0,
                0,
                &[KnowledgeChunkRecord {
                    id: "project-private-test:chunk:1".into(),
                    label: "private-plan.md".into(),
                    content: "private trend data and a disaster recovery plan".into(),
                    source_path: "private-plan.md".into(),
                    content_hash: hex::encode(Sha256::digest(b"private trend data")),
                }],
            )
            .unwrap();
        graph
            .store_agent_memory("reasoner", "private_preference", "keep this local")
            .unwrap();
        let (legacy_genesis, legacy_line) = legacy_genesis_without_hash_version();
        fs::write(
            source.path().join(LIVE_AUDIT_FILE),
            format!("{legacy_line}\n"),
        )
        .unwrap();
        let audit = crate::audit_log::AuditLog::new(source.path());
        let modern_entry = audit
            .append("vault_test", "test", "private recovery fixture")
            .unwrap();
        assert_eq!(modern_entry.hash_version, AUDIT_HASH_VERSION_V1);
        assert_eq!(modern_entry.prev_hash, legacy_genesis.hash);
        assert!(audit.verify_chain().unwrap().valid);
        let package = source.path().join("my-backup.prismos-vault");
        (source, graph, package)
    }

    #[test]
    fn audit_validator_accepts_v0_to_v1_and_rejects_schema_or_version_regressions() {
        let (legacy, legacy_line) = legacy_genesis_without_hash_version();
        let mut modern = AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index: 1,
            timestamp: "2026-08-01T00:00:01Z".into(),
            action: "modern".into(),
            actor: "system".into(),
            details: "length-prefixed v1".into(),
            prev_hash: legacy.hash,
            hash: String::new(),
        };
        modern.hash = compute_audit_entry_hash(&modern).unwrap();
        let modern_line = serde_json::to_string(&modern).unwrap();
        let mixed = format!("{legacy_line}\n{modern_line}\n");
        validate_audit_bytes(mixed.as_bytes()).unwrap();

        let mut unknown_field = serde_json::to_value(&modern).unwrap();
        unknown_field
            .as_object_mut()
            .unwrap()
            .insert("unexpected".into(), serde_json::json!(true));
        let unknown = format!("{legacy_line}\n{unknown_field}\n");
        assert!(validate_audit_bytes(unknown.as_bytes())
            .unwrap_err()
            .to_string()
            .contains("unknown field"));

        let mut unsupported = serde_json::to_value(&modern).unwrap();
        unsupported["hash_version"] = serde_json::json!(2);
        let unsupported = format!("{legacy_line}\n{unsupported}\n");
        assert!(validate_audit_bytes(unsupported.as_bytes())
            .unwrap_err()
            .to_string()
            .contains("unsupported hash version 2"));

        let mut v1_genesis = AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index: 0,
            timestamp: "2026-08-01T00:00:00Z".into(),
            action: "genesis".into(),
            actor: "system".into(),
            details: "v1 chain".into(),
            prev_hash: "0".repeat(64),
            hash: String::new(),
        };
        v1_genesis.hash = compute_audit_entry_hash(&v1_genesis).unwrap();
        let mut downgraded = AuditEntry {
            hash_version: 0,
            index: 1,
            timestamp: "2026-08-01T00:00:01Z".into(),
            action: "legacy".into(),
            actor: "system".into(),
            details: "must be rejected after v1".into(),
            prev_hash: v1_genesis.hash.clone(),
            hash: String::new(),
        };
        downgraded.hash = compute_audit_entry_hash(&downgraded).unwrap();
        let downgrade = format!(
            "{}\n{}\n",
            serde_json::to_string(&v1_genesis).unwrap(),
            serde_json::to_string(&downgraded).unwrap()
        );
        assert!(validate_audit_bytes(downgrade.as_bytes())
            .unwrap_err()
            .to_string()
            .contains("version downgrade"));
    }

    #[test]
    fn full_vault_round_trip_preserves_private_tables_and_audit() {
        let (source, graph, package) = fixture_with_private_data();
        let source_audit = fs::read(source.path().join(LIVE_AUDIT_FILE)).unwrap();
        let source_entries = std::str::from_utf8(&source_audit)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(source_entries.len(), 2);
        assert!(source_entries[0].get("hash_version").is_none());
        assert_eq!(
            source_entries[1]
                .get("hash_version")
                .and_then(|v| v.as_u64()),
            Some(u64::from(AUDIT_HASH_VERSION_V1))
        );
        let exported = export_private_vault(&graph, source.path(), &package, TEST_PASSPHRASE)
            .expect("vault export");
        assert!(exported.audit_included);
        assert!(package.exists());

        let wrong_target = tempfile::tempdir().unwrap();
        let wrong = stage_private_vault_restore(
            wrong_target.path(),
            &package,
            "this is definitely the wrong passphrase",
            RESTORE_CONFIRMATION_PHRASE,
        );
        assert!(wrong.is_err());
        assert!(!wrong_target.path().join(PENDING_MANIFEST_FILE).exists());

        let package_bytes = fs::read(&package).unwrap();
        let mut tampered = package_bytes;
        let last = tampered.len() - 1;
        tampered[last] ^= 0x80;
        let tampered_path = source.path().join("tampered.prismos-vault");
        fs::write(&tampered_path, tampered).unwrap();
        let tampered_target = tempfile::tempdir().unwrap();
        let tampered_result = stage_private_vault_restore(
            tampered_target.path(),
            &tampered_path,
            TEST_PASSPHRASE,
            RESTORE_CONFIRMATION_PHRASE,
        );
        assert!(tampered_result.is_err());
        assert!(!tampered_target.path().join(PENDING_MANIFEST_FILE).exists());

        let restored_dir = tempfile::tempdir().unwrap();
        {
            let prior = crate::spectrum_graph::SpectrumGraph::new(restored_dir.path()).unwrap();
            prior
                .add_node("Prior local state", "must be rollback-safe", "note")
                .unwrap();
            crate::audit_log::AuditLog::new(restored_dir.path())
                .append("prior_state", "test", "rollback fixture")
                .unwrap();
        }
        let staged = stage_private_vault_restore(
            restored_dir.path(),
            &package,
            TEST_PASSPHRASE,
            RESTORE_CONFIRMATION_PHRASE,
        )
        .expect("stage restore");
        assert!(staged.restart_required);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(restored_dir.path().join(PENDING_DATABASE_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        // Simulate a power loss after the prior live files were protected and
        // the replacement database was installed, but before its audit log was
        // installed or the manifest commit marker was removed. Startup must
        // recognize the partial new database, roll back, and safely retry.
        move_live_files_to_rollback(restored_dir.path()).unwrap();
        let pending_database = fs::read(restored_dir.path().join(PENDING_DATABASE_FILE)).unwrap();
        write_new_private_file(
            &restored_dir.path().join(LIVE_DATABASE_FILE),
            &pending_database,
        )
        .unwrap();
        assert!(restored_dir.path().join(ROLLBACK_DATABASE_FILE).exists());
        let applied =
            apply_pending_private_vault_restore(restored_dir.path()).expect("startup restore");
        assert!(applied.applied);
        assert!(!restored_dir.path().join(PENDING_MANIFEST_FILE).exists());
        assert!(!restored_dir
            .path()
            .join(format!("{LIVE_DATABASE_FILE}-wal"))
            .exists());
        assert!(!restored_dir
            .path()
            .join(format!("{LIVE_DATABASE_FILE}-shm"))
            .exists());

        let restored = crate::spectrum_graph::SpectrumGraph::new(restored_dir.path()).unwrap();
        let sources = restored.list_knowledge_sources().unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, "project-private-test");
        let node = restored
            .get_node("project-private-test:chunk:1")
            .unwrap()
            .unwrap();
        assert!(node.content.contains("private trend data"));
        let memory = restored.recall_agent_memory("reasoner", 10).unwrap();
        assert_eq!(memory.len(), 1);
        assert_eq!(memory[0].decision, "keep this local");
        assert_eq!(
            fs::read(restored_dir.path().join(LIVE_AUDIT_FILE)).unwrap(),
            source_audit
        );
        let verification = crate::audit_log::AuditLog::new(restored_dir.path())
            .verify_chain()
            .unwrap();
        assert!(verification.valid);
        assert_eq!(verification.entries_checked, 2);
    }

    #[test]
    fn restore_requires_exact_confirmation_and_long_passphrase() {
        assert!(validate_vault_passphrase("too short").is_err());
        assert!(validate_vault_passphrase("sixteen chars ok!").is_ok());
        let target = tempfile::tempdir().unwrap();
        let result = stage_private_vault_restore(
            target.path(),
            Path::new("missing.prismos-vault"),
            TEST_PASSPHRASE,
            "restore it",
        );
        assert!(result.is_err());
        assert!(!target.path().join(PENDING_MANIFEST_FILE).exists());
    }

    #[test]
    fn clear_discards_every_in_app_restore_artifact() {
        let target = tempfile::tempdir().unwrap();
        let paths = pending_control_paths(target.path());
        for path in &paths {
            write_new_private_file(path, b"private restore artifact").unwrap();
        }

        assert_eq!(
            discard_restore_control_artifacts(target.path()).unwrap(),
            paths.len()
        );
        assert!(paths.iter().all(|path| !path.exists()));
    }

    #[test]
    fn malformed_package_length_is_rejected_before_allocation() {
        let mut package = Vec::new();
        package.extend_from_slice(PACKAGE_MAGIC);
        package.extend_from_slice(&VAULT_VERSION.to_be_bytes());
        package.extend_from_slice(&crate::you_port::PASSPHRASE_KDF_ITERATIONS.to_be_bytes());
        package.extend_from_slice(&[7_u8; KDF_SALT_BYTES]);
        package.extend_from_slice(&(MAX_VAULT_PACKAGE_BYTES + 1).to_be_bytes());
        package.extend_from_slice(&[0_u8; SHA256_BYTES]);
        assert!(decrypt_package(&package, TEST_PASSPHRASE).is_err());
    }

    #[test]
    fn export_refuses_git_worktrees_and_existing_destinations() {
        let source = tempfile::tempdir().unwrap();
        let graph = crate::spectrum_graph::SpectrumGraph::new(source.path()).unwrap();
        let repository = tempfile::tempdir().unwrap();
        fs::create_dir(repository.path().join(".git")).unwrap();
        let destination = repository.path().join("private.prismos-vault");
        let error = export_private_vault(&graph, source.path(), &destination, TEST_PASSPHRASE)
            .unwrap_err()
            .to_string();
        assert!(error.contains("Git worktree"));

        let safe_dir = tempfile::tempdir().unwrap();
        let existing = safe_dir.path().join("existing.prismos-vault");
        fs::write(&existing, b"do not overwrite").unwrap();
        assert!(export_private_vault(&graph, source.path(), &existing, TEST_PASSPHRASE).is_err());
        assert_eq!(fs::read(existing).unwrap(), b"do not overwrite");
    }

    #[cfg(unix)]
    #[test]
    fn restore_rejects_symlinked_package_and_pending_paths() {
        use std::os::unix::fs::symlink;
        let source = tempfile::tempdir().unwrap();
        let real = source.path().join("real.prismos-vault");
        fs::write(&real, b"not a vault").unwrap();
        let link = source.path().join("linked.prismos-vault");
        symlink(&real, &link).unwrap();
        let target = tempfile::tempdir().unwrap();
        let error = stage_private_vault_restore(
            target.path(),
            &link,
            TEST_PASSPHRASE,
            RESTORE_CONFIRMATION_PHRASE,
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("non-symlink"));

        let pending_target = tempfile::tempdir().unwrap();
        let outside = source.path().join("outside");
        fs::write(&outside, b"keep").unwrap();
        symlink(&outside, pending_target.path().join(PENDING_DATABASE_FILE)).unwrap();
        assert!(apply_pending_private_vault_restore(pending_target.path()).is_err());
        assert!(discard_restore_control_artifacts(pending_target.path()).is_err());
        assert_eq!(fs::read(outside).unwrap(), b"keep");
    }
}
