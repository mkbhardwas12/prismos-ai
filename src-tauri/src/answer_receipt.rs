//! Answer receipts — a locally signed, verifiable record of what produced an answer.
//!
//! Every receipt binds together: the question and answer (as SHA-256 digests, never
//! the text itself), the model that actually ran, the agent, the graph nodes and
//! documents used as context, and the index + hash of a matching entry in the
//! tamper-evident audit log. The whole body is signed with HMAC-SHA256 using the
//! machine-bound SecureEnclave key.
//!
//! Privacy model: nothing here leaves the device. The key never leaves the
//! device either, so a receipt is verifiable *on the machine that issued it* —
//! it proves "this machine produced this answer from these sources", not a
//! third-party attestation. Exported receipts contain digests, not content.
//!
//! Performance: issuing is on-demand (opt-in Setting) and runs *after* the answer
//! is already on screen, off the async runtime via `spawn_blocking`. The enclave
//! is constructed once per process because `SecureEnclave::new()` probes hardware.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::audit_log::AuditLog;
use crate::secure_enclave::SecureEnclave;

const RECEIPTS_DIR: &str = "receipts";
const RECEIPT_VERSION: u32 = 1;
const AUDIT_ACTION: &str = "answer_receipt";
/// Bounds keep a receipt small and a hostile caller from filling the disk.
const MAX_SOURCES: usize = 64;
const MAX_CONTEXT_NODES: usize = 128;
const MAX_LABEL_CHARS: usize = 200;
const MAX_ANSWER_BYTES: usize = 4 * 1024 * 1024;

static ENCLAVE: OnceLock<SecureEnclave> = OnceLock::new();

fn enclave() -> &'static SecureEnclave {
    ENCLAVE.get_or_init(SecureEnclave::new)
}

/// What the caller knows about an answer at the moment it is displayed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptInput {
    pub question: String,
    pub answer: String,
    pub model: String,
    pub agent: String,
    #[serde(default)]
    pub context_node_ids: Vec<String>,
    /// Human-readable source labels (document names, URLs already fetched, …).
    #[serde(default)]
    pub sources: Vec<String>,
}

/// The signed part of a receipt. Field order is the canonical signing order —
/// do not reorder without bumping `RECEIPT_VERSION`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReceiptBody {
    pub version: u32,
    pub id: String,
    pub issued_at: String,
    pub question_sha256: String,
    pub answer_sha256: String,
    pub answer_chars: usize,
    pub model: String,
    pub agent: String,
    pub context_node_ids: Vec<String>,
    pub sources: Vec<String>,
    pub key_fingerprint: String,
    pub audit_index: u64,
    pub audit_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerReceipt {
    #[serde(flatten)]
    pub body: ReceiptBody,
    /// Hex HMAC-SHA256 over the canonical JSON of `body`.
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptVerification {
    pub valid: bool,
    pub receipt_found: bool,
    pub signature_valid: bool,
    pub key_matches_device: bool,
    pub audit_entry_found: bool,
    pub audit_hash_matches: bool,
    /// Only checked when the caller supplies the answer text.
    pub answer_matches: Option<bool>,
    pub message: String,
    pub receipt: Option<AnswerReceipt>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn canonical_bytes(body: &ReceiptBody) -> Vec<u8> {
    // serde_json preserves struct field order, so this is deterministic for a
    // given RECEIPT_VERSION.
    serde_json::to_vec(body).expect("receipt body serializes")
}

/// One line, bounded length — labels are echoed into UI and exported files.
fn clean_label(raw: &str) -> Option<String> {
    let flat: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if flat.is_empty() {
        return None;
    }
    Some(flat.chars().take(MAX_LABEL_CHARS).collect())
}

fn receipts_dir(app_dir: &Path) -> PathBuf {
    app_dir.join(RECEIPTS_DIR)
}

fn receipt_path(app_dir: &Path, id: &str) -> Result<PathBuf, String> {
    // IDs are UUIDs we minted; anything else is not a receipt we issued and must
    // never be turned into a path.
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid receipt id".to_string());
    }
    Ok(receipts_dir(app_dir).join(format!("{id}.json")))
}

/// Sign and persist a receipt for an answer that is already on screen.
pub fn issue(app_dir: &Path, input: ReceiptInput) -> Result<AnswerReceipt, String> {
    if input.answer.is_empty() {
        return Err("Cannot issue a receipt for an empty answer".to_string());
    }
    if input.answer.len() > MAX_ANSWER_BYTES {
        return Err("Answer too large for a receipt".to_string());
    }
    let model = clean_label(&input.model).unwrap_or_else(|| "unknown".to_string());
    let agent = clean_label(&input.agent).unwrap_or_else(|| "PrismOS".to_string());
    let sources: Vec<String> = input
        .sources
        .iter()
        .filter_map(|s| clean_label(s))
        .take(MAX_SOURCES)
        .collect();
    let context_node_ids: Vec<String> = input
        .context_node_ids
        .iter()
        .filter_map(|s| clean_label(s))
        .take(MAX_CONTEXT_NODES)
        .collect();

    let id = uuid::Uuid::new_v4().to_string();
    let answer_sha256 = sha256_hex(input.answer.as_bytes());
    let question_sha256 = sha256_hex(input.question.as_bytes());

    // Chain into the audit log first so the receipt can point at its entry.
    let audit = AuditLog::new(app_dir);
    let entry = audit.append(
        AUDIT_ACTION,
        "user",
        &format!("receipt={id} answer_sha256={answer_sha256} model={model} sources={}", sources.len()),
    )?;

    let enclave = enclave();
    let body = ReceiptBody {
        version: RECEIPT_VERSION,
        id: id.clone(),
        issued_at: chrono::Utc::now().to_rfc3339(),
        question_sha256,
        answer_sha256,
        answer_chars: input.answer.chars().count(),
        model,
        agent,
        context_node_ids,
        sources,
        key_fingerprint: enclave.key_fingerprint(),
        audit_index: entry.index,
        audit_hash: entry.hash,
    };
    let signature = hex::encode(enclave.sign(&canonical_bytes(&body)));
    let receipt = AnswerReceipt { body, signature };

    let dir = receipts_dir(app_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create receipts folder: {e}"))?;
    let path = receipt_path(app_dir, &id)?;
    let json = serde_json::to_string_pretty(&receipt).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Cannot write receipt: {e}"))?;
    Ok(receipt)
}

pub fn load(app_dir: &Path, id: &str) -> Result<Option<AnswerReceipt>, String> {
    let path = receipt_path(app_dir, id)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| format!("Receipt file is corrupt: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read receipt: {e}")),
    }
}

