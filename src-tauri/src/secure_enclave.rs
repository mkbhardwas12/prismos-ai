// PrismOS-AI machine-derived software key helper (legacy module name).
//
// The current key is software-derived from account/machine identifiers and a
// PrismOS domain separator. It is not generated, sealed, or stored by a TPM,
// Secure Enclave, OS keychain, or hardware security API. This helper is status
// telemetry only in the current build; Action Policy HMAC records use a separate
// process-random key and recovery packages use their documented passphrase keys.
//
// This module itself performs no network requests.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// Uses PRISMOS_ENCLAVE_SALT environment variable at build time if set.
/// Override for production deployments.
const ENCLAVE_SALT: &[u8] = match option_env!("PRISMOS_ENCLAVE_SALT") {
    Some(s) => s.as_bytes(),
    None => b"PrismOS-SecureEnclave-Default-Salt-v1",
};
const KEY_SIZE: usize = 32; // 256-bit key

// ─── Data Models ───────────────────────────────────────────────────────────────

/// Which hardware backend is providing the key
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EnclaveBackend {
    /// Legacy serialized variant; no hardware key API is used.
    WindowsTpm,
    /// Legacy serialized variant; no hardware key API is used.
    MacSecureEnclave,
    /// Legacy serialized variant; no hardware key API is used.
    LinuxTpm,
    /// Current implementation: software-derived machine/account key.
    SoftwareFallback,
}

impl EnclaveBackend {
    pub fn label(&self) -> &'static str {
        match self {
            Self::WindowsTpm => "Legacy Windows hardware indicator (not sealed)",
            Self::MacSecureEnclave => "Legacy macOS hardware indicator (not sealed)",
            Self::LinuxTpm => "Legacy Linux hardware indicator (not sealed)",
            Self::SoftwareFallback => "Software-derived key (HMAC-SHA256)",
        }
    }

    pub fn is_hardware(&self) -> bool {
        !matches!(self, Self::SoftwareFallback)
    }
}

/// Complete enclave status report
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnclaveStatus {
    pub backend: EnclaveBackend,
    pub hardware_available: bool,
    pub key_fingerprint: String,
    pub platform: String,
    pub details: String,
}

// ─── Secure Enclave ────────────────────────────────────────────────────────────

pub struct SecureEnclave {
    backend: EnclaveBackend,
    key: [u8; KEY_SIZE],
}
impl SecureEnclave {
    /// Initialize the software-derived helper. Hardware presence is deliberately
    /// not presented as hardware-backed key storage.
    pub fn new() -> Self {
        let backend = EnclaveBackend::SoftwareFallback;
        let key = Self::derive_key(&Self::get_machine_entropy());
        SecureEnclave { backend, key }
    }

    // ── Machine Entropy (Software Fallback) ──

    /// Gather machine-specific entropy for key derivation.
    /// Uses hostname, OS info, arch, and process-level entropy.
    fn get_machine_entropy() -> Vec<u8> {
        let mut entropy = Vec::new();

        // Hostname
        if let Ok(hostname) = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .or_else(|_| {
                #[cfg(unix)]
                {
                    std::fs::read_to_string("/etc/hostname").map(|s| s.trim().to_string())
                }
                #[cfg(not(unix))]
                {
                    Err(std::env::VarError::NotPresent)
                }
            })
        {
            entropy.extend_from_slice(hostname.as_bytes());
        }

        // OS info
        entropy.extend_from_slice(std::env::consts::OS.as_bytes());
        entropy.extend_from_slice(std::env::consts::ARCH.as_bytes());
        entropy.extend_from_slice(std::env::consts::FAMILY.as_bytes());

        // User name (adds per-user uniqueness)
        if let Ok(user) = std::env::var("USERNAME").or_else(|_| std::env::var("USER")) {
            entropy.extend_from_slice(user.as_bytes());
        }

        // Home directory path (unique per machine/user)
        if let Some(home) = dirs_fallback() {
            entropy.extend_from_slice(home.as_bytes());
        }

        entropy
    }

    // ── Key Derivation ──

    /// Derive a 256-bit key from entropy using HMAC-SHA256.
    fn derive_key(entropy: &[u8]) -> [u8; KEY_SIZE] {
        let mut mac = HmacSha256::new_from_slice(ENCLAVE_SALT).expect("HMAC key length is valid");
        mac.update(entropy);
        mac.update(b"PrismOS-KeyDerivation-v1");

        let result = mac.finalize().into_bytes();
        let mut key = [0u8; KEY_SIZE];
        key.copy_from_slice(&result[..KEY_SIZE]);
        key
    }

    /// Get the derived enclave key (256-bit)
    #[allow(dead_code)]
    pub fn get_key(&self) -> &[u8; KEY_SIZE] {
        &self.key
    }

    /// Get a fingerprint of the key (first 8 bytes, hex-encoded) for display
    pub fn key_fingerprint(&self) -> String {
        self.key
            .iter()
            .take(8)
            .map(|b| format!("{:02x}", b))
            .collect()
    }

    /// Get the current enclave status
    pub fn status(&self) -> EnclaveStatus {
        let platform = format!(
            "{} {} ({})",
            std::env::consts::OS,
            std::env::consts::ARCH,
            std::env::consts::FAMILY
        );

        let details = "Software-derived machine/account key. It is not hardware-sealed, not stored in an OS keychain, and not an attestation primitive.".to_string();

        EnclaveStatus {
            backend: self.backend.clone(),
            hardware_available: self.backend.is_hardware(),
            key_fingerprint: self.key_fingerprint(),
            platform,
            details,
        }
    }

    /// Sign arbitrary data using the enclave key (HMAC-SHA256)
    #[allow(dead_code)]
    pub fn sign(&self, data: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC key length is valid");
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    /// Verify a signature against the enclave key
    #[allow(dead_code)]
    pub fn verify(&self, data: &[u8], signature: &[u8]) -> bool {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("HMAC key length is valid");
        mac.update(data);
        mac.verify_slice(signature).is_ok()
    }
}

/// Fallback to get home directory without the `dirs` crate
fn dirs_fallback() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enclave_init() {
        let enclave = SecureEnclave::new();
        let status = enclave.status();
        assert!(!status.hardware_available);
        assert!(!status.key_fingerprint.is_empty());
        assert!(!status.platform.is_empty());
        println!("Backend: {:?}", status.backend);
        println!("Fingerprint: {}", status.key_fingerprint);
    }

    #[test]
    fn test_sign_verify() {
        let enclave = SecureEnclave::new();
        let data = b"Test data for signing";
        let sig = enclave.sign(data);
        assert!(enclave.verify(data, &sig));
        assert!(!enclave.verify(b"Tampered data", &sig));
    }

    #[test]
    fn test_deterministic_key() {
        // Same machine should produce the same key
        let e1 = SecureEnclave::new();
        let e2 = SecureEnclave::new();
        assert_eq!(e1.get_key(), e2.get_key());
    }
}
