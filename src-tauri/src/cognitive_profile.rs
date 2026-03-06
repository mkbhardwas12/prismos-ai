// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Cognitive Imprint — Adaptive Response Personality Engine
//
// Unlike every other AI assistant that learns WHAT you're interested in (topics),
// the Cognitive Imprint learns HOW you think — your preferred reasoning style,
// depth, creativity, and communication patterns. Every response is shaped by
// a persistent, evolving profile unique to each user.
//
// The "Prism Refraction" system splits each query into multiple reasoning
// perspectives (Direct, Analytical, Creative, Exploratory) — like light through
// a prism. The user's selections teach the system which cognitive band they
// prefer for different types of questions, creating a true personal AI.

use serde::{Deserialize, Serialize};

// ─── Cognitive Dimensions ──────────────────────────────────────────────────────
//
// Five measurable axes that define how a person prefers to receive information:
//
//   Depth:      0.0 "give me the bottom line" → 1.0 "walk me through everything"
//   Creativity: 0.0 "just the facts"          → 1.0 "analogies, metaphors, connections"
//   Formality:  0.0 "casual, friendly"        → 1.0 "professional, precise"
//   Technical:  0.0 "plain English"           → 1.0 "expert terminology"
//   Examples:   0.0 "abstract principles"     → 1.0 "concrete examples"

/// Persistent cognitive profile that adapts to each user's thinking style.
/// Stored in Spectrum Graph (SQLite), evolves with every interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveProfile {
    pub depth: f64,
    pub creativity: f64,
    pub formality: f64,
    pub technical_level: f64,
    pub example_preference: f64,
    pub interaction_count: u32,
    pub last_updated: String,
}

impl Default for CognitiveProfile {
    fn default() -> Self {
        Self {
            depth: 0.5,
            creativity: 0.3,
            formality: 0.5,
            technical_level: 0.5,
            example_preference: 0.5,
            interaction_count: 0,
            last_updated: String::new(),
        }
    }
}

// ─── Refraction Bands ──────────────────────────────────────────────────────────
//
// Each band represents a distinct reasoning approach — like spectral colors
// emerging from a prism. The same question answered four different ways.

/// A reasoning perspective for "Prism Refraction" — the spectral decomposition
/// of a single intent into multiple cognitive approaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RefractionBand {
    /// Bottom-line-first. Concise, actionable, no fluff.
    Direct,
    /// Step-by-step reasoning. Thorough, structured analysis.
    Analytical,
    /// Lateral thinking. Analogies, metaphors, unexpected connections.
    Creative,
    /// Question-driven. Explores alternatives, raises what-ifs, broadens scope.
    Exploratory,
}

impl RefractionBand {
    /// Human-readable label for the UI
    pub fn label(&self) -> &'static str {
        match self {
            Self::Direct => "Direct",
            Self::Analytical => "Analytical",
            Self::Creative => "Creative",
            Self::Exploratory => "Exploratory",
        }
    }

    /// Emoji for the UI
    pub fn emoji(&self) -> &'static str {
        match self {
            Self::Direct => "⚡",
            Self::Analytical => "🔬",
            Self::Creative => "🎨",
            Self::Exploratory => "🧭",
        }
    }

    /// System prompt directive that shapes the LLM's response style
    pub fn system_directive(&self) -> &'static str {
        match self {
            Self::Direct =>
                "Be concise and direct. Lead with the answer in 1-2 sentences. \
                 Add brief supporting detail only if essential. No preamble, no filler.",
            Self::Analytical =>
                "Provide thorough, structured analysis. Break down your reasoning \
                 step by step. Consider multiple angles. Use headers and numbered \
                 lists for clarity. Show your work.",
            Self::Creative =>
                "Think laterally. Use analogies, metaphors, and unexpected connections \
                 to illuminate the concept. Draw parallels from other domains. \
                 Make the explanation memorable and vivid.",
            Self::Exploratory =>
                "Explore the question from multiple angles. Raise follow-up questions \
                 the user might not have considered. Present alternative perspectives \
                 and what-if scenarios. Broaden the user's thinking.",
        }
    }
}

// ─── Query Type Classification ─────────────────────────────────────────────────
//
// Context-Aware Band Switching (Patent Pending)
//
// The key insight: the optimal reasoning style depends on BOTH who is asking
// AND what they're asking. A user who normally prefers Creative responses
// still wants Direct answers when debugging an error. This is the
// Query-Type × Cognitive-Profile Matrix — a context-sensitive override
// system that no existing AI assistant implements.
//
// The matrix respects strong user preferences (override_strength < preference
// strength → user wins) but overrides weak/default preferences when the query
// type has a clear natural fit.

/// Classification of a user query by its cognitive intent — not topic, but
/// what kind of thinking the question demands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QueryType {
    /// "Fix this error", "Why isn't X working", "How do I solve Y"
    /// Natural fit: Direct ⚡ — get to the fix fast
    Troubleshooting,

    /// "Explain quantum computing", "What is RAG", "How does X work"
    /// Natural fit: user's learned preference (no override)
    Explanation,

    /// "Brainstorm ideas for…", "What creative ways could I…"
    /// Natural fit: Creative 🎨 — lateral thinking wanted
    Brainstorming,

    /// "Step-by-step guide to…", "How to set up…", "Walk me through…"
    /// Natural fit: Analytical 🔬 — structured steps needed
    HowTo,

    /// "What do you think about…", "Should I use X or Y", "Compare…"
    /// Natural fit: Exploratory 🧭 — multiple perspectives
    Opinion,

    /// "Summarize…", "Give me the key points…", "TL;DR"
    /// Natural fit: Direct ⚡ — conciseness is the entire point
    Summary,

    /// Anything that doesn't match above — use profile preference
    General,
}

