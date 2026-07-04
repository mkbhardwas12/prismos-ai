// Ollama Bridge — Local LLM Inference Interface
//
// Provides a Rust HTTP client for the Ollama REST API running on localhost.
// All inference stays local — no data leaves the user's machine.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use futures_util::StreamExt;

pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const GENERATE_TIMEOUT: Duration = Duration::from_secs(300); // 5 min — large models (deepseek-r1) on doc analysis need time
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const EMBED_TIMEOUT: Duration = Duration::from_secs(30); // embeddings are ms-fast once the model is warm; 30s covers cold load

/// How long Ollama keeps a model resident in memory after a request. Keeping it
/// warm means follow-up queries skip the multi-second model reload — essential
/// for a snappy daily-driver feel. Override with the `OLLAMA_KEEP_ALIVE` env var
/// (e.g. "60m", "-1" to keep loaded indefinitely, "0" to unload immediately).
const DEFAULT_KEEP_ALIVE: &str = "30m";

/// Resolve the keep-alive window from the environment, falling back to 30 min.
fn keep_alive() -> String {
    std::env::var("OLLAMA_KEEP_ALIVE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_KEEP_ALIVE.to_string())
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
/// Reasoning models (deepseek-r1, qwq, qwen3 thinking) spend output budget on the
/// `<think>` trace BEFORE the answer — give them more headroom so a long deliberation
/// can't get cut off mid-thought and never reach the conclusion.
const REASONING_OUTPUT_TOKENS: u32 = 16384;

/// Context window, env-overridable via `OLLAMA_NUM_CTX`.
fn num_ctx() -> u32 {
    std::env::var("OLLAMA_NUM_CTX")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|n| *n >= 512)
        .unwrap_or(DEFAULT_NUM_CTX)
}

/// Per-model output ceiling: bigger for reasoning models. `OLLAMA_NUM_PREDICT`
/// overrides the floor for every model when set.
fn output_tokens_for(model: &str) -> u32 {
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

/// Hybrid "thinking" models (qwen3 family) emit chain-of-thought into the
/// response by default, which leaks "Okay, the user is asking…" preamble into
/// user-facing answers. They honour an inline `/no_think` directive (the
/// `think:false` request flag is NOT respected by qwen3 on Ollama 0.24).
///
/// Policy: for a thinking-toggle model, append `/no_think` so everyday answers
/// are clean and fast — UNLESS the caller already specified `/think` or
/// `/no_think` (the reasoning lane opts back into thinking by passing `/think`).
fn apply_think_control(model: &str, content: &str) -> String {
    let lower = model.to_lowercase();
    let supports_toggle = lower.contains("qwen3");
    let already_directed = content.contains("/think") || content.contains("/no_think");
    if supports_toggle && !already_directed {
        format!("{} /no_think", content)
    } else {
        content.to_string()
    }
}

// ─── Request / Response Types ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
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
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
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

/// Check if Ollama is running and accessible
pub async fn is_available(base_url: Option<&str>) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();
    match client
        .get(url)
        .timeout(HEALTH_TIMEOUT)
        .send()
        .await
    {
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
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a model-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(num_ctx()),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(model))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt: apply_think_control(model, prompt),
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
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let gen_response: GenerateResponse = response.json().await?;
    Ok(gen_response.response)
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
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();

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

    // User message — the actual question with context.
    // Keep answers clean on hybrid thinking models (qwen3) by default.
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: apply_think_control(model, user_content),
        images,
    });

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
        options: Some(ChatOptions {
            temperature: Some(0.7),                  // Balanced: focused but not robotic
            num_ctx: Some(num_ctx()),                // 16k default — room for docs/code/RAG
            num_predict: Some(output_tokens_for(model)), // 8k, or 16k for reasoning models
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
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let chat_response: ChatResponse = response.json().await?;
    Ok(chat_response.message.content)
}

/// List all locally available models
pub async fn list_models(base_url: Option<&str>) -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/tags", url))
        .timeout(Duration::from_secs(10))
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(vec![]);
    }

    let model_list: ModelList = response.json().await?;
    Ok(model_list.models)
}

