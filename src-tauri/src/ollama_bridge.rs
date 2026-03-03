// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Ollama Bridge — Local LLM Inference Interface
//
// Provides a Rust HTTP client for the Ollama REST API running on localhost.
// All inference stays local — no data leaves the user's machine.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use futures_util::StreamExt;

pub const DEFAULT_OLLAMA_URL: &str = "http://localhost:11434";
const GENERATE_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);

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
}

#[derive(Debug, Serialize)]
struct GenerateOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
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
    let options = max_tokens.map(|n| GenerateOptions { num_predict: Some(n) });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        stream: false,
        options,
        images,
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
    let options = max_tokens.map(|n| GenerateOptions { num_predict: Some(n) });
    let request = GenerateRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        stream: true,
        options,
        images,
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
