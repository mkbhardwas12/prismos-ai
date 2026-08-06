// Ollama Bridge — Local LLM Inference Interface
//
// Provides a Rust HTTP client for the Ollama REST API. The default policy is
// loopback-only; explicit remote opt-in changes the privacy boundary.

use futures_util::{stream, StreamExt};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;

use crate::inference_bridge::{ResponseFormat, ThinkingMode};

pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
/// Reviewed cross-surface fallback for callers that omit a model. Frontend
/// settings normally pass the installed model selected during onboarding.
pub const DEFAULT_CHAT_MODEL: &str = "qwen3:4b";
const ALLOW_REMOTE_OLLAMA_ENV: &str = "PRISMOS_ALLOW_REMOTE_OLLAMA";
const GENERATE_TIMEOUT: Duration = Duration::from_secs(300); // 5 min — large models (deepseek-r1) on doc analysis need time
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const EMBED_TIMEOUT: Duration = Duration::from_secs(30); // embeddings are ms-fast once the model is warm; 30s covers cold load
const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(10);
const MODEL_SHOW_TIMEOUT: Duration = Duration::from_secs(5);
const MODEL_INVENTORY_ADMISSION_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_CHAT_MODEL_CANDIDATES: usize = 128;
const MODEL_CAPABILITY_PROBE_CONCURRENCY: usize = 8;
const MAX_MODEL_NAME_BYTES: usize = 200;
const MAX_OLLAMA_JSON_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const MAX_OLLAMA_SHOW_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_OLLAMA_ERROR_RESPONSE_BYTES: usize = 64 * 1024;
#[allow(dead_code)] // Bounds are exercised by the compatibility streaming API below.
const MAX_OLLAMA_STREAM_WIRE_BYTES: usize = 32 * 1024 * 1024;
#[allow(dead_code)]
const MAX_OLLAMA_STREAM_LINE_BYTES: usize = 1024 * 1024;
#[allow(dead_code)]
const MAX_OLLAMA_STREAM_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

fn append_bounded_bytes(
    destination: &mut Vec<u8>,
    bytes: &[u8],
    maximum: usize,
    label: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if bytes.len() > maximum.saturating_sub(destination.len()) {
        return Err(format!("{label} exceeded the {maximum}-byte safety limit").into());
    }
    destination.extend_from_slice(bytes);
    Ok(())
}

async fn read_bounded_response(
    mut response: reqwest::Response,
    maximum: usize,
    label: &str,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    if response
        .content_length()
        .is_some_and(|length| length > maximum as u64)
    {
        return Err(format!("{label} exceeded the {maximum}-byte safety limit").into());
    }

    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(0)
        .min(maximum);
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response.chunk().await? {
        append_bounded_bytes(&mut body, &chunk, maximum, label)?;
    }
    Ok(body)
}

async fn read_bounded_json<T: DeserializeOwned>(
    response: reqwest::Response,
    label: &str,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>> {
    read_bounded_json_with_limit(response, MAX_OLLAMA_JSON_RESPONSE_BYTES, label).await
}

async fn read_bounded_json_with_limit<T: DeserializeOwned>(
    response: reqwest::Response,
    maximum: usize,
    label: &str,
) -> Result<T, Box<dyn std::error::Error + Send + Sync>> {
    let body = read_bounded_response(response, maximum, label).await?;
    serde_json::from_slice(&body).map_err(|error| format!("Invalid {label} JSON: {error}").into())
}

async fn read_bounded_error(response: reqwest::Response) -> String {
    match read_bounded_response(
        response,
        MAX_OLLAMA_ERROR_RESPONSE_BYTES,
        "Ollama error response",
    )
    .await
    {
        Ok(body) => String::from_utf8_lossy(&body).into_owned(),
        Err(error) => error.to_string(),
    }
}

/// How long Ollama keeps a model resident in memory after a request. Keeping it
/// warm means follow-up queries skip the multi-second model reload — essential
/// for a snappy daily-driver feel. Override with the `OLLAMA_KEEP_ALIVE` env var
/// (e.g. "60m", "-1" to keep loaded indefinitely, "0" to unload immediately).
const DEFAULT_KEEP_ALIVE: &str = "30m";

/// Validate the inference endpoint before any prompt, document, image, or
/// embedding can be sent. PrismOS is local-first, so remote endpoints require
/// an explicit process-level opt-in instead of silently contradicting the UI's
/// privacy promise.
pub(crate) fn validated_base_url(
    base_url: Option<&str>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    validate_base_url_with_policy(
        base_url.unwrap_or(DEFAULT_OLLAMA_URL),
        remote_ollama_allowed(),
    )
}

pub(crate) fn remote_ollama_allowed() -> bool {
    std::env::var(ALLOW_REMOTE_OLLAMA_ENV)
        .ok()
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn validate_base_url_with_policy(
    raw: &str,
    allow_remote: bool,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    if raw.is_empty() || raw.len() > 2_048 {
        return Err("Ollama URL must contain 1..=2048 bytes".into());
    }
    let parsed = reqwest::Url::parse(raw.trim()).map_err(|e| format!("Invalid Ollama URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Ollama URL must use http or https".into());
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return Err(
            "Ollama URL must be an origin only (no credentials, path, query, or fragment)".into(),
        );
    }

    let host = parsed.host_str().ok_or("Ollama URL is missing a host")?;
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host == "::1"
        || host == "[::1]"
        || host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);
    if !is_loopback && parsed.scheme() != "https" {
        return Err(format!(
            "Refusing unencrypted remote Ollama endpoint '{host}'. Non-loopback model management requires HTTPS."
        )
        .into());
    }
    if !is_loopback && !allow_remote {
        return Err(format!(
            "Refusing remote Ollama endpoint '{host}'. PrismOS keeps private content on this device. Set {ALLOW_REMOTE_OLLAMA_ENV}=1 only after explicitly accepting remote data egress."
        )
        .into());
    }

    Ok(raw.trim().trim_end_matches('/').to_string())
}

pub(crate) fn local_http_client(
) -> Result<reqwest::Client, Box<dyn std::error::Error + Send + Sync>> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(Into::into)
}