impl QueryType {
    /// Classify a raw query string into a QueryType using keyword/pattern
    /// analysis. This runs on the local CPU with zero LLM calls — fast,
    /// deterministic, private.
    pub fn classify(query: &str) -> Self {
        let q = query.to_lowercase();

        // ── Troubleshooting signals ──
        if q.contains("error") || q.contains("fix") || q.contains("broken")
            || q.contains("doesn't work") || q.contains("does not work")
            || q.contains("not working") || q.contains("bug") || q.contains("crash")
            || q.contains("fail") || q.contains("issue") || q.contains("debug")
            || q.contains("wrong") || q.contains("problem with")
        {
            return Self::Troubleshooting;
        }

        // ── Summary signals ──
        if q.starts_with("summarize") || q.starts_with("summary")
            || q.contains("tldr") || q.contains("tl;dr") || q.contains("key points")
            || q.contains("brief overview") || q.contains("in short")
            || q.contains("give me the gist") || q.contains("bottom line")
        {
            return Self::Summary;
        }

        // ── Brainstorming signals ──
        if q.contains("brainstorm") || q.contains("ideas for")
            || q.contains("creative ways") || q.contains("come up with")
            || q.contains("suggest some") || q.contains("think of")
            || q.contains("imagine") || q.contains("what if we")
            || q.contains("innovative") || q.contains("invent")
        {
            return Self::Brainstorming;
        }

        // ── HowTo signals ──
        if q.starts_with("how to") || q.starts_with("how do i")
            || q.starts_with("how can i") || q.contains("step by step")
            || q.contains("step-by-step") || q.contains("walk me through")
            || q.contains("guide to") || q.contains("tutorial")
            || q.contains("set up") || q.contains("setup") || q.contains("install")
            || q.contains("configure")
        {
            return Self::HowTo;
        }

        // ── Opinion / comparison signals ──
        if q.starts_with("should i") || q.starts_with("which is better")
            || q.contains("compare") || q.contains("vs ") || q.contains("versus")
            || q.contains("trade-off") || q.contains("tradeoff")
            || q.contains("pros and cons") || q.contains("what do you think")
            || q.contains("your opinion") || q.contains("recommend")
        {
            return Self::Opinion;
        }

        // ── Explanation signals ──
        if q.starts_with("explain") || q.starts_with("what is")
            || q.starts_with("what are") || q.starts_with("what does")
            || q.starts_with("why is") || q.starts_with("why do")
            || q.starts_with("why does") || q.contains("meaning of")
            || q.contains("define ") || q.contains("concept of")
            || q.starts_with("how does") || q.starts_with("how do ")
        {
            return Self::Explanation;
        }

        Self::General
    }

    /// The natural band for this query type — the reasoning style that
    /// objectively fits best, regardless of user preference.
    fn natural_band(&self) -> Option<RefractionBand> {
        match self {
            Self::Troubleshooting => Some(RefractionBand::Direct),
            Self::Summary         => Some(RefractionBand::Direct),
            Self::Brainstorming   => Some(RefractionBand::Creative),
            Self::HowTo           => Some(RefractionBand::Analytical),
            Self::Opinion         => Some(RefractionBand::Exploratory),
            // Explanation and General → no override, respect user profile
            Self::Explanation     => None,
            Self::General         => None,
        }
    }

    /// How strongly this query type should override the user's preference.
    /// 0.0 = never override, 1.0 = always override.
    ///
    /// Troubleshooting has high override because nobody wants a creative
    /// poem about their stack trace. Brainstorming has moderate override
    /// because even analytical users benefit from lateral thinking prompts.
    fn override_strength(&self) -> f64 {
        match self {
            Self::Troubleshooting => 0.85,  // Almost always override
            Self::Summary         => 0.90,  // Summaries must be concise
            Self::Brainstorming   => 0.60,  // Moderate — some users want structured brainstorms
            Self::HowTo           => 0.55,  // Moderate — structure helps, but style varies
            Self::Opinion         => 0.50,  // Balanced — exploratory is good but not mandatory
            Self::Explanation     => 0.0,   // Never override — respect preference
            Self::General         => 0.0,   // Never override — respect preference
        }
    }
}

// ─── Profile Intelligence ──────────────────────────────────────────────────────

impl CognitiveProfile {
    /// Select the primary refraction band based on accumulated profile.
    /// This is what makes the AI feel "tuned to you" — it leads with
    /// the reasoning style you've historically preferred.
    pub fn primary_band(&self) -> RefractionBand {
        if self.depth < 0.3 {
            RefractionBand::Direct
        } else if self.creativity > 0.65 {
            RefractionBand::Creative
        } else if self.depth > 0.7 && self.technical_level > 0.5 {
            RefractionBand::Analytical
        } else if self.creativity > 0.45 && self.depth > 0.5 {
            RefractionBand::Exploratory
        } else {
            // Balanced profile → analytical is the safe default
            RefractionBand::Analytical
        }
    }

    /// The profile preference strength — how "decided" the user is.
    /// 0.0 = balanced/default (easy to override), 1.0 = strongly preferred.
    ///
    /// Calculated by measuring how far the dominant axis has moved from
    /// its default midpoint (0.5), scaled by interaction count confidence.
    fn preference_strength(&self) -> f64 {
        // How far the strongest axis has deviated from neutral
        let max_deviation = [
            (self.depth - 0.5).abs(),
            (self.creativity - 0.5).abs(),
            (self.formality - 0.5).abs(),
            (self.technical_level - 0.5).abs(),
            (self.example_preference - 0.5).abs(),
        ]
        .iter()
        .cloned()
        .fold(0.0_f64, f64::max);

        // Interaction confidence: ramps up from 0→1 over first 20 interactions
        let confidence = (self.interaction_count as f64 / 20.0).min(1.0);

        // Combine: deviation × confidence, capped at 1.0
        (max_deviation * 2.0 * confidence).min(1.0)
    }

    /// Context-Aware Band Selection (Patent Pending)
    ///
    /// The core of the Query-Type × Cognitive-Profile Matrix. Instead of
    /// always using the user's preferred band, this method considers what
    /// KIND of question is being asked and may override the preference
    /// when the query type has a strong natural fit.
    ///
    /// Two-tier override logic:
    ///   1. High-confidence query types (override_strength >= 0.80) ALWAYS
    ///      use their natural band — this guarantees you never get a creative
    ///      poem about a stack trace, regardless of user preference.
    ///   2. Moderate-confidence types (override_strength < 0.80) only override
    ///      when: override_strength(query_type) > preference_strength(profile)
    ///
    /// This means:
    /// - New users (weak preferences) get smart defaults per query type
    /// - Power users with strong preferences keep control for moderate types
    /// - "Fix this error" → ALWAYS Direct, no exceptions
    /// - "Summarize this" → ALWAYS Direct, no exceptions
    /// - "Explain X" → always respects user preference
    pub fn band_for_query(&self, query: &str) -> RefractionBand {
        let qt = QueryType::classify(query);

        if let Some(natural) = qt.natural_band() {
            let override_str = qt.override_strength();

            // High-confidence query types (>= 0.80) ALWAYS override.
            // This is the "adaptive cruise control braking" — certain query
            // shapes demand a specific cognitive band regardless of user
            // preference. A troubleshooting query must be Direct; a summary
            // must be concise. No exceptions.
            if override_str >= 0.80 {
                return natural;
            }

            // Moderate-confidence types: override only if the user's
            // preference hasn't been strongly calibrated yet.
            let pref_str = self.preference_strength();
            if override_str > pref_str {
                return natural;
            }
        }

        // Otherwise, respect the user's learned preference
        self.primary_band()
    }

    /// Select an alternative band that contrasts with the primary.
    /// This is what gets shown as "See another perspective" — always
    /// a meaningfully different approach, not a minor variation.
    pub fn alternative_band(&self) -> RefractionBand {
        self.alternative_band_for_query("")
    }

