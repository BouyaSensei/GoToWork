import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSampleCvBundle, detectJobFamily } from '../src/main/cv/sampleCv';
import type { ParsedCV } from '../src/shared/types';

/** Build a ParsedCV with sensible defaults + overrides. */
function cv(partial: Partial<ParsedCV> & { rawText: string }): ParsedCV {
  return {
    sourceFile: 'cv.txt',
    contact: {},
    sections: {},
    seniority: 'mid',
    estimatedYearsOfExperience: 5,
    skills: [],
    ...partial
  };
}

const juniorFrontend = cv({
  title: 'Développeur Frontend Junior',
  seniority: 'junior',
  estimatedYearsOfExperience: 1,
  skills: ['html', 'css', 'javascript', 'react'],
  rawText: [
    'Axel Pierre',
    'Développeur Frontend Junior',
    'Paris, France',
    '',
    'Profil',
    "Jeune développeur frontend motivé, à l'aise avec HTML, CSS et JavaScript.",
    '',
    'Expérience',
    'Stage développeur (2024)',
    "• Participe au développement d'interfaces en HTML, CSS et JavaScript."
  ].join('\n')
});

const seniorFrontend = cv({
  title: 'Développeur Frontend Senior',
  seniority: 'senior',
  estimatedYearsOfExperience: 8,
  skills: ['html', 'css', 'javascript', 'react', 'typescript', 'next.js', 'tailwind', 'jest', 'cypress', 'system design', 'graphql'],
  rawText: [
    'Axel Pierre',
    'Développeur Frontend Senior',
    'Paris, France',
    '',
    'Profil',
    "Développeur frontend senior, plus de 6 ans d'expérience. J'architecte des solutions et je mentore l'équipe.",
    '',
    'Expérience',
    'Lead technique (2019–présent)',
    "• Pilote la conception d'architecture React pour une plateforme utilisée par des milliers d'utilisateurs.",
    "• Réduit le temps de chargement de 40 % et les coûts d'infrastructure de 30 %.",
    '• Livrée en 6 semaines, deux fois plus rapide que la version précédente.',
    "• Mentore quatre développeurs juniors et anime les revues de code."
  ].join('\n')
});

/* --------------------------- job family detection ------------------ */

test('detects the job family from the title', () => {
  assert.equal(detectJobFamily(juniorFrontend).label, 'Développeur Frontend');
  assert.equal(
    detectJobFamily(cv({ title: 'Développeur Full-Stack', rawText: '' })).label,
    'Développeur Full-Stack' // full-stack must beat frontend/backend
  );
  assert.equal(detectJobFamily(cv({ title: 'Développeur Backend', rawText: '' })).label, 'Développeur Backend');
});

test('falls back to skill overlap when there is no title', () => {
  const data = cv({ title: '', skills: ['python', 'machine learning', 'pytorch'], rawText: '' });
  assert.equal(detectJobFamily(data).label, 'Ingénieur Data / IA');
  // Unknown/empty profile falls back to the general field.
  assert.equal(detectJobFamily(cv({ title: '', skills: [], rawText: '' })).label, 'Développeur Logiciel');
});

/* --------------------------- bundle shape -------------------------- */

test('produces three same-field samples ordered junior → mid → senior', () => {
  const b = buildSampleCvBundle(juniorFrontend);
  assert.equal(b.jobFamily, 'Développeur Frontend');
  assert.deepEqual(b.samples.map((s) => s.level), ['junior', 'mid', 'senior']);
  for (const s of b.samples) {
    assert.equal(s.jobFamily, 'Développeur Frontend'); // same field everywhere
    assert.ok(s.rawText.length > 100);
    assert.ok(s.skills.length >= 3);
  }
});

test('skill ladders are cumulative (senior ⊇ mid ⊇ junior)', () => {
  const b = buildSampleCvBundle(juniorFrontend);
  const [junior, mid, senior] = b.samples;
  const midSet = new Set(mid.skills);
  const seniorSet = new Set(senior.skills);
  for (const s of junior.skills) assert.ok(midSet.has(s), `mid should include ${s}`);
  for (const s of mid.skills) assert.ok(seniorSet.has(s), `senior should include ${s}`);
});

/* ------------------------------ verdicts --------------------------- */

test('a junior CV is below the senior bar but not below the junior bar', () => {
  const b = buildSampleCvBundle(juniorFrontend);
  const senior = b.comparisons.find((c) => c.level === 'senior')!;
  const junior = b.comparisons.find((c) => c.level === 'junior')!;
  assert.equal(senior.verdict, 'below');
  assert.notEqual(junior.verdict, 'below'); // at or above its own level
});

test('a strong senior CV is at/above the senior bar and above junior', () => {
  const b = buildSampleCvBundle(seniorFrontend);
  const senior = b.comparisons.find((c) => c.level === 'senior')!;
  const junior = b.comparisons.find((c) => c.level === 'junior')!;
  assert.notEqual(senior.verdict, 'below');
  assert.equal(junior.verdict, 'above');
});

/* --------------------------- skill coverage ------------------------ */

test('skill coverage splits present vs missing within the field ladder', () => {
  const b = buildSampleCvBundle(juniorFrontend);
  const junior = b.comparisons.find((c) => c.level === 'junior')!;
  // Frontend junior expects html, css, javascript, react — all present here.
  assert.deepEqual([...junior.skillCoverage.present].sort(), ['css', 'html', 'javascript', 'react']);
  assert.equal(junior.skillCoverage.missing.length, 0);

  const senior = b.comparisons.find((c) => c.level === 'senior')!;
  // The junior CV lacks the senior-only skills.
  assert.ok(senior.skillCoverage.missing.includes('typescript'));
  assert.ok(senior.skillCoverage.missing.length >= 4);
});

/* --------------------------- actionable output --------------------- */

test('every comparison carries non-empty gaps, strengths and next steps', () => {
  for (const source of [juniorFrontend, seniorFrontend]) {
    const b = buildSampleCvBundle(source);
    for (const c of b.comparisons) {
      assert.ok(c.gaps.length >= 1, 'gaps should not be empty');
      assert.ok(c.strengths.length >= 1, 'strengths should not be empty');
      assert.ok(c.nextSteps.length >= 1, 'next steps should not be empty');
      assert.ok(c.dimensions.length === 5);
      for (const d of c.dimensions) {
        assert.ok(d.score >= 0 && d.score <= 1, `dimension ${d.id} in [0,1]`);
      }
    }
  }
});
