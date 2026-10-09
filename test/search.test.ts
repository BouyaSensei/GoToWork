import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManualPostings, detectRequiredSeniority } from '../src/shared/manualPostings';
import { SearchRunManager } from '../src/main/search/runManager';
import type { Application, JobPosting, MatchScore, SearchRun } from '../src/shared/types';

test('parseManualPostings parses titled blocks', () => {
  const blob = [
    'Senior Frontend Dev | Acme Corp | Paris | https://acme.dev/jobs/1',
    'React, TypeScript, 5 years of experience. Docker, AWS.',
    '',
    'Junior Backend | StartupX | Remote | https://sx.io/jobs/2',
    'Python, FastAPI, PostgreSQL.'
  ].join('\n');

  const posts = parseManualPostings(blob);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, 'Senior Frontend Dev');
  assert.equal(posts[0].company, 'Acme Corp');
  assert.equal(posts[0].location, 'Paris');
  assert.equal(posts[0].url, 'https://acme.dev/jobs/1');
  assert.equal(posts[0].requiredSeniority, 'senior');
  assert.equal(posts[1].remote, true);
  assert.equal(posts[1].requiredSeniority, 'junior');
});

test('parseManualPostings handles a single untitled block', () => {
  const posts = parseManualPostings('Just a description line with no header.');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].title.length > 0);
});

test('detectRequiredSeniority maps keywords to bands', () => {
  assert.equal(detectRequiredSeniority('Staff Engineer'), 'lead');
  assert.equal(detectRequiredSeniority('Senior Dev'), 'senior');
  assert.equal(detectRequiredSeniority('Débutant stagiaire'), 'junior');
  assert.equal(detectRequiredSeniority('Mid-level developer'), 'mid');
});

/* --------------------------- run manager -------------------------- */

function job(title: string, seniority: JobPosting['requiredSeniority']): JobPosting {
  return {
    id: `j_${title}`, title, company: 'Acme', location: 'Paris', remote: false,
    requiredSeniority: seniority, url: 'https://x', source: 'test', description: title
  };
}

function match(id: string, score: number, eligible: boolean): MatchScore {
  return { jobId: id, score, seniorityFit: 'mid', skillMatches: [], skillGaps: [], reasons: [], eligibleForAutoApply: eligible };
}

test('basic mode surfaces results but never applies', async () => {
  const applied: string[] = [];
  const mgr = new SearchRunManager('q', 'basic', {
    search: async () => [job('A', 'junior')],
    apply: async (j) => { applied.push(j.id); return {} as Application; }
  });
  mgr.setMatches([match('j_A', 0.9, false)]);
  const run = await mgr.execute();
  assert.equal(run.status, 'done');
  assert.equal(applied.length, 0);
});

test('total mode auto-applies only to eligible jobs', async () => {
  const applied: string[] = [];
  const mgr = new SearchRunManager('q', 'total', {
    search: async () => [job('Good', 'junior'), job('Bad', 'lead')],
    apply: async (j) => { applied.push(j.id); return {} as Application; }
  });
  mgr.setMatches([match('j_Good', 0.9, true), match('j_Bad', 0.3, false)]);
  const run = await mgr.execute();
  assert.equal(run.status, 'done');
  assert.deepEqual(applied, ['j_Good']);
  assert.equal(run.appliedJobIds.length, 1);
});

test('hybrid mode blocks on approval and respects the decision', async () => {
  const applied: string[] = [];
  let statusSeen: SearchRun['status'] | null = null;
  const mgr = new SearchRunManager('q', 'hybrid', {
    search: async () => [job('H', 'junior')],
    apply: async (j) => { applied.push(j.id); return {} as Application; },
    requestApproval: async (j) => {
      statusSeen = 'awaiting-approval';
      // Simulate the user approving after a tick.
      await new Promise((r) => setTimeout(r, 5));
      return true;
    },
    onStatus: (run) => { if (run.status === 'awaiting-approval') statusSeen = run.status; }
  });
  mgr.setMatches([match('j_H', 0.8, true)]);
  const run = await mgr.execute();
  assert.equal(run.status, 'done');
  assert.deepEqual(applied, ['j_H']);
  assert.equal(statusSeen, 'awaiting-approval');
});

test('a failing apply is logged and does not abort the run', async () => {
  const mgr = new SearchRunManager('q', 'total', {
    search: async () => [job('X', 'junior')],
    apply: async () => { throw new Error('network down'); }
  });
  mgr.setMatches([match('j_X', 0.9, true)]);
  const run = await mgr.execute();
  assert.equal(run.status, 'done'); // completed, with an error logged for that job
  assert.ok(run.log.some((l) => l.level === 'error'));
});
