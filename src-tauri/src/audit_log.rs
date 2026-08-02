// PrismOS-AI Audit Log — Tamper-Evident Cryptographic Hash Chain
//
// Every significant action in PrismOS-AI is recorded in a tamper-evident log.
// Each entry is chained to the previous entry via SHA-256 hash, creating
// a locally verifiable record of actions written through this logger.
//
// Architecture:
//   1. Genesis entry has a well-known initial hash (all zeros)
//   2. Each subsequent entry includes the SHA-256 hash of the previous entry
//   3. The chain can be verified at any time — any tampering breaks the chain
//   4. Stored as newline-delimited JSON in the app data directory
//
// This module itself performs no network requests.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUDIT_LOG_FILE: &str = "prismos-audit.log";
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const AUDIT_HASH_VERSION_V1: u8 = 1;
const AUDIT_HASH_V1_DOMAIN: &[u8] = b"PrismOS-Audit-Entry-v1\0";
const MAX_ACTION_BYTES: usize = 128;
const MAX_ACTOR_BYTES: usize = 128;
const MAX_DETAILS_BYTES: usize = 16 * 1024;
const MAX_RECENT_ENTRIES: usize = 500;
// JSON escaping can expand control characters beyond their input byte length.
// Keep the serialized-line bound comfortably above the bounded fields while
// still preventing an unbounded tail read from a damaged or hostile log.
const MAX_SERIALIZED_ENTRY_BYTES: usize = 128 * 1024;
static AUDIT_LOG_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

// ─── Data Models ───────────────────────────────────────────────────────────────

/// A single entry in the tamper-evident audit log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Hash framing version. Missing values in historical entries deserialize
    /// as version 0, whose concatenated representation remains verifiable.
    #[serde(default)]
    pub hash_version: u8,
    /// Sequential index in the chain
    pub index: u64,
    /// ISO-8601 timestamp
    pub timestamp: String,
    /// Action category (e.g., "llm_inference", "graph_write", "sandbox_exec")
    pub action: String,
    /// Actor that performed the action (e.g., "orchestrator", "user", "sentinel")
    pub actor: String,
    /// Human-readable description of what happened
    pub details: String,
    /// SHA-256 hash of the previous entry (hex-encoded)
    pub prev_hash: String,
    /// SHA-256 hash of THIS entry's content (hex-encoded)
    pub hash: String,
}

/// Result of a chain verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainVerification {
    pub valid: bool,
    pub entries_checked: u64,
    pub first_invalid_index: Option<u64>,
    pub message: String,
}

// ─── Audit Log Manager ────────────────────────────────────────────────────────

pub struct AuditLog {
    log_path: PathBuf,
}

impl AuditLog {
    /// Create a new AuditLog instance for the given app data directory.
    /// Creates the log file with a genesis entry if it doesn't exist.
    pub fn new(app_dir: &Path) -> Self {
        let log_path = app_dir.join(AUDIT_LOG_FILE);

        let log = AuditLog { log_path };

        // Create genesis entry if log doesn't exist or is empty
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !log.log_path.exists()
            || fs::metadata(&log.log_path)
                .map(|m| m.len() == 0)
                .unwrap_or(true)
        {
            let _ = log.write_fresh_chain_locked();
        }

        log
    }

