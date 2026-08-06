// Model Registry — reviewed display metadata for bundled model suggestions.
// Sizes and listed context windows were checked against official Ollama library
// entries on 2026-08-01. Tags and artifacts can change; users should re-verify
// compatibility with their installed Ollama version and actual hardware.

export interface ModelSpec {
  name: string;
  label: string;
  desc: string;
  size: string;
  /** Heuristic memory budget for discovery; not a compatibility guarantee. */
  suggestedVramGB: number;
  /** Heuristic system-memory budget for discovery; quantization/runtime matter. */
  suggestedRamGB: number;
  context: number;
  tier: "essential" | "recommended" | "power" | "edge";
  /** Conservative discovery hints from official family pages, not runtime attestation or benchmarks. */
  capabilities: ModelCapability[];
  license: string;
  sourceUrl: string;
  minOllamaVersion?: string;
  isDefault?: boolean;
  priority: number;
  releaseYear: number;
}

export type RecommendedModel = Pick<
  ModelSpec,
  "name" | "label" | "desc" | "size" | "tier" | "minOllamaVersion"
>;

export type ModelCapability =
  | "text"
  | "vision"
  | "code"
  | "reasoning"
  | "multilingual"
  | "math"
  | "long-context";

export const MODEL_REGISTRY: ModelSpec[] = [
  // ══════════ ESSENTIAL (Tier 1 — works on most machines) ══════════
  {
    name: "qwen3.5:27b",
    label: "Qwen 3.5 27B",
    desc: "Newest-generation dense flagship; strong text, code, reasoning and math. Default on 64GB-class machines (~20 tok/s, fully offline)",
    size: "~17 GB",
    suggestedVramGB: 24,
    suggestedRamGB: 32,
    context: 262144,
    tier: "power",
    capabilities: [
      "text",
      "code",
      "reasoning",
      "multilingual",
      "math",
      "long-context",
    ],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3.5",
    isDefault: true,
    priority: 1,
    releaseYear: 2026,
  },
  {
    name: "qwen3:4b",
    label: "Qwen 3 4B",
    desc: "Compact multilingual thinking model; PrismOS discards its raw reasoning trace",
    size: "~2.5 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 4,
    context: 262144,
    tier: "essential",
    capabilities: ["text", "reasoning", "multilingual", "math", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 2,
    releaseYear: 2025,
  },
  {
    name: "phi4-mini",
    label: "Phi-4 Mini 3.8B",
    desc: "Compact multilingual text model with math, reasoning, and a 128K listed context window",
    size: "~2.5 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "math", "reasoning", "multilingual", "long-context"],
    license: "MIT",
    sourceUrl: "https://ollama.com/library/phi4-mini",
    minOllamaVersion: "0.5.13",
    priority: 2,
    releaseYear: 2025,
  },
  {
    name: "gemma3:4b",
    label: "Gemma 3 4B",
    desc: "Compact multilingual vision-and-text model with a 128K listed context window",
    size: "~3.3 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "vision", "multilingual", "long-context"],
    license: "Gemma",
    sourceUrl: "https://ollama.com/library/gemma3",
    minOllamaVersion: "0.6.0",
    priority: 3,
    releaseYear: 2025,
  },
  {
    name: "llama3.2",
    label: "Llama 3.2 3B",
    desc: "Compact text baseline with a large context window",
    size: "~2.0 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "multilingual", "long-context"],
    license: "Llama 3.2",
    sourceUrl: "https://ollama.com/library/llama3.2",
    priority: 4,
    releaseYear: 2024,
  },

  // ══════════ RECOMMENDED (Tier 2 — for 8-16 GB RAM/VRAM) ══════════
  {
    name: "qwen3:8b",
    label: "Qwen 3 8B",
    desc: "Mid-size text, code, and multilingual model with a 40K listed context window",
    size: "~5.2 GB",
    suggestedVramGB: 6,
    suggestedRamGB: 8,
    context: 40960,
    tier: "recommended",
    capabilities: ["text", "code", "reasoning", "multilingual", "math", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 10,
    releaseYear: 2025,
  },
  {
    name: "qwen3:14b",
    label: "Qwen 3 14B",
    desc: "Larger text, code, reasoning, and multilingual model with a 40K listed context window",
    size: "~9.3 GB",
    suggestedVramGB: 10,
    suggestedRamGB: 12,
    context: 40960,
    tier: "recommended",
    capabilities: ["text", "code", "reasoning", "multilingual", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 11,
    releaseYear: 2025,
  },
  {
    name: "deepseek-r1:7b",
    label: "DeepSeek R1 7B",
    desc: "Reasoning-focused local model; PrismOS shows concise rationale, not hidden chain-of-thought",
    size: "~4.7 GB",
    suggestedVramGB: 6,
    suggestedRamGB: 8,
    context: 131072,
    tier: "recommended",
    capabilities: ["text", "reasoning", "math", "long-context"],
    license: "MIT",
    sourceUrl: "https://ollama.com/library/deepseek-r1",
    priority: 12,
    releaseYear: 2025,
  },
  {
    name: "mistral",
    label: "Mistral 7B",
    desc: "General-purpose text model with a moderate context window",
    size: "~4.4 GB",
    suggestedVramGB: 6,
    suggestedRamGB: 8,
    context: 32768,
    tier: "recommended",
    capabilities: ["text", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/mistral",
    priority: 13,
    releaseYear: 2024,
  },

  // ══════════ SPECIALIST MODELS ══════════
  {
    name: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    desc: "Code-focused text model with a 32K listed context window",
    size: "~4.7 GB",
    suggestedVramGB: 6,
    suggestedRamGB: 8,
    context: 32768,
    tier: "recommended",
    capabilities: ["code", "text", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen2.5-coder",
    priority: 20,
    releaseYear: 2024,
  },
  {
    name: "qwen2.5vl:7b",
    label: "Qwen 2.5 VL 7B",
    desc: "Vision-language model for image and text prompts with a 125K listed context window",
    size: "~6.0 GB",
    suggestedVramGB: 6,
    suggestedRamGB: 8,
    context: 128000,
    tier: "recommended",
    capabilities: ["vision", "text", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen2.5vl",
    minOllamaVersion: "0.7.0",
    priority: 21,
    releaseYear: 2025,
  },
  {
    name: "llama3.2-vision",
    label: "Llama 3.2 Vision 11B",
    desc: "Vision-language model for image and text prompts on larger-memory systems",
    size: "~7.8 GB",
    suggestedVramGB: 8,
    suggestedRamGB: 12,
    context: 131072,
    tier: "recommended",
    capabilities: ["vision", "text", "long-context"],
    license: "Llama 3.2",
    sourceUrl: "https://ollama.com/library/llama3.2-vision",
    priority: 22,
    releaseYear: 2024,
  },

  // ══════════ POWER USER (24GB+ VRAM) ══════════
  {
    name: "qwen3:30b-a3b",
    label: "Qwen 3 30B-A3B",
    desc: "Modern mixture-of-experts reasoning model with 30.5B total parameters, about 3B active, and a 256K listed context window",
    size: "~19 GB",
    suggestedVramGB: 20,
    suggestedRamGB: 32,
    context: 262144,
    tier: "power",
    capabilities: [
      "text",
      "code",
      "reasoning",
      "multilingual",
      "long-context",
      "math",
    ],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 29,
    releaseYear: 2025,
  },
  {
    name: "qwen3:32b",
    label: "Qwen 3 32B",
    desc: "Larger text, code, reasoning, math, and multilingual model with a 40K listed context window",
    size: "~20 GB",
    suggestedVramGB: 24,
    suggestedRamGB: 32,
    context: 40960,
    tier: "power",
    capabilities: [
      "text",
      "code",
      "reasoning",
      "multilingual",
      "long-context",
      "math",
    ],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 30,
    releaseYear: 2025,
  },
  {
    // NOTE: there is no `deepseek-v3:16b` on the Ollama registry — DeepSeek-V3 only
    // ships as 671B. `deepseek-r1:32b` is the registered larger-memory
    // reasoning option here (~20GB for the listed Ollama artifact).
    name: "deepseek-r1:32b",
    label: "DeepSeek R1 32B",
    desc: "Reasoning-oriented text, code, and math model for larger-memory systems",
    size: "~20 GB",
    suggestedVramGB: 24,
    suggestedRamGB: 32,
    context: 131072,
    tier: "power",
    capabilities: ["text", "code", "reasoning", "math", "long-context"],
    license: "MIT",
    sourceUrl: "https://ollama.com/library/deepseek-r1",
    priority: 31,
    releaseYear: 2025,
  },

  // ══════════ EDGE / ULTRA-LIGHT ══════════
  {
    name: "qwen3:1.7b",
    label: "Qwen 3 1.7B",
    desc: "Ultra-light multilingual text model with a 40K listed context window",
    size: "~1.4 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 2,
    context: 40960,
    tier: "edge",
    capabilities: ["text", "reasoning", "multilingual", "math", "long-context"],
    license: "Apache-2.0",
    sourceUrl: "https://ollama.com/library/qwen3",
    priority: 40,
    releaseYear: 2025,
  },
  {
    name: "gemma2:2b",
    label: "Gemma 2 2B",
    desc: "Ultra-light text model for constrained systems",
    size: "~1.6 GB",
    suggestedVramGB: 0,
    suggestedRamGB: 2,
    context: 8192,
    tier: "edge",
    capabilities: ["text"],
    license: "Gemma",
    sourceUrl: "https://ollama.com/library/gemma2",
    priority: 41,
    releaseYear: 2024,
  },
];

// ── Helper functions ──

/**
 * Return heuristic fit suggestions for a memory budget. A zero VRAM value means
 * CPU/unified-memory inference, not incompatibility with models that can offload
 * to a discrete GPU. This is discovery guidance, never a hardware guarantee.
 */
export function getModelsForHardware(
  ramGB: number,
  vramGB: number = 0
): ModelSpec[] {
  return MODEL_REGISTRY.filter(
    (m) =>
      m.suggestedRamGB <= ramGB &&
      (vramGB <= 0 || m.suggestedVramGB <= vramGB)
  ).sort((a, b) => a.priority - b.priority);
}

/** Get the highest-priority heuristic default for a memory budget. */
export function getDefaultModel(
  ramGB: number,
  vramGB: number = 0
): ModelSpec {
  const compatible = getModelsForHardware(ramGB, vramGB);
  return compatible.find((m) => m.isDefault) || compatible[0] || MODEL_REGISTRY[0];
}

/** Get models by capability */
export function getModelsByCapability(cap: ModelCapability): ModelSpec[] {
  return MODEL_REGISTRY.filter((m) => m.capabilities.includes(cap));
}

/** Get the highest-priority registered model for a capability and hardware budget. */
export function getBestModelFor(
  cap: ModelCapability,
  ramGB: number,
  vramGB: number = 0
): ModelSpec | undefined {
  return getModelsForHardware(ramGB, vramGB).find((m) =>
    m.capabilities.includes(cap)
  );
}

/**
 * Pick a conservative text-model suggestion while leaving roughly half of
 * system memory available for the OS, context/KV cache, and other processes.
 * This is catalog guidance only, not a runtime compatibility or quality claim.
 */
export function getConservativeRamSuggestion(systemRamGB: number): ModelSpec {
  const modelBudgetGB = Math.max(2, systemRamGB / 2);
  const candidates = getModelsForHardware(modelBudgetGB).filter((model) =>
    model.capabilities.includes("text")
  );

  return candidates.reduce<ModelSpec | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.suggestedRamGB !== best.suggestedRamGB) {
      return candidate.suggestedRamGB > best.suggestedRamGB ? candidate : best;
    }
    return candidate.priority < best.priority ? candidate : best;
  }, undefined) ?? getDefaultModel(systemRamGB);
}

/** Convert ModelSpec to the legacy POPULAR_MODELS format for backward compatibility */
export function toLegacyFormat(spec: ModelSpec) {
  return { name: spec.name, desc: spec.desc, size: spec.size };
}

/** Convert full registry to RECOMMENDED_MODELS format for useOllama backward compatibility. */
export function toRecommendedFormat(): RecommendedModel[] {
  return [...MODEL_REGISTRY]
    .sort((a, b) => a.priority - b.priority)
    .map((spec) => ({
      name: spec.name,
      label: spec.label,
      desc: spec.desc,
      size: spec.size,
      tier: spec.tier,
      minOllamaVersion: spec.minOllamaVersion,
    }));
}