/// Bound and normalize the model identifier used in requests and audit details.
/// Ollama names are data, not paths or command fragments.
pub(crate) fn validate_model_name(
    model: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if model.is_empty() || model.len() > MAX_MODEL_NAME_BYTES || model.trim() != model {
        return Err(format!(
            "Model name must contain 1..={MAX_MODEL_NAME_BYTES} bytes without surrounding whitespace"
        )
        .into());
    }
    if !model.is_ascii()
        || !model.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':')
        })
        || model.starts_with('-')
        || model.contains("..")
        || model
            .split(['/', ':'])
            .any(|part| part.is_empty() || part == "." || part == ".." || part.starts_with('-'))
    {
        return Err("Model name contains an invalid or path-like component".into());
    }
    Ok(())
}

/// Resolve the keep-alive window from the environment, falling back to 30 min.
fn keep_alive() -> String {
    std::env::var("OLLAMA_KEEP_ALIVE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_KEEP_ALIVE.to_string())
}

/// How many models Ollama keeps resident at once. The goal loop uses a *builder*
/// model AND a reasoning *judge* model in the same turn; keeping ≥2 co-resident
/// avoids a multi-second reload every time it switches between them. Ollama reads
/// this from its own server environment, so PrismOS sets it when it launches
/// `ollama serve`. Respects a value the user already exported.
pub const DEFAULT_MAX_LOADED_MODELS: &str = "3";

/// Environment overrides to apply when PrismOS launches `ollama serve`, so the
/// builder and judge models can stay warm together. Skips any variable the user
/// already set (their choice always wins).
pub fn server_env_overrides() -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    if std::env::var("OLLAMA_MAX_LOADED_MODELS").is_err() {
        out.push((
            "OLLAMA_MAX_LOADED_MODELS",
            DEFAULT_MAX_LOADED_MODELS.to_string(),
        ));
    }
    out
}

// ─── Token budgets ─────────────────────────────────────────────────────────────
// Two independent knobs:
//   • num_ctx     — how many tokens the model can READ (system + RAG + history + its
//                   own output). Ollama defaults to a tiny 2048–4096; that silently
//                   truncates documents and long code. 16k gives real room and stays
//                   fast on 64GB unified memory. Override with OLLAMA_NUM_CTX.
//   • num_predict — how many tokens the model may WRITE. This is a ceiling, not a
//                   reservation: it costs nothing unless actually generated. 8192 ≈
//                   ~1000 lines of code. Override with OLLAMA_NUM_PREDICT.
/// Default context window (tokens the model can attend to). 4× the old 8192 cap.
const DEFAULT_NUM_CTX: u32 = 16384;
/// Default response ceiling for a normal answer.
const DEFAULT_OUTPUT_TOKENS: u32 = 8192;
/// Thinking-capable models spend output budget on internal reasoning before the
/// visible answer. Give them more headroom so a long deliberation does not consume
/// the entire response budget before producing a conclusion.
const REASONING_OUTPUT_TOKENS: u32 = 16384;

/// Context window, env-overridable via `OLLAMA_NUM_CTX`.
pub(crate) fn num_ctx() -> u32 {
    std::env::var("OLLAMA_NUM_CTX")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|n| *n >= 512)
        .unwrap_or(DEFAULT_NUM_CTX)
}

/// Per-model output ceiling: bigger for reasoning models. `OLLAMA_NUM_PREDICT`
/// overrides the floor for every model when set.
pub(crate) fn output_tokens_for(model: &str) -> u32 {
    let base = if crate::smart_router::is_reasoning_model(model) {
        REASONING_OUTPUT_TOKENS
    } else {
        DEFAULT_OUTPUT_TOKENS
    };
    let env = std::env::var("OLLAMA_NUM_PREDICT")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|n| *n >= 64);
    // Honor an explicit env override, but never below the model's sensible floor.
    env.map(|n| n.max(base)).unwrap_or(base)
}

/// Ollama accepts either a boolean or, for models such as GPT-OSS, a named
/// reasoning level in the same `think` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ThinkLevel {
    Low,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum ThinkWireValue {
    Boolean(bool),
    Level(ThinkLevel),
}

/// Map trusted orchestration state and an admitted Ollama model capability onto
/// the wire contract. User, project, retrieved, and generated text is
/// deliberately absent from this decision.
///
/// Current Qwen 3 registry tags mix hybrid, instruct-only, and thinking-only
/// artifacts. After Ollama admits the `thinking` capability, known thinking-only
/// tags stay enabled even in Standard mode; instruct/coder tags receive no
/// structured-thinking field. Ambiguous Qwen 3 aliases are left at their model
/// default for Standard and are only opted in by an explicit Deliberate request.
fn think_wire_value(
    model: &str,
    mode: ThinkingMode,
    thinking_capability_admitted: bool,
) -> Option<ThinkWireValue> {
    let lower = model.to_ascii_lowercase();
    let leaf = lower.rsplit('/').next().unwrap_or(lower.as_str());
    let (base, tag) = leaf.split_once(':').unwrap_or((leaf, "latest"));

    if !thinking_capability_admitted {
        return None;
    }

    if base.starts_with("qwen3") {
        let known_thinking_only =
            tag.contains("thinking") || (base == "qwen3" && matches!(tag, "4b" | "30b" | "235b"));
        if known_thinking_only {
            return Some(ThinkWireValue::Boolean(true));
        }
        if tag.contains("instruct") || base.contains("coder") {
            return None;
        }
        return match mode {
            ThinkingMode::Standard => None,
            ThinkingMode::Deliberate => Some(ThinkWireValue::Boolean(true)),
        };
    }

    if base.starts_with("gpt-oss") {
        return Some(ThinkWireValue::Level(match mode {
            ThinkingMode::Standard => ThinkLevel::Low,
            ThinkingMode::Deliberate => ThinkLevel::High,
        }));
    }

    Some(ThinkWireValue::Boolean(matches!(
        mode,
        ThinkingMode::Deliberate
    )))
}

/// Case-insensitive substring search that returns a byte offset valid in the
/// original string. ASCII lowercasing is a 1:1 byte mapping and leaves non-ASCII
/// bytes untouched, so the index from the folded copy is safe to slice `haystack`.
fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

