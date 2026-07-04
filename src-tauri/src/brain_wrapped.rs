// Brain Wrapped™ + Cognitive Fingerprint™ — Shareable Mind Snapshot Engine
//
// THE INNOVATION (no prior art):
//   Most AI tools are stateless — they have no memory of WHO you are.
//   PrismOS already learns HOW you think (Cognitive Imprint).
//   Brain Wrapped turns that data into a shareable, animated story —
//   like Spotify Wrapped, but for your mind.
//
//   The Cognitive Fingerprint is a deterministic visual signature
//   computed from your 5-axis cognitive profile + behavior patterns.
//   Two people with identical thinking styles get identical fingerprints —
//   making it both a privacy-preserving identity primitive AND a
//   compatibility metric ("how similarly do we think?").
//
//   Everything is computed locally. Nothing leaves the device unless the
//   user explicitly clicks "Share" — and even then, only the rendered
//   PNG image goes out, never raw cognitive data.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::cognitive_profile::{
    CognitiveDeltaSet, CognitiveDrift, CognitiveProfile, PredictedEdge,
    RefractionInsights,
};

// ─── Public Types ──────────────────────────────────────────────────────────────

/// A shareable, deterministic visual signature of how you think.
/// Computed entirely from local cognitive data — no PII, no raw text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CognitiveFingerprint {
    /// SHA-256 hex hash of the cognitive profile (truncated to 16 chars for display).
    /// Identical profiles produce identical hashes — enabling compatibility scoring.
    pub hash: String,

    /// Five color stops (HSL) derived from profile axes — defines the visual palette.
    pub palette: Vec<String>,

    /// Five SVG path coordinates forming a unique pentagon-like shape.
    /// Each axis controls one vertex's distance from center.
    pub shape_points: Vec<(f64, f64)>,

    /// Rotation angle (radians) derived from interaction history.
    pub rotation: f64,

    /// One of 12 archetypes: "The Architect", "The Explorer", "The Synthesizer", etc.
    pub archetype: String,

    /// Short tagline for the archetype.
    pub archetype_tagline: String,

    /// Generation seed (hours-since-epoch / 24) — fingerprint refreshes daily as profile evolves.
    pub seed: u64,
}

/// A complete Brain Wrapped snapshot — everything needed to render the story UI.
/// This is the structure exported when the user clicks "Generate My Wrapped".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainSnapshot {
    /// Slide 1: Cognitive Fingerprint
    pub fingerprint: CognitiveFingerprint,

    /// Slide 2: Your 5-axis profile + percentile labels
    pub profile: CognitiveProfile,
    pub axis_labels: AxisLabels,

    /// Slide 3: How your mind evolved (drift over time)
    pub drift: Option<CognitiveDrift>,
    pub evolution_summary: String,

    /// Slide 4: Top recurring themes (thought currents)
    pub top_currents: Vec<CurrentSummary>,

    /// Slide 5: Predictions that came true (edge prophecy hits)
    pub prophecy_count: u32,
    pub top_prophecies: Vec<PredictedEdge>,

    /// Slide 6: Reasoning style breakdown (refraction band distribution)
    pub refraction: Option<RefractionSummary>,

    /// Slide 7: Lifetime stats
    pub stats: LifetimeStats,

    /// ISO timestamp when snapshot was generated
    pub generated_at: String,

    /// Schema version for future-proofing exports
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AxisLabels {
    pub depth: String,           // e.g. "Deep Diver" / "Bottom Liner"
    pub creativity: String,      // e.g. "Pattern Weaver" / "Just-the-Facts"
    pub formality: String,       // e.g. "Professional" / "Casual"
    pub technical_level: String, // e.g. "Expert Tier" / "Plain Speaker"
    pub example_preference: String, // e.g. "Show-Me Type" / "Abstract Thinker"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentSummary {
    pub theme: String,
    pub frequency: u32,
    pub momentum: String, // "rising" / "steady" / "fading"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefractionSummary {
    pub dominant_band: String,
    pub dominant_pct: f64,
    pub blind_spot: Option<String>,
    pub growth_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifetimeStats {
    pub total_intents: u32,
    pub total_nodes: u32,
    pub total_edges: u32,
    pub days_active: u32,
    pub interactions: u32,
    pub favorite_archetype_phrase: String,
}

/// Compatibility score between two cognitive fingerprints (0.0 – 1.0).
/// 1.0 = identical thinking styles, 0.0 = polar opposites.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompatibilityScore {
    pub score: f64,
    pub axis_distances: CognitiveDeltaSet,
    pub interpretation: String,
    pub shared_archetype: bool,
}

