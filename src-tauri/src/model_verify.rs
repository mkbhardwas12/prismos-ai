// PrismOS-AI advisory model metadata compatibility check.
//
// Ollama's self-reported family, parameter-size, and quantization metadata can
// help catch an accidental model-selection mismatch. They cannot establish the
// integrity, provenance, publisher identity, or safety of model weight bytes.
// PrismOS therefore never labels this result as cryptographic verification.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ─── Expected family metadata ──────────────────────────────────────────────────

/// Metadata expectations are tag-aware because a single Ollama library family can
/// contain artifacts built on different architectures. DeepSeek-R1 is the clearest
/// example: its 1.5B/7B/14B/32B distilled tags report Qwen2 metadata, its 8B tag
/// reports Qwen3 metadata, and its 70B tag reports Llama metadata. Treating the bare
/// library name as one architecture produced false "Mismatch" results.
fn known_model(model_name: &str) -> Option<KnownModel> {
    let (base, tag) = model_parts(model_name);
    let tag = tag.as_deref();

    match base.as_str() {
        "qwen3" => {
            if tag
                .is_some_and(|value| tag_is_variant(value, "30b") || tag_is_variant(value, "235b"))
            {
                Some(KnownModel::new("Qwen3 MoE", &["qwen3moe"], &[]))
            } else {
                // Bare/latest is currently dense, while accepting qwen3moe here avoids
                // turning a future mutable-alias update into a false tampering signal.
                let expected = if matches!(tag, None | Some("latest")) {
                    &["qwen3", "qwen3moe"][..]
                } else {
                    &["qwen3"][..]
                };
                Some(KnownModel::new("Qwen3", expected, &[]))
            }
        }
        // Phi-4 Mini is represented by Ollama's `phi3` GGUF architecture.
        "phi4-mini" => Some(KnownModel::new("Phi-4 Mini", &["phi3"], &[])),
        "gemma3" => {
            let requires_vision = tag.is_some_and(|value| {
                tag_is_variant(value, "4b")
                    || tag_is_variant(value, "12b")
                    || tag_is_variant(value, "27b")
            });
            Some(KnownModel::new(
                "Gemma 3",
                &["gemma3"],
                if requires_vision { &["vision"] } else { &[] },
            ))
        }
        "qwen2.5-coder" => Some(KnownModel::new("Qwen 2.5 Coder", &["qwen2"], &[])),
        "qwen2.5vl" => Some(KnownModel::new(
            "Qwen 2.5 VL",
            &["qwen25vl", "qwen2vl"],
            &["vision"],
        )),
        "llama3.2-vision" => Some(KnownModel::new(
            "Llama 3.2 Vision",
            &["mllama", "llama"],
            &["vision"],
        )),
        "deepseek-r1" => match tag {
            Some(value)
                if tag_is_variant(value, "1.5b")
                    || tag_is_variant(value, "7b")
                    || tag_is_variant(value, "14b")
                    || tag_is_variant(value, "32b") =>
            {
                Some(KnownModel::new("DeepSeek-R1 Distill Qwen", &["qwen2"], &[]))
            }
            Some(value) if tag_is_variant(value, "8b") => Some(KnownModel::new(
                "DeepSeek-R1 Distill Qwen3",
                &["qwen3"],
                &[],
            )),
            Some(value) if tag_is_variant(value, "70b") => Some(KnownModel::new(
                "DeepSeek-R1 Distill Llama",
                &["llama"],
                &[],
            )),
            Some(value) if tag_is_variant(value, "671b") => Some(KnownModel::new(
                "DeepSeek-R1",
                &["deepseek2", "deepseek"],
                &[],
            )),
            // `deepseek-r1`/`:latest` is a mutable alias. Without an exact tag,
            // several architectures are legitimate, so fail conservatively.
            _ => None,
        },
        "llama3.2" | "llama3.1" | "llama3" => Some(KnownModel::new("Llama", &["llama"], &[])),
        "mistral" => Some(KnownModel::new("Mistral", &["mistral"], &[])),
        "phi3" => Some(KnownModel::new("Phi", &["phi", "phi3"], &[])),
        "gemma2" => Some(KnownModel::new("Gemma 2", &["gemma", "gemma2"], &[])),
        "qwen2.5" => Some(KnownModel::new(
            "Qwen 2.5",
            &["qwen", "qwen2", "qwen25"],
            &[],
        )),
        "codellama" => Some(KnownModel::new("Code Llama", &["llama", "codellama"], &[])),
        "nomic-embed-text" => Some(KnownModel::new(
            "Nomic Embed",
            &["nomic", "nomicembed", "bert"],
            &[],
        )),
        _ => None,
    }
}

