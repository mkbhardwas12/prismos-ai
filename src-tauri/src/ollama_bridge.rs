// Patent Pending — US [application number] (Feb 28, 2026)
// Ollama Bridge — Local LLM Inference Interface
//
// Provides a Rust HTTP client for the Ollama REST API running on localhost.
// All inference stays local — no data leaves the user's machine.

use serde::{Deserialize, Serialize};
use std::time::Duration;

const OLLAMA_BASE_URL: &str = "http://localhost:11434";
const GENERATE_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);

// ─── Request / Response Types ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct GenerateRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct GenerateResponse {
    response: String,
    #[serde(default)]
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
pub async fn is_available() -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    match client
        .get(OLLAMA_BASE_URL)
        .timeout(HEALTH_TIMEOUT)
        .send()
        .await
    {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Generate a completion from a local model (non-streaming)
pub async fn generate(
    model: &str,
    prompt: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let request = GenerateRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        stream: false,
    };

    let response = client
        .post(format!("{}/api/generate", OLLAMA_BASE_URL))
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
pub async fn list_models() -> Result<Vec<ModelInfo>, Box<dyn std::error::Error + Send + Sync>> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/tags", OLLAMA_BASE_URL))
        .timeout(Duration::from_secs(10))
        .send()
        .await?;

    if !response.status().is_success() {
        return Ok(vec![]);
    }

    let model_list: ModelList = response.json().await?;
    Ok(model_list.models)
}
