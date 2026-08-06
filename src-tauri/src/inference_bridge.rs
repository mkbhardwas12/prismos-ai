//! Typed, local-only text inference boundary for the PrismOS Reasoner.
//!
//! Ollama remains the default compatibility lane. The storage-native AIVM lane
//! is deliberately present only as a typed, unavailable target until a real
//! companion runtime passes its independent identity, policy, and receipt gates.

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
#[cfg(test)]
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;

const OLLAMA_ENGINE_ID: &str = "ollama";
const AIVM_ENGINE_ID: &str = "aivm-storage-native";
pub(crate) const MAX_INFERENCE_REQUEST_ID_BYTES: usize = 128;
pub(crate) const MAX_INFERENCE_MESSAGES: usize = 32;
pub(crate) const MAX_INFERENCE_MESSAGE_BYTES: usize = 256 * 1024;
pub(crate) const MAX_INFERENCE_TOTAL_MESSAGE_BYTES: usize = 512 * 1024;
pub(crate) const MAX_INFERENCE_CONTEXT_TOKENS: u32 = 65_536;
pub(crate) const MAX_INFERENCE_OUTPUT_TOKENS: u32 = 32_768;
type OllamaChatParts = (String, String, Option<Vec<(String, String)>>);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextBackend {
    Ollama,
    AivmLoopback,
}

impl std::fmt::Display for TextBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ollama => write!(f, "ollama"),
            Self::AivmLoopback => write!(f, "aivm_loopback"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceTask {
    Reasoner,
}

/// Trusted inference-time reasoning policy. This value is selected by PrismOS
/// orchestration, never parsed from user, project, or retrieved text.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThinkingMode {
    /// Normal interactive work: avoid optional reasoning overhead where the
    /// admitted model/API supports doing so.
    #[default]
    Standard,
    /// Bounded planner, judge, or analysis work that explicitly requests the
    /// model's supported reasoning mode.
    Deliberate,
}

/// Requested shape of the model's visible response. This is a trusted
/// control-plane value, never inferred from prompt text. Ollama's JSON mode is
/// used for artifact specifications so a missing bracket cannot escape into
/// the renderer-facing contract.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseFormat {
    #[default]
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceTarget {
    pub backend: TextBackend,
    pub model_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceLimits {
    pub context_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub request_id: String,
    pub task: InferenceTask,
    /// Trusted control-plane input. `serde(default)` keeps older serialized test
    /// fixtures compatible without allowing message text to select the mode.
    #[serde(default)]
    pub thinking_mode: ThinkingMode,
    /// Defaults to plain text for backward-compatible serialized requests.
    #[serde(default)]
    pub response_format: ResponseFormat,
    pub target: InferenceTarget,
    pub messages: Vec<InferenceMessage>,
    pub limits: InferenceLimits,
    pub local_only: bool,
}

/// Route of the PrismOS client connection only. A loopback hop does not attest
/// what the receiving daemon does after accepting the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientRoute {
    /// Existing Ollama URL/client behavior; intended local, but redirects,
    /// proxies, DNS resolution, and daemon behavior are not attested here.
    UnverifiedLocalEndpoint,
    /// Fixed numeric loopback with redirect/proxy protections applied.
    VerifiedLoopback,
    NonLocal,
}

