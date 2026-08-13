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
///
/// Note: because we send `keep_alive` on every request, this value takes
/// precedence over any `OLLAMA_KEEP_ALIVE` configured on the *daemon* — set the
/// override in PrismOS's environment, not the server's.
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
/// When a model will actually emit a `<think>` trace, that trace spends output
/// budget BEFORE the answer — give it more headroom so a long deliberation
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

/// Context window for a specific call. When the model will emit a thinking
/// trace, trace + answer share the window with the prompt — 16k is not enough
/// for a 16k output budget, so widen to 32k (qwen3 / deepseek-r1 / qwq / gpt-oss
/// all support ≥32k). phi4's trained window is 16k — never over-allocate it.
/// KV-cache cost is why this is per-call: an everyday qwen3 answer with
/// thinking off stays at 16k and doesn't pay ~GBs of cache for headroom it
/// won't use.
fn ctx_for(model: &str, will_think: bool) -> u32 {
    let base = num_ctx();
    if will_think && !model.to_lowercase().contains("phi4") {
        base.max(32768)
    } else {
        base
    }
}

/// Per-call output ceiling: bigger only when a thinking trace will actually be
/// generated. `OLLAMA_NUM_PREDICT` overrides the floor for every model when set.
fn output_tokens_for(will_think: bool) -> u32 {
    let base = if will_think {
        REASONING_OUTPUT_TOKENS
    } else {
        DEFAULT_OUTPUT_TOKENS
    };
    let env = std::env::var("OLLAMA_NUM_PREDICT")
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .filter(|n| *n >= 64);
    // Honor an explicit env override, but never below the call's sensible floor.
    env.map(|n| n.max(base)).unwrap_or(base)
}

// ─── Thinking control ──────────────────────────────────────────────────────────
//
// History, because this changed under us and the old code was wrong on modern
// daemons: qwen3's inline `/no_think` soft switch stopped working on hybrid
// models around Ollama v0.12.3 (ollama/ollama#12575) — appending it to the
// prompt is now an inert token that pollutes the context. The supported control
// is the top-level `think: bool` request field (Ollama ≥ 0.9), and thinking
// content arrives in a separate `thinking` response field, not inline.
//
// Policy (unchanged in spirit): hybrid everyday models (qwen3 chat family)
// default to thinking OFF so answers are clean and fast; dedicated reasoning
// models (deepseek-r1, qwq, gpt-oss, …) are left alone — thinking is their
// whole point, and Ollama already separates the trace out of `response`.
// Callers can still write `/think` or `/no_think` in the content: we translate
// the directive to the API flag and strip it from the prompt.
//
// Older daemons (or model tags that reject the flag) return 4xx — the request
// layer retries once without `think`, so behavior degrades gracefully instead
// of erroring.

/// Hybrid models whose thinking should default OFF for everyday answers.
/// qwen3-coder (and any *-coder tag) is a non-thinking family — excluded.
fn is_hybrid_thinking(model: &str) -> bool {
    let m = model.to_lowercase();
    (m.contains("qwen3") && !m.contains("coder")) || m.contains("smollm3")
}

/// Resolve the `think` flag for this call and return the cleaned content.
/// `/think` / `/no_think` directives in the content win, and are removed from
/// what we send — the model shouldn't see switch syntax it no longer honours.
fn resolve_think(model: &str, content: &str) -> (Option<bool>, String) {
    let explicit_no = content.contains("/no_think");
    let without_no = content.replace("/no_think", "");
    let explicit_yes = without_no.contains("/think");
    let flag = if explicit_no {
        Some(false)
    } else if explicit_yes {
        Some(true)
    } else if is_hybrid_thinking(model) {
        Some(false)
    } else {
        None // dedicated reasoners & plain chat models: daemon default
    };
    if explicit_no || explicit_yes {
        (flag, without_no.replace("/think", "").trim().to_string())
    } else {
        (flag, content.to_string())
    }
}

