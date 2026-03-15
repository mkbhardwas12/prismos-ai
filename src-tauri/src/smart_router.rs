// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Smart Model Router — Automatic model selection based on payload content
//
// When an image is detected in the payload, PrismOS automatically swaps to
// a vision-capable model (llava, llama3.2-vision, bakllava, moondream), then
// reverts to the user's default model when done. Zero user friction.

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
    "qwen2-vl",
    "gemma3",
    "internvl",
    "phi3.5-vision",
];

/// Priority order for auto-selecting a vision model when none is specified
const VISION_MODEL_PRIORITY: &[&str] = &[
    "llama3.2-vision",
    "gemma3",
    "qwen2-vl",
    "llava",
    "internvl",
    "llava-llama3",
    "bakllava",
    "moondream",
    "phi3.5-vision",
    "llava-phi3",
    "minicpm-v",
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
    pub is_agentic: bool,
    /// Context window tier: "small" (4K), "medium" (8-16K), "large" (32K+)
    pub context_tier: String,
}

// ─── Core Routing Logic ────────────────────────────────────────────────────────

/// Check if a model name indicates vision capability
pub fn is_vision_model(model_name: &str) -> bool {
    let lower = model_name.to_lowercase();
    VISION_MODEL_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

/// Check if a model name indicates code specialization
pub fn is_code_model(model_name: &str) -> bool {
    let lower = model_name.to_lowercase();
    CODE_MODEL_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
}

/// Detect capabilities for a model based on its name
pub fn detect_capabilities(model_name: &str) -> ModelCapabilities {
    let lower = model_name.to_lowercase();
    let is_multilingual = lower.contains("qwen")
        || lower.contains("gemma")
        || lower.contains("aya")
        || lower.contains("bloom");
    let is_math = lower.contains("mathstral")
        || lower.contains("deepseek-r1")
        || lower.contains("qwen3");
    let is_agentic = lower.contains("qwen3")
        || lower.contains("deepseek-r1")
        || lower.contains("llama3.1")
        || lower.contains("llama3.2");
    let context_tier = if lower.contains("32b")
        || lower.contains("70b")
        || lower.contains("deepseek-v3")
    {
        "large".to_string()
    } else if lower.contains("14b")
        || lower.contains("13b")
        || lower.contains("8b")
        || lower.contains("7b")
    {
        "medium".to_string()
    } else {
        "small".to_string()
    };
    ModelCapabilities {
        name: model_name.to_string(),
        is_vision: is_vision_model(model_name),
        is_code: is_code_model(model_name),
        is_reasoning: lower.contains("deepseek-r1"),
        is_multilingual,
        is_math,
        is_agentic,
        context_tier,
    }
}

/// Find the best available vision model from a list of installed models.
/// Returns None if no vision model is installed.
pub fn find_best_vision_model(available_models: &[String]) -> Option<String> {
    // Try models in priority order
    for preferred in VISION_MODEL_PRIORITY {
        for available in available_models {
            let lower = available.to_lowercase();
            if lower.contains(preferred) {
                return Some(available.clone());
            }
        }
    }
    None
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

        // No vision model available — fallback to llava (might need to be pulled)
        return RoutingDecision {
            model: "llava".to_string(),
            auto_swapped: true,
            original_model: original,
            reason: "No vision model found locally — defaulting to llava (may need pull)".to_string(),
            is_vision: true,
        };
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
        assert!(is_vision_model("qwen2-vl:latest"));
        assert!(!is_vision_model("mistral"));
        assert!(!is_vision_model("llama3.1"));
        assert!(!is_vision_model("phi3"));
        assert!(!is_vision_model("qwen2.5")); // text-only qwen
    }

    #[test]
    fn test_is_code_model() {
        assert!(is_code_model("codellama:7b"));
        assert!(is_code_model("deepseek-coder:6.7b"));
        assert!(!is_code_model("mistral"));
        assert!(!is_code_model("llama3.1"));
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
    fn test_find_best_vision_model_qwen2_vl() {
        let models = vec![
            "mistral:latest".to_string(),
            "qwen2-vl:latest".to_string(),
        ];
        assert_eq!(
            find_best_vision_model(&models),
            Some("qwen2-vl:latest".to_string())
        );
    }

    #[test]
    fn test_qwen2_vl_lower_priority_than_llama_vision() {
        let models = vec![
            "qwen2-vl:latest".to_string(),
            "llama3.2-vision:11b".to_string(),
        ];
        assert_eq!(
            find_best_vision_model(&models),
            Some("llama3.2-vision:11b".to_string())
        );
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
        let models = vec![
            "mistral:latest".to_string(),
            "qwen2.5-coder:7b".to_string(),
        ];
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
        assert!(caps.is_agentic);
        assert_eq!(caps.context_tier, "medium");
    }
}