/// End-to-end execution route claimed by an authenticated engine receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionRoute {
    DeviceLocal,
    NonLocal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    Stop,
    Length,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionIdentity {
    pub backend: TextBackend,
    pub engine_id: String,
    /// Runtime build/version identity, when the selected engine can attest it.
    pub runtime_id: Option<String>,
    pub model_id: String,
    /// True only when an authenticated engine receipt binds these exact fields.
    pub identity_attested: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceReceipt {
    pub receipt_id: String,
    pub receipt_digest: String,
    pub request_id: String,
    pub engine_id: String,
    pub runtime_id: String,
    pub model_id: String,
    pub finish_reason: FinishReason,
    pub execution_route: ExecutionRoute,
    pub local_only: bool,
    pub egress_bytes: u64,
    /// Set only after the bridge's future authenticator verifies this receipt.
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceResult {
    pub request_id: String,
    pub text: String,
    pub requested: InferenceTarget,
    pub actual: ExecutionIdentity,
    /// Observed PrismOS-to-daemon transport, not an end-to-end offline claim.
    pub client_route: ClientRoute,
    /// Echo of the policy placed on the request.
    pub local_only_requested: bool,
    /// True only when the execution receipt attests device-local zero egress.
    pub backend_offline_attested: bool,
    pub duration_ms: u64,
    /// None when the compatibility backend does not return a trustworthy reason.
    pub finish_reason: Option<FinishReason>,
    pub receipt: Option<InferenceReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InferenceMetadata {
    pub request_id: String,
    pub requested: InferenceTarget,
    pub actual: ExecutionIdentity,
    pub client_route: ClientRoute,
    pub local_only_requested: bool,
    pub backend_offline_attested: bool,
    pub duration_ms: u64,
    pub finish_reason: Option<FinishReason>,
    pub receipt: Option<InferenceReceipt>,
}

impl InferenceResult {
    pub fn metadata(&self) -> InferenceMetadata {
        InferenceMetadata {
            request_id: self.request_id.clone(),
            requested: self.requested.clone(),
            actual: self.actual.clone(),
            client_route: self.client_route,
            local_only_requested: self.local_only_requested,
            backend_offline_attested: self.backend_offline_attested,
            duration_ms: self.duration_ms,
            finish_reason: self.finish_reason,
            receipt: self.receipt.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InferenceError {
    #[error("local inference backend {backend} is unavailable for request {request_id}: {detail}")]
    Unavailable {
        request_id: String,
        backend: TextBackend,
        detail: String,
    },
    #[error("local inference admission failed for request {request_id}: {detail}")]
    Admission { request_id: String, detail: String },
    #[error("local-only policy rejected request {request_id}: {detail}")]
    Policy { request_id: String, detail: String },
    #[error("inference identity or receipt integrity failed for request {request_id}: {detail}")]
    Integrity { request_id: String, detail: String },
    #[error("local inference timed out for request {request_id}")]
    Timeout { request_id: String },
    #[error("local inference was cancelled for request {request_id}")]
    Cancelled { request_id: String },
    #[error("local inference protocol failed for request {request_id}: {detail}")]
    Protocol { request_id: String, detail: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InferenceFailureKind {
    Unavailable,
    Admission,
    Policy,
    Integrity,
    Timeout,
    Cancelled,
    Protocol,
}

/// Stable command-boundary failure envelope. Current inference failures are
/// deliberately non-retryable: the repository has correlation IDs, but no
/// durable deduplication or exactly-once journal yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InferenceCommandFailure {
    pub schema_version: u32,
    pub kind: InferenceFailureKind,
    pub backend: TextBackend,
    pub request_id: String,
    pub retryable: bool,
    pub message: String,
}

impl InferenceError {
    fn request_id(&self) -> &str {
        match self {
            Self::Unavailable { request_id, .. }
            | Self::Admission { request_id, .. }
            | Self::Policy { request_id, .. }
            | Self::Integrity { request_id, .. }
            | Self::Timeout { request_id }
            | Self::Cancelled { request_id }
            | Self::Protocol { request_id, .. } => request_id,
        }
    }

    fn failure_kind(&self) -> InferenceFailureKind {
        match self {
            Self::Unavailable { .. } => InferenceFailureKind::Unavailable,
            Self::Admission { .. } => InferenceFailureKind::Admission,
            Self::Policy { .. } => InferenceFailureKind::Policy,
            Self::Integrity { .. } => InferenceFailureKind::Integrity,
            Self::Timeout { .. } => InferenceFailureKind::Timeout,
            Self::Cancelled { .. } => InferenceFailureKind::Cancelled,
            Self::Protocol { .. } => InferenceFailureKind::Protocol,
        }
    }

    pub(crate) fn command_failure(&self, selected_backend: TextBackend) -> InferenceCommandFailure {
        let backend = match self {
            Self::Unavailable { backend, .. } => *backend,
            _ => selected_backend,
        };
        InferenceCommandFailure {
            schema_version: 1,
            kind: self.failure_kind(),
            backend,
            request_id: self.request_id().to_string(),
            retryable: false,
            message: self.to_string(),
        }
    }

    pub(crate) fn command_failure_json(&self, selected_backend: TextBackend) -> String {
        serde_json::to_string(&self.command_failure(selected_backend))
            .expect("bounded inference command failure is serializable")
    }
}

pub type BridgeFuture<'a> =
    Pin<Box<dyn Future<Output = Result<InferenceResult, InferenceError>> + Send + 'a>>;

/// Injectable interface used at the Reasoner seam. Tests provide a fake bridge;
/// production uses [`InferenceBridge`].
pub trait TextInferenceBridge: Send + Sync {
    fn generate<'a>(&'a self, request: InferenceRequest) -> BridgeFuture<'a>;
}

/// Production dispatcher. Its default is intentionally and permanently Ollama
/// until an explicit, separately reviewed product setting is introduced.
#[derive(Clone)]
pub struct InferenceBridge {
    backend: TextBackend,
    /// Test-only local companion injection. This field and its constructor do
    /// not exist in production builds, so the native product lane remains
    /// unavailable until a separately reviewed companion is implemented.
    #[cfg(test)]
    native_companion: Option<Arc<dyn TextInferenceBridge>>,
}

impl Default for InferenceBridge {
    fn default() -> Self {
        Self {
            backend: TextBackend::Ollama,
            #[cfg(test)]
            native_companion: None,
        }
    }
}

impl InferenceBridge {
    #[cfg(test)]
    fn for_test(backend: TextBackend) -> Self {
        Self {
            backend,
            native_companion: None,
        }
    }

    /// Injects a deterministic fixture into the shared `generate` method.
    /// Direct unit tests use this path; it does not traverse Tauri, the
    /// Refractive workflow, a transport, or a non-test production artifact.
    #[cfg(test)]
    pub(crate) fn for_test_with_native_companion(
        native_companion: Arc<dyn TextInferenceBridge>,
    ) -> Self {
        Self {
            backend: TextBackend::AivmLoopback,
            native_companion: Some(native_companion),
        }
    }
}

impl TextInferenceBridge for InferenceBridge {
    fn generate<'a>(&'a self, request: InferenceRequest) -> BridgeFuture<'a> {
        Box::pin(async move {
            validate_request(&request)?;

            if request.target.backend != self.backend {
                return Err(InferenceError::Policy {
                    request_id: request.request_id,
                    detail: "requested backend does not match the admitted bridge backend".into(),
                });
            }

            match self.backend {
                TextBackend::Ollama => generate_with_ollama(request).await,
                TextBackend::AivmLoopback => {
                    #[cfg(test)]
                    if let Some(companion) = &self.native_companion {
                        let result = companion.generate(request.clone()).await?;
                        validate_result(&request, &result)?;
                        return Ok(result);
                    }

                    Err(InferenceError::Unavailable {
                        request_id: request.request_id,
                        backend: TextBackend::AivmLoopback,
                        detail: "storage-native inference is default-off and has no production-qualified companion runtime".into(),
                    })
                }
            }
        })
    }
}

pub(crate) fn validate_request_id(request_id: &str) -> Result<(), &'static str> {
    if request_id.is_empty() || request_id.len() > MAX_INFERENCE_REQUEST_ID_BYTES {
        return Err("request_id must contain 1..=128 bytes");
    }
    if !request_id.bytes().enumerate().all(|(index, byte)| {
        byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
    }) {
        return Err(
            "request_id must start with an ASCII letter or digit and contain only letters, digits, '.', '_', ':', or '-'",
        );
    }
    Ok(())
}

pub(crate) fn validate_request(request: &InferenceRequest) -> Result<(), InferenceError> {
    if let Err(detail) = validate_request_id(&request.request_id) {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: detail.into(),
        });
    }
    let model_id = request.target.model_id.as_str();
    let valid_model_id = !model_id.is_empty()
        && model_id.len() <= 256
        && model_id.trim() == model_id
        && !model_id.contains("..")
        && model_id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric()
                || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'/' | b'-' | b'@'))
        });
    if !valid_model_id {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "model_id must contain 1..=256 safe ASCII identifier bytes".into(),
        });
    }
    if !request.local_only {
        return Err(InferenceError::Policy {
            request_id: request.request_id.clone(),
            detail: "PrismOS Reasoner requests must set local_only=true".into(),
        });
    }
    if !(512..=MAX_INFERENCE_CONTEXT_TOKENS).contains(&request.limits.context_tokens)
        || !(1..=MAX_INFERENCE_OUTPUT_TOKENS).contains(&request.limits.output_tokens)
        || request.limits.output_tokens > request.limits.context_tokens
    {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "invalid context or output token limit".into(),
        });
    }
    if request.messages.is_empty() || request.messages.len() > MAX_INFERENCE_MESSAGES {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "inference message count is outside the supported bounds".into(),
        });
    }
    let mut total_message_bytes = 0_usize;
    for message in &request.messages {
        if message.content.trim().is_empty() || message.content.len() > MAX_INFERENCE_MESSAGE_BYTES
        {
            return Err(InferenceError::Protocol {
                request_id: request.request_id.clone(),
                detail: "inference message content is blank or exceeds its byte limit".into(),
            });
        }
        total_message_bytes = total_message_bytes
            .checked_add(message.content.len())
            .ok_or_else(|| InferenceError::Protocol {
                request_id: request.request_id.clone(),
                detail: "inference message size overflow".into(),
            })?;
        if total_message_bytes > MAX_INFERENCE_TOTAL_MESSAGE_BYTES {
            return Err(InferenceError::Protocol {
                request_id: request.request_id.clone(),
                detail: "inference messages exceed the total byte limit".into(),
            });
        }
    }
    Ok(())
}