// ─── Embeddings — the semantic layer of the Spectrum Graph ─────────────────────
// Runs through the SAME local Ollama daemon as generation: localhost only, so the
// "zero bytes leave the machine" invariant holds. Callers must degrade gracefully
// to keyword retrieval when the embed model isn't pulled or Ollama is down.

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
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let model = embed_model();
    let client = reqwest::Client::new();

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
        let parsed: EmbedResponse = response.json().await?;
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
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama embed error ({}): {} — is the embed model pulled? (`ollama pull {}`)",
            status, body, model
        )
        .into());
    }

    let parsed: LegacyEmbeddingsResponse = response.json().await?;
    if parsed.embedding.is_empty() {
        return Err("Ollama returned an empty embedding".into());
    }
    Ok(parsed.embedding)
}

// ─── Streaming Response Types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct StreamChunk {
    response: String,
    #[serde(default)]
    done: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub token: String,
    pub done: bool,
}

/// Generate a completion with streaming — sends tokens via a callback
/// Pass `images` as base64-encoded strings for multimodal vision models.
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
    let url = base_url.unwrap_or(DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a model-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(num_ctx()),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(model))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt: apply_think_control(model, prompt),
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
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let mut full_response = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        let chunk_bytes = chunk_result?;
        // Ollama sends newline-delimited JSON
        let chunk_str = String::from_utf8_lossy(&chunk_bytes);
        for line in chunk_str.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<StreamChunk>(line) {
                full_response.push_str(&parsed.response);
                on_token(StreamEvent {
                    token: parsed.response,
                    done: parsed.done,
                });
            }
        }
    }

    Ok(full_response)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keep_alive_default() {
        // With no env override, defaults to the constant.
        std::env::remove_var("OLLAMA_KEEP_ALIVE");
        assert_eq!(keep_alive(), DEFAULT_KEEP_ALIVE);
    }

    #[test]
    fn test_think_control_appends_no_think_for_qwen3() {
        let out = apply_think_control("qwen3:30b-a3b", "What is 2+2?");
        assert_eq!(out, "What is 2+2? /no_think");
    }

    #[test]
    fn test_think_control_skips_non_thinking_models() {
        // Non-qwen3 models are untouched.
        assert_eq!(apply_think_control("llama3.3:70b", "hello"), "hello");
        assert_eq!(apply_think_control("qwen2.5-coder:7b", "hello"), "hello");
        assert_eq!(apply_think_control("mistral", "hello"), "hello");
    }

    #[test]
    fn test_think_control_respects_explicit_directive() {
        // Reasoning lane opts into thinking by passing /think — we must not override.
        assert_eq!(
            apply_think_control("qwen3:30b-a3b", "Solve this carefully /think"),
            "Solve this carefully /think"
        );
        // Already /no_think → not doubled.
        assert_eq!(
            apply_think_control("qwen3:30b-a3b", "quick q /no_think"),
            "quick q /no_think"
        );
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
        assert_eq!(output_tokens_for("deepseek-r1:32b"), REASONING_OUTPUT_TOKENS);
        assert_eq!(output_tokens_for("qwq:32b"), REASONING_OUTPUT_TOKENS);
        // Plain chat / code models use the standard ceiling.
        assert_eq!(output_tokens_for("llama3.1:8b"), DEFAULT_OUTPUT_TOKENS);
        assert_eq!(output_tokens_for("qwen2.5-coder:7b"), DEFAULT_OUTPUT_TOKENS);
        assert!(REASONING_OUTPUT_TOKENS > DEFAULT_OUTPUT_TOKENS);

        // An env override raises the ceiling but can't drop a reasoning model below
        // its sensible floor (guards against starving the <think> trace).
        std::env::set_var("OLLAMA_NUM_PREDICT", "2048");
        assert_eq!(output_tokens_for("deepseek-r1:32b"), REASONING_OUTPUT_TOKENS);
        std::env::set_var("OLLAMA_NUM_PREDICT", "20000");
        assert_eq!(output_tokens_for("llama3.1:8b"), 20000);
        std::env::remove_var("OLLAMA_NUM_PREDICT");
    }
}
