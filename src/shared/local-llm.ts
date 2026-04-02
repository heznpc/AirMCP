const OLLAMA_BASE = process.env.AIRMCP_OLLAMA_URL || "http://localhost:11434";
try {
  const parsedUrl = new URL(OLLAMA_BASE);
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!LOCAL_HOSTS.has(parsedUrl.hostname)) {
    console.error(
      `[AirMCP] Warning: AIRMCP_OLLAMA_URL points to non-local address: ${OLLAMA_BASE}. Prompts may contain sensitive Apple data.`,
    );
  }
} catch {
  console.error(`[AirMCP] Warning: AIRMCP_OLLAMA_URL is not a valid URL: ${OLLAMA_BASE}`);
}
export const DEFAULT_MODEL = process.env.AIRMCP_OLLAMA_MODEL || "llama3.2";

const TIMEOUT_CHECK = 3_000;
const TIMEOUT_GENERATE = 60_000;
const TIMEOUT_LIST = 5_000;
const CHECK_CACHE_TTL = 30_000;

interface OllamaResponse {
  model?: string;
  response?: string;
  done?: boolean;
}

let _ollamaAvailable: boolean | null = null;
let _ollamaCheckedAt = 0;

/** Check if Ollama is running. Caches result for 30s. */
export async function checkOllama(): Promise<boolean> {
  if (_ollamaAvailable !== null && Date.now() - _ollamaCheckedAt < CHECK_CACHE_TTL) {
    return _ollamaAvailable;
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_CHECK),
    });
    _ollamaAvailable = res.ok;
  } catch {
    _ollamaAvailable = false;
  }
  _ollamaCheckedAt = Date.now();
  return _ollamaAvailable;
}

/** Generate text using a local Ollama model. */
export async function ollamaGenerate(prompt: string, opts: { model?: string; system?: string } = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model ?? DEFAULT_MODEL,
    prompt,
    stream: false,
  };
  if (opts.system) body.system = opts.system;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_GENERATE),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as OllamaResponse;
  if (typeof data.response !== "string") {
    throw new Error("Ollama returned unexpected response format (missing 'response' field)");
  }
  return data.response;
}

/** List available Ollama models. */
export async function ollamaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(TIMEOUT_LIST),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}