/// Enforces exact target/result identity and the local-only receipt invariant.
/// This is public within the crate so the Reasoner validates fake and future
/// bridge implementations through the same gate as the production adapter.
pub(crate) fn validate_result(
    request: &InferenceRequest,
    result: &InferenceResult,
) -> Result<(), InferenceError> {
    let integrity = |detail: &str| InferenceError::Integrity {
        request_id: request.request_id.clone(),
        detail: detail.to_string(),
    };

    if result.request_id != request.request_id {
        return Err(integrity("response request_id does not match the request"));
    }
    if result.requested != request.target {
        return Err(integrity(
            "response requested target does not match the request",
        ));
    }
    if result.actual.backend != request.target.backend {
        return Err(integrity(
            "actual backend differs from the requested backend",
        ));
    }
    if result.actual.model_id != request.target.model_id {
        return Err(integrity(
            "actual model differs from the exact requested model",
        ));
    }

    let expected_engine = match request.target.backend {
        TextBackend::Ollama => OLLAMA_ENGINE_ID,
        TextBackend::AivmLoopback => AIVM_ENGINE_ID,
    };
    if result.actual.engine_id != expected_engine {
        return Err(integrity(
            "actual engine identity is not the admitted engine",
        ));
    }
    if request.local_only && !result.local_only_requested {
        return Err(InferenceError::Policy {
            request_id: request.request_id.clone(),
            detail: "completion dropped the request's local-only policy".into(),
        });
    }
    let expected_client_route = match request.target.backend {
        TextBackend::Ollama => ClientRoute::UnverifiedLocalEndpoint,
        TextBackend::AivmLoopback => ClientRoute::VerifiedLoopback,
    };
    if result.client_route != expected_client_route {
        return Err(InferenceError::Policy {
            request_id: request.request_id.clone(),
            detail: "client transport does not match the admitted backend route".into(),
        });
    }
    if result.text.trim().is_empty() {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "successful completion contains no text".into(),
        });
    }

    if let Some(receipt) = &result.receipt {
        if receipt.receipt_id.trim().is_empty()
            || receipt.receipt_digest.trim().is_empty()
            || !receipt.verified
        {
            return Err(integrity(
                "receipt identity/digest is empty or receipt verification is absent",
            ));
        }
        if receipt.request_id != result.request_id
            || receipt.engine_id != result.actual.engine_id
            || result.actual.runtime_id.as_deref() != Some(receipt.runtime_id.as_str())
            || receipt.model_id != result.actual.model_id
            || result.finish_reason != Some(receipt.finish_reason)
        {
            return Err(integrity(
                "receipt is not bound to the actual execution identity",
            ));
        }
        if request.local_only
            && (!receipt.local_only
                || receipt.execution_route != ExecutionRoute::DeviceLocal
                || receipt.egress_bytes != 0)
        {
            return Err(InferenceError::Policy {
                request_id: request.request_id.clone(),
                detail: "receipt reports a non-local route or nonzero egress".into(),
            });
        }
        if !result.backend_offline_attested || !result.actual.identity_attested {
            return Err(integrity(
                "receipt-backed execution must mark offline and identity attestation",
            ));
        }
    } else if request.target.backend == TextBackend::AivmLoopback {
        return Err(integrity(
            "storage-native completion is missing its required execution receipt",
        ));
    } else if result.backend_offline_attested || result.actual.identity_attested {
        return Err(integrity(
            "unreceipted compatibility execution cannot claim offline or identity attestation",
        ));
    }

    if request.target.backend == TextBackend::AivmLoopback && result.finish_reason.is_none() {
        return Err(integrity(
            "storage-native completion is missing its terminal finish reason",
        ));
    }

    Ok(())
}

