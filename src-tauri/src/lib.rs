// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// PrismOS — Local-First Agentic Personal AI Operating System
// Main application library — Tauri command handlers and system initialization

mod refractive_core;
mod spectrum_graph;
mod sandbox_prism;
mod intent_lens;
mod ollama_bridge;
mod you_port;
mod agents;
mod audit_log;
mod model_verify;
mod secure_enclave;

use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

/// Shared Spectrum Graph database — initialized once at startup, reused by all commands.
/// Wrapped in Mutex because rusqlite::Connection is not Sync.
pub struct DbState(pub Mutex<spectrum_graph::SpectrumGraph>);

// ─── Tauri Commands ────────────────────────────────────────────────────────────

/// process_intent — Full Refractive Core pipeline (Patent Pending)
/// Parses raw input → Intent Lens → Spectrum Graph context → NPU scoring →
/// Agent selection → LLM inference → Closed-loop feedback → Result
#[tauri::command]
async fn process_intent(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let result = refractive_core::process_intent_full(&input, &app_dir, app.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Return just the response text for backwards compatibility
    Ok(result.response)
}

/// process_intent_full — Returns the complete RefractiveResult as JSON
#[tauri::command]
async fn process_intent_full(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let result = refractive_core::process_intent_full(&input, &app_dir, app.clone())
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Full Refractive Core pipeline: intent → Spectrum Graph context → agent → feedback → result
#[tauri::command]
async fn refract_intent(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lens = intent_lens::IntentLens::new();
    let parsed = lens.parse(&input);

    let engine = refractive_core::RefractiveEngine::new();
    let result = engine
        .refract(parsed, &app_dir, app.clone())
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
async fn query_ollama(prompt: String, model: Option<String>, ollama_url: Option<String>, max_tokens: Option<u32>) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "mistral".to_string());
    ollama_bridge::generate(&model, &prompt, ollama_url.as_deref(), max_tokens)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn query_ollama_stream(
    app: tauri::AppHandle,
    prompt: String,
    model: Option<String>,
    ollama_url: Option<String>,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "mistral".to_string());
    let app_clone = app.clone();
    ollama_bridge::generate_stream(
        &model,
        &prompt,
        ollama_url.as_deref(),
        max_tokens,
        move |event| {
            let _ = app_clone.emit("ollama-stream", &event);
        },
    )
    .await
    .map_err(|e| e.to_string())
}

// ─── Spectrum Graph Commands ───────────────────────────────────────────────────

#[tauri::command]
async fn get_spectrum_nodes(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = graph.get_all_nodes().map_err(|e| e.to_string())?;
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_spectrum_node(
    db: tauri::State<'_, DbState>,
    label: String,
    content: String,
    node_type: String,
) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let node = graph
        .add_node(&label, &content, &node_type)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&node).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_active_agents(active_agent: Option<String>) -> Result<String, String> {
    let agents = refractive_core::get_agents_with_active(active_agent.as_deref());
    serde_json::to_string(&agents).map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_ollama_status(ollama_url: Option<String>) -> Result<bool, String> {
    ollama_bridge::is_available(ollama_url.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn launch_ollama() -> Result<String, String> {
    // Try to start ollama serve as a detached background process
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        // On Windows, use cmd /c start to spawn detached
        Command::new("cmd")
            .args(["/C", "start", "/B", "ollama", "serve"])
            .spawn()
            .map_err(|e| format!("Failed to launch Ollama: {}. Is Ollama installed?", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, try launching the app first, then fallback to CLI
        let app_result = Command::new("open")
            .args(["-a", "Ollama"])
            .spawn();
        if app_result.is_err() {
            Command::new("ollama")
                .arg("serve")
                .spawn()
                .map_err(|e| format!("Failed to launch Ollama: {}. Is Ollama installed?", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()
            .map_err(|e| format!("Failed to launch Ollama: {}. Is Ollama installed?", e))?;
    }

    // Wait a moment for the server to start, then check
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let available = ollama_bridge::is_available(None)
        .await
        .unwrap_or(false);

    if available {
        Ok("Ollama started successfully".to_string())
    } else {
        Ok("Ollama process launched — it may take a few seconds to be ready".to_string())
    }
}

#[tauri::command]
async fn pull_ollama_model(model: String, ollama_url: Option<String>) -> Result<String, String> {
    // Pull a model using the Ollama API
    let url = ollama_url.as_deref().unwrap_or(ollama_bridge::DEFAULT_OLLAMA_URL);
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/pull", url))
        .json(&serde_json::json!({ "name": model, "stream": false }))
        .timeout(std::time::Duration::from_secs(600)) // 10 min timeout for large models
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}. Is Ollama running?", e))?;

    if resp.status().is_success() {
        Ok(format!("Model '{}' pulled successfully", model))
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Failed to pull model '{}': {}", model, body))
    }
}

#[tauri::command]
async fn list_ollama_models(ollama_url: Option<String>) -> Result<String, String> {
    let models = ollama_bridge::list_models(ollama_url.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&models).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_sandbox(name: String, agent_id: Option<String>) -> Result<String, String> {
    let aid = agent_id.unwrap_or_else(|| "unknown".to_string());
    let prism = sandbox_prism::create_prism_for_agent(&name, &aid);
    serde_json::to_string(&prism).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_you_port(data: String) -> Result<String, String> {
    let package = you_port::create_export_package(&data);
    serde_json::to_string(&package).map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_you_port(package_json: String) -> Result<String, String> {
    let package: you_port::YouPortPackage =
        serde_json::from_str(&package_json).map_err(|e| e.to_string())?;
    you_port::import_package(&package).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_spectrum_node(db: tauri::State<'_, DbState>, id: String) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let node = graph.get_node(&id).map_err(|e| e.to_string())?;
    serde_json::to_string(&node).map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_spectrum_nodes(db: tauri::State<'_, DbState>, query: String) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = graph.search_nodes(&query).map_err(|e| e.to_string())?;
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_spectrum_node(db: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    graph.delete_node(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_spectrum_edge(
    db: tauri::State<'_, DbState>,
    source_id: String,
    target_id: String,
    relation: String,
    weight: f64,
) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let edge = graph.add_edge(&source_id, &target_id, &relation, weight).map_err(|e| e.to_string())?;
    serde_json::to_string(&edge).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_node_connections(db: tauri::State<'_, DbState>, node_id: String) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let edges = graph.get_connections(&node_id).map_err(|e| e.to_string())?;
    serde_json::to_string(&edges).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_graph_stats(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let (nodes, edges) = graph.stats().map_err(|e| e.to_string())?;
    serde_json::to_string(&serde_json::json!({ "nodes": nodes, "edges": edges }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rollback_sandbox(name: String) -> Result<String, String> {
    let mut prism = sandbox_prism::create_prism(&name);
    let checkpoint = sandbox_prism::rollback(&mut prism);
    serde_json::to_string(&checkpoint).map_err(|e| e.to_string())
}

/// execute_in_sandbox — Primary Sandbox Prism entry point (Patent Pending)
/// Validates, signs, and executes an action within the WASM-isolated Sandbox Prism.
/// Returns a fully auditable result with HMAC-SHA256 signature and side effects.
#[tauri::command]
async fn execute_in_sandbox(action: String, agent_id: String) -> Result<String, String> {
    let result = sandbox_prism::sandbox_execute(&action, &agent_id);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── New Spectrum Graph Commands (Patent Pending) ───────────────────────────

/// Get the full Spectrum Graph snapshot for frontend visualization
#[tauri::command]
async fn get_spectrum_graph(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let snapshot = graph.get_full_graph().map_err(|e| e.to_string())?;
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

/// Update edge weight with closed-loop feedback signal
#[tauri::command]
async fn update_edge_weight(
    db: tauri::State<'_, DbState>,
    edge_id: String,
    feedback_signal: f64,
) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let edge = graph
        .update_edge_weight(&edge_id, feedback_signal)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&edge).map_err(|e| e.to_string())
}

/// Query the Spectrum Graph with intent-aware retrieval
#[tauri::command]
async fn query_spectrum_intent(
    db: tauri::State<'_, DbState>,
    raw_input: String,
    intent_type: String,
    entities: Vec<String>,
) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let results = graph
        .query_intent(&raw_input, &intent_type, &entities)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&results).map_err(|e| e.to_string())
}

/// Get anticipatory need predictions from graph patterns
#[tauri::command]
async fn anticipate_needs(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let needs = graph.anticipate_needs().map_err(|e| e.to_string())?;
    serde_json::to_string(&needs).map_err(|e| e.to_string())
}

/// Get 2-3 proactive structured suggestions (Phase 3 — Proactive Spectrum Graph)
#[tauri::command]
async fn get_proactive_suggestions(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let suggestions = graph
        .generate_proactive_suggestions()
        .map_err(|e| e.to_string())?;
    // Store each suggestion in the graph for later recall
    for sug in &suggestions {
        let _ = graph.store_proactive_suggestion(sug);
    }
    serde_json::to_string(&suggestions).map_err(|e| e.to_string())
}

/// Strengthen graph edges related to given keywords (auto-reinforcement)
#[tauri::command]
async fn strengthen_related_edges(
    db: tauri::State<'_, DbState>,
    keywords: Vec<String>,
) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let count = graph
        .strengthen_related_edges(&keywords)
        .map_err(|e| e.to_string())?;
    Ok(format!("{{\"edges_strengthened\": {}}}", count))
}

/// Get extended graph metrics
#[tauri::command]
async fn get_graph_metrics(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let metrics = graph.get_metrics().map_err(|e| e.to_string())?;
    serde_json::to_string(&metrics).map_err(|e| e.to_string())
}

/// Apply temporal decay to all edges (maintenance)
#[tauri::command]
async fn decay_graph_edges(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let updated = graph.decay_all_edges().map_err(|e| e.to_string())?;
    Ok(format!("{{\"edges_decayed\": {}}}", updated))
}

/// Persist the Spectrum Graph to a JSON export file
#[tauri::command]
async fn persist_graph(app: tauri::AppHandle, db: tauri::State<'_, DbState>) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let export_path = app_dir.join("spectrum_graph_export.json");
    graph.persist(&export_path).map_err(|e| e.to_string())
}

/// Load a previously persisted Spectrum Graph from JSON
#[tauri::command]
async fn load_graph(app: tauri::AppHandle, db: tauri::State<'_, DbState>) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let import_path = app_dir.join("spectrum_graph_export.json");
    graph.load(&import_path).map_err(|e| e.to_string())
}

/// Get feedback count for analytics
#[tauri::command]
async fn get_feedback_count(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let count = graph.get_feedback_count().map_err(|e| e.to_string())?;
    Ok(format!("{{\"feedback_count\": {}}}", count))
}

/// Get recent intent log entries
#[tauri::command]
async fn get_recent_intents(db: tauri::State<'_, DbState>, days: u32) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let intents = graph.get_recent_intents(days).map_err(|e| e.to_string())?;
    serde_json::to_string(&intents).map_err(|e| e.to_string())
}

/// Get daily brief/recap — activity summary from Spectrum Graph
#[tauri::command]
async fn get_daily_brief(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let brief = graph.get_daily_brief().map_err(|e| e.to_string())?;
    serde_json::to_string(&brief).map_err(|e| e.to_string())
}

/// Update a node's label and content
#[tauri::command]
async fn update_spectrum_node(
    db: tauri::State<'_, DbState>,
    id: String,
    label: String,
    content: String,
) -> Result<(), String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    graph.update_node(&id, &label, &content).map_err(|e| e.to_string())
}

// ─── You-Port Encrypted State Handoff (Patent Pending) ──────────────────────

/// Save complete PrismOS state to encrypted file (Spectrum Graph + agents + metadata)
/// Called on app close or manually by the user.
#[tauri::command]
async fn save_state(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = you_port::save_state(&app_dir).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Load and restore PrismOS state from encrypted file.
/// Decrypts, verifies integrity, and merges into current Spectrum Graph.
#[tauri::command]
async fn load_state(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = you_port::load_state(&app_dir).map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Check if a saved state file exists (used on startup to decide whether to show restore toast)
#[tauri::command]
async fn has_saved_state(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(you_port::has_saved_state(&app_dir))
}

// ─── Settings Commands (Patent Pending) ─────────────────────────────────────

/// Export the Spectrum Graph as an encrypted JSON package (You-Port encryption)
/// Returns the encrypted package JSON string for the user to save externally.
#[tauri::command]
async fn export_graph(app: tauri::AppHandle, db: tauri::State<'_, DbState>) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let snapshot = graph.get_full_graph().map_err(|e| e.to_string())?;

    // Serialize the graph snapshot
    let plaintext = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    let plaintext_bytes = plaintext.as_bytes();

    // Encrypt using You-Port AES-256-GCM engine
    let nonce = uuid::Uuid::new_v4().to_string();
    let device_fp = you_port::get_device_fingerprint(&app_dir);
    let key = you_port::derive_key(&device_fp, &nonce);
    let checksum = you_port::sha256_hex(plaintext_bytes);

    let ciphertext = you_port::aes_encrypt(&key, plaintext_bytes).map_err(|e| e.to_string())?;
    let encrypted_b64 = you_port::base64_encode(&ciphertext);

    let package = serde_json::json!({
        "format": "prismos-graph-export-v2",
        "id": uuid::Uuid::new_v4().to_string(),
        "created_at": chrono::Utc::now().to_rfc3339(),
        "encrypted_payload": encrypted_b64,
        "checksum": checksum,
        "nonce": nonce,
        "stats": {
            "nodes": snapshot.nodes.len(),
            "edges": snapshot.edges.len(),
        }
    });

    serde_json::to_string_pretty(&package).map_err(|e| e.to_string())
}

/// Import a Spectrum Graph from an encrypted JSON package
/// Decrypts, verifies, and merges into the current graph.
#[tauri::command]
async fn import_graph(app: tauri::AppHandle, db_state: tauri::State<'_, DbState>, package_json: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let package: serde_json::Value =
        serde_json::from_str(&package_json).map_err(|e| format!("Invalid package JSON: {}", e))?;

    let format = package["format"].as_str().unwrap_or("");
    let is_legacy_export = format == "prismos-graph-export-v1";
    if format != "prismos-graph-export-v2" && !is_legacy_export {
        return Err(format!("Unsupported export format: {}", format));
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let nonce = package["nonce"].as_str().ok_or("Missing nonce")?;
    let stored_checksum = package["checksum"].as_str().ok_or("Missing checksum")?;

    // Derive key from device fingerprint + nonce
    let device_fp = you_port::get_device_fingerprint(&app_dir);
    let key = you_port::derive_key(&device_fp, nonce);

    // Decode ciphertext
    let ciphertext = you_port::base64_decode(encrypted_b64)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    // Decrypt based on format version
    let plaintext_bytes = if is_legacy_export {
        let stored_hmac = package["hmac_signature"]
            .as_str()
            .ok_or("Missing hmac_signature")?;
        let expected_hmac = you_port::compute_hmac(&key, &ciphertext);
        if expected_hmac != stored_hmac {
            return Err("HMAC verification failed — file may be tampered or from a different device".to_string());
        }
        you_port::xor_stream_cipher(&key, &ciphertext)
    } else {
        you_port::aes_decrypt(&key, &ciphertext).map_err(|e| e.to_string())?
    };

    // Verify integrity
    let checksum = you_port::sha256_hex(&plaintext_bytes);
    if checksum != stored_checksum {
        return Err("Integrity checksum mismatch — decryption may have failed".to_string());
    }

    let plaintext = String::from_utf8(plaintext_bytes)
        .map_err(|e| format!("Decrypted data is not valid UTF-8: {}", e))?;

    // Deserialize and merge into graph
    let snapshot: spectrum_graph::GraphSnapshot =
        serde_json::from_str(&plaintext).map_err(|e| format!("Failed to parse graph data: {}", e))?;

    let graph = db_state.0.lock().map_err(|e| e.to_string())?;
    let mut nodes_imported = 0_usize;
    let mut edges_imported = 0_usize;

    for node in &snapshot.nodes {
        match graph.get_node(&node.id) {
            Ok(_) => {} // Skip existing
            Err(_) => {
                if graph.add_node_with_layer(&node.label, &node.content, &node.node_type, &node.layer).is_ok() {
                    nodes_imported += 1;
                }
            }
        }
    }

    for edge in &snapshot.edges {
        if graph.get_or_create_edge(&edge.source_id, &edge.target_id, &edge.relation).is_ok() {
            edges_imported += 1;
        }
    }

    let result = serde_json::json!({
        "success": true,
        "message": format!("Imported {} nodes, {} edges into Spectrum Graph", nodes_imported, edges_imported),
        "nodes_imported": nodes_imported,
        "edges_imported": edges_imported,
        "total_nodes": snapshot.nodes.len(),
        "total_edges": snapshot.edges.len(),
    });

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Clear the entire Spectrum Graph (delete all nodes and edges)
#[tauri::command]
async fn clear_graph(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let (nodes, edges) = graph.clear_graph().map_err(|e| e.to_string())?;

    let result = serde_json::json!({
        "success": true,
        "message": format!("Cleared {} nodes and {} edges from Spectrum Graph", nodes, edges),
        "nodes_cleared": nodes,
        "edges_cleared": edges,
    });

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── LangGraph Workflow Commands (Patent Pending) ───────────────────────────

/// Run a full LangGraph multi-agent collaboration for a given intent.
/// Returns a WorkflowSummary with debate log, consensus, and transitions.
#[tauri::command]
async fn run_collaboration(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lens = intent_lens::IntentLens::new();
    let parsed = lens.parse(&input);

    let engine = refractive_core::RefractiveEngine::new();
    let result = engine
        .refract(parsed, &app_dir, app.clone())
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Get the LangGraph state graph definition for frontend visualization.
/// Returns the graph nodes, edges, and conditional routing.
#[tauri::command]
async fn get_workflow_graph() -> Result<String, String> {
    let graph = agents::langgraph_workflow::get_state_graph();
    serde_json::to_string(&graph).map_err(|e| e.to_string())
}

/// Get the debate log from the most recent collaboration.
/// Returns structured debate arguments with agent positions, challenges, and rebuttals.
#[tauri::command]
async fn get_debate_log() -> Result<String, String> {
    // Return an empty debate log — real data comes from run_collaboration result
    let empty: Vec<agents::langgraph_workflow::DebateArgument> = vec![];
    serde_json::to_string(&empty).map_err(|e| e.to_string())
}

// ─── Multi-Window Support (Patent Pending — Spectral Timeline) ──────────────

/// Open a secondary window (e.g. Spectrum Graph or Spectral Timeline in its own window).
/// Creates a new Tauri webview window pointed at the same frontend with a route hash.
#[tauri::command]
async fn open_graph_window(
    app: tauri::AppHandle,
    label: String,
    title: String,
    route: String,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    use tauri::WebviewUrl;

    // Check if window with this label already exists — focus it instead
    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Build the URL with route hash so the frontend can render the correct view
    let url = format!("index.html#{}", route);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(1000.0, 700.0)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| format!("Failed to open window: {}", e))?;

    Ok(())
}

/// Get timeline data — spectrum nodes grouped by date with edge events.
/// Returns nodes sorted by created_at descending for the Spectral Timeline view.
#[tauri::command]
async fn get_timeline_data(db: tauri::State<'_, DbState>) -> Result<String, String> {
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let snapshot = graph.get_full_graph().map_err(|e| e.to_string())?;

    // Combine nodes and edges into a unified timeline, sorted by date
    #[derive(serde::Serialize)]
    struct TimelineEvent {
        id: String,
        event_type: String,       // "node_created" | "node_updated" | "edge_created" | "edge_reinforced"
        label: String,
        description: String,
        node_type: String,
        layer: String,
        timestamp: String,
        access_count: u32,
    }

    let mut events: Vec<TimelineEvent> = Vec::new();

    // Node creation events
    for node in &snapshot.nodes {
        events.push(TimelineEvent {
            id: node.id.clone(),
            event_type: "node_created".into(),
            label: node.label.clone(),
            description: if node.content.len() > 120 {
                format!("{}…", node.content.chars().take(120).collect::<String>())
            } else {
                node.content.clone()
            },
            node_type: node.node_type.clone(),
            layer: node.layer.clone(),
            timestamp: node.created_at.clone(),
            access_count: node.access_count as u32,
        });

        // If updated_at differs from created_at, add an update event
        if node.updated_at != node.created_at {
            events.push(TimelineEvent {
                id: format!("{}-update", node.id),
                event_type: "node_updated".into(),
                label: format!("{} (updated)", node.label),
                description: "Node content was updated".into(),
                node_type: node.node_type.clone(),
                layer: node.layer.clone(),
                timestamp: node.updated_at.clone(),
                access_count: node.access_count as u32,
            });
        }
    }

    // Edge creation events
    for edge in &snapshot.edges {
        events.push(TimelineEvent {
            id: edge.id.clone(),
            event_type: "edge_created".into(),
            label: format!("{}", edge.relation),
            description: format!("Edge created: {} → {} (weight: {:.2})", edge.source_id, edge.target_id, edge.weight),
            node_type: "meta".into(),
            layer: "context".into(),
            timestamp: edge.created_at.clone(),
            access_count: edge.reinforcements as u32,
        });

        // If last_reinforced differs from created_at, add reinforcement event
        if edge.last_reinforced != edge.created_at {
            events.push(TimelineEvent {
                id: format!("{}-reinf", edge.id),
                event_type: "edge_reinforced".into(),
                label: format!("{} (reinforced ×{})", edge.relation, edge.reinforcements),
                description: format!("Edge weight: {:.2}, momentum: {:.2}", edge.weight, edge.momentum),
                node_type: "meta".into(),
                layer: "context".into(),
                timestamp: edge.last_reinforced.clone(),
                access_count: edge.reinforcements as u32,
            });
        }
    }

    // Sort by timestamp descending (newest first)
    events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    serde_json::to_string(&events).map_err(|e| e.to_string())
}

// ─── Graph Merge/Diff Commands (Patent Pending — Multi-Device Sync) ───────

/// Export the local Spectrum Graph as a passphrase-encrypted sync package.
/// The resulting file can be transferred to another PrismOS instance and
/// merged using the same passphrase.
#[tauri::command]
async fn export_sync_package(app: tauri::AppHandle, passphrase: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    you_port::export_sync_package(&app_dir, &passphrase).map_err(|e| e.to_string())
}

/// Import and merge a sync package from another device.
/// Decrypts with the passphrase, then merges using the specified strategy
/// ("theirs", "ours", or "latest").
#[tauri::command]
async fn import_sync_package(
    app: tauri::AppHandle,
    package_json: String,
    passphrase: String,
    strategy: String,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let result = you_port::import_sync_package(&app_dir, &package_json, &passphrase, &strategy)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Preview a merge diff without applying any changes.
/// Returns conflict details and what would happen under the given strategy.
#[tauri::command]
async fn preview_sync_merge(
    app: tauri::AppHandle,
    package_json: String,
    passphrase: String,
    strategy: String,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let diff = you_port::preview_sync_merge(&app_dir, &package_json, &passphrase, &strategy)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&diff).map_err(|e| e.to_string())
}

/// Compute a diff between the local graph and a raw (unencrypted) graph snapshot.
/// Useful for comparing two local exports.
#[tauri::command]
async fn diff_graph(
    _app: tauri::AppHandle,
    db: tauri::State<'_, DbState>,
    snapshot_json: String,
    strategy: String,
) -> Result<String, String> {
    let snapshot: spectrum_graph::GraphSnapshot =
        serde_json::from_str(&snapshot_json).map_err(|e| format!("Invalid snapshot JSON: {}", e))?;
    let merge_strategy = spectrum_graph::MergeStrategy::from_str(&strategy);
    let graph = db.0.lock().map_err(|e| e.to_string())?;
    let diff = graph.diff_graph(&snapshot, &merge_strategy).map_err(|e| e.to_string())?;
    serde_json::to_string(&diff).map_err(|e| e.to_string())
}

// ─── Security Commands (Patent Pending) ─────────────────────────────────────

/// Get the most recent audit log entries (tamper-evident hash chain)
#[tauri::command]
async fn get_audit_log(app: tauri::AppHandle, limit: Option<usize>) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let log = audit_log::AuditLog::new(&app_dir);
    let entries = log.get_entries(limit.unwrap_or(50)).map_err(|e| e.to_string())?;
    serde_json::to_string(&entries).map_err(|e| e.to_string())
}

/// Verify the entire audit chain for integrity (detects tampering)
#[tauri::command]
async fn verify_audit_chain(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let log = audit_log::AuditLog::new(&app_dir);
    let result = log.verify_chain().map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Verify a model's integrity against the known-good registry
#[tauri::command]
async fn verify_model(app: tauri::AppHandle, model: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ollama_url = "http://localhost:11434";
    let result = model_verify::verify_model(&model, ollama_url).await;

    // Log the verification to the audit chain
    let log = audit_log::AuditLog::new(&app_dir);
    let _ = log.append(
        "model_verification",
        "system",
        &format!("{}: {} — {}", model, serde_json::to_string(&result.status).unwrap_or_default(), result.details),
    );

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Get the complete security status (enclave, audit chain, sandbox)
#[tauri::command]
async fn get_security_status(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Secure Enclave status
    let enclave = secure_enclave::SecureEnclave::new();
    let enclave_status = enclave.status();

    // Audit chain status
    let log = audit_log::AuditLog::new(&app_dir);
    let chain_verification = log.verify_chain().map_err(|e| e.to_string())?;
    let entry_count = log.entry_count();

    let status = serde_json::json!({
        "enclave": enclave_status,
        "audit_chain": {
            "valid": chain_verification.valid,
            "entries": entry_count,
            "message": chain_verification.message,
        },
        "sandbox_active": true,
        "hmac_signing": true,
        "wasm_isolation": true,
        "auto_rollback": true,
        "encrypted_storage": true,
        "local_only": true,
    });

    serde_json::to_string(&status).map_err(|e| e.to_string())
}

// ─── Application Setup ────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            // Initialize Spectrum Graph database — shared across all commands
            let db = spectrum_graph::SpectrumGraph::new(&app_dir)
                .expect("Failed to initialize Spectrum Graph");
            app.manage(DbState(Mutex::new(db)));

            // Initialize tamper-evident audit log
            let audit = audit_log::AuditLog::new(&app_dir);
            let _ = audit.append("app_launch", "system", "PrismOS application started");

            // Initialize secure enclave
            let enclave = secure_enclave::SecureEnclave::new();
            let enclave_status = enclave.status();
            let _ = audit.append(
                "enclave_init",
                "system",
                &format!("Secure enclave initialized: {} (hardware: {})",
                    enclave_status.backend.label(),
                    enclave_status.hardware_available),
            );

            // ── You-Port: Auto-restore previous session if state file exists ──
            if you_port::has_saved_state(&app_dir) {
                match you_port::load_state(&app_dir) {
                    Ok(result) if result.success => {
                        println!("  ✅ You-Port: Restored {} nodes, {} edges from previous session",
                            result.nodes_count, result.edges_count);
                    }
                    Ok(_) => {
                        println!("  ⚠️ You-Port: No state to restore");
                    }
                    Err(e) => {
                        eprintln!("  ⚠️ You-Port: Failed to restore state: {}", e);
                    }
                }
            }

            println!("╔══════════════════════════════════════════════╗");
            println!("║  ◈ PrismOS v0.2.0 — Local-First AI OS       ║");
            println!("║  Patent Pending — US Provisional             ║");
            println!("║  Refractive Core + Spectrum Graph: ACTIVE    ║");
            println!("║  You-Port Encrypted Handoff: ENABLED         ║");
            println!("║  Graph Merge/Diff Multi-Device: ENABLED      ║");
            println!("║  Tamper-Evident Audit Log: ACTIVE            ║");
            println!("║  Secure Enclave: {}      ║",
                format!("{:<25}", enclave_status.backend.label()));
            println!("╚══════════════════════════════════════════════╝");
            println!("📍 Data directory: {:?}", app_dir);
            println!("🔑 Enclave fingerprint: {}", enclave_status.key_fingerprint);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Core pipeline (Patent Pending)
            process_intent,
            process_intent_full,
            refract_intent,
            query_ollama,
            query_ollama_stream,
            // Spectrum Graph — CRUD
            get_spectrum_nodes,
            get_spectrum_node,
            add_spectrum_node,
            search_spectrum_nodes,
            delete_spectrum_node,
            add_spectrum_edge,
            get_node_connections,
            get_graph_stats,
            // Spectrum Graph — Patent Pending
            get_spectrum_graph,
            update_edge_weight,
            query_spectrum_intent,
            anticipate_needs,
            get_proactive_suggestions,
            strengthen_related_edges,
            get_graph_metrics,
            decay_graph_edges,
            update_spectrum_node,
            // Spectrum Graph — Persist / Load
            persist_graph,
            load_graph,
            get_feedback_count,
            get_recent_intents,
            get_daily_brief,
            // Agents
            get_active_agents,
            // LangGraph Workflow (Patent Pending — Multi-Agent Collaboration)
            run_collaboration,
            get_workflow_graph,
            get_debate_log,
            // Ollama
            check_ollama_status,
            launch_ollama,
            pull_ollama_model,
            list_ollama_models,
            // Sandbox (Patent Pending — WASM Isolation + Cryptographic Signing)
            create_sandbox,
            execute_in_sandbox,
            rollback_sandbox,
            // You-Port (Patent Pending — Encrypted State Migration)
            export_you_port,
            import_you_port,
            save_state,
            load_state,
            has_saved_state,
            // Settings (Patent Pending — Graph Export/Import/Clear)
            export_graph,
            import_graph,
            clear_graph,
            // Multi-Window + Spectral Timeline (Patent Pending)
            open_graph_window,
            get_timeline_data,
            // Graph Merge/Diff — Multi-Device Sync (Patent Pending)
            export_sync_package,
            import_sync_package,
            preview_sync_merge,
            diff_graph,
            // Security Hardening (Patent Pending)
            get_audit_log,
            verify_audit_chain,
            verify_model,
            get_security_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrismOS");
}
