import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeATS } from '../src/main/cv/ats';
import type { ParsedCV } from '../src/shared/types';

function makeCv(over: Partial<ParsedCV> = {}): ParsedCV {
  return {
    sourceFile: 'cv.txt',
    rawText: 'Axel Pierre\naxel@example.com\n+33 6 12 34 56 78\nhttps://linkedin.com/in/axel\nParis, France\n\nSummary\nFrontend developer with 5 years of experience.\n\nExperience\nSenior Frontend Developer at Acme, 2021-2024. Built React apps.\n\nEducation\nMaster in Computer Science, 2020.\n\nSkills\nTypeScript, React, Node.js, GraphQL, Docker, AWS, PostgreSQL, CSS, HTML, Vite, Jest, Tailwind',
    contact: { email: 'axel@example.com', phone: '+33 6 12 34 56 78', linkedin: 'https://linkedin.com/in/axel', location: 'Paris, France' },
    sections: { experience: '...', education: '...', skills: '...' },
    seniority: 'mid',
    estimatedYearsOfExperience: 5,
    skills: ['typescript', 'react', 'node.js', 'graphql', 'docker', 'aws', 'postgresql', 'css', 'html', 'vite', 'jest', 'tailwind'],
    title: 'Frontend Developer',
    ...over
  };
}

test('a well-formed CV scores high across all systems', () => {
  const report = analyzeATS(makeCv());
  assert.ok(report.aggregateScore >= 0.7, `expected >=0.7, got ${report.aggregateScore}`);
  for (const sys of report.perSystem) {
    assert.ok(sys.overallScore >= 0.6, `${sys.system} too low: ${sys.overallScore}`);
  }
});

test('a CV missing contact info scores lower', () => {
  const poor = makeCv({
    contact: {},
    rawText: 'Just some text without proper structure and only a couple of words here and there to pad the length a bit.'
  });
  const report = analyzeATS(poor);
  const good = analyzeATS(makeCv());
  assert.ok(report.aggregateScore < good.aggregateScore, 'poor CV should score lower');
});

test('report has all 8 ATS systems', () => {
  const report = analyzeATS(makeCv());
  assert.equal(report.perSystem.length, 8);
  const names = new Set(report.perSystem.map((s) => s.system));
  assert.ok(names.has('Workday'));
  assert.ok(names.has('Greenhouse'));
});

test('recommendations are produced for a weak CV', () => {
  const poor = makeCv({ contact: {}, skills: [] });
  const report = analyzeATS(poor);
  assert.ok(report.recommendations.length > 0);
  assert.ok(report.topIssues.length > 0);
});