async fn generate_with_ollama(
    request: InferenceRequest,
) -> Result<InferenceResult, InferenceError> {
    let (system_prompt, user_content, few_shots) = ollama_chat_parts(&request)?;
    let start = Instant::now();
    let text = crate::ollama_bridge::chat_with_limits(
        &request.target.model_id,
        &system_prompt,
        &user_content,
        None,
        None,
        few_shots,
        request.limits.context_tokens,
        request.limits.output_tokens,
        request.thinking_mode,
        request.response_format,
    )
    .await
    .map_err(|error| classify_ollama_error(&request.request_id, error))?;

    let result = InferenceResult {
        request_id: request.request_id.clone(),
        text,
        requested: request.target.clone(),
        actual: ExecutionIdentity {
            backend: TextBackend::Ollama,
            engine_id: OLLAMA_ENGINE_ID.into(),
            // The compatibility endpoint does not currently attest a build ID.
            runtime_id: None,
            model_id: request.target.model_id.clone(),
            identity_attested: false,
        },
        client_route: ClientRoute::UnverifiedLocalEndpoint,
        local_only_requested: true,
        // The existing local endpoint is unverified. Ollama supplies no authenticated
        // client-route/runtime/model/egress receipt through this compatibility call.
        backend_offline_attested: false,
        duration_ms: start.elapsed().as_millis() as u64,
        finish_reason: None,
        // Ollama does not supply an execution receipt. Do not fabricate one.
        receipt: None,
    };
    validate_result(&request, &result)?;
    Ok(result)
}