/// Split a raw model completion into (visible answer, internal reasoning segment).
///
/// Reasoning models (deepseek-r1, qwq, and qwen3 when thinking is enabled) emit a
/// `<think>…</think>` block before the answer. Left in place it can leak model
/// scratch text into the chat bubble. Only a block at the beginning of the
/// completion is treated as the legacy envelope; literal tags later in XML,
/// prose, or code are ordinary answer content and remain untouched. The trace is
/// returned separately only so callers can discard it or record bounded
/// diagnostics such as presence/length. It must not be exported as a thought
/// process.
/// Purely local string handling — no I/O.
pub fn split_think(raw: &str) -> (String, Option<String>) {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";
    let trimmed = raw.trim();
    if find_ci(trimmed, OPEN) != Some(0) {
        return (trimmed.to_string(), None);
    }
    let after_open = &trimmed[OPEN.len()..];
    let (visible, trace) = if let Some(close_at) = find_ci(after_open, CLOSE) {
        (
            after_open[close_at + CLOSE.len()..].trim().to_string(),
            after_open[..close_at].trim(),
        )
    } else {
        // An unclosed leading trace means the model was truncated mid-thought.
        // Keep it out of the visible channel even though no answer followed.
        (String::new(), after_open.trim())
    };
    (visible, (!trace.is_empty()).then(|| trace.to_string()))
}

/// Return only the model's visible answer. Structured and legacy reasoning
/// segments are intentionally discarded and never merged into the response.
fn visible_response(
    content: &str,
    structured_thinking: Option<&str>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let (visible, legacy_thinking) = split_think(content);
    if !visible.is_empty() {
        return Ok(visible);
    }
    if structured_thinking.is_some_and(|value| !value.trim().is_empty())
        || legacy_thinking.is_some()
    {
        return Err("Ollama returned internal reasoning without a visible answer".into());
    }
    Ok(content.trim().to_string())
}

// ─── Request / Response Types ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
    /// Typed Ollama reasoning control for documented thinking-capable models.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<ThinkWireValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<GenerateOptions>,
    /// Base64-encoded images for multimodal vision models (llava, llama3.2-vision)
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
    /// How long to keep the model resident after this request (e.g. "30m").
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_alive: Option<String>,
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    /// Context window — without this, /api/generate falls back to Ollama's tiny
    /// 2048–4096 default and silently truncates long documents.
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

// ─── Chat API Types (proper role-based messaging) ──────────────────────────────

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
    /// Typed Ollama reasoning control for documented thinking-capable models.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<ThinkWireValue>,
    /// Ollama's structured-output mode. Omitted for ordinary chat so existing
    /// behavior remains unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<ChatOptions>,
    /// How long to keep the model resident after this request (e.g. "30m").
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_alive: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct ChatOptions {
    /// Lower = more focused/deterministic, higher = more creative
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    /// Context window size in tokens (default 2048 is too small for RAG)
    #[serde(skip_serializing_if = "Option::is_none")]
    num_ctx: Option<u32>,
    /// Max tokens to generate
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    message: ChatResponseMessage,
    #[serde(default)]
    #[allow(dead_code)]
    done: bool,
    #[serde(default)]
    done_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
    #[serde(default)]
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    done: bool,
}

#[derive(Debug, Deserialize)]
struct ModelList {
    models: Vec<ModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified_at: Option<String>,
}

// ─── Ollama API Functions ──────────────────────────────────────────────────────

/// Prompt-free request for Ollama's current model-metadata endpoint. Only the
/// model identifier crosses this boundary; user, project, and retrieved content
/// is never included in capability admission.
#[derive(Debug, Serialize)]
struct ShowModelRequest<'a> {
    model: &'a str,
}

#[derive(Debug, Deserialize)]
struct ShowModelResponse {
    #[serde(default)]
    capabilities: Vec<String>,
}

/// Capabilities admitted from Ollama's runtime report. Unknown capability names
/// are ignored and absent fields remain false, making admission fail closed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ModelCapabilities {
    completion: bool,
    vision: bool,
    thinking: bool,
}

impl ModelCapabilities {
    fn from_reported(reported: &[String]) -> Self {
        let mut capabilities = Self::default();
        for capability in reported {
            match capability.trim().to_ascii_lowercase().as_str() {
                "completion" => capabilities.completion = true,
                "vision" => capabilities.vision = true,
                "thinking" => capabilities.thinking = true,
                _ => {}
            }
        }
        capabilities
    }
}

async fn show_model_capabilities_at(
    client: &reqwest::Client,
    url: &str,
    model: &str,
) -> Result<ModelCapabilities, Box<dyn std::error::Error + Send + Sync>> {
    validate_model_name(model)?;
    let response = client
        .post(format!("{url}/api/show"))
        .json(&ShowModelRequest { model })
        .timeout(MODEL_SHOW_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(format!(
            "Ollama returned HTTP {} while checking model capabilities",
            response.status()
        )
        .into());
    }

    let report: ShowModelResponse = read_bounded_json_with_limit(
        response,
        MAX_OLLAMA_SHOW_RESPONSE_BYTES,
        "Ollama model capability response",
    )
    .await?;
    Ok(ModelCapabilities::from_reported(&report.capabilities))
}

async fn require_generation_capabilities_at(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    requires_vision: bool,
) -> Result<ModelCapabilities, Box<dyn std::error::Error + Send + Sync>> {
    let capabilities = show_model_capabilities_at(client, url, model)
        .await
        .map_err(|error| format!("Could not admit model '{model}' for generation: {error}"))?;
    validate_generation_capabilities(model, capabilities, requires_vision)?;
    Ok(capabilities)
}

fn validate_generation_capabilities(
    model: &str,
    capabilities: ModelCapabilities,
    requires_vision: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if !capabilities.completion {
        return Err(format!(
            "Model '{model}' is not admitted for generation because Ollama did not report the 'completion' capability"
        )
        .into());
    }
    if requires_vision && !capabilities.vision {
        return Err(format!(
            "Model '{model}' is not admitted for image generation because Ollama did not report the 'vision' capability"
        )
        .into());
    }
    Ok(())
}

