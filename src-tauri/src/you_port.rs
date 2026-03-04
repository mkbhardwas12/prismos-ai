// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// You-Port — Encrypted State Migration & Session Handoff
//
// You-Port enables secure, end-to-end encrypted export/import of the complete
// PrismOS-AI state for device-to-device handoff and session persistence.
//
// Architecture:
//   1. Serialize full Spectrum Graph (nodes + edges + metrics)
//   2. Capture active agent states and collaboration metadata
//   3. Encrypt using AES-256-GCM with HMAC-SHA256-derived key
//   4. Sign with SHA-256 integrity checksum
//   5. Save to local encrypted file (.prismos-state)
//   6. On app launch, detect + decrypt + restore seamlessly
//
// Encryption: AES-256-GCM authenticated encryption (AEAD) — provides both
// confidentiality and integrity in a single standard construct.
//
// All data stays local. No cloud. No telemetry.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use serde::{Serialize, Deserialize};
use sha2::{Sha256, Digest};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use aes_gcm::aead::{Aead, KeyInit as AesKeyInit};
use hmac::{Hmac, Mac};
use std::path::Path;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// State file name in the app data directory
const STATE_FILE: &str = "prismos-handoff.state";
/// Encryption key derivation salt.
/// Uses PRISMOS_KEY_SALT environment variable at build time if set,
/// otherwise falls back to a default. Override for production deployments.
const KEY_SALT: &[u8] = match option_env!("PRISMOS_KEY_SALT") {
    Some(s) => s.as_bytes(),
    None => b"PrismOS-YouPort-Default-Salt-v1",
};
/// Current format version (v3 = AES-256-GCM, v2 = XOR legacy)
const FORMAT_VERSION: &str = "prismos-youport-v3";

// ─── Data Models ───────────────────────────────────────────────────────────────

/// The complete PrismOS-AI state snapshot for handoff
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

// ─── Encryption Engine (AES-256-GCM) ───────────────────────────────────────────

/// Derive a 32-byte encryption key from the device fingerprint and a nonce.
/// Uses HMAC-SHA256(salt || fingerprint || nonce) to produce a 256-bit key.
pub fn derive_key(device_fingerprint: &str, nonce: &str) -> Vec<u8> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(KEY_SALT)
        .expect("HMAC can take key of any size");
    mac.update(device_fingerprint.as_bytes());
    mac.update(b"||");
    mac.update(nonce.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// Encrypt data using AES-256-GCM authenticated encryption.
/// Returns the ciphertext with the 12-byte nonce prepended.
/// The AEAD tag provides built-in tamper detection.
pub fn aes_encrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = <Aes256Gcm as AesKeyInit>::new_from_slice(key)
        .map_err(|e| format!("AES key error: {}", e))?;

    // Generate a cryptographically random 12-byte nonce (never reuse with same key)
    let mut nonce_bytes = [0u8; 12];
    getrandom::getrandom(&mut nonce_bytes)
        .map_err(|e| format!("Failed to generate random nonce: {}", e))?;
    let nonce = AesNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, data)
        .map_err(|e| format!("AES encryption failed: {}", e))?;

    // Prepend nonce to ciphertext so decrypt can extract it
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt data encrypted with aes_encrypt.
/// Expects the 12-byte nonce prepended to the ciphertext.
pub fn aes_decrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 13 {
        return Err("Ciphertext too short (missing nonce)".to_string());
    }
    let cipher = <Aes256Gcm as AesKeyInit>::new_from_slice(key)
        .map_err(|e| format!("AES key error: {}", e))?;

    let nonce = AesNonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];

    cipher.decrypt(nonce, ciphertext)
        .map_err(|_| "AES-GCM decryption failed — wrong key, tampered data, or different device".to_string())
}