fn ollama_chat_parts(request: &InferenceRequest) -> Result<OllamaChatParts, InferenceError> {
    let mut index = 0;
    let system_prompt = if request.messages.first().map(|m| m.role) == Some(MessageRole::System) {
        index = 1;
        request.messages[0].content.clone()
    } else {
        String::new()
    };

    let Some(last) = request.messages.last() else {
        unreachable!("validate_request rejects an empty message list")
    };
    if index >= request.messages.len() || last.role != MessageRole::User {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "Reasoner message sequence must end with a user message".into(),
        });
    }

    let user_content = last.content.clone();
    let examples = &request.messages[index..request.messages.len() - 1];
    let mut pairs = examples.chunks_exact(2);
    if !pairs.remainder().is_empty() {
        return Err(InferenceError::Protocol {
            request_id: request.request_id.clone(),
            detail: "few-shot messages must be user/assistant pairs".into(),
        });
    }

    let mut few_shots = Vec::with_capacity(examples.len() / 2);
    for pair in &mut pairs {
        if pair[0].role != MessageRole::User || pair[1].role != MessageRole::Assistant {
            return Err(InferenceError::Protocol {
                request_id: request.request_id.clone(),
                detail: "few-shot messages must preserve user/assistant role order".into(),
            });
        }
        few_shots.push((pair[0].content.clone(), pair[1].content.clone()));
    }

    Ok((
        system_prompt,
        user_content,
        (!few_shots.is_empty()).then_some(few_shots),
    ))
}

