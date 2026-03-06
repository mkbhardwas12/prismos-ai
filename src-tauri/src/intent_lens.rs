// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
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

    /// Extract key entities from input — multi-word phrases + significant terms.
    /// Produces meaningful concept labels for the knowledge graph, not just
    /// individual stop-word-filtered tokens.
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
            "tell", "give", "show", "help", "make", "let", "get", "know", "think",
            "want", "see", "look", "some", "any", "all", "each", "every", "more",
            "much", "many", "very", "really", "here", "there", "when", "where",
        ];

        let mut entities: Vec<String> = Vec::new();

        // ── Phase 1: Extract multi-word noun phrases ──
        // Look for 2-3 word phrases where consecutive significant words appear
        let words: Vec<&str> = input.split_whitespace().collect();
        let mut i = 0;
        while i < words.len() {
            let clean_word = words[i].trim_matches(|c: char| !c.is_alphanumeric());
            let lower = clean_word.to_lowercase();

            if lower.len() < 3 || stop_words.contains(&lower.as_str()) {
                i += 1;
                continue;
            }

            // Try to build a multi-word phrase (2-3 consecutive significant words)
            let mut phrase_parts = vec![clean_word.to_string()];
            let mut j = i + 1;

            // Allow one connector word ("of", "and", "for") inside a phrase
            while j < words.len() && phrase_parts.len() < 4 {
                let next_clean = words[j].trim_matches(|c: char| !c.is_alphanumeric());
                let next_lower = next_clean.to_lowercase();

                if next_lower.len() < 2 {
                    break;
                }

                // Allow connector words mid-phrase
                let is_connector = ["of", "and", "for", "in", "the", "to", "with"].contains(&next_lower.as_str());
                let is_significant = next_lower.len() >= 3 && !stop_words.contains(&next_lower.as_str());

                if is_significant {
                    phrase_parts.push(next_clean.to_string());
                    j += 1;
                } else if is_connector && j + 1 < words.len() {
                    // Peek ahead: only include connector if followed by significant word
                    let after = words[j + 1].trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
                    if after.len() >= 3 && !stop_words.contains(&after.as_str()) {
                        phrase_parts.push(next_clean.to_string());
                        j += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            if phrase_parts.len() >= 2 {
                // Store as multi-word phrase (lowercase for dedup)
                let phrase = phrase_parts.join(" ").to_lowercase();
                if !entities.contains(&phrase) {
                    entities.push(phrase);
                }
                i = j; // Skip past the phrase
            } else {
                // Single significant word
                if !entities.contains(&lower) {
                    entities.push(lower);
                }
                i += 1;
            }
        }

        entities
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