    /// Context-aware alternative band — picks a contrasting perspective
    /// that complements the context-aware primary selection.
    pub fn alternative_band_for_query(&self, query: &str) -> RefractionBand {
        let primary = self.band_for_query(query);
        match primary {
            RefractionBand::Direct => {
                if self.creativity > 0.4 {
                    RefractionBand::Creative
                } else {
                    RefractionBand::Analytical
                }
            }
            RefractionBand::Analytical => {
                if self.creativity < 0.3 {
                    RefractionBand::Creative  // Stretch zone
                } else {
                    RefractionBand::Direct
                }
            }
            RefractionBand::Creative => RefractionBand::Analytical,
            RefractionBand::Exploratory => RefractionBand::Direct,
        }
    }

    /// Generate system prompt modifiers based on cognitive profile AND query type.
    /// These get appended to the Reasoner's system prompt, shaping the
    /// response to match BOTH the user's thinking style AND the question's needs.
    pub fn prompt_modifiers_for_query(&self, query: &str) -> String {
        let band = self.band_for_query(query);
        let qt = QueryType::classify(query);

        let mut mods: Vec<&str> = Vec::new();

        // If a context-aware override was applied, inject the band's directive
        // to ensure the LLM follows the appropriate reasoning style.
        if let Some(_natural) = qt.natural_band() {
            let override_str = qt.override_strength();
            if override_str >= 0.80 || override_str > self.preference_strength() {
                // Override active — use the band's directive directly
                mods.push(band.system_directive());
            }
        }

        // Don't add profile-based modifiers until we have enough signal
        if self.interaction_count < 3 {
            if mods.is_empty() {
                return String::new();
            }
            return format!("\n\nAdapt your response style: {}", mods.join(" "));
        }

        // Depth axis (only if no override already pushed a depth-related directive)
        let no_override_active = qt.natural_band().is_none()
            || (qt.override_strength() < 0.80 && self.preference_strength() >= qt.override_strength());
        if no_override_active {
            if self.depth < 0.3 {
                mods.push("Be concise and direct. Lead with the answer.");
            } else if self.depth > 0.7 {
                mods.push("Provide thorough, detailed analysis with reasoning steps.");
            }
        }

        // Creativity axis
        if self.creativity > 0.6 {
            mods.push("Use analogies and creative connections to explain concepts.");
        } else if self.creativity < 0.2 {
            mods.push("Stay factual and structured. Avoid embellishment.");
        }

        // Formality axis
        if self.formality > 0.7 {
            mods.push("Use a professional, formal tone.");
        } else if self.formality < 0.3 {
            mods.push("Use a conversational, friendly tone.");
        }

        // Technical level axis
        if self.technical_level > 0.7 {
            mods.push("Use precise technical terminology. The user is an expert.");
        } else if self.technical_level < 0.3 {
            mods.push("Explain in plain language. Avoid jargon.");
        }

        // Examples axis
        if self.example_preference > 0.65 {
            mods.push("Include concrete examples to illustrate key points.");
        }

        if mods.is_empty() {
            return String::new();
        }

        format!("\n\nAdapt your response style: {}", mods.join(" "))
    }

    /// Legacy prompt_modifiers without query context (backwards compatible).
    pub fn prompt_modifiers(&self) -> String {
        self.prompt_modifiers_for_query("")
    }

