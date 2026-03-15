// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Model Registry — Single source of truth for all supported models

export interface ModelSpec {
  name: string;
  label: string;
  desc: string;
  size: string;
  vramMin: number;
  ramMin: number;
  context: number;
  tier: "essential" | "recommended" | "power" | "edge";
  capabilities: ModelCapability[];
  license: string;
  isDefault?: boolean;
  priority: number;
  releaseYear: number;
}

export type ModelCapability =
  | "text"
  | "vision"
  | "code"
  | "reasoning"
  | "multilingual"
  | "math"
  | "agentic"
  | "long-context";

export const MODEL_REGISTRY: ModelSpec[] = [
  // ══════════ ESSENTIAL (Tier 1 — works on most machines) ══════════
  {
    name: "qwen3:4b",
    label: "Qwen 3 4B",
    desc: "🏆 New Default — better than Llama 3.2 at same size, 128K context",
    size: "~2.5 GB",
    vramMin: 0,
    ramMin: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "multilingual", "agentic"],
    license: "Apache-2.0",
    isDefault: true,
    priority: 1,
    releaseYear: 2025,
  },
  {
    name: "phi4-mini",
    label: "Phi-4 Mini 3.8B",
    desc: "Microsoft — best math/logic under 4B, MIT license",
    size: "~2.3 GB",
    vramMin: 0,
    ramMin: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "math", "reasoning"],
    license: "MIT",
    priority: 2,
    releaseYear: 2025,
  },
  {
    name: "gemma3:4b",
    label: "Gemma 3 4B",
    desc: "Google — efficient, strong coding, fast inference",
    size: "~2.5 GB",
    vramMin: 0,
    ramMin: 4,
    context: 8192,
    tier: "essential",
    capabilities: ["text", "code"],
    license: "Gemma",
    priority: 3,
    releaseYear: 2025,
  },
  {
    name: "llama3.2",
    label: "Llama 3.2 3B",
    desc: "Meta — proven reliability, 128K context, good baseline",
    size: "~2.0 GB",
    vramMin: 0,
    ramMin: 4,
    context: 131072,
    tier: "essential",
    capabilities: ["text", "long-context"],
    license: "Llama 3.2",
    priority: 4,
    releaseYear: 2024,
  },

  // ══════════ RECOMMENDED (Tier 2 — for 8-16 GB RAM/VRAM) ══════════
  {
    name: "qwen3:8b",
    label: "Qwen 3 8B",
    desc: "🏆 Best mid-range — surpasses Mistral 7B everywhere",
    size: "~5 GB",
    vramMin: 6,
    ramMin: 8,
    context: 131072,
    tier: "recommended",
    capabilities: ["text", "code", "multilingual", "agentic"],
    license: "Apache-2.0",
    priority: 10,
    releaseYear: 2025,
  },
  {
    name: "qwen3:14b",
    label: "Qwen 3 14B",
    desc: "🏆 Best quality/size ratio — near GPT-4 on many tasks",
    size: "~9 GB",
    vramMin: 10,
    ramMin: 12,
    context: 131072,
    tier: "recommended",
    capabilities: ["text", "code", "reasoning", "multilingual", "agentic"],
    license: "Apache-2.0",
    priority: 11,
    releaseYear: 2025,
  },
  {
    name: "deepseek-r1:7b",
    label: "DeepSeek R1 7B",
    desc: "Chain-of-thought reasoning, shows thinking process",
    size: "~4.7 GB",
    vramMin: 6,
    ramMin: 8,
    context: 131072,
    tier: "recommended",
    capabilities: ["text", "reasoning", "math"],
    license: "DeepSeek",
    priority: 12,
    releaseYear: 2025,
  },
  {
    name: "mistral",
    label: "Mistral 7B",
    desc: "Proven all-rounder, fast inference",
    size: "~4.1 GB",
    vramMin: 6,
    ramMin: 8,
    context: 32768,
    tier: "recommended",
    capabilities: ["text"],
    license: "Apache-2.0",
    priority: 13,
    releaseYear: 2023,
  },

  // ══════════ SPECIALIST MODELS ══════════
  {
    name: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B",
    desc: "⌨️ Best code model — 2x better than CodeLlama",
    size: "~4.7 GB",
    vramMin: 6,
    ramMin: 8,
    context: 131072,
    tier: "recommended",
    capabilities: ["code", "text"],
    license: "Apache-2.0",
    priority: 20,
    releaseYear: 2025,
  },
  {
    name: "qwen2-vl:7b",
    label: "Qwen 2 VL 7B",
    desc: "👁️ Best vision — superior OCR & image understanding",
    size: "~5.5 GB",
    vramMin: 6,
    ramMin: 8,
    context: 32768,
    tier: "recommended",
    capabilities: ["vision", "text"],
    license: "Qwen",
    priority: 21,
    releaseYear: 2025,
  },
  {
    name: "llama3.2-vision",
    label: "Llama 3.2 Vision 11B",
    desc: "👁️ Meta vision — proven image understanding",
    size: "~7.9 GB",
    vramMin: 8,
    ramMin: 12,
    context: 131072,
    tier: "recommended",
    capabilities: ["vision", "text"],
    license: "Llama 3.2",
    priority: 22,
    releaseYear: 2024,
  },

  // ══════════ POWER USER (24GB+ VRAM) ══════════
  {
    name: "qwen3:32b",
    label: "Qwen 3 32B",
    desc: "🔥 Near GPT-4 quality, best open model at this size",
    size: "~20 GB",
    vramMin: 24,
    ramMin: 32,
    context: 131072,
    tier: "power",
    capabilities: [
      "text",
      "code",
      "reasoning",
      "multilingual",
      "agentic",
      "math",
    ],
    license: "Apache-2.0",
    priority: 30,
    releaseYear: 2025,
  },
  {
    name: "deepseek-v3:16b",
    label: "DeepSeek V3 16B",
    desc: "🔥 Top-tier reasoning & coding",
    size: "~10 GB",
    vramMin: 12,
    ramMin: 16,
    context: 131072,
    tier: "power",
    capabilities: ["text", "code", "reasoning", "math"],
    license: "DeepSeek",
    priority: 31,
    releaseYear: 2025,
  },

  // ══════════ EDGE / ULTRA-LIGHT ══════════
  {
    name: "qwen3:1.7b",
    label: "Qwen 3 1.7B",
    desc: "⚡ Ultra-light — runs on 2GB RAM, surprisingly capable",
    size: "~1.1 GB",
    vramMin: 0,
    ramMin: 2,
    context: 32768,
    tier: "edge",
    capabilities: ["text", "multilingual"],
    license: "Apache-2.0",
    priority: 40,
    releaseYear: 2025,
  },
  {
    name: "gemma2:2b",
    label: "Gemma 2 2B",
    desc: "⚡ Google ultra-light — good for low-end hardware",
    size: "~1.6 GB",
    vramMin: 0,
    ramMin: 2,
    context: 8192,
    tier: "edge",
    capabilities: ["text"],
    license: "Gemma",
    priority: 41,
    releaseYear: 2024,
  },
];

// ── Helper functions ──

/** Get models filtered by max RAM */
export function getModelsForHardware(
  ramGB: number,
  vramGB: number = 0
): ModelSpec[] {
  return MODEL_REGISTRY.filter(
    (m) => m.ramMin <= ramGB && (m.vramMin === 0 || m.vramMin <= vramGB)
  ).sort((a, b) => a.priority - b.priority);
}

/** Get the recommended default model for given hardware */
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

/** Get the best model for a specific capability given hardware constraints */
export function getBestModelFor(
  cap: ModelCapability,
  ramGB: number,
  vramGB: number = 0
): ModelSpec | undefined {
  return getModelsForHardware(ramGB, vramGB).find((m) =>
    m.capabilities.includes(cap)
  );
}

/** Convert ModelSpec to the legacy POPULAR_MODELS format for backward compatibility */
export function toLegacyFormat(spec: ModelSpec) {
  return { name: spec.name, desc: spec.desc, size: spec.size };
}

/** Convert to RECOMMENDED_MODELS format for useOllama backward compatibility */
export function toRecommendedFormat(spec: ModelSpec) {
  return {
    name: spec.name,
    label: spec.label,
    desc: spec.desc,
    size: spec.size,
    tier: spec.tier,
  };
}
