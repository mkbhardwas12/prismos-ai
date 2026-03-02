// Patent Pending — US 63/993,589 (Feb 28, 2026)
// You-Port — Encrypted State Migration & Session Handoff
//
// You-Port enables secure, end-to-end encrypted export/import of the complete
// PrismOS state for device-to-device handoff and session persistence.
//
// Architecture per Patent 63/993,589:
//   1. Serialize full Spectrum Graph (nodes + edges + metrics)
//   2. Capture active agent states and collaboration metadata
//   3. Encrypt using device-derived key (HMAC-SHA256 key derivation + XOR stream cipher)
//   4. Sign with SHA-256 integrity checksum
//   5. Save to local encrypted file (.prismos-state)
//   6. On app launch, detect + decrypt + restore seamlessly
//
// Production path: AES-256-GCM with OS keychain integration.
// Current: HMAC-SHA256 key derivation + XOR stream cipher — fully functional
// encryption that protects data at rest without external crate dependencies.
//
// All data stays local. No cloud. No telemetry.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// State file name in the app data directory
const STATE_FILE: &str = "prismos-handoff.state";
/// Encryption key derivation salt (unique to PrismOS)
const KEY_SALT: &[u8] = b"PrismOS-YouPort-Patent-63993589-Salt";
/// Current format version
const FORMAT_VERSION: &str = "prismos-youport-v2";

// ─── Data Models ───────────────────────────────────────────────────────────────

/// The complete PrismOS state snapshot for handoff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouPortState {
    pub id: String,
    pub version: String,
    pub format: String,
    pub created_at: String,
    /// Full Spectrum Graph snapshot (nodes, edges, metrics)
    pub graph_snapshot: crate::spectrum_graph::GraphSnapshot,
    /// Active agent states at time of save
    pub agent_states: Vec<AgentState>,
    /// Session metadata
    pub session_meta: SessionMeta,
}

/// Individual agent state for handoff persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub agent_id: String,
    pub agent_name: String,
    pub status: String,
    pub last_active: Option<String>,
}

/// Session-level metadata carried across handoffs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    /// Total intents processed this session
    pub intents_processed: u32,
    /// Total feedback signals recorded
    pub feedback_count: u32,
    /// Device identifier (derived, not PII)
    pub device_fingerprint: String,
    /// Last collaboration session ID (if any)
    pub last_collaboration_id: Option<String>,
}

/// Encrypted package written to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedPackage {
    pub id: String,
    pub format: String,
    pub created_at: String,
    /// Base64-encoded encrypted payload
    pub encrypted_payload: String,
    /// SHA-256 integrity checksum of the plaintext
    pub checksum: String,
    /// HMAC-SHA256 signature of the encrypted payload (tamper detection)
    pub hmac_signature: String,
    /// Nonce used for key derivation (safe to store alongside ciphertext)
    pub nonce: String,
}

/// Result returned to the frontend after save/load operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffResult {
    pub success: bool,
    pub message: String,
    pub nodes_count: usize,
    pub edges_count: usize,
    pub timestamp: String,
}

// ─── Legacy Export/Import (backwards-compatible) ───────────────────────────────

/// Legacy YouPortPackage for simple data export (non-state)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouPortPackage {
    pub id: String,
    pub created_at: String,
    pub payload: String,
    pub checksum: String,
    pub version: String,
    pub format: String,
}

/// Create a legacy export package for simple data handoff
pub fn create_export_package(data: &str) -> YouPortPackage {
    let payload = BASE64.encode(data.as_bytes());
    let hash_bytes = Sha256::digest(data.as_bytes());
    let checksum = hex_encode(&hash_bytes);

    YouPortPackage {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        payload,
        checksum,
        version: "0.1.0".to_string(),
        format: "prismos-youport-v1".to_string(),
    }
}

/// Import and verify a legacy You-Port package
pub fn import_package(package: &YouPortPackage) -> Result<String, String> {
    let decoded = BASE64
        .decode(&package.payload)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    let data = String::from_utf8(decoded)
        .map_err(|e| format!("Invalid UTF-8 in payload: {}", e))?;

    let hash_bytes = Sha256::digest(data.as_bytes());
    let checksum = hex_encode(&hash_bytes);

    if checksum != package.checksum {
        return Err("Integrity check failed — checksum mismatch".to_string());
    }

    Ok(data)
}

