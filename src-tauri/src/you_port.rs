// You-Port — Encrypted State Migration & Session Handoff
//
// You-Port enables authenticated encrypted export/import of portable PrismOS-AI
// state for device-to-device handoff and session persistence. Approved Project
// Knowledge excerpts are deliberately excluded and must be re-indexed from source.
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
// This module writes local packages; moving a package elsewhere is an explicit
// user action and has the privacy boundary of the chosen transfer method.

use aes_gcm::aead::{Aead, KeyInit as AesKeyInit};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// State file name in the app data directory
const STATE_FILE: &str = "prismos-handoff.state";
const DEVICE_KEY_FILE: &str = "you-port-device.key";
pub(crate) const PASSPHRASE_KDF_ITERATIONS: u32 = 600_000;
const MIN_SYNC_PASSPHRASE_CHARS: usize = 12;
/// Upper bounds prevent a selected/corrupt package from causing multi-gigabyte
/// JSON/base64/decryption allocations before graph-level validation runs.
pub(crate) const MAX_PORTABLE_PACKAGE_JSON_BYTES: usize = 128 * 1024 * 1024;
const MAX_PORTABLE_ENCODED_PAYLOAD_BYTES: usize = 120 * 1024 * 1024;
const MAX_PORTABLE_CIPHERTEXT_BYTES: usize = 90 * 1024 * 1024;
const MAX_PORTABLE_PLAINTEXT_BYTES: usize = 96 * 1024 * 1024;
/// Encryption key derivation salt.
/// Uses PRISMOS_KEY_SALT environment variable at build time if set,
/// otherwise falls back to a default. Override for production deployments.
const KEY_SALT: &[u8] = match option_env!("PRISMOS_KEY_SALT") {
    Some(s) => s.as_bytes(),
    None => b"PrismOS-YouPort-Default-Salt-v1",
};
/// Current format version (v4 = random device secret + AES-256-GCM).
const FORMAT_VERSION: &str = "prismos-youport-v4";

pub(crate) fn ensure_package_json_bounded(package_json: &str) -> Result<(), String> {
    if package_json.len() > MAX_PORTABLE_PACKAGE_JSON_BYTES {
        return Err(format!(
            "Encrypted package exceeds the {}-byte limit",
            MAX_PORTABLE_PACKAGE_JSON_BYTES
        ));
    }
    Ok(())
}

pub(crate) fn decode_portable_payload(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > MAX_PORTABLE_ENCODED_PAYLOAD_BYTES {
        return Err(format!(
            "Encoded payload exceeds the {}-byte limit",
            MAX_PORTABLE_ENCODED_PAYLOAD_BYTES
        ));
    }
    let decoded = BASE64
        .decode(encoded)
        .map_err(|error| format!("Failed to decode encrypted payload: {error}"))?;
    if decoded.len() > MAX_PORTABLE_CIPHERTEXT_BYTES {
        return Err(format!(
            "Ciphertext exceeds the {}-byte limit",
            MAX_PORTABLE_CIPHERTEXT_BYTES
        ));
    }
    Ok(decoded)
}

pub(crate) fn ensure_portable_plaintext_bounded(plaintext: &[u8]) -> Result<(), String> {
    if plaintext.len() > MAX_PORTABLE_PLAINTEXT_BYTES {
        return Err(format!(
            "Decrypted payload exceeds the {}-byte limit",
            MAX_PORTABLE_PLAINTEXT_BYTES
        ));
    }
    Ok(())
}

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
    #[serde(default)]
    pub kdf: String,
    #[serde(default)]
    pub kdf_salt: String,
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
#[allow(dead_code)] // Serialized compatibility shape for legacy handoff packages.
pub struct YouPortPackage {
    pub id: String,
    pub created_at: String,
    pub payload: String,
    pub checksum: String,
    pub version: String,
    pub format: String,
}