fn model_parts(model_name: &str) -> (String, Option<String>) {
    let local_name = model_name.rsplit('/').next().unwrap_or(model_name);
    let mut parts = local_name.splitn(2, ':');
    let base = parts.next().unwrap_or(local_name).to_ascii_lowercase();
    let tag = parts.next().map(str::to_ascii_lowercase);
    (base, tag)
}

fn tag_is_variant(tag: &str, variant: &str) -> bool {
    tag == variant
        || tag
            .strip_prefix(variant)
            .is_some_and(|suffix| suffix.starts_with('-'))
}

// ─── Data Models ───────────────────────────────────────────────────────────────
#[derive(Clone, Copy)]
struct KnownModel {
    label: &'static str,
    expected_families: &'static [&'static str],
    required_capabilities: &'static [&'static str],
}

impl KnownModel {
    const fn new(
        label: &'static str,
        expected_families: &'static [&'static str],
        required_capabilities: &'static [&'static str],
    ) -> Self {
        Self {
            label,
            expected_families,
            required_capabilities,
        }
    }
}

/// Advisory compatibility status. None of these values verify model bytes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MetadataCompatibilityStatus {
    /// Self-reported family metadata matches the expected family.
    Compatible,
    /// Self-reported family metadata does not match the expected family.
    Mismatch,
    /// Model name is not in the advisory compatibility table.
    Unknown,
    /// Could not query model metadata from Ollama.
    Unavailable,
}

/// Complete advisory metadata result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMetadataCheck {
    pub model_name: String,
    pub status: MetadataCompatibilityStatus,
    pub metadata_fingerprint: String,
    pub parameter_count: u64,
    pub family: String,
    pub details: String,
    pub checked_at: String,
    pub integrity_verified: bool,
}

/// Ollama model show response (partial)
#[derive(Debug, Deserialize)]
struct OllamaModelInfo {
    #[serde(default)]
    details: OllamaModelDetails,
    /// Current Ollama uses `model_info`; accept the historical spelling too.
    #[serde(default, rename = "model_info", alias = "modelinfo")]
    model_info: serde_json::Value,
    /// Runtime-reported features such as completion, vision, tools, and thinking.
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct OllamaModelDetails {
    #[serde(default)]
    family: String,
    #[serde(default)]
    families: Vec<String>,
    #[serde(default)]
    parameter_size: String,
    #[serde(default)]
    quantization_level: String,
}

// ─── Metadata inspection ───────────────────────────────────────────────────────

/// Inspect Ollama's self-reported model metadata against an advisory family
/// table. This does not read, hash, or authenticate model weight artifacts.
pub async fn inspect_model_metadata(model_name: &str, ollama_url: &str) -> ModelMetadataCheck {
    let now = chrono::Utc::now().to_rfc3339();

    // Query Ollama for model info
    let client = match crate::ollama_bridge::local_http_client() {
        Ok(client) => client,
        Err(error) => {
            return ModelMetadataCheck {
                model_name: model_name.to_string(),
                status: MetadataCompatibilityStatus::Unavailable,
                metadata_fingerprint: String::new(),
                parameter_count: 0,
                family: String::new(),
                details: format!("Could not create the loopback-only Ollama client: {error}"),
                checked_at: now,
                integrity_verified: false,
            };
        }
    };
    let url = format!("{}/api/show", ollama_url.trim_end_matches('/'));

    let response = match client
        .post(&url)
        .json(&serde_json::json!({ "name": model_name }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return ModelMetadataCheck {
                model_name: model_name.to_string(),
                status: MetadataCompatibilityStatus::Unavailable,
                metadata_fingerprint: String::new(),
                parameter_count: 0,
                family: String::new(),
                details: format!("Could not query Ollama: {}", e),
                checked_at: now,
                integrity_verified: false,
            };
        }
    };

    if !response.status().is_success() {
        return ModelMetadataCheck {
            model_name: model_name.to_string(),
            status: MetadataCompatibilityStatus::Unavailable,
            metadata_fingerprint: String::new(),
            parameter_count: 0,
            family: String::new(),
            details: format!(
                "Ollama returned HTTP {} while inspecting '{}'. No model-integrity or publisher check was performed.",
                response.status(), model_name
            ),
            checked_at: now,
            integrity_verified: false,
        };
    }

    let info: OllamaModelInfo = match response.json().await {
        Ok(i) => i,
        Err(e) => {
            return ModelMetadataCheck {
                model_name: model_name.to_string(),
                status: MetadataCompatibilityStatus::Unavailable,
                metadata_fingerprint: String::new(),
                parameter_count: 0,
                family: String::new(),
                details: format!("Failed to parse model info: {}", e),
                checked_at: now,
                integrity_verified: false,
            };
        }
    };

    classify_model_metadata(model_name, info, now)
}

fn classify_model_metadata(
    model_name: &str,
    info: OllamaModelInfo,
    checked_at: String,
) -> ModelMetadataCheck {
    let architecture = info
        .model_info
        .get("general.architecture")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let parameter_count = info
        .model_info
        .get("general.parameter_count")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);

