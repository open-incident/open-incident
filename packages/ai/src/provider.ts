/**
 * One provider abstraction: an OpenAI-compatible endpoint (Mistral La
 * Plateforme, an EU deployment, a self-hosted Ollama or vLLM). Nothing in the
 * product knows which; changing the endpoint changes no behaviour.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_BASE && process.env.AI_MODEL);
}

export function aiProviderLabel(): string {
  if (process.env.AI_PROVIDER_LABEL) return process.env.AI_PROVIDER_LABEL;
  try {
    return new URL(process.env.AI_API_BASE ?? "").host || "—";
  } catch {
    return "—";
  }
}

export function aiModel(): string {
  return process.env.AI_MODEL ?? "";
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (process.env.AI_API_KEY) h.authorization = `Bearer ${process.env.AI_API_KEY}`;
  return h;
}

const base = () => (process.env.AI_API_BASE ?? "").replace(/\/$/, "");

export type Completion = { text: string; model: string; inputTokens: number; outputTokens: number };

export async function chatComplete(opts: {
  messages: ChatMessage[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<Completion> {
  if (!aiConfigured()) throw new Error("ai_unconfigured");
  const res = await fetch(`${base()}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: aiModel(),
      messages: opts.messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 900,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`ai_http_${res.status}`);
  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = data.choices?.[0]?.message?.content;
  const text =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "";
  return {
    text: text.trim(),
    model: data.model ?? aiModel(),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

export async function embed(
  texts: string[],
): Promise<{ vectors: number[][]; model: string; tokens: number }> {
  if (!aiConfigured() || !process.env.AI_EMBED_MODEL) throw new Error("ai_embeddings_unconfigured");
  const res = await fetch(`${base()}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model: process.env.AI_EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ai_http_${res.status}`);
  const data = (await res.json()) as {
    model?: string;
    data?: Array<{ embedding: number[]; index?: number }>;
    usage?: { prompt_tokens?: number };
  };
  const vectors = (data.data ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
  return {
    vectors,
    model: data.model ?? process.env.AI_EMBED_MODEL,
    tokens: data.usage?.prompt_tokens ?? 0,
  };
}

export function embeddingsConfigured(): boolean {
  return aiConfigured() && Boolean(process.env.AI_EMBED_MODEL);
}

/** Pulls a JSON object out of a model answer, tolerant of fences and prose around it. */
export function parseJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?/m, "")
    .replace(/```$/m, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
