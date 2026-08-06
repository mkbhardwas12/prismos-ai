// Spectrum Graph — Persistent Multi-Layered Knowledge Graph
//
// The Spectrum Graph is PrismOS-AI's persistent memory system.
// Architecture:
//   Layer 1 — SQLite relational store: nodes (life facets), edges, metadata
//   Layer 2 — Intent weight layer: dynamic edge weights with closed-loop feedback
//   Layer 3 — Temporal decay layer: recency-weighted relevance scoring
//   Layer 4 — Anticipation layer: pattern-based need prediction
//
// Nodes represent "life facets" — work, health, finance, social, learning, etc.
// Edges carry dynamic intent weights updated through closed-loop feedback.

use chrono::{DateTime, Timelike, Utc};
use rusqlite::{backup, params, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::io::Read;
use std::path::Path;
use uuid::Uuid;

// ─── Data Models ───────────────────────────────────────────────────────────────

/// A node in the Spectrum Graph representing a life facet or knowledge fragment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumNode {
    pub id: String,
    pub label: String,
    pub content: String,
    pub node_type: String, // facet types: work, health, finance, social, learning, memory, task, note
    pub layer: String,     // graph layer: core, context, ephemeral
    pub access_count: u32,
    pub last_accessed: String,
    pub created_at: String,
    pub updated_at: String,
    pub connections: Vec<String>,
}

/// A directed edge with dynamic intent weight and feedback tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    pub weight: f64,
    pub momentum: f64, // rate of weight change (closed-loop feedback velocity)
    pub reinforcements: u32, // number of times this edge was reinforced
    pub last_reinforced: String,
    pub created_at: String,
}

/// Full graph snapshot for frontend visualization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSnapshot {
    pub nodes: Vec<SpectrumNode>,
    pub edges: Vec<SpectrumEdge>,
    pub stats: GraphMetrics,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<GraphViewMetadata>,
}

/// Explains how a bounded UI snapshot relates to the complete local store.
/// The graph view deliberately summarizes generated suggestions and may cap
/// very large corpora; backups and retrieval continue to use the underlying
/// records rather than this presentation projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphViewMetadata {
    pub total_node_count: usize,
    pub total_edge_count: usize,
    pub shown_node_count: usize,
    pub shown_edge_count: usize,
    pub summarized_suggestion_count: usize,
    pub omitted_due_to_limit: usize,
}

/// Extended graph metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphMetrics {
    pub node_count: usize,
    pub edge_count: usize,
    pub avg_edge_weight: f64,
    pub strongest_edge_weight: f64,
    pub facet_distribution: HashMap<String, usize>,
    pub most_connected_node: Option<String>,
    pub graph_density: f64,
}

/// An anticipated need predicted from graph patterns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnticipatedNeed {
    pub suggestion: String,
    pub facet: String,
    pub confidence: f64,
    pub related_nodes: Vec<String>,
    pub reasoning: String,
}

/// A proactive suggestion — structured, actionable, stored in the graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProactiveSuggestion {
    pub id: String,
    pub text: String,
    /// The full intent string to send when the user clicks the card
    pub action_intent: String,
    /// Emoji icon for the card
    pub icon: String,
    /// Category label: "patterns", "momentum", "connections", "habits"
    pub category: String,
    /// 0.0–1.0 confidence in the suggestion
    pub confidence: f64,
}

/// Intent query result with relevance scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentQueryResult {
    pub node: SpectrumNode,
    pub relevance_score: f64,
    pub path_strength: f64,
    pub temporal_boost: f64,
}

/// Durable metadata for an explicitly approved project knowledge source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeSourceSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub file_count: usize,
    pub chunk_count: usize,
    pub bytes_indexed: u64,
    pub skipped_files: usize,
    pub error_count: usize,
    pub status: String,
    pub last_indexed: String,
}

#[derive(Debug, Clone)]
pub struct KnowledgeChunkRecord {
    pub id: String,
    pub label: String,
    pub content: String,
    pub source_path: String,
    pub content_hash: String,
}

/// New Project Knowledge excerpts are deliberately non-portable. Reject their
/// recognizable node shapes from older/raw snapshots too, so a restore cannot
/// create source text that has lost its refresh/Forget ownership metadata.
fn is_managed_knowledge_snapshot_node(node: &SpectrumNode) -> bool {
    node.node_type == "project_chunk"
        || (node.node_type == "project"
            && node.id.starts_with("project-")
            && node.id.ends_with(":overview"))
}

/// Older file-watcher builds created ownerless document snapshots with this
/// exact shape. They can contain copied local source text but have no durable
/// source record to refresh or forget, so they must not cross backup/sync
/// boundaries. Keep this deliberately narrow so ordinary user documents remain
/// portable.
fn is_legacy_watcher_snapshot_node(node: &SpectrumNode) -> bool {
    node.node_type == "document"
        && node.label.starts_with("📄 ")
        && node.content.starts_with("Local file:")
}

/// Earlier builds silently persisted one-off chat attachments as `doc_chunk`
/// nodes. New attachment analysis is ephemeral; exclude any historical copies
/// from every portable export/import/merge boundary as well.
fn is_ephemeral_attachment_snapshot_node(node: &SpectrumNode) -> bool {
    node.node_type == "doc_chunk"
}

fn is_nonportable_snapshot_node(node: &SpectrumNode) -> bool {
    is_managed_knowledge_snapshot_node(node)
        || is_legacy_watcher_snapshot_node(node)
        || is_ephemeral_attachment_snapshot_node(node)
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/// Weight decay factor per day of inactivity (closed-loop temporal decay)
const WEIGHT_DECAY_PER_DAY: f64 = 0.02;
/// Minimum edge weight before pruning consideration
const MIN_EDGE_WEIGHT: f64 = 0.05;
/// Maximum edge weight (prevents runaway reinforcement)
const MAX_EDGE_WEIGHT: f64 = 10.0;
/// Reinforcement boost per feedback signal
const REINFORCEMENT_DELTA: f64 = 0.15;
/// Momentum smoothing factor (exponential moving average)
const MOMENTUM_ALPHA: f64 = 0.3;
/// Temporal boost half-life in hours for query relevance
const TEMPORAL_HALF_LIFE_HOURS: f64 = 168.0; // 1 week

// Imported snapshots are untrusted, even after an outer encrypted package has
// been authenticated. These limits bound parsing follow-on work, diff memory,
// and SQLite growth. The aggregate text budget also prevents many individually
// valid fields from creating an oversized import.
#[cfg(test)]
const MAX_IMPORT_FILE_BYTES: u64 = 96 * 1024 * 1024;
const MAX_IMPORT_NODES: usize = 25_000;
const MAX_IMPORT_EDGES: usize = 100_000;
const MAX_IMPORT_TOTAL_TEXT_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMPORT_NODE_ID_BYTES: usize = 256;
const MAX_IMPORT_LABEL_BYTES: usize = 2 * 1024;
const MAX_IMPORT_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_IMPORT_NODE_TYPE_BYTES: usize = 128;
const MAX_IMPORT_LAYER_BYTES: usize = 64;
const MAX_IMPORT_TIMESTAMP_BYTES: usize = 128;
const MAX_IMPORT_RELATION_BYTES: usize = 256;
const MAX_IMPORT_CONNECTIONS_PER_NODE: usize = 4_096;
const MAX_IMPORT_FACETS: usize = 512;
const MAX_LIVE_FEEDBACK_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_LIVE_CONTEXT_NODES: usize = 256;
const MAX_LIVE_ENTITIES: usize = 256;
const MAX_EMBEDDING_DIMENSIONS: usize = 16_384;
const MAX_VECTOR_RESULTS: usize = 100;

const LEGACY_DEMO_CLEANUP_MIGRATION: &str = "legacy_demo_cleanup_v1";
const LEGACY_DEMO_NODES: &[(&str, &str, &str, &str, &str)] = &[
    (
        "demo-work-1",
        "Weekly Goals",
        "Track and review weekly professional goals, deadlines, and deliverables",
        "work",
        "core",
    ),
    (
        "demo-work-2",
        "Meeting Notes",
        "Capture and organize notes from team meetings, 1:1s, and standups",
        "work",
        "context",
    ),
    (
        "demo-learning-1",
        "Learning Rust",
        "Study notes on Rust ownership, lifetimes, and async patterns",
        "learning",
        "core",
    ),
    (
        "demo-learning-2",
        "AI Research",
        "Papers and insights on local LLM inference, RAG systems, and agent architectures",
        "learning",
        "context",
    ),
    (
        "demo-health-1",
        "Fitness Tracker",
        "Daily exercise log: running, strength training, stretching routines",
        "health",
        "core",
    ),
    (
        "demo-health-2",
        "Sleep Habits",
        "Track sleep patterns, quality, and habits for better rest",
        "health",
        "context",
    ),
    (
        "demo-finance-1",
        "Budget Overview",
        "Monthly income, expenses, savings goals, and investment tracking",
        "finance",
        "core",
    ),
    (
        "demo-task-1",
        "Home Projects",
        "Organize home improvement tasks, shopping lists, and maintenance schedules",
        "task",
        "context",
    ),
    (
        "demo-social-1",
        "Family Events",
        "Birthdays, anniversaries, family gatherings, and gift ideas",
        "social",
        "context",
    ),
    (
        "demo-memory-1",
        "Travel Plans",
        "Trip ideas, itineraries, packing lists, and travel memories",
        "memory",
        "context",
    ),
];
const LEGACY_DEMO_EDGES: &[(&str, &str, &str, &str, f64)] = &[
    (
        "demo-edge-1",
        "demo-work-1",
        "demo-work-2",
        "feeds_into",
        0.8,
    ),
    (
        "demo-edge-2",
        "demo-learning-1",
        "demo-work-1",
        "supports",
        0.7,
    ),
    (
        "demo-edge-3",
        "demo-learning-2",
        "demo-learning-1",
        "related_to",
        0.6,
    ),
    (
        "demo-edge-4",
        "demo-health-1",
        "demo-health-2",
        "affects",
        0.75,
    ),
    (
        "demo-edge-5",
        "demo-work-1",
        "demo-finance-1",
        "impacts",
        0.5,
    ),
    (
        "demo-edge-6",
        "demo-task-1",
        "demo-social-1",
        "related_to",
        0.4,
    ),
    (
        "demo-edge-7",
        "demo-health-1",
        "demo-work-1",
        "enables",
        0.6,
    ),
    (
        "demo-edge-8",
        "demo-memory-1",
        "demo-social-1",
        "connects_to",
        0.5,
    ),
];
const LEGACY_DEMO_INTENTS: &[(&str, &str)] = &[
    ("What are my top priorities this week?", "query"),
    ("Help me plan a healthy meal prep for the week", "task"),
    ("Summarize the latest Rust async patterns", "learning"),
    ("Track my morning run: 5K in 28 minutes", "health"),
    ("Review my monthly budget and spending", "finance"),
];

type GraphResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn validate_import_text(
    value: &str,
    field: &str,
    max_bytes: usize,
    allow_empty: bool,
    total_bytes: &mut usize,
) -> GraphResult<()> {
    if !allow_empty && value.trim().is_empty() {
        return Err(format!("Invalid graph snapshot: {field} cannot be empty").into());
    }
    if value.len() > max_bytes {
        return Err(format!("Invalid graph snapshot: {field} exceeds {max_bytes} bytes").into());
    }
    if value.contains('\0') {
        return Err(format!("Invalid graph snapshot: {field} contains a NUL byte").into());
    }
    *total_bytes = total_bytes
        .checked_add(value.len())
        .ok_or("Invalid graph snapshot: text size overflow")?;
    if *total_bytes > MAX_IMPORT_TOTAL_TEXT_BYTES {
        return Err(format!(
            "Invalid graph snapshot: text exceeds {} bytes",
            MAX_IMPORT_TOTAL_TEXT_BYTES
        )
        .into());
    }
    Ok(())
}

fn validate_import_timestamp(value: &str, field: &str, total_bytes: &mut usize) -> GraphResult<()> {
    validate_import_text(value, field, MAX_IMPORT_TIMESTAMP_BYTES, false, total_bytes)?;
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| format!("Invalid graph snapshot: {field} is not RFC 3339"))?;
    Ok(())
}

fn validate_import_snapshot(snapshot: &GraphSnapshot) -> GraphResult<()> {
    if snapshot.nodes.len() > MAX_IMPORT_NODES {
        return Err(format!(
            "Invalid graph snapshot: {} nodes exceeds the limit of {}",
            snapshot.nodes.len(),
            MAX_IMPORT_NODES
        )
        .into());
    }
    if snapshot.edges.len() > MAX_IMPORT_EDGES {
        return Err(format!(
            "Invalid graph snapshot: {} edges exceeds the limit of {}",
            snapshot.edges.len(),
            MAX_IMPORT_EDGES
        )
        .into());
    }
    if snapshot.stats.node_count != snapshot.nodes.len()
        || snapshot.stats.edge_count != snapshot.edges.len()
    {
        return Err("Invalid graph snapshot: statistics do not match graph contents".into());
    }
    if !snapshot.stats.avg_edge_weight.is_finite()
        || !snapshot.stats.strongest_edge_weight.is_finite()
        || !snapshot.stats.graph_density.is_finite()
    {
        return Err("Invalid graph snapshot: statistics contain non-finite values".into());
    }
    if snapshot.stats.facet_distribution.len() > MAX_IMPORT_FACETS {
        return Err(format!(
            "Invalid graph snapshot: facet count exceeds {}",
            MAX_IMPORT_FACETS
        )
        .into());
    }

    let mut total_bytes = 0_usize;
    let mut node_ids = HashSet::with_capacity(snapshot.nodes.len());
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let prefix = format!("nodes[{index}]");
        validate_import_text(
            &node.id,
            &format!("{prefix}.id"),
            MAX_IMPORT_NODE_ID_BYTES,
            false,
            &mut total_bytes,
        )?;
        if !node_ids.insert(node.id.as_str()) {
            return Err(format!("Invalid graph snapshot: duplicate node id '{}'", node.id).into());
        }
        validate_import_text(
            &node.label,
            &format!("{prefix}.label"),
            MAX_IMPORT_LABEL_BYTES,
            true,
            &mut total_bytes,
        )?;
        validate_import_text(
            &node.content,
            &format!("{prefix}.content"),
            MAX_IMPORT_CONTENT_BYTES,
            true,
            &mut total_bytes,
        )?;
        validate_import_text(
            &node.node_type,
            &format!("{prefix}.node_type"),
            MAX_IMPORT_NODE_TYPE_BYTES,
            false,
            &mut total_bytes,
        )?;
        validate_import_text(
            &node.layer,
            &format!("{prefix}.layer"),
            MAX_IMPORT_LAYER_BYTES,
            false,
            &mut total_bytes,
        )?;
        validate_import_timestamp(
            &node.last_accessed,
            &format!("{prefix}.last_accessed"),
            &mut total_bytes,
        )?;
        validate_import_timestamp(
            &node.created_at,
            &format!("{prefix}.created_at"),
            &mut total_bytes,
        )?;
        validate_import_timestamp(
            &node.updated_at,
            &format!("{prefix}.updated_at"),
            &mut total_bytes,
        )?;
        if node.connections.len() > MAX_IMPORT_CONNECTIONS_PER_NODE {
            return Err(format!(
                "Invalid graph snapshot: {prefix}.connections exceeds {} entries",
                MAX_IMPORT_CONNECTIONS_PER_NODE
            )
            .into());
        }
        for (connection_index, connection) in node.connections.iter().enumerate() {
            validate_import_text(
                connection,
                &format!("{prefix}.connections[{connection_index}]"),
                MAX_IMPORT_NODE_ID_BYTES,
                false,
                &mut total_bytes,
            )?;
        }
    }

    let mut edge_ids = HashSet::with_capacity(snapshot.edges.len());
    for (index, edge) in snapshot.edges.iter().enumerate() {
        let prefix = format!("edges[{index}]");
        validate_import_text(
            &edge.id,
            &format!("{prefix}.id"),
            MAX_IMPORT_NODE_ID_BYTES,
            false,
            &mut total_bytes,
        )?;
        if !edge_ids.insert(edge.id.as_str()) {
            return Err(format!("Invalid graph snapshot: duplicate edge id '{}'", edge.id).into());
        }
        validate_import_text(
            &edge.source_id,
            &format!("{prefix}.source_id"),
            MAX_IMPORT_NODE_ID_BYTES,
            false,
            &mut total_bytes,
        )?;
        validate_import_text(
            &edge.target_id,
            &format!("{prefix}.target_id"),
            MAX_IMPORT_NODE_ID_BYTES,
            false,
            &mut total_bytes,
        )?;
        validate_import_text(
            &edge.relation,
            &format!("{prefix}.relation"),
            MAX_IMPORT_RELATION_BYTES,
            false,
            &mut total_bytes,
        )?;
        validate_import_timestamp(
            &edge.last_reinforced,
            &format!("{prefix}.last_reinforced"),
            &mut total_bytes,
        )?;
        validate_import_timestamp(
            &edge.created_at,
            &format!("{prefix}.created_at"),
            &mut total_bytes,
        )?;
        if !edge.weight.is_finite() || !(MIN_EDGE_WEIGHT..=MAX_EDGE_WEIGHT).contains(&edge.weight) {
            return Err(format!(
                "Invalid graph snapshot: {prefix}.weight is outside the supported range"
            )
            .into());
        }
        if !edge.momentum.is_finite()
            || !(-MAX_EDGE_WEIGHT..=MAX_EDGE_WEIGHT).contains(&edge.momentum)
        {
            return Err(format!(
                "Invalid graph snapshot: {prefix}.momentum is outside the supported range"
            )
            .into());
        }
    }

    for facet in snapshot.stats.facet_distribution.keys() {
        validate_import_text(
            facet,
            "stats.facet_distribution key",
            MAX_IMPORT_NODE_TYPE_BYTES,
            false,
            &mut total_bytes,
        )?;
    }
    if let Some(label) = &snapshot.stats.most_connected_node {
        validate_import_text(
            label,
            "stats.most_connected_node",
            MAX_IMPORT_LABEL_BYTES,
            true,
            &mut total_bytes,
        )?;
    }

    Ok(())
}

fn validate_live_text(
    value: &str,
    field: &str,
    max_bytes: usize,
    allow_empty: bool,
) -> GraphResult<()> {
    if !allow_empty && value.trim().is_empty() {
        return Err(format!("{field} cannot be empty").into());
    }
    if value.len() > max_bytes {
        return Err(format!("{field} exceeds {max_bytes} bytes").into());
    }
    if value.contains('\0') {
        return Err(format!("{field} contains a NUL byte").into());
    }
    Ok(())
}

fn validate_graph_id(value: &str, field: &str) -> GraphResult<()> {
    validate_live_text(value, field, MAX_IMPORT_NODE_ID_BYTES, false)?;
    if value.trim() != value || value.chars().any(char::is_control) {
        return Err(format!("{field} contains whitespace padding or control characters").into());
    }
    Ok(())
}

fn validate_graph_token(value: &str, field: &str, max_bytes: usize) -> GraphResult<()> {
    validate_live_text(value, field, max_bytes, false)?;
    if !value.is_ascii()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(format!("{field} contains unsupported characters").into());
    }
    Ok(())
}

fn validate_node_write(
    label: &str,
    content: &str,
    node_type: &str,
    layer: &str,
) -> GraphResult<()> {
    validate_live_text(label, "node label", MAX_IMPORT_LABEL_BYTES, false)?;
    validate_live_text(content, "node content", MAX_IMPORT_CONTENT_BYTES, true)?;
    validate_graph_token(node_type, "node type", MAX_IMPORT_NODE_TYPE_BYTES)?;
    if !matches!(layer, "core" | "context" | "knowledge" | "ephemeral") {
        return Err("node layer must be core, context, knowledge, or ephemeral".into());
    }
    Ok(())
}

// ─── Spectrum Graph Engine ─────────────────────────────────────────────────────

pub struct SpectrumGraph {
    conn: Connection,
}

