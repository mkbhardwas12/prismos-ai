// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Document Chunker + RAG Engine — Retrieval-Augmented Generation for large documents
//
// Instead of stuffing entire documents into the prompt (which hits context limits),
// this module:
//   1. Chunks documents into overlapping segments (~2000 chars each)
//   2. Indexes chunks as Spectrum Graph nodes (with source metadata)
//   3. On query, retrieves the top-K most relevant chunks via keyword matching
//   4. Injects only relevant chunks into the prompt for focused, accurate answers

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// Target chunk size in characters (roughly ~500 tokens)
const CHUNK_SIZE: usize = 2000;

/// Overlap between adjacent chunks to preserve context at boundaries
const CHUNK_OVERLAP: usize = 200;

/// Maximum number of chunks to retrieve for RAG context
const TOP_K_CHUNKS: usize = 5;

/// Minimum document length (chars) to trigger chunking (below this, use full doc)
const MIN_CHUNK_THRESHOLD: usize = 3000;

/// Node type used for document chunks in the Spectrum Graph
const CHUNK_NODE_TYPE: &str = "doc_chunk";

// ─── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentChunk {
    /// Unique identifier for this chunk
    pub chunk_id: String,
    /// Zero-based index of this chunk within the document
    pub chunk_index: usize,
    /// Total number of chunks for this document
    pub total_chunks: usize,
    /// The source document name/path
    pub source: String,
    /// The chunk text content
    pub content: String,
    /// Character offset start in the original document
    pub char_start: usize,
    /// Character offset end in the original document
    pub char_end: usize,
    /// Spectrum Graph node ID (set after indexing)
    pub node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkedDocument {
    /// Source document identifier
    pub source: String,
    /// Total character count of the original document
    pub total_chars: usize,
    /// All chunks
    pub chunks: Vec<DocumentChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagContext {
    /// The retrieved chunks (most relevant first)
    pub chunks: Vec<DocumentChunk>,
    /// Relevance scores for each chunk (parallel to chunks vec)
    pub scores: Vec<f64>,
    /// Total chunks in the source document
    pub total_chunks: usize,
    /// Source document name
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagResult {
    /// The assembled RAG context string for prompt injection
    pub context: String,
    /// Number of chunks used
    pub chunks_used: usize,
    /// Total chunks available
    pub total_chunks: usize,
    /// Source document
    pub source: String,
    /// Whether RAG was used (false = document was small enough to use in full)
    pub rag_used: bool,
}

// ─── Chunking Engine ───────────────────────────────────────────────────────────

/// Split a document into overlapping chunks.
/// Uses paragraph-aware splitting: tries to break at paragraph boundaries
/// (\n\n) near the chunk size, falling back to sentence boundaries (. ),
/// then word boundaries, then raw character split.
pub fn chunk_document(text: &str, source: &str) -> ChunkedDocument {
    let total_chars = text.len();

    // If document is small enough, return it as a single chunk
    if total_chars <= MIN_CHUNK_THRESHOLD {
        return ChunkedDocument {
            source: source.to_string(),
            total_chars,
            chunks: vec![DocumentChunk {
                chunk_id: format!("{}_chunk_0", sanitize_source(source)),
                chunk_index: 0,
                total_chunks: 1,
                source: source.to_string(),
                content: text.to_string(),
                char_start: 0,
                char_end: total_chars,
                node_id: None,
            }],
        };
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let chars: Vec<char> = text.chars().collect();
    let text_len = chars.len();

    while start < text_len {
        let ideal_end = (start + CHUNK_SIZE).min(text_len);

        // If we're at the end, just take everything remaining
        if ideal_end >= text_len {
            let content: String = chars[start..].iter().collect();
            chunks.push((start, text_len, content));
            break;
        }

        // Try to find a good break point near the ideal end
        let break_point = find_break_point(&chars, start, ideal_end, text_len);
        let content: String = chars[start..break_point].iter().collect();
        chunks.push((start, break_point, content));

        // Advance with overlap
        start = if break_point > CHUNK_OVERLAP {
            break_point - CHUNK_OVERLAP
        } else {
            break_point
        };

        // Safety: prevent infinite loops
        if start >= break_point {
            start = break_point;
        }
    }

    let total_chunks = chunks.len();
    let doc_chunks: Vec<DocumentChunk> = chunks
        .into_iter()
        .enumerate()
        .map(|(i, (char_start, char_end, content))| DocumentChunk {
            chunk_id: format!("{}_chunk_{}", sanitize_source(source), i),
            chunk_index: i,
            total_chunks,
            source: source.to_string(),
            content,
            char_start,
            char_end,
            node_id: None,
        })
        .collect();

    ChunkedDocument {
        source: source.to_string(),
        total_chars,
        chunks: doc_chunks,
    }
}

/// Find the best break point near the target position.
/// Prefers paragraph breaks > sentence ends > word boundaries > raw split.
fn find_break_point(chars: &[char], start: usize, target: usize, text_len: usize) -> usize {
    let search_window = 300.min(target - start); // Look back up to 300 chars
    let search_start = if target > search_window {
        target - search_window
    } else {
        start
    };

    // 1. Try paragraph break (\n\n)
    let slice: String = chars[search_start..target].iter().collect();
    if let Some(pos) = slice.rfind("\n\n") {
        let break_at = search_start + pos + 2; // After the double newline
        if break_at > start {
            return break_at;
        }
    }

    // 2. Try sentence end (. or ! or ? followed by space or newline)
    for i in (search_start..target).rev() {
        if i + 1 < text_len
            && (chars[i] == '.' || chars[i] == '!' || chars[i] == '?')
            && (chars[i + 1] == ' ' || chars[i + 1] == '\n')
        {
            return i + 1; // After the punctuation
        }
    }

    // 3. Try word boundary (space)
    for i in (search_start..target).rev() {
        if chars[i] == ' ' {
            return i + 1;
        }
    }

    // 4. Fallback: hard split at target
    target.min(text_len)
}

/// Sanitize source name for use as chunk ID prefix
fn sanitize_source(source: &str) -> String {
    source
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>()
        .chars()
        .take(50)
        .collect()
}

// ─── RAG Retrieval ─────────────────────────────────────────────────────────────

/// Score a chunk's relevance to a query using keyword overlap (TF-IDF-lite).
/// This is a lightweight, zero-dependency approach that works well for
/// document-based RAG without requiring external embedding models.
fn score_chunk(query: &str, chunk: &DocumentChunk) -> f64 {
    let query_terms = extract_terms(query);
    let chunk_terms = extract_terms(&chunk.content);

    if query_terms.is_empty() || chunk_terms.is_empty() {
        return 0.0;
    }

    // Build term frequency map for the chunk
    let mut chunk_tf: HashMap<&str, usize> = HashMap::new();
    for term in &chunk_terms {
        *chunk_tf.entry(term).or_insert(0) += 1;
    }

    // Score = sum of (query_term_freq_in_chunk / chunk_length) for matching terms
    let mut score = 0.0;
    let mut matched_terms = 0;

    for qt in &query_terms {
        if let Some(&freq) = chunk_tf.get(qt.as_str()) {
            // TF component: frequency normalized by chunk length
            let tf = freq as f64 / chunk_terms.len() as f64;
            // Boost exact matches
            score += tf * 10.0;
            matched_terms += 1;
        } else {
            // Partial/substring matching for compound words
            for (ct, &freq) in &chunk_tf {
                if ct.contains(qt.as_str()) || qt.contains(*ct) {
                    let tf = freq as f64 / chunk_terms.len() as f64;
                    score += tf * 3.0; // Lower weight for partial matches
                    matched_terms += 1;
                    break;
                }
            }
        }
    }

    // Coverage bonus: reward chunks that match more query terms
    let coverage = matched_terms as f64 / query_terms.len() as f64;
    score *= 1.0 + coverage;

    // Position bonus: slightly prefer earlier chunks (for context/intro)
    let position_bonus = 1.0 / (1.0 + chunk.chunk_index as f64 * 0.05);
    score *= position_bonus;

    score
}

/// Extract searchable terms from text (lowercased, deduplicated, stop-words removed)
fn extract_terms(text: &str) -> Vec<String> {
    let stop_words: &[&str] = &[
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "shall",
        "should", "may", "might", "must", "can", "could", "and", "but", "or",
        "nor", "not", "so", "yet", "for", "in", "on", "at", "to", "of", "by",
        "with", "from", "up", "about", "into", "through", "during", "before",
        "after", "above", "below", "between", "out", "off", "over", "under",
        "again", "further", "then", "once", "here", "there", "when", "where",
        "why", "how", "all", "each", "every", "both", "few", "more", "most",
        "other", "some", "such", "no", "only", "own", "same", "than", "too",
        "very", "just", "because", "as", "until", "while", "if", "it", "its",
        "this", "that", "these", "those", "what", "which", "who", "whom",
    ];

    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !stop_words.contains(w))
        .map(|w| w.to_string())
        .collect()
}

/// Retrieve the top-K most relevant chunks for a query from a chunked document.
pub fn retrieve_chunks(query: &str, document: &ChunkedDocument, top_k: Option<usize>) -> RagContext {
    let k = top_k.unwrap_or(TOP_K_CHUNKS);

    let mut scored: Vec<(usize, f64)> = document
        .chunks
        .iter()
        .enumerate()
        .map(|(i, chunk)| (i, score_chunk(query, chunk)))
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Take top-K
    let top = scored.into_iter().take(k).collect::<Vec<_>>();

    let chunks: Vec<DocumentChunk> = top.iter().map(|(i, _)| document.chunks[*i].clone()).collect();
    let scores: Vec<f64> = top.iter().map(|(_, s)| *s).collect();

    RagContext {
        chunks,
        scores,
        total_chunks: document.chunks.len(),
        source: document.source.clone(),
    }
}

/// Build a RAG-enhanced prompt context from a document and query.
/// If the document is small enough, returns it in full.
/// Otherwise, chunks it and retrieves the most relevant pieces.
pub fn build_rag_context(document_text: &str, query: &str, source: &str) -> RagResult {
    // Small documents: use in full
    if document_text.len() <= MIN_CHUNK_THRESHOLD {
        return RagResult {
            context: document_text.to_string(),
            chunks_used: 1,
            total_chunks: 1,
            source: source.to_string(),
            rag_used: false,
        };
    }

    // Chunk the document
    let chunked = chunk_document(document_text, source);
    let total = chunked.chunks.len();

    // Retrieve relevant chunks
    let rag_ctx = retrieve_chunks(query, &chunked, None);

    // Assemble context from retrieved chunks
    let mut context_parts: Vec<String> = Vec::new();
    for (i, chunk) in rag_ctx.chunks.iter().enumerate() {
        context_parts.push(format!(
            "[Section {}/{} — chars {}-{}]\n{}",
            chunk.chunk_index + 1,
            chunk.total_chunks,
            chunk.char_start,
            chunk.char_end,
            chunk.content
        ));
        if i < rag_ctx.chunks.len() - 1 {
            context_parts.push("---".to_string());
        }
    }

    let context = context_parts.join("\n");

    RagResult {
        context,
        chunks_used: rag_ctx.chunks.len(),
        total_chunks: total,
        source: source.to_string(),
        rag_used: true,
    }
}

/// Index document chunks into the Spectrum Graph for persistent retrieval.
/// Returns the node IDs created.
pub fn index_chunks_to_graph(
    graph: &crate::spectrum_graph::SpectrumGraph,
    document: &ChunkedDocument,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let mut node_ids = Vec::new();

    for chunk in &document.chunks {
        let label = format!(
            "📄 {} [chunk {}/{}]",
            chunk.source,
            chunk.chunk_index + 1,
            chunk.total_chunks
        );
        let content = format!(
            "Source: {}\nChunk: {}/{}\nChars: {}-{}\n\n{}",
            chunk.source,
            chunk.chunk_index + 1,
            chunk.total_chunks,
            chunk.char_start,
            chunk.char_end,
            chunk.content
        );

        let node = graph.add_node_with_layer(&label, &content, CHUNK_NODE_TYPE, "knowledge")?;
        node_ids.push(node.id);
    }

    // Create edges between consecutive chunks for traversal
    for i in 0..node_ids.len().saturating_sub(1) {
        let _ = graph.add_edge(
            &node_ids[i],
            &node_ids[i + 1],
            "next_chunk",
            0.9,
        );
    }

    Ok(node_ids)
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_small_document() {
        let text = "Hello, world! This is a small document.";
        let result = chunk_document(text, "test.txt");
        assert_eq!(result.chunks.len(), 1);
        assert_eq!(result.chunks[0].content, text);
        assert_eq!(result.chunks[0].chunk_index, 0);
        assert_eq!(result.chunks[0].total_chunks, 1);
    }

    #[test]
    fn test_chunk_large_document() {
        // Create a document larger than MIN_CHUNK_THRESHOLD
        let paragraph = "This is a test paragraph with enough words to be meaningful. ";
        let text = paragraph.repeat(100); // ~6100 chars
        let result = chunk_document(&text, "large_doc.txt");
        assert!(result.chunks.len() > 1);
        // Verify all content is covered
        assert_eq!(result.chunks[0].char_start, 0);
        assert_eq!(
            result.chunks.last().unwrap().char_end,
            text.chars().count()
        );
    }

    #[test]
    fn test_chunk_overlap() {
        let paragraph = "Sentence one about testing. ";
        let text = paragraph.repeat(200); // ~5400 chars
        let result = chunk_document(&text, "overlap_test.txt");
        // Chunks should overlap
        if result.chunks.len() >= 2 {
            let c1_end = result.chunks[0].char_end;
            let c2_start = result.chunks[1].char_start;
            assert!(c2_start < c1_end, "Chunks should overlap");
        }
    }

    #[test]
    fn test_extract_terms() {
        let terms = extract_terms("The quick brown fox jumps over the lazy dog");
        assert!(terms.contains(&"quick".to_string()));
        assert!(terms.contains(&"brown".to_string()));
        assert!(terms.contains(&"fox".to_string()));
        // "the" should be filtered as a stop word
        assert!(!terms.contains(&"the".to_string()));
    }

    #[test]
    fn test_score_chunk_relevant() {
        let chunk = DocumentChunk {
            chunk_id: "test_0".to_string(),
            chunk_index: 0,
            total_chunks: 1,
            source: "test.txt".to_string(),
            content: "Rust programming language is great for systems programming and memory safety".to_string(),
            char_start: 0,
            char_end: 76,
            node_id: None,
        };
        let score = score_chunk("What is Rust programming?", &chunk);
        assert!(score > 0.0, "Relevant chunk should have positive score");
    }

    #[test]
    fn test_score_chunk_irrelevant() {
        let chunk = DocumentChunk {
            chunk_id: "test_0".to_string(),
            chunk_index: 0,
            total_chunks: 1,
            source: "test.txt".to_string(),
            content: "The weather today is sunny and warm with clear skies".to_string(),
            char_start: 0,
            char_end: 52,
            node_id: None,
        };
        let score_relevant = score_chunk("What is Rust programming?", &chunk);
        let score_irrelevant = score_chunk("weather forecast", &chunk);
        // Weather query should score higher on weather content
        assert!(score_irrelevant > score_relevant);
    }

    #[test]
    fn test_retrieve_chunks_returns_top_k() {
        let paragraph = "Machine learning artificial intelligence neural networks deep learning. ";
        let filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ";
        let mut text = filler.repeat(60); // ~3360 chars of filler
        text.push_str(&paragraph.repeat(20)); // Add ML content at the end
        text.push_str(&filler.repeat(20)); // More filler

        let doc = chunk_document(&text, "test_rag.txt");
        let ctx = retrieve_chunks("machine learning neural networks", &doc, Some(3));
        assert!(ctx.chunks.len() <= 3);
        assert!(!ctx.scores.is_empty());
    }

    #[test]
    fn test_build_rag_context_small_doc() {
        let text = "Small document content.";
        let result = build_rag_context(text, "query", "test.txt");
        assert!(!result.rag_used);
        assert_eq!(result.context, text);
    }

    #[test]
    fn test_build_rag_context_large_doc() {
        let paragraph = "This discusses machine learning and artificial intelligence systems. ";
        let text = paragraph.repeat(100);
        let result = build_rag_context(&text, "machine learning", "big_doc.pdf");
        assert!(result.rag_used);
        assert!(result.chunks_used > 0);
        assert!(result.context.contains("[Section"));
    }

    #[test]
    fn test_sanitize_source() {
        assert_eq!(sanitize_source("my-file.pdf"), "my-file_pdf");
        assert_eq!(sanitize_source("path/to/doc.docx"), "path_to_doc_docx");
    }
}
