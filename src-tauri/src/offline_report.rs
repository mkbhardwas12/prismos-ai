//! Honest offline-boundary report.
//!
//! PrismOS's core client policy sends reasoning and document-authoring requests
//! only to a loopback Ollama endpoint by default, while the knowledge graph stays
//! in local app data. This does not attest what the independently running Ollama
//! daemon does. "Zero bytes ever leave the machine" is not literally true: a few
//! OPT-IN, user-triggered integrations can reach off-device. This module reports
//! the boundary truthfully — core-local plus the known optional egress paths — so
//! the UI can say "off by default; your data, only to a host you choose" instead
//! of an absolute claim the code doesn't uphold.
//!
//! There is deliberately NO web crawler / web-search / scraper: systematically
//! pulling "internet sources" into the knowledge graph would require exactly the
//! egress the core invariant forbids. The offline-safe substitute is local-corpus
//! ingestion (Settings → Project Knowledge): point PrismOS at the documents you
//! would have crawled and it indexes them on-device.

use serde::Serialize;

/// One optional path that can reach off-device. All are off by default and only
/// fire on an explicit, user-configured action.
#[derive(Debug, Clone, Serialize)]
pub struct OptionalEgress {
    /// Feature name, e.g. "Ollama model install".
    pub feature: String,
    /// Where it connects, described honestly (a public API, or the user's own host).
    pub destination: String,
    /// What triggers it.
    pub trigger: String,
    /// What data leaves (kept minimal by design).
    pub data_sent: String,
}

/// The full, honest network-boundary picture.
#[derive(Debug, Clone, Serialize)]
pub struct OfflineBoundaryReport {
    /// True when PrismOS's core client route is loopback-only. This is not an
    /// authenticated end-to-end execution or zero-egress attestation.
    pub core_local_only: bool,
    /// The inference endpoint (localhost by default).
    pub ollama_endpoint: String,
    /// Redacted origin used only by endpoint-aware model-management/status calls.
    pub ollama_management_endpoint: String,
    /// True only if the user explicitly allowed a remote Ollama via env opt-in.
    pub remote_ollama_opt_in: bool,
    /// No telemetry, analytics, or crash reporting — always true.
    pub no_telemetry: bool,
    /// No web crawler / web-search / scraper feeds the knowledge graph — by design.
    pub no_web_crawler: bool,
    /// The offline-safe way to add outside knowledge without the internet.
    pub local_corpus_ingestion: String,
    /// The opt-in integrations that CAN reach off-device.
    pub optional_egress: Vec<OptionalEgress>,
    /// A one-paragraph, non-absolute summary suitable for UI copy.
    pub summary: String,
}

fn redacted_origin(configured: Option<&str>) -> String {
    let raw = configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(crate::ollama_bridge::DEFAULT_OLLAMA_URL);
    let Ok(url) = reqwest::Url::parse(raw) else {
        return "invalid configured endpoint".into();
    };
    let Some(host) = url.host_str() else {
        return "invalid configured endpoint".into();
    };
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match url.port() {
        Some(port) => format!("{}://{}:{port}", url.scheme(), host),
        None => format!("{}://{}", url.scheme(), host),
    }
}