/// Dedicated reasoning models: thinking is their default mode and their whole
/// point — we never suppress it, and we budget for the trace. Deliberately
/// narrower than the router's `is_reasoning_model` (which also matches hybrid
/// qwen3 tags, including non-thinking ones like qwen3-coder).
fn is_dedicated_reasoner(model: &str) -> bool {
    let m = model.to_lowercase();
    ["deepseek-r1", "qwq", "gpt-oss", "magistral", "openthinker", "marco-o1", "exaone-deep", "smallthinker"]
        .iter()
        .any(|p| m.contains(p))
}

/// Whether this call will actually produce a thinking trace (drives budgets).
fn will_think(model: &str, think: Option<bool>) -> bool {
    match think {
        Some(b) => b,
        // No explicit flag: only dedicated reasoners think by default.
        None => is_dedicated_reasoner(model),
    }
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Remove inline `<think>…</think>` blocks from a complete response. Modern
/// Ollama separates thinking into its own field, so this is defense-in-depth
/// for older daemons and models that leak the tags into `response`/`content`.
/// An unclosed `<think>` (stream cut mid-thought) drops the dangling block.
fn strip_think_blocks(s: &str) -> String {
    if !s.contains(THINK_OPEN) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    loop {
        match rest.find(THINK_OPEN) {
            None => {
                out.push_str(rest);
                break;
            }
            Some(start) => {
                out.push_str(&rest[..start]);
                let after = &rest[start + THINK_OPEN.len()..];
                match after.find(THINK_CLOSE) {
                    Some(end) => rest = &after[end + THINK_CLOSE.len()..],
                    None => break, // unclosed block → drop the remainder
                }
            }
        }
    }
    out.trim_start().to_string()
}

/// Incremental `<think>` filter for token streams: emits only display-safe
/// text, holding back any tail that could be the start of a tag split across
/// token boundaries.
struct ThinkFilter {
    in_think: bool,
    pending: String,
}

impl ThinkFilter {
    fn new() -> Self {
        Self { in_think: false, pending: String::new() }
    }

    /// Feed a raw token; returns the text safe to display now.
    fn push(&mut self, token: &str) -> String {
        self.pending.push_str(token);
        let mut out = String::new();
        loop {
            if self.in_think {
                if let Some(pos) = self.pending.find(THINK_CLOSE) {
                    self.pending.drain(..pos + THINK_CLOSE.len());
                    self.in_think = false;
                } else {
                    let keep = partial_suffix_len(&self.pending, THINK_CLOSE);
                    let drop_to = self.pending.len() - keep;
                    self.pending.drain(..drop_to);
                    return out;
                }
            } else if let Some(pos) = self.pending.find(THINK_OPEN) {
                out.push_str(&self.pending[..pos]);
                self.pending.drain(..pos + THINK_OPEN.len());
                self.in_think = true;
            } else {
                let keep = partial_suffix_len(&self.pending, THINK_OPEN);
                let emit_to = self.pending.len() - keep;
                out.push_str(&self.pending[..emit_to]);
                self.pending.drain(..emit_to);
                return out;
            }
        }
    }

    /// End of stream: flush held-back text (it never became a tag). Text
    /// inside an unclosed think block is dropped.
    fn finish(&mut self) -> String {
        if self.in_think {
            self.pending.clear();
            return String::new();
        }
        std::mem::take(&mut self.pending)
    }
}

/// Length of the longest suffix of `s` that is a (proper) prefix of `tag`.
fn partial_suffix_len(s: &str, tag: &str) -> usize {
    let max = tag.len().saturating_sub(1).min(s.len());
    for k in (1..=max).rev() {
        if s.is_char_boundary(s.len() - k) && s.ends_with(&tag[..k]) {
            return k;
        }
    }
    0
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
    /// Thinking toggle (Ollama ≥ 0.9). Omitted entirely for models where we
    /// have no opinion — see the Thinking control section above.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<bool>,
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
    /// Thinking toggle (Ollama ≥ 0.9) — see the Thinking control section.
    #[serde(skip_serializing_if = "Option::is_none")]
    think: Option<bool>,
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
    /// "stop" on normal completion, "length" when num_predict was hit.
    #[serde(default)]
    #[allow(dead_code)]
    done_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    #[allow(dead_code)]
    role: String,
    content: String,
    /// Thinking trace, separated out by Ollama ≥ 0.9 for thinking models.
    /// Deliberately dropped — never shown as answer text.
    #[serde(default)]
    #[allow(dead_code)]
    thinking: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
    #[allow(dead_code)]
    done: bool,
    #[serde(default)]
    #[allow(dead_code)]
    done_reason: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    thinking: Option<String>,
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

// ─── Request plumbing ──────────────────────────────────────────────────────────

/// POST a JSON body; if the daemon rejects the `think` field (older Ollama, or
/// a model tag that doesn't support toggling), retry once without it so we
/// degrade to the daemon's default instead of failing the whole call.
async fn post_with_think_fallback(
    client: &reqwest::Client,
    url: &str,
    mut body: serde_json::Value,
    timeout: Duration,
) -> Result<reqwest::Response, Box<dyn std::error::Error + Send + Sync>> {
    let had_think = body.get("think").is_some();
    let resp = client.post(url).json(&body).timeout(timeout).send().await?;
    if resp.status().is_success() || !had_think {
        return Ok(resp);
    }
    let status = resp.status().as_u16();
    if (400..=422).contains(&status) {
        if let Some(obj) = body.as_object_mut() {
            obj.remove("think");
        }
        let retry = client.post(url).json(&body).timeout(timeout).send().await?;
        return Ok(retry);
    }
    Ok(resp)
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
    let (think, prompt) = resolve_think(model, prompt);
    let thinking = will_think(model, think);
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a think-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(ctx_for(model, thinking)),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(thinking))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt,
        stream: false,
        options,
        images,
        keep_alive: Some(keep_alive()),
        think,
    };

    let body = serde_json::to_value(&request)?;
    let response =
        post_with_think_fallback(&client, &format!("{}/api/generate", url), body, GENERATE_TIMEOUT)
            .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let gen_response: GenerateResponse = response.json().await?;
    Ok(strip_think_blocks(&gen_response.response))
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

    // User message — the actual question with context. Thinking is controlled
    // via the `think` request flag; any inline directive is translated+stripped.
    let (think, user_content) = resolve_think(model, user_content);
    let thinking = will_think(model, think);
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: user_content,
        images,
    });

    let request = ChatRequest {
        model: model.to_string(),
        messages,
        stream: false,
        options: Some(ChatOptions {
            temperature: Some(0.7),                       // Balanced: focused but not robotic
            num_ctx: Some(ctx_for(model, thinking)),      // 16k default; 32k when a trace will run
            num_predict: Some(output_tokens_for(thinking)), // 8k, or 16k when thinking
        }),
        keep_alive: Some(keep_alive()),
        think,
    };

    let body = serde_json::to_value(&request)?;
    let response =
        post_with_think_fallback(&client, &format!("{}/api/chat", url), body, GENERATE_TIMEOUT)
            .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let chat_response: ChatResponse = response.json().await?;
    Ok(strip_think_blocks(&chat_response.message.content))
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
    #[serde(default)]
    response: String,
    #[serde(default)]
    done: bool,
    /// "stop" normally; "length" when the num_predict ceiling was hit.
    #[serde(default)]
    done_reason: Option<String>,
    /// Separated thinking trace (Ollama ≥ 0.9) — never displayed.
    #[serde(default)]
    #[allow(dead_code)]
    thinking: Option<String>,
    /// Mid-stream error line from the daemon.
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamEvent {
    pub token: String,
    pub done: bool,
    /// True on the final event when the response hit the token ceiling
    /// (done_reason == "length") — the answer is incomplete, and the UI can
    /// say so instead of presenting a silently truncated reply.
    #[serde(default)]
    pub truncated: bool,
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
    let (think, prompt) = resolve_think(model, prompt);
    let thinking = will_think(model, think);
    // Always set num_ctx (Ollama's default is far too small for documents); honor
    // the caller's max_tokens (the UI "Response Length" slider) for the response,
    // falling back to a think-aware budget when unset.
    let options = Some(GenerateOptions {
        num_ctx: Some(ctx_for(model, thinking)),
        num_predict: Some(max_tokens.unwrap_or_else(|| output_tokens_for(thinking))),
    });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt,
        stream: true,
        options,
        images,
        keep_alive: Some(keep_alive()),
        think,
    };

    let body = serde_json::to_value(&request)?;
    let response =
        post_with_think_fallback(&client, &format!("{}/api/generate", url), body, GENERATE_TIMEOUT)
            .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({}): {}", status, body).into());
    }

    let mut full_response = String::new();
    let mut stream = response.bytes_stream();
    // NDJSON lines can split across network chunks (and multi-byte UTF-8 can
    // split across reads) — buffer bytes and only parse complete lines. The
    // old per-chunk parse silently dropped any line that straddled a chunk
    // boundary, losing tokens mid-answer.
    let mut buf: Vec<u8> = Vec::new();
    let mut filter = ThinkFilter::new();
    let mut truncated = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk_bytes = chunk_result?;
        buf.extend_from_slice(&chunk_bytes);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = &line[..line.len() - 1];
            if line.iter().all(|b| b.is_ascii_whitespace()) {
                continue;
            }
            let parsed: StreamChunk = match serde_json::from_slice(line) {
                Ok(p) => p,
                Err(_) => continue, // tolerate unknown control lines
            };
            if let Some(err) = parsed.error {
                return Err(format!("Ollama stream error: {}", err).into());
            }
            if parsed.done_reason.as_deref() == Some("length") {
                truncated = true;
            }
            if !parsed.response.is_empty() {
                let clean = filter.push(&parsed.response);
                if !clean.is_empty() {
                    full_response.push_str(&clean);
                    on_token(StreamEvent { token: clean, done: false, truncated: false });
                }
            }
            if parsed.done {
                let tail = filter.finish();
                if !tail.is_empty() {
                    full_response.push_str(&tail);
                    on_token(StreamEvent { token: tail, done: false, truncated: false });
                }
                on_token(StreamEvent { token: String::new(), done: true, truncated });
                return Ok(full_response);
            }
        }
    }

    // Stream ended without a done marker (connection dropped) — flush and close.
    let tail = filter.finish();
    if !tail.is_empty() {
        full_response.push_str(&tail);
        on_token(StreamEvent { token: tail, done: false, truncated: false });
    }
    on_token(StreamEvent { token: String::new(), done: true, truncated });
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

    // ── thinking control ──

    #[test]
    fn test_resolve_think_defaults_off_for_hybrid_qwen3() {
        let (flag, content) = resolve_think("qwen3:30b-a3b", "What is 2+2?");
        assert_eq!(flag, Some(false));
        assert_eq!(content, "What is 2+2?"); // prompt no longer polluted
    }

    #[test]
    fn test_resolve_think_leaves_dedicated_reasoners_alone() {
        // deepseek-r1 / qwq think by default — that's their point. No flag sent.
        assert_eq!(resolve_think("deepseek-r1:32b", "hard problem").0, None);
        assert_eq!(resolve_think("qwq:latest", "hard problem").0, None);
        // Plain chat models: no opinion either.
        assert_eq!(resolve_think("llama3.1:8b", "hello").0, None);
        assert_eq!(resolve_think("mistral", "hello").0, None);
    }

    #[test]
    fn test_resolve_think_excludes_qwen3_coder() {
        // qwen3-coder is a non-thinking family — no flag, no risk of a 4xx.
        assert_eq!(resolve_think("qwen3-coder:30b", "write a parser").0, None);
    }

    #[test]
    fn test_resolve_think_translates_directives() {
        // /think opts in and is stripped from the content.
        let (flag, content) = resolve_think("qwen3:30b-a3b", "Solve this carefully /think");
        assert_eq!(flag, Some(true));
        assert_eq!(content, "Solve this carefully");
        // /no_think is honoured and stripped.
        let (flag, content) = resolve_think("qwen3:30b-a3b", "quick q /no_think");
        assert_eq!(flag, Some(false));
        assert_eq!(content, "quick q");
        // Directives work on non-hybrid models too.
        let (flag, _) = resolve_think("deepseek-r1:8b", "no trace please /no_think");
        assert_eq!(flag, Some(false));
    }

    #[test]
    fn test_will_think() {
        assert!(!will_think("qwen3:4b", Some(false)));
        assert!(will_think("qwen3:4b", Some(true)));
        assert!(will_think("deepseek-r1:32b", None)); // dedicated reasoner default
        assert!(will_think("gpt-oss:20b", None));
        assert!(!will_think("llama3.1:8b", None));
        // qwen3-coder matches the router's reasoning pattern but must NOT be
        // budgeted for a trace it will never produce.
        assert!(!will_think("qwen3-coder:30b", None));
    }

    // ── budgets ──

    #[test]
    fn test_num_ctx_default() {
        std::env::remove_var("OLLAMA_NUM_CTX");
        assert_eq!(num_ctx(), DEFAULT_NUM_CTX);
        assert_eq!(num_ctx(), 16384);
    }

    #[test]
    fn test_ctx_widens_only_when_thinking() {
        std::env::remove_var("OLLAMA_NUM_CTX");
        // Everyday qwen3 answer with thinking off: no KV-cache tax.
        assert_eq!(ctx_for("qwen3:4b", false), 16384);
        // A real trace needs room for trace + answer + prompt.
        assert_eq!(ctx_for("deepseek-r1:32b", true), 32768);
        assert_eq!(ctx_for("qwen3:30b-a3b", true), 32768);
        // phi4's trained window is 16k — never over-allocate it.
        assert_eq!(ctx_for("phi4:latest", true), 16384);
    }

    #[test]
    fn test_output_tokens_budgets() {
        // Single test owns OLLAMA_NUM_PREDICT end-to-end so parallel tests can't
        // race on the shared env var.
        std::env::remove_var("OLLAMA_NUM_PREDICT");
        // A call that will think spends budget on the trace → larger ceiling.
        assert_eq!(output_tokens_for(true), REASONING_OUTPUT_TOKENS);
        assert_eq!(output_tokens_for(false), DEFAULT_OUTPUT_TOKENS);
        assert!(REASONING_OUTPUT_TOKENS > DEFAULT_OUTPUT_TOKENS);

        // An env override raises the ceiling but can't drop a thinking call below
        // its sensible floor (guards against starving the trace).
        std::env::set_var("OLLAMA_NUM_PREDICT", "2048");
        assert_eq!(output_tokens_for(true), REASONING_OUTPUT_TOKENS);
        std::env::set_var("OLLAMA_NUM_PREDICT", "20000");
        assert_eq!(output_tokens_for(false), 20000);
        std::env::remove_var("OLLAMA_NUM_PREDICT");
    }

    // ── think-tag hygiene ──

    #[test]
    fn test_strip_think_blocks() {
        assert_eq!(
            strip_think_blocks("<think>hmm, 2 plus 2…</think>\n\n4"),
            "4"
        );
        // No tags → untouched.
        assert_eq!(strip_think_blocks("plain answer"), "plain answer");
        // Unclosed block (stream cut mid-thought) → dangling trace dropped.
        assert_eq!(strip_think_blocks("partial <think>never closed"), "partial ");
        // Multiple blocks.
        assert_eq!(
            strip_think_blocks("<think>a</think>x<think>b</think>y"),
            "xy"
        );
    }

    #[test]
    fn test_think_filter_across_token_boundaries() {
        // The opening tag arrives split across three tokens — nothing inside
        // the block may reach the display stream.
        let mut f = ThinkFilter::new();
        let mut shown = String::new();
        for tok in ["<th", "ink>secret reasoning", " more secrets</th", "ink>the answer", " is 4"] {
            shown.push_str(&f.push(tok));
        }
        shown.push_str(&f.finish());
        assert_eq!(shown, "the answer is 4");
    }

    #[test]
    fn test_think_filter_passes_plain_text() {
        let mut f = ThinkFilter::new();
        let mut shown = String::new();
        for tok in ["hello", " wor", "ld"] {
            shown.push_str(&f.push(tok));
        }
        shown.push_str(&f.finish());
        assert_eq!(shown, "hello world");
    }

    #[test]
    fn test_think_filter_flushes_false_alarm_prefix() {
        // A lone '<' that never becomes a tag must still be emitted at finish.
        let mut f = ThinkFilter::new();
        let mut shown = String::new();
        shown.push_str(&f.push("a < b"));
        shown.push_str(&f.finish());
        assert_eq!(shown, "a < b");
    }
}
