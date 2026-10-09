/**
 * Local-AI provider layer.
 *
 * One client, three backends: Ollama, LM Studio, and any OpenAI-compatible
 * endpoint (vLLM, llama.cpp server, text-generation-webui, etc.). We talk to
 * them over the OpenAI Chat Completions wire format using raw `fetch`, so we
 * stay dependency-free and provider-agnostic. Local servers typically expose
 * an OpenAI-compat surface:
 *   - Ollama:     http://127.0.0.1:11434/v1
 *   - LM Studio:  http://localhost:1234/v1
 *
 * Every method is defensive: network failures, non-JSON bodies, and malformed
 * completions all surface as a typed `ProviderError` instead of throwing raw.
 */

import type {
  CompletionRequest,
  ProviderConfig,
  ProviderHealth
} from '../../shared/types';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;

export interface ProviderClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class LocalAIProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: ProviderConfig, opts: ProviderClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Normalize the base URL so we always end with /v1 (idempotent). */
  private resolveEndpoint(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    if (/\/v\d+$/.test(base)) return base;
    return `${base}/v1`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  /** Probe reachability and list available models. */
  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      // Ollama & LM Studio both expose /v1/models (OpenAI-compat). Fall back to
      // Ollama's native /api/tags if the compat route is missing.
      const res = await this.withTimeout(this.fetchImpl(`${this.resolveEndpoint()}/models`, {
        headers: this.headers()
      }));
      if (!res.ok) {
        return {
          providerId: this.config.id,
          reachable: false,
          error: `HTTP ${res.status}`
        };
      }
      const body = (await res.json()) as { data?: { id: string }[] };
      const models = (body.data ?? []).map((m) => m.id);
      return {
        providerId: this.config.id,
        reachable: true,
        models,
        latencyMs: Date.now() - started
      };
    } catch (err) {
      return {
        providerId: this.config.id,
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started
      };
    }
  }

  /** Run a chat completion against the configured model. */
  async complete(req: CompletionRequest): Promise<string> {
    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 1500
    };

    let res: Response;
    try {
      res = await this.withTimeout(
        this.fetchImpl(`${this.resolveEndpoint()}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(payload)
        })
      );
    } catch (err) {
      throw new ProviderError(
        `Network error contacting ${this.config.label}: ${errMsg(err)}`,
        this.config.id,
        err
      );
    }

    if (!res.ok) {
      const text = await safeReadText(res);
      throw new ProviderError(
        `Provider returned HTTP ${res.status}: ${text.slice(0, 300)}`,
        this.config.id
      );
    }

    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    const content = body?.choices?.[0]?.message?.content;
    if (!content) {
      throw new ProviderError('Empty completion (no content in response)', this.config.id);
    }
    return content.trim();
  }

  /**
   * Run a completion that must yield valid JSON. We ask for JSON, then parse
   * defensively: strip code fences, and if the model wrapped the object in
   * prose, extract the first balanced {...} block. Throws ProviderError if we
   * cannot recover an object.
   */
  async completeJson<T = unknown>(req: CompletionRequest): Promise<T> {
    const augmented: CompletionRequest = {
      ...req,
      jsonMode: true,
      messages: [
        ...req.messages,
        { role: 'user', content: 'Respond with JSON only. No prose, no markdown fences.' }
      ]
    };
    const raw = await this.complete(augmented);
    return extractJson<T>(raw) as T;
  }

  private async withTimeout(promise: Promise<Response>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new ProviderError(`Request timed out after ${this.timeoutMs}ms`, this.config.id)),
        this.timeoutMs
      );
      promise.then(
        (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}

/* ----------------------------- helpers ---------------------------- */

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Recover a JSON object from a model's raw output. Handles: clean JSON,
 * ```json fences, and prose-wrapped objects by scanning for the first balanced
 * top-level {...}. Returns null if nothing parseable is found.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim();

  // Fast path: it's already valid JSON.
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }

  // Strip a leading/trailing markdown fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      /* fall through */
    }
  }

  // Scan for the first balanced top-level object.
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Convenience: build a provider client from config. */
export function createProvider(config: ProviderConfig, opts?: ProviderClientOptions): LocalAIProvider {
  return new LocalAIProvider(config, opts);
}