/// Build the honest offline-boundary report. Pure/local — reads only process env
/// and receives the UI's model-management endpoint for redacted disclosure.
pub fn report(configured_ollama_url: Option<&str>) -> OfflineBoundaryReport {
    let remote_ollama_opt_in = crate::ollama_bridge::remote_ollama_allowed();
    let ollama_endpoint = crate::ollama_bridge::DEFAULT_OLLAMA_URL.to_string();
    let ollama_management_endpoint = redacted_origin(configured_ollama_url);

    let optional_egress = vec![
        OptionalEgress {
            feature: "Ollama model install".into(),
            destination: "The registry configured for the local Ollama daemon".into(),
            trigger: "Only when you explicitly pull/install a model".into(),
            data_sent: "The requested model identifier; no chat prompt is required for the download".into(),
        },
        OptionalEgress {
            feature: "Browser speech services".into(),
            destination: "The speech service selected by the operating system/WebView".into(),
            trigger: "Only when browser-provided voice input or output is enabled".into(),
            data_sent: "Audio or text as determined by the platform speech implementation; leave browser speech disabled for strict on-device handling".into(),
        },
        OptionalEgress {
            feature: "Synthetic smoke base-weight download".into(),
            destination: "huggingface.co or the operator-configured model registry".into(),
            trigger: "Only during an explicitly launched synthetic smoke run when the tiny base weights are not cached".into(),
            data_sent: "The public smoke-model identifier and normal download metadata; personal feedback is never read by the smoke run".into(),
        },
        OptionalEgress {
            feature: "Remote Ollama model management".into(),
            destination: ollama_management_endpoint.clone(),
            trigger: "Only for explicit status/list/pull/delete operations after PRISMOS_ALLOW_REMOTE_OLLAMA=1 is set; non-loopback origins must use HTTPS".into(),
            data_sent: "Connection metadata and requested model identifiers. Chat, Project Knowledge, document, and image prompts remain on the fixed loopback inference route".into(),
        },
        OptionalEgress {
            feature: "Brain Wrapped sharing".into(),
            destination: "The native share target selected by the user, or a new post composer on x.com".into(),
            trigger: "Only after the user explicitly presses Share or Share on X".into(),
            data_sent: "A derived behavioral-profile summary, archetype, and deterministic visualization signature. It is linkable metadata, not an anonymous or unique identity".into(),
        },
        OptionalEgress {
            feature: "Research bridge (DMZ)".into(),
            destination: "Public http(s) sites you explicitly ask the isolated research-bridge sidecar to fetch".into(),
            trigger: "Only when you paste a URL and explicitly consent (allow_egress) in the Research panel; off by default and never automatic".into(),
            data_sent: "An HTTP GET to the URL you chose (fixed User-Agent, no cookies/credentials/PII). The isolated sidecar egresses, not the core; retrieved text lands fenced as untrusted with a receipt. SSRF-guarded and IP-pinned".into(),
        },
    ];

    let summary = if remote_ollama_opt_in {
        "PrismOS's chat, Project Knowledge, document, and image inference remain on a fixed \
         loopback route. PRISMOS_ALLOW_REMOTE_OLLAMA enables only explicit endpoint-aware model \
         status/list/pull/delete operations. There is no telemetry and no web crawler. Optional \
         downloads, browser speech, synthetic smoke validation, explicit Brain Wrapped sharing, \
         and remote model management can reach off-device; \
         review the itemized report."
            .to_string()
    } else {
        "PrismOS's core inference client is restricted to a loopback Ollama endpoint by default, \
         and the knowledge graph stays in local app data. The Ollama daemon does not provide an \
         authenticated zero-egress receipt. There is no PrismOS telemetry and no web crawler. \
         Optional integrations plus explicit model downloads, synthetic smoke validation, and \
         Brain Wrapped sharing can reach off-device; \
         review the itemized report before enabling them."
            .to_string()
    };

    OfflineBoundaryReport {
        core_local_only: true,
        ollama_endpoint,
        ollama_management_endpoint,
        remote_ollama_opt_in,
        no_telemetry: true,
        no_web_crawler: true,
        local_corpus_ingestion:
            "To add outside knowledge without PrismOS web access, point PrismOS at supported local \
             text/code files via Settings → Project Knowledge (a human-approved, on-device scan). \
             The inference boundary still depends on the configured Ollama endpoint."
                .into(),
        optional_egress,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_is_honest_and_complete() {
        let r = report(Some(
            "https://user:secret@models.example.test:9443/private?token=x",
        ));
        // All known opt-in/explicit egress paths are disclosed.
        assert_eq!(r.optional_egress.len(), 6);
        assert!(r
            .optional_egress
            .iter()
            .any(|e| e.feature.contains("Research bridge")));
        assert!(r.no_telemetry);
        assert!(r.no_web_crawler);
        assert!(r.ollama_endpoint.contains("localhost"));
        assert_eq!(
            r.ollama_management_endpoint,
            "https://models.example.test:9443"
        );
        assert!(!r.ollama_management_endpoint.contains("secret"));
        assert!(!r.summary.is_empty());
        // The summary never makes the absolute "zero bytes" claim.
        assert!(!r.summary.to_lowercase().contains("zero bytes"));
        assert!(r.summary.to_lowercase().contains("loopback"));
        assert!(r.local_corpus_ingestion.contains("Project Knowledge"));
        assert!(r
            .local_corpus_ingestion
            .contains("configured Ollama endpoint"));
    }
}