async fn list_models_at(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let response = client
        .get(format!("{url}/api/tags"))
        .timeout(MODEL_LIST_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(vec![]);
    }

    let model_list: ModelList = read_bounded_json(response, "Ollama model list").await?;
    Ok(model_list.models)
}

fn admitted_models_in_inventory_order(
    mut checked: Vec<(usize, ModelInfo, Option<ModelCapabilities>)>,
) -> Vec<ModelInfo> {
    checked.sort_by_key(|(index, _, _)| *index);
    checked
        .into_iter()
        .filter_map(|(_, model, capabilities)| {
            capabilities
                .is_some_and(|value| value.completion)
                .then_some(model)
        })
        .collect()
}

async fn list_chat_models_at(
    client: &reqwest::Client,
    url: &str,
    models: Vec<ModelInfo>,
) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    if models.len() > MAX_CHAT_MODEL_CANDIDATES {
        return Err(format!(
            "Ollama returned {} model candidates; the chat admission limit is {MAX_CHAT_MODEL_CANDIDATES}",
            models.len()
        )
        .into());
    }

    let probes = stream::iter(models.into_iter().enumerate())
        .map(|(index, model)| {
            let client = client.clone();
            let url = url.to_string();
            async move {
                let capabilities = show_model_capabilities_at(&client, &url, &model.name)
                    .await
                    .ok();
                (index, model, capabilities)
            }
        })
        .buffer_unordered(MODEL_CAPABILITY_PROBE_CONCURRENCY)
        .collect::<Vec<_>>();

    let checked = tokio::time::timeout(MODEL_INVENTORY_ADMISSION_TIMEOUT, probes)
        .await
        .map_err(|_| "Timed out while admitting local chat model capabilities")?;
    Ok(admitted_models_in_inventory_order(checked))
}

/// Check if Ollama is running and accessible
pub async fn is_available(
    base_url: Option<&str>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let url = validated_base_url(base_url)?;
    let client = local_http_client()?;
    match client.get(url).timeout(HEALTH_TIMEOUT).send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Generate a completion from a local model (non-streaming)
/// Pass `images` as base64-encoded strings for multimodal vision models.
pub async fn generate(
    model: &str,
    prompt: &str,
    base_url: Option<&str>,
    max_tokens: Option<u32>,
    images: Option<Vec<String>>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    validate_model_name(model)?;
    let url = validated_base_url(base_url)?;
    let client = local_http_client()?;
    let requires_vision = images.as_ref().is_some_and(|values| !values.is_empty());
    let capabilities =
        require_generation_capabilities_at(&client, &url, model, requires_vision).await?;
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a model-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(num_ctx()),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(model))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        think: think_wire_value(model, ThinkingMode::Standard, capabilities.thinking),
        prompt: prompt.to_string(),
        stream: false,
        options,
        images,
        keep_alive: Some(keep_alive()),
    };

    let response = client
        .post(format!("{}/api/generate", url))
        .json(&request)
        .timeout(GENERATE_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_bounded_error(response).await;
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let gen_response: GenerateResponse =
        read_bounded_json(response, "Ollama generation response").await?;
    visible_response(&gen_response.response, gen_response.thinking.as_deref())
}

/// Chat completion using Ollama's /api/chat endpoint with proper role separation.
/// This gives the model structured system/user/assistant message roles,
/// which dramatically improves instruction-following compared to raw prompt injection.
/// `few_shot_examples` — optional (question, answer) pairs from highly-rated past responses
/// that are injected as user→assistant message pairs before the actual question,
/// grounding the model on the style and quality of good past answers.
pub async fn chat(
    model: &str,
    system_prompt: &str,
    user_content: &str,
    base_url: Option<&str>,
    images: Option<Vec<String>>,
    few_shot_examples: Option<Vec<(String, String)>>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    chat_with_limits(
        model,
        system_prompt,
        user_content,
        base_url,
        images,
        few_shot_examples,
        num_ctx(),
        output_tokens_for(model),
        ThinkingMode::Standard,
        ResponseFormat::Text,
    )
    .await
}

/// Typed-inference variant that honors the admitted request budgets instead of
/// silently replacing them with process defaults.
#[allow(clippy::too_many_arguments)]
pub async fn chat_with_limits(
    model: &str,
    system_prompt: &str,
    user_content: &str,
    base_url: Option<&str>,
    images: Option<Vec<String>>,
    few_shot_examples: Option<Vec<(String, String)>>,
    context_tokens: u32,
    output_tokens: u32,
    thinking_mode: ThinkingMode,
    response_format: ResponseFormat,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    validate_model_name(model)?;
    let url = validated_base_url(base_url)?;
    let client = local_http_client()?;
    let requires_vision = images.as_ref().is_some_and(|values| !values.is_empty());
    let capabilities =
        require_generation_capabilities_at(&client, &url, model, requires_vision).await?;

    let mut messages = vec![];

    // System message — model treats this as persistent instructions
    if !system_prompt.is_empty() {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
            images: None,
        });
    }

    // Few-shot examples from thumbs-up rated past responses
    // These ground the model on what "good" answers look like
    if let Some(examples) = few_shot_examples {
        for (q, a) in examples {
            messages.push(ChatMessage {
                role: "user".to_string(),
                content: q,
                images: None,
            });
            messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: a,
                images: None,
            });
        }
    }

    // User message — opaque task/context data. Reasoning mode is a trusted
    // control-plane value and is never inferred from this content.
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content.to_string(),
        images,
    });

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
        think: think_wire_value(model, thinking_mode, capabilities.thinking),
        format: match response_format {
            ResponseFormat::Text => None,
            ResponseFormat::Json => Some("json"),
        },
        options: Some(ChatOptions {
            // Structured contracts should be deterministic; ordinary chat
            // retains the existing balanced setting.
            temperature: Some(match response_format {
                ResponseFormat::Text => 0.7,
                ResponseFormat::Json => 0.0,
            }),
            num_ctx: Some(context_tokens),
            num_predict: Some(output_tokens),
        }),
        keep_alive: Some(keep_alive()),
    };

    let response = client
        .post(format!("{}/api/chat", url))
        .json(&request)
        .timeout(GENERATE_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_bounded_error(response).await;
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let chat_response: ChatResponse = read_bounded_json(response, "Ollama chat response").await?;
    if chat_response.done_reason.as_deref() == Some("length") {
        return Err(
            "Ollama stopped at the output-token limit before completing the response".into(),
        );
    }
    visible_response(
        &chat_response.message.content,
        chat_response.message.thinking.as_deref(),
    )
}

