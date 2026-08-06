// Smart Model Router — Automatic model selection based on payload content
//
// When an image is detected in the payload, PrismOS swaps only to a compatible
// model that is actually installed. If none is installed, the router keeps the
// user's model and reports that vision is unavailable instead of inventing a
// model name that would require an implicit pull.

use serde::{Deserialize, Serialize};

// ─── Vision-capable model identifiers ──────────────────────────────────────────

/// Known vision-capable model name fragments (case-insensitive matching)
const VISION_MODEL_PATTERNS: &[&str] = &[
    "llava",
    "llama3.2-vision",
    "bakllava",
    "moondream",
    "llava-llama3",
    "llava-phi3",
    "minicpm-v",
    "cogvlm",
    "qwen2.5vl",
    "qwen2.5-vl",
    "qwen3-vl",
    "internvl",
    "phi3.5-vision",
];

/// Legacy vision families that remain recognizable when already installed.
/// They are not preferred over the current Qwen vision family.
const LEGACY_VISION_MODEL_PATTERNS: &[&str] = &["qwen2-vl"];

/// Priority order for auto-selecting a vision model when none is specified
const VISION_MODEL_PRIORITY: &[&str] = &[
    "qwen2.5vl",
    "qwen2.5-vl",
    "qwen3-vl",
    "llama3.2-vision",
    "gemma3",
    "llava",
    "internvl",
    "llava-llama3",
    "bakllava",
    "moondream",
    "phi3.5-vision",
    "llava-phi3",
    "minicpm-v",
    // Legacy recognition only; current qwen2.5vl tags are preferred above.
    "qwen2-vl",
];

/// Known code-specialized model name fragments (case-insensitive matching)
const CODE_MODEL_PATTERNS: &[&str] = &[
    "codellama",
    "deepseek-coder",
    "starcoder",
    "codegemma",
    "qwen2.5-coder",
    "starcoder2",
    "codestral",
];

/// Priority order for auto-selecting a code model
const CODE_MODEL_PRIORITY: &[&str] = &[
    "qwen2.5-coder",
    "deepseek-coder",
    "codellama",
    "codegemma",
    "starcoder2",
    "codestral",
    "starcoder",
];

/// User-language markers for code work. These are matched as tokens rather
/// than substrings so ordinary words such as "capital" (`api`) and "trust"
/// (`rust`) cannot accidentally activate the coding lane.
const CODE_REQUEST_TOKENS: &[&str] = &[
    "code",
    "coding",
    "codebase",
    "function",
    "debug",
    "debugging",
    "compile",
    "compiler",
    "algorithm",
    "implement",
    "refactor",
    "programming",
    "bug",
    "api",
    "sdk",
    "endpoint",
    "deploy",
    "rust",
    "cargo",
    "python",
    "javascript",
    "typescript",
    "react",
    "nodejs",
    "npm",
    "sql",
];

/// Known reasoning-oriented model-family fragments.
const REASONING_MODEL_PATTERNS: &[&str] = &[
    "deepseek-r1",
    "qwq",
    "qwen3",
    "phi4",
    "marco-o1",
    "openthinker",
    "mathstral",
];

/// Priority order for auto-selecting a reasoning model when the task is
/// analysis/math/multi-step planning or judging.
const REASONING_MODEL_PRIORITY: &[&str] = &[
    "deepseek-r1",
    "qwq",
    "qwen3",
    "phi4",
    "openthinker",
    "marco-o1",
    "mathstral",
];

// ─── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingDecision {
    /// The model to use for this request
    pub model: String,
    /// Whether the model was auto-swapped (true) or user-selected (false)
    pub auto_swapped: bool,
    /// The user's original/default model (to revert to after)
    pub original_model: String,
    /// Reason for the routing decision
    pub reason: String,
    /// Whether this is a vision-capable model
    pub is_vision: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub name: String,
    pub is_vision: bool,
    pub is_code: bool,
    pub is_reasoning: bool,
    pub is_multilingual: bool,
    pub is_math: bool,
    /// Legacy wire field. A model name cannot prove autonomous tool use, so
    /// PrismOS always reports false.
    pub is_agentic: bool,
    /// Legacy wire field. Parameter count does not establish a context window;
    /// exact limits must come from admitted runtime metadata.
    pub context_tier: String,
}