// ─── Encryption Engine ─────────────────────────────────────────────────────────

/// Derive an encryption key from the device fingerprint and a nonce.
/// Uses HMAC-SHA256(salt || fingerprint || nonce) to produce a 32-byte key.
pub fn derive_key(device_fingerprint: &str, nonce: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(KEY_SALT)
        .expect("HMAC can take key of any size");
    mac.update(device_fingerprint.as_bytes());
    mac.update(b"||");
    mac.update(nonce.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// XOR stream cipher using HMAC-SHA256 in counter mode.
/// Produces a keystream by computing HMAC(key, counter) for each 32-byte block,
/// then XORs the plaintext against it. Symmetric: encrypt == decrypt.
pub fn xor_stream_cipher(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut offset = 0_usize;
    let mut counter = 0_u64;

    while offset < data.len() {
        // Generate 32 bytes of keystream per counter block
        let mut mac = HmacSha256::new_from_slice(key)
            .expect("HMAC can take key of any size");
        mac.update(&counter.to_le_bytes());
        let block = mac.finalize().into_bytes();

        let remaining = data.len() - offset;
        let chunk_len = remaining.min(32);

        for i in 0..chunk_len {
            result.push(data[offset + i] ^ block[i]);
        }

        offset += chunk_len;
        counter += 1;
    }

    result
}

/// Compute HMAC-SHA256 signature for tamper detection
pub fn compute_hmac(key: &[u8], data: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(key)
        .expect("HMAC can take key of any size");
    mac.update(data);
    hex_encode(&mac.finalize().into_bytes())
}

/// Generate a stable device fingerprint from environment.
/// This is NOT PII — it's a one-way hash used only for key derivation.
pub fn get_device_fingerprint(app_dir: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"PrismOS-Device-");

    // Use the app directory path as a device-stable component
    hasher.update(app_dir.to_string_lossy().as_bytes());

    // Add environment hints (these are stable per-device)
    if let Ok(user) = std::env::var("USERNAME").or_else(|_| std::env::var("USER")) {
        hasher.update(user.as_bytes());
    }
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        hasher.update(home.as_bytes());
    }

    hex_encode(&hasher.finalize())
}

/// Hex-encode a byte slice
pub fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Compute SHA-256 hash and return hex string
pub fn sha256_hex(data: &[u8]) -> String {
    hex_encode(&Sha256::digest(data))
}

/// Base64-encode a byte slice
pub fn base64_encode(data: &[u8]) -> String {
    BASE64.encode(data)
}

/// Base64-decode a string
pub fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    BASE64.decode(data).map_err(|e| format!("Base64 decode error: {}", e))
}

// ─── State Capture ─────────────────────────────────────────────────────────────

/// Capture the complete PrismOS state: Spectrum Graph + agent states + metadata.
/// This is the full "You-Port snapshot" per Patent 63/993,589.
pub fn capture_state(
    app_dir: &Path,
) -> Result<YouPortState, Box<dyn std::error::Error + Send + Sync>> {
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;

    // ── 1. Full graph snapshot ──
    let graph_snapshot = graph.get_full_graph()?;

    // ── 2. Agent states ──
    let agents = crate::refractive_core::get_agents();
    let agent_states: Vec<AgentState> = agents
        .iter()
        .map(|a| AgentState {
            agent_id: a.id.clone(),
            agent_name: a.name.clone(),
            status: format!("{:?}", a.status),
            last_active: None,
        })
        .collect();

    // ── 3. Session metadata ──
    let intent_count = graph
        .get_recent_intents(365)
        .map(|v| v.len() as u32)
        .unwrap_or(0);
    let feedback_count = graph.get_feedback_count().unwrap_or(0) as u32;

    let session_meta = SessionMeta {
        intents_processed: intent_count,
        feedback_count,
        device_fingerprint: get_device_fingerprint(app_dir),
        last_collaboration_id: None,
    };

    Ok(YouPortState {
        id: Uuid::new_v4().to_string(),
        version: "0.1.0".to_string(),
        format: FORMAT_VERSION.to_string(),
        created_at: Utc::now().to_rfc3339(),
        graph_snapshot,
        agent_states,
        session_meta,
    })
}

