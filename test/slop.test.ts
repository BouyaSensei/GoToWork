import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSlop } from '../src/main/cv/slop';
import type { ParsedCV } from '../src/shared/types';

function cvWith(text: string): ParsedCV {
  return {
    sourceFile: 'cv.txt',
    rawText: text,
    contact: {},
    sections: {},
    seniority: 'mid',
    estimatedYearsOfExperience: 5,
    skills: ['react']
  };
}

test('a clean, specific CV is rated clean', () => {
  const report = detectSlop(
    cvWith('Axel Pierre\nFrontend Developer.\nBuilt a React dashboard that cut load time by 40%.\nShipped the billing service in TypeScript and Node.js.')
  );
  assert.equal(report.verdict, 'clean');
  assert.ok(report.slopScore < 0.25);
});

test('buzzword-heavy text is flagged as sloppy', () => {
  const report = detectSlop(
    cvWith(
      'I am a results-driven team player and go-getter, passionate about synergy. ' +
        'Proven track record of success with cutting-edge, world-class solutions. ' +
        'Best-in-class fast learner who leverages robust, scalable systems.'
    )
  );
  assert.equal(report.verdict, 'sloppy');
  assert.ok(report.findings.length >= 4);
  const terms = report.findings.map((f) => f.term.toLowerCase());
  assert.ok(terms.includes('results-driven'));
  assert.ok(terms.includes('synergy'));
});

test('French AI tells are caught', () => {
  const report = detectSlop(cvWith('Développeur passionné par le code, orienté résultats, avec un fort esprit d\'équipe.'));
  assert.ok(report.findings.length >= 2);
  const terms = report.findings.map((f) => f.term.toLowerCase());
  assert.ok(terms.some((t) => t.includes('passionné')));
});

test('each finding carries an actionable suggestion', () => {
  const report = detectSlop(cvWith('results-driven team player leveraging synergy'));
  for (const f of report.findings) {
    assert.ok(f.suggestion.length > 5, 'suggestion should not be empty');
  }
});