/// Legacy XOR stream cipher — kept for backward-compatible decryption of
/// existing v1/v2 state files. New encryptions always use AES-256-GCM.
pub fn xor_stream_cipher(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut offset = 0_usize;
    let mut counter = 0_u64;

    while offset < data.len() {
        let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
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

/// Compute HMAC-SHA256 signature for tamper detection (used by legacy format)
pub fn compute_hmac(key: &[u8], data: &[u8]) -> String {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
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

/// Capture the complete PrismOS-AI state: Spectrum Graph + agent states + metadata.
/// This is the full "You-Port snapshot" for encrypted device handoff.
pub fn capture_state(
    graph: &crate::spectrum_graph::SpectrumGraph,
    app_dir: &Path,
) -> Result<YouPortState, Box<dyn std::error::Error + Send + Sync>> {
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

/// Save the complete PrismOS-AI state to an encrypted file.
/// Uses device-derived key encryption so the file is bound to this device.
pub fn save_state(
    graph: &crate::spectrum_graph::SpectrumGraph,
    app_dir: &Path,
) -> Result<HandoffResult, Box<dyn std::error::Error + Send + Sync>> {
    eprintln!("[You-Port] Capturing state for encrypted handoff...");

    // ── 1. Capture full state ──
    let state = capture_state(graph, app_dir)?;
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

    // ── 5. Encrypt with AES-256-GCM (authenticated encryption) ──
    let ciphertext = aes_encrypt(&key, plaintext_bytes)
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
    let encrypted_b64 = BASE64.encode(&ciphertext);

    // ── 6. HMAC is no longer needed — AES-GCM provides built-in authentication ──
    let hmac_sig = String::new(); // Kept for format compatibility

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

/// Load and restore PrismOS-AI state from an encrypted handoff file.
/// Decrypts, verifies integrity, and merges into the current Spectrum Graph.
pub fn load_state(
    graph: &crate::spectrum_graph::SpectrumGraph,
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

    // Verify format — support both v3 (AES-GCM) and v2 (legacy XOR)
    let is_legacy = package.format == "prismos-youport-v2";
    if package.format != FORMAT_VERSION && !is_legacy {
        return Err(format!(
            "Unsupported state format: {} (expected {})",
            package.format, FORMAT_VERSION
        )
        .into());
    }

    // ── 2. Derive decryption key (same device fingerprint + stored nonce) ──
    let device_fp = get_device_fingerprint(app_dir);
    let key = derive_key(&device_fp, &package.nonce);

    // ── 3. Decode ciphertext ──
    let ciphertext = BASE64
        .decode(&package.encrypted_payload)
        .map_err(|e| format!("Failed to decode encrypted payload: {}", e))?;

    // ── 4. Decrypt (AES-GCM for v3, legacy XOR for v2) ──
    let plaintext_bytes = if is_legacy {
        // Legacy v2: verify HMAC then XOR-decrypt
        let expected_hmac = compute_hmac(&key, &ciphertext);
        if expected_hmac != package.hmac_signature {
            return Err(
                "HMAC verification failed — state file may be tampered or from a different device"
                    .into(),
            );
        }
        xor_stream_cipher(&key, &ciphertext)
    } else {
        // v3: AES-256-GCM handles authentication internally
        aes_decrypt(&key, &ciphertext)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?
    };

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

// ─── Advanced You-Port: Cross-Device Merge (Patent Pending) ─────────────────

/// Result of a cross-device merge operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossDeviceMergeResult {
    pub success: bool,
    pub message: String,
    pub merge_result: crate::spectrum_graph::MergeResult,
    pub source_device: String,
    pub source_timestamp: String,
}

/// Export the local graph as an encrypted sync package for another device.
/// The exported package includes a "shared key" nonce that any PrismOS-AI instance
/// can use with a user-supplied passphrase for decryption.
pub fn export_sync_package(
    app_dir: &Path,
    passphrase: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
    let snapshot = graph.get_full_graph()?;

    let nodes_count = snapshot.nodes.len();
    let edges_count = snapshot.edges.len();

    // Serialize the snapshot
    let state = serde_json::json!({
        "format": "prismos-sync-v1",
        "exported_at": Utc::now().to_rfc3339(),
        "source_device": get_device_fingerprint(app_dir),
        "snapshot": snapshot,
    });
    let plaintext = serde_json::to_string(&state)?;
    let plaintext_bytes = plaintext.as_bytes();

    // Use passphrase-based key derivation (instead of device-bound key)
    let nonce = Uuid::new_v4().to_string();
    let key = derive_key(passphrase, &nonce);
    let checksum = sha256_hex(plaintext_bytes);

    // Encrypt with AES-256-GCM
    let ciphertext = aes_encrypt(&key, plaintext_bytes)?;
    let encrypted_b64 = BASE64.encode(&ciphertext);

    let package = serde_json::json!({
        "format": "prismos-sync-encrypted-v2",
        "id": Uuid::new_v4().to_string(),
        "created_at": Utc::now().to_rfc3339(),
        "encrypted_payload": encrypted_b64,
        "checksum": checksum,
        "nonce": nonce,
        "key_type": "passphrase",
        "stats": {
            "nodes": nodes_count,
            "edges": edges_count,
        }
    });

    serde_json::to_string_pretty(&package).map_err(|e| e.into())
}

/// Import and merge a sync package from another device.
/// Decrypts using the user-supplied passphrase, then merges with conflict resolution.
pub fn import_sync_package(
    app_dir: &Path,
    package_json: &str,
    passphrase: &str,
    strategy: &str,
) -> Result<CrossDeviceMergeResult, Box<dyn std::error::Error + Send + Sync>> {
    let package: serde_json::Value = serde_json::from_str(package_json)?;

    let format = package["format"].as_str().unwrap_or("");
    let is_legacy_sync = format == "prismos-sync-encrypted-v1";
    if format != "prismos-sync-encrypted-v2" && !is_legacy_sync {
        return Err(format!("Unsupported sync format: {} (expected prismos-sync-encrypted-v2)", format).into());
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let nonce = package["nonce"].as_str().ok_or("Missing nonce")?;
    let stored_checksum = package["checksum"].as_str().ok_or("Missing checksum")?;

    // Derive key from passphrase + nonce
    let key = derive_key(passphrase, nonce);

    // Decode
    let ciphertext = BASE64
        .decode(encrypted_b64)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    // Decrypt based on format version
    let plaintext_bytes = if is_legacy_sync {
        let stored_hmac = package["hmac_signature"]
            .as_str()
            .ok_or("Missing hmac_signature")?;
        let expected_hmac = compute_hmac(&key, &ciphertext);
        if expected_hmac != stored_hmac {
            return Err("HMAC verification failed — wrong passphrase or tampered file".into());
        }
        xor_stream_cipher(&key, &ciphertext)
    } else {
        aes_decrypt(&key, &ciphertext)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?
    };

    // Verify integrity
    let checksum = sha256_hex(&plaintext_bytes);
    if checksum != stored_checksum {
        return Err("Integrity checksum mismatch — decryption failed (wrong passphrase?)".into());
    }

    let plaintext = String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))?;

    // Parse the sync state
    let state: serde_json::Value = serde_json::from_str(&plaintext)?;
    let source_device = state["source_device"].as_str().unwrap_or("unknown").to_string();
    let source_timestamp = state["exported_at"].as_str().unwrap_or("unknown").to_string();

    let snapshot_val = state.get("snapshot")
        .ok_or("Missing snapshot in sync package")?;
    let snapshot: crate::spectrum_graph::GraphSnapshot =
        serde_json::from_value(snapshot_val.clone())?;

    // Merge using the specified strategy
    let merge_strategy = crate::spectrum_graph::MergeStrategy::from_str(strategy);
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
    let merge_result = graph.merge_graph(&snapshot, &merge_strategy)?;

    Ok(CrossDeviceMergeResult {
        success: merge_result.success,
        message: merge_result.message.clone(),
        merge_result,
        source_device,
        source_timestamp,
    })
}

/// Preview a merge diff without applying changes.
/// Returns the diff report showing what would happen if merged.
pub fn preview_sync_merge(
    app_dir: &Path,
    package_json: &str,
    passphrase: &str,
    strategy: &str,
) -> Result<crate::spectrum_graph::MergeDiff, Box<dyn std::error::Error + Send + Sync>> {
    let package: serde_json::Value = serde_json::from_str(package_json)?;

    let format = package["format"].as_str().unwrap_or("");
    let is_legacy_sync = format == "prismos-sync-encrypted-v1";
    if format != "prismos-sync-encrypted-v2" && !is_legacy_sync {
        return Err(format!("Unsupported sync format: {}", format).into());
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let nonce = package["nonce"].as_str().ok_or("Missing nonce")?;

    let key = derive_key(passphrase, nonce);
    let ciphertext = BASE64
        .decode(encrypted_b64)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    let plaintext_bytes = if is_legacy_sync {
        let stored_hmac = package["hmac_signature"]
            .as_str()
            .ok_or("Missing hmac_signature")?;
        let expected_hmac = compute_hmac(&key, &ciphertext);
        if expected_hmac != stored_hmac {
            return Err("HMAC verification failed — wrong passphrase or tampered file".into());
        }
        xor_stream_cipher(&key, &ciphertext)
    } else {
        aes_decrypt(&key, &ciphertext)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?
    };
    let plaintext = String::from_utf8(plaintext_bytes)?;

    let state: serde_json::Value = serde_json::from_str(&plaintext)?;
    let snapshot_val = state.get("snapshot").ok_or("Missing snapshot")?;
    let snapshot: crate::spectrum_graph::GraphSnapshot =
        serde_json::from_value(snapshot_val.clone())?;

    let merge_strategy = crate::spectrum_graph::MergeStrategy::from_str(strategy);
    let graph = crate::spectrum_graph::SpectrumGraph::new(app_dir)?;
    graph.diff_graph(&snapshot, &merge_strategy)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_legacy_export_import_roundtrip() {
        let original = "PrismOS-AI test data — local-first AI";
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
        let plaintext = b"Hello PrismOS-AI! Patent Pending - encrypted handoff test data that spans multiple blocks to verify counter mode works correctly.";

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

    #[test]
    fn test_aes_gcm_roundtrip() {
        let key = derive_key("test-device", "test-nonce");
        let plaintext = b"Hello PrismOS-AI! AES-256-GCM authenticated encryption test across multiple blocks.";

        let ciphertext = aes_encrypt(&key, plaintext).expect("Encryption should succeed");
        // AES-GCM adds 12-byte nonce + 16-byte auth tag
        assert!(ciphertext.len() > plaintext.len());

        let decrypted = aes_decrypt(&key, &ciphertext).expect("Decryption should succeed");
        assert_eq!(&decrypted, plaintext);
    }

    #[test]
    fn test_aes_gcm_wrong_key_fails() {
        let key1 = derive_key("device-A", "nonce-1");
        let key2 = derive_key("device-B", "nonce-1");

        let plaintext = b"secret data";
        let ciphertext = aes_encrypt(&key1, plaintext).expect("Encryption should succeed");

        let result = aes_decrypt(&key2, &ciphertext);
        assert!(result.is_err(), "Decryption with wrong key should fail");
    }

    #[test]
    fn test_aes_gcm_tampered_data_fails() {
        let key = derive_key("device", "nonce");
        let plaintext = b"important payload";
        let mut ciphertext = aes_encrypt(&key, plaintext).expect("Encryption should succeed");

        // Tamper with a byte in the ciphertext (after the 12-byte nonce)
        if ciphertext.len() > 15 {
            ciphertext[15] ^= 0xFF;
        }

        let result = aes_decrypt(&key, &ciphertext);
        assert!(result.is_err(), "Tampered ciphertext should fail authentication");
    }
}
