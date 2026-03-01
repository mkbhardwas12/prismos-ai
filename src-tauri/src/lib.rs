// Patent Pending — US [application number] (Feb 28, 2026)
// PrismOS — Local-First Agentic Personal AI Operating System
// Main application library — Tauri command handlers and system initialization

mod refractive_core;
mod spectrum_graph;
mod sandbox_prism;
mod intent_lens;
mod ollama_bridge;
mod you_port;

use tauri::Manager;

// ─── Tauri Commands ────────────────────────────────────────────────────────────

#[tauri::command]
async fn process_intent(input: String) -> Result<String, String> {
    let lens = intent_lens::IntentLens::new();
    let parsed = lens.parse(&input);

    let response = refractive_core::route_intent(parsed)
        .await
        .map_err(|e| e.to_string())?;

    Ok(response)
}

#[tauri::command]
async fn query_ollama(prompt: String, model: Option<String>) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "mistral".to_string());
    ollama_bridge::generate(&model, &prompt)
        .await
        .map_err(|e| e.to_string())
}

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
async fn get_active_agents() -> Result<String, String> {
    let agents = refractive_core::get_agents();
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
async fn create_sandbox(name: String) -> Result<String, String> {
    let prism = sandbox_prism::create_prism(&name);
    serde_json::to_string(&prism).map_err(|e| e.to_string())
}

#[tauri::command]
async fn export_you_port(data: String) -> Result<String, String> {
    let package = you_port::create_export_package(&data);
    serde_json::to_string(&package).map_err(|e| e.to_string())
}

// ─── Application Setup ────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_dir)?;

            // Initialize Spectrum Graph database
            let _db = spectrum_graph::SpectrumGraph::new(&app_dir)
                .expect("Failed to initialize Spectrum Graph");

            println!("╔══════════════════════════════════════════════╗");
            println!("║  ◈ PrismOS v0.1.0 — Local-First AI OS       ║");
            println!("║  Patent Pending — US [application number]              ║");
            println!("╚══════════════════════════════════════════════╝");
            println!("📍 Data directory: {:?}", app_dir);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            process_intent,
            query_ollama,
            get_spectrum_nodes,
            add_spectrum_node,
            get_active_agents,
            check_ollama_status,
            list_ollama_models,
            create_sandbox,
            export_you_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrismOS");
}