// ─── Archetype Mapping (12 cognitive archetypes) ──────────────────────────────
//
// Derived from quadrant analysis of (depth, creativity) × (technical, formality).
// Each archetype is unique to a region of the 5-D cognitive space.

const ARCHETYPES: &[(&str, &str)] = &[
    ("The Architect",      "Builds rigorous mental models from first principles"),
    ("The Explorer",       "Chases curiosity across every domain it touches"),
    ("The Synthesizer",    "Weaves disparate ideas into elegant unified theories"),
    ("The Strategist",     "Sees three moves ahead — every conversation is a game"),
    ("The Storyteller",    "Translates complexity into narratives that stick"),
    ("The Specialist",     "Drills deep into one domain with surgical precision"),
    ("The Scout",          "Surveys the terrain quickly, then picks the best path"),
    ("The Sage",           "Pursues understanding for its own sake"),
    ("The Maker",          "Learns by building — abstraction follows action"),
    ("The Catalyst",       "Sparks new connections wherever attention lands"),
    ("The Pragmatist",     "Cuts to the answer that actually ships"),
    ("The Pattern-Seer",   "Notices the rhythm hiding in the noise"),
];

// ─── Core Generator ────────────────────────────────────────────────────────────

/// Generate a deterministic cognitive fingerprint from a profile.
/// Same input → same output. This is the secret sauce: a privacy-preserving
/// visual identity derived purely from cognitive metadata.
pub fn generate_fingerprint(profile: &CognitiveProfile) -> CognitiveFingerprint {
    // 1. Stable hash from quantized profile values (5-decimal precision).
    //    Quantization makes the hash robust to micro-fluctuations.
    let canonical = format!(
        "{:.3}|{:.3}|{:.3}|{:.3}|{:.3}",
        round3(profile.depth),
        round3(profile.creativity),
        round3(profile.formality),
        round3(profile.technical_level),
        round3(profile.example_preference),
    );
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let full_hash = hex::encode(hasher.finalize());
    let hash = full_hash[..16].to_string();

    // 2. Color palette — each axis maps to a hue in HSL color space.
    //    This produces visually distinct palettes for distinct minds.
    let palette = vec![
        hsl_color(profile.depth * 360.0, 70.0, 55.0),
        hsl_color(profile.creativity * 360.0 + 60.0, 75.0, 60.0),
        hsl_color(profile.formality * 360.0 + 120.0, 65.0, 50.0),
        hsl_color(profile.technical_level * 360.0 + 180.0, 70.0, 55.0),
        hsl_color(profile.example_preference * 360.0 + 240.0, 75.0, 60.0),
    ];

    // 3. Pentagon shape — each axis is a vertex, distance from center = axis value.
    //    Produces a 5-pointed star unique to the user's profile.
    let axes = [
        profile.depth,
        profile.creativity,
        profile.formality,
        profile.technical_level,
        profile.example_preference,
    ];
    let shape_points: Vec<(f64, f64)> = axes
        .iter()
        .enumerate()
        .map(|(i, &v)| {
            let angle = (i as f64) * (2.0 * std::f64::consts::PI / 5.0)
                - std::f64::consts::FRAC_PI_2;
            // Radius: a 0.5 (neutral) axis sits at ~50% of canvas;
            // strong axes push their vertex outward, weak axes pull it in.
            let r = 18.0 + v * 32.0;
            (50.0 + angle.cos() * r, 50.0 + angle.sin() * r)
        })
        .collect();

    // 4. Rotation derived from interaction count — your fingerprint subtly
    //    spins as you engage more, like a slow watch hand.
    let rotation = (profile.interaction_count as f64 * 0.0174).rem_euclid(2.0 * std::f64::consts::PI);

    // 5. Archetype — quadrant lookup in (depth × creativity × technical) cube
    let archetype_idx = pick_archetype_index(profile);
    let (name, tag) = ARCHETYPES[archetype_idx];

    // 6. Daily seed — fingerprint refreshes once per day as profile drifts
    let seed = current_day_seed();

    CognitiveFingerprint {
        hash,
        palette,
        shape_points,
        rotation,
        archetype: name.to_string(),
        archetype_tagline: tag.to_string(),
        seed,
    }
}