    let mut admitted_families = Vec::new();
    if !info.details.family.trim().is_empty() {
        admitted_families.push(info.details.family.trim().to_string());
    }
    admitted_families.extend(
        info.details
            .families
            .iter()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string()),
    );
    if !architecture.trim().is_empty() {
        admitted_families.push(architecture.trim().to_string());
    }
    admitted_families.sort_by_key(|value| value.to_ascii_lowercase());
    admitted_families.dedup_by(|left, right| left.eq_ignore_ascii_case(right));

    let mut capabilities: Vec<String> = info
        .capabilities
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();
    capabilities.sort();
    capabilities.dedup();

    // This is deliberately a metadata fingerprint, not a digest of model bytes.
    let mut hasher = Sha256::new();
    hasher.update(model_name.as_bytes());
    hasher.update(info.details.family.as_bytes());
    hasher.update(info.details.parameter_size.as_bytes());
    hasher.update(info.details.quantization_level.as_bytes());
    hasher.update(architecture.as_bytes());
    for family in &admitted_families {
        hasher.update(family.as_bytes());
    }
    for capability in &capabilities {
        hasher.update(capability.as_bytes());
    }
    let fingerprint = hex_encode(hasher.finalize().as_slice());

    let displayed_family = if !info.details.family.trim().is_empty() {
        info.details.family.trim().to_string()
    } else {
        architecture.clone()
    };
    let param_size = info.details.parameter_size;
    let quant = info.details.quantization_level;
    let admitted_summary = if admitted_families.is_empty() {
        "none".to_string()
    } else {
        admitted_families.join(", ")
    };
    let capability_summary = if capabilities.is_empty() {
        "not reported".to_string()
    } else {
        capabilities.join(", ")
    };

    let (status, details) = match known_model(model_name) {
        None => (
            MetadataCompatibilityStatus::Unknown,
            format!(
                "'{}' does not have an unambiguous tag-aware advisory entry; Ollama reports family/architecture [{}], params {}, quant {}, capabilities [{}]. No model-byte integrity, provenance, publisher, or safety check was performed.",
                model_name,
                admitted_summary,
                param_size,
                quant,
                capability_summary
            ),
        ),
        Some(_) if admitted_families.is_empty() => (
            MetadataCompatibilityStatus::Unknown,
            format!(
                "Ollama returned no family or architecture metadata for '{}'. No model-byte integrity, provenance, publisher, or safety check was performed.",
                model_name
            ),
        ),
        Some(known) => {
            let expected: Vec<String> = known
                .expected_families
                .iter()
                .map(|value| normalize_family(value))
                .collect();
            let primary: Vec<&str> = [info.details.family.as_str(), architecture.as_str()]
                .into_iter()
                .filter(|value| !value.trim().is_empty())
                .collect();
            let evidence = if primary.is_empty() {
                admitted_families.iter().map(String::as_str).collect()
            } else {
                primary
            };
            let matches: Vec<bool> = evidence
                .iter()
                .map(|value| expected.contains(&normalize_family(value)))
                .collect();
            let all_match = matches.iter().all(|value| *value);
            let any_match = matches.iter().any(|value| *value);
            let missing_capabilities: Vec<&str> = if capabilities.is_empty() {
                Vec::new()
            } else {
                known
                    .required_capabilities
                    .iter()
                    .copied()
                    .filter(|required| !capabilities.iter().any(|value| value == required))
                    .collect()
            };

            if !any_match {
                (
                    MetadataCompatibilityStatus::Mismatch,
                    format!(
                        "Advisory metadata mismatch: '{}' reports family/architecture [{}], while the tag-aware '{}' entry expects one of {:?}. This may be a naming, tag, or Ollama-version mismatch; it is not proof of tampering. No model-byte integrity or publisher check was performed.",
                        model_name,
                        admitted_summary,
                        known.label,
                        known.expected_families
                    ),
                )
            } else if !all_match {
                (
                    MetadataCompatibilityStatus::Unknown,
                    format!(
                        "Ollama returned conflicting family/architecture metadata for '{}': [{}]. At least one value matches the tag-aware '{}' entry, so PrismOS will not report a false mismatch. No model-byte integrity or publisher check was performed.",
                        model_name, admitted_summary, known.label
                    ),
                )
            } else if !missing_capabilities.is_empty() {
                (
                    MetadataCompatibilityStatus::Unknown,
                    format!(
                        "The family metadata for '{}' matches the tag-aware '{}' entry, but Ollama's reported capabilities [{}] omit {:?}. This can be an Ollama-version metadata difference, so PrismOS will not report a mismatch. No model-byte integrity or publisher check was performed.",
                        model_name,
                        known.label,
                        capability_summary,
                        missing_capabilities
                    ),
                )
            } else {
                (
                    MetadataCompatibilityStatus::Compatible,
                    format!(
                        "Advisory metadata match: '{}' reports family/architecture [{}] for the tag-aware '{}' entry, params {}, quant {}, capabilities [{}]. This checks self-reported compatibility metadata only; it does not verify model bytes, provenance, publisher authenticity, or safety.",
                        model_name,
                        admitted_summary,
                        known.label,
                        param_size,
                        quant,
                        capability_summary
                    ),
                )
            }
        }
    };

    ModelMetadataCheck {
        model_name: model_name.to_string(),
        status,
        metadata_fingerprint: fingerprint,
        parameter_count,
        family: displayed_family,
        details,
        checked_at,
        integrity_verified: false,
    }
}

