// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Audit Log — Tamper-Evident Cryptographic Hash Chain
//
// Every significant action in PrismOS-AI is recorded in a tamper-evident log.
// Each entry is chained to the previous entry via SHA-256 hash, creating
// an immutable, verifiable record of all system activity.
//
// Architecture:
//   1. Genesis entry has a well-known initial hash (all zeros)
//   2. Each subsequent entry includes the SHA-256 hash of the previous entry
//   3. The chain can be verified at any time — any tampering breaks the chain
//   4. Stored as newline-delimited JSON in the app data directory
//
// All data stays local. No telemetry. No cloud dependency.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUDIT_LOG_FILE: &str = "prismos-audit.log";
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

// ─── Data Models ───────────────────────────────────────────────────────────────

/// A single entry in the tamper-evident audit log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
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
    lock: Mutex<()>,
}

impl AuditLog {
    /// Create a new AuditLog instance for the given app data directory.
    /// Creates the log file with a genesis entry if it doesn't exist.
    pub fn new(app_dir: &Path) -> Self {
        let log_path = app_dir.join(AUDIT_LOG_FILE);

        let log = AuditLog {
            log_path,
            lock: Mutex::new(()),
        };

        // Create genesis entry if log doesn't exist or is empty
        if !log.log_path.exists() || fs::metadata(&log.log_path).map(|m| m.len() == 0).unwrap_or(true) {
            let genesis = AuditEntry {
                index: 0,
                timestamp: Utc::now().to_rfc3339(),
                action: "genesis".to_string(),
                actor: "system".to_string(),
                details: "PrismOS-AI audit chain initialized — Patent Pending".to_string(),
                prev_hash: GENESIS_HASH.to_string(),
                hash: String::new(), // Will be computed below
            };
            let genesis = Self::compute_hash(genesis);
            if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).open(&log.log_path) {
                let _ = writeln!(f, "{}", serde_json::to_string(&genesis).unwrap_or_default());
            }
        }

