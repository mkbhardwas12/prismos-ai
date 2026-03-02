// Patent Pending — US 63/993,589 (Feb 28, 2026)
// PrismOS — Local-First Agentic Personal AI Operating System
// Main application library — Tauri command handlers and system initialization

mod refractive_core;
mod spectrum_graph;
mod sandbox_prism;
mod intent_lens;
mod ollama_bridge;
mod you_port;
mod agents;

use tauri::Manager;

// ─── Tauri Commands ────────────────────────────────────────────────────────────

/// process_intent — Full Refractive Core pipeline (Patent 63/993,589)
/// Parses raw input → Intent Lens → Spectrum Graph context → NPU scoring →
/// Agent selection → LLM inference → Closed-loop feedback → Result
#[tauri::command]
async fn process_intent(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let result = refractive_core::process_intent_full(&input, &app_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Return just the response text for backwards compatibility
    Ok(result.response)
}

/// process_intent_full — Returns the complete RefractiveResult as JSON
#[tauri::command]
async fn process_intent_full(app: tauri::AppHandle, input: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let result = refractive_core::process_intent_full(&input, &app_dir)
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
        .refract(parsed, &app_dir)
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
async fn query_ollama(prompt: String, model: Option<String>) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "mistral".to_string());
    ollama_bridge::generate(&model, &prompt)
        .await
        .map_err(|e| e.to_string())
}

// ─── Spectrum Graph Commands ───────────────────────────────────────────────────