/// Initialize the optional external-content FTS index. The backfill is guarded
/// by a durable marker so opening another graph connection does not re-tokenize
/// the entire knowledge base. `BEGIN IMMEDIATE` plus a second marker check keeps
/// concurrent first-open attempts from performing the rebuild twice.
fn initialize_fts(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS prismos_internal_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
            label,
            content,
            content='nodes',
            content_rowid='rowid',
            tokenize='unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS nodes_fts_ai AFTER INSERT ON nodes BEGIN
            INSERT INTO nodes_fts(rowid, label, content)
            VALUES (new.rowid, new.label, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS nodes_fts_ad AFTER DELETE ON nodes BEGIN
            INSERT INTO nodes_fts(nodes_fts, rowid, label, content)
            VALUES ('delete', old.rowid, old.label, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS nodes_fts_au AFTER UPDATE OF label, content ON nodes BEGIN
            INSERT INTO nodes_fts(nodes_fts, rowid, label, content)
            VALUES ('delete', old.rowid, old.label, old.content);
            INSERT INTO nodes_fts(rowid, label, content)
            VALUES (new.rowid, new.label, new.content);
        END;
        ",
    )?;

    let already_backfilled: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM prismos_internal_migrations
            WHERE id = 'nodes_fts_backfill_v1'
        )",
        [],
        |row| row.get(0),
    )?;
    if already_backfilled {
        return Ok(());
    }

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let migration_result = (|| -> rusqlite::Result<()> {
        let applied_by_another_connection: bool = conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM prismos_internal_migrations
                WHERE id = 'nodes_fts_backfill_v1'
            )",
            [],
            |row| row.get(0),
        )?;
        if !applied_by_another_connection {
            conn.execute("INSERT INTO nodes_fts(nodes_fts) VALUES ('rebuild')", [])?;
            conn.execute(
                "INSERT INTO prismos_internal_migrations (id, applied_at)
                 VALUES ('nodes_fts_backfill_v1', ?1)",
                params![Utc::now().to_rfc3339()],
            )?;
        }
        Ok(())
    })();

    match migration_result {
        Ok(()) => conn.execute_batch("COMMIT;"),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

/// Remove the fabricated starter graph written by releases that seeded an
/// empty production profile. This deliberately behaves like a data migration,
/// not a prefix purge: only byte-for-byte fixture rows from the original
/// timestamp cohort are eligible. Any node that was edited, accessed, embedded,
/// referenced by user history, or connected by a non-fixture/adopted edge is
/// retained. Likewise, reinforced edges and edges with feedback are retained.
fn cleanup_legacy_demo_data(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS prismos_internal_migrations (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let already_applied: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM prismos_internal_migrations WHERE id = ?1
        )",
        params![LEGACY_DEMO_CLEANUP_MIGRATION],
        |row| row.get(0),
    )?;
    if already_applied {
        return Ok(());
    }

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let migration_result = (|| -> rusqlite::Result<()> {
        let applied_by_another_connection: bool = conn.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM prismos_internal_migrations WHERE id = ?1
            )",
            params![LEGACY_DEMO_CLEANUP_MIGRATION],
            |row| row.get(0),
        )?;
        if applied_by_another_connection {
            return Ok(());
        }

        // All legacy fixture rows were inserted with one RFC3339 timestamp.
        // Recover it only from fixed IDs whose descriptive fields still match
        // the fixture, then require it on every deletion below.
        let mut cohort_timestamps = HashSet::new();
        for (id, label, content, node_type, layer) in LEGACY_DEMO_NODES {
            let mut statement = conn.prepare(
                "SELECT created_at FROM nodes
                 WHERE id = ?1 AND label = ?2 AND content = ?3
                   AND node_type = ?4 AND layer = ?5",
            )?;
            let timestamps = statement
                .query_map(params![id, label, content, node_type, layer], |row| {
                    row.get::<_, String>(0)
                })?;
            for timestamp in timestamps {
                cohort_timestamps.insert(timestamp?);
            }
        }

        for timestamp in &cohort_timestamps {
            // Intent IDs were randomized by the old seed. The exact fixture
            // body plus the shared node timestamp is the safe provenance key.
            for (raw_input, intent_type) in LEGACY_DEMO_INTENTS {
                conn.execute(
                    "DELETE FROM intent_log
                     WHERE raw_input = ?1 AND intent_type = ?2
                       AND matched_nodes = '[]' AND confidence = 0.85
                       AND created_at = ?3",
                    params![raw_input, intent_type, timestamp],
                )?;
            }

            // Remove only untouched fixture edges. Feedback or reinforcement
            // is evidence of adoption and keeps both the edge and its nodes.
            for (id, source_id, target_id, relation, weight) in LEGACY_DEMO_EDGES {
                conn.execute(
                    "DELETE FROM edges
                     WHERE id = ?1 AND source_id = ?2 AND target_id = ?3
                       AND relation = ?4 AND weight = ?5 AND momentum = 0.05
                       AND reinforcements = 0
                       AND last_reinforced = ?6 AND created_at = ?6
                       AND NOT EXISTS (
                           SELECT 1 FROM feedback WHERE feedback.edge_id = edges.id
                       )",
                    params![id, source_id, target_id, relation, weight, timestamp],
                )?;
            }

            // Exact mutable defaults prove the node was never touched. The
            // reference checks avoid cascading or dangling user-created state.
            for (id, label, content, node_type, layer) in LEGACY_DEMO_NODES {
                let quoted_id = format!("%\"{id}\"%");
                conn.execute(
                    "DELETE FROM nodes
                     WHERE id = ?1 AND label = ?2 AND content = ?3
                       AND node_type = ?4 AND layer = ?5
                       AND embedding IS NULL AND access_count = 1
                       AND last_accessed = ?6 AND created_at = ?6 AND updated_at = ?6
                       AND knowledge_source_id IS NULL AND source_path IS NULL
                       AND content_hash IS NULL AND source_generation IS NULL
                       AND NOT EXISTS (
                           SELECT 1 FROM edges
                           WHERE edges.source_id = nodes.id OR edges.target_id = nodes.id
                       )
                       AND NOT EXISTS (
                           SELECT 1 FROM dismissed_predictions
                           WHERE dismissed_predictions.source_id = nodes.id
                              OR dismissed_predictions.target_id = nodes.id
                       )
                       AND NOT EXISTS (
                           SELECT 1 FROM intent_log
                           WHERE intent_log.matched_nodes LIKE ?7
                       )
                       AND NOT EXISTS (
                           SELECT 1 FROM response_feedback
                           WHERE response_feedback.context_nodes LIKE ?7
                       )",
                    params![id, label, content, node_type, layer, timestamp, quoted_id],
                )?;
            }
        }

        conn.execute(
            "INSERT INTO prismos_internal_migrations (id, applied_at) VALUES (?1, ?2)",
            params![LEGACY_DEMO_CLEANUP_MIGRATION, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    })();

    match migration_result {
        Ok(()) => conn.execute_batch("COMMIT;"),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

impl SpectrumGraph {
    /// Initialize the Spectrum Graph with full multi-layered SQLite backend
    pub fn new(app_dir: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let db_path = app_dir.join("spectrum_graph.db");
        let conn = Connection::open(db_path)?;

        // The graph contains private conversations and project excerpts. SQLite
        // is not encrypted at rest yet, so at minimum keep it private to the OS
        // account instead of inheriting a world-readable umask.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(app_dir, std::fs::Permissions::from_mode(0o700))?;
            std::fs::set_permissions(
                app_dir.join("spectrum_graph.db"),
                std::fs::Permissions::from_mode(0o600),
            )?;
        }

        // Enable WAL mode for better concurrent read performance. Secure
        // deletion overwrites freed SQLite cells so deleted prompts and project
        // excerpts are not left intact in reusable database pages.
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")?;

        // ── Step 1: Create tables (safe for both fresh and existing DBs) ──
        conn.execute_batch(
            "
            -- Layer 1: Core relational store
            CREATE TABLE IF NOT EXISTS nodes (
                id              TEXT PRIMARY KEY,
                label           TEXT NOT NULL,
                content         TEXT NOT NULL,
                node_type       TEXT NOT NULL DEFAULT 'note',
                layer           TEXT NOT NULL DEFAULT 'context',
                embedding       BLOB,
                access_count    INTEGER NOT NULL DEFAULT 0,
                last_accessed   TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );

            -- Layer 2: Intent-weighted edges with feedback tracking
            CREATE TABLE IF NOT EXISTS edges (
                id              TEXT PRIMARY KEY,
                source_id       TEXT NOT NULL,
                target_id       TEXT NOT NULL,
                relation        TEXT NOT NULL DEFAULT 'related',
                weight          REAL NOT NULL DEFAULT 1.0,
                momentum        REAL NOT NULL DEFAULT 0.0,
                reinforcements  INTEGER NOT NULL DEFAULT 0,
                last_reinforced TEXT NOT NULL,
                created_at      TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            -- Layer 3: Intent history for pattern mining
            CREATE TABLE IF NOT EXISTS intent_log (
                id              TEXT PRIMARY KEY,
                raw_input       TEXT NOT NULL,
                intent_type     TEXT NOT NULL,
                matched_nodes   TEXT NOT NULL DEFAULT '[]',
                confidence      REAL NOT NULL DEFAULT 0.0,
                created_at      TEXT NOT NULL
            );

            -- Layer 4: Feedback signals for closed-loop learning
            CREATE TABLE IF NOT EXISTS feedback (
                id              TEXT PRIMARY KEY,
                edge_id         TEXT NOT NULL,
                signal          REAL NOT NULL,
                source          TEXT NOT NULL DEFAULT 'implicit',
                created_at      TEXT NOT NULL,
                FOREIGN KEY (edge_id) REFERENCES edges(id) ON DELETE CASCADE
            );

            -- Layer 5: Response-level user feedback for learning
            CREATE TABLE IF NOT EXISTS response_feedback (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                question        TEXT NOT NULL,
                response        TEXT NOT NULL,
                rating          INTEGER NOT NULL,
                context_nodes   TEXT NOT NULL DEFAULT '[]',
                model           TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            );

            -- Layer 6: Cognitive Imprint — adaptive response personality
            CREATE TABLE IF NOT EXISTS cognitive_profile (
                id                  TEXT PRIMARY KEY DEFAULT 'default',
                depth               REAL NOT NULL DEFAULT 0.5,
                creativity          REAL NOT NULL DEFAULT 0.3,
                formality           REAL NOT NULL DEFAULT 0.5,
                technical_level     REAL NOT NULL DEFAULT 0.5,
                example_preference  REAL NOT NULL DEFAULT 0.5,
                interaction_count   INTEGER NOT NULL DEFAULT 0,
                last_updated        TEXT NOT NULL DEFAULT ''
            );
            ",
        )?;

        // ── New layers for Cognitive Drift, Edge Prophecy, Refraction Journal, etc. ──
        conn.execute_batch(
            "
            -- Layer 7: Cognitive Timeline — weekly snapshots for drift detection
            CREATE TABLE IF NOT EXISTS cognitive_timeline (
                id                  TEXT PRIMARY KEY,
                iso_week            TEXT NOT NULL,
                depth               REAL NOT NULL,
                creativity          REAL NOT NULL,
                formality           REAL NOT NULL,
                technical_level     REAL NOT NULL,
                example_preference  REAL NOT NULL,
                interaction_count   INTEGER NOT NULL,
                snapshot_at         TEXT NOT NULL
            );

            -- Layer 8: Dismissed Edge Predictions
            CREATE TABLE IF NOT EXISTS dismissed_predictions (
                id              TEXT PRIMARY KEY,
                source_id       TEXT NOT NULL,
                target_id       TEXT NOT NULL,
                dismissed_at    TEXT NOT NULL
            );

            -- Layer 9: Refraction Log — tracks refraction band choices
            CREATE TABLE IF NOT EXISTS refraction_log (
                id              TEXT PRIMARY KEY,
                query           TEXT NOT NULL,
                query_type      TEXT NOT NULL,
                natural_band    TEXT NOT NULL,
                applied_band    TEXT NOT NULL,
                user_override   TEXT,
                created_at      TEXT NOT NULL
            );

            -- Layer 10: Agent Memory — per-agent key-value memory
            CREATE TABLE IF NOT EXISTS agent_memory (
                id              TEXT PRIMARY KEY,
                agent_name      TEXT NOT NULL,
                memory_key      TEXT NOT NULL,
                memory_value    TEXT NOT NULL,
                content_hash    TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );

            -- Layer 11: Domain Profile — coarse query-topic mix (legacy table name)
            CREATE TABLE IF NOT EXISTS domain_profile (
                id              TEXT PRIMARY KEY DEFAULT 'default',
                domain_counts   TEXT NOT NULL DEFAULT '{}',
                total_queries   INTEGER NOT NULL DEFAULT 0,
                primary_domain  TEXT NOT NULL DEFAULT 'General',
                confidence      REAL NOT NULL DEFAULT 0.0,
                last_updated    TEXT NOT NULL DEFAULT ''
            );

            -- Layer 12: Model Performance — per-model performance tracking
            CREATE TABLE IF NOT EXISTS model_performance (
                id              TEXT PRIMARY KEY,
                model_name      TEXT NOT NULL,
                domain          TEXT NOT NULL DEFAULT 'General',
                latency_ms      REAL NOT NULL,
                satisfaction    REAL NOT NULL DEFAULT 0.0,
                query_type      TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            );

            -- Approved, versioned project roots used by the local knowledge index.
            CREATE TABLE IF NOT EXISTS knowledge_sources (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                root_path       TEXT NOT NULL UNIQUE,
                file_count      INTEGER NOT NULL DEFAULT 0,
                chunk_count     INTEGER NOT NULL DEFAULT 0,
                bytes_indexed   INTEGER NOT NULL DEFAULT 0,
                skipped_files   INTEGER NOT NULL DEFAULT 0,
                error_count     INTEGER NOT NULL DEFAULT 0,
                status          TEXT NOT NULL DEFAULT 'ready',
                last_indexed    TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
            ",
        )?;

        // ── Step 2: Migrate existing tables — add new columns if missing ──
        // Each ALTER is its own statement so one failure doesn't block the rest.
        // Errors are expected on fresh installs (columns already exist) — ignored.
        let migrations = [
            "ALTER TABLE nodes ADD COLUMN layer TEXT NOT NULL DEFAULT 'context';",
            "ALTER TABLE nodes ADD COLUMN embedding BLOB;",
            "ALTER TABLE nodes ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;",
            "ALTER TABLE nodes ADD COLUMN last_accessed TEXT NOT NULL DEFAULT '';",
            "ALTER TABLE edges ADD COLUMN momentum REAL NOT NULL DEFAULT 0.0;",
            "ALTER TABLE edges ADD COLUMN reinforcements INTEGER NOT NULL DEFAULT 0;",
            "ALTER TABLE edges ADD COLUMN last_reinforced TEXT NOT NULL DEFAULT '';",
            "ALTER TABLE nodes ADD COLUMN knowledge_source_id TEXT;",
            "ALTER TABLE nodes ADD COLUMN source_path TEXT;",
            "ALTER TABLE nodes ADD COLUMN content_hash TEXT;",
            "ALTER TABLE nodes ADD COLUMN source_generation TEXT;",
        ];
        for sql in &migrations {
            let _ = conn.execute_batch(sql); // Ignore "duplicate column" errors
        }

        // ── Step 3: Create indexes (now safe — all columns guaranteed to exist) ──
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_edges_source      ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target       ON edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_weight       ON edges(weight DESC);
            CREATE INDEX IF NOT EXISTS idx_nodes_type         ON nodes(node_type);
            CREATE INDEX IF NOT EXISTS idx_nodes_layer        ON nodes(layer);
            CREATE INDEX IF NOT EXISTS idx_nodes_updated      ON nodes(updated_at);
            CREATE INDEX IF NOT EXISTS idx_nodes_access       ON nodes(access_count DESC);
            CREATE INDEX IF NOT EXISTS idx_nodes_knowledge_source ON nodes(knowledge_source_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_source_path  ON nodes(source_path);
            CREATE INDEX IF NOT EXISTS idx_nodes_content_hash ON nodes(content_hash);
            CREATE INDEX IF NOT EXISTS idx_intent_log_type    ON intent_log(intent_type);
            CREATE INDEX IF NOT EXISTS idx_intent_log_time    ON intent_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_feedback_edge      ON feedback(edge_id);
            CREATE INDEX IF NOT EXISTS idx_response_fb_conv   ON response_feedback(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_response_fb_rating ON response_feedback(rating DESC);
            ",
        )?;

        // ── Step 3b: Indexes for new layers ──
        conn.execute_batch(
            "
            CREATE INDEX IF NOT EXISTS idx_cognitive_timeline_week ON cognitive_timeline(iso_week);
            CREATE INDEX IF NOT EXISTS idx_refraction_log_time     ON refraction_log(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_memory_agent      ON agent_memory(agent_name);
            CREATE INDEX IF NOT EXISTS idx_agent_memory_hash       ON agent_memory(content_hash);
            CREATE INDEX IF NOT EXISTS idx_model_performance_model ON model_performance(model_name);
            CREATE INDEX IF NOT EXISTS idx_domain_profile_domain   ON domain_profile(primary_domain);
            CREATE INDEX IF NOT EXISTS idx_knowledge_sources_path  ON knowledge_sources(root_path);
            ",
        )?;

        // Optional lexical index. Bundled SQLite normally includes FTS5; if a
        // downstream platform omits it, all retrieval still falls back to the
        // existing LIKE + graph + vector path.
        let _ = initialize_fts(&conn);

        // Older releases populated empty owner profiles with fabricated
        // personal history. Clean only untouched, provably seeded rows.
        cleanup_legacy_demo_data(&conn)?;

        Ok(Self { conn })
    }

    /// Capture the complete live database using SQLite's online-backup API,
    /// then serialize the consistent in-memory destination. Unlike portable
    /// graph exports, this intentionally includes every table, managed project
    /// excerpt, embedding, and learned signal. The caller must encrypt the
    /// returned bytes before they leave memory.
    pub(crate) fn full_database_backup_bytes(&self, max_bytes: u64) -> GraphResult<Vec<u8>> {
        if max_bytes < 100 {
            return Err("Database backup limit is too small".into());
        }

        let page_size: u64 = self
            .conn
            .query_row("PRAGMA page_size", [], |row| row.get(0))?;
        let page_count: u64 = self
            .conn
            .query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let estimated_bytes = page_size
            .checked_mul(page_count)
            .ok_or("Database size overflow")?;
        if estimated_bytes > max_bytes {
            return Err(format!(
                "Private database is {estimated_bytes} bytes, exceeding the vault limit of {max_bytes} bytes"
            )
            .into());
        }

        let mut destination = Connection::open_in_memory()
            .map_err(|error| format!("Cannot open in-memory backup destination: {error}"))?;
        {
            let online_backup = backup::Backup::new(&self.conn, &mut destination)
                .map_err(|error| format!("Cannot initialize SQLite online backup: {error}"))?;
            let mut transient_failures = 0_u8;
            loop {
                let step = online_backup
                    .step(128)
                    .map_err(|error| format!("SQLite online backup step failed: {error}"))?;
                let progress = online_backup.progress();
                if progress.pagecount > 0 {
                    let observed_bytes = page_size
                        .checked_mul(progress.pagecount as u64)
                        .ok_or("Database backup size overflow")?;
                    if observed_bytes > max_bytes {
                        return Err(format!(
                            "Database grew beyond the vault limit of {max_bytes} bytes during backup"
                        )
                        .into());
                    }
                }
                match step {
                    backup::StepResult::Done => break,
                    backup::StepResult::More => transient_failures = 0,
                    backup::StepResult::Busy | backup::StepResult::Locked => {
                        transient_failures = transient_failures.saturating_add(1);
                        if transient_failures > 20 {
                            return Err(
                                "Database remained busy while creating the private vault".into()
                            );
                        }
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    _ => return Err("Unsupported SQLite backup status".into()),
                }
            }
        }

        let integrity: String = destination
            .query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))
            .map_err(|error| format!("Cannot validate in-memory SQLite backup: {error}"))?;
        if integrity != "ok" {
            return Err(format!("SQLite refused the backup integrity check: {integrity}").into());
        }

        let serialized = destination
            .serialize(DatabaseName::Main)
            .map_err(|error| format!("Cannot serialize in-memory SQLite backup: {error}"))?;
        if serialized.len() as u64 > max_bytes {
            return Err(format!(
                "Serialized database exceeds the vault limit of {max_bytes} bytes"
            )
            .into());
        }
        let mut bytes = serialized.to_vec();
        // Online backup captures all committed WAL content in the destination,
        // but page 1 can retain the source's WAL read/write version bytes. A
        // standalone serialized image has no companion WAL and must use the
        // rollback-journal header mode (1) to reopen portably.
        if bytes.len() < 100 || !matches!(bytes[18], 1 | 2) || !matches!(bytes[19], 1 | 2) {
            return Err("Serialized SQLite backup has an invalid database header".into());
        }
        bytes[18] = 1;
        bytes[19] = 1;
        Ok(bytes)
    }

    /// Test-only fixture generator. Production startup must never insert these
    /// fabricated personal-looking records into an owner's knowledge graph.
    #[cfg(test)]
    pub fn seed_demo_data(&self) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let (nodes, _edges) = self.stats()?;
        if nodes > 0 {
            return Ok(false); // Already has data — skip
        }

        let now = chrono::Utc::now().to_rfc3339();

        for (id, label, content, ntype, layer) in LEGACY_DEMO_NODES {
            self.conn.execute(
                "INSERT OR IGNORE INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?6)",
                params![id, label, content, ntype, layer, now],
            )?;
        }

        for (id, src, tgt, rel, weight) in LEGACY_DEMO_EDGES {
            self.conn.execute(
                "INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, weight, momentum, reinforcements, last_reinforced, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0.05, 0, ?6, ?6)",
                params![id, src, tgt, rel, weight, now],
            )?;
        }

        for (raw, itype) in LEGACY_DEMO_INTENTS {
            self.conn.execute(
                "INSERT INTO intent_log (id, raw_input, intent_type, matched_nodes, confidence, created_at)
                 VALUES (?1, ?2, ?3, '[]', 0.85, ?4)",
                params![uuid::Uuid::new_v4().to_string(), raw, itype, now],
            )?;
        }

        Ok(true)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NODE OPERATIONS — Life Facet Management
    // ═══════════════════════════════════════════════════════════════════════

    /// Add a new knowledge node (life facet) to the graph
    pub fn add_node(
        &self,
        label: &str,
        content: &str,
        node_type: &str,
    ) -> Result<SpectrumNode, Box<dyn std::error::Error + Send + Sync>> {
        self.add_node_with_layer(label, content, node_type, "context")
    }

    /// Add a node with explicit layer assignment.
    /// **Deduplicates**: if a node with the same label AND node_type already exists,
    /// it updates the content and bumps access_count + updated_at instead of
    /// creating a duplicate. Returns the existing node in that case.
    pub fn add_node_with_layer(
        &self,
        label: &str,
        content: &str,
        node_type: &str,
        layer: &str,
    ) -> Result<SpectrumNode, Box<dyn std::error::Error + Send + Sync>> {
        validate_node_write(label, content, node_type, layer)?;
        let now = Utc::now().to_rfc3339();

        // ── Dedup check: same label + node_type → update instead of insert ──
        let existing: Option<String> = self
            .conn
            .prepare("SELECT id FROM nodes WHERE label = ?1 AND node_type = ?2 LIMIT 1")?
            .query_row(params![label, node_type], |row| row.get::<_, String>(0))
            .ok();

        if let Some(existing_id) = existing {
            // Bounded replacement: a stable label is an upsert identity. Older
            // builds appended every differing value forever, allowing one node
            // to grow without limit across otherwise valid calls.
            self.conn.execute(
                "UPDATE nodes SET access_count = access_count + 1,
                                  last_accessed = ?1, updated_at = ?1,
                                  embedding = CASE WHEN content = ?2 THEN embedding ELSE NULL END,
                                  content = ?2
                 WHERE id = ?3",
                params![now, content, existing_id],
            )?;

            if let Some(node) = self.get_node(&existing_id)? {
                return Ok(node);
            }
        }

        // No duplicate — fresh insert
        let id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, ?6)",
            params![id, label, content, node_type, layer, now],
        )?;

        Ok(SpectrumNode {
            id,
            label: label.to_string(),
            content: content.to_string(),
            node_type: node_type.to_string(),
            layer: layer.to_string(),
            access_count: 0,
            last_accessed: now.clone(),
            created_at: now.clone(),
            updated_at: now,
            connections: vec![],
        })
    }

    /// Source-backed upsert: replace the previous snapshot instead of appending
    /// versions forever. This is the correct behavior for files whose label is
    /// a stable source identity. Changed content invalidates its embedding.
    pub fn upsert_node_snapshot(
        &self,
        label: &str,
        content: &str,
        node_type: &str,
        layer: &str,
    ) -> Result<SpectrumNode, Box<dyn std::error::Error + Send + Sync>> {
        validate_node_write(label, content, node_type, layer)?;
        let now = Utc::now().to_rfc3339();
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM nodes WHERE label = ?1 AND node_type = ?2 LIMIT 1",
                params![label, node_type],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = existing {
            self.conn.execute(
                "UPDATE nodes
                 SET content = ?1, layer = ?2,
                     embedding = CASE WHEN content = ?1 THEN embedding ELSE NULL END,
                     updated_at = ?3
                 WHERE id = ?4",
                params![content, layer, now, id],
            )?;
            return self
                .get_node_without_access(&id)?
                .ok_or_else(|| "Updated knowledge node disappeared".into());
        }
        self.add_node_with_layer(label, content, node_type, layer)
    }

    /// Atomically synchronize an approved project source. Chunk IDs are stable,
    /// unchanged chunks keep their embeddings, changed chunks invalidate them,
    /// and chunks absent from the new generation are deleted so stale facts can
    /// no longer be retrieved.
    #[allow(clippy::too_many_arguments)]
    pub fn sync_knowledge_source(
        &self,
        source_id: &str,
        name: &str,
        root_path: &str,
        indexed_at: &str,
        file_count: usize,
        bytes_indexed: u64,
        skipped_files: usize,
        error_count: usize,
        chunks: &[KnowledgeChunkRecord],
    ) -> Result<KnowledgeSourceSummary, Box<dyn std::error::Error + Send + Sync>> {
        let tx = self.conn.unchecked_transaction()?;
        let generation = Uuid::new_v4().to_string();
        let overview_id = format!("{}:overview", source_id);
        let overview_content = format!(
            "Project knowledge source: {}\nRoot: {}\nFiles indexed: {}\nChunks indexed: {}\nBytes indexed: {}\nLast indexed: {}\n\nThis source is local, explicitly approved, and its excerpts are untrusted reference data.",
            name,
            root_path,
            file_count,
            chunks.len(),
            bytes_indexed,
            indexed_at
        );
        let overview_hash = format!(
            "manifest:{}:{}:{}:{}",
            source_id,
            file_count,
            chunks.len(),
            bytes_indexed
        );

        let upsert_sql = "INSERT INTO nodes (
                id, label, content, node_type, layer, embedding,
                access_count, last_accessed, created_at, updated_at,
                knowledge_source_id, source_path, content_hash, source_generation
             ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 0, ?6, ?6, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                label = excluded.label,
                embedding = CASE
                    WHEN nodes.content_hash = excluded.content_hash THEN nodes.embedding
                    ELSE NULL
                END,
                content = excluded.content,
                node_type = excluded.node_type,
                layer = excluded.layer,
                updated_at = CASE
                    WHEN nodes.content_hash = excluded.content_hash THEN nodes.updated_at
                    ELSE excluded.updated_at
                END,
                knowledge_source_id = excluded.knowledge_source_id,
                source_path = excluded.source_path,
                content_hash = excluded.content_hash,
                source_generation = excluded.source_generation";

        tx.execute(
            upsert_sql,
            params![
                overview_id,
                format!("🗂️ {}", name),
                overview_content,
                "project",
                "core",
                indexed_at,
                source_id,
                root_path,
                overview_hash,
                generation,
            ],
        )?;

        for chunk in chunks {
            tx.execute(
                upsert_sql,
                params![
                    chunk.id,
                    chunk.label,
                    chunk.content,
                    "project_chunk",
                    "knowledge",
                    indexed_at,
                    source_id,
                    chunk.source_path,
                    chunk.content_hash,
                    generation,
                ],
            )?;
        }

        tx.execute(
            "DELETE FROM nodes
             WHERE knowledge_source_id = ?1
               AND COALESCE(source_generation, '') <> ?2",
            params![source_id, generation],
        )?;

        tx.execute(
            "INSERT INTO knowledge_sources (
                id, name, root_path, file_count, chunk_count, bytes_indexed,
                skipped_files, error_count, status, last_indexed, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'ready', ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                root_path = excluded.root_path,
                file_count = excluded.file_count,
                chunk_count = excluded.chunk_count,
                bytes_indexed = excluded.bytes_indexed,
                skipped_files = excluded.skipped_files,
                error_count = excluded.error_count,
                status = excluded.status,
                last_indexed = excluded.last_indexed,
                updated_at = excluded.updated_at",
            params![
                source_id,
                name,
                root_path,
                file_count as i64,
                chunks.len() as i64,
                bytes_indexed.min(i64::MAX as u64) as i64,
                skipped_files as i64,
                error_count as i64,
                indexed_at,
            ],
        )?;
        tx.commit()?;

        Ok(KnowledgeSourceSummary {
            id: source_id.to_string(),
            name: name.to_string(),
            root_path: root_path.to_string(),
            file_count,
            chunk_count: chunks.len(),
            bytes_indexed,
            skipped_files,
            error_count,
            status: "ready".into(),
            last_indexed: indexed_at.to_string(),
        })
    }

    pub fn list_knowledge_sources(
        &self,
    ) -> Result<Vec<KnowledgeSourceSummary>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, root_path, file_count, chunk_count, bytes_indexed,
                    skipped_files, error_count, status, last_indexed
             FROM knowledge_sources
             ORDER BY updated_at DESC",
        )?;
        let sources = stmt
            .query_map([], |row| {
                Ok(KnowledgeSourceSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    root_path: row.get(2)?,
                    file_count: row.get::<_, i64>(3)?.max(0) as usize,
                    chunk_count: row.get::<_, i64>(4)?.max(0) as usize,
                    bytes_indexed: row.get::<_, i64>(5)?.max(0) as u64,
                    skipped_files: row.get::<_, i64>(6)?.max(0) as usize,
                    error_count: row.get::<_, i64>(7)?.max(0) as usize,
                    status: row.get(8)?,
                    last_indexed: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(sources)
    }

    pub fn knowledge_source_exists(
        &self,
        source_id: &str,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let exists = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM knowledge_sources WHERE id = ?1)",
            params![source_id],
            |row| row.get(0),
        )?;
        Ok(exists)
    }

    pub fn node_ids_include_managed_knowledge(
        &self,
        node_ids: &[String],
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        for node_id in node_ids {
            let is_managed: bool = self.conn.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM nodes
                    WHERE id = ?1 AND knowledge_source_id IS NOT NULL
                )",
                params![node_id],
                |row| row.get(0),
            )?;
            if is_managed {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Forget one explicitly selected project source and all of its owned
    /// chunks. Cross-source/user nodes are untouched.
    pub fn delete_knowledge_source(
        &self,
        source_id: &str,
    ) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let tx = self.conn.unchecked_transaction()?;
        let source_node_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM nodes WHERE knowledge_source_id = ?1")?;
            let rows = stmt.query_map(params![source_id], |row| row.get(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for node_id in &source_node_ids {
            tx.execute(
                "DELETE FROM response_feedback WHERE context_nodes LIKE ?1 ESCAPE '\\'",
                params![format!("%\"{}\"%", node_id)],
            )?;
        }
        // Remove generated conversations/entities that copied source-grounded
        // response text in older app versions. These nodes are recognizable by
        // type/content and a direct provenance edge to this managed source.
        let derived_conversations = tx.execute(
            "DELETE FROM nodes
             WHERE node_type = 'conversation'
               AND id IN (
                    SELECT e.source_id
                    FROM edges e
                    JOIN nodes source_node ON source_node.id = e.target_id
                    WHERE e.relation = 'derived_from'
                      AND source_node.knowledge_source_id = ?1
               )",
            params![source_id],
        )?;
        let derived_entities = tx.execute(
            "DELETE FROM nodes
             WHERE node_type = 'entity'
               AND content LIKE 'Concept extracted from conversation:%'
               AND id IN (
                    SELECT e.source_id
                    FROM edges e
                    JOIN nodes source_node ON source_node.id = e.target_id
                    WHERE e.relation = 'related_to'
                      AND source_node.knowledge_source_id = ?1
               )",
            params![source_id],
        )?;
        let source_nodes = tx.execute(
            "DELETE FROM nodes WHERE knowledge_source_id = ?1",
            params![source_id],
        )?;
        tx.execute(
            "DELETE FROM knowledge_sources WHERE id = ?1",
            params![source_id],
        )?;
        tx.commit()?;
        Ok(source_nodes + derived_conversations + derived_entities)
    }

    /// Retrieve all nodes with connections populated, ordered by recency
    pub fn get_all_nodes(
        &self,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes ORDER BY updated_at DESC LIMIT 500",
        )?;

        let mut nodes: Vec<SpectrumNode> = stmt
            .query_map([], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Populate connections for all nodes in a single query (avoids N+1)
        let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
        if !node_ids.is_empty() {
            let placeholders: String = node_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT source_id, target_id FROM edges WHERE source_id IN ({p}) OR target_id IN ({p})",
                p = placeholders
            );
            let mut edge_stmt = self.conn.prepare(&sql)?;
            // Build params: each node_id appears twice (for source_id IN + target_id IN)
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            for id in &node_ids {
                params.push(Box::new(id.clone()));
            }
            for id in &node_ids {
                params.push(Box::new(id.clone()));
            }
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();

            let edges: Vec<(String, String)> = edge_stmt
                .query_map(param_refs.as_slice(), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .filter_map(|r| r.ok())
                .collect();

            // Build a lookup: node_id → list of connected node_ids
            let mut conn_map: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            for (src, tgt) in &edges {
                conn_map.entry(src.clone()).or_default().push(tgt.clone());
                conn_map.entry(tgt.clone()).or_default().push(src.clone());
            }

            for node in &mut nodes {
                if let Some(conns) = conn_map.remove(&node.id) {
                    node.connections = conns;
                }
            }
        }

        Ok(nodes)
    }

    /// Get a single node by ID, incrementing access count (closed-loop signal)
    pub fn get_node(
        &self,
        id: &str,
    ) -> Result<Option<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().to_rfc3339();

        // Increment access count — implicit feedback signal
        self.conn.execute(
            "UPDATE nodes SET access_count = access_count + 1, last_accessed = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SpectrumNode {
                id: row.get(0)?,
                label: row.get(1)?,
                content: row.get(2)?,
                node_type: row.get(3)?,
                layer: row.get(4)?,
                access_count: row.get(5)?,
                last_accessed: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                connections: vec![],
            })
        })?;

        match rows.next() {
            Some(node) => {
                let mut n = node?;
                let mut edge_stmt = self.conn.prepare(
                    "SELECT CASE WHEN source_id = ?1 THEN target_id ELSE source_id END
                     FROM edges WHERE source_id = ?1 OR target_id = ?1",
                )?;
                n.connections = edge_stmt
                    .query_map(params![n.id], |row| row.get(0))?
                    .collect::<Result<Vec<String>, _>>()?;
                Ok(Some(n))
            }
            None => Ok(None),
        }
    }

    /// Full-text search across node labels and content
    pub fn search_nodes(
        &self,
        query: &str,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        validate_live_text(query, "search query", 64 * 1024, false)?;
        let pattern = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes WHERE label LIKE ?1 OR content LIKE ?1
             ORDER BY COALESCE(access_count, 0) DESC, updated_at DESC LIMIT 50",
        )?;

        let nodes = stmt
            .query_map(params![pattern], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(nodes)
    }

    /// Delete a node and all its edges (cascade)
    pub fn delete_node(&self, id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(id, "node id")?;
        self.conn.execute(
            "DELETE FROM edges WHERE source_id = ?1 OR target_id = ?1",
            params![id],
        )?;
        self.conn
            .execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Update a node's content and touch its timestamp (used by Tauri command)
    pub fn update_node(
        &self,
        id: &str,
        label: &str,
        content: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(id, "node id")?;
        validate_live_text(label, "node label", MAX_IMPORT_LABEL_BYTES, false)?;
        validate_live_text(content, "node content", MAX_IMPORT_CONTENT_BYTES, true)?;
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE nodes SET label = ?1, content = ?2,
                              embedding = CASE WHEN content = ?2 THEN embedding ELSE NULL END,
                              updated_at = ?3 WHERE id = ?4",
            params![label, content, now, id],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  EDGE OPERATIONS — Dynamic Intent Weights
    // ═══════════════════════════════════════════════════════════════════════

    /// Add a relationship edge between two nodes with initial weight
    pub fn add_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relation: &str,
        weight: f64,
    ) -> Result<SpectrumEdge, Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(source_id, "edge source id")?;
        validate_graph_id(target_id, "edge target id")?;
        validate_graph_token(relation, "edge relation", MAX_IMPORT_RELATION_BYTES)?;
        if source_id == target_id {
            return Err("edge source and target must differ".into());
        }
        if !weight.is_finite() {
            return Err("edge weight must be finite".into());
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let clamped = weight.clamp(MIN_EDGE_WEIGHT, MAX_EDGE_WEIGHT);

        self.conn.execute(
            "INSERT INTO edges (id, source_id, target_id, relation, weight, momentum, reinforcements, last_reinforced, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0.0, 0, ?6, ?6)",
            params![id, source_id, target_id, relation, clamped, now],
        )?;

        Ok(SpectrumEdge {
            id,
            source_id: source_id.to_string(),
            target_id: target_id.to_string(),
            relation: relation.to_string(),
            weight: clamped,
            momentum: 0.0,
            reinforcements: 0,
            last_reinforced: now.clone(),
            created_at: now,
        })
    }

    /// Get or create an edge between two nodes (upsert pattern)
    /// Returns `(edge, was_created)` — `was_created` is true only when a new edge was inserted.
    pub fn get_or_create_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relation: &str,
    ) -> Result<(SpectrumEdge, bool), Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(source_id, "edge source id")?;
        validate_graph_id(target_id, "edge target id")?;
        validate_graph_token(relation, "edge relation", MAX_IMPORT_RELATION_BYTES)?;
        if source_id == target_id {
            return Err("edge source and target must differ".into());
        }
        // Check if edge already exists
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight,
                    COALESCE(momentum, 0.0), COALESCE(reinforcements, 0),
                    COALESCE(last_reinforced, created_at), created_at
             FROM edges
             WHERE (source_id = ?1 AND target_id = ?2) OR (source_id = ?2 AND target_id = ?1)
             LIMIT 1",
        )?;

        let mut rows = stmt.query_map(params![source_id, target_id], |row| {
            Ok(SpectrumEdge {
                id: row.get(0)?,
                source_id: row.get(1)?,
                target_id: row.get(2)?,
                relation: row.get(3)?,
                weight: row.get(4)?,
                momentum: row.get(5)?,
                reinforcements: row.get(6)?,
                last_reinforced: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        match rows.next() {
            Some(edge) => Ok((edge?, false)),
            None => Ok((self.add_edge(source_id, target_id, relation, 1.0)?, true)),
        }
    }

    /// **Closed-Loop Feedback**: Update edge weight with reinforcement signal
    ///
    /// This is the core mechanism: edges strengthen when the user
    /// follows predicted paths, and weaken through temporal decay.
    /// Uses exponential moving average momentum for smooth adaptation.
    pub fn update_edge_weight(
        &self,
        edge_id: &str,
        feedback_signal: f64, // positive = reinforce, negative = weaken
    ) -> Result<SpectrumEdge, Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(edge_id, "edge id")?;
        if !feedback_signal.is_finite() || !(-1.0..=1.0).contains(&feedback_signal) {
            return Err("feedback signal must be finite and between -1 and 1".into());
        }
        let now = Utc::now().to_rfc3339();

        // Fetch current edge state
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight,
                    COALESCE(momentum, 0.0), COALESCE(reinforcements, 0),
                    COALESCE(last_reinforced, created_at), created_at
             FROM edges WHERE id = ?1",
        )?;

        let edge: SpectrumEdge = stmt.query_row(params![edge_id], |row| {
            Ok(SpectrumEdge {
                id: row.get(0)?,
                source_id: row.get(1)?,
                target_id: row.get(2)?,
                relation: row.get(3)?,
                weight: row.get(4)?,
                momentum: row.get(5)?,
                reinforcements: row.get(6)?,
                last_reinforced: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

        // Apply temporal decay since last reinforcement
        let decay = self.calculate_temporal_decay(&edge.last_reinforced);
        let decayed_weight = edge.weight * decay;

        // Compute new momentum (EMA of feedback signals)
        let new_momentum =
            MOMENTUM_ALPHA * feedback_signal + (1.0 - MOMENTUM_ALPHA) * edge.momentum;

        // Apply reinforcement delta scaled by signal strength
        let weight_delta = REINFORCEMENT_DELTA * feedback_signal;
        let new_weight = (decayed_weight + weight_delta).clamp(MIN_EDGE_WEIGHT, MAX_EDGE_WEIGHT);

        let new_reinforcements = edge.reinforcements + 1;

        // Persist updated edge
        self.conn.execute(
            "UPDATE edges SET weight = ?1, momentum = ?2, reinforcements = ?3, last_reinforced = ?4
             WHERE id = ?5",
            params![new_weight, new_momentum, new_reinforcements, now, edge_id],
        )?;

        // Log feedback signal for analytics
        let fb_id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO feedback (id, edge_id, signal, source, created_at)
             VALUES (?1, ?2, ?3, 'closed_loop', ?4)",
            params![fb_id, edge_id, feedback_signal, now],
        )?;

        Ok(SpectrumEdge {
            id: edge.id,
            source_id: edge.source_id,
            target_id: edge.target_id,
            relation: edge.relation,
            weight: new_weight,
            momentum: new_momentum,
            reinforcements: new_reinforcements,
            last_reinforced: now,
            created_at: edge.created_at,
        })
    }

    /// Get all edges connected to a node
    pub fn get_connections(
        &self,
        node_id: &str,
    ) -> Result<Vec<SpectrumEdge>, Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(node_id, "node id")?;
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight,
                    COALESCE(momentum, 0.0), COALESCE(reinforcements, 0),
                    COALESCE(last_reinforced, created_at), created_at
             FROM edges WHERE source_id = ?1 OR target_id = ?1
             ORDER BY weight DESC",
        )?;

        let edges = stmt
            .query_map(params![node_id], |row| {
                Ok(SpectrumEdge {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    target_id: row.get(2)?,
                    relation: row.get(3)?,
                    weight: row.get(4)?,
                    momentum: row.get(5)?,
                    reinforcements: row.get(6)?,
                    last_reinforced: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(edges)
    }

    /// Get all edges in the graph
    pub fn get_all_edges(
        &self,
    ) -> Result<Vec<SpectrumEdge>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight,
                    COALESCE(momentum, 0.0), COALESCE(reinforcements, 0),
                    COALESCE(last_reinforced, created_at), created_at
             FROM edges ORDER BY weight DESC LIMIT 1000",
        )?;

        let edges = stmt
            .query_map([], |row| {
                Ok(SpectrumEdge {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    target_id: row.get(2)?,
                    relation: row.get(3)?,
                    weight: row.get(4)?,
                    momentum: row.get(5)?,
                    reinforcements: row.get(6)?,
                    last_reinforced: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(edges)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  QUERY INTENT — Graph-Aware Semantic Retrieval
    // ═══════════════════════════════════════════════════════════════════════

    /// FTS5/BM25 lexical candidates. Failure is intentionally non-fatal because
    /// some downstream SQLite builds may omit FTS5.
    fn fts_search_nodes(
        &self,
        terms: &[String],
        limit: usize,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut seen = std::collections::HashSet::new();
        let tokens: Vec<String> = terms
            .iter()
            .flat_map(|term| term.split(|c: char| !c.is_alphanumeric() && c != '_'))
            .map(|token| token.to_lowercase())
            .filter(|token| token.len() >= 3 && seen.insert(token.clone()))
            .take(16)
            .collect();
        if tokens.is_empty() {
            return Ok(vec![]);
        }
        let query = tokens
            .iter()
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let mut stmt = self.conn.prepare(
            "SELECT n.id, n.label, n.content, n.node_type,
                    COALESCE(n.layer, 'context'), COALESCE(n.access_count, 0),
                    COALESCE(n.last_accessed, n.updated_at), n.created_at, n.updated_at
             FROM nodes_fts
             JOIN nodes n ON n.rowid = nodes_fts.rowid
             WHERE nodes_fts MATCH ?1
             ORDER BY bm25(nodes_fts)
             LIMIT ?2",
        )?;
        let nodes = stmt
            .query_map(params![query, limit as i64], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(nodes)
    }

    /// Query the Spectrum Graph for nodes relevant to a parsed intent.
    /// Combines text matching, edge weight traversal, temporal boosting,
    /// and access frequency into a unified relevance score.
    pub fn query_intent(
        &self,
        raw_input: &str,
        intent_type: &str,
        entities: &[String],
    ) -> Result<Vec<IntentQueryResult>, Box<dyn std::error::Error + Send + Sync>> {
        validate_live_text(raw_input, "intent input", 64 * 1024, false)?;
        validate_graph_token(intent_type, "intent type", MAX_IMPORT_NODE_TYPE_BYTES)?;
        if entities.len() > MAX_LIVE_ENTITIES {
            return Err(format!("intent entities exceed {MAX_LIVE_ENTITIES} items").into());
        }
        for entity in entities {
            validate_live_text(entity, "intent entity", MAX_IMPORT_LABEL_BYTES, false)?;
        }
        let now = Utc::now().to_rfc3339();

        // Log this intent for pattern mining
        let log_id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO intent_log (id, raw_input, intent_type, matched_nodes, confidence, created_at)
             VALUES (?1, ?2, ?3, '[]', 0.0, ?4)",
            params![log_id, raw_input, intent_type, now],
        )?;

        // Build a bounded, deduplicated token set. Project corpora can contain
        // thousands of chunks, so an unbounded LIKE scan per prompt word turns
        // long chat input into quadratic-feeling retrieval latency.
        let stop_words: &[&str] = &[
            "what", "when", "where", "which", "whom", "whose", "that", "this", "these", "those",
            "there", "their", "about", "after", "again", "been", "before", "being", "between",
            "both", "could", "does", "doing", "down", "each", "from", "have", "here", "just",
            "know", "like", "make", "many", "more", "most", "much", "must", "need", "only",
            "other", "over", "same", "should", "some", "such", "take", "tell", "than", "them",
            "then", "they", "very", "want", "well", "were", "will", "with", "would", "your",
            "also", "been", "came", "come", "even", "ever", "every", "give", "goes", "going",
            "gone", "good", "great", "help", "into", "keep", "last", "long", "look", "made",
            "might", "move", "next", "once", "open", "part", "play", "please", "point", "right",
            "show", "still", "think", "thought", "time", "turn", "under", "upon", "used", "using",
            "went", "work",
        ];
        let mut search_terms = Vec::new();
        let mut seen_terms = HashSet::new();
        let tokens = entities
            .iter()
            .flat_map(|entity| {
                entity.split(|character: char| !character.is_alphanumeric() && character != '_')
            })
            .chain(
                raw_input.split(|character: char| !character.is_alphanumeric() && character != '_'),
            );
        for token in tokens {
            let lower = token.to_lowercase();
            if lower.len() >= 3
                && !stop_words.contains(&lower.as_str())
                && seen_terms.insert(lower.clone())
            {
                search_terms.push(lower);
                if search_terms.len() >= 16 {
                    break;
                }
            }
        }

        // Phase 1: Direct text match scoring
        let mut results: Vec<IntentQueryResult> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        // BM25 gives the large project corpus a real lexical index instead of
        // relying solely on repeated `%LIKE%` scans. Rank is fused with the
        // existing graph/temporal/access signals below.
        if let Ok(fts_nodes) = self.fts_search_nodes(&search_terms, 30) {
            for (rank, node) in fts_nodes.into_iter().enumerate() {
                seen_ids.insert(node.id.clone());
                let temporal_boost = self.calculate_temporal_boost(&node.updated_at);
                let access_boost = (node.access_count as f64).ln().max(0.0) * 0.05;
                let rank_bonus = 0.35 / (rank as f64 + 1.0);
                results.push(IntentQueryResult {
                    relevance_score: 0.55 + rank_bonus + access_boost,
                    path_strength: 0.0,
                    temporal_boost,
                    node,
                });
            }
        }

        // Leading-wildcard LIKE is a compatibility fallback for SQLite builds
        // without FTS5 or unusually sparse FTS results. Bound it tightly so a
        // large multi-project corpus is not scanned once per prompt token.
        let fallback_terms: Vec<&String> = if results.len() < 8 {
            search_terms.iter().take(4).collect()
        } else {
            vec![]
        };
        for term in fallback_terms {
            let escaped = term
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            let pattern = format!("%{}%", escaped);
            let mut stmt = self.conn.prepare(
                "SELECT id, label, content, node_type,
                        COALESCE(layer, 'context'), COALESCE(access_count, 0),
                        COALESCE(last_accessed, updated_at), created_at, updated_at
                 FROM nodes
                 WHERE label LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\'
                 LIMIT 30",
            )?;

            let nodes: Vec<SpectrumNode> = stmt
                .query_map(params![pattern], |row| {
                    Ok(SpectrumNode {
                        id: row.get(0)?,
                        label: row.get(1)?,
                        content: row.get(2)?,
                        node_type: row.get(3)?,
                        layer: row.get(4)?,
                        access_count: row.get(5)?,
                        last_accessed: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        connections: vec![],
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;

            for node in nodes {
                if seen_ids.contains(&node.id) {
                    // Boost existing result for multi-term match
                    if let Some(r) = results.iter_mut().find(|r| r.node.id == node.id) {
                        r.relevance_score += 0.2;
                    }
                    continue;
                }
                seen_ids.insert(node.id.clone());

                let temporal_boost = self.calculate_temporal_boost(&node.updated_at);
                let access_boost = (node.access_count as f64).ln().max(0.0) * 0.05;

                results.push(IntentQueryResult {
                    relevance_score: 0.5 + access_boost,
                    path_strength: 0.0,
                    temporal_boost,
                    node,
                });
            }
        }

        // Bound graph expansion before issuing per-node connection queries.
        results.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(40);

        // Phase 2: Graph traversal — boost nodes connected to top lexical matches.
        let matched_ids: Vec<String> = results.iter().take(16).map(|r| r.node.id.clone()).collect();
        for mid in &matched_ids {
            let edges = self.get_connections(mid)?;
            for edge in edges.iter().take(16) {
                let neighbor_id = if edge.source_id == *mid {
                    &edge.target_id
                } else {
                    &edge.source_id
                };

                // Apply temporal decay to edge weight
                let decay = self.calculate_temporal_decay(&edge.last_reinforced);
                let effective_weight = edge.weight * decay;

                if let Some(r) = results.iter_mut().find(|r| r.node.id == *neighbor_id) {
                    r.path_strength += effective_weight * 0.3;
                } else if effective_weight > 0.3 && results.len() < 64 {
                    // Pull in strongly connected neighbors not yet in results
                    if let Ok(Some(neighbor)) = self.get_node_without_access(neighbor_id) {
                        let temporal_boost = self.calculate_temporal_boost(&neighbor.updated_at);
                        results.push(IntentQueryResult {
                            relevance_score: 0.2,
                            path_strength: effective_weight * 0.3,
                            temporal_boost,
                            node: neighbor,
                        });
                    }
                }
            }
        }

        // Phase 3: Compute final scores and sort
        for r in &mut results {
            r.relevance_score = r.relevance_score + r.path_strength + r.temporal_boost * 0.1;
        }
        results.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(20);

        // Update intent log with matched node IDs
        let matched: Vec<String> = results.iter().map(|r| r.node.id.clone()).collect();
        let matched_json = serde_json::to_string(&matched).unwrap_or_default();
        let avg_conf = if results.is_empty() {
            0.0
        } else {
            results.iter().map(|r| r.relevance_score).sum::<f64>() / results.len() as f64
        };
        self.conn.execute(
            "UPDATE intent_log SET matched_nodes = ?1, confidence = ?2 WHERE id = ?3",
            params![matched_json, avg_conf, log_id],
        )?;

        Ok(results)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DEDUPLICATE NODES — Clean up duplicate label+type entries
    // ═══════════════════════════════════════════════════════════════════════

    /// Merge user/legacy duplicate nodes (same label + node_type) into one.
    /// Source-owned knowledge nodes are excluded because their stable IDs and
    /// ownership boundaries are authoritative even when two projects share a
    /// directory name and relative path.
    /// Keeps the oldest node, merges content, sums access_count,
    /// re-points edges, and deletes the extras. Returns count merged.
    pub fn deduplicate_nodes(&self) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
        // Find groups of duplicates
        let mut stmt = self.conn.prepare(
            "SELECT label, node_type, COUNT(*) AS cnt
             FROM nodes
             WHERE knowledge_source_id IS NULL
             GROUP BY label, node_type
             HAVING cnt > 1
             ORDER BY cnt DESC",
        )?;

        let dup_groups: Vec<(String, String, u32)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut total_merged: u32 = 0;

        for (label, node_type, _count) in &dup_groups {
            // Get all nodes in this group, oldest first
            let mut grp = self.conn.prepare(
                "SELECT id, content, COALESCE(access_count, 0)
                 FROM nodes
                 WHERE label = ?1 AND node_type = ?2
                   AND knowledge_source_id IS NULL
                 ORDER BY created_at ASC",
            )?;

            let members: Vec<(String, String, u32)> = grp
                .query_map(params![label, node_type], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, u32>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            if members.len() < 2 {
                continue;
            }

            let keeper_id = &members[0].0;
            let mut total_access: u32 = members[0].2;

            for dup in &members[1..] {
                let dup_id = &dup.0;
                total_access += dup.2;

                // Re-point edges from duplicate → keeper
                self.conn.execute(
                    "UPDATE OR IGNORE edges SET source_id = ?1 WHERE source_id = ?2",
                    params![keeper_id, dup_id],
                )?;
                self.conn.execute(
                    "UPDATE OR IGNORE edges SET target_id = ?1 WHERE target_id = ?2",
                    params![keeper_id, dup_id],
                )?;

                // Delete orphan edges that now point to same node on both sides
                self.conn
                    .execute("DELETE FROM edges WHERE source_id = target_id", [])?;

                // Delete duplicate edges that couldn't be re-pointed (OR IGNORE skipped them)
                self.conn.execute(
                    "DELETE FROM edges WHERE source_id = ?1 OR target_id = ?1",
                    params![dup_id],
                )?;

                // Delete the duplicate node
                self.conn
                    .execute("DELETE FROM nodes WHERE id = ?1", params![dup_id])?;
                total_merged += 1;
            }

            // Update keeper with merged access count
            let now = Utc::now().to_rfc3339();
            self.conn.execute(
                "UPDATE nodes SET access_count = ?1, updated_at = ?2 WHERE id = ?3",
                params![total_access, now, keeper_id],
            )?;
        }

        Ok(total_merged)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ANTICIPATE NEEDS — Predictive Intent Engine
    // ═══════════════════════════════════════════════════════════════════════

    /// Analyze graph patterns to predict what the user might need next.
    /// Uses: recent intent history, high-momentum edges, access patterns,
    /// and temporal clustering to generate anticipatory suggestions.
    #[allow(clippy::type_complexity)] // Row tuple mirrors the bounded SQL projection below.
    pub fn anticipate_needs(
        &self,
    ) -> Result<Vec<AnticipatedNeed>, Box<dyn std::error::Error + Send + Sync>> {
        let mut needs: Vec<AnticipatedNeed> = Vec::new();

        // Strategy 1: High-momentum edges indicate emerging interests
        // Skip edges where source and target have the same label (duplicates)
        let mut stmt = self.conn.prepare(
            "SELECT e.id, e.source_id, e.target_id, e.relation, e.weight,
                    COALESCE(e.momentum, 0.0), COALESCE(e.reinforcements, 0),
                    ns.label AS source_label, ns.node_type AS source_type,
                    nt.label AS target_label, nt.node_type AS target_type
             FROM edges e
             JOIN nodes ns ON e.source_id = ns.id
             JOIN nodes nt ON e.target_id = nt.id
             WHERE COALESCE(e.momentum, 0.0) > 0.1
               AND ns.label != nt.label
               AND SUBSTR(LOWER(ns.label), 1, 40) != SUBSTR(LOWER(nt.label), 1, 40)
             ORDER BY COALESCE(e.momentum, 0.0) DESC LIMIT 8",
        )?;

        let momentum_edges: Vec<(String, String, String, String, f64, f64, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(7)?,  // source_label
                    row.get::<_, String>(8)?,  // source_type
                    row.get::<_, String>(9)?,  // target_label
                    row.get::<_, String>(10)?, // target_type
                    row.get::<_, f64>(4)?,     // weight
                    row.get::<_, f64>(5)?,     // momentum
                    row.get::<_, String>(1)?,  // source_id
                    row.get::<_, String>(2)?,  // target_id
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (src_label, src_type, tgt_label, tgt_type, weight, momentum, src_id, tgt_id) in
            &momentum_edges
        {
            // Skip if both labels are near-identical (truncated duplicates)
            let src_norm = src_label
                .to_lowercase()
                .chars()
                .take(40)
                .collect::<String>();
            let tgt_norm = tgt_label
                .to_lowercase()
                .chars()
                .take(40)
                .collect::<String>();
            if src_norm == tgt_norm {
                continue;
            }
            // Skip if we already have a suggestion about this pair
            let already_seen = needs
                .iter()
                .any(|n| n.related_nodes.contains(src_id) && n.related_nodes.contains(tgt_id));
            if already_seen {
                continue;
            }

            needs.push(AnticipatedNeed {
                suggestion: format!(
                    "Growing connection between \"{}\" and \"{}\" (momentum: {:.2})",
                    src_label, tgt_label, momentum
                ),
                facet: tgt_type.clone(),
                confidence: (*momentum * 0.5 + *weight * 0.1).min(0.95),
                related_nodes: vec![src_id.clone(), tgt_id.clone()],
                reasoning: format!(
                    "Edge weight {:.2} with momentum {:.2} suggests increasing relevance between {} and {} facets",
                    weight, momentum, src_type, tgt_type
                ),
            });
        }

        // Strategy 2: Recently accessed but unconnected nodes may need linking
        let mut stmt2 = self.conn.prepare(
            "SELECT n.id, n.label, n.node_type, COALESCE(n.access_count, 0)
             FROM nodes n
             WHERE COALESCE(n.access_count, 0) > 2
               AND n.id NOT IN (SELECT source_id FROM edges UNION SELECT target_id FROM edges)
             ORDER BY COALESCE(n.access_count, 0) DESC LIMIT 3",
        )?;

        let orphan_nodes: Vec<(String, String, String, u32)> = stmt2
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (id, label, node_type, access_count) in &orphan_nodes {
            needs.push(AnticipatedNeed {
                suggestion: format!(
                    "\"{}\" is frequently accessed ({} times) but has no connections — consider linking it",
                    label, access_count
                ),
                facet: node_type.clone(),
                confidence: (*access_count as f64 * 0.1).min(0.8),
                related_nodes: vec![id.clone()],
                reasoning: format!(
                    "Node accessed {} times without graph connections suggests missing relationships",
                    access_count
                ),
            });
        }

        // Strategy 3: Recent intent patterns — detect repeated intent types
        let mut stmt3 = self.conn.prepare(
            "SELECT intent_type, COUNT(*) as cnt
             FROM intent_log
             WHERE created_at > datetime('now', '-7 days')
             GROUP BY intent_type
             ORDER BY cnt DESC LIMIT 3",
        )?;

        let intent_patterns: Vec<(String, u32)> = stmt3
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (intent_type, count) in &intent_patterns {
            if *count > 3 {
                needs.push(AnticipatedNeed {
                    suggestion: format!(
                        "You've been doing a lot of \"{}\" lately ({} times this week). Need help organizing?",
                        intent_type, count
                    ),
                    facet: "meta".to_string(),
                    confidence: (*count as f64 * 0.05).min(0.85),
                    related_nodes: vec![],
                    reasoning: format!(
                        "Pattern: {} '{}' intents in the past 7 days indicates focused activity",
                        count, intent_type
                    ),
                });
            }
        }

        // Sort by confidence descending
        needs.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        needs.truncate(10);

        Ok(needs)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PROACTIVE SUGGESTIONS — Human-friendly actionable cards (Phase 1)
    // ═══════════════════════════════════════════════════════════════════════

    /// Generate 2-3 proactive, structured suggestions based on graph patterns.
    /// Returns rich ProactiveSuggestion cards with one-click action intents.
    pub fn generate_proactive_suggestions(
        &self,
    ) -> Result<Vec<ProactiveSuggestion>, Box<dyn std::error::Error + Send + Sync>> {
        let mut suggestions: Vec<ProactiveSuggestion> = Vec::new();

        // ── Strategy 1: High-momentum edges — trending connections ──
        let mut stmt = self.conn.prepare(
            "SELECT ns.label, ns.node_type, nt.label, nt.node_type,
                    e.weight, COALESCE(e.momentum, 0.0) AS mom
             FROM edges e
             JOIN nodes ns ON e.source_id = ns.id
             JOIN nodes nt ON e.target_id = nt.id
             WHERE COALESCE(e.momentum, 0.0) > 0.08
               AND ns.node_type != 'suggestion'
               AND nt.node_type != 'suggestion'
               AND ns.label != nt.label
               AND SUBSTR(LOWER(ns.label), 1, 40) != SUBSTR(LOWER(nt.label), 1, 40)
             ORDER BY mom DESC LIMIT 6",
        )?;

        let high_momentum: Vec<(String, String, String, String, f64, f64)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, f64>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (src, src_type, tgt, _tgt_type, w, m) in &high_momentum {
            // Skip near-identical labels (truncated duplicates)
            let src_norm: String = src.to_lowercase().chars().take(40).collect();
            let tgt_norm: String = tgt.to_lowercase().chars().take(40).collect();
            if src_norm == tgt_norm {
                continue;
            }
            let (text, action, icon) = match src_type.as_str() {
                "work" => (
                    format!("Your \"{}\" ↔ \"{}\" connection is growing fast", src, tgt),
                    format!(
                        "Summarize my recent progress on \"{}\" and how it relates to \"{}\"",
                        src, tgt
                    ),
                    "📈".to_string(),
                ),
                "health" => (
                    format!("\"{}\" and \"{}\" are linked in your health data", src, tgt),
                    format!(
                        "Suggest a wellness routine connecting \"{}\" and \"{}\"",
                        src, tgt
                    ),
                    "💪".to_string(),
                ),
                "finance" => (
                    format!("\"{}\" and \"{}\" are trending together", src, tgt),
                    format!(
                        "Give me a quick budget check for \"{}\" and \"{}\"",
                        src, tgt
                    ),
                    "💰".to_string(),
                ),
                "learning" => (
                    format!("Your learning in \"{}\" connects to \"{}\"", src, tgt),
                    format!(
                        "Create a deeper study plan connecting \"{}\" and \"{}\"",
                        src, tgt
                    ),
                    "📚".to_string(),
                ),
                _ => (
                    format!("\"{}\" and \"{}\" are becoming strongly linked", src, tgt),
                    format!(
                        "Explore how \"{}\" and \"{}\" are connected and what I should do next",
                        src, tgt
                    ),
                    "🔗".to_string(),
                ),
            };
            let confidence = (*w / MAX_EDGE_WEIGHT).clamp(0.3, 1.0) * 0.7 + (*m).min(1.0) * 0.3;
            suggestions.push(ProactiveSuggestion {
                id: Uuid::new_v4().to_string(),
                text,
                action_intent: action,
                icon,
                category: "momentum".to_string(),
                confidence: (confidence * 100.0).round() / 100.0,
            });
        }

        // ── Strategy 2: Repeated intent patterns — habit detection ──
        let mut stmt2 = self.conn.prepare(
            "SELECT intent_type, COUNT(*) as cnt
             FROM intent_log
             WHERE created_at > datetime('now', '-3 days')
             GROUP BY intent_type
             ORDER BY cnt DESC LIMIT 2",
        )?;

        let patterns: Vec<(String, u32)> = stmt2
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (intent_type, count) in &patterns {
            if *count >= 3 && suggestions.len() < 3 {
                let (text, action, icon) = match intent_type.as_str() {
                    "task" | "work" => (
                        format!("You've had {} work intents in 3 days", count),
                        "Organize my current priorities and suggest what to focus on next"
                            .to_string(),
                        "📋".to_string(),
                    ),
                    "question" | "learning" => (
                        format!("Research streak — {} queries recently", count),
                        "Create a summary of everything I've been researching recently".to_string(),
                        "🔬".to_string(),
                    ),
                    "creative" => (
                        format!("Creative streak! {} creative intents", count),
                        "Capture and organize all my recent creative ideas into a coherent plan"
                            .to_string(),
                        "🎨".to_string(),
                    ),
                    _ => (
                        format!("Active with \"{}\" — {} times recently", intent_type, count),
                        format!(
                            "Help me organize my recent activity around \"{}\"",
                            intent_type
                        ),
                        "⚡".to_string(),
                    ),
                };
                suggestions.push(ProactiveSuggestion {
                    id: Uuid::new_v4().to_string(),
                    text,
                    action_intent: action,
                    icon,
                    category: "patterns".to_string(),
                    confidence: (0.5 + (*count as f64 * 0.08).min(0.45)),
                });
            }
        }

        // ── Strategy 3: Orphan nodes — unconnected but frequently accessed ──
        let mut stmt3 = self.conn.prepare(
            "SELECT n.label, n.node_type, COALESCE(n.access_count, 0) as ac
             FROM nodes n
             WHERE COALESCE(n.access_count, 0) > 2
               AND n.node_type != 'suggestion'
               AND n.id NOT IN (SELECT source_id FROM edges UNION SELECT target_id FROM edges)
             ORDER BY ac DESC LIMIT 1",
        )?;

        let orphans: Vec<(String, String, u32)> = stmt3
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        for (label, _ntype, ac) in &orphans {
            if suggestions.len() < 3 {
                suggestions.push(ProactiveSuggestion {
                    id: Uuid::new_v4().to_string(),
                    text: format!("\"{}\" keeps coming up but isn't connected", label),
                    action_intent: format!(
                        "Find connections between \"{}\" and my other knowledge, then link them",
                        label
                    ),
                    icon: "🧩".to_string(),
                    category: "connections".to_string(),
                    confidence: (0.4 + (*ac as f64 * 0.05).min(0.4)),
                });
            }
        }

        // ── Strategy 4: Most-accessed node — suggest review ──
        if suggestions.len() < 3 {
            let mut stmt4 = self.conn.prepare(
                "SELECT label, node_type, access_count
                 FROM nodes
                 WHERE access_count > 5
                   AND node_type != 'suggestion'
                 ORDER BY access_count DESC LIMIT 1",
            )?;
            let top_node: Vec<(String, String, u32)> = stmt4
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, u32>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            for (label, _ntype, ac) in &top_node {
                if suggestions.len() < 3 {
                    suggestions.push(ProactiveSuggestion {
                        id: Uuid::new_v4().to_string(),
                        text: format!("\"{}\" is your most active topic ({} accesses)", label, ac),
                        action_intent: format!("Give me an overview of everything I know about \"{}\" and suggest next steps", label),
                        icon: "⭐".to_string(),
                        category: "habits".to_string(),
                        confidence: (0.6 + (*ac as f64 * 0.02).min(0.35)),
                    });
                }
            }
        }

        // ── Final dedup: remove suggestions with near-identical text ──
        let mut seen_texts: Vec<String> = Vec::new();
        suggestions.retain(|s| {
            let norm: String = s.text.to_lowercase().chars().take(50).collect();
            if seen_texts.iter().any(|t| t == &norm) {
                false
            } else {
                seen_texts.push(norm);
                true
            }
        });

        suggestions.truncate(3);
        Ok(suggestions)
    }

    /// Store a proactive suggestion only for an explicit future save action.
    /// Read-only suggestion endpoints must never call this method.
    pub fn store_proactive_suggestion(
        &self,
        suggestion: &ProactiveSuggestion,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().to_rfc3339();
        let content = format!(
            "Suggestion: {}\nAction: {}\nCategory: {}\nConfidence: {:.0}%",
            suggestion.text,
            suggestion.action_intent,
            suggestion.category,
            suggestion.confidence * 100.0
        );
        self.conn.execute(
            "INSERT OR REPLACE INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'suggestion', 'ephemeral', 0, ?4, ?4, ?4)",
            params![
                suggestion.id,
                format!("{} {}", suggestion.icon, suggestion.text),
                content,
                now,
            ],
        )?;
        Ok(())
    }

    /// Strengthen edges between nodes whose labels fuzzy-match any of the given keywords.
    /// Called automatically after each intent to make the graph react in real-time.
    /// Returns the number of edges strengthened.
    pub fn strengthen_related_edges(
        &self,
        keywords: &[String],
    ) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
        if keywords.is_empty() {
            return Ok(0);
        }

        let now = Utc::now().to_rfc3339();
        let mut strengthened = 0u32;

        // Find node IDs whose labels contain any keyword (case-insensitive)
        let mut matching_ids: Vec<String> = Vec::new();
        for kw in keywords {
            let pattern = format!("%{}%", kw.to_lowercase());
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM nodes WHERE LOWER(label) LIKE ?1 LIMIT 10")?;
            let ids: Vec<String> = stmt
                .query_map(params![pattern], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            matching_ids.extend(ids);
        }

        matching_ids.sort();
        matching_ids.dedup();

        if matching_ids.len() < 2 {
            return Ok(0);
        }

        // Reinforce all edges between matching nodes with a gentle signal
        let signal = 0.3_f64; // gentle reinforcement
        for i in 0..matching_ids.len() {
            for j in (i + 1)..matching_ids.len() {
                let mut stmt = self.conn.prepare(
                    "SELECT id, weight, COALESCE(momentum, 0.0), COALESCE(reinforcements, 0)
                     FROM edges
                     WHERE (source_id = ?1 AND target_id = ?2)
                        OR (source_id = ?2 AND target_id = ?1)",
                )?;

                let edges: Vec<(String, f64, f64, u32)> = stmt
                    .query_map(params![&matching_ids[i], &matching_ids[j]], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, f64>(1)?,
                            row.get::<_, f64>(2)?,
                            row.get::<_, u32>(3)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;

                for (edge_id, weight, momentum, reinforcements) in &edges {
                    let new_momentum = MOMENTUM_ALPHA * signal + (1.0 - MOMENTUM_ALPHA) * momentum;
                    let new_weight = (weight + REINFORCEMENT_DELTA * signal)
                        .clamp(MIN_EDGE_WEIGHT, MAX_EDGE_WEIGHT);
                    let new_reinforcements = reinforcements + 1;

                    self.conn.execute(
                        "UPDATE edges SET weight = ?1, momentum = ?2, reinforcements = ?3, last_reinforced = ?4
                         WHERE id = ?5",
                        params![new_weight, new_momentum, new_reinforcements, now, edge_id],
                    )?;
                    strengthened += 1;
                }
            }
        }

        Ok(strengthened)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  GRAPH SNAPSHOT — Full Graph for Visualization
    // ═══════════════════════════════════════════════════════════════════════

    /// Get the complete graph snapshot for frontend rendering
    pub fn get_full_graph(
        &self,
    ) -> Result<GraphSnapshot, Box<dyn std::error::Error + Send + Sync>> {
        let nodes = self.get_all_nodes()?;
        let edges = self.get_all_edges()?;
        let stats = self.get_metrics()?;

        Ok(GraphSnapshot {
            nodes,
            edges,
            stats,
            view: None,
        })
    }

    /// Build the bounded, representative projection used by the interactive
    /// map. Generated suggestion cards are not durable knowledge and used to
    /// overwhelm the newest-first node limit, so the map summarizes them
    /// instead of rendering hundreds of duplicate, disconnected dots.
    pub fn get_visualization_graph(
        &self,
    ) -> Result<GraphSnapshot, Box<dyn std::error::Error + Send + Sync>> {
        const NODE_LIMIT: usize = 500;

        let total_node_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let total_edge_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        let summarized_suggestion_count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE node_type = 'suggestion'",
            [],
            |row| row.get(0),
        )?;
        let eligible_node_count = total_node_count.saturating_sub(summarized_suggestion_count);

        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes
             WHERE node_type != 'suggestion'
             ORDER BY CASE COALESCE(layer, 'context')
                        WHEN 'core' THEN 0
                        WHEN 'context' THEN 1
                        WHEN 'knowledge' THEN 2
                        ELSE 3
                      END,
                      COALESCE(access_count, 0) DESC,
                      updated_at DESC
             LIMIT ?1",
        )?;
        let mut nodes: Vec<SpectrumNode> = stmt
            .query_map(params![NODE_LIMIT as i64], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let visible_ids: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();
        let edges: Vec<SpectrumEdge> = self
            .get_all_edges()?
            .into_iter()
            .filter(|edge| {
                visible_ids.contains(&edge.source_id) && visible_ids.contains(&edge.target_id)
            })
            .collect();

        let mut connection_map: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &edges {
            connection_map
                .entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
            connection_map
                .entry(edge.target_id.clone())
                .or_default()
                .push(edge.source_id.clone());
        }
        for node in &mut nodes {
            node.connections = connection_map.remove(&node.id).unwrap_or_default();
        }

        let node_count = nodes.len();
        let edge_count = edges.len();
        let avg_edge_weight = if edge_count == 0 {
            0.0
        } else {
            edges.iter().map(|edge| edge.weight).sum::<f64>() / edge_count as f64
        };
        let strongest_edge_weight = edges.iter().map(|edge| edge.weight).fold(0.0_f64, f64::max);
        let mut facet_distribution = HashMap::new();
        for node in &nodes {
            *facet_distribution
                .entry(node.node_type.clone())
                .or_insert(0) += 1;
        }
        let most_connected_node = nodes
            .iter()
            .max_by_key(|node| node.connections.len())
            .map(|node| node.label.clone());
        let max_edges = if node_count > 1 {
            node_count * (node_count - 1) / 2
        } else {
            1
        };

        Ok(GraphSnapshot {
            nodes,
            edges,
            stats: GraphMetrics {
                node_count,
                edge_count,
                avg_edge_weight,
                strongest_edge_weight,
                facet_distribution,
                most_connected_node,
                graph_density: edge_count as f64 / max_edges as f64,
            },
            view: Some(GraphViewMetadata {
                total_node_count,
                total_edge_count,
                shown_node_count: node_count,
                shown_edge_count: edge_count,
                summarized_suggestion_count,
                omitted_due_to_limit: eligible_node_count.saturating_sub(node_count),
            }),
        })
    }

    /// Build a portable snapshot that intentionally excludes approved
    /// project-source excerpts, strict legacy watcher snapshots, and historical
    /// one-off attachment chunks. Project excerpts are regenerable from locally
    /// approved roots; transient attachments have no persistence consent.
    pub fn get_portable_graph(
        &self,
    ) -> Result<GraphSnapshot, Box<dyn std::error::Error + Send + Sync>> {
        let mut node_stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes
             WHERE knowledge_source_id IS NULL
             ORDER BY updated_at DESC",
        )?;
        let mut nodes: Vec<SpectrumNode> = node_stmt
            .query_map([], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        nodes.retain(|node| !is_nonportable_snapshot_node(node));
        let portable_node_ids: HashSet<String> = nodes.iter().map(|node| node.id.clone()).collect();

        let mut edge_stmt = self.conn.prepare(
            "SELECT e.id, e.source_id, e.target_id, e.relation, e.weight,
                    COALESCE(e.momentum, 0.0), COALESCE(e.reinforcements, 0),
                    COALESCE(e.last_reinforced, e.created_at), e.created_at
             FROM edges e
             JOIN nodes source ON source.id = e.source_id
             JOIN nodes target ON target.id = e.target_id
             WHERE source.knowledge_source_id IS NULL
               AND target.knowledge_source_id IS NULL
             ORDER BY e.weight DESC",
        )?;
        let edges: Vec<SpectrumEdge> = edge_stmt
            .query_map([], |row| {
                Ok(SpectrumEdge {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    target_id: row.get(2)?,
                    relation: row.get(3)?,
                    weight: row.get(4)?,
                    momentum: row.get(5)?,
                    reinforcements: row.get(6)?,
                    last_reinforced: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|edge| {
                portable_node_ids.contains(&edge.source_id)
                    && portable_node_ids.contains(&edge.target_id)
            })
            .collect();

        let mut connection_map: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &edges {
            connection_map
                .entry(edge.source_id.clone())
                .or_default()
                .push(edge.target_id.clone());
            connection_map
                .entry(edge.target_id.clone())
                .or_default()
                .push(edge.source_id.clone());
        }
        for node in &mut nodes {
            node.connections = connection_map.remove(&node.id).unwrap_or_default();
        }

        let node_count = nodes.len();
        let edge_count = edges.len();
        let avg_edge_weight = if edge_count == 0 {
            0.0
        } else {
            edges.iter().map(|edge| edge.weight).sum::<f64>() / edge_count as f64
        };
        let strongest_edge_weight = edges.iter().map(|edge| edge.weight).fold(0.0_f64, f64::max);
        let mut facet_distribution = HashMap::new();
        for node in &nodes {
            *facet_distribution
                .entry(node.node_type.clone())
                .or_insert(0) += 1;
        }
        let most_connected_node = nodes
            .iter()
            .max_by_key(|node| node.connections.len())
            .map(|node| node.label.clone());
        let max_edges = if node_count > 1 {
            node_count * (node_count - 1) / 2
        } else {
            1
        };

        let snapshot = GraphSnapshot {
            nodes,
            edges,
            stats: GraphMetrics {
                node_count,
                edge_count,
                avg_edge_weight,
                strongest_edge_weight,
                facet_distribution,
                most_connected_node,
                graph_density: edge_count as f64 / max_edges as f64,
            },
            view: None,
        };
        validate_import_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    /// Compute extended graph metrics
    pub fn get_metrics(&self) -> Result<GraphMetrics, Box<dyn std::error::Error + Send + Sync>> {
        let node_count: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let edge_count: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;

        let avg_edge_weight: f64 =
            self.conn
                .query_row("SELECT COALESCE(AVG(weight), 0.0) FROM edges", [], |row| {
                    row.get(0)
                })?;

        let strongest_edge_weight: f64 =
            self.conn
                .query_row("SELECT COALESCE(MAX(weight), 0.0) FROM edges", [], |row| {
                    row.get(0)
                })?;

        // Facet distribution
        let mut stmt = self
            .conn
            .prepare("SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type")?;
        let facet_distribution: HashMap<String, usize> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Most connected node
        let most_connected_node: Option<String> = self
            .conn
            .query_row(
                "SELECT n.label FROM nodes n
                 LEFT JOIN (
                     SELECT source_id AS nid, COUNT(*) AS c FROM edges GROUP BY source_id
                     UNION ALL
                     SELECT target_id AS nid, COUNT(*) AS c FROM edges GROUP BY target_id
                 ) ec ON n.id = ec.nid
                 GROUP BY n.id
                 ORDER BY COALESCE(SUM(ec.c), 0) DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();

        // Graph density = edges / (nodes * (nodes - 1) / 2)
        let max_edges = if node_count > 1 {
            node_count * (node_count - 1) / 2
        } else {
            1
        };
        let graph_density = edge_count as f64 / max_edges as f64;

        Ok(GraphMetrics {
            node_count,
            edge_count,
            avg_edge_weight,
            strongest_edge_weight,
            facet_distribution,
            most_connected_node,
            graph_density,
        })
    }

    /// Get basic stats (backwards compatible)
    pub fn stats(&self) -> Result<(usize, usize), Box<dyn std::error::Error + Send + Sync>> {
        let node_count: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let edge_count: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        Ok((node_count, edge_count))
    }

    /// Clear all user content and learned state from the Spectrum Graph database.
    /// Schema/migration markers are retained so the database remains usable.
    pub fn clear_graph(&self) -> Result<(usize, usize), Box<dyn std::error::Error + Send + Sync>> {
        let (nodes, edges) = self.stats()?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute_batch(
            "
            DELETE FROM feedback;
            DELETE FROM edges;
            DELETE FROM nodes;
            DELETE FROM knowledge_sources;
            DELETE FROM intent_log;
            DELETE FROM response_feedback;
            DELETE FROM cognitive_profile;
            DELETE FROM cognitive_timeline;
            DELETE FROM dismissed_predictions;
            DELETE FROM refraction_log;
            DELETE FROM agent_memory;
            DELETE FROM domain_profile;
            DELETE FROM model_performance;
            ",
        )?;
        tx.commit()?;

        // The logical delete has committed at this point. Truncate the WAL and
        // rebuild the database so deleted text is not retained in WAL frames or
        // free pages. Report post-commit cleanup failures explicitly: callers
        // must not mistake them for a rolled-back deletion.
        let wal_cleanup_error =
            match self
                .conn
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                }) {
                Ok((0, _, _)) => None,
                Ok((busy, log_frames, checkpointed_frames)) => Some(format!(
                    "WAL cleanup remained busy \
                 ({busy}; {checkpointed_frames}/{log_frames} frames checkpointed)"
                )),
                Err(error) => Some(format!("WAL cleanup failed: {error}")),
            };
        let vacuum_cleanup_error = self
            .conn
            .execute_batch("VACUUM;")
            .err()
            .map(|error| format!("free-space cleanup failed: {error}"));
        let cleanup_errors: Vec<String> = [wal_cleanup_error, vacuum_cleanup_error]
            .into_iter()
            .flatten()
            .collect();
        if !cleanup_errors.is_empty() {
            return Err(format!(
                "All user data was deleted, but SQLite physical cleanup was incomplete: {}",
                cleanup_errors.join("; ")
            )
            .into());
        }
        Ok((nodes, edges))
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  INTERNAL HELPERS — Temporal Decay & Boosting
    // ═══════════════════════════════════════════════════════════════════════

    /// Calculate temporal decay factor for an edge based on time since last reinforcement
    fn calculate_temporal_decay(&self, last_reinforced: &str) -> f64 {
        if last_reinforced.is_empty() {
            return 0.9; // Default for edges without reinforcement timestamps
        }
        match last_reinforced.parse::<DateTime<Utc>>() {
            Ok(dt) => {
                let days_elapsed = (Utc::now() - dt).num_hours() as f64 / 24.0;
                (1.0 - WEIGHT_DECAY_PER_DAY * days_elapsed).max(0.1)
            }
            Err(_) => 0.9,
        }
    }

    /// Calculate temporal relevance boost for a node based on recency
    fn calculate_temporal_boost(&self, updated_at: &str) -> f64 {
        match updated_at.parse::<DateTime<Utc>>() {
            Ok(dt) => {
                let hours_elapsed = (Utc::now() - dt).num_hours() as f64;
                // Exponential decay with configurable half-life
                (0.5_f64).powf(hours_elapsed / TEMPORAL_HALF_LIFE_HOURS)
            }
            Err(_) => 0.1,
        }
    }

    /// Get a node without incrementing access count (internal use only)
    fn get_node_without_access(
        &self,
        id: &str,
    ) -> Result<Option<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SpectrumNode {
                id: row.get(0)?,
                label: row.get(1)?,
                content: row.get(2)?,
                node_type: row.get(3)?,
                layer: row.get(4)?,
                access_count: row.get(5)?,
                last_accessed: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                connections: vec![],
            })
        })?;

        match rows.next() {
            Some(node) => Ok(Some(node?)),
            None => Ok(None),
        }
    }

    /// Apply temporal decay to all edges (maintenance task)
    pub fn decay_all_edges(&self) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
        let edges = self.get_all_edges()?;
        let mut updated: u32 = 0;

        for edge in &edges {
            let decay = self.calculate_temporal_decay(&edge.last_reinforced);
            let new_weight = (edge.weight * decay).max(MIN_EDGE_WEIGHT);

            if (new_weight - edge.weight).abs() > 0.001 {
                self.conn.execute(
                    "UPDATE edges SET weight = ?1 WHERE id = ?2",
                    params![new_weight, edge.id],
                )?;
                updated += 1;
            }
        }

        Ok(updated)
    }

    /// Promote frequently-accessed ephemeral nodes to the context layer.
    /// Nodes that have been accessed 3+ times have proven their value —
    /// they graduate from ephemeral to permanent knowledge.
    pub fn promote_active_nodes(&self) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().to_rfc3339();
        let promoted = self.conn.execute(
            "UPDATE nodes SET layer = 'context', updated_at = ?1
             WHERE layer = 'ephemeral' AND access_count >= 3",
            params![now],
        )?;
        if promoted > 0 {
            eprintln!(
                "[SpectrumGraph] Promoted {} ephemeral nodes to context layer",
                promoted
            );
        }
        Ok(promoted as u32)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PERSIST / LOAD — Explicit Graph Serialization
    // ═══════════════════════════════════════════════════════════════════════

    /// Test-only legacy plaintext serializer. Production export/import is
    /// authenticated and encrypted through the You-Port command surface.
    #[cfg(test)]
    pub fn persist(
        &self,
        export_path: &Path,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let snapshot = self.get_portable_graph()?;

        // Add metadata envelope
        let export = serde_json::json!({
            "format": "prismos-spectrum-graph-v1",
            "exported_at": Utc::now().to_rfc3339(),
            "snapshot": snapshot,
            "intent_log_count": self.conn.query_row(
                "SELECT COUNT(*) FROM intent_log", [], |row| row.get::<_, usize>(0)
            ).unwrap_or(0),
            "feedback_count": self.conn.query_row(
                "SELECT COUNT(*) FROM feedback", [], |row| row.get::<_, usize>(0)
            ).unwrap_or(0),
        });

        let json = serde_json::to_string_pretty(&export)?;
        std::fs::write(export_path, &json)?;

        Ok(format!(
            "Persisted {} nodes, {} edges to {:?}",
            snapshot.nodes.len(),
            snapshot.edges.len(),
            export_path
        ))
    }

    /// Test-only loader for validating legacy migration and merge invariants.
    #[cfg(test)]
    pub fn load(
        &self,
        import_path: &Path,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let mut file = std::fs::File::open(import_path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Err("Invalid graph export: import path is not a regular file".into());
        }
        if metadata.len() > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "Invalid graph export: file exceeds {} bytes",
                MAX_IMPORT_FILE_BYTES
            )
            .into());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.by_ref()
            .take(MAX_IMPORT_FILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
            return Err(format!(
                "Invalid graph export: file exceeds {} bytes",
                MAX_IMPORT_FILE_BYTES
            )
            .into());
        }
        let json =
            String::from_utf8(bytes).map_err(|_| "Invalid graph export: file is not UTF-8 JSON")?;
        let mut export: serde_json::Value = serde_json::from_str(&json)?;

        if export.get("format").and_then(serde_json::Value::as_str)
            != Some("prismos-spectrum-graph-v1")
        {
            return Err("Invalid graph export: unsupported format".into());
        }

        let snapshot_val = export
            .get_mut("snapshot")
            .ok_or("Invalid export: missing 'snapshot' field")?
            .take();
        let snapshot: GraphSnapshot = serde_json::from_value(snapshot_val)?;
        validate_import_snapshot(&snapshot)?;

        let mut nodes_imported = 0u32;
        let mut edges_imported = 0u32;
        let excluded_node_ids: HashSet<&str> = snapshot
            .nodes
            .iter()
            .filter(|node| is_nonportable_snapshot_node(node))
            .map(|node| node.id.as_str())
            .collect();
        let tx = self.conn.unchecked_transaction()?;

        // Import nodes (skip existing)
        for node in &snapshot.nodes {
            if is_nonportable_snapshot_node(node) {
                continue;
            }
            let exists: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                params![node.id],
                |row| row.get(0),
            )?;
            if !exists {
                tx.execute(
                    "INSERT INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        node.id, node.label, node.content, node.node_type, node.layer,
                        node.access_count, node.last_accessed, node.created_at, node.updated_at
                    ],
                )?;
                nodes_imported += 1;
            }
        }

        // Import edges (skip existing)
        for edge in &snapshot.edges {
            if excluded_node_ids.contains(edge.source_id.as_str())
                || excluded_node_ids.contains(edge.target_id.as_str())
            {
                continue;
            }
            let endpoints_exist: bool = tx.query_row(
                "SELECT
                    EXISTS(SELECT 1 FROM nodes WHERE id = ?1)
                    AND EXISTS(SELECT 1 FROM nodes WHERE id = ?2)",
                params![edge.source_id, edge.target_id],
                |row| row.get(0),
            )?;
            if !endpoints_exist {
                continue;
            }
            let exists: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM edges WHERE id = ?1",
                params![edge.id],
                |row| row.get(0),
            )?;
            if !exists {
                tx.execute(
                    "INSERT INTO edges (id, source_id, target_id, relation, weight, momentum, reinforcements, last_reinforced, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        edge.id, edge.source_id, edge.target_id, edge.relation, edge.weight,
                        edge.momentum, edge.reinforcements, edge.last_reinforced, edge.created_at
                    ],
                )?;
                edges_imported += 1;
            }
        }
        tx.commit()?;

        Ok(format!(
            "Loaded {} new nodes, {} new edges from {:?}",
            nodes_imported, edges_imported, import_path
        ))
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  VECTOR SIMILARITY — BOUNDED EMBEDDING SUPPORT
    // ═══════════════════════════════════════════════════════════════════════

    /// Store a vector embedding for a node (stored as BLOB in SQLite).
    /// When a full embedding model (e.g., ONNX + sentence-transformers) is
    /// integrated, this enables semantic vector search alongside the
    /// relational graph layer.
    pub fn set_node_embedding(
        &self,
        node_id: &str,
        embedding: &[f64],
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(node_id, "embedding node id")?;
        if embedding.is_empty() || embedding.len() > MAX_EMBEDDING_DIMENSIONS {
            return Err(
                format!("embedding must contain 1..={MAX_EMBEDDING_DIMENSIONS} values").into(),
            );
        }
        if embedding.iter().any(|value| !value.is_finite()) {
            return Err("embedding contains a non-finite value".into());
        }
        // Serialize f64 vector as little-endian bytes
        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        // Embedding maintenance is derived metadata, not a content refresh.
        // Preserve `updated_at` so temporal ranking cannot make old knowledge
        // appear current merely because its vector was backfilled.
        self.conn.execute(
            "UPDATE nodes SET embedding = ?1 WHERE id = ?2",
            params![bytes, node_id],
        )?;
        Ok(())
    }

    /// Retrieve a node's vector embedding
    pub fn get_node_embedding(
        &self,
        node_id: &str,
    ) -> Result<Option<Vec<f64>>, Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(node_id, "embedding node id")?;
        let result: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT embedding FROM nodes WHERE id = ?1",
                params![node_id],
                |row| row.get(0),
            )
            .ok();

        match result {
            Some(bytes) if !bytes.is_empty() => {
                let floats: Vec<f64> = bytes
                    .chunks_exact(8)
                    .filter_map(|chunk| {
                        let arr: [u8; 8] = chunk.try_into().ok()?;
                        Some(f64::from_le_bytes(arr))
                    })
                    .collect();
                Ok(Some(floats))
            }
            _ => Ok(None),
        }
    }

    /// Cosine similarity search across all nodes with embeddings.
    /// Returns (node_id, similarity_score) pairs sorted by similarity.
    /// This is the vector layer of the multi-layered Spectrum Graph.
    pub fn vector_search(
        &self,
        query_embedding: &[f64],
        top_k: usize,
    ) -> Result<Vec<(String, f64)>, Box<dyn std::error::Error + Send + Sync>> {
        if query_embedding.is_empty() || query_embedding.len() > MAX_EMBEDDING_DIMENSIONS {
            return Err(format!(
                "query embedding must contain 1..={MAX_EMBEDDING_DIMENSIONS} values"
            )
            .into());
        }
        if query_embedding.iter().any(|value| !value.is_finite()) {
            return Err("query embedding contains a non-finite value".into());
        }
        if top_k == 0 || top_k > MAX_VECTOR_RESULTS {
            return Err(format!("vector result limit must be 1..={MAX_VECTOR_RESULTS}").into());
        }
        let mut stmt = self
            .conn
            .prepare("SELECT id, embedding FROM nodes WHERE embedding IS NOT NULL")?;

        let mut results: Vec<(String, f64)> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let bytes: Vec<u8> = row.get(1)?;
                Ok((id, bytes))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(id, bytes)| {
                if bytes.is_empty() {
                    return None;
                }
                let embedding: Vec<f64> = bytes
                    .chunks_exact(8)
                    .filter_map(|c| {
                        let arr: [u8; 8] = c.try_into().ok()?;
                        Some(f64::from_le_bytes(arr))
                    })
                    .collect();
                let sim = cosine_similarity(query_embedding, &embedding);
                Some((id, sim))
            })
            .collect();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        Ok(results)
    }

    /// Nodes that don't have an embedding yet — newest first, so fresh
    /// knowledge becomes semantically searchable soonest. Used by the
    /// opportunistic per-query backfill in the refractive core (no migration
    /// needed: the graph embeds itself over time).
    #[allow(clippy::type_complexity)] // Compact row tuple is the method's compatibility API.
    pub fn nodes_missing_embedding(
        &self,
        limit: usize,
    ) -> Result<Vec<(String, String, String)>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content FROM nodes
             WHERE embedding IS NULL OR length(embedding) = 0
             ORDER BY updated_at DESC
             LIMIT ?1",
        )?;
        let rows: Vec<(String, String, String)> = stmt
            .query_map(params![limit as i64], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Identity anchor: core personal-layer nodes that should ALWAYS reach the
    /// prompt regardless of keyword/semantic match — this is how "who am I?" /
    /// "what are my rules?" get answered like a hosted assistant with a standing
    /// user profile. Populated by knowledge ingestion (user-* nodes) or any
    /// node saved with node_type='personal', layer='core'.
    pub fn pinned_profile_nodes(
        &self,
        limit: usize,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'context'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes
             WHERE node_type = 'personal' AND COALESCE(layer, 'context') = 'core'
             ORDER BY updated_at DESC
             LIMIT ?1",
        )?;
        let nodes: Vec<SpectrumNode> = stmt
            .query_map(params![limit as i64], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(nodes)
    }

    /// Return the most recent completed chat turns for bounded multi-turn
    /// continuity. This is deliberately independent of semantic retrieval:
    /// follow-ups such as "do that for the other project" often share no useful
    /// keywords with the preceding turn.
    pub fn recent_conversation_nodes(
        &self,
        limit: usize,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type,
                    COALESCE(layer, 'ephemeral'), COALESCE(access_count, 0),
                    COALESCE(last_accessed, updated_at), created_at, updated_at
             FROM nodes
             WHERE node_type = 'conversation'
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let mut nodes: Vec<SpectrumNode> = stmt
            .query_map(params![limit as i64], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    layer: row.get(4)?,
                    access_count: row.get(5)?,
                    last_accessed: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        // Feed the model in chronological order even though the database query
        // selects newest-first to enforce the bound.
        nodes.reverse();
        Ok(nodes)
    }

    /// Hybrid retrieval: keyword+graph results from `query_intent`, enriched
    /// with vector-similarity hits when a query embedding is available.
    /// Semantic-only hits (things keyword search can never find — "who am I?"
    /// shares no ≥4-char terms with the profile) are pulled in; nodes found by
    /// BOTH paths get an agreement boost. Falls back to plain `query_intent`
    /// when `query_embedding` is None, so retrieval quality can only go up.
    pub fn query_intent_hybrid(
        &self,
        raw_input: &str,
        intent_type: &str,
        entities: &[String],
        query_embedding: Option<&[f64]>,
    ) -> Result<Vec<IntentQueryResult>, Box<dyn std::error::Error + Send + Sync>> {
        let mut results = self.query_intent(raw_input, intent_type, entities)?;
        let Some(qe) = query_embedding else {
            return Ok(results);
        };

        // Noise floor: below this cosine similarity a hit is topic drift, not
        // meaning. 0.35 is conservative for nomic-embed-text-class models.
        const SEMANTIC_FLOOR: f64 = 0.35;

        for (node_id, sim) in self.vector_search(qe, 12)? {
            if sim < SEMANTIC_FLOOR {
                continue;
            }
            if let Some(r) = results.iter_mut().find(|r| r.node.id == node_id) {
                // Keyword AND semantic agreement — strongest possible signal
                r.relevance_score += sim * 0.5;
            } else if let Ok(Some(node)) = self.get_node_without_access(&node_id) {
                let temporal_boost = self.calculate_temporal_boost(&node.updated_at);
                results.push(IntentQueryResult {
                    relevance_score: 0.3 + sim * 0.6,
                    path_strength: 0.0,
                    temporal_boost,
                    node,
                });
            }
        }

        results.sort_by(|a, b| {
            b.relevance_score
                .partial_cmp(&a.relevance_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(20);
        Ok(results)
    }

    /// Get total feedback signal count for analytics
    pub fn get_feedback_count(&self) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let count: usize = self
            .conn
            .query_row("SELECT COUNT(*) FROM feedback", [], |row| row.get(0))?;
        Ok(count)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RESPONSE FEEDBACK — User-driven closed-loop learning
    // ═══════════════════════════════════════════════════════════════════════

    /// Store user feedback on a response (👍 = 1, 👎 = -1).
    /// Also adjusts edge weights for context nodes that were used:
    ///   - 👍 → reinforce edges between context nodes (good retrieval path)
    ///   - 👎 → weaken edges between context nodes (misleading retrieval path)
    pub fn submit_response_feedback(
        &self,
        conversation_id: &str,
        question: &str,
        response: &str,
        rating: i32,
        context_node_ids: &[String],
        model: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        validate_graph_id(conversation_id, "conversation id")?;
        validate_live_text(
            question,
            "feedback question",
            MAX_IMPORT_CONTENT_BYTES,
            false,
        )?;
        validate_live_text(
            response,
            "feedback response",
            MAX_LIVE_FEEDBACK_RESPONSE_BYTES,
            false,
        )?;
        if rating != -1 && rating != 1 {
            return Err("feedback rating must be exactly -1 or 1".into());
        }
        if context_node_ids.len() > MAX_LIVE_CONTEXT_NODES {
            return Err(
                format!("feedback context exceeds {MAX_LIVE_CONTEXT_NODES} node ids").into(),
            );
        }
        for node_id in context_node_ids {
            validate_graph_id(node_id, "feedback context node id")?;
        }
        validate_live_text(model, "feedback model", 200, false)?;
        if model.trim() != model || model.chars().any(char::is_control) {
            return Err("feedback model contains whitespace padding or control characters".into());
        }
        let now = Utc::now().to_rfc3339();
        let fb_id = Uuid::new_v4().to_string();
        let ctx_json = serde_json::to_string(context_node_ids)?;

        // Never persist a second, ownerless copy of a project-grounded answer.
        // The quality signal can still adjust retrieval edges and the cognitive
        // profile, but Forget must be able to remove all source-derived text.
        if !self.node_ids_include_managed_knowledge(context_node_ids)? {
            self.conn.execute(
                "INSERT INTO response_feedback (id, conversation_id, question, response, rating, context_nodes, model, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![fb_id, conversation_id, question, response, rating, ctx_json, model, now],
            )?;
        }

        // Adjust edge weights between context nodes based on feedback
        // 👍 (+1) → positive feedback signal (reinforce these paths)
        // 👎 (-1) → negative feedback signal (weaken these paths)
        let signal = rating as f64 * 0.3; // Scale: +0.3 or -0.3
        let context_count = context_node_ids.len().min(5);
        for i in 0..context_count {
            for j in (i + 1)..context_count {
                // Find existing edge between these nodes
                let edge = self.conn.query_row(
                    "SELECT id FROM edges WHERE (source_id = ?1 AND target_id = ?2) OR (source_id = ?2 AND target_id = ?1) LIMIT 1",
                    params![context_node_ids[i], context_node_ids[j]],
                    |row| row.get::<_, String>(0),
                );
                if let Ok(edge_id) = edge {
                    let _ = self.update_edge_weight(&edge_id, signal);
                }
            }
        }

        eprintln!(
            "[SpectrumGraph] Response feedback: {} (conv={}, {} context nodes, signal={})",
            if rating > 0 { "👍" } else { "👎" },
            &conversation_id[..8.min(conversation_id.len())],
            context_node_ids.len(),
            signal
        );

        Ok(())
    }

    /// Get highly-rated past Q&A pairs that are similar to a query.
    /// Used as few-shot examples to improve future responses.
    /// Returns up to `limit` entries as (question, response) tuples.
    pub fn get_good_examples(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<(String, String)>, Box<dyn std::error::Error + Send + Sync>> {
        // Extract significant words from query for LIKE matching
        let words: Vec<String> = query
            .split_whitespace()
            .filter(|w| w.len() >= 4)
            .take(3)
            .map(|w| w.to_lowercase())
            .collect();

        if words.is_empty() {
            return Ok(vec![]);
        }

        // Build a query that finds thumbs-up responses with overlapping words
        let mut results: Vec<(String, String)> = Vec::new();
        for word in &words {
            let pattern = format!("%{}%", word);
            let mut stmt = self.conn.prepare(
                "SELECT question, response FROM response_feedback
                 WHERE rating > 0 AND question LIKE ?1
                 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![pattern, limit as u32], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for pair in rows.flatten() {
                // Avoid duplicates
                if !results.iter().any(|(q, _)| q == &pair.0) {
                    results.push(pair);
                }
            }
            if results.len() >= limit {
                break;
            }
        }

        results.truncate(limit);
        Ok(results)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  RESPONSE PREFERENCES — Explicit local preference signals
    // ═══════════════════════════════════════════════════════════════════════

    /// Load the user's cognitive profile (creates default if none exists)
    pub fn get_cognitive_profile(
        &self,
    ) -> Result<crate::cognitive_profile::CognitiveProfile, Box<dyn std::error::Error + Send + Sync>>
    {
        let result = self.conn.query_row(
            "SELECT depth, creativity, formality, technical_level, example_preference, \
                    interaction_count, last_updated \
             FROM cognitive_profile WHERE id = 'default'",
            [],
            |row| {
                Ok(crate::cognitive_profile::CognitiveProfile {
                    depth: row.get(0)?,
                    creativity: row.get(1)?,
                    formality: row.get(2)?,
                    technical_level: row.get(3)?,
                    example_preference: row.get(4)?,
                    interaction_count: row.get(5)?,
                    last_updated: row.get(6)?,
                })
            },
        );

        match result {
            Ok(profile) => Ok(profile),
            Err(_) => {
                // No profile yet — create default
                let profile = crate::cognitive_profile::CognitiveProfile::default();
                self.save_cognitive_profile(&profile)?;
                Ok(profile)
            }
        }
    }

    /// Persist the cognitive profile to SQLite
    pub fn save_cognitive_profile(
        &self,
        profile: &crate::cognitive_profile::CognitiveProfile,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR REPLACE INTO cognitive_profile \
             (id, depth, creativity, formality, technical_level, example_preference, \
              interaction_count, last_updated) \
             VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                profile.depth,
                profile.creativity,
                profile.formality,
                profile.technical_level,
                profile.example_preference,
                profile.interaction_count,
                now,
            ],
        )?;
        // Also save a weekly snapshot for drift tracking
        let _ = self.save_cognitive_snapshot(profile);
        Ok(())
    }

    /// Get intent log entries for the last N days
    #[allow(clippy::type_complexity)] // Compact row tuple is the method's compatibility API.
    pub fn get_recent_intents(
        &self,
        days: u32,
    ) -> Result<Vec<(String, String, f64, String)>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT raw_input, intent_type, confidence, created_at
             FROM intent_log
             WHERE created_at > datetime('now', ?1)
             ORDER BY created_at DESC LIMIT 100",
        )?;

        let param = format!("-{} days", days);
        let rows = stmt
            .query_map(params![param], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    /// Lifetime stats for Brain Wrapped: (total_intents, distinct_active_days)
    pub fn get_lifetime_stats(
        &self,
    ) -> Result<(u32, u32), Box<dyn std::error::Error + Send + Sync>> {
        let total_intents: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM intent_log", [], |row| row.get(0))
            .unwrap_or(0);
        let days_active: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT DATE(created_at)) FROM intent_log",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok((total_intents.max(0) as u32, days_active.max(0) as u32))
    }

    /// Generate a daily brief/recap from Spectrum Graph activity
    /// Returns stats about today's activity: intents processed, nodes created/updated,
    /// edges strengthened, top facets, and highlights
    pub fn get_daily_brief(
        &self,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // Intents processed today
        let intents_today: usize = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM intent_log WHERE created_at > datetime('now', '-1 day')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Nodes created today
        let nodes_created_today: usize = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM nodes WHERE created_at > datetime('now', '-1 day')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // Nodes updated today (updated_at differs from created_at and is today)
        let nodes_updated_today: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE updated_at > datetime('now', '-1 day') AND updated_at != created_at",
            [], |row| row.get(0)
        ).unwrap_or(0);

        // Edges strengthened today (reinforced recently)
        let edges_strengthened: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE last_reinforced > datetime('now', '-1 day') AND reinforcements > 0",
            [], |row| row.get(0)
        ).unwrap_or(0);

        // Total graph size
        let (total_nodes, total_edges) = self.stats().unwrap_or((0, 0));

        // Top facets (node types) created/accessed today
        let mut stmt = self.conn.prepare(
            "SELECT node_type, COUNT(*) as cnt FROM nodes
             WHERE created_at > datetime('now', '-1 day') OR last_accessed > datetime('now', '-1 day')
             GROUP BY node_type ORDER BY cnt DESC LIMIT 5"
        )?;
        let facets: Vec<(String, usize)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Recent intent types today
        let mut stmt2 = self.conn.prepare(
            "SELECT intent_type, COUNT(*) as cnt FROM intent_log
             WHERE created_at > datetime('now', '-1 day')
             GROUP BY intent_type ORDER BY cnt DESC LIMIT 5",
        )?;
        let intent_types: Vec<(String, usize)> = stmt2
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // Strongest edge reinforced today
        let strongest_today: Option<(String, f64, i32)> = self
            .conn
            .query_row(
                "SELECT e.relation, e.weight, e.reinforcements FROM edges e
             WHERE e.last_reinforced > datetime('now', '-1 day')
             ORDER BY e.weight DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        // Most accessed node today
        let busiest_node: Option<(String, String, i32)> = self
            .conn
            .query_row(
                "SELECT label, node_type, access_count FROM nodes
             WHERE last_accessed > datetime('now', '-1 day')
             ORDER BY access_count DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();

        // ── Yesterday's activity (for Morning Brief context) ──
        let yesterday_intents: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM intent_log WHERE created_at BETWEEN datetime('now', '-2 days') AND datetime('now', '-1 day')",
            [], |row| row.get(0)
        ).unwrap_or(0);

        let yesterday_nodes: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE created_at BETWEEN datetime('now', '-2 days') AND datetime('now', '-1 day')",
            [], |row| row.get(0)
        ).unwrap_or(0);

        // ── Pending topics: accessed recently but low engagement — good "continue" candidates ──
        let mut pending_stmt = self.conn.prepare(
            "SELECT label, node_type FROM nodes
             WHERE last_accessed > datetime('now', '-2 days')
               AND access_count <= 3
             ORDER BY last_accessed DESC LIMIT 4",
        )?;
        let pending_topics: Vec<serde_json::Value> = pending_stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "label": row.get::<_, String>(0)?,
                    "node_type": row.get::<_, String>(1)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // ── Tomorrow priorities: highest-weight recently-active nodes ──
        let mut priority_stmt = self.conn.prepare(
            "SELECT n.label, n.node_type, SUM(e.weight) as total_weight FROM nodes n
             LEFT JOIN edges e ON n.id = e.source_id OR n.id = e.target_id
             WHERE n.last_accessed > datetime('now', '-3 days')
             GROUP BY n.id ORDER BY total_weight DESC LIMIT 4",
        )?;
        let tomorrow_priorities: Vec<serde_json::Value> = priority_stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "label": row.get::<_, String>(0)?,
                    "node_type": row.get::<_, String>(1)?,
                    "weight": row.get::<_, f64>(2).unwrap_or(0.0),
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();

        // ── New connections discovered today ──
        let new_connections_today: usize = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE created_at > datetime('now', '-1 day')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // ── Graph growth streak: consecutive days with new nodes (max 30 lookback) ──
        let mut streak: usize = 0;
        for day_offset in 0..30 {
            let day_from = format!("-{} days", day_offset + 1);
            let day_to = format!("-{} days", day_offset);
            let count: usize = self.conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM nodes WHERE created_at BETWEEN datetime('now', '{}') AND datetime('now', '{}')",
                    day_from, day_to
                ),
                [], |row| row.get(0)
            ).unwrap_or(0);
            if count > 0 {
                streak += 1;
            } else {
                break;
            }
        }

        // Determine time of day for greeting context
        let hour = chrono::Local::now().hour();
        let time_period = if hour < 12 {
            "morning"
        } else if hour < 17 {
            "afternoon"
        } else {
            "evening"
        };
        let is_morning = hour < 12;
        let is_evening = hour >= 18;

        // Build highlights list
        let mut highlights: Vec<serde_json::Value> = Vec::new();
        if let Some((label, ntype, count)) = &busiest_node {
            highlights.push(serde_json::json!({
                "icon": "🎯",
                "text": format!("Most active: \"{}\" ({}) — accessed {} times", label, ntype, count)
            }));
        }
        if let Some((rel, weight, reinf)) = &strongest_today {
            highlights.push(serde_json::json!({
                "icon": "🔗",
                "text": format!("Strongest connection: \"{}\" — weight {:.2}, reinforced {}×", rel, weight, reinf)
            }));
        }
        if edges_strengthened > 0 {
            highlights.push(serde_json::json!({
                "icon": "💪",
                "text": format!("{} knowledge connections strengthened today", edges_strengthened)
            }));
        }
        if nodes_created_today > 0 {
            highlights.push(serde_json::json!({
                "icon": "✨",
                "text": format!("{} new knowledge nodes added to your graph", nodes_created_today)
            }));
        }

        let facet_map: serde_json::Value = facets
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::json!(v)))
            .collect::<serde_json::Map<String, serde_json::Value>>()
            .into();

        let intent_type_map: serde_json::Value = intent_types
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::json!(v)))
            .collect::<serde_json::Map<String, serde_json::Value>>()
            .into();

        Ok(serde_json::json!({
            "time_period": time_period,
            "is_morning": is_morning,
            "is_evening": is_evening,
            "intents_today": intents_today,
            "nodes_created": nodes_created_today,
            "nodes_updated": nodes_updated_today,
            "edges_strengthened": edges_strengthened,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "top_facets": facet_map,
            "intent_types": intent_type_map,
            "highlights": highlights,
            "yesterday_intents": yesterday_intents,
            "yesterday_nodes": yesterday_nodes,
            "pending_topics": pending_topics,
            "tomorrow_priorities": tomorrow_priorities,
            "new_connections_today": new_connections_today,
            "growth_streak": streak,
        }))
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  COGNITIVE DRIFT — Weekly Snapshot & Drift Detection
    // ═══════════════════════════════════════════════════════════════════════

    /// Save a weekly cognitive profile snapshot for drift tracking
    pub fn save_cognitive_snapshot(
        &self,
        profile: &crate::cognitive_profile::CognitiveProfile,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = chrono::Utc::now();
        let iso_week = now.format("%G-W%V").to_string();
        let id = format!("snapshot-{}", iso_week);

        self.conn.execute(
            "INSERT OR REPLACE INTO cognitive_timeline \
             (id, iso_week, depth, creativity, formality, technical_level, \
              example_preference, interaction_count, snapshot_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                id,
                iso_week,
                profile.depth,
                profile.creativity,
                profile.formality,
                profile.technical_level,
                profile.example_preference,
                profile.interaction_count,
                now.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Get cognitive drift: compare current profile against historical snapshots
    #[allow(clippy::type_complexity)] // Row tuple mirrors the fixed timeline projection.
    pub fn get_cognitive_drift(
        &self,
        weeks: u32,
    ) -> Result<crate::cognitive_profile::CognitiveDrift, Box<dyn std::error::Error + Send + Sync>>
    {
        let current = self.get_cognitive_profile()?;

        let mut stmt = self.conn.prepare(
            "SELECT iso_week, depth, creativity, formality, technical_level, \
                    example_preference, interaction_count, snapshot_at \
             FROM cognitive_timeline \
             ORDER BY snapshot_at DESC LIMIT ?1",
        )?;

        let snapshots: Vec<(String, f64, f64, f64, f64, f64, i64, String)> = stmt
            .query_map(rusqlite::params![weeks], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut weekly_deltas = Vec::new();
        for (_week, depth, creativity, formality, tech, example, _count, _at) in &snapshots {
            weekly_deltas.push(crate::cognitive_profile::CognitiveDeltaSet {
                depth: current.depth - depth,
                creativity: current.creativity - creativity,
                formality: current.formality - formality,
                technical_level: current.technical_level - tech,
                example_preference: current.example_preference - example,
            });
        }

        let trend = if weekly_deltas.len() >= 2 {
            let recent = &weekly_deltas[0];
            let older = &weekly_deltas[weekly_deltas.len() - 1];
            let total_change = (recent.depth - older.depth).abs()
                + (recent.creativity - older.creativity).abs()
                + (recent.formality - older.formality).abs()
                + (recent.technical_level - older.technical_level).abs();
            if total_change > 0.3 {
                "evolving".to_string()
            } else if total_change > 0.1 {
                "shifting".to_string()
            } else {
                "stable".to_string()
            }
        } else {
            "insufficient_data".to_string()
        };

        // Build a previous profile from the latest snapshot for comparison
        let previous = if !snapshots.is_empty() {
            let (_, d, c, f, t, e, count, at) = &snapshots[0];
            Some(crate::cognitive_profile::CognitiveProfile {
                depth: *d,
                creativity: *c,
                formality: *f,
                technical_level: *t,
                example_preference: *e,
                interaction_count: *count as u32,
                last_updated: at.clone(),
            })
        } else {
            None
        };

        let summary = trend.clone();

        Ok(crate::cognitive_profile::CognitiveDrift {
            current,
            previous,
            deltas: if weekly_deltas.is_empty() {
                crate::cognitive_profile::CognitiveDeltaSet {
                    depth: 0.0,
                    creativity: 0.0,
                    formality: 0.0,
                    technical_level: 0.0,
                    example_preference: 0.0,
                }
            } else {
                weekly_deltas[0].clone()
            },
            summary,
            weeks_compared: snapshots.len() as u32,
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  THOUGHT CURRENTS — Temporal Pattern Mining
    // ═══════════════════════════════════════════════════════════════════════

    /// Analyze thought currents from intent history
    pub fn get_thought_currents(
        &self,
    ) -> Result<
        Vec<crate::thought_currents::ThoughtCurrent>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut stmt = self.conn.prepare(
            "SELECT intent_type, raw_input, created_at FROM intent_log \
             WHERE created_at > datetime('now', '-90 days') \
             ORDER BY created_at DESC LIMIT 500",
        )?;

        let entries: Vec<(String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, String>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(crate::thought_currents::analyze_thought_currents(&entries))
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  EDGE PROPHECY — Predictive Edge Suggestions
    // ═══════════════════════════════════════════════════════════════════════

    /// Predict potential edges between unconnected nodes
    pub fn predict_edges(
        &self,
        limit: usize,
    ) -> Result<
        Vec<crate::cognitive_profile::PredictedEdge>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut node_stmt = self.conn.prepare(
            "SELECT id, label, content, node_type FROM nodes \
             ORDER BY access_count DESC LIMIT 100",
        )?;

        let nodes: Vec<(String, String, String, String)> = node_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let existing_edges: std::collections::HashSet<(String, String)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT source_id, target_id FROM edges")?;
            let results: Vec<(String, String)> = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .filter_map(|r| r.ok())
                .collect();
            results.into_iter().collect()
        };

        let dismissed: std::collections::HashSet<(String, String)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT source_id, target_id FROM dismissed_predictions")?;
            let results: Vec<(String, String)> = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .filter_map(|r| r.ok())
                .collect();
            results.into_iter().collect()
        };

        let mut predictions: Vec<crate::cognitive_profile::PredictedEdge> = Vec::new();

        for i in 0..nodes.len() {
            for j in (i + 1)..nodes.len() {
                let (id_a, label_a, content_a, type_a) = &nodes[i];
                let (id_b, label_b, content_b, type_b) = &nodes[j];

                if existing_edges.contains(&(id_a.clone(), id_b.clone()))
                    || existing_edges.contains(&(id_b.clone(), id_a.clone()))
                    || dismissed.contains(&(id_a.clone(), id_b.clone()))
                    || dismissed.contains(&(id_b.clone(), id_a.clone()))
                {
                    continue;
                }

                let words_a: std::collections::HashSet<&str> = content_a
                    .split_whitespace()
                    .filter(|w| w.len() >= 4)
                    .collect();
                let words_b: std::collections::HashSet<&str> = content_b
                    .split_whitespace()
                    .filter(|w| w.len() >= 4)
                    .collect();

                let overlap = words_a.intersection(&words_b).count();
                let union_size = words_a.union(&words_b).count().max(1);
                let jaccard = overlap as f64 / union_size as f64;
                let type_bonus = if type_a == type_b { 0.15 } else { 0.0 };
                let confidence = (jaccard * 0.7 + type_bonus).min(1.0);

                if confidence >= 0.15 {
                    let reason = if overlap > 0 {
                        format!(
                            "{} shared keywords between \"{}\" and \"{}\"",
                            overlap, label_a, label_b
                        )
                    } else {
                        format!(
                            "Same domain ({}) — \"{}\" and \"{}\" may be related",
                            type_a, label_a, label_b
                        )
                    };

                    predictions.push(crate::cognitive_profile::PredictedEdge {
                        source_id: id_a.clone(),
                        target_id: id_b.clone(),
                        source_label: label_a.clone(),
                        target_label: label_b.clone(),
                        probability: confidence,
                        reason,
                        evidence_type: if overlap > 0 {
                            "keyword_overlap".to_string()
                        } else {
                            "same_domain".to_string()
                        },
                    });
                }
            }
        }

        predictions.sort_by(|a, b| {
            b.probability
                .partial_cmp(&a.probability)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        predictions.truncate(limit);
        Ok(predictions)
    }

    /// Confirm a predicted edge — actually create it in the graph
    pub fn confirm_predicted_edge(
        &self,
        source_id: &str,
        target_id: &str,
    ) -> Result<SpectrumEdge, Box<dyn std::error::Error + Send + Sync>> {
        self.add_edge(source_id, target_id, "predicted_confirmed", 0.7)
    }

    /// Dismiss a predicted edge — mark it so it won't be suggested again
    pub fn dismiss_predicted_edge(
        &self,
        source_id: &str,
        target_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO dismissed_predictions (id, source_id, target_id, dismissed_at) \
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![Uuid::new_v4().to_string(), source_id, target_id, now],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  REFRACTION JOURNAL — Band Choice Logging
    // ═══════════════════════════════════════════════════════════════════════

    /// Log a refraction band decision
    pub fn log_refraction(
        &self,
        query: &str,
        query_type: &str,
        natural_band: &str,
        applied_band: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO refraction_log (id, query, query_type, natural_band, applied_band, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, query, query_type, natural_band, applied_band, now],
        )?;
        Ok(id)
    }

    /// Update a refraction log entry with the user's override choice
    pub fn update_refraction_choice(
        &self,
        log_id: &str,
        user_choice: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.conn.execute(
            "UPDATE refraction_log SET user_override = ?1 WHERE id = ?2",
            rusqlite::params![user_choice, log_id],
        )?;
        Ok(())
    }

    /// Get refraction insights — aggregated band usage statistics
    pub fn get_refraction_insights(
        &self,
    ) -> Result<
        crate::cognitive_profile::RefractionInsights,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut band_stmt = self.conn.prepare(
            "SELECT applied_band, COUNT(*) FROM refraction_log \
             GROUP BY applied_band ORDER BY COUNT(*) DESC",
        )?;
        let band_counts: std::collections::HashMap<String, u32> = band_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let override_count: u32 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM refraction_log WHERE user_override IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_count: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM refraction_log", [], |row| row.get(0))
            .unwrap_or(0);

        let most_common_shift: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT natural_band, applied_band FROM refraction_log \
                 WHERE natural_band != applied_band \
                 GROUP BY natural_band, applied_band \
                 ORDER BY COUNT(*) DESC LIMIT 1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .ok();

        let override_rate = if total_count > 0 {
            override_count as f64 / total_count as f64
        } else {
            0.0
        };

        Ok(crate::cognitive_profile::RefractionInsights {
            total_refractions: total_count,
            band_distribution: band_counts
                .iter()
                .map(|(k, v)| (k.clone(), *v as f64))
                .collect(),
            band_by_query_type: std::collections::HashMap::new(),
            blind_spots: Vec::new(),
            growth_score: override_rate,
            insights: {
                let mut ins = Vec::new();
                if let Some((from, to)) = &most_common_shift {
                    ins.push(format!("Most common shift: {} → {}", from, to));
                }
                if override_rate > 0.3 {
                    ins.push(format!(
                        "High override rate ({:.0}%) — you often refine band choices",
                        override_rate * 100.0
                    ));
                }
                ins
            },
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AGENT MEMORY — Per-Agent Key-Value Store
    // ═══════════════════════════════════════════════════════════════════════

    /// Store a memory entry for an agent
    pub fn store_agent_memory(
        &self,
        agent_name: &str,
        key: &str,
        value: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = chrono::Utc::now().to_rfc3339();
        let id = format!("{}-{}", agent_name, key);

        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(value.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        self.conn.execute(
            "INSERT OR REPLACE INTO agent_memory \
             (id, agent_name, memory_key, memory_value, content_hash, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, \
              COALESCE((SELECT created_at FROM agent_memory WHERE id = ?1), ?6), ?6)",
            rusqlite::params![id, agent_name, key, value, hash, now],
        )?;
        Ok(())
    }

    /// Recall memory entries for an agent
    pub fn recall_agent_memory(
        &self,
        agent_name: &str,
        limit: usize,
    ) -> Result<
        Vec<crate::cognitive_profile::AgentMemoryEntry>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut stmt = self.conn.prepare(
            "SELECT agent_name, memory_key, memory_value, created_at, updated_at \
             FROM agent_memory WHERE agent_name = ?1 \
             ORDER BY updated_at DESC LIMIT ?2",
        )?;

        let entries = stmt
            .query_map(rusqlite::params![agent_name, limit as u32], |row| {
                let agent: String = row.get(0)?;
                let key: String = row.get(1)?;
                let value: String = row.get(2)?;
                let created: String = row.get(3)?;
                Ok(crate::cognitive_profile::AgentMemoryEntry {
                    id: format!("{}-{}", agent, key),
                    agent_name: agent,
                    query_summary: key,
                    decision: value,
                    band_used: String::new(),
                    feedback_rating: None,
                    created_at: created,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(entries)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  DOMAIN PROFILE — Persistence Layer
    // ═══════════════════════════════════════════════════════════════════════

    /// Get the stored domain profile
    pub fn get_domain_profile(
        &self,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let result = self.conn.query_row(
            "SELECT domain_counts, total_queries, primary_domain, confidence, last_updated \
             FROM domain_profile WHERE id = 'default'",
            [],
            |row| {
                Ok(serde_json::json!({
                    "domain_counts": serde_json::from_str::<serde_json::Value>(
                        &row.get::<_, String>(0)?
                    ).unwrap_or(serde_json::json!({})),
                    "total_queries": row.get::<_, i64>(1)?,
                    "primary_domain": row.get::<_, String>(2)?,
                    "confidence": row.get::<_, f64>(3)?,
                    "last_updated": row.get::<_, String>(4)?,
                }))
            },
        );

        match result {
            Ok(profile) => Ok(profile),
            Err(_) => Ok(serde_json::json!({
                "domain_counts": {},
                "total_queries": 0,
                "primary_domain": "General",
                "confidence": 0.0,
                "last_updated": "",
            })),
        }
    }

    /// Save the domain profile to SQLite
    pub fn save_domain_profile(
        &self,
        domain_counts: &str,
        total_queries: i64,
        primary_domain: &str,
        confidence: f64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT OR REPLACE INTO domain_profile \
             (id, domain_counts, total_queries, primary_domain, confidence, last_updated) \
             VALUES ('default', ?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                domain_counts,
                total_queries,
                primary_domain,
                confidence,
                now
            ],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MODEL PERFORMANCE — Per-Model Tracking
    // ═══════════════════════════════════════════════════════════════════════

    /// Store a model performance data point
    pub fn store_model_performance(
        &self,
        model_name: &str,
        domain: &str,
        latency_ms: f64,
        satisfaction: f64,
        query_type: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO model_performance \
             (id, model_name, domain, latency_ms, satisfaction, query_type, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                id,
                model_name,
                domain,
                latency_ms,
                satisfaction,
                query_type,
                now
            ],
        )?;
        Ok(())
    }

    /// Get model recommendations based on historical performance
    pub fn get_model_recommendations(
        &self,
    ) -> Result<
        Vec<crate::model_tracker::ModelRecommendation>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut stmt = self.conn.prepare(
            "SELECT model_name, domain, latency_ms, satisfaction \
             FROM model_performance \
             WHERE created_at > datetime('now', '-30 days') \
             ORDER BY created_at DESC LIMIT 500",
        )?;

        let records: Vec<crate::model_tracker::ModelPerformance> = stmt
            .query_map([], |row| {
                Ok(crate::model_tracker::ModelPerformance {
                    model: row.get(0)?,
                    domain: row.get(1)?,
                    query_type: String::new(),
                    latency_ms: row.get::<_, f64>(2)? as u64,
                    tokens_generated: None,
                    user_feedback: {
                        let sat: f64 = row.get(3)?;
                        if sat > 0.5 {
                            Some(true)
                        } else if sat < -0.5 {
                            Some(false)
                        } else {
                            None
                        }
                    },
                    timestamp: String::new(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(crate::model_tracker::generate_recommendations(&records))
    }
}

// ─── Utility: Cosine Similarity ────────────────────────────────────────────────

/// Compute cosine similarity between two vectors
fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    let len = a.len().min(b.len());
    if len == 0 {
        return 0.0;
    }
    let dot: f64 = a[..len]
        .iter()
        .zip(b[..len].iter())
        .map(|(x, y)| x * y)
        .sum();
    let mag_a: f64 = a[..len].iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b[..len].iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a > 0.0 && mag_b > 0.0 {
        (dot / (mag_a * mag_b)).clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GRAPH MERGE/DIFF ENGINE — Multi-Device Sync
// ═══════════════════════════════════════════════════════════════════════════════
//
//  Supports three merge strategies:
//    1. "theirs" — incoming overwrites local on conflict
//    2. "ours"   — local wins on conflict
//    3. "latest" — whichever was updated more recently wins
//
//  A "conflict" occurs when a node with the same ID exists on both sides
//  but has different content/label/type. Edges are merged additively;
//  if both sides have the same edge, the higher weight wins.

/// Resolution strategy for merge conflicts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MergeStrategy {
    Theirs, // Incoming snapshot wins on conflict
    Ours,   // Local graph wins on conflict
    Latest, // Most recently updated version wins
}

impl MergeStrategy {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "theirs" => MergeStrategy::Theirs,
            "ours" => MergeStrategy::Ours,
            _ => MergeStrategy::Latest,
        }
    }
}

/// A single conflict detected during merge diff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflict {
    pub entity_type: String, // "node" or "edge"
    pub entity_id: String,
    pub field: String, // which field differs
    pub local_value: String,
    pub remote_value: String,
    pub resolution: String, // "kept_local" | "took_remote" | "took_latest"
    pub resolved_value: String,
}

/// Full diff report between local graph and incoming snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeDiff {
    pub nodes_only_local: usize,
    pub nodes_only_remote: usize,
    pub nodes_both: usize,
    pub nodes_conflicted: usize,
    pub edges_only_local: usize,
    pub edges_only_remote: usize,
    pub edges_both: usize,
    pub edges_conflicted: usize,
    pub conflicts: Vec<MergeConflict>,
}

/// Result of a completed merge operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub strategy: String,
    pub nodes_added: usize,
    pub nodes_updated: usize,
    pub nodes_skipped: usize,
    pub edges_added: usize,
    pub edges_updated: usize,
    pub edges_skipped: usize,
    pub conflicts_resolved: usize,
    pub diff: MergeDiff,
    pub message: String,
}

impl SpectrumGraph {
    /// Compute a diff between the local graph and an incoming snapshot
    /// without modifying any data. Returns a MergeDiff with all conflicts.
    pub fn diff_graph(
        &self,
        incoming: &GraphSnapshot,
        strategy: &MergeStrategy,
    ) -> Result<MergeDiff, Box<dyn std::error::Error + Send + Sync>> {
        validate_import_snapshot(incoming)?;
        let mut diff = MergeDiff {
            nodes_only_local: 0,
            nodes_only_remote: 0,
            nodes_both: 0,
            nodes_conflicted: 0,
            edges_only_local: 0,
            edges_only_remote: 0,
            edges_both: 0,
            edges_conflicted: 0,
            conflicts: Vec::new(),
        };

        // Build incoming lookup maps
        let incoming_nodes: HashMap<String, &SpectrumNode> = incoming
            .nodes
            .iter()
            .filter(|node| !is_nonportable_snapshot_node(node))
            .map(|node| (node.id.clone(), node))
            .collect();
        let incoming_node_ids: HashSet<&str> = incoming_nodes.keys().map(String::as_str).collect();
        let incoming_edges: HashMap<String, &SpectrumEdge> = incoming
            .edges
            .iter()
            .filter(|edge| {
                incoming_node_ids.contains(edge.source_id.as_str())
                    && incoming_node_ids.contains(edge.target_id.as_str())
            })
            .map(|edge| (edge.id.clone(), edge))
            .collect();

        // Get local data
        let local_nodes = self.get_all_nodes()?;
        let local_edges = self.get_all_edges()?;
        let local_node_map: HashMap<String, &SpectrumNode> =
            local_nodes.iter().map(|n| (n.id.clone(), n)).collect();
        let local_edge_map: HashMap<String, &SpectrumEdge> =
            local_edges.iter().map(|e| (e.id.clone(), e)).collect();

        // --- Node diff ---
        // Nodes only in local
        for id in local_node_map.keys() {
            if !incoming_nodes.contains_key(id) {
                diff.nodes_only_local += 1;
            }
        }

        // Nodes in incoming
        for (id, remote_node) in &incoming_nodes {
            match local_node_map.get(id) {
                None => {
                    diff.nodes_only_remote += 1;
                }
                Some(local_node) => {
                    diff.nodes_both += 1;

                    // Check for content conflicts
                    if local_node.content != remote_node.content
                        || local_node.label != remote_node.label
                    {
                        diff.nodes_conflicted += 1;

                        let resolution = match strategy {
                            MergeStrategy::Theirs => "took_remote".to_string(),
                            MergeStrategy::Ours => "kept_local".to_string(),
                            MergeStrategy::Latest => {
                                if remote_node.updated_at > local_node.updated_at {
                                    "took_remote".to_string()
                                } else {
                                    "kept_local".to_string()
                                }
                            }
                        };

                        let resolved_value = match resolution.as_str() {
                            "took_remote" => remote_node.label.clone(),
                            _ => local_node.label.clone(),
                        };

                        if local_node.label != remote_node.label {
                            diff.conflicts.push(MergeConflict {
                                entity_type: "node".into(),
                                entity_id: id.clone(),
                                field: "label".into(),
                                local_value: local_node.label.clone(),
                                remote_value: remote_node.label.clone(),
                                resolution: resolution.clone(),
                                resolved_value: resolved_value.clone(),
                            });
                        }
                        if local_node.content != remote_node.content {
                            let resolved_content = match resolution.as_str() {
                                "took_remote" => remote_node.content.clone(),
                                _ => local_node.content.clone(),
                            };
                            diff.conflicts.push(MergeConflict {
                                entity_type: "node".into(),
                                entity_id: id.clone(),
                                field: "content".into(),
                                local_value: if local_node.content.chars().count() > 80 {
                                    format!(
                                        "{}…",
                                        local_node.content.chars().take(80).collect::<String>()
                                    )
                                } else {
                                    local_node.content.clone()
                                },
                                remote_value: if remote_node.content.chars().count() > 80 {
                                    format!(
                                        "{}…",
                                        remote_node.content.chars().take(80).collect::<String>()
                                    )
                                } else {
                                    remote_node.content.clone()
                                },
                                resolution: resolution.clone(),
                                resolved_value: if resolved_content.chars().count() > 80 {
                                    format!(
                                        "{}…",
                                        resolved_content.chars().take(80).collect::<String>()
                                    )
                                } else {
                                    resolved_content
                                },
                            });
                        }
                    }
                }
            }
        }

        // --- Edge diff ---
        for id in local_edge_map.keys() {
            if !incoming_edges.contains_key(id) {
                diff.edges_only_local += 1;
            }
        }

        for (id, remote_edge) in &incoming_edges {
            match local_edge_map.get(id) {
                None => {
                    diff.edges_only_remote += 1;
                }
                Some(local_edge) => {
                    diff.edges_both += 1;

                    if (local_edge.weight - remote_edge.weight).abs() > 0.01
                        || local_edge.reinforcements != remote_edge.reinforcements
                    {
                        diff.edges_conflicted += 1;

                        let resolution = match strategy {
                            MergeStrategy::Theirs => "took_remote".to_string(),
                            MergeStrategy::Ours => "kept_local".to_string(),
                            MergeStrategy::Latest => {
                                if remote_edge.last_reinforced > local_edge.last_reinforced {
                                    "took_remote".to_string()
                                } else {
                                    "kept_local".to_string()
                                }
                            }
                        };

                        diff.conflicts.push(MergeConflict {
                            entity_type: "edge".into(),
                            entity_id: id.clone(),
                            field: "weight".into(),
                            local_value: format!(
                                "{:.3} (×{})",
                                local_edge.weight, local_edge.reinforcements
                            ),
                            remote_value: format!(
                                "{:.3} (×{})",
                                remote_edge.weight, remote_edge.reinforcements
                            ),
                            resolution: resolution.clone(),
                            resolved_value: match resolution.as_str() {
                                "took_remote" => format!("{:.3}", remote_edge.weight),
                                _ => format!("{:.3}", local_edge.weight),
                            },
                        });
                    }
                }
            }
        }

        Ok(diff)
    }

    /// Merge an incoming graph snapshot into the local database.
    /// Applies the specified strategy for conflict resolution.
    pub fn merge_graph(
        &self,
        incoming: &GraphSnapshot,
        strategy: &MergeStrategy,
    ) -> Result<MergeResult, Box<dyn std::error::Error + Send + Sync>> {
        let diff = self.diff_graph(incoming, strategy)?;
        let now = Utc::now().to_rfc3339();

        let mut nodes_added = 0_usize;
        let mut nodes_updated = 0_usize;
        let mut nodes_skipped = 0_usize;
        let mut edges_added = 0_usize;
        let mut edges_updated = 0_usize;
        let mut edges_skipped = 0_usize;
        let excluded_node_ids: HashSet<&str> = incoming
            .nodes
            .iter()
            .filter(|node| is_nonportable_snapshot_node(node))
            .map(|node| node.id.as_str())
            .collect();
        let tx = self.conn.unchecked_transaction()?;

        // --- Merge nodes ---
        for remote_node in &incoming.nodes {
            if is_nonportable_snapshot_node(remote_node) {
                nodes_skipped += 1;
                continue;
            }
            let exists: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                params![remote_node.id],
                |row| row.get(0),
            )?;

            if !exists {
                // New node — insert directly
                tx.execute(
                    "INSERT INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        remote_node.id, remote_node.label, remote_node.content,
                        remote_node.node_type, remote_node.layer, remote_node.access_count,
                        remote_node.last_accessed, remote_node.created_at, remote_node.updated_at
                    ],
                )?;
                nodes_added += 1;
            } else {
                // Existing node — check for conflict
                let local_label: String = tx.query_row(
                    "SELECT label FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;
                let local_content: String = tx.query_row(
                    "SELECT content FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;
                let local_updated: String = tx.query_row(
                    "SELECT updated_at FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;

                if local_label == remote_node.label && local_content == remote_node.content {
                    // No conflict — merge access_count (take max)
                    let local_access: u32 = tx.query_row(
                        "SELECT COALESCE(access_count, 0) FROM nodes WHERE id = ?1",
                        params![remote_node.id],
                        |row| row.get(0),
                    )?;
                    if remote_node.access_count > local_access {
                        tx.execute(
                            "UPDATE nodes SET access_count = ?1 WHERE id = ?2",
                            params![remote_node.access_count, remote_node.id],
                        )?;
                    }
                    nodes_skipped += 1;
                } else {
                    // Conflict — apply strategy
                    let should_update = match strategy {
                        MergeStrategy::Theirs => true,
                        MergeStrategy::Ours => false,
                        MergeStrategy::Latest => remote_node.updated_at > local_updated,
                    };

                    if should_update {
                        tx.execute(
                            "UPDATE nodes SET label = ?1, content = ?2, node_type = ?3, layer = ?4, updated_at = ?5
                             WHERE id = ?6",
                            params![
                                remote_node.label, remote_node.content, remote_node.node_type,
                                remote_node.layer, &now, remote_node.id
                            ],
                        )?;
                        nodes_updated += 1;
                    } else {
                        nodes_skipped += 1;
                    }
                }
            }
        }

        // --- Merge edges ---
        for remote_edge in &incoming.edges {
            if excluded_node_ids.contains(remote_edge.source_id.as_str())
                || excluded_node_ids.contains(remote_edge.target_id.as_str())
            {
                edges_skipped += 1;
                continue;
            }
            let exists: bool = tx.query_row(
                "SELECT COUNT(*) > 0 FROM edges WHERE id = ?1",
                params![remote_edge.id],
                |row| row.get(0),
            )?;

            if !exists {
                // Check that both endpoints exist before inserting
                let src_exists: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                    params![remote_edge.source_id],
                    |row| row.get(0),
                )?;
                let tgt_exists: bool = tx.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                    params![remote_edge.target_id],
                    |row| row.get(0),
                )?;

                if src_exists && tgt_exists {
                    tx.execute(
                        "INSERT INTO edges (id, source_id, target_id, relation, weight, momentum, reinforcements, last_reinforced, created_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        params![
                            remote_edge.id, remote_edge.source_id, remote_edge.target_id,
                            remote_edge.relation, remote_edge.weight, remote_edge.momentum,
                            remote_edge.reinforcements, remote_edge.last_reinforced, remote_edge.created_at
                        ],
                    )?;
                    edges_added += 1;
                } else {
                    edges_skipped += 1;
                }
            } else {
                // Existing edge — compare weights
                let local_weight: f64 = tx.query_row(
                    "SELECT weight FROM edges WHERE id = ?1",
                    params![remote_edge.id],
                    |row| row.get(0),
                )?;
                let local_reinforced: String = tx.query_row(
                    "SELECT COALESCE(last_reinforced, created_at) FROM edges WHERE id = ?1",
                    params![remote_edge.id],
                    |row| row.get(0),
                )?;

                if (local_weight - remote_edge.weight).abs() <= 0.01 {
                    edges_skipped += 1;
                } else {
                    let should_update = match strategy {
                        MergeStrategy::Theirs => true,
                        MergeStrategy::Ours => false,
                        MergeStrategy::Latest => remote_edge.last_reinforced > local_reinforced,
                    };

                    if should_update {
                        tx.execute(
                            "UPDATE edges SET weight = ?1, momentum = ?2, reinforcements = ?3, last_reinforced = ?4
                             WHERE id = ?5",
                            params![
                                remote_edge.weight, remote_edge.momentum,
                                remote_edge.reinforcements, remote_edge.last_reinforced,
                                remote_edge.id
                            ],
                        )?;
                        edges_updated += 1;
                    } else {
                        edges_skipped += 1;
                    }
                }
            }
        }
        tx.commit()?;

        let conflicts_resolved = diff.conflicts.len();
        let strategy_str = match strategy {
            MergeStrategy::Theirs => "theirs",
            MergeStrategy::Ours => "ours",
            MergeStrategy::Latest => "latest",
        };

        let message = format!(
            "Merge complete (strategy: {}): +{} nodes, ~{} updated, +{} edges, ~{} updated, {} conflicts resolved",
            strategy_str, nodes_added, nodes_updated, edges_added, edges_updated, conflicts_resolved
        );

        Ok(MergeResult {
            success: true,
            strategy: strategy_str.to_string(),
            nodes_added,
            nodes_updated,
            nodes_skipped,
            edges_added,
            edges_updated,
            edges_skipped,
            conflicts_resolved,
            diff,
            message,
        })
    }

    /// Export the current graph as a portable sync package (unencrypted JSON).
    /// Used for cross-device sync where You-Port encryption wraps the transport.
    pub fn export_sync_package(&self) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let snapshot = self.get_portable_graph()?;
        let package = serde_json::json!({
            "format": "prismos-sync-v1",
            "device_id": Uuid::new_v4().to_string(),
            "exported_at": Utc::now().to_rfc3339(),
            "snapshot": snapshot,
        });
        serde_json::to_string_pretty(&package).map_err(|e| e.into())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TESTS — Spectrum Graph Engine
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a SpectrumGraph backed by a temp directory (auto-cleaned)
    fn test_graph() -> (SpectrumGraph, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("failed to create temp dir");
        let graph = SpectrumGraph::new(dir.path()).expect("failed to create graph");
        (graph, dir)
    }

    fn import_node(id: &str, label: &str, content: &str, node_type: &str) -> SpectrumNode {
        let now = Utc::now().to_rfc3339();
        SpectrumNode {
            id: id.into(),
            label: label.into(),
            content: content.into(),
            node_type: node_type.into(),
            layer: "context".into(),
            access_count: 0,
            last_accessed: now.clone(),
            created_at: now.clone(),
            updated_at: now,
            connections: vec![],
        }
    }

    fn import_snapshot(nodes: Vec<SpectrumNode>, edges: Vec<SpectrumEdge>) -> GraphSnapshot {
        let node_count = nodes.len();
        let edge_count = edges.len();
        GraphSnapshot {
            nodes,
            edges,
            stats: GraphMetrics {
                node_count,
                edge_count,
                avg_edge_weight: 0.0,
                strongest_edge_weight: 0.0,
                facet_distribution: HashMap::new(),
                most_connected_node: None,
                graph_density: 0.0,
            },
            view: None,
        }
    }

    #[test]
    fn live_graph_writes_enforce_bounds_and_replace_duplicate_content() {
        let (graph, _dir) = test_graph();
        let first = graph.add_node("Stable", "first", "note").unwrap();
        let second = graph.add_node("Stable", "second", "note").unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.content, "second");
        assert!(!second.content.contains("first\n---"));

        assert!(graph
            .add_node(&"x".repeat(MAX_IMPORT_LABEL_BYTES + 1), "body", "note")
            .is_err());
        assert!(graph.add_node("label", "body", "bad type!").is_err());
        assert!(graph
            .add_node_with_layer("label", "body", "note", "unbounded-layer")
            .is_err());
    }

    #[test]
    fn live_edges_and_vectors_reject_invalid_numeric_inputs() {
        let (graph, _dir) = test_graph();
        let left = graph.add_node("Left", "left", "note").unwrap();
        let right = graph.add_node("Right", "right", "note").unwrap();
        assert!(graph
            .add_edge(&left.id, &right.id, "related", f64::NAN)
            .is_err());
        assert!(graph
            .add_edge(&left.id, &right.id, "bad relation", 1.0)
            .is_err());
        assert!(graph
            .set_node_embedding(&left.id, &[f64::INFINITY])
            .is_err());
        assert!(graph.vector_search(&[], 10).is_err());
        assert!(graph.vector_search(&[0.1], MAX_VECTOR_RESULTS + 1).is_err());
    }

    // ─── Construction & Schema ─────────────────────────────────────────────

    #[test]
    fn test_new_creates_empty_graph() {
        let (g, _dir) = test_graph();
        let (nodes, edges) = g.stats().unwrap();
        assert_eq!(nodes, 0);
        assert_eq!(edges, 0);
    }

    #[test]
    fn test_new_enables_sqlite_secure_delete() {
        let (g, _dir) = test_graph();
        let secure_delete: i64 = g
            .conn
            .query_row("PRAGMA secure_delete", [], |row| row.get(0))
            .unwrap();
        assert_eq!(secure_delete, 1);
    }

    #[test]
    fn test_seed_demo_data_populates_graph() {
        let (g, _dir) = test_graph();
        assert!(g.seed_demo_data().unwrap()); // returns true on first call
        let (nodes, edges) = g.stats().unwrap();
        assert!(nodes >= 10, "expected ≥10 demo nodes, got {}", nodes);
        assert!(edges >= 8, "expected ≥8 demo edges, got {}", edges);
        // Second call should skip (graph already has data)
        assert!(!g.seed_demo_data().unwrap());
    }

    #[test]
    fn legacy_demo_cleanup_removes_only_seed_cohort_and_is_idempotent() {
        let (graph, dir) = test_graph();
        assert!(graph.seed_demo_data().unwrap());
        graph
            .conn
            .execute(
                "DELETE FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
            )
            .unwrap();
        drop(graph);

        let cleaned = SpectrumGraph::new(dir.path()).unwrap();
        assert_eq!(cleaned.stats().unwrap(), (0, 0));
        let intent_count: usize = cleaned
            .conn
            .query_row("SELECT COUNT(*) FROM intent_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(intent_count, 0);
        let marker_count: usize = cleaned
            .conn
            .query_row(
                "SELECT COUNT(*) FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count, 1);
        drop(cleaned);

        let reopened = SpectrumGraph::new(dir.path()).unwrap();
        assert_eq!(reopened.stats().unwrap(), (0, 0));
        let marker_count_after_reopen: usize = reopened
            .conn
            .query_row(
                "SELECT COUNT(*) FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count_after_reopen, 1);
    }

    #[test]
    fn legacy_demo_cleanup_preserves_adopted_nodes_and_user_edges() {
        let (graph, dir) = test_graph();
        assert!(graph.seed_demo_data().unwrap());

        graph
            .update_node(
                "demo-work-1",
                "My Weekly Goals",
                "Owner-edited goals that must survive migration",
            )
            .unwrap();
        graph.get_node("demo-task-1").unwrap().unwrap();

        let user_node = graph
            .add_node("Owner project", "Real owner-authored content", "work")
            .unwrap();
        let user_edge = graph
            .add_edge("demo-health-1", &user_node.id, "supports", 0.9)
            .unwrap();
        graph
            .conn
            .execute(
                "UPDATE edges SET weight = 0.9, reinforcements = 1
                 WHERE id = 'demo-edge-3'",
                [],
            )
            .unwrap();

        // A genuine later intent that happens to use fixture wording must not
        // be removed without the fixture cohort timestamp.
        graph
            .conn
            .execute(
                "INSERT INTO intent_log
                 (id, raw_input, intent_type, matched_nodes, confidence, created_at)
                 VALUES ('owner-intent', ?1, ?2, '[]', 0.85, '2040-01-01T00:00:00Z')",
                params![LEGACY_DEMO_INTENTS[0].0, LEGACY_DEMO_INTENTS[0].1],
            )
            .unwrap();

        graph
            .conn
            .execute(
                "DELETE FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
            )
            .unwrap();
        drop(graph);

        let cleaned = SpectrumGraph::new(dir.path()).unwrap();

        let edited = cleaned
            .get_node_without_access("demo-work-1")
            .unwrap()
            .expect("edited demo node must be preserved");
        assert_eq!(edited.label, "My Weekly Goals");
        assert!(cleaned
            .get_node_without_access("demo-task-1")
            .unwrap()
            .is_some());
        assert!(cleaned
            .get_node_without_access("demo-health-1")
            .unwrap()
            .is_some());
        assert!(cleaned
            .get_node_without_access("demo-learning-1")
            .unwrap()
            .is_some());
        assert!(cleaned
            .get_node_without_access("demo-learning-2")
            .unwrap()
            .is_some());
        assert!(cleaned
            .get_node_without_access("demo-finance-1")
            .unwrap()
            .is_none());

        let user_edge_count: usize = cleaned
            .conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE id = ?1",
                params![user_edge.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(user_edge_count, 1);
        let adopted_fixture_edge_count: usize = cleaned
            .conn
            .query_row(
                "SELECT COUNT(*) FROM edges WHERE id = 'demo-edge-3'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(adopted_fixture_edge_count, 1);
        let owner_intent_count: usize = cleaned
            .conn
            .query_row(
                "SELECT COUNT(*) FROM intent_log WHERE id = 'owner-intent'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(owner_intent_count, 1);
    }

    #[test]
    fn legacy_demo_cleanup_rolls_back_on_failure() {
        let (graph, _dir) = test_graph();
        assert!(graph.seed_demo_data().unwrap());
        graph
            .conn
            .execute(
                "DELETE FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
            )
            .unwrap();
        graph
            .conn
            .execute_batch(
                "CREATE TEMP TRIGGER reject_legacy_edge_cleanup
                 BEFORE DELETE ON edges
                 WHEN OLD.id LIKE 'demo-edge-%'
                 BEGIN
                     SELECT RAISE(ABORT, 'forced cleanup failure');
                 END;",
            )
            .unwrap();

        assert!(cleanup_legacy_demo_data(&graph.conn).is_err());
        assert_eq!(graph.stats().unwrap(), (10, 8));
        let intent_count: usize = graph
            .conn
            .query_row("SELECT COUNT(*) FROM intent_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(intent_count, 5);
        let marker_count: usize = graph
            .conn
            .query_row(
                "SELECT COUNT(*) FROM prismos_internal_migrations WHERE id = ?1",
                params![LEGACY_DEMO_CLEANUP_MIGRATION],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count, 0);
    }

    // ─── Node CRUD ─────────────────────────────────────────────────────────

    #[test]
    fn test_add_and_get_node() {
        let (g, _dir) = test_graph();
        let node = g.add_node("Test Label", "Some content", "work").unwrap();
        assert_eq!(node.label, "Test Label");
        assert_eq!(node.node_type, "work");
        assert_eq!(node.layer, "context"); // default layer

        let fetched = g.get_node(&node.id).unwrap().unwrap();
        assert_eq!(fetched.label, "Test Label");
        assert_eq!(fetched.access_count, 1); // get_node increments
    }

    #[test]
    fn test_add_node_with_layer() {
        let (g, _dir) = test_graph();
        let node = g
            .add_node_with_layer("Core Node", "core stuff", "learning", "core")
            .unwrap();
        assert_eq!(node.layer, "core");
    }

    #[test]
    fn test_add_node_deduplicates_same_label_and_type() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("Budget", "v1 content", "finance").unwrap();
        let n2 = g.add_node("Budget", "v2 content", "finance").unwrap();
        // Should return same node ID (deduplicated)
        assert_eq!(n1.id, n2.id);
        let (count, _) = g.stats().unwrap();
        assert_eq!(count, 1, "duplicate node was created");
    }

    #[test]
    fn test_search_nodes() {
        let (g, _dir) = test_graph();
        g.add_node("Rust Async Patterns", "async/await ownership", "learning")
            .unwrap();
        g.add_node("Cooking Recipes", "pasta pizza bread", "note")
            .unwrap();

        let results = g.search_nodes("Rust").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].label, "Rust Async Patterns");
    }

    #[test]
    fn test_delete_node() {
        let (g, _dir) = test_graph();
        let node = g.add_node("Temp", "delete me", "note").unwrap();
        g.delete_node(&node.id).unwrap();
        assert!(g.get_node(&node.id).unwrap().is_none());
    }

    #[test]
    fn test_update_node() {
        let (g, _dir) = test_graph();
        let node = g.add_node("Old Title", "old content", "note").unwrap();
        g.update_node(&node.id, "New Title", "new content").unwrap();
        let updated = g.get_node(&node.id).unwrap().unwrap();
        assert_eq!(updated.label, "New Title");
        assert_eq!(updated.content, "new content");
    }

    #[test]
    fn test_get_all_nodes_populates_connections() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "content a", "work").unwrap();
        let n2 = g.add_node("B", "content b", "work").unwrap();
        g.add_edge(&n1.id, &n2.id, "related", 1.0).unwrap();

        let nodes = g.get_all_nodes().unwrap();
        // At least one node should have connections populated
        let connected = nodes.iter().any(|n| !n.connections.is_empty());
        assert!(connected, "connections not populated in get_all_nodes");
    }

    // ─── Edge Operations ───────────────────────────────────────────────────

    #[test]
    fn test_add_edge() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        let edge = g.add_edge(&n1.id, &n2.id, "supports", 0.8).unwrap();
        assert_eq!(edge.relation, "supports");
        assert!((edge.weight - 0.8).abs() < 1e-9);
    }

    #[test]
    fn test_edge_weight_clamped() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        let edge = g.add_edge(&n1.id, &n2.id, "test", 999.0).unwrap();
        assert!(
            edge.weight <= MAX_EDGE_WEIGHT,
            "weight should be clamped to MAX_EDGE_WEIGHT"
        );
    }

    #[test]
    fn test_get_or_create_edge_creates_new() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("X", "x", "note").unwrap();
        let n2 = g.add_node("Y", "y", "note").unwrap();
        let (edge, created) = g.get_or_create_edge(&n1.id, &n2.id, "linked").unwrap();
        assert!(created);
        assert_eq!(edge.relation, "linked");
    }

    #[test]
    fn test_get_or_create_edge_returns_existing() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("X", "x", "note").unwrap();
        let n2 = g.add_node("Y", "y", "note").unwrap();
        let (e1, created1) = g.get_or_create_edge(&n1.id, &n2.id, "linked").unwrap();
        let (e2, created2) = g.get_or_create_edge(&n1.id, &n2.id, "linked").unwrap();
        assert!(created1);
        assert!(!created2, "second call should return existing edge");
        assert_eq!(e1.id, e2.id);
    }

    #[test]
    fn test_update_edge_weight_reinforces() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        let edge = g.add_edge(&n1.id, &n2.id, "test", 1.0).unwrap();
        let updated = g.update_edge_weight(&edge.id, 1.0).unwrap();
        assert!(
            updated.weight > edge.weight,
            "positive signal should increase weight"
        );
        assert_eq!(updated.reinforcements, 1);
        assert!(
            updated.momentum > 0.0,
            "momentum should be positive after positive signal"
        );
    }

    #[test]
    fn test_get_connections() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("Hub", "hub node", "work").unwrap();
        let n2 = g.add_node("Spoke1", "spoke", "work").unwrap();
        let n3 = g.add_node("Spoke2", "spoke", "work").unwrap();
        g.add_edge(&n1.id, &n2.id, "connects", 1.0).unwrap();
        g.add_edge(&n1.id, &n3.id, "connects", 0.5).unwrap();

        let conns = g.get_connections(&n1.id).unwrap();
        assert_eq!(conns.len(), 2);
    }

    #[test]
    fn test_get_all_edges() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        g.add_edge(&n1.id, &n2.id, "e1", 1.0).unwrap();
        let edges = g.get_all_edges().unwrap();
        assert_eq!(edges.len(), 1);
    }

    // ─── Query Intent ──────────────────────────────────────────────────────

    #[test]
    fn test_query_intent_matches_nodes() {
        let (g, _dir) = test_graph();
        g.add_node(
            "Rust Ownership",
            "Understanding Rust borrow checker and lifetimes",
            "learning",
        )
        .unwrap();
        g.add_node(
            "Cooking Pasta",
            "Italian pasta recipe with fresh tomatoes",
            "note",
        )
        .unwrap();

        let results = g
            .query_intent("Rust lifetimes borrow", "Query", &[])
            .unwrap();
        assert!(!results.is_empty(), "should match at least one node");
        assert_eq!(results[0].node.label, "Rust Ownership");
    }

    #[test]
    fn test_fts_search_finds_project_symbols() {
        let (g, _dir) = test_graph();
        let node = g
            .add_node_with_layer(
                "src/runtime/orchestrator.rs",
                "The WorkflowEngine coordinates ProjectKnowledge ingestion and retrieval.",
                "project_chunk",
                "knowledge",
            )
            .unwrap();
        let hits = g
            .fts_search_nodes(&["ProjectKnowledge".into()], 10)
            .unwrap();
        assert!(hits.iter().any(|hit| hit.id == node.id));
    }

    #[test]
    fn test_fts_migration_rebuilds_preexisting_nodes() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("spectrum_graph.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE nodes (
                    id TEXT PRIMARY KEY, label TEXT NOT NULL, content TEXT NOT NULL,
                    node_type TEXT NOT NULL DEFAULT 'note', layer TEXT NOT NULL DEFAULT 'context',
                    embedding BLOB, access_count INTEGER NOT NULL DEFAULT 0,
                    last_accessed TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                 );",
            )
            .unwrap();
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO nodes
                 (id, label, content, node_type, layer, last_accessed, created_at, updated_at)
                 VALUES ('pre-fts', 'Old row', 'legacyftstoken', 'note', 'context', ?1, ?1, ?1)",
                params![now],
            )
            .unwrap();
        }

        let graph = SpectrumGraph::new(dir.path()).unwrap();
        let count: usize = graph
            .conn
            .query_row(
                "SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH 'legacyftstoken'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let marker_count: usize = graph
            .conn
            .query_row(
                "SELECT COUNT(*) FROM prismos_internal_migrations
                 WHERE id = 'nodes_fts_backfill_v1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count, 1);
        drop(graph);

        let reopened = SpectrumGraph::new(dir.path()).unwrap();
        let marker_count_after_reopen: usize = reopened
            .conn
            .query_row(
                "SELECT COUNT(*) FROM prismos_internal_migrations
                 WHERE id = 'nodes_fts_backfill_v1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker_count_after_reopen, 1);
    }

    // ─── Graph Operations ──────────────────────────────────────────────────

    #[test]
    fn test_clear_graph() {
        let (g, _dir) = test_graph();
        g.add_node("A", "a", "work").unwrap();
        g.add_node("B", "b", "work").unwrap();
        let (nodes, edges) = g.clear_graph().unwrap();
        assert_eq!(nodes, 2);
        assert_eq!(edges, 0);
        let (remaining, _) = g.stats().unwrap();
        assert_eq!(remaining, 0);
        let free_pages: i64 = g
            .conn
            .query_row("PRAGMA freelist_count", [], |row| row.get(0))
            .unwrap();
        assert_eq!(free_pages, 0, "VACUUM should reclaim free database pages");
    }

    #[test]
    fn test_get_full_graph() {
        let (g, _dir) = test_graph();
        g.add_node("A", "a", "work").unwrap();
        let snapshot = g.get_full_graph().unwrap();
        assert_eq!(snapshot.nodes.len(), 1);
        assert_eq!(snapshot.stats.node_count, 1);
        assert!(snapshot.view.is_none());
    }

    #[test]
    fn visualization_graph_summarizes_generated_suggestions() {
        let (g, _dir) = test_graph();
        let durable = g.add_node("Durable topic", "kept visible", "work").unwrap();
        let related = g
            .add_node("Related topic", "also visible", "learning")
            .unwrap();
        g.add_edge(&durable.id, &related.id, "supports", 0.8)
            .unwrap();
        let suggestion = ProactiveSuggestion {
            id: "generated-suggestion".into(),
            text: "Generated card".into(),
            action_intent: "Review something".into(),
            icon: "✨".into(),
            category: "patterns".into(),
            confidence: 0.7,
        };
        g.store_proactive_suggestion(&suggestion).unwrap();
        g.add_edge("generated-suggestion", &durable.id, "suggests", 0.4)
            .unwrap();

        let snapshot = g.get_visualization_graph().unwrap();
        assert_eq!(snapshot.nodes.len(), 2);
        assert!(snapshot.nodes.iter().any(|node| node.id == durable.id));
        assert!(snapshot.nodes.iter().any(|node| node.id == related.id));
        assert!(snapshot
            .nodes
            .iter()
            .all(|node| node.node_type != "suggestion"));
        assert_eq!(snapshot.edges.len(), 1);
        assert_eq!(snapshot.edges[0].relation, "supports");
        let visible_ids: HashSet<&str> =
            snapshot.nodes.iter().map(|node| node.id.as_str()).collect();
        assert!(snapshot
            .edges
            .iter()
            .all(|edge| visible_ids.contains(edge.source_id.as_str())
                && visible_ids.contains(edge.target_id.as_str())));
        let view = snapshot.view.expect("visualization metadata");
        assert_eq!(view.total_node_count, 3);
        assert_eq!(view.total_edge_count, 2);
        assert_eq!(view.shown_node_count, 2);
        assert_eq!(view.shown_edge_count, 1);
        assert_eq!(view.summarized_suggestion_count, 1);
        assert_eq!(view.omitted_due_to_limit, 0);
    }

    #[test]
    fn test_get_metrics_on_empty_graph() {
        let (g, _dir) = test_graph();
        let metrics = g.get_metrics().unwrap();
        assert_eq!(metrics.node_count, 0);
        assert_eq!(metrics.edge_count, 0);
        assert!((metrics.avg_edge_weight - 0.0).abs() < 1e-9);
    }

    #[test]
    fn test_get_metrics_with_data() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("Work", "daily tasks", "work").unwrap();
        let n2 = g.add_node("Health", "exercise log", "health").unwrap();
        g.add_edge(&n1.id, &n2.id, "enables", 2.0).unwrap();

        let metrics = g.get_metrics().unwrap();
        assert_eq!(metrics.node_count, 2);
        assert_eq!(metrics.edge_count, 1);
        assert!((metrics.avg_edge_weight - 2.0).abs() < 1e-9);
        assert_eq!(metrics.facet_distribution.len(), 2);
    }

    // ─── Deduplication ─────────────────────────────────────────────────────

    #[test]
    fn test_deduplicate_nodes() {
        let (g, _dir) = test_graph();
        // Insert duplicates by bypassing the dedup in add_node
        let now = Utc::now().to_rfc3339();
        for i in 0..3 {
            g.conn.execute(
                "INSERT INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
                 VALUES (?1, 'Same', 'content', 'note', 'context', ?2, ?3, ?3, ?3)",
                params![format!("dup-{}", i), i as u32, now],
            ).unwrap();
        }
        let (before, _) = g.stats().unwrap();
        assert_eq!(before, 3);

        let merged = g.deduplicate_nodes().unwrap();
        assert_eq!(merged, 2, "should have merged 2 duplicates");

        let (after, _) = g.stats().unwrap();
        assert_eq!(after, 1);
    }

    #[test]
    fn test_deduplicate_preserves_same_named_chunks_from_different_sources() {
        let (g, _dir) = test_graph();
        let indexed_at = Utc::now().to_rfc3339();
        let shared_label = "website · src/index.ts [1/1]";
        let source_a = KnowledgeChunkRecord {
            id: "knowledge-source-a-index".into(),
            label: shared_label.into(),
            content: "Project: website\nSource: src/index.ts\n\nsource A".into(),
            source_path: "src/index.ts".into(),
            content_hash: "hash-a".into(),
        };
        let source_b = KnowledgeChunkRecord {
            id: "knowledge-source-b-index".into(),
            label: shared_label.into(),
            content: "Project: website\nSource: src/index.ts\n\nsource B".into(),
            source_path: "src/index.ts".into(),
            content_hash: "hash-b".into(),
        };

        g.sync_knowledge_source(
            "project-source-a",
            "website",
            "/projects/a/website",
            &indexed_at,
            1,
            8,
            0,
            0,
            &[source_a],
        )
        .unwrap();
        g.sync_knowledge_source(
            "project-source-b",
            "website",
            "/projects/b/website",
            &indexed_at,
            1,
            8,
            0,
            0,
            &[source_b],
        )
        .unwrap();

        assert_eq!(g.deduplicate_nodes().unwrap(), 0);
        assert!(g
            .get_node_without_access("knowledge-source-a-index")
            .unwrap()
            .is_some());
        assert!(g
            .get_node_without_access("knowledge-source-b-index")
            .unwrap()
            .is_some());
        assert_eq!(g.list_knowledge_sources().unwrap().len(), 2);
    }

    // ─── Temporal Helpers ──────────────────────────────────────────────────

    #[test]
    fn test_temporal_decay_recent_edge() {
        let (g, _dir) = test_graph();
        let now = Utc::now().to_rfc3339();
        let decay = g.calculate_temporal_decay(&now);
        // Should be very close to 1.0 for a just-reinforced edge
        assert!(
            decay > 0.99,
            "decay for recent edge should be ~1.0, got {}",
            decay
        );
    }

    #[test]
    fn test_temporal_decay_empty_timestamp() {
        let (g, _dir) = test_graph();
        let decay = g.calculate_temporal_decay("");
        assert!(
            (decay - 0.9).abs() < 1e-9,
            "empty timestamp should return 0.9 default"
        );
    }

    #[test]
    fn test_temporal_boost_recent_node() {
        let (g, _dir) = test_graph();
        let now = Utc::now().to_rfc3339();
        let boost = g.calculate_temporal_boost(&now);
        assert!(
            boost > 0.9,
            "boost for recently updated node should be high, got {}",
            boost
        );
    }

    // ─── Vector Embeddings ─────────────────────────────────────────────────

    #[test]
    fn test_set_and_get_embedding() {
        let (g, _dir) = test_graph();
        let node = g.add_node("Embed Test", "content", "note").unwrap();
        let embedding = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        g.set_node_embedding(&node.id, &embedding).unwrap();

        let loaded = g.get_node_embedding(&node.id).unwrap().unwrap();
        assert_eq!(loaded.len(), 5);
        assert!((loaded[0] - 0.1).abs() < 1e-9);
        assert!((loaded[4] - 0.5).abs() < 1e-9);
    }

    #[test]
    fn embedding_backfill_does_not_refresh_content_timestamp() {
        let (g, _dir) = test_graph();
        let node = g
            .add_node("Historical source", "old but useful", "note")
            .unwrap();

        g.set_node_embedding(&node.id, &[0.25, 0.75]).unwrap();

        let loaded = g.get_node(&node.id).unwrap().unwrap();
        assert_eq!(loaded.updated_at, node.updated_at);
    }

    #[test]
    fn test_content_updates_invalidate_stale_embeddings() {
        let (g, _dir) = test_graph();
        let node = g.add_node("Mutable", "old content", "note").unwrap();
        g.set_node_embedding(&node.id, &[0.1, 0.2]).unwrap();
        g.update_node(&node.id, "Mutable", "new content").unwrap();
        assert!(g.get_node_embedding(&node.id).unwrap().is_none());
    }

    #[test]
    fn test_source_snapshot_upsert_replaces_instead_of_appending() {
        let (g, _dir) = test_graph();
        let first = g
            .upsert_node_snapshot("/project/README.md", "version one", "document", "knowledge")
            .unwrap();
        g.set_node_embedding(&first.id, &[0.1, 0.2]).unwrap();
        let second = g
            .upsert_node_snapshot("/project/README.md", "version two", "document", "knowledge")
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(second.content, "version two");
        assert!(!second.content.contains("version one"));
        assert!(g.get_node_embedding(&second.id).unwrap().is_none());
    }

    #[test]
    fn test_knowledge_source_sync_preserves_unchanged_and_removes_stale_chunks() {
        let (g, _dir) = test_graph();
        let chunks = vec![
            KnowledgeChunkRecord {
                id: "knowledge-a".into(),
                label: "demo · README.md [1/1]".into(),
                content: "Project: demo\nSource: README.md\n\nalpha facts".into(),
                source_path: "README.md".into(),
                content_hash: "hash-a".into(),
            },
            KnowledgeChunkRecord {
                id: "knowledge-b".into(),
                label: "demo · src/lib.rs [1/1]".into(),
                content: "Project: demo\nSource: src/lib.rs\n\nbeta facts".into(),
                source_path: "src/lib.rs".into(),
                content_hash: "hash-b".into(),
            },
        ];
        g.sync_knowledge_source(
            "source-demo",
            "demo",
            "/tmp/demo",
            "2026-01-01T00:00:00Z",
            2,
            100,
            0,
            0,
            &chunks,
        )
        .unwrap();
        g.set_node_embedding("knowledge-a", &[0.2, 0.8]).unwrap();

        g.sync_knowledge_source(
            "source-demo",
            "demo",
            "/tmp/demo",
            "2026-01-02T00:00:00Z",
            1,
            50,
            1,
            0,
            &chunks[..1],
        )
        .unwrap();

        assert!(g.get_node_embedding("knowledge-a").unwrap().is_some());
        assert!(g.get_node("knowledge-b").unwrap().is_none());
        let sources = g.list_knowledge_sources().unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].chunk_count, 1);

        let deleted = g.delete_knowledge_source("source-demo").unwrap();
        assert_eq!(
            deleted, 2,
            "one chunk plus its project overview should be removed"
        );
        assert!(g.list_knowledge_sources().unwrap().is_empty());
    }

    #[test]
    fn test_vector_search() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "note").unwrap();
        let n2 = g.add_node("B", "b", "note").unwrap();
        g.set_node_embedding(&n1.id, &[1.0, 0.0, 0.0]).unwrap();
        g.set_node_embedding(&n2.id, &[0.0, 1.0, 0.0]).unwrap();

        let results = g.vector_search(&[1.0, 0.0, 0.0], 5).unwrap();
        assert!(!results.is_empty());
        // n1 should be the best match (identical vector)
        assert_eq!(results[0].0, n1.id);
        assert!((results[0].1 - 1.0).abs() < 1e-9);
    }

    // ─── Response Feedback ─────────────────────────────────────────────────

    #[test]
    fn test_submit_and_count_feedback() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        g.add_edge(&n1.id, &n2.id, "link", 1.0).unwrap();

        g.submit_response_feedback(
            "conv-1",
            "What is X?",
            "X is Y",
            1,
            &[n1.id.clone(), n2.id.clone()],
            "mistral",
        )
        .unwrap();

        let count = g.get_feedback_count().unwrap();
        assert!(count >= 1, "feedback count should be ≥1");
    }

    #[test]
    fn test_get_good_examples() {
        let (g, _dir) = test_graph();
        g.submit_response_feedback(
            "conv-1",
            "Explain Rust ownership",
            "Rust uses ownership for memory safety",
            1,
            &[],
            "mistral",
        )
        .unwrap();

        let examples = g.get_good_examples("Rust ownership", 5).unwrap();
        assert!(!examples.is_empty());
        assert!(examples[0].0.contains("Rust"));
    }

    #[test]
    fn project_grounded_feedback_does_not_copy_question_or_answer() {
        let (g, _dir) = test_graph();
        let chunk = KnowledgeChunkRecord {
            id: "knowledge-feedback-chunk".into(),
            label: "project · source/file.rs [1/1]".into(),
            content: "Source: source/file.rs\n\nprivate project fact".into(),
            source_path: "file.rs".into(),
            content_hash: "feedback-hash".into(),
        };
        g.sync_knowledge_source(
            "project-feedback",
            "project",
            "/project",
            &Utc::now().to_rfc3339(),
            1,
            10,
            0,
            0,
            &[chunk],
        )
        .unwrap();

        g.submit_response_feedback(
            "feedback-conversation",
            "private question",
            "private project fact",
            1,
            &["knowledge-feedback-chunk".into()],
            "mistral",
        )
        .unwrap();

        let stored: usize = g
            .conn
            .query_row("SELECT COUNT(*) FROM response_feedback", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, 0);
    }

    // ─── Hybrid (Semantic + Keyword) Retrieval ─────────────────────────────

    #[test]
    fn test_nodes_missing_embedding_backfill_cycle() {
        let (g, _dir) = test_graph();
        let n = g
            .add_node("Alpha", "alpha node content for testing", "work")
            .unwrap();
        let missing = g.nodes_missing_embedding(50).unwrap();
        assert!(missing.iter().any(|(id, _, _)| id == &n.id));

        g.set_node_embedding(&n.id, &[1.0, 0.0, 0.0]).unwrap();
        let missing = g.nodes_missing_embedding(50).unwrap();
        assert!(
            !missing.iter().any(|(id, _, _)| id == &n.id),
            "embedded node must leave the backfill queue"
        );
    }

    #[test]
    fn test_query_intent_hybrid_finds_semantic_only_hit() {
        let (g, _dir) = test_graph();
        // Profile node — shares NO ≥4-char keyword with the query "who am i".
        let n = g
            .add_node(
                "User profile",
                "Manish builds local-first software products",
                "personal",
            )
            .unwrap();
        g.set_node_embedding(&n.id, &[1.0, 0.0, 0.0]).unwrap();

        // Keyword-only retrieval cannot find it
        let kw = g.query_intent("who am i", "Query", &[]).unwrap();
        assert!(!kw.iter().any(|r| r.node.id == n.id));

        // Hybrid retrieval with a nearby query embedding finds it
        let hy = g
            .query_intent_hybrid("who am i", "Query", &[], Some(&[0.9, 0.1, 0.0]))
            .unwrap();
        assert!(
            hy.iter().any(|r| r.node.id == n.id),
            "semantic-only hit must surface in hybrid retrieval"
        );
    }

    #[test]
    fn test_query_intent_hybrid_none_matches_keyword_path() {
        let (g, _dir) = test_graph();
        g.add_node(
            "Rust notes",
            "Rust lifetimes and borrowing rules",
            "learning",
        )
        .unwrap();
        let kw = g.query_intent("Rust lifetimes", "Query", &[]).unwrap();
        let hy = g
            .query_intent_hybrid("Rust lifetimes", "Query", &[], None)
            .unwrap();
        assert_eq!(
            kw.len(),
            hy.len(),
            "None embedding must behave like keyword-only"
        );
    }

    #[test]
    fn test_query_intent_hybrid_ignores_below_noise_floor() {
        let (g, _dir) = test_graph();
        let n = g
            .add_node("Unrelated", "completely different topic entirely", "work")
            .unwrap();
        // Orthogonal embedding → cosine 0.0 < 0.35 floor → must NOT surface
        g.set_node_embedding(&n.id, &[0.0, 1.0, 0.0]).unwrap();
        let hy = g
            .query_intent_hybrid("who am i", "Query", &[], Some(&[1.0, 0.0, 0.0]))
            .unwrap();
        assert!(!hy.iter().any(|r| r.node.id == n.id));
    }

    #[test]
    fn test_pinned_profile_nodes_returns_personal_core_only() {
        let (g, _dir) = test_graph();
        let pin = g
            .add_node_with_layer(
                "Manish (owner)",
                "Solo builder of 8 products",
                "personal",
                "core",
            )
            .unwrap();
        g.add_node_with_layer(
            "Some doc",
            "regular knowledge content",
            "document",
            "knowledge",
        )
        .unwrap();
        g.add_node("Casual note", "personal-ish but context layer", "personal")
            .unwrap();

        let pins = g.pinned_profile_nodes(4).unwrap();
        assert!(
            pins.iter().any(|p| p.id == pin.id),
            "personal/core node must be pinned"
        );
        assert!(
            pins.iter()
                .all(|p| p.node_type == "personal" && p.layer == "core"),
            "only personal+core nodes may be pinned"
        );
    }

    #[test]
    fn test_recent_conversation_nodes_are_bounded_and_chronological() {
        let (g, _dir) = test_graph();
        let first = g
            .add_node_with_layer(
                "Chat first",
                "Q: one\n\nA: first",
                "conversation",
                "ephemeral",
            )
            .unwrap();
        let second = g
            .add_node_with_layer(
                "Chat second",
                "Q: two\n\nA: second",
                "conversation",
                "ephemeral",
            )
            .unwrap();
        let third = g
            .add_node_with_layer(
                "Chat third",
                "Q: three\n\nA: third",
                "conversation",
                "ephemeral",
            )
            .unwrap();
        g.conn
            .execute(
                "UPDATE nodes SET created_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
                params![first.id],
            )
            .unwrap();
        g.conn
            .execute(
                "UPDATE nodes SET created_at = '2026-01-02T00:00:00Z' WHERE id = ?1",
                params![second.id],
            )
            .unwrap();
        g.conn
            .execute(
                "UPDATE nodes SET created_at = '2026-01-03T00:00:00Z' WHERE id = ?1",
                params![third.id],
            )
            .unwrap();

        let turns = g.recent_conversation_nodes(2).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].label, "Chat second");
        assert_eq!(turns[1].label, "Chat third");
    }

    // ─── Cognitive Profile ─────────────────────────────────────────────────

    #[test]
    fn test_cognitive_profile_default() {
        let (g, _dir) = test_graph();
        let profile = g.get_cognitive_profile().unwrap();
        assert!((profile.depth - 0.5).abs() < 1e-9);
        assert_eq!(profile.interaction_count, 0);
    }

    #[test]
    fn test_save_and_load_cognitive_profile() {
        let (g, _dir) = test_graph();
        let profile = crate::cognitive_profile::CognitiveProfile {
            depth: 0.8,
            creativity: 0.9,
            interaction_count: 42,
            ..Default::default()
        };
        g.save_cognitive_profile(&profile).unwrap();

        let loaded = g.get_cognitive_profile().unwrap();
        assert!((loaded.depth - 0.8).abs() < 1e-9);
        assert!((loaded.creativity - 0.9).abs() < 1e-9);
        assert_eq!(loaded.interaction_count, 42);
    }

    // ─── Cognitive Drift ───────────────────────────────────────────────────

    #[test]
    fn test_cognitive_drift_with_no_snapshots() {
        let (g, _dir) = test_graph();
        let drift = g.get_cognitive_drift(4).unwrap();
        assert_eq!(drift.summary, "insufficient_data");
        assert!(
            drift.weeks_compared <= 1,
            "should have minimal weeks with no snapshots"
        );
    }

    #[test]
    fn test_cognitive_snapshot_and_drift() {
        let (g, _dir) = test_graph();
        let profile = crate::cognitive_profile::CognitiveProfile {
            depth: 0.6,
            creativity: 0.4,
            formality: 0.5,
            technical_level: 0.7,
            example_preference: 0.3,
            interaction_count: 10,
            last_updated: String::new(),
        };
        g.save_cognitive_snapshot(&profile).unwrap();

        let drift = g.get_cognitive_drift(4).unwrap();
        assert!(drift.weeks_compared >= 1);
    }

    // ─── Refraction Journal ────────────────────────────────────────────────

    #[test]
    fn test_log_and_get_refraction_insights() {
        let (g, _dir) = test_graph();
        let id = g
            .log_refraction("test query", "Query", "Direct", "Analytical")
            .unwrap();
        assert!(!id.is_empty());

        g.update_refraction_choice(&id, "Creative").unwrap();

        let insights = g.get_refraction_insights().unwrap();
        assert_eq!(insights.total_refractions, 1);
        assert!(insights.band_distribution.contains_key("Analytical"));
    }

    // ─── Agent Memory ──────────────────────────────────────────────────────

    #[test]
    fn test_store_and_recall_agent_memory() {
        let (g, _dir) = test_graph();
        g.store_agent_memory("reasoner", "last_topic", "Rust async patterns")
            .unwrap();
        g.store_agent_memory("reasoner", "preference", "verbose explanations")
            .unwrap();

        let memories = g.recall_agent_memory("reasoner", 10).unwrap();
        assert_eq!(memories.len(), 2);
    }

    #[test]
    fn test_agent_memory_upsert() {
        let (g, _dir) = test_graph();
        g.store_agent_memory("sentinel", "alert", "v1").unwrap();
        g.store_agent_memory("sentinel", "alert", "v2").unwrap();

        let memories = g.recall_agent_memory("sentinel", 10).unwrap();
        assert_eq!(memories.len(), 1, "upsert should not create duplicates");
        assert_eq!(memories[0].decision, "v2");
    }

    // ─── Domain Profile ────────────────────────────────────────────────────

    #[test]
    fn test_domain_profile_default() {
        let (g, _dir) = test_graph();
        let profile = g.get_domain_profile().unwrap();
        assert_eq!(profile["primary_domain"], "General");
    }

    #[test]
    fn test_save_and_get_domain_profile() {
        let (g, _dir) = test_graph();
        g.save_domain_profile("{\"Medical\":5}", 5, "Medical", 0.85)
            .unwrap();

        let loaded = g.get_domain_profile().unwrap();
        assert_eq!(loaded["primary_domain"], "Medical");
        assert_eq!(loaded["total_queries"], 5);
    }

    // ─── Persist / Load ────────────────────────────────────────────────────

    #[test]
    fn test_persist_and_load() {
        let (g, dir) = test_graph();
        g.add_node("PersistTest", "content to persist", "work")
            .unwrap();

        let export_path = dir.path().join("export.json");
        let msg = g.persist(&export_path).unwrap();
        assert!(msg.contains("1 nodes"));

        // Create a fresh graph and load into it
        let dir2 = tempfile::tempdir().unwrap();
        let g2 = SpectrumGraph::new(dir2.path()).unwrap();
        let load_msg = g2.load(&export_path).unwrap();
        assert!(load_msg.contains("1 new nodes"));

        let (nodes, _) = g2.stats().unwrap();
        assert_eq!(nodes, 1);
    }

    #[test]
    fn test_portable_snapshots_omit_managed_project_excerpts() {
        let (graph, dir) = test_graph();
        let normal = graph.add_node("Portable note", "keep me", "note").unwrap();
        let chunk = KnowledgeChunkRecord {
            id: "knowledge-private-chunk".into(),
            label: "private · src/lib.rs [1/1]".into(),
            content: "Project: private\nSource: src/lib.rs\n\nprivate source text".into(),
            source_path: "src/lib.rs".into(),
            content_hash: "private-hash".into(),
        };
        graph
            .sync_knowledge_source(
                "project-private",
                "private",
                "/projects/private",
                &Utc::now().to_rfc3339(),
                1,
                19,
                0,
                0,
                &[chunk],
            )
            .unwrap();
        graph
            .add_edge(&normal.id, "knowledge-private-chunk", "derived_from", 1.0)
            .unwrap();

        let portable = graph.get_portable_graph().unwrap();
        assert_eq!(portable.nodes.len(), 1);
        assert_eq!(portable.nodes[0].id, normal.id);
        assert!(portable.edges.is_empty());

        let export_path = dir.path().join("portable.json");
        graph.persist(&export_path).unwrap();
        let restored_dir = tempfile::tempdir().unwrap();
        let restored = SpectrumGraph::new(restored_dir.path()).unwrap();
        restored.load(&export_path).unwrap();
        assert!(restored
            .get_node_without_access(&normal.id)
            .unwrap()
            .is_some());
        assert!(restored
            .get_node_without_access("knowledge-private-chunk")
            .unwrap()
            .is_none());
        assert!(restored.list_knowledge_sources().unwrap().is_empty());
    }

    #[test]
    fn test_portable_snapshot_omits_legacy_watcher_and_attachment_chunks() {
        let (graph, _dir) = test_graph();
        let legacy = graph
            .add_node(
                "📄 src/private.rs",
                "Local file: src/private.rs\n\ncopied source",
                "document",
            )
            .unwrap();
        let emoji_only = graph
            .add_node("📄 Personal notes", "ordinary user document", "document")
            .unwrap();
        let prefix_only = graph
            .add_node(
                "Migration note",
                "Local file: this is ordinary prose",
                "document",
            )
            .unwrap();
        let attachment_chunk = graph
            .add_node(
                "📄 meeting.txt [chunk 1/1]",
                "Source: meeting.txt\n\none-off private attachment",
                "doc_chunk",
            )
            .unwrap();
        let touching = graph
            .add_edge(&emoji_only.id, &legacy.id, "references", 1.0)
            .unwrap();
        let attachment_edge = graph
            .add_edge(&emoji_only.id, &attachment_chunk.id, "references", 1.0)
            .unwrap();
        let portable_edge = graph
            .add_edge(&emoji_only.id, &prefix_only.id, "related", 1.0)
            .unwrap();

        let portable = graph.get_portable_graph().unwrap();
        let ids: HashSet<&str> = portable.nodes.iter().map(|node| node.id.as_str()).collect();
        assert!(!ids.contains(legacy.id.as_str()));
        assert!(!ids.contains(attachment_chunk.id.as_str()));
        assert!(ids.contains(emoji_only.id.as_str()));
        assert!(ids.contains(prefix_only.id.as_str()));
        assert!(!portable.edges.iter().any(|edge| edge.id == touching.id));
        assert!(!portable
            .edges
            .iter()
            .any(|edge| edge.id == attachment_edge.id));
        assert!(portable
            .edges
            .iter()
            .any(|edge| edge.id == portable_edge.id));
    }

    #[test]
    fn forgetting_a_source_removes_owned_and_directly_derived_copies() {
        let (graph, _dir) = test_graph();
        let chunk = KnowledgeChunkRecord {
            id: "knowledge-forget-chunk".into(),
            label: "project · project-forget/src/lib.rs [1/1]".into(),
            content: "Project: project\nSource: project-forget/src/lib.rs\n\nsecret fact".into(),
            source_path: "src/lib.rs".into(),
            content_hash: "forget-hash".into(),
        };
        graph
            .sync_knowledge_source(
                "project-forget",
                "project",
                "/projects/project",
                &Utc::now().to_rfc3339(),
                1,
                11,
                0,
                0,
                &[chunk],
            )
            .unwrap();
        let conversation = graph
            .add_node_with_layer(
                "Chat: project fact",
                "Q: fact?\n\nA: secret fact",
                "conversation",
                "ephemeral",
            )
            .unwrap();
        let entity = graph
            .add_node_with_layer(
                "secret concept",
                "Concept extracted from conversation: \"fact?\"\nRelated response: secret fact",
                "entity",
                "context",
            )
            .unwrap();
        graph
            .add_edge(
                &conversation.id,
                "knowledge-forget-chunk",
                "derived_from",
                1.0,
            )
            .unwrap();
        graph
            .add_edge(&entity.id, "knowledge-forget-chunk", "related_to", 1.0)
            .unwrap();

        graph.delete_knowledge_source("project-forget").unwrap();

        assert!(graph
            .get_node_without_access("knowledge-forget-chunk")
            .unwrap()
            .is_none());
        assert!(graph
            .get_node_without_access(&conversation.id)
            .unwrap()
            .is_none());
        assert!(graph.get_node_without_access(&entity.id).unwrap().is_none());
    }

    // ─── Anticipate Needs ──────────────────────────────────────────────────

    #[test]
    fn test_anticipate_needs_empty_graph() {
        let (g, _dir) = test_graph();
        let needs = g.anticipate_needs().unwrap();
        assert!(needs.is_empty(), "empty graph should produce no needs");
    }

    // ─── Proactive Suggestions ─────────────────────────────────────────────

    #[test]
    fn test_proactive_suggestions_empty_graph() {
        let (g, _dir) = test_graph();
        let suggestions = g.generate_proactive_suggestions().unwrap();
        assert!(suggestions.is_empty());
    }

    #[test]
    fn generating_proactive_suggestions_is_read_only() {
        let (g, _dir) = test_graph();
        g.add_node("Durable topic", "local knowledge", "work")
            .unwrap();
        let before = g.stats().unwrap();
        let _ = g.generate_proactive_suggestions().unwrap();
        let after = g.stats().unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn test_store_proactive_suggestion() {
        let (g, _dir) = test_graph();
        let suggestion = ProactiveSuggestion {
            id: "test-sug-1".to_string(),
            text: "Test suggestion".to_string(),
            action_intent: "Do something".to_string(),
            icon: "🎯".to_string(),
            category: "test".to_string(),
            confidence: 0.75,
        };
        g.store_proactive_suggestion(&suggestion).unwrap();

        let (nodes, _) = g.stats().unwrap();
        assert_eq!(nodes, 1);
    }

    // ─── Strengthen Related Edges ──────────────────────────────────────────

    #[test]
    fn test_strengthen_related_edges() {
        let (g, _dir) = test_graph();
        let n1 = g
            .add_node("Rust Patterns", "ownership", "learning")
            .unwrap();
        let n2 = g.add_node("Rust Async", "futures", "learning").unwrap();
        g.add_edge(&n1.id, &n2.id, "related", 1.0).unwrap();

        let count = g.strengthen_related_edges(&["rust".to_string()]).unwrap();
        assert!(count >= 1, "should strengthen at least 1 edge");
    }

    #[test]
    fn test_strengthen_empty_keywords() {
        let (g, _dir) = test_graph();
        let count = g.strengthen_related_edges(&[]).unwrap();
        assert_eq!(count, 0);
    }

    // ─── Promote Active Nodes ──────────────────────────────────────────────

    #[test]
    fn test_promote_active_nodes() {
        let (g, _dir) = test_graph();
        let now = Utc::now().to_rfc3339();
        // Insert an ephemeral node with access_count >= 3
        g.conn.execute(
            "INSERT INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
             VALUES ('promo-1', 'Promoted', 'content', 'note', 'ephemeral', 5, ?1, ?1, ?1)",
            params![now],
        ).unwrap();

        let promoted = g.promote_active_nodes().unwrap();
        assert_eq!(promoted, 1);

        let node = g.get_node("promo-1").unwrap().unwrap();
        assert_eq!(node.layer, "context");
    }

    // ─── Decay All Edges ───────────────────────────────────────────────────

    #[test]
    fn test_decay_all_edges_no_change_for_recent() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        g.add_edge(&n1.id, &n2.id, "link", 1.0).unwrap();

        // Recently created edges should have negligible decay
        let updated = g.decay_all_edges().unwrap();
        assert_eq!(updated, 0, "recently created edges should not decay");
    }

    // ─── Edge Prophecy ─────────────────────────────────────────────────────

    #[test]
    fn test_predict_edges_same_domain() {
        let (g, _dir) = test_graph();
        g.add_node("React Hooks", "useState useEffect custom hooks", "learning")
            .unwrap();
        g.add_node(
            "React Context",
            "useContext provider custom hooks",
            "learning",
        )
        .unwrap();

        let predictions = g.predict_edges(5).unwrap();
        // Both are "learning" type with shared words — should predict a link
        assert!(!predictions.is_empty(), "should predict at least one edge");
    }

    #[test]
    fn test_confirm_predicted_edge() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();

        let edge = g.confirm_predicted_edge(&n1.id, &n2.id).unwrap();
        assert_eq!(edge.relation, "predicted_confirmed");
        let (_, edge_count) = g.stats().unwrap();
        assert_eq!(edge_count, 1);
    }

    #[test]
    fn test_dismiss_predicted_edge() {
        let (g, _dir) = test_graph();
        let n1 = g.add_node("A", "a", "work").unwrap();
        let n2 = g.add_node("B", "b", "work").unwrap();
        g.dismiss_predicted_edge(&n1.id, &n2.id).unwrap();

        // After dismissal, predict_edges should exclude this pair
        let predictions = g.predict_edges(10).unwrap();
        let found = predictions.iter().any(|p| {
            (p.source_id == n1.id && p.target_id == n2.id)
                || (p.source_id == n2.id && p.target_id == n1.id)
        });
        assert!(!found, "dismissed prediction should not appear again");
    }

    // ─── Model Performance ─────────────────────────────────────────────────

    #[test]
    fn test_store_model_performance() {
        let (g, _dir) = test_graph();
        g.store_model_performance("mistral", "General", 150.0, 0.8, "Query")
            .unwrap();
        g.store_model_performance("llama3", "Medical", 200.0, 0.9, "Analyze")
            .unwrap();
        // Should not error — just verifies storage works
    }

    // ─── Daily Brief ───────────────────────────────────────────────────────

    #[test]
    fn test_daily_brief_empty_graph() {
        let (g, _dir) = test_graph();
        let brief = g.get_daily_brief().unwrap();
        assert_eq!(brief["total_nodes"], 0);
        assert_eq!(brief["total_edges"], 0);
    }

    // ─── Merge / Diff ──────────────────────────────────────────────────────

    #[test]
    fn test_merge_graph_adds_new_nodes() {
        let (g, _dir) = test_graph();
        let now = Utc::now().to_rfc3339();

        let incoming = GraphSnapshot {
            nodes: vec![SpectrumNode {
                id: "remote-1".into(),
                label: "Remote Node".into(),
                content: "from another device".into(),
                node_type: "note".into(),
                layer: "context".into(),
                access_count: 1,
                last_accessed: now.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
                connections: vec![],
            }],
            edges: vec![],
            stats: GraphMetrics {
                node_count: 1,
                edge_count: 0,
                avg_edge_weight: 0.0,
                strongest_edge_weight: 0.0,
                facet_distribution: HashMap::new(),
                most_connected_node: None,
                graph_density: 0.0,
            },
            view: None,
        };

        let result = g.merge_graph(&incoming, &MergeStrategy::Latest).unwrap();
        assert!(result.success);
        assert_eq!(result.nodes_added, 1);

        let (count, _) = g.stats().unwrap();
        assert_eq!(count, 1);
    }

    // ─── Export Sync Package ───────────────────────────────────────────────

    #[test]
    fn test_merge_rejects_oversized_content_before_writing() {
        let (g, _dir) = test_graph();
        let oversized = "x".repeat(MAX_IMPORT_CONTENT_BYTES + 1);
        let incoming = import_snapshot(
            vec![import_node("oversized", "Oversized", &oversized, "note")],
            vec![],
        );

        let error = g
            .merge_graph(&incoming, &MergeStrategy::Latest)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("content exceeds"),
            "unexpected error: {error}"
        );
        assert_eq!(g.stats().unwrap(), (0, 0));
    }

    #[test]
    fn test_import_validation_rejects_node_count_over_limit() {
        let nodes = (0..=MAX_IMPORT_NODES)
            .map(|index| import_node(&format!("node-{index}"), "N", "", "note"))
            .collect();
        let incoming = import_snapshot(nodes, vec![]);

        let error = validate_import_snapshot(&incoming).unwrap_err().to_string();
        assert!(error.contains("nodes exceeds"), "unexpected error: {error}");
    }

    #[test]
    fn test_merge_is_atomic_when_a_later_insert_fails() {
        let (g, _dir) = test_graph();
        g.conn
            .execute_batch(
                "CREATE TRIGGER reject_atomic_bad
                 BEFORE INSERT ON nodes
                 WHEN NEW.id = 'atomic-bad'
                 BEGIN
                    SELECT RAISE(ABORT, 'forced insert failure');
                 END;",
            )
            .unwrap();
        let incoming = import_snapshot(
            vec![
                import_node("atomic-good", "Good", "first insert", "note"),
                import_node("atomic-bad", "Bad", "second insert", "note"),
            ],
            vec![],
        );

        assert!(g.merge_graph(&incoming, &MergeStrategy::Latest).is_err());
        assert_eq!(g.stats().unwrap(), (0, 0));
    }

    #[test]
    fn test_load_is_atomic_when_a_later_insert_fails() {
        let (g, dir) = test_graph();
        g.conn
            .execute_batch(
                "CREATE TRIGGER reject_load_bad
                 BEFORE INSERT ON nodes
                 WHEN NEW.id = 'load-bad'
                 BEGIN
                    SELECT RAISE(ABORT, 'forced load failure');
                 END;",
            )
            .unwrap();
        let snapshot = import_snapshot(
            vec![
                import_node("load-good", "Good", "first insert", "note"),
                import_node("load-bad", "Bad", "second insert", "note"),
            ],
            vec![],
        );
        let export_path = dir.path().join("atomic-load.json");
        std::fs::write(
            &export_path,
            serde_json::to_vec(&serde_json::json!({
                "format": "prismos-spectrum-graph-v1",
                "snapshot": snapshot,
            }))
            .unwrap(),
        )
        .unwrap();

        assert!(g.load(&export_path).is_err());
        assert_eq!(g.stats().unwrap(), (0, 0));
    }

    #[test]
    fn test_export_sync_package() {
        let (g, _dir) = test_graph();
        g.add_node("Sync Test", "content", "note").unwrap();
        let json = g.export_sync_package().unwrap();
        assert!(json.contains("prismos-sync-v1"));
        assert!(json.contains("Sync Test"));
    }

    // ─── Cosine Similarity ─────────────────────────────────────────────────

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 0.0, 0.0];
        let sim = cosine_similarity(&a, &a);
        assert!((sim - 1.0).abs() < 1e-9);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(
            sim.abs() < 1e-9,
            "orthogonal vectors should have similarity ~0"
        );
    }

    #[test]
    fn test_cosine_similarity_empty() {
        let sim = cosine_similarity(&[], &[]);
        assert!((sim - 0.0).abs() < 1e-9);
    }

    // ─── Recent Intents ────────────────────────────────────────────────────

    #[test]
    fn test_get_recent_intents() {
        let (g, _dir) = test_graph();
        g.query_intent("test query", "Query", &[]).unwrap(); // logs an intent
        let intents = g.get_recent_intents(7).unwrap();
        assert!(!intents.is_empty());
    }

    // ─── Thought Currents ──────────────────────────────────────────────────

    #[test]
    fn test_thought_currents_empty_graph() {
        let (g, _dir) = test_graph();
        let currents = g.get_thought_currents().unwrap();
        assert!(
            currents.is_empty(),
            "empty graph should have no thought currents"
        );
    }
}