        log
    }

    /// Compute the SHA-256 hash for an entry based on its content.
    /// Hash covers: index + timestamp + action + actor + details + prev_hash
    fn compute_hash(mut entry: AuditEntry) -> AuditEntry {
        let mut hasher = Sha256::new();
        hasher.update(entry.index.to_le_bytes());
        hasher.update(entry.timestamp.as_bytes());
        hasher.update(entry.action.as_bytes());
        hasher.update(entry.actor.as_bytes());
        hasher.update(entry.details.as_bytes());
        hasher.update(entry.prev_hash.as_bytes());
        entry.hash = hex_encode(hasher.finalize().as_slice());
        entry
    }

    /// Get the hash of the last entry in the chain.
    /// Reads from the end of the file for O(1) performance instead of scanning every line.
    fn last_hash(&self) -> (u64, String) {
        use std::io::{Read, Seek, SeekFrom};

        let mut file = match fs::File::open(&self.log_path) {
            Ok(f) => f,
            Err(_) => return (0, GENESIS_HASH.to_string()),
        };

        // Seek to the end and read backwards to find the last complete JSON line
        let file_len = match file.seek(SeekFrom::End(0)) {
            Ok(len) => len,
            Err(_) => return (0, GENESIS_HASH.to_string()),
        };

        if file_len == 0 {
            return (0, GENESIS_HASH.to_string());
        }

        // Read the last chunk (up to 4KB covers any reasonable audit entry)
        let read_size = (file_len as usize).min(4096);
        let seek_pos = file_len.saturating_sub(read_size as u64);
        if file.seek(SeekFrom::Start(seek_pos)).is_err() {
            return (0, GENESIS_HASH.to_string());
        }

        let mut buf = String::new();
        if file.read_to_string(&mut buf).is_err() {
            return (0, GENESIS_HASH.to_string());
        }

        // Find the last non-empty line and parse it
        for line in buf.lines().rev() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<AuditEntry>(trimmed) {
                return (entry.index, entry.hash);
            }
        }

        (0, GENESIS_HASH.to_string())
    }

    /// Append a new entry to the audit log.
    /// Automatically chains to the previous entry's hash.
    pub fn append(&self, action: &str, actor: &str, details: &str) -> Result<AuditEntry, String> {
        let _guard = self.lock.lock().map_err(|e| format!("Lock error: {}", e))?;

        let (last_index, prev_hash) = self.last_hash();

        let entry = AuditEntry {
            index: last_index + 1,
            timestamp: Utc::now().to_rfc3339(),
            action: action.to_string(),
            actor: actor.to_string(),
            details: details.to_string(),
            prev_hash,
            hash: String::new(),
        };
        let entry = Self::compute_hash(entry);

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;

        writeln!(file, "{}", serde_json::to_string(&entry).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Failed to write audit entry: {}", e))?;

        Ok(entry)
    }

    /// Verify the entire hash chain for integrity.
    /// Returns whether the chain is valid and where the first break occurs.
    pub fn verify_chain(&self) -> Result<ChainVerification, String> {
        let _guard = self.lock.lock().map_err(|e| format!("Lock error: {}", e))?;

        let file = fs::File::open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;
        let reader = BufReader::new(file);

        let mut expected_prev_hash = GENESIS_HASH.to_string();
        let mut count = 0u64;

        for line in reader.lines() {
            let line = line.map_err(|e| format!("Read error: {}", e))?;
            if line.trim().is_empty() {
                continue;
            }

            let entry: AuditEntry = serde_json::from_str(&line)
                .map_err(|e| format!("Parse error at entry {}: {}", count, e))?;

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
            let recomputed = Self::compute_hash(AuditEntry {
                hash: String::new(),
                ..entry.clone()
            });
            if recomputed.hash != entry.hash {
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
            count += 1;
        }

        Ok(ChainVerification {
            valid: true,
            entries_checked: count,
            first_invalid_index: None,
            message: format!("✅ Audit chain verified — {} entries, all hashes valid", count),
        })
    }

    /// Get the most recent N entries from the audit log
    pub fn get_entries(&self, limit: usize) -> Result<Vec<AuditEntry>, String> {
        let _guard = self.lock.lock().map_err(|e| format!("Lock error: {}", e))?;

        let file = fs::File::open(&self.log_path)
            .map_err(|e| format!("Failed to open audit log: {}", e))?;
        let reader = BufReader::new(file);

        let mut entries: Vec<AuditEntry> = Vec::new();
        for line in reader.lines() {
            if let Ok(line) = line {
                if let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) {
                    entries.push(entry);
                }
            }
        }

        // Return the last N entries
        let start = entries.len().saturating_sub(limit);
        Ok(entries[start..].to_vec())
    }

    /// Get the total number of entries in the log
    pub fn entry_count(&self) -> u64 {
        let file = match fs::File::open(&self.log_path) {
            Ok(f) => f,
            Err(_) => return 0,
        };
        let reader = BufReader::new(file);
        reader.lines().filter(|l| l.is_ok()).count() as u64
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
    use std::path::PathBuf;

    #[test]
    fn test_audit_chain_integrity() {
        let tmp = PathBuf::from(std::env::temp_dir()).join("prismos-test-audit");
        let _ = fs::create_dir_all(&tmp);
        let _ = fs::remove_file(tmp.join(AUDIT_LOG_FILE));

        let log = AuditLog::new(&tmp);
        log.append("test_action", "test_actor", "Test entry 1").unwrap();
        log.append("test_action", "test_actor", "Test entry 2").unwrap();
        log.append("test_action", "test_actor", "Test entry 3").unwrap();

        let result = log.verify_chain().unwrap();
        assert!(result.valid);
        assert_eq!(result.entries_checked, 4); // genesis + 3

        let entries = log.get_entries(10).unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].action, "genesis");

        let _ = fs::remove_dir_all(&tmp);
    }
}