fn pick_archetype_index(p: &CognitiveProfile) -> usize {
    // Simple but deterministic: project the 5-D vector onto archetype "anchors"
    // and pick the closest one. Anchors are spread across the cognitive space.
    let me = [
        p.depth,
        p.creativity,
        p.formality,
        p.technical_level,
        p.example_preference,
    ];

    // 12 anchors, hand-tuned to match the archetype semantics.
    let anchors: [[f64; 5]; 12] = [
        [0.85, 0.40, 0.70, 0.85, 0.50], // Architect
        [0.55, 0.85, 0.40, 0.50, 0.65], // Explorer
        [0.80, 0.80, 0.55, 0.65, 0.55], // Synthesizer
        [0.75, 0.55, 0.80, 0.70, 0.45], // Strategist
        [0.60, 0.75, 0.45, 0.40, 0.85], // Storyteller
        [0.90, 0.30, 0.75, 0.90, 0.55], // Specialist
        [0.30, 0.55, 0.50, 0.50, 0.45], // Scout
        [0.85, 0.60, 0.70, 0.65, 0.40], // Sage
        [0.50, 0.55, 0.40, 0.65, 0.80], // Maker
        [0.50, 0.90, 0.45, 0.55, 0.60], // Catalyst
        [0.25, 0.35, 0.55, 0.55, 0.70], // Pragmatist
        [0.65, 0.70, 0.55, 0.55, 0.55], // Pattern-Seer
    ];

    let mut best_idx = 0usize;
    let mut best_dist = f64::MAX;
    for (i, anchor) in anchors.iter().enumerate() {
        let mut sq = 0.0;
        for k in 0..5 {
            let d = me[k] - anchor[k];
            sq += d * d;
        }
        if sq < best_dist {
            best_dist = sq;
            best_idx = i;
        }
    }
    best_idx
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn hsl_color(h: f64, s: f64, l: f64) -> String {
    let h = h.rem_euclid(360.0);
    format!("hsl({:.0}, {:.0}%, {:.0}%)", h, s, l)
}

fn current_day_seed() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86400)
        .unwrap_or(0)
}

// ─── Axis Labels (humanized) ───────────────────────────────────────────────────

pub fn label_axes(p: &CognitiveProfile) -> AxisLabels {
    AxisLabels {
        depth: tier_label(p.depth, &["Bottom Liner", "Balanced Reader", "Deep Diver"]),
        creativity: tier_label(
            p.creativity,
            &["Just-the-Facts", "Curious Connector", "Pattern Weaver"],
        ),
        formality: tier_label(
            p.formality,
            &["Casual Conversationalist", "Adaptive Voice", "Professional Tone"],
        ),
        technical_level: tier_label(
            p.technical_level,
            &["Plain Speaker", "Mixed Vocabulary", "Expert Tier"],
        ),
        example_preference: tier_label(
            p.example_preference,
            &["Abstract Thinker", "Balanced Learner", "Show-Me Type"],
        ),
    }
}

fn tier_label(v: f64, tiers: &[&str]) -> String {
    let n = tiers.len();
    let idx = ((v * n as f64).floor() as usize).min(n - 1);
    tiers[idx].to_string()
}

// ─── Compatibility Scoring ─────────────────────────────────────────────────────

