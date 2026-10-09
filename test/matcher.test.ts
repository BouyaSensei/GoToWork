import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchJobs } from '../src/main/search/matcher';
import type { JobPosting, ParsedCV, SearchMode } from '../src/shared/types';

function juniorCv(): ParsedCV {
  return {
    sourceFile: 'cv.txt',
    rawText: 'Junior developer, 1 year of experience.',
    contact: {},
    sections: {},
    seniority: 'junior',
    estimatedYearsOfExperience: 1,
    skills: ['react', 'typescript', 'html', 'css']
  };
}

function posting(title: string, desc: string): JobPosting {
  return {
    id: `j_${title}`,
    title,
    company: 'Acme',
    location: 'Paris',
    remote: false,
    requiredSeniority: 'mid',
    url: 'https://x',
    source: 'test',
    description: desc
  };
}

test('a junior CV is NEVER eligible for auto-apply to a senior role (any mode)', () => {
  const job = posting('Senior Frontend Engineer', 'Senior React TypeScript engineer, 5+ years. Docker, AWS.');
  job.requiredSeniority = 'senior';
  for (const mode of ['basic', 'hybrid', 'total'] as SearchMode[]) {
    const [m] = matchJobs(juniorCv(), [job], { mode });
    assert.equal(m.eligibleForAutoApply, false, `mode=${mode} should not auto-apply junior→senior`);
  }
});

test('a junior CV CAN be eligible for a junior role in total mode', () => {
  const job = posting('Junior Frontend Developer', 'Junior React TypeScript developer. HTML, CSS.');
  job.requiredSeniority = 'junior';
  const [m] = matchJobs(juniorCv(), [job], { mode: 'total' });
  assert.equal(m.eligibleForAutoApply, true);
});

test('basic mode never marks anything eligible for auto-apply', () => {
  const job = posting('Junior Frontend Developer', 'React TypeScript. HTML, CSS.');
  job.requiredSeniority = 'junior';
  const [m] = matchJobs(juniorCv(), [job], { mode: 'basic' });
  assert.equal(m.eligibleForAutoApply, false);
});

test('skill matches and gaps are computed', () => {
  const job = posting('Frontend Dev', 'React TypeScript CSS. Also wants Docker.');
  job.requiredSeniority = 'junior';
  const [m] = matchJobs(juniorCv(), [job], { mode: 'hybrid' });
  assert.ok(m.skillMatches.includes('react'));
  assert.ok(m.skillGaps.includes('docker'));
});

test('higher seniority gap lowers the score', () => {
  const junior = posting('Junior Dev', 'React TypeScript.');
  junior.requiredSeniority = 'junior';
  const lead = posting('Lead Engineer', 'React TypeScript, architecture, team leadership.');
  lead.requiredSeniority = 'lead';
  const [mj] = matchJobs(juniorCv(), [junior], { mode: 'basic' });
  const [ml] = matchJobs(juniorCv(), [lead], { mode: 'basic' });
  assert.ok(mj.score > ml.score, `match (${mj.score}) should beat lead gap (${ml.score})`);
});