// ─── Save State (Encrypted) ───────────────────────────────────────────────────

/// Save the complete PrismOS state to an encrypted file.
/// Uses device-derived key encryption so the file is bound to this device.
pub fn save_state(
    app_dir: &Path,
) -> Result<HandoffResult, Box<dyn std::error::Error + Send + Sync>> {
    eprintln!("[You-Port] Capturing state for encrypted handoff...");

    // ── 1. Capture full state ──
    let state = capture_state(app_dir)?;
    let nodes_count = state.graph_snapshot.nodes.len();
    let edges_count = state.graph_snapshot.edges.len();

    // ── 2. Serialize to JSON ──
    let plaintext = serde_json::to_string(&state)?;
    let plaintext_bytes = plaintext.as_bytes();

    // ── 3. Compute plaintext integrity checksum ──
    let checksum = hex_encode(&Sha256::digest(plaintext_bytes));

    // ── 4. Derive encryption key ──
    let nonce = Uuid::new_v4().to_string();
    let device_fp = get_device_fingerprint(app_dir);
    let key = derive_key(&device_fp, &nonce);

    // ── 5. Encrypt ──
    let ciphertext = xor_stream_cipher(&key, plaintext_bytes);
    let encrypted_b64 = BASE64.encode(&ciphertext);

    // ── 6. Sign the ciphertext for tamper detection ──
    let hmac_sig = compute_hmac(&key, &ciphertext);

    // ── 7. Build encrypted package ──
    let package = EncryptedPackage {
        id: state.id.clone(),
        format: FORMAT_VERSION.to_string(),
        created_at: state.created_at.clone(),
        encrypted_payload: encrypted_b64,
        checksum,
        hmac_signature: hmac_sig,
        nonce,
    };

    // ── 8. Write to disk ──
    let state_path = app_dir.join(STATE_FILE);
    let package_json = serde_json::to_string_pretty(&package)?;
    std::fs::write(&state_path, &package_json)?;

    eprintln!(
        "[You-Port] State saved: {} nodes, {} edges → {:?} ({} bytes encrypted)",
        nodes_count,
        edges_count,
        state_path,
        package_json.len()
    );

    Ok(HandoffResult {
        success: true,
        message: format!(
            "State saved: {} nodes, {} edges encrypted to disk",
            nodes_count, edges_count
        ),
        nodes_count,
        edges_count,
        timestamp: state.created_at,
    })
}

// ─── Load State (Decrypt + Restore) ───────────────────────────────────────────