#[tauri::command]
async fn get_spectrum_nodes(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db =
        spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let nodes = db.get_all_nodes().map_err(|e| e.to_string())?;
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_spectrum_node(
    app: tauri::AppHandle,
    label: String,
    content: String,
    node_type: String,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db =
        spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let node = db
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
async fn check_ollama_status() -> Result<bool, String> {
    ollama_bridge::is_available()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_ollama_models() -> Result<String, String> {
    let models = ollama_bridge::list_models()
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
async fn get_spectrum_node(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let node = db.get_node(&id).map_err(|e| e.to_string())?;
    serde_json::to_string(&node).map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_spectrum_nodes(app: tauri::AppHandle, query: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let nodes = db.search_nodes(&query).map_err(|e| e.to_string())?;
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_spectrum_node(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    db.delete_node(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_spectrum_edge(
    app: tauri::AppHandle,
    source_id: String,
    target_id: String,
    relation: String,
    weight: f64,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let edge = db.add_edge(&source_id, &target_id, &relation, weight).map_err(|e| e.to_string())?;
    serde_json::to_string(&edge).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_node_connections(app: tauri::AppHandle, node_id: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let edges = db.get_connections(&node_id).map_err(|e| e.to_string())?;
    serde_json::to_string(&edges).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_graph_stats(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let (nodes, edges) = db.stats().map_err(|e| e.to_string())?;
    serde_json::to_string(&serde_json::json!({ "nodes": nodes, "edges": edges }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn execute_sandbox(action: String, agent_id: String) -> Result<String, String> {
    let result = sandbox_prism::sandbox_execute(&action, &agent_id);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rollback_sandbox(name: String) -> Result<String, String> {
    let mut prism = sandbox_prism::create_prism(&name);
    let checkpoint = sandbox_prism::rollback(&mut prism);
    serde_json::to_string(&checkpoint).map_err(|e| e.to_string())
}

/// execute_in_sandbox — Primary Sandbox Prism entry point (Patent 63/993,589)
/// Validates, signs, and executes an action within the WASM-isolated Sandbox Prism.
/// Returns a fully auditable result with HMAC-SHA256 signature and side effects.
#[tauri::command]
async fn execute_in_sandbox(action: String, agent_id: String) -> Result<String, String> {
    let result = sandbox_prism::sandbox_execute(&action, &agent_id);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── New Spectrum Graph Commands (Patent 63/993,589) ───────────────────────────

/// Get the full Spectrum Graph snapshot for frontend visualization
#[tauri::command]
async fn get_spectrum_graph(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let snapshot = db.get_full_graph().map_err(|e| e.to_string())?;
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

/// Update edge weight with closed-loop feedback signal
#[tauri::command]
async fn update_edge_weight(
    app: tauri::AppHandle,
    edge_id: String,
    feedback_signal: f64,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let edge = db
        .update_edge_weight(&edge_id, feedback_signal)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&edge).map_err(|e| e.to_string())
}

/// Query the Spectrum Graph with intent-aware retrieval
#[tauri::command]
async fn query_spectrum_intent(
    app: tauri::AppHandle,
    raw_input: String,
    intent_type: String,
    entities: Vec<String>,
) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let results = db
        .query_intent(&raw_input, &intent_type, &entities)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&results).map_err(|e| e.to_string())
}

/// Get anticipatory need predictions from graph patterns
#[tauri::command]
async fn anticipate_needs(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let needs = db.anticipate_needs().map_err(|e| e.to_string())?;
    serde_json::to_string(&needs).map_err(|e| e.to_string())
}

/// Get extended graph metrics
#[tauri::command]
async fn get_graph_metrics(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let metrics = db.get_metrics().map_err(|e| e.to_string())?;
    serde_json::to_string(&metrics).map_err(|e| e.to_string())
}

/// Apply temporal decay to all edges (maintenance)
#[tauri::command]
async fn decay_graph_edges(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let updated = db.decay_all_edges().map_err(|e| e.to_string())?;
    Ok(format!("{{\"edges_decayed\": {}}}", updated))
}

/// Persist the Spectrum Graph to a JSON export file
#[tauri::command]
async fn persist_graph(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let export_path = app_dir.join("spectrum_graph_export.json");
    db.persist(&export_path).map_err(|e| e.to_string())
}

/// Load a previously persisted Spectrum Graph from JSON
#[tauri::command]
async fn load_graph(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let import_path = app_dir.join("spectrum_graph_export.json");
    db.load(&import_path).map_err(|e| e.to_string())
}

/// Get feedback count for analytics
#[tauri::command]
async fn get_feedback_count(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let count = db.get_feedback_count().map_err(|e| e.to_string())?;
    Ok(format!("{{\"feedback_count\": {}}}", count))
}

/// Get recent intent log entries
#[tauri::command]
async fn get_recent_intents(app: tauri::AppHandle, days: u32) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let intents = db.get_recent_intents(days).map_err(|e| e.to_string())?;
    serde_json::to_string(&intents).map_err(|e| e.to_string())
}

/// Update a node's label and content
#[tauri::command]
async fn update_spectrum_node(
    app: tauri::AppHandle,
    id: String,
    label: String,
    content: String,
) -> Result<(), String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    db.update_node(&id, &label, &content).map_err(|e| e.to_string())
}

// ─── You-Port Encrypted State Handoff (Patent 63/993,589) ──────────────────────

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

// ─── Settings Commands (Patent 63/993,589) ─────────────────────────────────────

/// Export the Spectrum Graph as an encrypted JSON package (You-Port encryption)
/// Returns the encrypted package JSON string for the user to save externally.
#[tauri::command]
async fn export_graph(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let snapshot = db.get_full_graph().map_err(|e| e.to_string())?;

    // Serialize the graph snapshot
    let plaintext = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    let plaintext_bytes = plaintext.as_bytes();

    // Encrypt using You-Port encryption engine
    let nonce = uuid::Uuid::new_v4().to_string();
    let device_fp = you_port::get_device_fingerprint(&app_dir);
    let key = you_port::derive_key(&device_fp, &nonce);
    let checksum = you_port::sha256_hex(plaintext_bytes);

    let ciphertext = you_port::xor_stream_cipher(&key, plaintext_bytes);
    let encrypted_b64 = you_port::base64_encode(&ciphertext);
    let hmac_sig = you_port::compute_hmac(&key, &ciphertext);

    let package = serde_json::json!({
        "format": "prismos-graph-export-v1",
        "id": uuid::Uuid::new_v4().to_string(),
        "created_at": chrono::Utc::now().to_rfc3339(),
        "encrypted_payload": encrypted_b64,
        "checksum": checksum,
        "hmac_signature": hmac_sig,
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
async fn import_graph(app: tauri::AppHandle, package_json: String) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let package: serde_json::Value =
        serde_json::from_str(&package_json).map_err(|e| format!("Invalid package JSON: {}", e))?;

    let format = package["format"].as_str().unwrap_or("");
    if format != "prismos-graph-export-v1" {
        return Err(format!("Unsupported export format: {}", format));
    }

    let encrypted_b64 = package["encrypted_payload"]
        .as_str()
        .ok_or("Missing encrypted_payload")?;
    let nonce = package["nonce"].as_str().ok_or("Missing nonce")?;
    let stored_checksum = package["checksum"].as_str().ok_or("Missing checksum")?;
    let stored_hmac = package["hmac_signature"]
        .as_str()
        .ok_or("Missing hmac_signature")?;

    // Derive key from device fingerprint + nonce
    let device_fp = you_port::get_device_fingerprint(&app_dir);
    let key = you_port::derive_key(&device_fp, nonce);

    // Decode and verify HMAC
    let ciphertext = you_port::base64_decode(encrypted_b64)
        .map_err(|e| format!("Failed to decode payload: {}", e))?;

    let expected_hmac = you_port::compute_hmac(&key, &ciphertext);
    if expected_hmac != stored_hmac {
        return Err(
            "HMAC verification failed — file may be tampered or from a different device"
                .to_string(),
        );
    }

    // Decrypt
    let plaintext_bytes = you_port::xor_stream_cipher(&key, &ciphertext);

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

    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let mut nodes_imported = 0_usize;
    let mut edges_imported = 0_usize;

    for node in &snapshot.nodes {
        match db.get_node(&node.id) {
            Ok(_) => {} // Skip existing
            Err(_) => {
                if db.add_node_with_layer(&node.label, &node.content, &node.node_type, &node.layer).is_ok() {
                    nodes_imported += 1;
                }
            }
        }
    }

    for edge in &snapshot.edges {
        if db.get_or_create_edge(&edge.source_id, &edge.target_id, &edge.relation).is_ok() {
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
async fn clear_graph(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db = spectrum_graph::SpectrumGraph::new(&app_dir).map_err(|e| e.to_string())?;
    let (nodes, edges) = db.clear_graph().map_err(|e| e.to_string())?;

    let result = serde_json::json!({
        "success": true,
        "message": format!("Cleared {} nodes and {} edges from Spectrum Graph", nodes, edges),
        "nodes_cleared": nodes,
        "edges_cleared": edges,
    });

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

// ─── Application Setup ────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            // Initialize Spectrum Graph database with multi-layered schema
            let _db = spectrum_graph::SpectrumGraph::new(&app_dir)
                .expect("Failed to initialize Spectrum Graph");

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
            println!("║  ◈ PrismOS v0.1.0 — Local-First AI OS       ║");
            println!("║  Patent Pending — US 63/993,589              ║");
            println!("║  Refractive Core + Spectrum Graph: ACTIVE    ║");
            println!("║  You-Port Encrypted Handoff: ENABLED         ║");
            println!("╚══════════════════════════════════════════════╝");
            println!("📍 Data directory: {:?}", app_dir);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Core pipeline (Patent 63/993,589)
            process_intent,
            process_intent_full,
            refract_intent,
            query_ollama,
            // Spectrum Graph — CRUD
            get_spectrum_nodes,
            get_spectrum_node,
            add_spectrum_node,
            search_spectrum_nodes,
            delete_spectrum_node,
            add_spectrum_edge,
            get_node_connections,
            get_graph_stats,
            // Spectrum Graph — Patent 63/993,589
            get_spectrum_graph,
            update_edge_weight,
            query_spectrum_intent,
            anticipate_needs,
            get_graph_metrics,
            decay_graph_edges,
            update_spectrum_node,
            // Spectrum Graph — Persist / Load
            persist_graph,
            load_graph,
            get_feedback_count,
            get_recent_intents,
            // Agents
            get_active_agents,
            // Ollama
            check_ollama_status,
            list_ollama_models,
            // Sandbox (Patent 63/993,589 — WASM Isolation + Cryptographic Signing)
            create_sandbox,
            execute_sandbox,
            execute_in_sandbox,
            rollback_sandbox,
            // You-Port (Patent 63/993,589 — Encrypted State Migration)
            export_you_port,
            import_you_port,
            save_state,
            load_state,
            has_saved_state,
            // Settings (Patent 63/993,589 — Graph Export/Import/Clear)
            export_graph,
            import_graph,
            clear_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrismOS");
}
