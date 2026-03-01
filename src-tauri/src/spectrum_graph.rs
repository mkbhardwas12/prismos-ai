// Patent Pending — US 63/993,589 (Feb 28, 2026)
// Spectrum Graph — Persistent Knowledge Graph with Vector + Relational Layers
//
// The Spectrum Graph is PrismOS's persistent memory system, combining:
// - SQLite relational layer for structured data and metadata
// - Graph edges for relationship mapping between knowledge nodes
// - (Planned) LanceDB vector layer for semantic similarity search

use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

// ─── Data Models ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumNode {
    pub id: String,
    pub label: String,
    pub content: String,
    pub node_type: String,
    pub created_at: String,
    pub updated_at: String,
    pub connections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpectrumEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    pub weight: f64,
    pub created_at: String,
}

// ─── Spectrum Graph Engine ─────────────────────────────────────────────────────

pub struct SpectrumGraph {
    conn: Connection,
}

impl SpectrumGraph {
    /// Initialize the Spectrum Graph with SQLite backend
    pub fn new(app_dir: &Path) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let db_path = app_dir.join("spectrum_graph.db");
        let conn = Connection::open(db_path)?;

        // Enable WAL mode for better concurrent read performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS nodes (
                id          TEXT PRIMARY KEY,
                label       TEXT NOT NULL,
                content     TEXT NOT NULL,
                node_type   TEXT NOT NULL DEFAULT 'note',
                embedding   BLOB,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS edges (
                id          TEXT PRIMARY KEY,
                source_id   TEXT NOT NULL,
                target_id   TEXT NOT NULL,
                relation    TEXT NOT NULL DEFAULT 'related',
                weight      REAL NOT NULL DEFAULT 1.0,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
                FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_nodes_type   ON nodes(node_type);
            CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);
            ",
        )?;

        Ok(Self { conn })
    }

    // ─── Node Operations ───────────────────────────────────────────────────

    /// Add a new knowledge node to the graph
    pub fn add_node(
        &self,
        label: &str,
        content: &str,
        node_type: &str,
    ) -> Result<SpectrumNode, Box<dyn std::error::Error + Send + Sync>> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO nodes (id, label, content, node_type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, label, content, node_type, now, now],
        )?;

        Ok(SpectrumNode {
            id,
            label: label.to_string(),
            content: content.to_string(),
            node_type: node_type.to_string(),
            created_at: now.clone(),
            updated_at: now,
            connections: vec![],
        })
    }

    /// Retrieve all nodes ordered by most recently updated
    pub fn get_all_nodes(
        &self,
    ) -> Result<Vec<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type, created_at, updated_at
             FROM nodes ORDER BY updated_at DESC LIMIT 200",
        )?;

        let nodes = stmt
            .query_map([], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(nodes)
    }

    /// Get a single node by ID
    pub fn get_node(
        &self,
        id: &str,
    ) -> Result<Option<SpectrumNode>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, label, content, node_type, created_at, updated_at
             FROM nodes WHERE id = ?1",
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            Ok(SpectrumNode {
                id: row.get(0)?,
                label: row.get(1)?,
                content: row.get(2)?,
                node_type: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                connections: vec![],
            })
        })?;

        match rows.next() {
            Some(node) => Ok(Some(node?)),
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
            "SELECT id, label, content, node_type, created_at, updated_at
             FROM nodes WHERE label LIKE ?1 OR content LIKE ?1
             ORDER BY updated_at DESC LIMIT 50",
        )?;

        let nodes = stmt
            .query_map(params![pattern], |row| {
                Ok(SpectrumNode {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    content: row.get(2)?,
                    node_type: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    connections: vec![],
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(nodes)
    }

    /// Delete a node and all its edges
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

    // ─── Edge Operations ───────────────────────────────────────────────────

    /// Add a relationship edge between two nodes
    pub fn add_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relation: &str,
        weight: f64,
    ) -> Result<SpectrumEdge, Box<dyn std::error::Error + Send + Sync>> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT INTO edges (id, source_id, target_id, relation, weight, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, source_id, target_id, relation, weight, now],
        )?;

        Ok(SpectrumEdge {
            id,
            source_id: source_id.to_string(),
            target_id: target_id.to_string(),
            relation: relation.to_string(),
            weight,
            created_at: now,
        })
    }

    /// Get all edges connected to a node
    pub fn get_connections(
        &self,
        node_id: &str,
    ) -> Result<Vec<SpectrumEdge>, Box<dyn std::error::Error + Send + Sync>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, source_id, target_id, relation, weight, created_at
             FROM edges WHERE source_id = ?1 OR target_id = ?1",
        )?;

        let edges = stmt
            .query_map(params![node_id], |row| {
                Ok(SpectrumEdge {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    target_id: row.get(2)?,
                    relation: row.get(3)?,
                    weight: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(edges)
    }

    /// Get graph statistics
    pub fn stats(&self) -> Result<(usize, usize), Box<dyn std::error::Error + Send + Sync>> {
        let node_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))?;
        let edge_count: usize =
            self.conn
                .query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))?;
        Ok((node_count, edge_count))
    }
}