    fn write_fresh_chain_locked(&self) -> Result<(), String> {
        if fs::symlink_metadata(&self.log_path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Refusing to replace a symlinked audit log".to_string());
        }
        let genesis = Self::compute_hash(AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index: 0,
            timestamp: Utc::now().to_rfc3339(),
            action: "genesis".to_string(),
            actor: "system".to_string(),
            details: "PrismOS-AI audit chain initialized".to_string(),
            prev_hash: GENESIS_HASH.to_string(),
            hash: String::new(),
        })?;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.log_path)
            .map_err(|error| format!("Failed to reset audit log: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.log_path, fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Failed to protect audit log: {error}"))?;
        }
        writeln!(
            file,
            "{}",
            serde_json::to_string(&genesis).map_err(|error| error.to_string())?
        )
        .map_err(|error| format!("Failed to write audit genesis: {error}"))?;
        file.sync_data()
            .map_err(|error| format!("Failed to flush audit genesis: {error}"))
    }

    /// Erase prior audit details and start a new verifiable chain. This is used
    /// only by the explicitly confirmed Clear All Data operation.
    pub fn reset(&self) -> Result<(), String> {
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .map_err(|e| format!("Lock error: {e}"))?;
        self.write_fresh_chain_locked()
    }

    /// Compute an entry hash using the framing declared by `hash_version`.
    /// Version 0 preserves the historical concatenated representation. Version
    /// 1 adds a domain separator and a length prefix to every variable field so
    /// moving bytes across adjacent field boundaries cannot preserve the hash.
    fn entry_hash(entry: &AuditEntry) -> Result<String, String> {
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
                        .map_err(|_| "Audit hash field length exceeds u64".to_string())?;
                    hasher.update(length.to_le_bytes());
                    hasher.update(value);
                }
            }
            version => return Err(format!("Unsupported audit hash version {version}")),
        }
        Ok(hex_encode(hasher.finalize().as_slice()))
    }

    fn compute_hash(mut entry: AuditEntry) -> Result<AuditEntry, String> {
        entry.hash = Self::entry_hash(&entry)?;
        Ok(entry)
    }

    /// Read one newline-delimited record without ever allocating beyond the
    /// serialized-entry bound. Returns zero only at clean EOF.
    fn read_bounded_line<R: BufRead>(
        reader: &mut R,
        buffer: &mut Vec<u8>,
    ) -> Result<Option<usize>, String> {
        buffer.clear();
        let mut saw_input = false;
        loop {
            let available = reader
                .fill_buf()
                .map_err(|error| format!("Failed to read audit log: {error}"))?;
            if available.is_empty() {
                if !saw_input {
                    return Ok(None);
                }
                break;
            }
            saw_input = true;

            let newline = available.iter().position(|byte| *byte == b'\n');
            let take = newline.unwrap_or(available.len());
            let next_len = buffer
                .len()
                .checked_add(take)
                .ok_or_else(|| "Audit entry length overflow".to_string())?;
            if next_len > MAX_SERIALIZED_ENTRY_BYTES {
                return Err(format!(
                    "Audit entry exceeds the {MAX_SERIALIZED_ENTRY_BYTES}-byte bound"
                ));
            }
            buffer.extend_from_slice(&available[..take]);
            reader.consume(take + usize::from(newline.is_some()));
            if newline.is_some() {
                break;
            }
        }
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }
        Ok(Some(buffer.len()))
    }

    /// Get the hash of the last entry in the chain.
    /// Reads one complete, bounded final record from the end of the file instead
    /// of scanning the full chain. Any missing, truncated, oversized, malformed,
    /// or self-inconsistent record is an error; append must never silently start
    /// a second chain from the genesis hash.
    fn last_hash(&self) -> Result<(u64, String), String> {
        use std::io::{Read, Seek, SeekFrom};

        let mut file = fs::File::open(&self.log_path)
            .map_err(|error| format!("Failed to open the existing audit log: {error}"))?;

        let file_len = file
            .seek(SeekFrom::End(0))
            .map_err(|error| format!("Failed to inspect the audit log length: {error}"))?;

        if file_len == 0 {
            return Err("Existing audit log is empty; refusing to append a new chain".to_string());
        }

        // Include two extra bytes so a maximum-sized record plus its trailing
        // newline still includes the preceding line delimiter when one exists.
        let suffix_bound = u64::try_from(MAX_SERIALIZED_ENTRY_BYTES + 2)
            .map_err(|_| "Audit entry bound is unsupported on this platform".to_string())?;
        let read_size_u64 = file_len.min(suffix_bound);
        let read_size = usize::try_from(read_size_u64)
            .map_err(|_| "Audit log tail is too large for this platform".to_string())?;
        let seek_pos = file_len - read_size_u64;
        file.seek(SeekFrom::Start(seek_pos))
            .map_err(|error| format!("Failed to seek to the final audit entry: {error}"))?;

        let mut buffer = vec![0_u8; read_size];
        file.read_exact(&mut buffer)
            .map_err(|error| format!("Failed to read the final audit entry: {error}"))?;

        let line_end = buffer
            .iter()
            .rposition(|byte| !byte.is_ascii_whitespace())
            .ok_or_else(|| "Audit log contains no final non-empty entry".to_string())?;
        let line_start = buffer[..=line_end]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(0, |position| position + 1);
        if line_start == 0 && seek_pos > 0 {
            return Err(format!(
                "Final audit entry exceeds the {MAX_SERIALIZED_ENTRY_BYTES}-byte bound or is incomplete"
            ));
        }

        let line = &buffer[line_start..=line_end];
        if line.len() > MAX_SERIALIZED_ENTRY_BYTES {
            return Err(format!(
                "Final audit entry exceeds the {MAX_SERIALIZED_ENTRY_BYTES}-byte bound"
            ));
        }
        let line = std::str::from_utf8(line)
            .map_err(|_| "Final audit entry is not valid UTF-8".to_string())?;
        let entry: AuditEntry = serde_json::from_str(line)
            .map_err(|error| format!("Final audit entry is malformed: {error}"))?;
        let recomputed_hash = Self::entry_hash(&entry)?;
        if entry.hash != recomputed_hash {
            return Err("Final audit entry failed its SHA-256 integrity check".to_string());
        }

        Ok((entry.index, entry.hash))
    }

    fn validate_append_field(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
        if value.trim().is_empty() {
            return Err(format!("Audit {label} must not be empty"));
        }
        if value.len() > max_bytes {
            return Err(format!("Audit {label} exceeds the {max_bytes}-byte bound"));
        }
        Ok(())
    }

    /// Append a new entry to the audit log.
    /// Automatically chains to the previous entry's hash.
    pub fn append(&self, action: &str, actor: &str, details: &str) -> Result<AuditEntry, String> {
        Self::validate_append_field("action", action, MAX_ACTION_BYTES)?;
        Self::validate_append_field("actor", actor, MAX_ACTOR_BYTES)?;
        Self::validate_append_field("details", details, MAX_DETAILS_BYTES)?;

        let _guard = AUDIT_LOG_LOCK
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        if fs::symlink_metadata(&self.log_path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Refusing to append to a symlinked audit log".to_string());
        }

        let (last_index, prev_hash) = self.last_hash()?;
        let index = last_index
            .checked_add(1)
            .ok_or_else(|| "Audit entry index overflow".to_string())?;

        let entry = AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index,
            timestamp: Utc::now().to_rfc3339(),
            action: action.to_string(),
            actor: actor.to_string(),
            details: details.to_string(),
            prev_hash,
            hash: String::new(),
        };
        let entry = Self::compute_hash(entry)?;
        let serialized = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
        if serialized.len() > MAX_SERIALIZED_ENTRY_BYTES {
            return Err(format!(
                "Serialized audit entry exceeds the {MAX_SERIALIZED_ENTRY_BYTES}-byte bound"
            ));
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;

        writeln!(file, "{serialized}")
            .map_err(|e| format!("Failed to write audit entry: {}", e))?;
        file.sync_data()
            .map_err(|e| format!("Failed to flush audit entry: {}", e))?;

        Ok(entry)
    }

    /// Verify the entire hash chain for integrity.
    /// Returns whether the chain is valid and where the first break occurs.
    pub fn verify_chain(&self) -> Result<ChainVerification, String> {
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let file = fs::File::open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;
        let mut reader = BufReader::new(file);

        let mut expected_prev_hash = GENESIS_HASH.to_string();
        let mut previous_hash_version = 0_u8;
        let mut count = 0u64;
        let mut line = Vec::with_capacity(1024);

        while Self::read_bounded_line(&mut reader, &mut line)?.is_some() {
            let line = std::str::from_utf8(&line)
                .map_err(|_| format!("Audit entry {count} is not valid UTF-8"))?;
            if line.trim().is_empty() {
                continue;
            }

            let entry: AuditEntry = serde_json::from_str(line)
                .map_err(|e| format!("Parse error at entry {}: {}", count, e))?;

            if count == 0 && (entry.action != "genesis" || entry.actor != "system") {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: 0,
                    first_invalid_index: Some(entry.index),
                    message: "Audit chain does not begin with the required genesis entry"
                        .to_string(),
                });
            }

            if entry.index != count {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: count,
                    first_invalid_index: Some(entry.index),
                    message: format!(
                        "Audit index sequence broken: expected {count}, got {}",
                        entry.index
                    ),
                });
            }

            if entry.hash_version > AUDIT_HASH_VERSION_V1 {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: count,
                    first_invalid_index: Some(entry.index),
                    message: format!("Unsupported audit hash version {}", entry.hash_version),
                });
            }
            if entry.hash_version < previous_hash_version {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: count,
                    first_invalid_index: Some(entry.index),
                    message: format!(
                        "Audit hash version downgrade at entry {}: {} to {}",
                        entry.index, previous_hash_version, entry.hash_version
                    ),
                });
            }

            // Check 1: prev_hash must match
            if entry.prev_hash != expected_prev_hash {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: count,
                    first_invalid_index: Some(entry.index),
                    message: format!(
                        "Chain broken at entry {}: prev_hash mismatch (expected {}, got {})",
                        entry.index,
                        &expected_prev_hash[..16],
                        &entry.prev_hash[..16.min(entry.prev_hash.len())]
                    ),
                });
            }

            // Check 2: recompute hash and verify
            let recomputed = match Self::entry_hash(&entry) {
                Ok(hash) => hash,
                Err(message) => {
                    return Ok(ChainVerification {
                        valid: false,
                        entries_checked: count,
                        first_invalid_index: Some(entry.index),
                        message,
                    })
                }
            };
            if recomputed != entry.hash {
                return Ok(ChainVerification {
                    valid: false,
                    entries_checked: count,
                    first_invalid_index: Some(entry.index),
                    message: format!(
                        "Hash mismatch at entry {}: stored hash doesn't match computed hash (tampered?)",
                        entry.index
                    ),
                });
            }

            expected_prev_hash = entry.hash;
            previous_hash_version = entry.hash_version;
            count += 1;
        }

        if count == 0 {
            return Ok(ChainVerification {
                valid: false,
                entries_checked: 0,
                first_invalid_index: None,
                message: "Audit log contains no genesis entry".to_string(),
            });
        }

        Ok(ChainVerification {
            valid: true,
            entries_checked: count,
            first_invalid_index: None,
            message: format!(
                "✅ Audit chain verified — {} entries, all hashes valid",
                count
            ),
        })
    }

    /// Get the most recent N entries from the audit log
    pub fn get_entries(&self, limit: usize) -> Result<Vec<AuditEntry>, String> {
        if limit > MAX_RECENT_ENTRIES {
            return Err(format!(
                "Audit entry limit exceeds the maximum of {MAX_RECENT_ENTRIES}"
            ));
        }
        if limit == 0 {
            return Ok(Vec::new());
        }
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let file = fs::File::open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;
        let mut reader = BufReader::new(file);

        let mut entries: VecDeque<AuditEntry> = VecDeque::with_capacity(limit);
        let mut line = Vec::with_capacity(1024);
        while Self::read_bounded_line(&mut reader, &mut line)?.is_some() {
            let line = std::str::from_utf8(&line)
                .map_err(|_| "Audit log contains invalid UTF-8".to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            let entry = serde_json::from_str::<AuditEntry>(line)
                .map_err(|error| format!("Audit log contains a malformed entry: {error}"))?;
            Self::entry_hash(&entry)?;
            if entries.len() == limit {
                entries.pop_front();
            }
            entries.push_back(entry);
        }
        Ok(entries.into_iter().collect())
    }

    /// Get the total number of entries in the log
    pub fn entry_count(&self) -> u64 {
        let _guard = AUDIT_LOG_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let file = match fs::File::open(&self.log_path) {
            Ok(f) => f,
            Err(_) => return 0,
        };
        let mut reader = BufReader::new(file);
        let mut line = Vec::with_capacity(1024);
        let mut count = 0_u64;
        loop {
            match Self::read_bounded_line(&mut reader, &mut line) {
                Ok(None) | Err(_) => break,
                Ok(Some(_)) if line.iter().all(|byte| byte.is_ascii_whitespace()) => continue,
                Ok(Some(_)) => count = count.saturating_add(1),
            }
        }
        count
    }
}

