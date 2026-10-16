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

test('parseCvAiReport repairs unescaped inner quotes', () => {
  const r = parseCvAiReport(
    '{"verdict": "Un CV avec une "bonne" structure", "strengths": ["a"], "weaknesses": [], "recommendations": []}'
  );
  assert.equal(r.verdict, 'Un CV avec une "bonne" structure');
  assert.deepEqual(r.strengths, ['a']);
});

test('parseCvAiReport repairs trailing commas', () => {
  const r = parseCvAiReport(
    '{"verdict": "OK", "strengths": ["a", "b",], "weaknesses": [], "recommendations": [],}'
  );
  assert.equal(r.verdict, 'OK');
  assert.deepEqual(r.strengths, ['a', 'b']);
});

test('parseCvAiReport recovers a truncated report by closing open structures', () => {
  const r = parseCvAiReport('{"verdict": "CV partiel", "strengths": ["a", "b"');
  assert.equal(r.verdict, 'CV partiel');
  assert.deepEqual(r.strengths, ['a', 'b']);
});

test('parseCvAiReport drops a partial key left dangling by truncation', () => {
  const r = parseCvAiReport('{"verdict": "CV partiel", "strengths": ["a"], "weakne');
  assert.equal(r.verdict, 'CV partiel');
  assert.deepEqual(r.strengths, ['a']);
});

test('parseCvAiReport error includes a snippet of the raw output', () => {
  try {
    parseCvAiReport('totalement illisible sans aucune accolade');
    assert.fail('should have thrown');
  } catch (e) {
    assert.match((e as Error).message, /illisible/);
    assert.ok((e as Error).message.includes('totalement illisible'));
  }
});

test('parseCvAiReport reads the extended sections (ATS, role, seniority, skill groups)', () => {
  const r = parseCvAiReport(
    JSON.stringify({
      verdict: 'CV solide.',
      atsScore: 72,
      atsComment: 'Structure lisible, section compétences claire.',
      role: 'Développeur Full Stack',
      seniority: 'mid (4 ans)',
      skillGroups: [
        { cat: 'Frontend', items: ['React', 'TypeScript'] },
        { cat: 'Backend', items: ['Node.js'] }
      ],
      strengths: ['a'],
      weaknesses: ['b'],
      recommendations: ['c']
    })
  );
  assert.equal(r.atsScore, 72);
  assert.equal(r.role, 'Développeur Full Stack');
  assert.equal(r.seniority, 'mid (4 ans)');
  assert.deepEqual(r.skillGroups, [
    { cat: 'Frontend', items: ['React', 'TypeScript'] },
    { cat: 'Backend', items: ['Node.js'] }
  ]);
});

test('parseCvAiReport clamps atsScore and tolerates missing extended fields', () => {
  const r = parseCvAiReport(
    JSON.stringify({ verdict: 'OK', atsScore: 140, strengths: ['a'], weaknesses: [], recommendations: [] })
  );
  assert.equal(r.atsScore, 100);
  assert.equal(r.role, '');
  assert.deepEqual(r.skillGroups, []);

  const r2 = parseCvAiReport(
    JSON.stringify({ verdict: 'OK', atsScore: 'non-numérique', strengths: [], weaknesses: [], recommendations: [] })
  );
  assert.equal(r2.atsScore, 0);
});

test('parseCvAiReport falls back to a flat skills list as one group', () => {
  const r = parseCvAiReport(
    JSON.stringify({ verdict: 'OK', skills: ['React', 'SQL'], strengths: [], weaknesses: [], recommendations: [] })
  );
  assert.deepEqual(r.skillGroups, [{ cat: 'Compétences', items: ['React', 'SQL'] }]);
});

test('parseCvAiReport tolerates skill-group key variants and drops empty groups', () => {
  const r = parseCvAiReport(
    JSON.stringify({
      verdict: 'OK',
      skillGroups: [
        { category: 'IA', skills: ['LLM locaux'] },
        { cat: 'Vide', items: [] },
        'pas un objet'
      ],
      strengths: [], weaknesses: [], recommendations: []
    })
  );
  assert.deepEqual(r.skillGroups, [{ cat: 'IA', items: ['LLM locaux'] }]);
});
