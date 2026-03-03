// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// Intent Lens — Natural Language Decomposition Engine
//
// Intent Lenses parse raw natural language input into structured intents
// with type classification, entity extraction, and confidence scoring.
// MVP uses rule-based heuristics; production will use LLM-powered NLU.

use crate::refractive_core::{IntentType, ParsedIntent};

// ─── Intent Lens Engine ────────────────────────────────────────────────────────

pub struct IntentLens;

impl IntentLens {
    pub fn new() -> Self {
        Self
    }

    /// Parse raw user input into a structured ParsedIntent
    pub fn parse(&self, input: &str) -> ParsedIntent {
        let lower = input.to_lowercase();

        // Classify intent type based on keyword patterns
        let intent_type = self.classify_intent(&lower);

        // Extract key entities
        let entities = self.extract_entities(input);

        // Calculate confidence (rule-based → lower confidence; LLM-based → higher)
        let confidence = self.calculate_confidence(&lower, &entities);

        ParsedIntent {
            raw: input.to_string(),
            intent_type,
            entities,
            confidence,
        }
    }

    /// Classify intent type using keyword-based heuristics
    fn classify_intent(&self, lower: &str) -> IntentType {
        // Query patterns
        let query_kw = [
            "search", "find", "what", "how", "why", "when", "where", "who",
            "tell me", "explain", "describe", "show", "look up", "?",
        ];
        // Create patterns
        let create_kw = [
            "create", "make", "new", "add", "write", "build", "generate",
            "compose", "draft", "start",
        ];
        // Analyze patterns
        let analyze_kw = [
            "analyze", "compare", "review", "evaluate", "assess", "examine",
            "summarize", "break down", "investigate",
        ];
        // Connect patterns
        let connect_kw = [
            "connect", "link", "relate", "merge", "combine", "associate",
            "map", "join", "correlate",
        ];
        // System patterns
        let system_kw = [
            "settings", "config", "system", "status", "version", "help",
            "reset", "clear", "update",
        ];

        if system_kw.iter().any(|k| lower.contains(k)) {
            IntentType::System
        } else if create_kw.iter().any(|k| lower.contains(k)) {
            IntentType::Create
        } else if analyze_kw.iter().any(|k| lower.contains(k)) {
            IntentType::Analyze
        } else if connect_kw.iter().any(|k| lower.contains(k)) {
            IntentType::Connect
        } else if query_kw.iter().any(|k| lower.contains(k)) {
            IntentType::Query
        } else {
            IntentType::Query // Default to query
        }
    }

    /// Extract key entities from input (stop-word filtering)
    fn extract_entities(&self, input: &str) -> Vec<String> {
        let stop_words: &[&str] = &[
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would", "could",
            "should", "may", "might", "shall", "can", "need", "dare", "ought",
            "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "as", "into", "about", "like", "through", "after", "over", "between",
            "out", "against", "during", "without", "before", "under", "around",
            "among", "i", "me", "my", "we", "our", "you", "your", "it", "its",
            "this", "that", "these", "those", "what", "how", "please", "and",
            "or", "but", "not", "so", "if", "then", "than", "up", "just", "also",
        ];

        input
            .split_whitespace()
            .filter(|w| w.len() > 2)
            .filter(|w| !stop_words.contains(&w.to_lowercase().as_str()))
            .map(|w| w.to_string())
            .collect()
    }

    /// Calculate confidence score based on pattern match strength
    fn calculate_confidence(&self, lower: &str, entities: &[String]) -> f64 {
        let mut score: f64 = 0.5; // Base confidence

        // Boost if clear intent markers are present
        if lower.contains('?') {
            score += 0.15;
        }
        if lower.starts_with("please") || lower.starts_with("can you") {
            score += 0.1;
        }
        if !entities.is_empty() {
            score += 0.1;
        }
        if entities.len() > 2 {
            score += 0.1;
        }

        score.min(0.95) // Cap at 95% for rule-based system
    }
}