fn classify_ollama_error(
    request_id: &str,
    error: Box<dyn std::error::Error + Send + Sync>,
) -> InferenceError {
    if let Some(error) = error.downcast_ref::<reqwest::Error>() {
        if error.is_timeout() {
            return InferenceError::Timeout {
                request_id: request_id.to_string(),
            };
        }
        if error.is_decode() || error.is_body() {
            return InferenceError::Protocol {
                request_id: request_id.to_string(),
                detail: error.to_string(),
            };
        }
    }

    InferenceError::Unavailable {
        request_id: request_id.to_string(),
        backend: TextBackend::Ollama,
        detail: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(backend: TextBackend) -> InferenceRequest {
        InferenceRequest {
            request_id: "request-1".into(),
            task: InferenceTask::Reasoner,
            thinking_mode: ThinkingMode::Standard,
            response_format: ResponseFormat::Text,
            target: InferenceTarget {
                backend,
                model_id: "exact-model:1".into(),
            },
            messages: vec![
                InferenceMessage {
                    role: MessageRole::System,
                    content: "system".into(),
                },
                InferenceMessage {
                    role: MessageRole::User,
                    content: "example question".into(),
                },
                InferenceMessage {
                    role: MessageRole::Assistant,
                    content: "example answer".into(),
                },
                InferenceMessage {
                    role: MessageRole::User,
                    content: "actual question".into(),
                },
            ],
            limits: InferenceLimits {
                context_tokens: 4096,
                output_tokens: 512,
            },
            local_only: true,
        }
    }

    #[test]
    fn default_bridge_keeps_ollama_as_the_compatibility_lane() {
        assert_eq!(InferenceBridge::default().backend, TextBackend::Ollama);
    }

    #[test]
    fn older_request_json_defaults_to_standard_thinking_mode() {
        let request = request(TextBackend::Ollama);
        let mut value = serde_json::to_value(request).unwrap();
        value.as_object_mut().unwrap().remove("thinking_mode");
        value.as_object_mut().unwrap().remove("response_format");
        let decoded: InferenceRequest = serde_json::from_value(value).unwrap();
        assert_eq!(decoded.thinking_mode, ThinkingMode::Standard);
        assert_eq!(decoded.response_format, ResponseFormat::Text);
    }

    #[test]
    fn request_ids_are_bounded_and_use_the_canonical_ascii_alphabet() {
        assert_eq!(validate_request_id("retry-request_1:reasoner.v1"), Ok(()));
        assert_eq!(
            validate_request_id(&"a".repeat(MAX_INFERENCE_REQUEST_ID_BYTES)),
            Ok(())
        );

        for invalid in [
            String::new(),
            "-starts-with-punctuation".into(),
            "contains/slash".into(),
            "contains space".into(),
            "trailing-newline\n".into(),
            "unicode-λ".into(),
            "a".repeat(MAX_INFERENCE_REQUEST_ID_BYTES + 1),
        ] {
            assert!(
                validate_request_id(&invalid).is_err(),
                "accepted {invalid:?}"
            );
            let mut request = request(TextBackend::Ollama);
            request.request_id = invalid;
            assert!(matches!(
                validate_request(&request),
                Err(InferenceError::Protocol { .. })
            ));
        }
    }

    #[test]
    fn requests_reject_unsafe_models_unbounded_messages_and_token_limits() {
        for model_id in [
            "",
            "../model",
            "model with spaces",
            "model\nname",
            "/absolute",
        ] {
            let mut candidate = request(TextBackend::Ollama);
            candidate.target.model_id = model_id.into();
            assert!(matches!(
                validate_request(&candidate),
                Err(InferenceError::Protocol { .. })
            ));
        }

        let mut too_many = request(TextBackend::Ollama);
        too_many.messages = (0..=MAX_INFERENCE_MESSAGES)
            .map(|_| InferenceMessage {
                role: MessageRole::User,
                content: "bounded".into(),
            })
            .collect();
        assert!(validate_request(&too_many).is_err());

        let mut oversized = request(TextBackend::Ollama);
        oversized.messages[0].content = "x".repeat(MAX_INFERENCE_MESSAGE_BYTES + 1);
        assert!(validate_request(&oversized).is_err());

        let mut excessive_context = request(TextBackend::Ollama);
        excessive_context.limits.context_tokens = MAX_INFERENCE_CONTEXT_TOKENS + 1;
        assert!(validate_request(&excessive_context).is_err());

        let mut excessive_output = request(TextBackend::Ollama);
        excessive_output.limits.output_tokens = excessive_output.limits.context_tokens + 1;
        assert!(validate_request(&excessive_output).is_err());
    }

    #[tokio::test]
    async fn storage_native_lane_is_default_off_before_any_transport() {
        let bridge = InferenceBridge::for_test(TextBackend::AivmLoopback);
        let error = bridge
            .generate(request(TextBackend::AivmLoopback))
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            InferenceError::Unavailable {
                backend: TextBackend::AivmLoopback,
                ..
            }
        ));
    }

    #[test]
    fn native_failures_cross_the_command_boundary_as_non_retryable_native_errors() {
        let failures = [
            InferenceError::Policy {
                request_id: "native-policy".into(),
                detail: "policy denied".into(),
            },
            InferenceError::Integrity {
                request_id: "native-integrity".into(),
                detail: "receipt mismatch".into(),
            },
            InferenceError::Unavailable {
                request_id: "native-unavailable".into(),
                backend: TextBackend::AivmLoopback,
                detail: "companion absent".into(),
            },
            InferenceError::Cancelled {
                request_id: "native-cancelled".into(),
            },
        ];

        for failure in failures {
            let envelope = failure.command_failure(TextBackend::AivmLoopback);
            assert_eq!(envelope.schema_version, 1);
            assert_eq!(envelope.backend, TextBackend::AivmLoopback);
            assert!(!envelope.retryable);

            let decoded: InferenceCommandFailure =
                serde_json::from_str(&failure.command_failure_json(TextBackend::AivmLoopback))
                    .unwrap();
            assert_eq!(decoded, envelope);
        }
    }

    #[test]
    fn ollama_role_adapter_preserves_few_shot_order() {
        let request = request(TextBackend::Ollama);
        let (system, user, examples) = ollama_chat_parts(&request).unwrap();
        assert_eq!(system, "system");
        assert_eq!(user, "actual question");
        assert_eq!(
            examples,
            Some(vec![("example question".into(), "example answer".into())])
        );
    }

    #[test]
    fn local_only_rejects_nonlocal_completion() {
        let request = request(TextBackend::Ollama);
        let result = InferenceResult {
            request_id: request.request_id.clone(),
            text: "must never be accepted".into(),
            requested: request.target.clone(),
            actual: ExecutionIdentity {
                backend: TextBackend::Ollama,
                engine_id: OLLAMA_ENGINE_ID.into(),
                runtime_id: None,
                model_id: request.target.model_id.clone(),
                identity_attested: false,
            },
            client_route: ClientRoute::NonLocal,
            local_only_requested: false,
            backend_offline_attested: false,
            duration_ms: 1,
            finish_reason: None,
            receipt: None,
        };
        assert!(matches!(
            validate_result(&request, &result),
            Err(InferenceError::Policy { .. })
        ));
    }

    #[test]
    fn exact_model_substitution_is_rejected() {
        let request = request(TextBackend::Ollama);
        let result = InferenceResult {
            request_id: request.request_id.clone(),
            text: "substituted output".into(),
            requested: request.target.clone(),
            actual: ExecutionIdentity {
                backend: TextBackend::Ollama,
                engine_id: OLLAMA_ENGINE_ID.into(),
                runtime_id: None,
                model_id: "different-model:1".into(),
                identity_attested: false,
            },
            client_route: ClientRoute::UnverifiedLocalEndpoint,
            local_only_requested: true,
            backend_offline_attested: false,
            duration_ms: 1,
            finish_reason: None,
            receipt: None,
        };
        assert!(matches!(
            validate_result(&request, &result),
            Err(InferenceError::Integrity { .. })
        ));
    }

    #[test]
    fn unreceipted_ollama_completion_cannot_claim_attestation() {
        let request = request(TextBackend::Ollama);
        let result = InferenceResult {
            request_id: request.request_id.clone(),
            text: "compatibility output".into(),
            requested: request.target.clone(),
            actual: ExecutionIdentity {
                backend: TextBackend::Ollama,
                engine_id: OLLAMA_ENGINE_ID.into(),
                runtime_id: Some("unverified-version".into()),
                model_id: request.target.model_id.clone(),
                identity_attested: true,
            },
            client_route: ClientRoute::UnverifiedLocalEndpoint,
            local_only_requested: true,
            backend_offline_attested: true,
            duration_ms: 1,
            finish_reason: None,
            receipt: None,
        };
        assert!(matches!(
            validate_result(&request, &result),
            Err(InferenceError::Integrity { .. })
        ));
    }

    #[test]
    fn native_receipt_binds_identity_and_rejects_egress() {
        let request = request(TextBackend::AivmLoopback);
        let mut result = InferenceResult {
            request_id: request.request_id.clone(),
            text: "receipted native output".into(),
            requested: request.target.clone(),
            actual: ExecutionIdentity {
                backend: TextBackend::AivmLoopback,
                engine_id: AIVM_ENGINE_ID.into(),
                runtime_id: Some("runtime-build-1".into()),
                model_id: request.target.model_id.clone(),
                identity_attested: true,
            },
            client_route: ClientRoute::VerifiedLoopback,
            local_only_requested: true,
            backend_offline_attested: true,
            duration_ms: 1,
            finish_reason: Some(FinishReason::Stop),
            receipt: Some(InferenceReceipt {
                receipt_id: "receipt-1".into(),
                receipt_digest: "digest-1".into(),
                request_id: request.request_id.clone(),
                engine_id: AIVM_ENGINE_ID.into(),
                runtime_id: "runtime-build-1".into(),
                model_id: request.target.model_id.clone(),
                finish_reason: FinishReason::Stop,
                execution_route: ExecutionRoute::DeviceLocal,
                local_only: true,
                egress_bytes: 1,
                verified: true,
            }),
        };

        assert!(matches!(
            validate_result(&request, &result),
            Err(InferenceError::Policy { .. })
        ));
        result.receipt.as_mut().unwrap().egress_bytes = 0;
        assert_eq!(validate_result(&request, &result), Ok(()));
    }
}