/// List all locally available models
pub async fn list_models(
    base_url: Option<&str>,
) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let url = validated_base_url(base_url)?;
    let client = local_http_client()?;
    list_models_at(&client, &url).await
}

/// List only completion-capable models on the fixed loopback inference origin.
/// The configurable management endpoint is deliberately absent from this API.
pub async fn list_local_chat_models(
) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let url = validated_base_url(None)?;
    let client = local_http_client()?;
    let models = list_models_at(&client, &url).await?;
    list_chat_models_at(&client, &url, models).await
}

// ─── Embeddings — the semantic layer of the Spectrum Graph ─────────────────────
// Runs through the same validated Ollama origin as generation. The origin is
// loopback-only by default; explicit remote opt-in changes the privacy boundary.
// Callers degrade to keyword retrieval when the model or endpoint is unavailable.

/// Default local embedding model — small (~274 MB), fast, strong retrieval
/// quality. Pull once with `ollama pull nomic-embed-text`.
/// Override with the `PRISMOS_EMBED_MODEL` env var (e.g. "mxbai-embed-large").
pub const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";

/// Resolve the embedding model from the environment, falling back to the default.
pub fn embed_model() -> String {
    std::env::var("PRISMOS_EMBED_MODEL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_EMBED_MODEL.to_string())
}

#[derive(Debug, Serialize)]
struct EmbedRequest {
    model: String,
    input: String,
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    #[serde(default)]
    embeddings: Vec<Vec<f64>>,
}

#[derive(Debug, Serialize)]
struct LegacyEmbeddingsRequest {
    model: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct LegacyEmbeddingsResponse {
    #[serde(default)]
    embedding: Vec<f64>,
}

/// Compute an embedding vector for `text` on the local Ollama daemon.
/// Tries the modern `/api/embed` endpoint first (Ollama ≥ 0.1.34), then falls
/// back to the legacy `/api/embeddings`. Returns Err when Ollama is down or the
/// embedding model isn't pulled — callers fall back to keyword-only retrieval.
pub async fn embed(
    text: &str,
    base_url: Option<&str>,
) -> Result<Vec<f64>, Box<dyn std::error::Error + Send + Sync>> {
    let url = validated_base_url(base_url)?;
    let model = embed_model();
    let client = local_http_client()?;

    // Modern endpoint: POST /api/embed { model, input } → { embeddings: [[..]] }
    let response = client
        .post(format!("{}/api/embed", url))
        .json(&EmbedRequest {
            model: model.clone(),
            input: text.to_string(),
        })
        .timeout(EMBED_TIMEOUT)
        .send()
        .await?;

    if response.status().is_success() {
        let parsed: EmbedResponse =
            read_bounded_json(response, "Ollama embedding response").await?;
        if let Some(v) = parsed.embeddings.into_iter().next() {
            if !v.is_empty() {
                return Ok(v);
            }
        }
    }

    // Legacy fallback: POST /api/embeddings { model, prompt } → { embedding: [..] }
    let response = client
        .post(format!("{}/api/embeddings", url))
        .json(&LegacyEmbeddingsRequest {
            model: model.clone(),
            prompt: text.to_string(),
        })
        .timeout(EMBED_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_bounded_error(response).await;
        return Err(format!(
            "Ollama embed error ({}): {} — is the embed model pulled? (`ollama pull {}`)",
            status, body, model
        )
        .into());
    }

    let parsed: LegacyEmbeddingsResponse =
        read_bounded_json(response, "Ollama legacy embedding response").await?;
    if parsed.embedding.is_empty() {
        return Err("Ollama returned an empty embedding".into());
    }
    Ok(parsed.embedding)
}

// ─── Streaming Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StreamChunk {
    #[serde(default)]
    response: String,
    /// Parsed separately so internal reasoning tokens cannot be confused with
    /// visible output. This compatibility API intentionally does not emit them.
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct StreamEvent {
    pub token: String,
    pub done: bool,
}

#[allow(dead_code)]
fn process_stream_line<F>(
    line: &[u8],
    full_response: &mut String,
    on_token: &mut F,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(StreamEvent),
{
    if line.iter().all(|byte| byte.is_ascii_whitespace()) {
        return Ok(());
    }

    let parsed: StreamChunk = serde_json::from_slice(line)
        .map_err(|error| format!("Invalid Ollama stream JSON: {error}"))?;
    if parsed.response.len() > MAX_OLLAMA_STREAM_OUTPUT_BYTES.saturating_sub(full_response.len()) {
        return Err(format!(
            "Ollama stream output exceeded the {}-byte safety limit",
            MAX_OLLAMA_STREAM_OUTPUT_BYTES
        )
        .into());
    }
    if !parsed.response.is_empty() {
        full_response.push_str(&parsed.response);
        on_token(StreamEvent {
            token: parsed.response,
            done: parsed.done,
        });
    } else if parsed.done {
        on_token(StreamEvent {
            token: String::new(),
            done: true,
        });
    }
    Ok(())
}

/// Generate a completion with streaming — sends tokens via a callback
/// Pass `images` as base64-encoded strings for multimodal vision models.
#[allow(dead_code)] // Public compatibility API; current chat uses bounded non-streaming calls.
pub async fn generate_stream<F>(
    model: &str,
    prompt: &str,
    base_url: Option<&str>,
    max_tokens: Option<u32>,
    images: Option<Vec<String>>,
    mut on_token: F,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>>
where
    F: FnMut(StreamEvent),
{
    validate_model_name(model)?;
    let url = validated_base_url(base_url)?;
    let client = local_http_client()?;
    let requires_vision = images.as_ref().is_some_and(|values| !values.is_empty());
    let capabilities =
        require_generation_capabilities_at(&client, &url, model, requires_vision).await?;
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a model-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(num_ctx()),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(model))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        think: think_wire_value(model, ThinkingMode::Standard, capabilities.thinking),
        prompt: prompt.to_string(),
        stream: true,
        options,
        images,
        keep_alive: Some(keep_alive()),
    };

    let response = client
        .post(format!("{}/api/generate", url))
        .json(&request)
        .timeout(GENERATE_TIMEOUT)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = read_bounded_error(response).await;
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    if response
        .content_length()
        .is_some_and(|length| length > MAX_OLLAMA_STREAM_WIRE_BYTES as u64)
    {
        return Err(format!(
            "Ollama stream exceeded the {}-byte safety limit",
            MAX_OLLAMA_STREAM_WIRE_BYTES
        )
        .into());
    }

    let mut full_response = String::new();
    let mut stream = response.bytes_stream();
    let mut pending_line = Vec::new();
    let mut wire_bytes = 0usize;

    while let Some(chunk_result) = stream.next().await {
        let chunk_bytes = chunk_result?;
        wire_bytes = wire_bytes
            .checked_add(chunk_bytes.len())
            .ok_or("Ollama stream byte count overflowed")?;
        if wire_bytes > MAX_OLLAMA_STREAM_WIRE_BYTES {
            return Err(format!(
                "Ollama stream exceeded the {}-byte safety limit",
                MAX_OLLAMA_STREAM_WIRE_BYTES
            )
            .into());
        }

        for segment in chunk_bytes.split_inclusive(|byte| *byte == b'\n') {
            append_bounded_bytes(
                &mut pending_line,
                segment,
                MAX_OLLAMA_STREAM_LINE_BYTES,
                "Ollama stream line",
            )?;
            if segment.last() == Some(&b'\n') {
                process_stream_line(&pending_line, &mut full_response, &mut on_token)?;
                pending_line.clear();
            }
        }
    }

    if !pending_line.iter().all(|byte| byte.is_ascii_whitespace()) {
        process_stream_line(&pending_line, &mut full_response, &mut on_token)?;
    }

    Ok(full_response)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn read_test_http_request(stream: &mut tokio::net::TcpStream) -> Vec<u8> {
        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            assert!(read > 0, "connection closed before the request completed");
            request.extend_from_slice(&chunk[..read]);

            let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
                continue;
            };
            let body_start = header_end + 4;
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let content_length = headers
                .lines()
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if request.len() >= body_start + content_length {
                return request;
            }
        }
    }

    async fn write_test_json_response(stream: &mut tokio::net::TcpStream, body: &str) {
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        stream.shutdown().await.unwrap();
    }

    #[test]
    fn local_url_policy_accepts_loopback_origins() {
        assert_eq!(
            validate_base_url_with_policy("http://localhost:11434/", false).unwrap(),
            "http://localhost:11434"
        );
        assert!(validate_base_url_with_policy("http://127.0.0.1:11434", false).is_ok());
        assert!(validate_base_url_with_policy("http://[::1]:11434", false).is_ok());
    }

    #[test]
    fn local_url_policy_rejects_remote_or_ambiguous_targets() {
        assert!(validate_base_url_with_policy("https://example.com", false).is_err());
        assert!(validate_base_url_with_policy("http://192.168.1.20:11434", false).is_err());
        assert!(validate_base_url_with_policy("file:///tmp/ollama", false).is_err());
        assert!(validate_base_url_with_policy("http://localhost:11434/proxy", false).is_err());
        assert!(validate_base_url_with_policy("http://user:pass@localhost:11434", false).is_err());
    }

    #[test]
    fn remote_url_requires_explicit_policy_opt_in() {
        assert!(validate_base_url_with_policy("https://ollama.internal:11434", true).is_ok());
        assert!(validate_base_url_with_policy("http://ollama.internal:11434", true).is_err());
        assert!(validate_base_url_with_policy("http://192.168.1.20:11434", true).is_err());
    }

    #[test]
    fn model_names_are_bounded_data_not_paths_or_options() {
        for valid in ["llama3.2", "qwen3:4b", "library/model-v1.2_4"] {
            assert!(validate_model_name(valid).is_ok(), "rejected {valid}");
        }
        for invalid in [
            "",
            " model",
            "model ",
            "-model",
            "../model",
            "model;run",
            "model\nnext",
        ] {
            assert!(
                validate_model_name(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
        assert!(validate_model_name(&"a".repeat(MAX_MODEL_NAME_BYTES + 1)).is_err());
    }

    fn model_info(name: &str) -> ModelInfo {
        ModelInfo {
            name: name.to_string(),
            size: None,
            modified_at: None,
        }
    }

    #[test]
    fn show_request_contains_only_the_model_identifier() {
        let request = serde_json::to_value(ShowModelRequest { model: "qwen3:4b" }).unwrap();
        assert_eq!(request, serde_json::json!({ "model": "qwen3:4b" }));
        assert!(request.get("prompt").is_none());
        assert!(request.get("messages").is_none());
        assert!(request.get("images").is_none());
    }

    #[test]
    fn chat_request_serializes_structured_output_only_when_requested() {
        let request = |format| ChatRequest {
            model: "qwen3:4b".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "artifact".into(),
                images: None,
            }],
            stream: false,
            think: None,
            format,
            options: Some(ChatOptions {
                temperature: Some(if format.is_some() { 0.0 } else { 0.7 }),
                num_ctx: Some(8_192),
                num_predict: Some(4_096),
            }),
            keep_alive: None,
        };

        let json = serde_json::to_value(request(Some("json"))).unwrap();
        assert_eq!(json["format"], "json");
        assert_eq!(json["options"]["temperature"], 0.0);

        let text = serde_json::to_value(request(None)).unwrap();
        assert!(text.get("format").is_none());
        assert_eq!(text["options"]["temperature"], 0.7);
    }

    #[test]
    fn runtime_capabilities_are_explicit_normalized_and_fail_closed() {
        let admitted = ModelCapabilities::from_reported(&[
            " COMPLETION ".to_string(),
            "Vision".to_string(),
            "thinking".to_string(),
            "tools".to_string(),
        ]);
        assert_eq!(
            admitted,
            ModelCapabilities {
                completion: true,
                vision: true,
                thinking: true,
            }
        );

        let embedding_only =
            ModelCapabilities::from_reported(&["embedding".to_string(), "tools".to_string()]);
        assert_eq!(embedding_only, ModelCapabilities::default());

        let missing: ShowModelResponse = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(
            ModelCapabilities::from_reported(&missing.capabilities),
            ModelCapabilities::default()
        );
    }

    #[test]
    fn generation_requires_completion_and_vision_when_images_are_present() {
        let completion = ModelCapabilities {
            completion: true,
            ..ModelCapabilities::default()
        };
        assert!(validate_generation_capabilities("chat", completion, false).is_ok());
        assert!(validate_generation_capabilities("chat", completion, true).is_err());
        assert!(
            validate_generation_capabilities("embed", ModelCapabilities::default(), false).is_err()
        );
        assert!(validate_generation_capabilities(
            "vision",
            ModelCapabilities {
                completion: true,
                vision: true,
                thinking: false,
            },
            true,
        )
        .is_ok());
    }

    #[test]
    fn admitted_chat_models_preserve_tag_order_and_drop_failures() {
        let completion = ModelCapabilities {
            completion: true,
            ..ModelCapabilities::default()
        };
        let checked = vec![
            (2, model_info("qwen3:4b"), Some(completion)),
            (
                0,
                model_info("nomic-embed-text"),
                Some(ModelCapabilities::default()),
            ),
            (3, model_info("unavailable"), None),
            (
                1,
                model_info("gemma3:4b"),
                Some(ModelCapabilities {
                    completion: true,
                    vision: true,
                    thinking: false,
                }),
            ),
        ];

        let names: Vec<String> = admitted_models_in_inventory_order(checked)
            .into_iter()
            .map(|model| model.name)
            .collect();
        assert_eq!(names, vec!["gemma3:4b", "qwen3:4b"]);
    }

    #[tokio::test]
    async fn chat_inventory_candidate_limit_fails_before_network_probes() {
        let client = local_http_client().unwrap();
        let models = (0..=MAX_CHAT_MODEL_CANDIDATES)
            .map(|index| model_info(&format!("model-{index}")))
            .collect();
        let error = list_chat_models_at(&client, "http://127.0.0.1:9", models)
            .await
            .expect_err("candidate overflow must fail closed");
        assert!(error.to_string().contains("chat admission limit"));
    }

    #[tokio::test]
    async fn embedding_only_model_is_rejected_before_prompt_is_sent() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_test_http_request(&mut stream).await;
            let request_text = String::from_utf8(request).unwrap();
            assert!(request_text.starts_with("POST /api/show HTTP/1.1"));
            assert!(request_text.contains(r#"{"model":"nomic-embed-text"}"#));
            assert!(!request_text.contains("private prompt must stay out of show"));
            write_test_json_response(&mut stream, r#"{"capabilities":["embedding"]}"#).await;

            assert!(
                tokio::time::timeout(Duration::from_millis(200), listener.accept())
                    .await
                    .is_err(),
                "generation endpoint was reached after capability rejection"
            );
        });

        let error = generate(
            "nomic-embed-text",
            "private prompt must stay out of show",
            Some(&origin),
            None,
            None,
        )
        .await
        .expect_err("embedding-only model must fail closed");
        assert!(error.to_string().contains("'completion' capability"));
        server.await.unwrap();
    }

    #[test]
    fn bounded_response_buffer_rejects_overflow_without_appending() {
        let mut body = b"1234".to_vec();
        append_bounded_bytes(&mut body, b"56", 6, "test response").unwrap();
        assert_eq!(body, b"123456");

        let error = append_bounded_bytes(&mut body, b"7", 6, "test response")
            .expect_err("must reject bytes beyond the exact limit");
        assert!(error.to_string().contains("safety limit"));
        assert_eq!(body, b"123456");
    }

    #[test]
    fn stream_line_parser_emits_only_valid_bounded_json() {
        let mut response = String::new();
        let mut events = Vec::new();
        process_stream_line(
            b"{\"response\":\"hello\",\"done\":false}\n",
            &mut response,
            &mut |event| events.push(event),
        )
        .unwrap();
        process_stream_line(b" \r\n", &mut response, &mut |event| events.push(event)).unwrap();

        assert_eq!(response, "hello");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].token, "hello");
        assert!(!events[0].done);
        assert!(
            process_stream_line(b"not-json\n", &mut response, &mut |event| events
                .push(event),)
            .is_err()
        );
    }

    #[test]
    fn stream_line_parser_discards_structured_thinking_tokens() {
        let mut response = String::new();
        let mut events = Vec::new();
        process_stream_line(
            b"{\"response\":\"\",\"thinking\":\"private scratch\",\"done\":false}\n",
            &mut response,
            &mut |event| events.push(event),
        )
        .unwrap();
        process_stream_line(
            b"{\"response\":\"final answer\",\"thinking\":\"\",\"done\":true}\n",
            &mut response,
            &mut |event| events.push(event),
        )
        .unwrap();

        assert_eq!(response, "final answer");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].token, "final answer");
        assert!(events[0].done);
    }

    #[test]
    fn test_keep_alive_default() {
        // With no env override, defaults to the constant.
        std::env::remove_var("OLLAMA_KEEP_ALIVE");
        assert_eq!(keep_alive(), DEFAULT_KEEP_ALIVE);
    }

    fn serialized_think(
        model: &str,
        mode: ThinkingMode,
        thinking_capability_admitted: bool,
        prompt: &str,
    ) -> serde_json::Value {
        let request = GenerateRequest {
            model: model.into(),
            prompt: prompt.into(),
            stream: false,
            think: think_wire_value(model, mode, thinking_capability_admitted),
            options: None,
            images: None,
            keep_alive: None,
        };
        serde_json::to_value(request).expect("serialize generate request")
    }

    #[test]
    fn gpt_oss_uses_supported_named_thinking_levels() {
        let standard = serialized_think("gpt-oss:20b", ThinkingMode::Standard, true, "hello");
        let deliberate = serialized_think("gpt-oss:20b", ThinkingMode::Deliberate, true, "hello");
        assert_eq!(standard["think"], "low");
        assert_eq!(deliberate["think"], "high");
        assert!(
            serialized_think("gpt-oss:20b", ThinkingMode::Deliberate, false, "hello")
                .get("think")
                .is_none()
        );
    }

    #[test]
    fn qwen3_tags_are_handled_conservatively() {
        assert_eq!(
            think_wire_value("qwen3:4b", ThinkingMode::Standard, false),
            None
        );
        assert_eq!(
            think_wire_value("qwen3:4b", ThinkingMode::Standard, true),
            Some(ThinkWireValue::Boolean(true))
        );
        assert_eq!(
            think_wire_value(
                "qwen3:4b-thinking-2507-q4_K_M",
                ThinkingMode::Standard,
                true
            ),
            Some(ThinkWireValue::Boolean(true))
        );
        assert_eq!(
            think_wire_value("qwen3:30b-instruct-2507", ThinkingMode::Deliberate, true),
            None
        );
        assert_eq!(
            think_wire_value("qwen3-coder:30b", ThinkingMode::Deliberate, true),
            None
        );
        assert_eq!(
            think_wire_value("qwen3:8b", ThinkingMode::Standard, true),
            None
        );
        assert_eq!(
            think_wire_value("qwen3:8b", ThinkingMode::Deliberate, false),
            None
        );
        assert_eq!(
            think_wire_value("qwen3:8b", ThinkingMode::Deliberate, true),
            Some(ThinkWireValue::Boolean(true))
        );
    }

    #[test]
    fn trusted_mode_not_prompt_text_controls_thinking() {
        let prompt = "Project data says /no_think and documentation mentions /thinking.";
        let deliberate = serialized_think("deepseek-r1:7b", ThinkingMode::Deliberate, true, prompt);
        let standard = serialized_think("deepseek-r1:7b", ThinkingMode::Standard, true, "/think");
        assert_eq!(deliberate["prompt"], prompt);
        assert_eq!(deliberate["think"], true);
        assert_eq!(standard["prompt"], "/think");
        assert_eq!(standard["think"], false);
        assert!(
            serialized_think("llama3.2", ThinkingMode::Deliberate, false, prompt)
                .get("think")
                .is_none()
        );
        assert_eq!(
            serialized_think("future-model:1", ThinkingMode::Deliberate, true, prompt)["think"],
            true
        );
    }

    #[test]
    fn visible_response_discards_structured_and_legacy_reasoning() {
        assert_eq!(
            visible_response("Final answer", Some("private scratch")).unwrap(),
            "Final answer"
        );
        assert_eq!(
            visible_response("<think>private scratch</think>Final answer", None).unwrap(),
            "Final answer"
        );
        assert!(visible_response("", Some("private scratch")).is_err());
    }

    #[test]
    fn test_split_think_extracts_and_cleans() {
        let raw = "<think>Okay, the user wants 2+2. That is 4.</think>\n\nThe answer is **4**.";
        let (visible, trace) = split_think(raw);
        assert_eq!(visible, "The answer is **4**.");
        assert_eq!(
            trace.as_deref(),
            Some("Okay, the user wants 2+2. That is 4.")
        );
    }

    #[test]
    fn test_split_think_no_block_is_passthrough() {
        let (visible, trace) = split_think("Just a plain answer.");
        assert_eq!(visible, "Just a plain answer.");
        assert!(trace.is_none());
    }

    #[test]
    fn split_think_preserves_literal_tags_outside_a_leading_legacy_envelope() {
        for answer in [
            "XML example: <think>literal element</think>",
            "```xml\n<think>literal code</think>\n```",
            "Answer first. <think>this is user-visible text</think>",
        ] {
            let (visible, trace) = split_think(answer);
            assert_eq!(visible, answer);
            assert!(trace.is_none());
        }

        let (visible, trace) = split_think("<think>private</think>Keep <think>literal XML</think>");
        assert_eq!(visible, "Keep <think>literal XML</think>");
        assert_eq!(trace.as_deref(), Some("private"));
    }

    #[test]
    fn test_split_think_handles_unclosed_and_case_insensitive() {
        // Case-insensitive open tag, unclosed trace (truncated mid-thought).
        let (visible, trace) = split_think("<THINK>still reasoning and cut off");
        assert!(visible.is_empty());
        assert_eq!(trace.as_deref(), Some("still reasoning and cut off"));
    }

    #[test]
    fn test_num_ctx_default() {
        std::env::remove_var("OLLAMA_NUM_CTX");
        assert_eq!(num_ctx(), DEFAULT_NUM_CTX);
        assert_eq!(num_ctx(), 16384);
    }

    #[test]
    fn test_output_tokens_budgets() {
        // Single test owns OLLAMA_NUM_PREDICT end-to-end so parallel tests can't
        // race on the shared env var.
        std::env::remove_var("OLLAMA_NUM_PREDICT");
        // Reasoning models spend budget on <think> → larger ceiling.
        let reasoning_budget = output_tokens_for("deepseek-r1:32b");
        let chat_budget = output_tokens_for("llama3.1:8b");
        assert_eq!(reasoning_budget, REASONING_OUTPUT_TOKENS);
        assert_eq!(output_tokens_for("qwq:32b"), REASONING_OUTPUT_TOKENS);
        // Plain chat / code models use the standard ceiling.
        assert_eq!(chat_budget, DEFAULT_OUTPUT_TOKENS);
        assert_eq!(output_tokens_for("qwen2.5-coder:7b"), DEFAULT_OUTPUT_TOKENS);
        assert!(reasoning_budget > chat_budget);

        // An env override raises the ceiling but can't drop a reasoning model below
        // its sensible floor (guards against starving the <think> trace).
        std::env::set_var("OLLAMA_NUM_PREDICT", "2048");
        assert_eq!(
            output_tokens_for("deepseek-r1:32b"),
            REASONING_OUTPUT_TOKENS
        );
        std::env::set_var("OLLAMA_NUM_PREDICT", "20000");
        assert_eq!(output_tokens_for("llama3.1:8b"), 20000);
        std::env::remove_var("OLLAMA_NUM_PREDICT");
    }
}
