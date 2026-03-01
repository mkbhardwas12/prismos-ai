// Patent Pending — US 63/993,589 (Feb 28, 2026)
// You-Port — Encrypted Local State Transfer (Handoff Stub)
//
// You-Port enables secure, encrypted export and import of PrismOS
// user state for device-to-device handoff. All encryption happens
// locally — no cloud intermediary.
//
// MVP: Base64 encoding with SHA-256 integrity verification.
// Production: AES-256-GCM encryption with key derivation from user passphrase.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

// ─── Data Models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouPortPackage {
    pub id: String,
    pub created_at: String,
    pub payload: String,   // Base64-encoded (will be AES-256-GCM encrypted in production)
    pub checksum: String,  // SHA-256 integrity hash
    pub version: String,
    pub format: String,
}

// ─── Export / Import ───────────────────────────────────────────────────────────

/// Create an export package for device handoff
pub fn create_export_package(data: &str) -> YouPortPackage {
    let payload = BASE64.encode(data.as_bytes());
    let hash_bytes = Sha256::digest(data.as_bytes());
    let checksum = hash_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    YouPortPackage {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        payload,
        checksum,
        version: "0.1.0".to_string(),
        format: "prismos-youport-v1".to_string(),
    }
}

/// Import and verify a You-Port package
pub fn import_package(package: &YouPortPackage) -> Result<String, String> {
    // Decode payload
    let decoded = BASE64
        .decode(&package.payload)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    let data = String::from_utf8(decoded)
        .map_err(|e| format!("Invalid UTF-8 in payload: {}", e))?;

    // Verify integrity checksum
    let hash_bytes = Sha256::digest(data.as_bytes());
    let checksum = hash_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    if checksum != package.checksum {
        return Err("Integrity check failed — checksum mismatch".to_string());
    }

    Ok(data)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_import_roundtrip() {
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
}