    /// Update the profile based on a user signal (feedback or band preference).
    ///
    /// The learning rate decays with interaction count — early signals have
    /// outsized influence (fast calibration), later signals are gentle nudges
    /// (stable personality). This mirrors how humans calibrate to each other.
    pub fn learn(&mut self, band: RefractionBand, positive: bool) {
        let base_delta = if positive { 0.06 } else { -0.03 };
        // Learning rate decay: fast at first, then stabilizes
        let lr = (1.0 / (1.0 + self.interaction_count as f64 * 0.05)).max(0.25);
        let adj = base_delta * lr;

        match band {
            RefractionBand::Direct => {
                self.depth = (self.depth - adj.abs() * adj.signum()).clamp(0.0, 1.0);
                self.formality = (self.formality - adj * 0.3).clamp(0.0, 1.0);
            }
            RefractionBand::Analytical => {
                self.depth = (self.depth + adj).clamp(0.0, 1.0);
                self.technical_level = (self.technical_level + adj * 0.4).clamp(0.0, 1.0);
            }
            RefractionBand::Creative => {
                self.creativity = (self.creativity + adj).clamp(0.0, 1.0);
                self.example_preference = (self.example_preference + adj * 0.5).clamp(0.0, 1.0);
            }
            RefractionBand::Exploratory => {
                self.depth = (self.depth + adj * 0.5).clamp(0.0, 1.0);
                self.creativity = (self.creativity + adj * 0.5).clamp(0.0, 1.0);
            }
        }

        self.interaction_count += 1;
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_profile_is_balanced() {
        let p = CognitiveProfile::default();
        assert_eq!(p.primary_band(), RefractionBand::Analytical);
        assert_eq!(p.interaction_count, 0);
    }

    #[test]
    fn test_direct_preference_emerges() {
        let mut p = CognitiveProfile::default();
        // Simulate user repeatedly preferring Direct responses
        for _ in 0..10 {
            p.learn(RefractionBand::Direct, true);
        }
        assert!(p.depth < 0.3, "depth should drop below 0.3, got {}", p.depth);
        assert_eq!(p.primary_band(), RefractionBand::Direct);
    }

    #[test]
    fn test_creative_preference_emerges() {
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert!(p.creativity > 0.6, "creativity should rise above 0.6, got {}", p.creativity);
        assert_eq!(p.primary_band(), RefractionBand::Creative);
    }

    #[test]
    fn test_alternative_differs_from_primary() {
        let p = CognitiveProfile::default();
        assert_ne!(p.primary_band(), p.alternative_band());
    }

    #[test]
    fn test_prompt_modifiers_empty_until_enough_interactions() {
        let p = CognitiveProfile::default();
        assert!(p.prompt_modifiers().is_empty());
    }

    #[test]
    fn test_prompt_modifiers_after_calibration() {
        let mut p = CognitiveProfile::default();
        p.interaction_count = 10;
        p.depth = 0.1; // Very concise preference
        let mods = p.prompt_modifiers();
        assert!(mods.contains("concise"), "should include concise directive: {}", mods);
    }

    #[test]
    fn test_learning_rate_decays() {
        let mut p1 = CognitiveProfile::default();
        let mut p2 = CognitiveProfile::default();
        p2.interaction_count = 50;

        let initial_creativity_1 = p1.creativity;
        let initial_creativity_2 = p2.creativity;
        p1.learn(RefractionBand::Creative, true);
        p2.learn(RefractionBand::Creative, true);

        let delta1 = p1.creativity - initial_creativity_1;
        let delta2 = p2.creativity - initial_creativity_2;
        assert!(delta1 > delta2, "early learning should have larger effect: {} vs {}", delta1, delta2);
    }

    #[test]
    fn test_band_labels_and_emojis() {
        assert_eq!(RefractionBand::Direct.label(), "Direct");
        assert_eq!(RefractionBand::Analytical.emoji(), "🔬");
        assert_eq!(RefractionBand::Creative.label(), "Creative");
        assert_eq!(RefractionBand::Exploratory.emoji(), "🧭");
    }

    #[test]
    fn test_system_directives_are_nonempty() {
        assert!(!RefractionBand::Direct.system_directive().is_empty());
        assert!(!RefractionBand::Analytical.system_directive().is_empty());
        assert!(!RefractionBand::Creative.system_directive().is_empty());
        assert!(!RefractionBand::Exploratory.system_directive().is_empty());
    }

    // ── Query Type Classification Tests ──

    #[test]
    fn test_classify_troubleshooting() {
        assert_eq!(QueryType::classify("Fix this error in my code"), QueryType::Troubleshooting);
        assert_eq!(QueryType::classify("Why is my app crashing?"), QueryType::Troubleshooting);
        assert_eq!(QueryType::classify("This doesn't work anymore"), QueryType::Troubleshooting);
        assert_eq!(QueryType::classify("Debug this issue"), QueryType::Troubleshooting);
    }

    #[test]
    fn test_classify_summary() {
        assert_eq!(QueryType::classify("Summarize this article"), QueryType::Summary);
        assert_eq!(QueryType::classify("Give me the key points"), QueryType::Summary);
        assert_eq!(QueryType::classify("TLDR of this document"), QueryType::Summary);
    }

    #[test]
    fn test_classify_brainstorming() {
        assert_eq!(QueryType::classify("Brainstorm ideas for a new app"), QueryType::Brainstorming);
        assert_eq!(QueryType::classify("Come up with creative ways to market this"), QueryType::Brainstorming);
        assert_eq!(QueryType::classify("What if we imagine a world where AI is free"), QueryType::Brainstorming);
    }

    #[test]
    fn test_classify_howto() {
        assert_eq!(QueryType::classify("How to set up a React project"), QueryType::HowTo);
        assert_eq!(QueryType::classify("Walk me through installing Rust"), QueryType::HowTo);
        assert_eq!(QueryType::classify("Step by step guide to Docker"), QueryType::HowTo);
    }

    #[test]
    fn test_classify_opinion() {
        assert_eq!(QueryType::classify("Should I use React or Vue?"), QueryType::Opinion);
        assert_eq!(QueryType::classify("Compare Python vs Rust for web backends"), QueryType::Opinion);
        assert_eq!(QueryType::classify("What do you think about microservices?"), QueryType::Opinion);
    }

    #[test]
    fn test_classify_explanation() {
        assert_eq!(QueryType::classify("Explain quantum computing"), QueryType::Explanation);
        assert_eq!(QueryType::classify("What is a neural network?"), QueryType::Explanation);
        assert_eq!(QueryType::classify("Why does gravity warp spacetime?"), QueryType::Explanation);
    }

    #[test]
    fn test_classify_general() {
        assert_eq!(QueryType::classify("Tell me a joke"), QueryType::General);
        assert_eq!(QueryType::classify("Hello there"), QueryType::General);
    }

    // ── Context-Aware Band Selection Tests ──

    #[test]
    fn test_troubleshooting_overrides_creative_preference() {
        let mut p = CognitiveProfile::default();
        // Build a strong Creative preference
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert_eq!(p.primary_band(), RefractionBand::Creative);
        // But "fix this error" should still get Direct
        assert_eq!(
            p.band_for_query("Fix this error in my code"),
            RefractionBand::Direct,
            "Troubleshooting should override even strong Creative preference"
        );
    }

    #[test]
    fn test_explanation_respects_user_preference() {
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert_eq!(p.primary_band(), RefractionBand::Creative);
        // "Explain X" should use the user's preferred band
        assert_eq!(
            p.band_for_query("Explain quantum computing"),
            RefractionBand::Creative,
            "Explanation should respect user's Creative preference"
        );
    }

    #[test]
    fn test_summary_forces_direct() {
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Analytical, true);
        }
        // Summaries should be Direct regardless
        assert_eq!(
            p.band_for_query("Summarize this document"),
            RefractionBand::Direct,
            "Summary should force Direct"
        );
    }

    #[test]
    fn test_new_user_gets_smart_defaults() {
        let p = CognitiveProfile::default(); // brand new, no interactions
        assert_eq!(p.preference_strength(), 0.0);
        // New user asking different question types gets appropriate bands
        assert_eq!(p.band_for_query("Fix this crash"), RefractionBand::Direct);
        assert_eq!(p.band_for_query("Brainstorm app ideas"), RefractionBand::Creative);
        assert_eq!(p.band_for_query("How to install Docker"), RefractionBand::Analytical);
        assert_eq!(p.band_for_query("Should I use X or Y"), RefractionBand::Exploratory);
    }

    #[test]
    fn test_general_query_uses_profile() {
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        // "Tell me a joke" is General → should respect user preference
        assert_eq!(
            p.band_for_query("Tell me a joke"),
            RefractionBand::Creative,
        );
    }

    #[test]
    fn test_alternative_band_for_query_contrasts() {
        let p = CognitiveProfile::default();
        // For troubleshooting (Direct), alternative should contrast
        let alt = p.alternative_band_for_query("Fix this error");
        assert_ne!(alt, RefractionBand::Direct);
        // For brainstorming (Creative), alternative should contrast
        let alt2 = p.alternative_band_for_query("Brainstorm ideas");
        assert_ne!(alt2, RefractionBand::Creative);
    }

    #[test]
    fn test_preference_strength_increases_with_learning() {
        let mut p = CognitiveProfile::default();
        assert_eq!(p.preference_strength(), 0.0);
        for _ in 0..20 {
            p.learn(RefractionBand::Creative, true);
        }
        assert!(
            p.preference_strength() > 0.5,
            "20 Creative signals should build strong preference, got {}",
            p.preference_strength()
        );
    }

    #[test]
    fn test_prompt_modifiers_for_troubleshooting() {
        let p = CognitiveProfile::default(); // new user
        let mods = p.prompt_modifiers_for_query("Fix this error");
        assert!(
            mods.contains("concise") || mods.contains("direct"),
            "Troubleshooting should inject Direct-style modifiers: {}",
            mods
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUERY×PROFILE MATRIX — COMPREHENSIVE INTEGRATION TESTS
    // Validates all aspects of the adaptive band-selection algorithm.
    // ═══════════════════════════════════════════════════════════════════════════

    // ── Query Classification Exhaustiveness ─────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_a_classify_troubleshooting_all_signals() {
        // Every documented troubleshooting keyword must trigger classification
        let signals = [
            "Fix this error", "My app is broken", "doesn't work",
            "does not work", "not working", "There's a bug",
            "The server crashed", "Build failed", "Debug this issue",
            "Something is wrong", "I have a problem with my code",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::Troubleshooting,
                "Expected Troubleshooting for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_summary_all_signals() {
        let signals = [
            "Summarize this article", "Summary of the meeting",
            "TLDR please", "tl;dr of this", "Give me the key points",
            "Brief overview of the report", "In short, what happened",
            "Give me the gist", "What's the bottom line",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::Summary,
                "Expected Summary for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_brainstorming_all_signals() {
        let signals = [
            "Brainstorm marketing ideas", "Ideas for a startup",
            "Creative ways to teach", "Come up with a plan",
            "Suggest some alternatives", "Think of a name",
            "Imagine a new product", "What if we built X",
            "Innovative approaches to Y", "Invent a new feature",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::Brainstorming,
                "Expected Brainstorming for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_howto_all_signals() {
        let signals = [
            "How to deploy a React app", "How do I reset my password",
            "How can I optimize this", "Step by step database migration",
            "Step-by-step Kubernetes setup", "Walk me through Git rebase",
            "Guide to setting up CI/CD", "Docker tutorial",
            "Set up a Python virtualenv", "Setup instructions for VS Code",
            "Install Rust on Windows", "Configure Nginx for HTTPS",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::HowTo,
                "Expected HowTo for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_opinion_all_signals() {
        let signals = [
            "Should I learn Rust or Go?", "Which is better, React or Vue?",
            "Compare PostgreSQL vs MySQL", "Docker vs Podman",
            "Kubernetes versus Docker Swarm", "Trade-off between speed and safety",
            "Tradeoff analysis", "Pros and cons of microservices",
            "What do you think about serverless?", "Your opinion on TDD",
            "Recommend a framework for mobile apps",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::Opinion,
                "Expected Opinion for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_explanation_all_signals() {
        let signals = [
            "Explain how TCP works", "What is a hash map?",
            "What are closures in Rust?", "What does async do?",
            "Why is Rust memory safe?", "Why do we need encryption?",
            "Why does JavaScript have event loops?", "Meaning of ACID in databases",
            "Define polymorphism", "Concept of dependency injection",
            "How does garbage collection work?", "How do neural networks learn?",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::Explanation,
                "Expected Explanation for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classify_general_fallback() {
        let signals = [
            "Tell me a joke", "Hello there", "Good morning",
            "Thanks!", "You're awesome", "What time is it?",
        ];
        for s in &signals {
            assert_eq!(
                QueryType::classify(s), QueryType::General,
                "Expected General for: '{}'", s
            );
        }
    }

    #[test]
    fn test_claim_a_classification_is_case_insensitive() {
        assert_eq!(QueryType::classify("FIX THIS ERROR"), QueryType::Troubleshooting);
        assert_eq!(QueryType::classify("SUMMARIZE this"), QueryType::Summary);
        assert_eq!(QueryType::classify("BRAINSTORM Ideas"), QueryType::Brainstorming);
        assert_eq!(QueryType::classify("HOW TO setup Docker"), QueryType::HowTo);
        assert_eq!(QueryType::classify("SHOULD I use Rust?"), QueryType::Opinion);
        assert_eq!(QueryType::classify("EXPLAIN quantum computing"), QueryType::Explanation);
    }

    // ── Natural Band Mapping ───────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_b_natural_band_troubleshooting_is_direct() {
        assert_eq!(QueryType::Troubleshooting.natural_band(), Some(RefractionBand::Direct));
    }

    #[test]
    fn test_claim_b_natural_band_summary_is_direct() {
        assert_eq!(QueryType::Summary.natural_band(), Some(RefractionBand::Direct));
    }

    #[test]
    fn test_claim_b_natural_band_brainstorming_is_creative() {
        assert_eq!(QueryType::Brainstorming.natural_band(), Some(RefractionBand::Creative));
    }

    #[test]
    fn test_claim_b_natural_band_howto_is_analytical() {
        assert_eq!(QueryType::HowTo.natural_band(), Some(RefractionBand::Analytical));
    }

    #[test]
    fn test_claim_b_natural_band_opinion_is_exploratory() {
        assert_eq!(QueryType::Opinion.natural_band(), Some(RefractionBand::Exploratory));
    }

    #[test]
    fn test_claim_b_explanation_has_no_natural_band() {
        assert_eq!(QueryType::Explanation.natural_band(), None);
    }

    #[test]
    fn test_claim_b_general_has_no_natural_band() {
        assert_eq!(QueryType::General.natural_band(), None);
    }

    // ── Override Strength Values ─────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_b_override_strengths_match_spec() {
        assert!((QueryType::Troubleshooting.override_strength() - 0.85).abs() < f64::EPSILON);
        assert!((QueryType::Summary.override_strength() - 0.90).abs() < f64::EPSILON);
        assert!((QueryType::Brainstorming.override_strength() - 0.60).abs() < f64::EPSILON);
        assert!((QueryType::HowTo.override_strength() - 0.55).abs() < f64::EPSILON);
        assert!((QueryType::Opinion.override_strength() - 0.50).abs() < f64::EPSILON);
        assert!((QueryType::Explanation.override_strength() - 0.0).abs() < f64::EPSILON);
        assert!((QueryType::General.override_strength() - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_claim_b_override_strength_ordering() {
        // Summary > Troubleshooting > Brainstorming > HowTo > Opinion > Explanation = General
        assert!(QueryType::Summary.override_strength() > QueryType::Troubleshooting.override_strength());
        assert!(QueryType::Troubleshooting.override_strength() > QueryType::Brainstorming.override_strength());
        assert!(QueryType::Brainstorming.override_strength() > QueryType::HowTo.override_strength());
        assert!(QueryType::HowTo.override_strength() > QueryType::Opinion.override_strength());
        assert!(QueryType::Opinion.override_strength() > QueryType::Explanation.override_strength());
        assert!((QueryType::Explanation.override_strength() - QueryType::General.override_strength()).abs() < f64::EPSILON);
    }

    // ── Preference Strength Computation ──────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_c_default_profile_has_zero_preference_strength() {
        let p = CognitiveProfile::default();
        assert!((p.preference_strength() - 0.0).abs() < f64::EPSILON,
            "Default (new user) preference_strength must be 0.0, got {}", p.preference_strength());
    }

    #[test]
    fn test_claim_c_preference_strength_is_multidimensional() {
        // Verify that ALL five axes contribute to preference_strength
        let axes = [
            ("depth", CognitiveProfile { depth: 1.0, interaction_count: 20, ..CognitiveProfile::default() }),
            ("creativity", CognitiveProfile { creativity: 1.0, interaction_count: 20, ..CognitiveProfile::default() }),
            ("formality", CognitiveProfile { formality: 1.0, interaction_count: 20, ..CognitiveProfile::default() }),
            ("technical_level", CognitiveProfile { technical_level: 1.0, interaction_count: 20, ..CognitiveProfile::default() }),
            ("example_preference", CognitiveProfile { example_preference: 1.0, interaction_count: 20, ..CognitiveProfile::default() }),
        ];
        for (name, profile) in &axes {
            assert!(
                profile.preference_strength() > 0.5,
                "Axis '{}' at 1.0 with 20 interactions should produce preference_strength > 0.5, got {}",
                name, profile.preference_strength()
            );
        }
    }

    #[test]
    fn test_claim_c_preference_strength_scales_with_interactions() {
        // Same deviation, different interaction counts → different strengths
        let p5 = CognitiveProfile { depth: 0.1, interaction_count: 5, ..CognitiveProfile::default() };
        let p10 = CognitiveProfile { depth: 0.1, interaction_count: 10, ..CognitiveProfile::default() };
        let p20 = CognitiveProfile { depth: 0.1, interaction_count: 20, ..CognitiveProfile::default() };
        assert!(p5.preference_strength() < p10.preference_strength(),
            "5 interactions ({}) should produce weaker preference than 10 ({})",
            p5.preference_strength(), p10.preference_strength());
        assert!(p10.preference_strength() < p20.preference_strength(),
            "10 interactions ({}) should produce weaker preference than 20 ({})",
            p10.preference_strength(), p20.preference_strength());
    }

    #[test]
    fn test_claim_c_preference_strength_capped_at_one() {
        // Extreme values should not exceed 1.0
        let p = CognitiveProfile {
            depth: 0.0,
            creativity: 1.0,
            formality: 0.0,
            technical_level: 1.0,
            example_preference: 0.0,
            interaction_count: 1000,
            ..CognitiveProfile::default()
        };
        assert!(p.preference_strength() <= 1.0,
            "preference_strength must be capped at 1.0, got {}", p.preference_strength());
    }

    #[test]
    fn test_claim_c_confidence_ramp_saturates_at_20_interactions() {
        // interaction_count >= 20 → confidence = 1.0 (saturated)
        let p20 = CognitiveProfile { depth: 0.1, interaction_count: 20, ..CognitiveProfile::default() };
        let p100 = CognitiveProfile { depth: 0.1, interaction_count: 100, ..CognitiveProfile::default() };
        assert!(
            (p20.preference_strength() - p100.preference_strength()).abs() < f64::EPSILON,
            "Confidence should saturate at 20 interactions: {} vs {}",
            p20.preference_strength(), p100.preference_strength()
        );
    }

    // ── Override Logic — Adaptive Band Selection ────────────────────────────

    #[test]
    fn test_claim_d_override_fires_when_override_gt_preference() {
        // Low preference (new user) + high override query → natural band wins
        let p = CognitiveProfile::default(); // preference_strength = 0.0
        assert_eq!(p.band_for_query("Fix this error"), RefractionBand::Direct);       // 0.85 > 0.0
        assert_eq!(p.band_for_query("Summarize this"), RefractionBand::Direct);       // 0.90 > 0.0
        assert_eq!(p.band_for_query("Brainstorm ideas"), RefractionBand::Creative);   // 0.60 > 0.0
        assert_eq!(p.band_for_query("How to setup Docker"), RefractionBand::Analytical); // 0.55 > 0.0
        assert_eq!(p.band_for_query("Should I use X or Y?"), RefractionBand::Exploratory); // 0.50 > 0.0
    }

    #[test]
    fn test_claim_d_profile_wins_when_preference_gte_override() {
        // Strong preference user → moderate overrides should NOT fire
        let mut p = CognitiveProfile::default();
        // Build up a very strong Creative preference (lots of interactions)
        for _ in 0..40 {
            p.learn(RefractionBand::Creative, true);
        }
        let pref_str = p.preference_strength();
        assert!(pref_str > 0.7, "40 Creative signals should give strong preference, got {}", pref_str);

        // Opinion (0.50) should NOT override a preference > 0.7
        assert_eq!(
            p.band_for_query("Should I use React or Vue?"),
            p.primary_band(),
            "Opinion (0.50 override) should not beat strong preference ({:.2})", pref_str
        );

        // HowTo (0.55) should NOT override a preference > 0.7
        assert_eq!(
            p.band_for_query("How to set up Docker"),
            p.primary_band(),
            "HowTo (0.55 override) should not beat strong preference ({:.2})", pref_str
        );
    }

    #[test]
    fn test_claim_d_high_override_beats_strong_preference() {
        // Even with strong Creative preference, Troubleshooting (0.85) should override
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert_eq!(p.primary_band(), RefractionBand::Creative);
        // Troubleshooting override (0.85) beats even a strong preference
        assert_eq!(
            p.band_for_query("Fix this crash"),
            RefractionBand::Direct,
            "Troubleshooting (0.85) should override Creative preference"
        );
        // Summary override (0.90) beats even a strong preference
        assert_eq!(
            p.band_for_query("Summarize this paper"),
            RefractionBand::Direct,
            "Summary (0.90) should override Creative preference"
        );
    }

    #[test]
    fn test_claim_d_explanation_never_overrides() {
        // Explanation has override_strength = 0.0 → ALWAYS respects user preference
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert_eq!(
            p.band_for_query("Explain what is Rust"),
            RefractionBand::Creative,
            "Explanation must NEVER override user preference"
        );
        // Same with a Direct-preferring user
        let mut p2 = CognitiveProfile::default();
        for _ in 0..10 {
            p2.learn(RefractionBand::Direct, true);
        }
        assert_eq!(
            p2.band_for_query("What is a neural network?"),
            p2.primary_band(),
            "Explanation must use whatever band the user has calibrated"
        );
    }

    #[test]
    fn test_claim_d_general_never_overrides() {
        // General has override_strength = 0.0 → ALWAYS respects user preference
        let mut p = CognitiveProfile::default();
        for _ in 0..15 {
            p.learn(RefractionBand::Creative, true);
        }
        assert_eq!(
            p.band_for_query("Tell me something interesting"),
            RefractionBand::Creative,
            "General must NEVER override user preference"
        );
    }

    // ── New Users Get Smart Defaults ─────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_e_new_user_all_query_types_get_natural_bands() {
        let fresh = CognitiveProfile::default();
        assert_eq!(fresh.interaction_count, 0);
        assert!((fresh.preference_strength() - 0.0).abs() < f64::EPSILON);

        // Every query type with a natural band should use it for new users
        assert_eq!(fresh.band_for_query("Fix this error"), RefractionBand::Direct);
        assert_eq!(fresh.band_for_query("Summarize this"), RefractionBand::Direct);
        assert_eq!(fresh.band_for_query("Brainstorm ideas"), RefractionBand::Creative);
        assert_eq!(fresh.band_for_query("How to install X"), RefractionBand::Analytical);
        assert_eq!(fresh.band_for_query("Should I use X or Y"), RefractionBand::Exploratory);
        // Explanation/General fall back to primary_band (Analytical for default)
        assert_eq!(fresh.band_for_query("Explain X"), RefractionBand::Analytical);
        assert_eq!(fresh.band_for_query("Hello"), RefractionBand::Analytical);
    }

    #[test]
    fn test_claim_e_new_user_prompt_modifiers_inject_override_directives() {
        let fresh = CognitiveProfile::default();
        let trouble_mods = fresh.prompt_modifiers_for_query("Fix this error");
        assert!(
            !trouble_mods.is_empty(),
            "Troubleshooting for new user should inject style modifiers"
        );
        let summary_mods = fresh.prompt_modifiers_for_query("Summarize this");
        assert!(
            !summary_mods.is_empty(),
            "Summary for new user should inject style modifiers"
        );
    }

    // ── Experienced Users ──────────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_claim_f_experienced_user_moderate_overrides_yield_to_preference() {
        // Simulate a power user with ~30 interactions strongly favoring Analytical
        let mut power_user = CognitiveProfile::default();
        for _ in 0..30 {
            power_user.learn(RefractionBand::Analytical, true);
        }
        let pref = power_user.preference_strength();
        assert!(pref > 0.6, "Power user should have strong preference: {}", pref);

        // Opinion (0.50) and HowTo (0.55) should yield to strong preference
        assert_eq!(
            power_user.band_for_query("Should I use X or Y?"),
            power_user.primary_band(),
            "Opinion override (0.50) should yield to power user preference ({:.2})", pref
        );
    }

    #[test]
    fn test_claim_f_experienced_user_high_overrides_still_fire() {
        // Even a power user gets Direct for troubleshooting
        let mut power_user = CognitiveProfile::default();
        for _ in 0..30 {
            power_user.learn(RefractionBand::Analytical, true);
        }
        assert_eq!(
            power_user.band_for_query("Fix this crash"),
            RefractionBand::Direct,
            "Troubleshooting (0.85) must override even experienced user"
        );
        assert_eq!(
            power_user.band_for_query("TLDR of this report"),
            RefractionBand::Direct,
            "Summary (0.90) must override even experienced user"
        );
    }

    // ── Emergent Behavior Tests: The "Adaptive Cruise Control" Pattern ──────

    #[test]
    fn test_emergent_behavior_creative_user_debugging_gets_direct() {
        // Key example: creative user debugging → Direct
        let mut creative_user = CognitiveProfile::default();
        for _ in 0..20 {
            creative_user.learn(RefractionBand::Creative, true);
        }
        assert_eq!(creative_user.primary_band(), RefractionBand::Creative);

        // Debugging: override fires → Direct
        assert_eq!(creative_user.band_for_query("Why is my app crashing?"), RefractionBand::Direct);
        // But their creative explanation preference is preserved
        assert_eq!(creative_user.band_for_query("What is machine learning?"), RefractionBand::Creative);
    }

    #[test]
    fn test_emergent_behavior_analytical_user_brainstorming_gets_creative() {
        // An analytical user asking for brainstorming should get Creative band
        let mut analytical_user = CognitiveProfile::default();
        for _ in 0..10 {
            analytical_user.learn(RefractionBand::Analytical, true);
        }
        assert_eq!(
            analytical_user.band_for_query("Brainstorm ideas for an app"),
            RefractionBand::Creative,
            "Brainstorming should inject creativity even for analytical users"
        );
    }

    #[test]
    fn test_emergent_behavior_gradual_preference_evolution() {
        // Simulate a user whose preference evolves over time
        let mut p = CognitiveProfile::default();

        // Phase 1: No preference, all overrides fire
        assert_eq!(p.band_for_query("How to install X"), RefractionBand::Analytical);
        assert_eq!(p.band_for_query("Should I use X?"), RefractionBand::Exploratory);

        // Phase 2: Build mild Creative preference (10 signals)
        for _ in 0..10 {
            p.learn(RefractionBand::Creative, true);
        }
        let mid_pref = p.preference_strength();
        // Mid-strength preference: high overrides still fire, moderate may not
        assert_eq!(p.band_for_query("Fix this bug"), RefractionBand::Direct,
            "Troubleshooting (0.85) should still override mid-preference ({:.2})", mid_pref);

        // Phase 3: Build very strong Creative preference (30+ total)
        for _ in 0..25 {
            p.learn(RefractionBand::Creative, true);
        }
        let strong_pref = p.preference_strength();
        // Very strong preference: only the highest overrides fire
        assert_eq!(p.band_for_query("Tell me a joke"), RefractionBand::Creative,
            "General query should use strong Creative preference");
        assert_eq!(p.band_for_query("Summarize this"), RefractionBand::Direct,
            "Summary (0.90) should still override even very strong preference ({:.2})", strong_pref);
    }

    // ── Profile Learning Tests ──────────────────────────────────────────────

    #[test]
    fn test_learn_positive_direct_decreases_depth() {
        let mut p = CognitiveProfile::default();
        let before = p.depth;
        p.learn(RefractionBand::Direct, true);
        assert!(p.depth < before, "Positive Direct signal should decrease depth");
    }

    #[test]
    fn test_learn_positive_analytical_increases_depth() {
        let mut p = CognitiveProfile::default();
        let before = p.depth;
        p.learn(RefractionBand::Analytical, true);
        assert!(p.depth > before, "Positive Analytical signal should increase depth");
    }

    #[test]
    fn test_learn_positive_creative_increases_creativity() {
        let mut p = CognitiveProfile::default();
        let before = p.creativity;
        p.learn(RefractionBand::Creative, true);
        assert!(p.creativity > before, "Positive Creative signal should increase creativity");
    }

    #[test]
    fn test_learn_positive_exploratory_increases_both() {
        let mut p = CognitiveProfile::default();
        let d_before = p.depth;
        let c_before = p.creativity;
        p.learn(RefractionBand::Exploratory, true);
        assert!(p.depth > d_before, "Exploratory should increase depth");
        assert!(p.creativity > c_before, "Exploratory should increase creativity");
    }

    #[test]
    fn test_learn_negative_reduces_signal() {
        let mut p = CognitiveProfile::default();
        p.creativity = 0.7;
        p.learn(RefractionBand::Creative, false);
        assert!(p.creativity < 0.7, "Negative Creative signal should decrease creativity");
    }

    #[test]
    fn test_learn_increments_interaction_count() {
        let mut p = CognitiveProfile::default();
        assert_eq!(p.interaction_count, 0);
        p.learn(RefractionBand::Direct, true);
        assert_eq!(p.interaction_count, 1);
        p.learn(RefractionBand::Creative, true);
        assert_eq!(p.interaction_count, 2);
    }

    #[test]
    fn test_learn_values_stay_clamped_0_to_1() {
        let mut p = CognitiveProfile::default();
        // Hammer creativity upward — should never exceed 1.0
        for _ in 0..200 {
            p.learn(RefractionBand::Creative, true);
        }
        assert!(p.creativity <= 1.0, "creativity must stay <= 1.0, got {}", p.creativity);
        assert!(p.creativity >= 0.0, "creativity must stay >= 0.0, got {}", p.creativity);
        assert!(p.example_preference <= 1.0);

        // Hammer depth downward — should never go below 0.0
        let mut p2 = CognitiveProfile::default();
        for _ in 0..200 {
            p2.learn(RefractionBand::Direct, true);
        }
        assert!(p2.depth >= 0.0, "depth must stay >= 0.0, got {}", p2.depth);
        assert!(p2.depth <= 1.0);
    }

    // ── Alternative Band Contrast Tests ─────────────────────────────────────

    #[test]
    fn test_alternative_band_always_contrasts_primary() {
        // For every possible primary band, alternative must differ
        let profiles = [
            CognitiveProfile { depth: 0.1, ..CognitiveProfile::default() }, // → Direct
            CognitiveProfile { creativity: 0.8, interaction_count: 20, ..CognitiveProfile::default() }, // → Creative
            CognitiveProfile { depth: 0.8, technical_level: 0.8, interaction_count: 20, ..CognitiveProfile::default() }, // → Analytical
            CognitiveProfile { creativity: 0.5, depth: 0.6, interaction_count: 20, ..CognitiveProfile::default() }, // → Exploratory
        ];
        for prof in &profiles {
            assert_ne!(
                prof.primary_band(), prof.alternative_band(),
                "Alternative must differ from primary {:?}", prof.primary_band()
            );
        }
    }

    #[test]
    fn test_alternative_band_for_query_contrasts_with_override() {
        let p = CognitiveProfile::default();
        // Troubleshooting → Direct → alternative should be non-Direct
        let alt = p.alternative_band_for_query("Fix this bug");
        assert_ne!(alt, RefractionBand::Direct);
        // Summary → Direct → alternative should be non-Direct
        let alt2 = p.alternative_band_for_query("Summarize this");
        assert_ne!(alt2, RefractionBand::Direct);
        // Brainstorming → Creative → alternative should be non-Creative
        let alt3 = p.alternative_band_for_query("Brainstorm ideas");
        assert_ne!(alt3, RefractionBand::Creative);
    }

    // ── Prompt Modifier Integration Tests ───────────────────────────────────

    #[test]
    fn test_prompt_modifiers_override_injects_band_directive() {
        let fresh = CognitiveProfile::default(); // preference 0.0
        let mods = fresh.prompt_modifiers_for_query("Fix this error");
        // Should contain the Direct band's system directive content
        assert!(
            mods.contains("concise") || mods.contains("direct") || mods.contains("answer"),
            "Override directive should inject Direct-style language: '{}'", mods
        );
    }

    #[test]
    fn test_prompt_modifiers_no_override_uses_profile_axes() {
        let mut p = CognitiveProfile::default();
        p.interaction_count = 15;
        p.depth = 0.85;
        p.technical_level = 0.8;
        p.creativity = 0.1;

        // "Explain X" (no override) → uses profile axes
        let mods = p.prompt_modifiers_for_query("Explain quantum computing");
        assert!(mods.contains("thorough") || mods.contains("detailed"),
            "High depth should trigger detailed directive: '{}'", mods);
        assert!(mods.contains("technical") || mods.contains("expert"),
            "High technical_level should trigger expert directive: '{}'", mods);
    }

    #[test]
    fn test_prompt_modifiers_empty_for_new_user_general_query() {
        let fresh = CognitiveProfile::default();
        // General query + new user + no override → empty modifiers
        let mods = fresh.prompt_modifiers_for_query("Tell me a joke");
        assert!(mods.is_empty(),
            "General query for new user should produce no modifiers, got: '{}'", mods);
    }

    // ── Boundary and Edge Case Tests ────────────────────────────────────────

    #[test]
    fn test_boundary_preference_exactly_equals_override() {
        // When preference_strength == override_strength, override should NOT fire
        // (the condition is strictly >)
        let mut p = CognitiveProfile::default();
        // Manually craft a profile where preference_strength ≈ 0.50 (Opinion override)
        p.depth = 0.25;  // deviation = 0.25, × 2 = 0.5
        p.interaction_count = 20; // confidence = 1.0
        // preference_strength = 0.25 * 2.0 * 1.0 = 0.50
        let pref = p.preference_strength();
        assert!(
            (pref - 0.50).abs() < 0.01,
            "Crafted preference should be ~0.50, got {}", pref
        );
        // Opinion override is exactly 0.50 → should NOT fire (> not >=)
        assert_eq!(
            p.band_for_query("Should I use X or Y?"),
            p.primary_band(),
            "Equal override (0.50) should NOT beat equal preference ({:.3})", pref
        );
    }

    #[test]
    fn test_empty_query_treated_as_general() {
        assert_eq!(QueryType::classify(""), QueryType::General);
        let p = CognitiveProfile::default();
        assert_eq!(p.band_for_query(""), p.primary_band());
    }

    #[test]
    fn test_very_long_query_still_classifies() {
        let long_query = "I've been trying to fix this error for hours and I don't know what's \
            wrong with the code and it keeps crashing every time I try to compile the project \
            and I've looked at every file and nothing seems to work and I'm getting really \
            frustrated because the error message doesn't make any sense to me at all";
        assert_eq!(QueryType::classify(long_query), QueryType::Troubleshooting);
    }

    #[test]
    fn test_primary_band_all_quadrants() {
        // Verify all four primary_band() return paths
        let direct = CognitiveProfile { depth: 0.1, ..CognitiveProfile::default() };
        assert_eq!(direct.primary_band(), RefractionBand::Direct);

        let creative = CognitiveProfile { creativity: 0.8, ..CognitiveProfile::default() };
        assert_eq!(creative.primary_band(), RefractionBand::Creative);

        let analytical = CognitiveProfile { depth: 0.8, technical_level: 0.7, ..CognitiveProfile::default() };
        assert_eq!(analytical.primary_band(), RefractionBand::Analytical);

        let exploratory = CognitiveProfile { creativity: 0.5, depth: 0.6, ..CognitiveProfile::default() };
        assert_eq!(exploratory.primary_band(), RefractionBand::Exploratory);

        let balanced = CognitiveProfile::default();
        assert_eq!(balanced.primary_band(), RefractionBand::Analytical); // safe default
    }
}
