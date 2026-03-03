// Patent Pending — PrismOS (US Provisional Patent, Feb 2026)
// Ollama TypeScript Client — for direct frontend calls when needed

const OLLAMA_BASE = "http://localhost:11434";

export interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  model: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const resp = await fetch(OLLAMA_BASE, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<OllamaModel[]> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`);
    const data = await resp.json();
    return data.models || [];
  } catch {
    return [];
  }
}

export async function generate(
  model: string,
  prompt: string,
): Promise<string> {
  const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${resp.statusText}`);
  }

  const data: OllamaGenerateResponse = await resp.json();
  return data.response;
}