// ─── Core Routing Logic ────────────────────────────────────────────────────────

/// Check if a model name indicates vision capability
pub fn is_vision_model(model_name: &str) -> bool {
    let lower = model_name.to_lowercase();
    if lower.contains("gemma3") {
        return is_gemma3_vision_tag(&lower);
    }
    VISION_MODEL_PATTERNS
        .iter()
        .chain(LEGACY_VISION_MODEL_PATTERNS.iter())
        .any(|pattern| lower.contains(pattern))
}

/// Gemma 3's 270M and 1B tags are text-only. Bare names resolve to the default
/// (`latest`) tag, while unknown custom tags fail closed instead of claiming
/// image support without admitted runtime metadata.
fn is_gemma3_vision_tag(lower_model_name: &str) -> bool {
    let model_component = lower_model_name
        .rsplit('/')
        .next()
        .unwrap_or(lower_model_name);
    let Some((_, tag)) = model_component.split_once(':') else {
        return true;
    };
    ["4b", "12b", "27b", "latest"].iter().any(|vision_tag| {
        tag == *vision_tag
            || tag
                .strip_prefix(vision_tag)
                .is_some_and(|suffix| suffix.starts_with('-'))
    })
}

/// Check if a model name indicates code specialization
pub fn is_code_model(model_name: &str) -> bool {
    let lower = model_name.to_lowercase();
    CODE_MODEL_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

/// Detect a code-oriented request using normalized word boundaries.
pub fn looks_like_code_request(input: &str) -> bool {
    input
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .filter(|token| !token.is_empty())
        .map(str::to_ascii_lowercase)
        .any(|token| CODE_REQUEST_TOKENS.contains(&token.as_str()))
}

/// Check if a model name indicates a reasoning-oriented model family.
pub fn is_reasoning_model(model_name: &str) -> bool {
    let lower = model_name.to_lowercase();
    REASONING_MODEL_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

/// Detect capabilities for a model based on its name
pub fn detect_capabilities(model_name: &str) -> ModelCapabilities {
    let lower = model_name.to_lowercase();
    let is_multilingual = lower.contains("qwen")
        || lower.contains("gemma")
        || lower.contains("aya")
        || lower.contains("bloom")
        || lower.contains("glm");
    let is_math =
        lower.contains("mathstral") || lower.contains("deepseek-r1") || lower.contains("qwen3");
    ModelCapabilities {
        name: model_name.to_string(),
        is_vision: is_vision_model(model_name),
        is_code: is_code_model(model_name),
        is_reasoning: lower.contains("deepseek-r1")
            || lower.contains("qwen3")
            || lower.contains("phi4"),
        is_multilingual,
        is_math,
        is_agentic: false,
        context_tier: "unknown".to_string(),
    }
}

/// Find the best available vision model from a list of installed models.
/// Returns None if no vision model is installed.
pub fn find_best_vision_model(available_models: &[String]) -> Option<String> {
    // Try models in priority order
    for preferred in VISION_MODEL_PRIORITY {
        for available in available_models {
            let lower = available.to_lowercase();
            if lower.contains(preferred) && is_vision_model(available) {
                return Some(available.clone());
            }
        }
    }
    available_models
        .iter()
        .find(|available| is_vision_model(available))
        .cloned()
}

/// Find the best available code model from a list of installed models.
/// Returns None if no code-specialized model is installed.
pub fn find_best_code_model(available_models: &[String]) -> Option<String> {
    for preferred in CODE_MODEL_PRIORITY {
        for available in available_models {
            let lower = available.to_lowercase();
            if lower.contains(preferred) {
                return Some(available.clone());
            }
        }
    }
    None
}

/// Find the best available reasoning model from a list of installed models.
/// Returns None if no reasoning-specialized model is installed.
pub fn find_best_reasoning_model(available_models: &[String]) -> Option<String> {
    for preferred in REASONING_MODEL_PRIORITY {
        for available in available_models {
            let lower = available.to_lowercase();
            if lower.contains(preferred) {
                return Some(available.clone());
            }
        }
    }
    None
}

// ─── Per-Role / Per-Task Routing ────────────────────────────────────────────────

/// The kind of work an agent role needs to perform on this turn. The Refractive
/// Core maps an intent (and the active loop stage) to one of these, and the
/// router picks the best locally-installed model for it. Decoupled from
/// `AgentRole` to avoid a dependency cycle with the agents module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskKind {
    /// Default conversational / synthesis work — use the user's chosen model.
    General,
    /// Multi-step analysis, math, planning, or judging — prefer a reasoning model.
    Reasoning,
    /// Code generation / review — prefer a code-specialized model.
    Code,
    /// Anything involving an image — requires a vision model.
    Vision,
}

/// Route to the best locally-installed model for a specific task kind, falling
/// back to the user's model when no specialist is installed. This is what wires
/// per-role model selection into the agent workflow (Planner/Critic → reasoning,
/// Builder → code/general, image intents → vision).
pub fn route_for_task(
    user_model: &str,
    task: TaskKind,
    available_models: &[String],
) -> RoutingDecision {
    let original = user_model.to_string();
    match task {
        TaskKind::Vision => {
            if is_vision_model(user_model) {
                return RoutingDecision {
                    model: user_model.to_string(),
                    auto_swapped: false,
                    original_model: original,
                    reason: "User-selected vision model".to_string(),
                    is_vision: true,
                };
            }
            match find_best_vision_model(available_models) {
                Some(model) => RoutingDecision {
                    reason: format!("Routed to {} for vision task", model),
                    auto_swapped: true,
                    model,
                    original_model: original,
                    is_vision: true,
                },
                None => keep(
                    user_model,
                    "No installed vision model is available — keeping current model without claiming image support",
                ),
            }
        }
        TaskKind::Code => {
            if is_code_model(user_model) {
                return keep(user_model, "User-selected code model");
            }
            match find_best_code_model(available_models) {
                Some(model) => RoutingDecision {
                    reason: format!("Routed to {} for code task", model),
                    auto_swapped: true,
                    model,
                    original_model: original,
                    is_vision: false,
                },
                None => keep(user_model, "No code model installed — using current model"),
            }
        }
        TaskKind::Reasoning => {
            if is_reasoning_model(user_model) {
                return keep(user_model, "User model is already reasoning-capable");
            }
            match find_best_reasoning_model(available_models) {
                Some(model) => RoutingDecision {
                    reason: format!("Routed to {} for reasoning task", model),
                    auto_swapped: true,
                    model,
                    original_model: original,
                    is_vision: false,
                },
                None => keep(
                    user_model,
                    "No reasoning model installed — using current model",
                ),
            }
        }
        TaskKind::General => keep(user_model, "General task — using current model"),
    }
}

/// Which agent lane is requesting inference this turn. Decoupled from the agents
/// module's `AgentRole` to avoid a dependency cycle, and narrower than it: only
/// the roles that actually make a model call appear here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Planner/Builder remain part of the public role-routing contract.
pub enum RoleLane {
    /// Emits acceptance criteria / a plan — wants a reasoning model.
    Planner,
    /// Produces the candidate answer — code lane for code, reasoning lane for
    /// analysis, otherwise the user's model.
    Builder,
    /// Judges the candidate against the criteria — wants a reasoning model.
    Critic,
}

/// Route per agent lane. This is the design's `route_for_role`: Planner and Critic
/// always prefer the best installed reasoning model (deepseek-r1 / qwq / qwen3),
/// the Builder follows task shape (image → vision, code → code, analysis →
/// reasoning, else the user's model). Falls back to the user's model whenever the
/// preferred specialist is not installed, so nothing breaks on a lean machine.
pub fn route_for_role(
    user_model: &str,
    role: RoleLane,
    is_code: bool,
    is_analysis: bool,
    has_image: bool,
    available_models: &[String],
) -> RoutingDecision {
    let task = match role {
        _ if has_image => TaskKind::Vision,
        RoleLane::Planner | RoleLane::Critic => TaskKind::Reasoning,
        RoleLane::Builder if is_code => TaskKind::Code,
        RoleLane::Builder if is_analysis => TaskKind::Reasoning,
        RoleLane::Builder => TaskKind::General,
    };
    route_for_task(user_model, task, available_models)
}

/// Helper: a no-swap decision that keeps the user's model.
fn keep(user_model: &str, reason: &str) -> RoutingDecision {
    RoutingDecision {
        model: user_model.to_string(),
        auto_swapped: false,
        original_model: user_model.to_string(),
        reason: reason.to_string(),
        is_vision: is_vision_model(user_model),
    }
}

/// Core routing decision: given the payload characteristics and available models,
/// determine which model to use.
///
/// # Arguments
/// * `user_model` — The user's currently selected model
/// * `has_image` — Whether the payload contains image data
/// * `has_document` — Whether the payload contains document text
/// * `has_code_request` — Whether the intent appears to be code-related
/// * `available_models` — List of models installed locally via Ollama
pub fn route_model(
    user_model: &str,
    has_image: bool,
    has_document: bool,
    has_code_request: bool,
    available_models: &[String],
) -> RoutingDecision {
    let original = user_model.to_string();

    // ── Priority 1: Vision routing (images require a vision model) ──
    if has_image {
        // If user already selected a vision model, use it
        if is_vision_model(user_model) {
            return RoutingDecision {
                model: user_model.to_string(),
                auto_swapped: false,
                original_model: original,
                reason: "User-selected vision model".to_string(),
                is_vision: true,
            };
        }

        // Auto-detect best available vision model
        if let Some(vision_model) = find_best_vision_model(available_models) {
            return RoutingDecision {
                model: vision_model.clone(),
                auto_swapped: true,
                original_model: original,
                reason: format!(
                    "Auto-swapped to {} for image analysis (will revert to {} after)",
                    vision_model, user_model
                ),
                is_vision: true,
            };
        }

        return keep(
            user_model,
            "No installed vision model is available — keeping current model without claiming image support",
        );
    }

    // ── Priority 2: Document analysis (use user's model, it handles text well) ──
    if has_document {
        return RoutingDecision {
            model: user_model.to_string(),
            auto_swapped: false,
            original_model: original,
            reason: "Document analysis using current model".to_string(),
            is_vision: false,
        };
    }

    // ── Priority 3: Code routing (auto-swap to code model if available) ──
    if has_code_request && !is_code_model(user_model) {
        if let Some(code_model) = find_best_code_model(available_models) {
            return RoutingDecision {
                model: code_model.clone(),
                auto_swapped: true,
                original_model: original,
                reason: format!(
                    "Auto-swapped to {} for code task (will revert to {} after)",
                    code_model, user_model
                ),
                is_vision: false,
            };
        }
    }

    // ── Default: Use user's selected model ──
    RoutingDecision {
        model: user_model.to_string(),
        auto_swapped: false,
        original_model: original,
        reason: "Standard text inference".to_string(),
        is_vision: false,
    }
}

/// Classify the available models and return their capabilities.
/// Useful for the frontend to display model badges/tags.
pub fn classify_models(available_models: &[String]) -> Vec<ModelCapabilities> {
    available_models
        .iter()
        .map(|name| detect_capabilities(name))
        .collect()
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_vision_model() {
        assert!(is_vision_model("llava"));
        assert!(is_vision_model("llava:13b"));
        assert!(is_vision_model("llama3.2-vision:11b"));
        assert!(is_vision_model("bakllava:latest"));
        assert!(is_vision_model("moondream:1.8b"));
        assert!(is_vision_model("qwen2.5vl:7b"));
        assert!(is_vision_model("qwen2.5-vl:7b"));
        assert!(is_vision_model("qwen2-vl:latest")); // legacy recognition
        assert!(!is_vision_model("mistral"));
        assert!(!is_vision_model("llama3.1"));
        assert!(!is_vision_model("phi3"));
        assert!(!is_vision_model("qwen2.5")); // text-only qwen
    }

    #[test]
    fn test_gemma3_vision_detection_excludes_text_only_tags() {
        assert!(!is_vision_model("gemma3:270m"));
        assert!(!is_vision_model("gemma3:1b"));
        assert!(!is_vision_model("gemma3:1b-it-qat"));
        assert!(!is_vision_model("gemma3:custom"));

        assert!(is_vision_model("gemma3"));
        assert!(is_vision_model("gemma3:latest"));
        assert!(is_vision_model("gemma3:4b"));
        assert!(is_vision_model("gemma3:4b-it-qat"));
        assert!(is_vision_model("gemma3:12b"));
        assert!(is_vision_model("registry.ollama.ai/library/gemma3:27b"));
    }

    #[test]
    fn test_is_code_model() {
        assert!(is_code_model("codellama:7b"));
        assert!(is_code_model("deepseek-coder:6.7b"));
        assert!(!is_code_model("mistral"));
        assert!(!is_code_model("llama3.1"));
    }

    #[test]
    fn code_request_detection_uses_word_boundaries() {
        assert!(looks_like_code_request("Design a Rust API endpoint"));
        assert!(looks_like_code_request("debug this TypeScript function"));
        assert!(!looks_like_code_request("What is the capital of France?"));
        assert!(!looks_like_code_request("How can a team build trust?"));
    }

    #[test]
    fn test_find_best_vision_model() {
        let models = vec![
            "mistral:latest".to_string(),
            "llava:7b".to_string(),
            "llama3.1:8b".to_string(),
        ];
        assert_eq!(
            find_best_vision_model(&models),
            Some("llava:7b".to_string())
        );
    }

    #[test]
    fn test_find_best_vision_model_prefers_llama3_2_vision() {
        let models = vec![
            "llava:7b".to_string(),
            "llama3.2-vision:11b".to_string(),
            "mistral:latest".to_string(),
        ];
        assert_eq!(
            find_best_vision_model(&models),
            Some("llama3.2-vision:11b".to_string())
        );
    }

    #[test]
    fn test_find_best_vision_model_none_available() {
        let models = vec!["mistral:latest".to_string(), "phi3:latest".to_string()];
        assert_eq!(find_best_vision_model(&models), None);
    }

    #[test]
    fn test_find_best_vision_model_recognizes_legacy_qwen2_vl() {
        let models = vec!["mistral:latest".to_string(), "qwen2-vl:latest".to_string()];
        assert_eq!(
            find_best_vision_model(&models),
            Some("qwen2-vl:latest".to_string())
        );
    }

    #[test]
    fn test_current_qwen2_5vl_outranks_legacy_qwen2_vl() {
        let models = vec!["qwen2-vl:latest".to_string(), "qwen2.5vl:7b".to_string()];
        assert_eq!(
            find_best_vision_model(&models),
            Some("qwen2.5vl:7b".to_string())
        );
    }

    #[test]
    fn test_text_only_gemma3_tags_are_never_selected_for_vision() {
        let models = vec!["gemma3:1b".to_string(), "llava:7b".to_string()];
        assert_eq!(
            find_best_vision_model(&models),
            Some("llava:7b".to_string())
        );
        assert_eq!(find_best_vision_model(&["gemma3:270m".to_string()]), None);
    }

    #[test]
    fn test_route_model_auto_swaps_for_image() {
        let models = vec!["mistral:latest".to_string(), "llava:7b".to_string()];
        let decision = route_model("mistral", true, false, false, &models);
        assert!(decision.auto_swapped);
        assert!(decision.is_vision);
        assert_eq!(decision.model, "llava:7b");
        assert_eq!(decision.original_model, "mistral");
    }

    #[test]
    fn test_route_model_keeps_user_vision_model() {
        let models = vec!["llava:13b".to_string()];
        let decision = route_model("llava:13b", true, false, false, &models);
        assert!(!decision.auto_swapped);
        assert!(decision.is_vision);
        assert_eq!(decision.model, "llava:13b");
    }

    #[test]
    fn test_route_model_never_invents_uninstalled_vision_model() {
        let models = vec!["mistral:latest".to_string(), "gemma3:1b".to_string()];
        let decision = route_model("mistral:latest", true, false, false, &models);
        assert!(!decision.auto_swapped);
        assert!(!decision.is_vision);
        assert_eq!(decision.model, "mistral:latest");
        assert_eq!(decision.original_model, "mistral:latest");
        assert!(decision.reason.contains("No installed vision model"));
        assert!(!decision.reason.contains("llava"));
    }

    #[test]
    fn test_route_model_no_swap_for_text() {
        let models = vec!["mistral:latest".to_string(), "llava:7b".to_string()];
        let decision = route_model("mistral", false, false, false, &models);
        assert!(!decision.auto_swapped);
        assert!(!decision.is_vision);
        assert_eq!(decision.model, "mistral");
    }

    #[test]
    fn test_classify_models() {
        let models = vec![
            "mistral:latest".to_string(),
            "llava:7b".to_string(),
            "codellama:7b".to_string(),
        ];
        let caps = classify_models(&models);
        assert_eq!(caps.len(), 3);
        assert!(!caps[0].is_vision);
        assert!(caps[1].is_vision);
        assert!(caps[2].is_code);
    }

    #[test]
    fn test_find_best_code_model() {
        let models = vec![
            "mistral:latest".to_string(),
            "qwen2.5-coder:7b".to_string(),
            "llama3.1:8b".to_string(),
        ];
        assert_eq!(
            find_best_code_model(&models),
            Some("qwen2.5-coder:7b".to_string())
        );
    }

    #[test]
    fn test_code_routing_activates() {
        let models = vec!["mistral:latest".to_string(), "qwen2.5-coder:7b".to_string()];
        let decision = route_model("mistral", false, false, true, &models);
        assert!(decision.auto_swapped);
        assert_eq!(decision.model, "qwen2.5-coder:7b");
    }

    #[test]
    fn test_code_routing_no_swap_if_already_code() {
        let models = vec!["qwen2.5-coder:7b".to_string()];
        let decision = route_model("qwen2.5-coder:7b", false, false, true, &models);
        assert!(!decision.auto_swapped);
    }

    #[test]
    fn test_detect_capabilities_extended() {
        let caps = detect_capabilities("qwen3:8b");
        assert!(caps.is_multilingual);
        assert!(caps.is_math);
        assert!(!caps.is_agentic);
        assert!(caps.is_reasoning);
        assert_eq!(caps.context_tier, "unknown");
    }

    #[test]
    fn test_reasoning_detection_phi4() {
        let caps = detect_capabilities("phi4:latest");
        assert!(caps.is_reasoning);
        assert!(!caps.is_vision);
        assert!(!caps.is_code);
    }

    #[test]
    fn test_reasoning_detection_deepseek_r1() {
        let caps = detect_capabilities("deepseek-r1:1.5b");
        assert!(caps.is_reasoning);
        assert!(caps.is_math);
    }

    #[test]
    fn test_no_reasoning_for_regular_model() {
        let caps = detect_capabilities("mistral:latest");
        assert!(!caps.is_reasoning);
        let caps2 = detect_capabilities("llama3.2:3b");
        assert!(!caps2.is_reasoning);
    }

    // ─── Reasoning lane + route_for_task ─────────────────────────────────────

    #[test]
    fn test_is_reasoning_model() {
        assert!(is_reasoning_model("deepseek-r1:32b"));
        assert!(is_reasoning_model("qwen3:30b-a3b"));
        assert!(is_reasoning_model("qwq:latest"));
        assert!(is_reasoning_model("phi4:latest"));
        assert!(!is_reasoning_model("mistral:latest"));
        assert!(!is_reasoning_model("llama3.1:8b"));
    }

    #[test]
    fn test_find_best_reasoning_model_priority() {
        let models = vec![
            "qwen3:30b-a3b".to_string(),
            "deepseek-r1:32b".to_string(),
            "mistral:latest".to_string(),
        ];
        // deepseek-r1 outranks qwen3 in priority
        assert_eq!(
            find_best_reasoning_model(&models),
            Some("deepseek-r1:32b".to_string())
        );
    }

    #[test]
    fn test_find_best_reasoning_model_none() {
        let models = vec!["mistral:latest".to_string(), "llama3.1:8b".to_string()];
        assert_eq!(find_best_reasoning_model(&models), None);
    }

    #[test]
    fn test_route_for_task_reasoning_swaps() {
        let models = vec!["mistral:latest".to_string(), "deepseek-r1:32b".to_string()];
        let d = route_for_task("mistral", TaskKind::Reasoning, &models);
        assert!(d.auto_swapped);
        assert_eq!(d.model, "deepseek-r1:32b");
    }

    #[test]
    fn test_route_for_task_reasoning_keeps_capable_model() {
        let models = vec!["qwen3:30b-a3b".to_string()];
        // qwen3 is itself reasoning-capable → no swap
        let d = route_for_task("qwen3:30b-a3b", TaskKind::Reasoning, &models);
        assert!(!d.auto_swapped);
        assert_eq!(d.model, "qwen3:30b-a3b");
    }

    #[test]
    fn test_route_for_task_code_swaps() {
        let models = vec!["qwen3:30b-a3b".to_string(), "qwen2.5-coder:7b".to_string()];
        let d = route_for_task("qwen3:30b-a3b", TaskKind::Code, &models);
        assert!(d.auto_swapped);
        assert_eq!(d.model, "qwen2.5-coder:7b");
    }

    #[test]
    fn test_route_for_task_vision_swaps() {
        let models = vec!["qwen3:30b-a3b".to_string(), "qwen2.5vl:7b".to_string()];
        let d = route_for_task("qwen3:30b-a3b", TaskKind::Vision, &models);
        assert!(d.auto_swapped);
        assert!(d.is_vision);
        assert_eq!(d.model, "qwen2.5vl:7b");
    }

    #[test]
    fn test_route_for_task_vision_unavailable_keeps_user_model() {
        let models = vec!["mistral:latest".to_string(), "gemma3:270m".to_string()];
        let d = route_for_task("mistral:latest", TaskKind::Vision, &models);
        assert!(!d.auto_swapped);
        assert!(!d.is_vision);
        assert_eq!(d.model, "mistral:latest");
        assert_eq!(d.original_model, "mistral:latest");
        assert!(d.reason.contains("No installed vision model"));
        assert!(!d.reason.contains("llava"));
    }

    #[test]
    fn test_route_for_task_general_keeps_user_model() {
        let models = vec!["qwen3:30b-a3b".to_string()];
        let d = route_for_task("qwen3:30b-a3b", TaskKind::General, &models);
        assert!(!d.auto_swapped);
        assert_eq!(d.model, "qwen3:30b-a3b");
    }

    #[test]
    fn test_route_for_task_falls_back_when_no_specialist() {
        let models = vec!["mistral:latest".to_string()];
        // No code model installed → keep user's model, no swap
        let d = route_for_task("mistral", TaskKind::Code, &models);
        assert!(!d.auto_swapped);
        assert_eq!(d.model, "mistral");
    }

    // ─── route_for_role (per-lane routing) ───────────────────────────────────

    #[test]
    fn test_route_for_role_critic_prefers_reasoning() {
        let models = vec!["mistral:latest".to_string(), "deepseek-r1:32b".to_string()];
        let d = route_for_role("mistral", RoleLane::Critic, false, false, false, &models);
        assert!(d.auto_swapped);
        assert_eq!(d.model, "deepseek-r1:32b");
    }

    #[test]
    fn test_route_for_role_planner_reasoning_even_for_code() {
        // A Planner still wants a reasoning model, not a code model.
        let models = vec![
            "mistral:latest".to_string(),
            "qwen2.5-coder:7b".to_string(),
            "qwq:latest".to_string(),
        ];
        let d = route_for_role("mistral", RoleLane::Planner, true, false, false, &models);
        assert_eq!(d.model, "qwq:latest");
    }

    #[test]
    fn test_route_for_role_builder_follows_task_shape() {
        let models = vec![
            "mistral:latest".to_string(),
            "qwen2.5-coder:7b".to_string(),
            "deepseek-r1:32b".to_string(),
            "qwen2.5vl:7b".to_string(),
        ];
        // Builder + code → code lane
        assert_eq!(
            route_for_role("mistral", RoleLane::Builder, true, false, false, &models).model,
            "qwen2.5-coder:7b"
        );
        // Builder + analysis → reasoning lane
        assert_eq!(
            route_for_role("mistral", RoleLane::Builder, false, true, false, &models).model,
            "deepseek-r1:32b"
        );
        // Builder + image → vision lane
        assert_eq!(
            route_for_role("mistral", RoleLane::Builder, false, false, true, &models).model,
            "qwen2.5vl:7b"
        );
        // Builder + plain chat → keep user's model
        let d = route_for_role("mistral", RoleLane::Builder, false, false, false, &models);
        assert!(!d.auto_swapped);
        assert_eq!(d.model, "mistral");
    }

    #[test]
    fn test_route_for_role_falls_back_without_reasoning_model() {
        let models = vec!["mistral:latest".to_string()];
        let d = route_for_role("mistral", RoleLane::Critic, false, false, false, &models);
        assert!(!d.auto_swapped);
        assert_eq!(d.model, "mistral");
    }
}