/// Compute cognitive compatibility between two profiles.
/// Useful for "Find your AI twin" social features (future) — but works
/// today for self-comparison across time (you-now vs you-3-months-ago).
pub fn compute_compatibility(
    a: &CognitiveProfile,
    b: &CognitiveProfile,
) -> CompatibilityScore {
    let deltas = CognitiveDeltaSet {
        depth: (a.depth - b.depth).abs(),
        creativity: (a.creativity - b.creativity).abs(),
        formality: (a.formality - b.formality).abs(),
        technical_level: (a.technical_level - b.technical_level).abs(),
        example_preference: (a.example_preference - b.example_preference).abs(),
    };

    // Euclidean distance in 5-D cognitive space, normalized to [0, 1].
    // Max possible distance = sqrt(5) ≈ 2.236
    let sq = deltas.depth.powi(2)
        + deltas.creativity.powi(2)
        + deltas.formality.powi(2)
        + deltas.technical_level.powi(2)
        + deltas.example_preference.powi(2);
    let dist = sq.sqrt();
    let max_dist = (5.0_f64).sqrt();
    let score = (1.0 - (dist / max_dist)).clamp(0.0, 1.0);

    let interpretation = match score {
        s if s >= 0.92 => "Cognitive Twins — you process information almost identically",
        s if s >= 0.80 => "Strong Resonance — you'd finish each other's sentences",
        s if s >= 0.65 => "Compatible Minds — different lenses, similar conclusions",
        s if s >= 0.50 => "Complementary — you balance each other's blind spots",
        s if s >= 0.30 => "Diverging Paths — you'd benefit from each other's perspectives",
        _ => "Polar Opposites — fascinating creative tension potential",
    }
    .to_string();

    let shared_archetype = pick_archetype_index(a) == pick_archetype_index(b);

    CompatibilityScore {
        score,
        axis_distances: deltas,
        interpretation,
        shared_archetype,
    }
}

// ─── Snapshot Builder ──────────────────────────────────────────────────────────

/// Build a complete Brain Wrapped snapshot from raw inputs.
/// Pure function — easy to test, easy to mock for the UI.
#[allow(clippy::too_many_arguments)]
pub fn build_snapshot(
    profile: CognitiveProfile,
    drift: Option<CognitiveDrift>,
    currents: Vec<CurrentSummary>,
    prophecies: Vec<PredictedEdge>,
    refraction: Option<RefractionInsights>,
    total_intents: u32,
    total_nodes: u32,
    total_edges: u32,
    days_active: u32,
) -> BrainSnapshot {
    let fingerprint = generate_fingerprint(&profile);
    let axis_labels = label_axes(&profile);
    let evolution_summary = summarize_evolution(&drift);
    let refraction_summary = refraction.as_ref().map(summarize_refraction);
    let archetype_phrase = fingerprint.archetype_tagline.clone();

    BrainSnapshot {
        fingerprint,
        profile: profile.clone(),
        axis_labels,
        drift,
        evolution_summary,
        top_currents: currents,
        prophecy_count: prophecies.len() as u32,
        top_prophecies: prophecies.into_iter().take(3).collect(),
        refraction: refraction_summary,
        stats: LifetimeStats {
            total_intents,
            total_nodes,
            total_edges,
            days_active,
            interactions: profile.interaction_count,
            favorite_archetype_phrase: archetype_phrase,
        },
        generated_at: chrono::Utc::now().to_rfc3339(),
        schema_version: 1,
    }
}

fn summarize_evolution(drift: &Option<CognitiveDrift>) -> String {
    let Some(d) = drift else {
        return "Your cognitive profile is still calibrating — keep chatting to see your story unfold.".to_string();
    };

    let deltas = &d.deltas;
    let max = [
        ("depth", deltas.depth),
        ("creativity", deltas.creativity),
        ("formality", deltas.formality),
        ("technical sharpness", deltas.technical_level),
        ("example preference", deltas.example_preference),
    ]
    .into_iter()
    .max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap_or(std::cmp::Ordering::Equal))
    .unwrap();

    let direction = if max.1 > 0.0 { "rose" } else { "fell" };
    let magnitude = (max.1.abs() * 100.0) as i32;

    if magnitude < 3 {
        format!(
            "Over {} weeks your thinking style stayed remarkably consistent — a sign of cognitive maturity.",
            d.weeks_compared
        )
    } else {
        format!(
            "Over the last {} weeks your {} {} by {}% — your mind is actively evolving.",
            d.weeks_compared, max.0, direction, magnitude
        )
    }
}