// ─── Utility ───────────────────────────────────────────────────────────────────

/// Encode bytes as lowercase hex string
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_audit_chain_integrity() {
        let tmp = std::env::temp_dir().join("prismos-test-audit");
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::remove_file(tmp.join(AUDIT_LOG_FILE));

        let log = AuditLog::new(&tmp);
        log.append("test_action", "test_actor", "Test entry 1")
            .unwrap();
        log.append("test_action", "test_actor", "Test entry 2")
            .unwrap();
        log.append("test_action", "test_actor", "Test entry 3")
            .unwrap();

        let result = log.verify_chain().unwrap();
        assert!(result.valid);
        assert_eq!(result.entries_checked, 4); // genesis + 3

        let entries = log.get_entries(10).unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].action, "genesis");
        assert!(entries
            .iter()
            .all(|entry| entry.hash_version == AUDIT_HASH_VERSION_V1));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn concurrent_instances_append_one_linear_chain() {
        let dir = tempfile::tempdir().unwrap();
        let mut workers = Vec::new();
        for index in 0..12 {
            let path = dir.path().to_path_buf();
            workers.push(std::thread::spawn(move || {
                AuditLog::new(&path)
                    .append("parallel", "test", &format!("entry-{index}"))
                    .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }

        let log = AuditLog::new(dir.path());
        let verification = log.verify_chain().unwrap();
        assert!(verification.valid, "{}", verification.message);
        assert_eq!(verification.entries_checked, 13);
    }

    #[test]
    fn append_after_entry_larger_than_four_kib_preserves_chain() {
        let dir = tempfile::tempdir().unwrap();
        let log = AuditLog::new(dir.path());
        let large_details = "x".repeat(6 * 1024);

        let large_entry = log.append("large_record", "test", &large_details).unwrap();
        assert!(serde_json::to_string(&large_entry).unwrap().len() > 4096);
        log.append("after_large_record", "test", "still chained")
            .unwrap();

        let verification = log.verify_chain().unwrap();
        assert!(verification.valid, "{}", verification.message);
        assert_eq!(verification.entries_checked, 3);
    }

    #[test]
    fn append_rejects_oversized_fields() {
        let dir = tempfile::tempdir().unwrap();
        let log = AuditLog::new(dir.path());

        assert!(log
            .append(&"a".repeat(MAX_ACTION_BYTES + 1), "test", "details")
            .is_err());
        assert!(log
            .append("test", &"a".repeat(MAX_ACTOR_BYTES + 1), "details")
            .is_err());
        assert!(log
            .append("test", "test", &"a".repeat(MAX_DETAILS_BYTES + 1))
            .is_err());
        assert!(log.verify_chain().unwrap().valid);
    }

    #[test]
    fn oversized_or_malformed_read_records_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUDIT_LOG_FILE);
        std::fs::write(&path, vec![b'x'; MAX_SERIALIZED_ENTRY_BYTES + 1]).unwrap();
        let log = AuditLog::new(dir.path());

        assert!(log.verify_chain().is_err());
        assert!(log.get_entries(10).is_err());
        assert!(log
            .append("after_damage", "system", "must not append")
            .is_err());
        assert!(log.get_entries(MAX_RECENT_ENTRIES + 1).is_err());
    }

    #[test]
    fn verification_rejects_a_nonsequential_index() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUDIT_LOG_FILE);
        let genesis = AuditLog::compute_hash(AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index: 0,
            timestamp: "2026-08-01T00:00:00Z".into(),
            action: "genesis".into(),
            actor: "system".into(),
            details: "chain".into(),
            prev_hash: GENESIS_HASH.into(),
            hash: String::new(),
        })
        .unwrap();
        let skipped = AuditLog::compute_hash(AuditEntry {
            hash_version: AUDIT_HASH_VERSION_V1,
            index: 2,
            timestamp: "2026-08-01T00:00:01Z".into(),
            action: "skipped".into(),
            actor: "system".into(),
            details: "index one is absent".into(),
            prev_hash: genesis.hash.clone(),
            hash: String::new(),
        })
        .unwrap();
        std::fs::write(
            path,
            format!(
                "{}\n{}\n",
                serde_json::to_string(&genesis).unwrap(),
                serde_json::to_string(&skipped).unwrap()
            ),
        )
        .unwrap();

        let verification = AuditLog::new(dir.path()).verify_chain().unwrap();
        assert!(!verification.valid);
        assert!(verification.message.contains("expected 1, got 2"));
    }

    #[test]
    fn v1_hash_framing_distinguishes_adjacent_field_boundaries() {
        let make_entry = |hash_version, action: &str, actor: &str| AuditEntry {
            hash_version,
            index: 7,
            timestamp: "2026-08-01T00:00:00Z".into(),
            action: action.into(),
            actor: actor.into(),
            details: "detail".into(),
            prev_hash: GENESIS_HASH.into(),
            hash: String::new(),
        };

        let legacy_left = AuditLog::compute_hash(make_entry(0, "ab", "c")).unwrap();
        let legacy_right = AuditLog::compute_hash(make_entry(0, "a", "bc")).unwrap();
        assert_eq!(legacy_left.hash, legacy_right.hash);

        let framed_left =
            AuditLog::compute_hash(make_entry(AUDIT_HASH_VERSION_V1, "ab", "c")).unwrap();
        let framed_right =
            AuditLog::compute_hash(make_entry(AUDIT_HASH_VERSION_V1, "a", "bc")).unwrap();
        assert_ne!(framed_left.hash, framed_right.hash);
        assert_ne!(legacy_left.hash, framed_left.hash);
        assert_eq!(
            framed_left.hash,
            "e86952b7db9b939d391b51d41228a8f9e647ea0401623e3256a5bd7bf8653fae"
        );
        assert_eq!(
            framed_right.hash,
            "28855432cdac46987f1932190529d22da7ea63a394e80417c1f334547a285f44"
        );
    }

    #[test]
    fn legacy_genesis_and_v1_append_form_a_valid_mixed_chain() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUDIT_LOG_FILE);
        let legacy = AuditLog::compute_hash(AuditEntry {
            hash_version: 0,
            index: 0,
            timestamp: "2026-08-01T00:00:00Z".into(),
            action: "genesis".into(),
            actor: "system".into(),
            details: "legacy chain".into(),
            prev_hash: GENESIS_HASH.into(),
            hash: String::new(),
        })
        .unwrap();
        let mut legacy_json = serde_json::to_value(&legacy).unwrap();
        legacy_json.as_object_mut().unwrap().remove("hash_version");
        std::fs::write(&path, format!("{}\n", legacy_json)).unwrap();

        let log = AuditLog::new(dir.path());
        let appended = log.append("modern", "system", "v1 entry").unwrap();
        assert_eq!(appended.hash_version, AUDIT_HASH_VERSION_V1);
        assert_eq!(appended.prev_hash, legacy.hash);

        let entries = log.get_entries(10).unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.hash_version)
                .collect::<Vec<_>>(),
            vec![0, AUDIT_HASH_VERSION_V1]
        );
        let verification = log.verify_chain().unwrap();
        assert!(verification.valid, "{}", verification.message);
        assert_eq!(verification.entries_checked, 2);
    }

    #[test]
    fn unsupported_hash_versions_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUDIT_LOG_FILE);
        let log = AuditLog::new(dir.path());
        let mut genesis: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        genesis["hash_version"] = serde_json::json!(2);
        std::fs::write(&path, format!("{}\n", genesis)).unwrap();

        let verification = log.verify_chain().unwrap();
        assert!(!verification.valid);
        assert!(verification
            .message
            .contains("Unsupported audit hash version 2"));
        assert!(log.get_entries(10).is_err());
        assert!(log
            .append("must_not_append", "system", "invalid chain")
            .is_err());
    }

    #[test]
    fn reset_erases_prior_details_and_starts_a_valid_chain() {
        let dir = tempfile::tempdir().unwrap();
        let log = AuditLog::new(dir.path());
        log.append("sensitive", "user", "private project path")
            .unwrap();

        log.reset().unwrap();

        let entries = log.get_entries(10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].action, "genesis");
        assert!(!serde_json::to_string(&entries)
            .unwrap()
            .contains("private project path"));
        assert!(log.verify_chain().unwrap().valid);
    }
}