/// Create a legacy export package for simple data handoff
#[allow(dead_code)]
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
#[allow(dead_code)]
pub fn import_package(package: &YouPortPackage) -> Result<String, String> {
    let decoded = BASE64
        .decode(&package.payload)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    let data =
        String::from_utf8(decoded).map_err(|e| format!("Invalid UTF-8 in payload: {}", e))?;

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
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(KEY_SALT).expect("HMAC can take key of any size");
    mac.update(device_fingerprint.as_bytes());
    mac.update(b"||");
    mac.update(nonce.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

pub fn generate_kdf_salt() -> Result<String, String> {
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt)
        .map_err(|error| format!("Failed to generate KDF salt: {error}"))?;
    Ok(BASE64.encode(salt))
}

fn read_device_secret(path: &Path) -> Result<[u8; 32], String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect device key: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Device key path is not a regular non-symlink file".into());
    }
    let mut file = File::open(path).map_err(|error| format!("Cannot open device key: {error}"))?;
    let mut bytes = Vec::with_capacity(33);
    (&mut file)
        .take(33)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read device key: {error}"))?;
    if bytes.len() != 32 {
        return Err("Device key has an invalid length; refusing to overwrite it".into());
    }
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&bytes);
    Ok(secret)
}

fn load_or_create_device_secret(app_dir: &Path) -> Result<[u8; 32], String> {
    std::fs::create_dir_all(app_dir)
        .map_err(|error| format!("Cannot create app data directory: {error}"))?;
    let key_path = app_dir.join(DEVICE_KEY_FILE);
    if key_path.exists() {
        return read_device_secret(&key_path);
    }

    let mut secret = [0u8; 32];
    getrandom::getrandom(&mut secret)
        .map_err(|error| format!("Failed to generate device key: {error}"))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&key_path) {
        Ok(mut file) => {
            file.write_all(&secret)
                .map_err(|error| format!("Cannot write device key: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Cannot flush device key: {error}"))?;
            Ok(secret)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            read_device_secret(&key_path)
        }
        Err(error) => Err(format!("Cannot create device key: {error}")),
    }
}