fn normalize_family(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Encode bytes as lowercase hex string
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(family: &str, architecture: &str, capabilities: &[&str]) -> OllamaModelInfo {
        OllamaModelInfo {
            details: OllamaModelDetails {
                family: family.to_string(),
                families: if family.is_empty() {
                    Vec::new()
                } else {
                    vec![family.to_string()]
                },
                parameter_size: "fixture".to_string(),
                quantization_level: "Q4_K_M".to_string(),
            },
            model_info: json!({
                "general.architecture": architecture,
                "general.parameter_count": 4_000_000_000_u64,
            }),
            capabilities: capabilities
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        }
    }

    fn classify_fixture(
        model_name: &str,
        family: &str,
        architecture: &str,
        capabilities: &[&str],
    ) -> ModelMetadataCheck {
        classify_model_metadata(
            model_name,
            fixture(family, architecture, capabilities),
            "2026-08-01T00:00:00Z".to_string(),
        )
    }

    #[test]
    fn bundled_models_accept_current_ollama_family_metadata() {
        let fixtures = [
            (
                "qwen3:4b",
                "qwen3",
                "qwen3",
                &["completion", "tools", "thinking"][..],
            ),
            ("phi4-mini", "phi3", "phi3", &["completion", "tools"][..]),
            (
                "gemma3:4b",
                "gemma3",
                "gemma3",
                &["completion", "vision"][..],
            ),
            (
                "qwen2.5-coder:7b",
                "qwen2",
                "qwen2",
                &["completion", "tools"][..],
            ),
            (
                "qwen2.5vl:7b",
                "qwen25vl",
                "qwen25vl",
                &["completion", "vision"][..],
            ),
            (
                "llama3.2-vision",
                "mllama",
                "mllama",
                &["completion", "vision"][..],
            ),
        ];

        for (model, family, architecture, capabilities) in fixtures {
            let result = classify_fixture(model, family, architecture, capabilities);
            assert_eq!(
                result.status,
                MetadataCompatibilityStatus::Compatible,
                "{} was classified as {:?}: {}",
                model,
                result.status,
                result.details
            );
            assert!(!result.integrity_verified);
            assert!(!result.metadata_fingerprint.is_empty());
            assert!(result
                .details
                .contains("self-reported compatibility metadata only"));
        }
    }

    #[test]
    fn deepseek_r1_qwen_distill_tags_accept_qwen2_metadata() {
        for model in [
            "deepseek-r1:1.5b",
            "deepseek-r1:7b",
            "deepseek-r1:14b",
            "deepseek-r1:32b",
            "deepseek-r1:32b-qwen-distill-q4_K_M",
        ] {
            let result = classify_fixture(model, "qwen2", "qwen2", &["completion", "thinking"]);
            assert_eq!(
                result.status,
                MetadataCompatibilityStatus::Compatible,
                "{} was classified as {:?}: {}",
                model,
                result.status,
                result.details
            );
            assert!(!result.integrity_verified);
        }
    }

    #[test]
    fn current_model_info_wire_name_and_historical_alias_are_both_admitted() {
        let current: OllamaModelInfo = serde_json::from_value(json!({
            "details": { "family": "qwen3" },
            "model_info": {
                "general.architecture": "qwen3",
                "general.parameter_count": 4_020_000_000_u64
            },
            "capabilities": ["completion", "thinking"]
        }))
        .unwrap();
        assert_eq!(
            current.model_info["general.parameter_count"].as_u64(),
            Some(4_020_000_000)
        );

        let historical: OllamaModelInfo = serde_json::from_value(json!({
            "details": { "family": "qwen3" },
            "modelinfo": { "general.architecture": "qwen3" }
        }))
        .unwrap();
        assert_eq!(
            historical.model_info["general.architecture"].as_str(),
            Some("qwen3")
        );
    }

    #[test]
    fn contradictory_family_and_architecture_fail_conservatively_to_unknown() {
        let result = classify_fixture("qwen3:4b", "qwen3", "llama", &["completion", "thinking"]);
        assert_eq!(result.status, MetadataCompatibilityStatus::Unknown);
        assert!(result.details.contains("conflicting family/architecture"));
        assert!(!result.integrity_verified);
    }

    #[test]
    fn reported_vision_capability_omission_is_unknown_not_false_mismatch() {
        let result = classify_fixture("gemma3:4b", "gemma3", "gemma3", &["completion"]);
        assert_eq!(result.status, MetadataCompatibilityStatus::Unknown);
        assert!(result.details.contains("omit"));
        assert!(!result.integrity_verified);
    }

    #[test]
    fn true_family_contradiction_remains_an_advisory_mismatch() {
        let result = classify_fixture("qwen3:4b", "llama", "llama", &["completion"]);
        assert_eq!(result.status, MetadataCompatibilityStatus::Mismatch);
        assert!(result.details.contains("not proof of tampering"));
        assert!(!result.integrity_verified);
    }

    #[test]
    fn mutable_deepseek_latest_alias_is_unknown_without_an_exact_tag() {
        let result = classify_fixture("deepseek-r1", "qwen3", "qwen3", &["completion", "thinking"]);
        assert_eq!(result.status, MetadataCompatibilityStatus::Unknown);
        assert!(result
            .details
            .contains("unambiguous tag-aware advisory entry"));
        assert!(!result.integrity_verified);
    }
}