/// Load and restore PrismOS state from an encrypted handoff file.
/// Decrypts, verifies integrity, and merges into the current Spectrum Graph.
pub fn load_state(
    app_dir: &Path,
) -> Result<HandoffResult, Box<dyn std::error::Error + Send + Sync>> {
    let state_path = app_dir.join(STATE_FILE);

    if !state_path.exists() {
        return Ok(HandoffResult {
            success: false,
            message: "No saved state found".to_string(),
            nodes_count: 0,
            edges_count: 0,
            timestamp: Utc::now().to_rfc3339(),
        });
    }

    eprintln!("[You-Port] Loading encrypted state from {:?}...", state_path);

    // ── 1. Read encrypted package ──
    let package_json = std::fs::read_to_string(&state_path)?;
    let package: EncryptedPackage = serde_json::from_str(&package_json)?;

    // Verify format
    if package.format != FORMAT_VERSION {
        return Err(format!(
            "Unsupported state format: {} (expected {})",
            package.format, FORMAT_VERSION
        )
        .into());
    }

    // ── 2. Derive decryption key (same device fingerprint + stored nonce) ──
    let device_fp = get_device_fingerprint(app_dir);
    let key = derive_key(&device_fp, &package.nonce);

    // ── 3. Decode and verify HMAC ──
    let ciphertext = BASE64
        .decode(&package.encrypted_payload)
        .map_err(|e| format!("Failed to decode encrypted payload: {}", e))?;

    let expected_hmac = compute_hmac(&key, &ciphertext);
    if expected_hmac != package.hmac_signature {
        return Err(
            "HMAC verification failed — state file may be tampered or from a different device"
                .into(),
        );
    }

    // ── 4. Decrypt ──
    let plaintext_bytes = xor_stream_cipher(&key, &ciphertext);

    // ── 5. Verify plaintext integrity ──
    let plaintext_checksum = hex_encode(&Sha256::digest(&plaintext_bytes));
    if plaintext_checksum != package.checksum {
        return Err("Integrity checksum mismatch — decryption may have failed".into());
    }

    let plaintext = String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))?;

    // ── 6. Deserialize state ──
    let state: YouPortState = serde_json::from_str(&plaintext)?;

    // ── 7. Restore Spectrum Graph (merge — skip existing nodes/edges) ──
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
    let mut nodes_restored = 0_usize;
    let mut edges_restored = 0_usize;

    for node in &state.graph_snapshot.nodes {
        match graph.get_node(&node.id) {
            Ok(_) => {} // Already exists, skip
            Err(_) => {
                if graph
                    .add_node_with_layer(&node.label, &node.content, &node.node_type, &node.layer)
                    .is_ok()
                {
                    nodes_restored += 1;
                }
            }
        }
    }

    for edge in &state.graph_snapshot.edges {
        match graph.get_or_create_edge(&edge.source_id, &edge.target_id, &edge.relation) {
            Ok(_) => edges_restored += 1,
            Err(_) => {}
        }
    }

    let total_nodes = state.graph_snapshot.nodes.len();
    let total_edges = state.graph_snapshot.edges.len();

    eprintln!(
        "[You-Port] State restored: {}/{} nodes, {}/{} edges from {}",
        nodes_restored, total_nodes, edges_restored, total_edges, package.created_at
    );

    Ok(HandoffResult {
        success: true,
        message: format!(
            "Restored from session saved at {}. {} nodes, {} edges in graph.",
            package.created_at, total_nodes, total_edges
        ),
        nodes_count: total_nodes,
        edges_count: total_edges,
        timestamp: package.created_at,
    })
}

/// Check if a saved state file exists (for startup detection)
pub fn has_saved_state(app_dir: &Path) -> bool {
    app_dir.join(STATE_FILE).exists()
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_legacy_export_import_roundtrip() {
        let original = "PrismOS test data — local-first AI";
        let package = create_export_package(original);

        assert_eq!(package.version, "0.1.0");
        assert_eq!(package.format, "prismos-youport-v1");
        assert!(!package.payload.is_empty());
        assert!(!package.checksum.is_empty());

        let imported = import_package(&package).expect("Import should succeed");
        assert_eq!(imported, original);
    }

    #[test]
    fn test_tampered_package_fails() {
        let package = create_export_package("original data");
        let mut tampered = package;
        tampered.payload = BASE64.encode(b"tampered data");

        let result = import_package(&tampered);
        assert!(result.is_err());
    }

    #[test]
    fn test_xor_cipher_roundtrip() {
        let key = derive_key("test-device", "test-nonce");
        let plaintext = b"Hello PrismOS! Patent 63/993,589 - encrypted handoff test data that spans multiple blocks to verify counter mode works correctly.";

        let ciphertext = xor_stream_cipher(&key, plaintext);
        assert_ne!(&ciphertext, plaintext);
        assert_eq!(ciphertext.len(), plaintext.len());

        let decrypted = xor_stream_cipher(&key, &ciphertext);
        assert_eq!(&decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = derive_key("device-A", "nonce-1");
        let key2 = derive_key("device-B", "nonce-1");

        let plaintext = b"secret data";
        let ciphertext = xor_stream_cipher(&key1, plaintext);
        let wrong_decrypt = xor_stream_cipher(&key2, &ciphertext);

        assert_ne!(&wrong_decrypt, plaintext);
    }

    #[test]
    fn test_hmac_tamper_detection() {
        let key = derive_key("device", "nonce");
        let data = b"important payload";

        let sig1 = compute_hmac(&key, data);
        let sig2 = compute_hmac(&key, b"tampered payload");

        assert_ne!(sig1, sig2);
    }

    #[test]
    fn test_device_fingerprint_stable() {
        let path = Path::new("/tmp/test-prismos");
        let fp1 = get_device_fingerprint(path);
        let fp2 = get_device_fingerprint(path);
        assert_eq!(fp1, fp2);
        assert_eq!(fp1.len(), 64); // SHA-256 hex = 64 chars
    }
}