/// Re-check a stored receipt: signature, device key, audit-chain link and
/// (optionally) that the supplied answer text is the one that was signed.
pub fn verify(app_dir: &Path, id: &str, answer: Option<&str>) -> Result<ReceiptVerification, String> {
    let mut v = ReceiptVerification {
        valid: false,
        receipt_found: false,
        signature_valid: false,
        key_matches_device: false,
        audit_entry_found: false,
        audit_hash_matches: false,
        answer_matches: None,
        message: String::new(),
        receipt: None,
    };
    let Some(receipt) = load(app_dir, id)? else {
        v.message = "No receipt with this id exists on this device.".to_string();
        return Ok(v);
    };
    v.receipt_found = true;

    let enclave = enclave();
    v.key_matches_device = receipt.body.key_fingerprint == enclave.key_fingerprint();
    let sig_bytes = hex::decode(&receipt.signature).unwrap_or_default();
    v.signature_valid = !sig_bytes.is_empty() && enclave.verify(&canonical_bytes(&receipt.body), &sig_bytes);

    let audit = AuditLog::new(app_dir);
    // The stored hash alone proves nothing if the entry text was edited in
    // place; verify_chain() recomputes every hash and every prev_hash link.
    let chain_valid = audit.verify_chain().map(|c| c.valid).unwrap_or(false);
    let total = audit.entry_count() as usize;
    if let Ok(entries) = audit.get_entries(total) {
        if let Some(entry) = entries.iter().find(|e| e.index == receipt.body.audit_index) {
            v.audit_entry_found = entry.action == AUDIT_ACTION && entry.details.contains(&receipt.body.id);
            v.audit_hash_matches = chain_valid && entry.hash == receipt.body.audit_hash;
        }
    }
    if let Some(text) = answer {
        v.answer_matches = Some(sha256_hex(text.as_bytes()) == receipt.body.answer_sha256);
    }

    v.valid = v.signature_valid
        && v.key_matches_device
        && v.audit_entry_found
        && v.audit_hash_matches
        && v.answer_matches.unwrap_or(true);
    v.message = if v.valid {
        "Verified on this device: signature, device key and audit chain all match.".to_string()
    } else if !v.key_matches_device {
        "Issued by a different device or user — the signing key does not match.".to_string()
    } else if !v.signature_valid {
        "Signature does not match the receipt body — the receipt was altered.".to_string()
    } else if !v.audit_entry_found || !v.audit_hash_matches {
        "The audit-log entry this receipt points at is missing or altered.".to_string()
    } else {
        "The answer text no longer matches what was signed.".to_string()
    };
    v.receipt = Some(receipt);
    Ok(v)
}

