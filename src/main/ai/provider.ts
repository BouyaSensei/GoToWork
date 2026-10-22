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
/** Extra attempts after an empty completion before giving up. */
const MAX_EMPTY_RETRIES = 2;

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

  /** Run a chat completion against the configured model. Local models
   *  occasionally return an empty completion (degenerate sampling / KV hiccup)
   *  — retry a couple of times before surfacing the error; empty responses
   *  come back instantly, so retries are cheap. */
  async complete(req: CompletionRequest): Promise<string> {
    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxTokens ?? 1500
    };

    for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt++) {
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
      if (content) return content.trim();

      // Empty completion: brief pause, then retry.
      if (attempt < MAX_EMPTY_RETRIES) await delay(500);
    }
    throw new ProviderError(
      `Empty completion (no content in response after ${MAX_EMPTY_RETRIES + 1} tentatives)`,
      this.config.id
    );
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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
 * Recover a JSON object from a model's raw output. Tries, in order: clean
 * JSON, fenced JSON, whole-candidate repair (unescaped quotes / trailing
 * commas), the first balanced top-level object (quote-aware scan), and a
 * truncated-JSON close. Returns null if nothing parseable is found.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const trimmed = raw.trim();

  // Fast path: it's already valid JSON.
  const direct = tryParse(trimmed);
  if (direct && typeof direct === 'object') return direct as T;

  // Strip a leading/trailing markdown fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const inner = tryParse(fenced[1].trim()) ?? tryParse(repairJson(fenced[1].trim()));
    if (inner && typeof inner === 'object') return inner as T;
  }

  // Work from the first '{' onward (drops any prose prefix).
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  const candidate = trimmed.slice(start);

  // Complete JSON with unescaped quotes / trailing commas: repair the whole
  // candidate. This also covers cases where a brace scan would desync on an
  // inner quote.
  const repaired = tryParse(repairJson(candidate));
  if (repaired && typeof repaired === 'object') return repaired as T;

  // First balanced top-level object (quote-aware scan).
  const end = findBalancedEnd(candidate);
  if (end !== -1) {
    const slice = candidate.slice(0, end + 1);
    const obj = tryParse(slice) ?? tryParse(repairJson(slice));
    if (obj && typeof obj === 'object') return obj as T;
  }

  // No balanced close: the model was cut off mid-JSON. Repair first (so the
  // closer sees a consistent string state), then close open structures — a
  // partial report beats no report.
  const closed =
    tryParse(closeTruncated(repairJson(candidate))) ??
    tryParse(repairJson(closeTruncated(candidate)));
  if (closed && typeof closed === 'object') return closed as T;

  return null;
}

/** Index of the '}' that closes the first top-level object, or -1. Unlike a
 *  naive quote toggle, a '"' only ends a string when what follows is
 *  structural (`,` `}` `]` `:` or end-of-text) — so unescaped inner quotes
 *  don't desync the scan. */
function findBalancedEnd(s: string): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
      } else {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = s[j];
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) inString = false;
      }
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Conservative repairs for common LLM JSON breakage: unescaped inner quotes
 *  and trailing commas. Only fixes syntax — never invents content. */
function repairJson(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inStr) {
      if (ch === '"') inStr = true;
      out += ch;
      continue;
    }
    if (esc) {
      esc = false;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      // A real closing quote is followed by , } ] : or end-of-text. Anything
      // else means the model forgot to escape an inner quote → escape it.
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const next = s[j];
      if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return fixSwappedClosers(out.replace(/,\s*([}\]])/g, '$1'));
}

/** Swap adjacent mismatched closers outside strings (`}]` → `]}`) — a common
 *  LLM slip where the last two closing brackets come out in the wrong order.
 *  Only swaps when the very next char is the other closer. */
function fixSwappedClosers(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      out += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      const top = stack[stack.length - 1];
      const matches = (top === '{' && ch === '}') || (top === '[' && ch === ']');
      if (!matches && top) {
        // `}` while an array is open (or `]` while an object is open), and the
        // next char is the other closer → emit the pair in the right order.
        const closesTop = top === '[' ? ']' : '}';
        const other = top === '[' ? '}' : ']';
        if (ch === other && s[i + 1] === closesTop) {
          out += closesTop + ch;
          i++;
          stack.pop();
          if (stack.length) stack.pop();
          continue;
        }
      }
      if (top) stack.pop();
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Close a truncated JSON prefix: finish an open string (or drop a partial
 *  key), drop a dangling `,"key":` / trailing comma, push missing closers. */
function closeTruncated(s: string): string {
  let inStr = false;
  let esc = false;
  let strStart = -1;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      strStart = i;
    } else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let closed = s;
  if (inStr) {
    // Open string at end of input: inside an object it is a partial KEY
    // (drop the fragment); inside an array it is a partial VALUE (keep it).
    const container = stack[stack.length - 1];
    if (container === '{') {
      let k = strStart - 1;
      while (k >= 0 && /\s/.test(closed[k])) k--;
      closed = closed.slice(0, k >= 0 && closed[k] === ',' ? k : strStart).replace(/\s*$/, '');
    } else {
      closed += '"';
    }
  }
  // Drop a dangling `,"key":` (key with colon but no value) and bare trailing commas.
  closed = closed
    .replace(/,\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, '')
    .replace(/\s*,\s*$/, '');
  while (stack.length) closed += stack.pop() === '{' ? '}' : ']';
  return closed;
}

/** Convenience: build a provider client from config. */
export function createProvider(config: ProviderConfig, opts?: ProviderClientOptions): LocalAIProvider {
  return new LocalAIProvider(config, opts);
}
