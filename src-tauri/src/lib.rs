// Patent Pending — US 63/993,589 (Feb 28, 2026)
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
async fn execute_sandbox(name: String, task: String) -> Result<String, String> {
    let mut prism = sandbox_prism::create_prism(&name);
    let result = sandbox_prism::execute_in_sandbox(&mut prism, &task);
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rollback_sandbox(name: String) -> Result<String, String> {
    let mut prism = sandbox_prism::create_prism(&name);
    let checkpoint = sandbox_prism::rollback(&mut prism);
    serde_json::to_string(&checkpoint).map_err(|e| e.to_string())
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
            println!("║  Patent Pending — US 63/993,589              ║");
            println!("╚══════════════════════════════════════════════╝");
            println!("📍 Data directory: {:?}", app_dir);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            process_intent,
            query_ollama,
            get_spectrum_nodes,
            get_spectrum_node,
            add_spectrum_node,
            search_spectrum_nodes,
            delete_spectrum_node,
            add_spectrum_edge,
            get_node_connections,
            get_graph_stats,
            get_active_agents,
            check_ollama_status,
            list_ollama_models,
            create_sandbox,
            execute_sandbox,
            rollback_sandbox,
            export_you_port,
            import_you_port,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrismOS");
}
