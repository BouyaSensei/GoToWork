import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { AppService } from '../src/main/service';
import type { ProviderConfig } from '../src/shared/types';

async function makeService(): Promise<AppService> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gotowork-test-'));
  const service = new AppService({ userDataDir: dir });
  await service.init();
  return service;
}

function provider(over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'p1',
    kind: 'ollama',
    label: 'Ollama (test)',
    baseUrl: 'http://127.0.0.1:9/v1', // port 9 (discard): nothing listens there
    model: 'test-model',
    enabled: true,
    ...over
  };
}

test('activeProviderHealth returns null when no provider is configured', async () => {
  const service = await makeService();
  assert.equal(await service.activeProviderHealth(), null);
});

test('activeProviderHealth returns null when the active provider is disabled', async () => {
  const service = await makeService();
  await service.saveProvider(provider({ enabled: false }));
  assert.equal(await service.activeProviderHealth(), null);
});

test('activeProviderHealth reports unreachable for a dead endpoint', async () => {
  const service = await makeService();
  await service.saveProvider(provider());
  const health = await service.activeProviderHealth();
  assert.ok(health, 'expected a health report, not null');
  assert.equal(health!.reachable, false);
});

function cvWith(text: string) {
  return {
    sourceFile: 'cv.txt',
    rawText: text,
    contact: {},
    sections: {},
    seniority: 'mid' as const,
    estimatedYearsOfExperience: 5,
    skills: ['react'],
    title: 'Développeur Frontend'
  };
}

test('aiReviewCv returns null when no provider is configured', async () => {
  const service = await makeService();
  assert.equal(await service.aiReviewCv(cvWith('Axel Pierre')), null);
});

test('aiReviewCv surfaces the failure reason for a dead endpoint', async () => {
  const service = await makeService();
  await service.saveProvider(provider());
  const outcome = await service.aiReviewCv(cvWith('Axel Pierre'));
  assert.ok(outcome, 'expected an outcome, not null');
  assert.equal(outcome!.ok, false);
  assert.match((outcome as { error: string }).error, /Network error/);
});