/// Write a receipt to the Downloads folder as pretty JSON (digests only, no content).
pub fn export(app_dir: &Path, id: &str) -> Result<crate::doc_generator::GeneratedFile, String> {
    let receipt = load(app_dir, id)?.ok_or_else(|| "No receipt with this id exists on this device.".to_string())?;
    let short: String = receipt.body.id.chars().take(8).collect();
    let json = serde_json::to_string_pretty(&receipt).map_err(|e| e.to_string())?;
    crate::doc_generator::generate_text_file(&format!("prismos-receipt-{short}"), "json", &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ReceiptInput {
        ReceiptInput {
            question: "What is the capital of France?".into(),
            answer: "Paris.".into(),
            model: "qwen3:4b".into(),
            agent: "Reasoner".into(),
            context_node_ids: vec!["node-1".into(), "node-2".into()],
            sources: vec!["📄 geography.pdf".into(), "  \n".into(), "line\nbreak".into()],
        }
    }

    #[test]
    fn issue_then_verify_passes_every_check() {
        let dir = tempfile::tempdir().unwrap();
        let r = issue(dir.path(), sample()).unwrap();
        assert_eq!(r.body.sources, vec!["📄 geography.pdf".to_string(), "line break".to_string()]);
        assert_eq!(r.body.answer_chars, 6);
        let v = verify(dir.path(), &r.body.id, Some("Paris.")).unwrap();
        assert!(v.valid, "{}", v.message);
        assert!(v.signature_valid && v.key_matches_device && v.audit_entry_found && v.audit_hash_matches);
        assert_eq!(v.answer_matches, Some(true));
    }

    #[test]
    fn altered_body_fails_signature() {
        let dir = tempfile::tempdir().unwrap();
        let mut r = issue(dir.path(), sample()).unwrap();
        r.body.model = "some-other-model".into();
        let path = receipt_path(dir.path(), &r.body.id).unwrap();
        std::fs::write(&path, serde_json::to_string(&r).unwrap()).unwrap();
        let v = verify(dir.path(), &r.body.id, None).unwrap();
        assert!(!v.valid);
        assert!(!v.signature_valid);
        assert!(v.message.contains("altered"));
    }

    #[test]
    fn changed_answer_text_is_detected() {
        let dir = tempfile::tempdir().unwrap();
        let r = issue(dir.path(), sample()).unwrap();
        let v = verify(dir.path(), &r.body.id, Some("Lyon.")).unwrap();
        assert!(!v.valid);
        assert_eq!(v.answer_matches, Some(false));
    }

    #[test]
    fn tampered_audit_log_breaks_the_link() {
        let dir = tempfile::tempdir().unwrap();
        let r = issue(dir.path(), sample()).unwrap();
        let log = dir.path().join("prismos-audit.log");
        let text = std::fs::read_to_string(&log).unwrap();
        std::fs::write(&log, text.replace(&r.body.answer_sha256, &"0".repeat(64))).unwrap();
        let v = verify(dir.path(), &r.body.id, None).unwrap();
        assert!(!v.valid);
        assert!(!v.audit_hash_matches);
    }

    #[test]
    fn unknown_or_malicious_ids_never_touch_the_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        assert!(receipt_path(dir.path(), "../../etc/passwd").is_err());
        assert!(receipt_path(dir.path(), "").is_err());
        let v = verify(dir.path(), &uuid::Uuid::new_v4().to_string(), None).unwrap();
        assert!(!v.receipt_found && !v.valid);
    }

    #[test]
    fn export_writes_digests_not_content() {
        let dir = tempfile::tempdir().unwrap();
        let r = issue(dir.path(), sample()).unwrap();
        let file = export(dir.path(), &r.body.id).unwrap();
        let text = std::fs::read_to_string(&file.path).unwrap();
        assert!(text.contains(&r.signature));
        assert!(!text.contains("Paris"), "exported receipt must not contain the answer text");
        assert!(!text.contains("capital of France"));
    }

    #[test]
    fn empty_answer_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = sample();
        s.answer.clear();
        assert!(issue(dir.path(), s).is_err());
    }
}
