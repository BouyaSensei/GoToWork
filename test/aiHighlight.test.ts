import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCvHighlightPrompt, parseCvHighlights } from '../src/main/cv/aiHighlight';
import type { ParsedCV } from '../src/shared/types';

const CV_TEXT =
  'Axel Pierre\nDéveloppeur Frontend\nTel : 06 12 34\nExpérience: développeur web depuis 2019, très bon en tout.\nCompétences: React, TypeScript';

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

test('buildCvHighlightPrompt embeds the CV and demands verbatim matches', () => {
  const prompt = buildCvHighlightPrompt(cvWith(CV_TEXT));
  assert.ok(prompt.includes('Axel Pierre'));
  assert.ok(prompt.includes('"highlights"'));
  assert.ok(prompt.includes('COPIÉ COLLÉ'));
  assert.ok(prompt.includes('critical'));
});

test('parseCvHighlights parses clean JSON anchored in the CV', () => {
  const r = parseCvHighlights(
    JSON.stringify({
      highlights: [
        { match: 'très bon en tout', severity: 'critical', note: 'Allégation vague sans chiffre' },
        { match: 'React, TypeScript', severity: 'improvement', note: 'Ajouter des niveaux' }
      ]
    }),
    CV_TEXT
  );
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    match: 'très bon en tout',
    severity: 'critical',
    note: 'Allégation vague sans chiffre'
  });
  assert.equal(r[1].severity, 'improvement');
});

test('parseCvHighlights drops matches not found verbatim in the CV (hallucination guard)', () => {
  const r = parseCvHighlights(
    JSON.stringify({
      highlights: [
        { match: 'très bon en tout', severity: 'critical', note: 'vague' },
        { match: 'compétences en Ruby inexistantes', severity: 'critical', note: 'inventé' }
      ]
    }),
    CV_TEXT
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].match, 'très bon en tout');
});

test('parseCvHighlights normalizes severity variants; unknown becomes improvement', () => {
  const r = parseCvHighlights(
    JSON.stringify({
      highlights: [
        { match: 'Tel : 06 12 34', severity: 'critique', note: 'numéro incomplet' },
        { match: 'React, TypeScript', severity: 'quelque chose', note: '?' }
      ]
    }),
    CV_TEXT
  );
  assert.equal(r[0].severity, 'critical');
  assert.equal(r[1].severity, 'improvement');
});

test('parseCvHighlights drops items without a usable match and caps the list', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    match: i % 2 === 0 ? 'React' : 'TypeScript',
    severity: 'improvement',
    note: `n${i}`
  }));
  const r = parseCvHighlights(
    JSON.stringify({ highlights: [...many, { severity: 'critical', note: 'sans match' }, null] }),
    CV_TEXT
  );
  assert.ok(r.length <= 15);
});

test('parseCvHighlights recovers fenced JSON with a prose prefix', () => {
  const raw =
    "Voici les points :\n```json\n" +
    '{"highlights":[{"match":"très bon en tout","severity":"critical","note":"vague"}]}' +
    '\n```';
  const r = parseCvHighlights(raw, CV_TEXT);
  assert.equal(r.length, 1);
  assert.equal(r[0].severity, 'critical');
});

test('parseCvHighlights throws on garbage with a snippet of the raw output', () => {
  try {
    parseCvHighlights('aucun json ici du tout', CV_TEXT);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match((e as Error).message, /illisible/);
    assert.ok((e as Error).message.includes('aucun json ici'));
  }
});
