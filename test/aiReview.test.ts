import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCvAiPrompt, parseCvAiReport } from '../src/main/cv/aiReview';
import type { ParsedCV } from '../src/shared/types';

function cvWith(text: string): ParsedCV {
  return {
    sourceFile: 'cv.txt',
    rawText: text,
    contact: {},
    sections: {},
    seniority: 'mid',
    estimatedYearsOfExperience: 5,
    skills: ['react', 'typescript'],
    title: 'Développeur Frontend'
  };
}

test('buildCvAiPrompt embeds the CV content and demands strict JSON', () => {
  const prompt = buildCvAiPrompt(cvWith('Axel Pierre\nFrontend Developer.'));
  assert.ok(prompt.includes('Axel Pierre'));
  assert.ok(prompt.includes('Développeur Frontend'));
  assert.ok(prompt.includes('"verdict"'));
  assert.ok(prompt.includes('JSON'));
});

test('parseCvAiReport parses clean JSON', () => {
  const r = parseCvAiReport(
    JSON.stringify({ verdict: 'CV solide.', strengths: ['a'], weaknesses: ['b'], recommendations: ['c'] })
  );
  assert.equal(r.verdict, 'CV solide.');
  assert.deepEqual(r.strengths, ['a']);
  assert.deepEqual(r.recommendations, ['c']);
});

test('parseCvAiReport recovers JSON from fenced + prose output', () => {
  const raw =
    "Voici l'analyse :\n```json\n" +
    '{"verdict":"OK","strengths":["x"],"weaknesses":[],"recommendations":[]}' +
    '\n```\nBonne chance !';
  const r = parseCvAiReport(raw);
  assert.equal(r.verdict, 'OK');
  assert.deepEqual(r.strengths, ['x']);
});

test('parseCvAiReport throws on garbage', () => {
  assert.throws(() => parseCvAiReport('aucun json ici'));
});

test('parseCvAiReport throws when the verdict is missing', () => {
  assert.throws(() => parseCvAiReport(JSON.stringify({ strengths: ['a'] })));
});

test('parseCvAiReport drops non-string items and caps list length', () => {
  const many = Array.from({ length: 10 }, (_, i) => `item ${i}`);
  const r = parseCvAiReport(
    JSON.stringify({ verdict: 'OK', strengths: [...many, 42, null], weaknesses: [], recommendations: [] })
  );
  assert.equal(r.strengths.length, 6);
});
