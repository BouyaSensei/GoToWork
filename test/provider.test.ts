import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../src/main/ai/provider';
import type { ProviderConfig } from '../src/shared/types';
import { LocalAIProvider } from '../src/main/ai/provider';

test('extractJson parses clean JSON', () => {
  const out = extractJson<{ a: number }>('{"a": 42}');
  assert.deepEqual(out, { a: 42 });
});

test('extractJson strips markdown fences', () => {
  const out = extractJson<{ b: string }>('```json\n{"b":"x"}\n```');
  assert.deepEqual(out, { b: 'x' });
});

test('extractJson recovers object from prose', () => {
  const raw = 'Sure! Here is the result:\n{"score": 0.8, "ok": true}\nLet me know.';
  const out = extractJson<{ score: number; ok: boolean }>(raw);
  assert.deepEqual(out, { score: 0.8, ok: true });
});

test('extractJson handles nested objects and strings with braces', () => {
  const raw = 'result: {"outer": {"inner": "a}b"}, "n": 3} done';
  const out = extractJson<Record<string, unknown>>(raw);
  assert.ok(out);
  assert.equal((out as { n: number }).n, 3);
});

test('extractJson returns null on garbage', () => {
  assert.equal(extractJson('no json here'), null);
});

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}

test('LocalAIProvider.complete returns content from a mock server', async () => {
  const cfg: ProviderConfig = {
    id: 'p1', kind: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'm', enabled: true
  };
  const provider = new LocalAIProvider(cfg, {
    fetchImpl: fakeFetch({ choices: [{ message: { content: '  hello world ' } }] })
  });
  const out = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out, 'hello world');
});

test('LocalAIProvider.resolveEndpoint is idempotent on /v1', async () => {
  const cfg: ProviderConfig = {
    id: 'p2', kind: 'lmstudio', label: 'LM', baseUrl: 'http://localhost:1234/v1', model: 'm', enabled: true
  };
  const provider = new LocalAIProvider(cfg, {
    fetchImpl: fakeFetch({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
  });
  const health = await provider.health();
  assert.equal(health.reachable, true);
  assert.deepEqual(health.models, ['model-a', 'model-b']);
});

test('LocalAIProvider.completeJson parses fenced JSON from model output', async () => {
  const cfg: ProviderConfig = {
    id: 'p3', kind: 'openai-compatible', label: 'X', baseUrl: 'http://x', model: 'm', enabled: true
  };
  const provider = new LocalAIProvider(cfg, {
    fetchImpl: fakeFetch({ choices: [{ message: { content: '```json\n{"pass": true}\n```' } }] })
  });
  const out = await provider.completeJson<{ pass: boolean }>({ messages: [{ role: 'user', content: 'x' }] });
  assert.deepEqual(out, { pass: true });
});
