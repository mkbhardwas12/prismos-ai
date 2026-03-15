// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
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

use chrono::{DateTime, Utc, Timelike};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    pub momentum: f64,       // rate of weight change (closed-loop feedback velocity)
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

// ─── Spectrum Graph Engine ─────────────────────────────────────────────────────

pub struct SpectrumGraph {
    conn: Connection,
}

impl SpectrumGraph {
    /// Initialize the Spectrum Graph with full multi-layered SQLite backend
    pub fn new(app_dir: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let db_path = app_dir.join("spectrum_graph.db");
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

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

            -- Layer 11: Domain Profile — learned user domain expertise
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
            ",
        )?;

        Ok(Self { conn })
    }

    /// Seed demo data for new users — only runs if graph is completely empty
    pub fn seed_demo_data(&self) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let (nodes, _edges) = self.stats()?;
        if nodes > 0 {
            return Ok(false); // Already has data — skip
        }

        let now = chrono::Utc::now().to_rfc3339();

        // ── Demo nodes showing PrismOS-AI as a daily productivity tool ──
        let demo_nodes = vec![
            ("demo-work-1", "Weekly Goals", "Track and review weekly professional goals, deadlines, and deliverables", "work", "core"),
            ("demo-work-2", "Meeting Notes", "Capture and organize notes from team meetings, 1:1s, and standups", "work", "context"),
            ("demo-learning-1", "Learning Rust", "Study notes on Rust ownership, lifetimes, and async patterns", "learning", "core"),
            ("demo-learning-2", "AI Research", "Papers and insights on local LLM inference, RAG systems, and agent architectures", "learning", "context"),
            ("demo-health-1", "Fitness Tracker", "Daily exercise log: running, strength training, stretching routines", "health", "core"),
            ("demo-health-2", "Sleep Habits", "Track sleep patterns, quality, and habits for better rest", "health", "context"),
            ("demo-finance-1", "Budget Overview", "Monthly income, expenses, savings goals, and investment tracking", "finance", "core"),
            ("demo-task-1", "Home Projects", "Organize home improvement tasks, shopping lists, and maintenance schedules", "task", "context"),
            ("demo-social-1", "Family Events", "Birthdays, anniversaries, family gatherings, and gift ideas", "social", "context"),
            ("demo-memory-1", "Travel Plans", "Trip ideas, itineraries, packing lists, and travel memories", "memory", "context"),
        ];

        for (id, label, content, ntype, layer) in &demo_nodes {
            self.conn.execute(
                "INSERT OR IGNORE INTO nodes (id, label, content, node_type, layer, access_count, last_accessed, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?6)",
                params![id, label, content, ntype, layer, now],
            )?;
        }

        // ── Demo edges showing relationships between life facets ──
        let demo_edges = vec![
            ("demo-edge-1", "demo-work-1", "demo-work-2", "feeds_into", 0.8),
            ("demo-edge-2", "demo-learning-1", "demo-work-1", "supports", 0.7),
            ("demo-edge-3", "demo-learning-2", "demo-learning-1", "related_to", 0.6),
            ("demo-edge-4", "demo-health-1", "demo-health-2", "affects", 0.75),
            ("demo-edge-5", "demo-work-1", "demo-finance-1", "impacts", 0.5),
            ("demo-edge-6", "demo-task-1", "demo-social-1", "related_to", 0.4),
            ("demo-edge-7", "demo-health-1", "demo-work-1", "enables", 0.6),
            ("demo-edge-8", "demo-memory-1", "demo-social-1", "connects_to", 0.5),
        ];

        for (id, src, tgt, rel, weight) in &demo_edges {
            self.conn.execute(
                "INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, weight, momentum, reinforcements, last_reinforced, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0.05, 0, ?6, ?6)",
                params![id, src, tgt, rel, weight, now],
            )?;
        }

        // ── Add demo intents to the intent log so the daily brief has data ──
        let demo_intents = vec![
            ("What are my top priorities this week?", "query"),
            ("Help me plan a healthy meal prep for the week", "task"),
            ("Summarize the latest Rust async patterns", "learning"),
            ("Track my morning run: 5K in 28 minutes", "health"),
            ("Review my monthly budget and spending", "finance"),
        ];

        for (raw, itype) in &demo_intents {
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
        let now = Utc::now().to_rfc3339();

        // ── Dedup check: same label + node_type → update instead of insert ──
        let existing: Option<String> = self.conn.prepare(
            "SELECT id FROM nodes WHERE label = ?1 AND node_type = ?2 LIMIT 1",
        )?
        .query_row(params![label, node_type], |row| row.get::<_, String>(0))
        .ok();

        if let Some(existing_id) = existing {
            // Merge: append new content if different, bump access + timestamp
            self.conn.execute(
                "UPDATE nodes SET access_count = access_count + 1,
                                  last_accessed = ?1, updated_at = ?1,
                                  content = CASE WHEN content = ?2 THEN content
                                                 ELSE content || '\n---\n' || ?2 END
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
            let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

            let edges: Vec<(String, String)> = edge_stmt
                .query_map(param_refs.as_slice(), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .filter_map(|r| r.ok())
                .collect();

            // Build a lookup: node_id → list of connected node_ids
            let mut conn_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
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
    pub fn delete_node(
        &self,
        id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE nodes SET label = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
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
        let now = Utc::now().to_rfc3339();

        // Fetch current edge state
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight,
                    COALESCE(momentum, 0.0), COALESCE(reinforcements, 0),
                    COALESCE(last_reinforced, created_at), created_at
             FROM edges WHERE id = ?1",
        )?;

        let edge: SpectrumEdge = stmt
            .query_row(params![edge_id], |row| {
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

    /// Query the Spectrum Graph for nodes relevant to a parsed intent.
    /// Combines text matching, edge weight traversal, temporal boosting,
    /// and access frequency into a unified relevance score.
    pub fn query_intent(
        &self,
        raw_input: &str,
        intent_type: &str,
        entities: &[String],
    ) -> Result<Vec<IntentQueryResult>, Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().to_rfc3339();

        // Log this intent for pattern mining
        let log_id = Uuid::new_v4().to_string();
        self.conn.execute(
            "INSERT INTO intent_log (id, raw_input, intent_type, matched_nodes, confidence, created_at)
             VALUES (?1, ?2, ?3, '[]', 0.0, ?4)",
            params![log_id, raw_input, intent_type, now],
        )?;

        // Build search terms from entities and raw input words
        let mut search_terms: Vec<String> = entities.to_vec();
        // Filter: only words ≥ 4 chars and not in stop list (avoids noisy matches)
        let stop_words: &[&str] = &[
            "what", "when", "where", "which", "whom", "whose", "that", "this",
            "these", "those", "there", "their", "about", "after", "again",
            "been", "before", "being", "between", "both", "could", "does",
            "doing", "down", "each", "from", "have", "here", "just", "know",
            "like", "make", "many", "more", "most", "much", "must", "need",
            "only", "other", "over", "same", "should", "some", "such", "take",
            "tell", "than", "them", "then", "they", "very", "want", "well",
            "were", "will", "with", "would", "your", "also", "been", "came",
            "come", "even", "ever", "every", "give", "goes", "going", "gone",
            "good", "great", "help", "into", "keep", "last", "long", "look",
            "made", "might", "move", "next", "once", "open", "part", "play",
            "please", "point", "right", "show", "still", "think", "thought",
            "time", "turn", "under", "upon", "used", "using", "went", "work",
        ];
        for word in raw_input.split_whitespace() {
            let lower = word.to_lowercase();
            // Require minimum 4 chars AND not a stop word
            if lower.len() >= 4
                && !stop_words.contains(&lower.as_str())
                && !search_terms.contains(&lower)
            {
                search_terms.push(lower);
            }
        }

        // Phase 1: Direct text match scoring
        let mut results: Vec<IntentQueryResult> = Vec::new();
        let mut seen_ids: Vec<String> = Vec::new();

        for term in &search_terms {
            let pattern = format!("%{}%", term);
            let mut stmt = self.conn.prepare(
                "SELECT id, label, content, node_type,
                        COALESCE(layer, 'context'), COALESCE(access_count, 0),
                        COALESCE(last_accessed, updated_at), created_at, updated_at
                 FROM nodes WHERE label LIKE ?1 OR content LIKE ?1
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
                seen_ids.push(node.id.clone());

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

        // Phase 2: Graph traversal — boost nodes connected to matched nodes via strong edges
        let matched_ids: Vec<String> = results.iter().map(|r| r.node.id.clone()).collect();
        for mid in &matched_ids {
            let edges = self.get_connections(mid)?;
            for edge in &edges {
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
                } else if effective_weight > 0.3 {
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

    /// Merge duplicate nodes (same label + node_type) into one.
    /// Keeps the oldest node, merges content, sums access_count,
    /// re-points edges, and deletes the extras. Returns count merged.
    pub fn deduplicate_nodes(
        &self,
    ) -> Result<u32, Box<dyn std::error::Error + Send + Sync>> {
        // Find groups of duplicates
        let mut stmt = self.conn.prepare(
            "SELECT label, node_type, COUNT(*) AS cnt
             FROM nodes
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
                self.conn.execute(
                    "DELETE FROM edges WHERE source_id = target_id",
                    [],
                )?;

                // Delete duplicate edges that couldn't be re-pointed (OR IGNORE skipped them)
                self.conn.execute(
                    "DELETE FROM edges WHERE source_id = ?1 OR target_id = ?1",
                    params![dup_id],
                )?;

                // Delete the duplicate node
                self.conn.execute("DELETE FROM nodes WHERE id = ?1", params![dup_id])?;
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
            let src_norm = src_label.to_lowercase().chars().take(40).collect::<String>();
            let tgt_norm = tgt_label.to_lowercase().chars().take(40).collect::<String>();
            if src_norm == tgt_norm {
                continue;
            }
            // Skip if we already have a suggestion about this pair
            let already_seen = needs.iter().any(|n| {
                n.related_nodes.contains(src_id) && n.related_nodes.contains(tgt_id)
            });
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
                    format!("Summarize my recent progress on \"{}\" and how it relates to \"{}\"", src, tgt),
                    "📈".to_string(),
                ),
                "health" => (
                    format!("\"{}\" and \"{}\" are linked in your health data", src, tgt),
                    format!("Suggest a wellness routine connecting \"{}\" and \"{}\"", src, tgt),
                    "💪".to_string(),
                ),
                "finance" => (
                    format!("\"{}\" and \"{}\" are trending together", src, tgt),
                    format!("Give me a quick budget check for \"{}\" and \"{}\"", src, tgt),
                    "💰".to_string(),
                ),
                "learning" => (
                    format!("Your learning in \"{}\" connects to \"{}\"", src, tgt),
                    format!("Create a deeper study plan connecting \"{}\" and \"{}\"", src, tgt),
                    "📚".to_string(),
                ),
                _ => (
                    format!("\"{}\" and \"{}\" are becoming strongly linked", src, tgt),
                    format!("Explore how \"{}\" and \"{}\" are connected and what I should do next", src, tgt),
                    "🔗".to_string(),
                ),
            };
            let confidence = (*w / MAX_EDGE_WEIGHT).min(1.0).max(0.3) * 0.7
                + (*m).min(1.0) * 0.3;
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
                        "Organize my current priorities and suggest what to focus on next".to_string(),
                        "📋".to_string(),
                    ),
                    "question" | "learning" => (
                        format!("Research streak — {} queries recently", count),
                        "Create a summary of everything I've been researching recently".to_string(),
                        "🔬".to_string(),
                    ),
                    "creative" => (
                        format!("Creative streak! {} creative intents", count),
                        "Capture and organize all my recent creative ideas into a coherent plan".to_string(),
                        "🎨".to_string(),
                    ),
                    _ => (
                        format!("Active with \"{}\" — {} times recently", intent_type, count),
                        format!("Help me organize my recent activity around \"{}\"", intent_type),
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
                    action_intent: format!("Find connections between \"{}\" and my other knowledge, then link them", label),
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

    /// Store a proactive suggestion as a node in the graph for later recall.
    pub fn store_proactive_suggestion(
        &self,
        suggestion: &ProactiveSuggestion,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let now = Utc::now().to_rfc3339();
        let content = format!(
            "Suggestion: {}\nAction: {}\nCategory: {}\nConfidence: {:.0}%",
            suggestion.text, suggestion.action_intent, suggestion.category,
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
            let mut stmt = self.conn.prepare(
                "SELECT id FROM nodes WHERE LOWER(label) LIKE ?1 LIMIT 10",
            )?;
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
                    let new_momentum =
                        MOMENTUM_ALPHA * signal + (1.0 - MOMENTUM_ALPHA) * momentum;
                    let new_weight =
                        (weight + REINFORCEMENT_DELTA * signal).clamp(MIN_EDGE_WEIGHT, MAX_EDGE_WEIGHT);
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
    pub fn get_full_graph(&self) -> Result<GraphSnapshot, Box<dyn std::error::Error + Send + Sync>> {
        let nodes = self.get_all_nodes()?;
        let edges = self.get_all_edges()?;
        let stats = self.get_metrics()?;

        Ok(GraphSnapshot {
            nodes,
            edges,
            stats,
        })
    }

    /// Compute extended graph metrics
    pub fn get_metrics(&self) -> Result<GraphMetrics, Box<dyn std::error::Error + Send + Sync>> {
        let node_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let edge_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;

        let avg_edge_weight: f64 = self
            .conn
            .query_row(
                "SELECT COALESCE(AVG(weight), 0.0) FROM edges",
                [],
                |row| row.get(0),
            )?;

        let strongest_edge_weight: f64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(weight), 0.0) FROM edges",
                [],
                |row| row.get(0),
            )?;

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
        let node_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let edge_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        Ok((node_count, edge_count))
    }

    /// Clear all nodes and edges from the Spectrum Graph (Patent Pending)
    /// Returns the count of deleted nodes and edges.
    pub fn clear_graph(&self) -> Result<(usize, usize), Box<dyn std::error::Error + Send + Sync>> {
        let (nodes, edges) = self.stats()?;
        self.conn.execute("DELETE FROM edges", [])?;
        self.conn.execute("DELETE FROM nodes", [])?;
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
            eprintln!("[SpectrumGraph] Promoted {} ephemeral nodes to context layer", promoted);
        }
        Ok(promoted as u32)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  PERSIST / LOAD — Explicit Graph Serialization (Patent Pending)
    // ═══════════════════════════════════════════════════════════════════════

    /// Persist the current graph state to a JSON export file.
    /// This is a point-in-time snapshot that can be restored via `load()`.
    /// The SQLite database is always the source of truth; this provides
    /// portable backup / migration support as required by the patent.
    pub fn persist(&self, export_path: &Path) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let snapshot = self.get_full_graph()?;

        // Add metadata envelope
        let export = serde_json::json!({
            "format": "prismos-spectrum-graph-v1",
            "patent": "Patent Pending",
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

        Ok(format!("Persisted {} nodes, {} edges to {:?}",
            snapshot.nodes.len(), snapshot.edges.len(), export_path))
    }

    /// Load a previously persisted graph snapshot, merging into the current database.
    /// Nodes and edges that already exist (by ID) are skipped; new ones are inserted.
    /// This supports the You-Port device handoff pattern from the patent.
    pub fn load(&self, import_path: &Path) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let json = std::fs::read_to_string(import_path)?;
        let export: serde_json::Value = serde_json::from_str(&json)?;

        let snapshot_val = export.get("snapshot")
            .ok_or("Invalid export: missing 'snapshot' field")?;
        let snapshot: GraphSnapshot = serde_json::from_value(snapshot_val.clone())?;

        let mut nodes_imported = 0u32;
        let mut edges_imported = 0u32;

        // Import nodes (skip existing)
        for node in &snapshot.nodes {
            let exists: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                params![node.id],
                |row| row.get(0),
            )?;
            if !exists {
                self.conn.execute(
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
            let exists: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM edges WHERE id = ?1",
                params![edge.id],
                |row| row.get(0),
            )?;
            if !exists {
                self.conn.execute(
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

        Ok(format!("Loaded {} new nodes, {} new edges from {:?}",
            nodes_imported, edges_imported, import_path))
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  VECTOR SIMILARITY — NPU-Ready Embedding Support (Patent Pending)
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
        // Serialize f64 vector as little-endian bytes
        let bytes: Vec<u8> = embedding.iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        self.conn.execute(
            "UPDATE nodes SET embedding = ?1, updated_at = ?2 WHERE id = ?3",
            params![bytes, Utc::now().to_rfc3339(), node_id],
        )?;
        Ok(())
    }

    /// Retrieve a node's vector embedding
    pub fn get_node_embedding(
        &self,
        node_id: &str,
    ) -> Result<Option<Vec<f64>>, Box<dyn std::error::Error + Send + Sync>> {
        let result: Option<Vec<u8>> = self.conn.query_row(
            "SELECT embedding FROM nodes WHERE id = ?1",
            params![node_id],
            |row| row.get(0),
        ).ok();

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
    /// This is the vector layer of the multi-layered Spectrum Graph per patent.
    pub fn vector_search(
        &self,
        query_embedding: &[f64],
        top_k: usize,
    ) -> Result<Vec<(String, f64)>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, embedding FROM nodes WHERE embedding IS NOT NULL",
        )?;

        let mut results: Vec<(String, f64)> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let bytes: Vec<u8> = row.get(1)?;
                Ok((id, bytes))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(id, bytes)| {
                if bytes.is_empty() { return None; }
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

    /// Get total feedback signal count for analytics
    pub fn get_feedback_count(&self) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM feedback", [], |row| row.get(0)
        )?;
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
        let now = Utc::now().to_rfc3339();
        let fb_id = Uuid::new_v4().to_string();
        let ctx_json = serde_json::to_string(context_node_ids).unwrap_or_default();

        // Store the feedback record
        self.conn.execute(
            "INSERT INTO response_feedback (id, conversation_id, question, response, rating, context_nodes, model, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![fb_id, conversation_id, question, response, rating, ctx_json, model, now],
        )?;

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
        let words: Vec<String> = query.split_whitespace()
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
            for row in rows {
                if let Ok(pair) = row {
                    // Avoid duplicates
                    if !results.iter().any(|(q, _)| q == &pair.0) {
                        results.push(pair);
                    }
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
    //  COGNITIVE IMPRINT — Adaptive Response Personality (Patent Pending)
    // ═══════════════════════════════════════════════════════════════════════

    /// Load the user's cognitive profile (creates default if none exists)
    pub fn get_cognitive_profile(
        &self,
    ) -> Result<crate::cognitive_profile::CognitiveProfile, Box<dyn std::error::Error + Send + Sync>> {
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

    /// Generate a daily brief/recap from Spectrum Graph activity
    /// Returns stats about today's activity: intents processed, nodes created/updated,
    /// edges strengthened, top facets, and highlights
    pub fn get_daily_brief(&self) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        // Intents processed today
        let intents_today: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM intent_log WHERE created_at > datetime('now', '-1 day')",
            [], |row| row.get(0)
        ).unwrap_or(0);

        // Nodes created today
        let nodes_created_today: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM nodes WHERE created_at > datetime('now', '-1 day')",
            [], |row| row.get(0)
        ).unwrap_or(0);

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
        let facets: Vec<(String, usize)> = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?.filter_map(|r| r.ok()).collect();

        // Recent intent types today
        let mut stmt2 = self.conn.prepare(
            "SELECT intent_type, COUNT(*) as cnt FROM intent_log
             WHERE created_at > datetime('now', '-1 day')
             GROUP BY intent_type ORDER BY cnt DESC LIMIT 5"
        )?;
        let intent_types: Vec<(String, usize)> = stmt2.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?.filter_map(|r| r.ok()).collect();

        // Strongest edge reinforced today
        let strongest_today: Option<(String, f64, i32)> = self.conn.query_row(
            "SELECT e.relation, e.weight, e.reinforcements FROM edges e
             WHERE e.last_reinforced > datetime('now', '-1 day')
             ORDER BY e.weight DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        ).ok();

        // Most accessed node today
        let busiest_node: Option<(String, String, i32)> = self.conn.query_row(
            "SELECT label, node_type, access_count FROM nodes
             WHERE last_accessed > datetime('now', '-1 day')
             ORDER BY access_count DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        ).ok();

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
             ORDER BY last_accessed DESC LIMIT 4"
        )?;
        let pending_topics: Vec<serde_json::Value> = pending_stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "label": row.get::<_, String>(0)?,
                "node_type": row.get::<_, String>(1)?,
            }))
        })?.filter_map(|r| r.ok()).collect();

        // ── Tomorrow priorities: highest-weight recently-active nodes ──
        let mut priority_stmt = self.conn.prepare(
            "SELECT n.label, n.node_type, SUM(e.weight) as total_weight FROM nodes n
             LEFT JOIN edges e ON n.id = e.source_id OR n.id = e.target_id
             WHERE n.last_accessed > datetime('now', '-3 days')
             GROUP BY n.id ORDER BY total_weight DESC LIMIT 4"
        )?;
        let tomorrow_priorities: Vec<serde_json::Value> = priority_stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "label": row.get::<_, String>(0)?,
                "node_type": row.get::<_, String>(1)?,
                "weight": row.get::<_, f64>(2).unwrap_or(0.0),
            }))
        })?.filter_map(|r| r.ok()).collect();

        // ── New connections discovered today ──
        let new_connections_today: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM edges WHERE created_at > datetime('now', '-1 day')",
            [], |row| row.get(0)
        ).unwrap_or(0);

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
            if count > 0 { streak += 1; } else { break; }
        }

        // Determine time of day for greeting context
        let hour = chrono::Local::now().hour();
        let time_period = if hour < 12 { "morning" } else if hour < 17 { "afternoon" } else { "evening" };
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

        let facet_map: serde_json::Value = facets.iter()
            .map(|(k, v)| (k.clone(), serde_json::json!(v)))
            .collect::<serde_json::Map<String, serde_json::Value>>()
            .into();

        let intent_type_map: serde_json::Value = intent_types.iter()
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
    //  COGNITIVE DRIFT — Weekly Snapshot & Drift Detection (Patent Pending)
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
    //  THOUGHT CURRENTS — Temporal Pattern Mining (Patent Pending)
    // ═══════════════════════════════════════════════════════════════════════

    /// Analyze thought currents from intent history
    pub fn get_thought_currents(
        &self,
    ) -> Result<Vec<crate::thought_currents::ThoughtCurrent>, Box<dyn std::error::Error + Send + Sync>>
    {
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
    //  EDGE PROPHECY — Predictive Edge Suggestions (Patent Pending)
    // ═══════════════════════════════════════════════════════════════════════

    /// Predict potential edges between unconnected nodes
    pub fn predict_edges(
        &self,
        limit: usize,
    ) -> Result<Vec<crate::cognitive_profile::PredictedEdge>, Box<dyn std::error::Error + Send + Sync>>
    {
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
            let mut stmt = self.conn.prepare("SELECT source_id, target_id FROM edges")?;
            let results: Vec<(String, String)> = stmt.query_map([], |row| {
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
            let results: Vec<(String, String)> = stmt.query_map([], |row| {
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
                        evidence_type: if overlap > 0 { "keyword_overlap".to_string() } else { "same_domain".to_string() },
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
    //  REFRACTION JOURNAL — Band Choice Logging (Patent Pending)
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
    ) -> Result<crate::cognitive_profile::RefractionInsights, Box<dyn std::error::Error + Send + Sync>>
    {
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
            band_distribution: band_counts.iter().map(|(k, v)| (k.clone(), *v as f64)).collect(),
            band_by_query_type: std::collections::HashMap::new(),
            blind_spots: Vec::new(),
            growth_score: override_rate,
            insights: {
                let mut ins = Vec::new();
                if let Some((from, to)) = &most_common_shift {
                    ins.push(format!("Most common shift: {} → {}", from, to));
                }
                if override_rate > 0.3 {
                    ins.push(format!("High override rate ({:.0}%) — you often refine band choices", override_rate * 100.0));
                }
                ins
            },
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  AGENT MEMORY — Per-Agent Key-Value Store (Patent Pending)
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
    ) -> Result<Vec<crate::cognitive_profile::AgentMemoryEntry>, Box<dyn std::error::Error + Send + Sync>>
    {
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
    //  DOMAIN PROFILE — Persistence Layer (Patent Pending)
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
            rusqlite::params![domain_counts, total_queries, primary_domain, confidence, now],
        )?;
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  MODEL PERFORMANCE — Per-Model Tracking (Patent Pending)
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
            rusqlite::params![id, model_name, domain, latency_ms, satisfaction, query_type, now],
        )?;
        Ok(())
    }

    /// Get model recommendations based on historical performance
    pub fn get_model_recommendations(
        &self,
    ) -> Result<Vec<crate::model_tracker::ModelRecommendation>, Box<dyn std::error::Error + Send + Sync>>
    {
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
                        if sat > 0.5 { Some(true) } else if sat < -0.5 { Some(false) } else { None }
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
    let dot: f64 = a[..len].iter().zip(b[..len].iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a[..len].iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b[..len].iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a > 0.0 && mag_b > 0.0 {
        (dot / (mag_a * mag_b)).clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GRAPH MERGE/DIFF ENGINE — Multi-Device Sync (Patent Pending)
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
    Theirs,  // Incoming snapshot wins on conflict
    Ours,    // Local graph wins on conflict
    Latest,  // Most recently updated version wins
}

impl MergeStrategy {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "theirs" => MergeStrategy::Theirs,
            "ours" => MergeStrategy::Ours,
            "latest" | _ => MergeStrategy::Latest,
        }
    }
}

/// A single conflict detected during merge diff
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergeConflict {
    pub entity_type: String,        // "node" or "edge"
    pub entity_id: String,
    pub field: String,              // which field differs
    pub local_value: String,
    pub remote_value: String,
    pub resolution: String,         // "kept_local" | "took_remote" | "took_latest"
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
        let incoming_nodes: HashMap<String, &SpectrumNode> =
            incoming.nodes.iter().map(|n| (n.id.clone(), n)).collect();
        let incoming_edges: HashMap<String, &SpectrumEdge> =
            incoming.edges.iter().map(|e| (e.id.clone(), e)).collect();

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
                                    format!("{}…", local_node.content.chars().take(80).collect::<String>())
                                } else {
                                    local_node.content.clone()
                                },
                                remote_value: if remote_node.content.chars().count() > 80 {
                                    format!("{}…", remote_node.content.chars().take(80).collect::<String>())
                                } else {
                                    remote_node.content.clone()
                                },
                                resolution: resolution.clone(),
                                resolved_value: if resolved_content.chars().count() > 80 {
                                    format!("{}…", resolved_content.chars().take(80).collect::<String>())
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
                            local_value: format!("{:.3} (×{})", local_edge.weight, local_edge.reinforcements),
                            remote_value: format!("{:.3} (×{})", remote_edge.weight, remote_edge.reinforcements),
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

        // --- Merge nodes ---
        for remote_node in &incoming.nodes {
            let exists: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                params![remote_node.id],
                |row| row.get(0),
            )?;

            if !exists {
                // New node — insert directly
                self.conn.execute(
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
                let local_label: String = self.conn.query_row(
                    "SELECT label FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;
                let local_content: String = self.conn.query_row(
                    "SELECT content FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;
                let local_updated: String = self.conn.query_row(
                    "SELECT updated_at FROM nodes WHERE id = ?1",
                    params![remote_node.id],
                    |row| row.get(0),
                )?;

                if local_label == remote_node.label && local_content == remote_node.content {
                    // No conflict — merge access_count (take max)
                    let local_access: u32 = self.conn.query_row(
                        "SELECT COALESCE(access_count, 0) FROM nodes WHERE id = ?1",
                        params![remote_node.id],
                        |row| row.get(0),
                    )?;
                    if remote_node.access_count > local_access {
                        self.conn.execute(
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
                        self.conn.execute(
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
            let exists: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM edges WHERE id = ?1",
                params![remote_edge.id],
                |row| row.get(0),
            )?;

            if !exists {
                // Check that both endpoints exist before inserting
                let src_exists: bool = self.conn.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                    params![remote_edge.source_id],
                    |row| row.get(0),
                )?;
                let tgt_exists: bool = self.conn.query_row(
                    "SELECT COUNT(*) > 0 FROM nodes WHERE id = ?1",
                    params![remote_edge.target_id],
                    |row| row.get(0),
                )?;

                if src_exists && tgt_exists {
                    self.conn.execute(
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
                let local_weight: f64 = self.conn.query_row(
                    "SELECT weight FROM edges WHERE id = ?1",
                    params![remote_edge.id],
                    |row| row.get(0),
                )?;
                let local_reinforced: String = self.conn.query_row(
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
                        self.conn.execute(
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
        let snapshot = self.get_full_graph()?;
        let package = serde_json::json!({
            "format": "prismos-sync-v1",
            "patent": "Patent Pending",
            "device_id": Uuid::new_v4().to_string(),
            "exported_at": Utc::now().to_rfc3339(),
            "snapshot": snapshot,
        });
        serde_json::to_string_pretty(&package).map_err(|e| e.into())
    }
}