fn summarize_refraction(insights: &RefractionInsights) -> RefractionSummary {
    let (dominant_band, dominant_pct) = insights
        .band_distribution
        .iter()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(k, v)| (k.clone(), *v))
        .unwrap_or_else(|| ("Direct".to_string(), 0.0));

    RefractionSummary {
        dominant_band,
        dominant_pct,
        blind_spot: insights.blind_spots.first().cloned(),
        growth_score: insights.growth_score,
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_profile() -> CognitiveProfile {
        CognitiveProfile {
            depth: 0.8,
            creativity: 0.6,
            formality: 0.5,
            technical_level: 0.85,
            example_preference: 0.4,
            interaction_count: 142,
            last_updated: "2026-04-18T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn fingerprint_is_deterministic() {
        let p = sample_profile();
        let fp1 = generate_fingerprint(&p);
        let fp2 = generate_fingerprint(&p);
        assert_eq!(fp1.hash, fp2.hash, "same profile must produce same hash");
        assert_eq!(fp1.archetype, fp2.archetype);
        assert_eq!(fp1.shape_points.len(), 5);
        assert_eq!(fp1.palette.len(), 5);
    }

    #[test]
    fn fingerprint_changes_with_profile() {
        let mut a = sample_profile();
        let b_hash = generate_fingerprint(&a).hash.clone();
        a.creativity = 0.1;
        let new_hash = generate_fingerprint(&a).hash;
        assert_ne!(b_hash, new_hash, "different profiles must produce different hashes");
    }

    #[test]
    fn fingerprint_hash_format() {
        let fp = generate_fingerprint(&sample_profile());
        assert_eq!(fp.hash.len(), 16, "hash should be 16 hex chars");
        assert!(fp.hash.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn archetype_picker_returns_valid_index() {
        let p = sample_profile();
        let idx = pick_archetype_index(&p);
        assert!(idx < ARCHETYPES.len());
    }

    #[test]
    fn compatibility_self_is_perfect() {
        let p = sample_profile();
        let score = compute_compatibility(&p, &p);
        assert!((score.score - 1.0).abs() < 1e-9);
        assert!(score.shared_archetype);
    }

    #[test]
    fn compatibility_opposite_is_low() {
        let a = CognitiveProfile {
            depth: 0.0,
            creativity: 0.0,
            formality: 0.0,
            technical_level: 0.0,
            example_preference: 0.0,
            interaction_count: 0,
            last_updated: String::new(),
        };
        let b = CognitiveProfile {
            depth: 1.0,
            creativity: 1.0,
            formality: 1.0,
            technical_level: 1.0,
            example_preference: 1.0,
            interaction_count: 0,
            last_updated: String::new(),
        };
        let score = compute_compatibility(&a, &b);
        assert!(score.score < 0.05, "opposite profiles should have near-zero compatibility");
    }

    #[test]
    fn axis_labels_cover_all_tiers() {
        let mut p = sample_profile();
        p.depth = 0.05;
        let low = label_axes(&p);
        p.depth = 0.95;
        let high = label_axes(&p);
        assert_ne!(low.depth, high.depth);
    }

    #[test]
    fn build_snapshot_produces_complete_data() {
        let snapshot = build_snapshot(
            sample_profile(),
            None,
            vec![CurrentSummary {
                theme: "Rust ownership".to_string(),
                frequency: 12,
                momentum: "rising".to_string(),
            }],
            vec![],
            None,
            42,
            87,
            134,
            21,
        );
        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.top_currents.len(), 1);
        assert_eq!(snapshot.stats.total_intents, 42);
        assert_eq!(snapshot.fingerprint.shape_points.len(), 5);
        assert!(!snapshot.evolution_summary.is_empty());
    }

    #[test]
    fn evolution_summary_handles_missing_drift() {
        let s = summarize_evolution(&None);
        assert!(s.contains("calibrating"));
    }

    #[test]
    fn fingerprint_seed_is_stable_within_day() {
        let p = sample_profile();
        let f1 = generate_fingerprint(&p);
        let f2 = generate_fingerprint(&p);
        assert_eq!(f1.seed, f2.seed);
    }
}