pub fn derive_device_bound_key(app_dir: &Path, salt_b64: &str) -> Result<Vec<u8>, String> {
    let salt = BASE64
        .decode(salt_b64)
        .map_err(|error| format!("Invalid device-key salt: {error}"))?;
    if salt.len() != 16 {
        return Err("Device-key salt must be exactly 16 bytes".into());
    }
    let secret = load_or_create_device_secret(app_dir)?;
    let mut mac = <HmacSha256 as Mac>::new_from_slice(&secret)
        .map_err(|error| format!("Device-key HMAC setup failed: {error}"))?;
    mac.update(b"PrismOS device-bound export v1\0");
    mac.update(&salt);
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn validate_sync_passphrase(passphrase: &str) -> Result<(), String> {
    let character_count = passphrase.chars().count();
    if character_count < MIN_SYNC_PASSPHRASE_CHARS {
        return Err(format!(
            "Sync passphrases must contain at least {MIN_SYNC_PASSPHRASE_CHARS} characters"
        ));
    }
    if passphrase.len() > 1024 {
        return Err("Sync passphrase is too long".into());
    }
    Ok(())
}

fn pbkdf2_sha256(passphrase: &[u8], salt: &[u8], iterations: u32) -> Result<[u8; 32], String> {
    if iterations == 0 {
        return Err("PBKDF2 iteration count must be positive".into());
    }
    let mut first = <HmacSha256 as Mac>::new_from_slice(passphrase)
        .map_err(|error| format!("PBKDF2 setup failed: {error}"))?;
    first.update(salt);
    first.update(&1u32.to_be_bytes());
    let mut u = first.finalize().into_bytes();
    let mut output = [0u8; 32];
    output.copy_from_slice(&u);
    for _ in 1..iterations {
        let mut mac = <HmacSha256 as Mac>::new_from_slice(passphrase)
            .map_err(|error| format!("PBKDF2 setup failed: {error}"))?;
        mac.update(&u);
        u = mac.finalize().into_bytes();
        for (target, value) in output.iter_mut().zip(u.iter()) {
            *target ^= value;
        }
    }
    Ok(output)
}

pub(crate) fn derive_passphrase_key(
    passphrase: &str,
    salt_b64: &str,
    iterations: u32,
) -> Result<Vec<u8>, String> {
    validate_sync_passphrase(passphrase)?;
    if !(100_000..=2_000_000).contains(&iterations) {
        return Err("Unsupported PBKDF2 iteration count".into());
    }
    let salt = BASE64
        .decode(salt_b64)
        .map_err(|error| format!("Invalid PBKDF2 salt: {error}"))?;
    if salt.len() != 16 {
        return Err("PBKDF2 salt must be exactly 16 bytes".into());
    }
    Ok(pbkdf2_sha256(passphrase.as_bytes(), &salt, iterations)?.to_vec())
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

    let ciphertext = cipher
        .encrypt(nonce, data)
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

    cipher.decrypt(nonce, ciphertext).map_err(|_| {
        "AES-GCM decryption failed — wrong key, tampered data, or different device".to_string()
    })
}

/// Legacy XOR stream cipher — kept for backward-compatible decryption of
/// existing v1/v2 state files. New encryptions always use AES-256-GCM.
pub fn xor_stream_cipher(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut offset = 0_usize;
    let mut counter = 0_u64;

    while offset < data.len() {
        let mut mac =
            <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC can take key of any size");
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
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC can take key of any size");
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
#[allow(dead_code)] // Kept with base64_encode for legacy package consumers.
pub fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(data)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

// ─── State Capture ─────────────────────────────────────────────────────────────

/// Capture the complete PrismOS-AI state: Spectrum Graph + agent states + metadata.
/// This is the full "You-Port snapshot" for encrypted device handoff.
pub fn capture_state(
    graph: &crate::spectrum_graph::SpectrumGraph,
    app_dir: &Path,
) -> Result<YouPortState, Box<dyn std::error::Error + Send + Sync>> {
    // ── 1. Portable graph snapshot ──
    let graph_snapshot = graph.get_portable_graph()?;

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

/// Save a portable Spectrum Graph handoff to an encrypted file.
/// Uses device-derived key encryption so the file is bound to this device.
pub fn save_state(
    graph: &crate::spectrum_graph::SpectrumGraph,
    app_dir: &Path,
) -> Result<HandoffResult, Box<dyn std::error::Error + Send + Sync>> {
    eprintln!("[You-Port] Capturing state for encrypted handoff...");

    // ── 1. Capture portable graph handoff metadata ──
    let state = capture_state(graph, app_dir)?;
    let nodes_count = state.graph_snapshot.nodes.len();
    let edges_count = state.graph_snapshot.edges.len();

    // ── 2. Serialize to JSON ──
    let plaintext = serde_json::to_string(&state)?;
    let plaintext_bytes = plaintext.as_bytes();

    // ── 3. Compute plaintext integrity checksum ──
    let checksum = hex_encode(&Sha256::digest(plaintext_bytes));

    // ── 4. Derive encryption key from a random account-private device secret ──
    let kdf_salt = generate_kdf_salt()?;
    let key = derive_device_bound_key(app_dir, &kdf_salt)?;

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
        nonce: String::new(),
        kdf: "device-secret-hmac-sha256-v1".into(),
        kdf_salt,
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

/// Load a portable Spectrum Graph handoff from an encrypted file.
/// Decrypts, verifies integrity, and merges only its graph snapshot.
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

    eprintln!(
        "[You-Port] Loading encrypted state from {:?}...",
        state_path
    );

    // ── 1. Read encrypted package ──
    let metadata = std::fs::symlink_metadata(&state_path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Refusing a non-regular or symlinked handoff state file".into());
    }
    if metadata.len() > MAX_PORTABLE_PACKAGE_JSON_BYTES as u64 {
        return Err(format!(
            "Handoff state exceeds the {}-byte limit",
            MAX_PORTABLE_PACKAGE_JSON_BYTES
        )
        .into());
    }
    let package_json = std::fs::read_to_string(&state_path)?;
    ensure_package_json_bounded(&package_json)?;
    let package: EncryptedPackage = serde_json::from_str(&package_json)?;

    // Verify format — support v3 (legacy device-fingerprint AES-GCM) and
    // v2 (legacy XOR) for existing files.
    let is_legacy_xor = package.format == "prismos-youport-v2";
    let is_legacy_aes = package.format == "prismos-youport-v3";
    if package.format != FORMAT_VERSION && !is_legacy_xor && !is_legacy_aes {
        return Err(format!(
            "Unsupported state format: {} (expected {})",
            package.format, FORMAT_VERSION
        )
        .into());
    }

    // ── 2. Derive the format-appropriate decryption key ──
    let key = if package.format == FORMAT_VERSION {
        if package.kdf != "device-secret-hmac-sha256-v1" {
            return Err(format!("Unsupported device KDF: {}", package.kdf).into());
        }
        derive_device_bound_key(app_dir, &package.kdf_salt)?
    } else {
        let device_fp = get_device_fingerprint(app_dir);
        derive_key(&device_fp, &package.nonce)
    };

    // ── 3. Decode ciphertext ──
    let ciphertext = decode_portable_payload(&package.encrypted_payload)?;

    // ── 4. Decrypt (AES-GCM for v3, legacy XOR for v2) ──
    let plaintext_bytes = if is_legacy_xor {
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
    ensure_portable_plaintext_bounded(&plaintext_bytes)?;

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
    let merge = graph.merge_graph(
        &state.graph_snapshot,
        &crate::spectrum_graph::MergeStrategy::Ours,
    )?;
    let nodes_restored = merge.nodes_added;
    let edges_restored = merge.edges_added;

    let total_nodes = state.graph_snapshot.nodes.len();
    let total_edges = state.graph_snapshot.edges.len();

    // Handoff files are one-shot recovery artifacts. Consuming the file after
    // a successful merge prevents old snapshots from resurrecting data on a
    // later startup.
    std::fs::remove_file(&state_path).map_err(|error| {
        format!("State restored but handoff file could not be consumed: {error}")
    })?;

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

/// Check whether an explicit portable handoff file exists.
pub fn has_saved_state(app_dir: &Path) -> bool {
    app_dir.join(STATE_FILE).exists()
}

pub fn invalidate_saved_state(app_dir: &Path) -> Result<(), String> {
    let state_path = app_dir.join(STATE_FILE);
    match std::fs::remove_file(&state_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove saved handoff state: {error}")),
    }
}

// ─── Advanced You-Port: Cross-Device Merge ─────────────────

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
    let snapshot = graph.get_portable_graph()?;

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

    // Use a deliberately slow, salted passphrase KDF.
    validate_sync_passphrase(passphrase)?;
    let kdf_salt = generate_kdf_salt()?;
    let key = derive_passphrase_key(passphrase, &kdf_salt, PASSPHRASE_KDF_ITERATIONS)?;
    let checksum = sha256_hex(plaintext_bytes);

    // Encrypt with AES-256-GCM
    let ciphertext = aes_encrypt(&key, plaintext_bytes)?;
    let encrypted_b64 = BASE64.encode(&ciphertext);

    let package = serde_json::json!({
        "format": "prismos-sync-encrypted-v3",
        "id": Uuid::new_v4().to_string(),
        "created_at": Utc::now().to_rfc3339(),
        "encrypted_payload": encrypted_b64,
        "checksum": checksum,
        "key_type": "passphrase",
        "kdf": "pbkdf2-hmac-sha256",
        "kdf_salt": kdf_salt,
        "kdf_iterations": PASSPHRASE_KDF_ITERATIONS,
        "stats": {
            "nodes": nodes_count,
            "edges": edges_count,
        }
    });

    serde_json::to_string_pretty(&package).map_err(|e| e.into())
}

fn sync_package_key(
    package: &serde_json::Value,
    format: &str,
    passphrase: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    if format == "prismos-sync-encrypted-v3" {
        if package["kdf"].as_str() != Some("pbkdf2-hmac-sha256") {
            return Err("Unsupported sync-package KDF".into());
        }
        let salt = package["kdf_salt"].as_str().ok_or("Missing kdf_salt")?;
        let iterations = package["kdf_iterations"]
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .ok_or("Missing or invalid kdf_iterations")?;
        return derive_passphrase_key(passphrase, salt, iterations).map_err(Into::into);
    }

    if passphrase.is_empty() || passphrase.len() > 1024 {
        return Err("A valid legacy sync passphrase is required".into());
    }
    let nonce = package["nonce"].as_str().ok_or("Missing nonce")?;
    Ok(derive_key(passphrase, nonce))
}

/// Import and merge a sync package from another device.
/// Decrypts using the user-supplied passphrase, then merges with conflict resolution.
pub fn import_sync_package(
    app_dir: &Path,
    package_json: &str,
    passphrase: &str,
    strategy: &str,
) -> Result<CrossDeviceMergeResult, Box<dyn std::error::Error + Send + Sync>> {
    ensure_package_json_bounded(package_json)?;
    let package: serde_json::Value = serde_json::from_str(package_json)?;

    let format = package["format"].as_str().unwrap_or("");
    let is_legacy_xor = format == "prismos-sync-encrypted-v1";
    let is_legacy_aes = format == "prismos-sync-encrypted-v2";
    if format != "prismos-sync-encrypted-v3" && !is_legacy_xor && !is_legacy_aes {
        return Err(format!(
            "Unsupported sync format: {} (expected prismos-sync-encrypted-v3)",
            format
        )
        .into());
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let stored_checksum = package["checksum"].as_str().ok_or("Missing checksum")?;

    let key = sync_package_key(&package, format, passphrase)?;

    // Decode
    let ciphertext = decode_portable_payload(encrypted_b64)?;

    // Decrypt based on format version
    let plaintext_bytes = if is_legacy_xor {
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
    ensure_portable_plaintext_bounded(&plaintext_bytes)?;

    // Verify integrity
    let checksum = sha256_hex(&plaintext_bytes);
    if checksum != stored_checksum {
        return Err("Integrity checksum mismatch — decryption failed (wrong passphrase?)".into());
    }

    let plaintext = String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))?;

    // Parse the sync state
    let state: serde_json::Value = serde_json::from_str(&plaintext)?;
    let source_device = state["source_device"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let source_timestamp = state["exported_at"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    let snapshot_val = state
        .get("snapshot")
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
    ensure_package_json_bounded(package_json)?;
    let package: serde_json::Value = serde_json::from_str(package_json)?;

    let format = package["format"].as_str().unwrap_or("");
    let is_legacy_xor = format == "prismos-sync-encrypted-v1";
    let is_legacy_aes = format == "prismos-sync-encrypted-v2";
    if format != "prismos-sync-encrypted-v3" && !is_legacy_xor && !is_legacy_aes {
        return Err(format!("Unsupported sync format: {}", format).into());
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let key = sync_package_key(&package, format, passphrase)?;
    let ciphertext = decode_portable_payload(encrypted_b64)?;

    let plaintext_bytes = if is_legacy_xor {
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
    ensure_portable_plaintext_bounded(&plaintext_bytes)?;
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
        let plaintext = b"Hello PrismOS-AI! Encrypted handoff test data that spans multiple blocks to verify counter mode works correctly.";

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
        let plaintext =
            b"Hello PrismOS-AI! AES-256-GCM authenticated encryption test across multiple blocks.";

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
        assert!(
            result.is_err(),
            "Tampered ciphertext should fail authentication"
        );
    }

    #[test]
    fn test_pbkdf2_hmac_sha256_known_answer() {
        let derived = pbkdf2_sha256(b"password", b"salt", 1).unwrap();
        assert_eq!(
            hex_encode(&derived),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
    }

    #[test]
    fn test_device_bound_key_uses_persisted_random_secret() {
        let first_device = tempfile::tempdir().unwrap();
        let second_device = tempfile::tempdir().unwrap();
        let salt = BASE64.encode([7u8; 16]);
        let first = derive_device_bound_key(first_device.path(), &salt).unwrap();
        let first_again = derive_device_bound_key(first_device.path(), &salt).unwrap();
        let second = derive_device_bound_key(second_device.path(), &salt).unwrap();

        assert_eq!(first, first_again);
        assert_ne!(first, second);
        assert_eq!(
            std::fs::metadata(first_device.path().join(DEVICE_KEY_FILE))
                .unwrap()
                .len(),
            32
        );
    }

    #[test]
    fn test_sync_passphrase_strength_is_enforced() {
        assert!(validate_sync_passphrase("short").is_err());
        assert!(validate_sync_passphrase("correct horse battery staple").is_ok());
    }
}
