/**
 * Job matching engine.
 *
 * Scores a parsed CV against each job posting and decides, per posting, whether
 * it is eligible for auto-application under the active search mode. The key
 * safeguard is seniority gating: a junior CV is never marked eligible for a
 * senior/lead role, which is exactly the failure the user wants to avoid
 * ("posting sur une offre senior alors que l'utilisateur est débutant").
 *
 * Scoring blends three signals:
 *   1. Skill overlap (Jaccard-ish, weighted by how central each skill is).
 *   2. Seniority fit (a band-distance penalty; large gaps drop eligibility).
 *   3. Title/role affinity (keyword overlap between CV title and posting title).
 */

import type { JobPosting, MatchScore, ParsedCV, SearchMode, SeniorityBand } from '../../shared/types';

const SENIORITY_ORDER: Record<SeniorityBand, number> = { junior: 0, mid: 1, senior: 2, lead: 3 };

/** Maximum band gap we will still consider (junior→senior = 2 is allowed to
 * appear in results but NOT eligible for auto-apply). */
const AUTO_APPLY_MAX_GAP = 1;

export interface MatchOptions {
  mode: SearchMode;
}

export function matchJobs(cv: ParsedCV, jobs: JobPosting[], opts: MatchOptions): MatchScore[] {
  return jobs.map((job) => scoreOne(cv, job, opts.mode));
}

function scoreOne(cv: ParsedCV, job: JobPosting, mode: SearchMode): MatchScore {
  const cvSkills = new Set(cv.skills.map((s) => s.toLowerCase()));
  const jobSkills = extractJobSkills(job);

  const matched = jobSkills.filter((s) => cvSkills.has(s));
  const gaps = jobSkills.filter((s) => !cvSkills.has(s));

  // 1. Skill overlap (0..1). We weight by coverage of the job's required skills.
  const skillScore = jobSkills.length === 0 ? 0.5 : matched.length / jobSkills.length;

  // 2. Seniority fit.
  const cvBand = SENIORITY_ORDER[cv.seniority];
  const reqBand = SENIORITY_ORDER[job.requiredSeniority];
  const bandGap = Math.abs(cvBand - reqBand);
  const seniorityScore = bandGap === 0 ? 1 : bandGap === 1 ? 0.6 : 0.25;

  // 3. Title affinity.
  const titleScore = titleAffinity(cv.title ?? '', job.title);

  // Blend: skills 55%, seniority 30%, title 15%.
  const score = round3(0.55 * skillScore + 0.3 * seniorityScore + 0.15 * titleScore);

  // Eligibility for auto-apply depends on mode + seniority gap + overall fit.
  const eligibleForAutoApply = isEligible(score, bandGap, mode);

  const reasons: string[] = [];
  if (bandGap > AUTO_APPLY_MAX_GAP) {
    reasons.push(`Seniority mismatch: you are ${cv.seniority}, role requires ${job.requiredSeniority}.`);
  } else if (bandGap === 0) {
    reasons.push(`Seniority is a direct match (${cv.seniority}).`);
  }
  if (matched.length > 0) reasons.push(`Skills matched: ${matched.slice(0, 6).join(', ')}.`);
  if (gaps.length > 0 && gaps.length <= 4) reasons.push(`Missing skills: ${gaps.join(', ')}.`);
  if (score >= 0.75) reasons.push('Strong overall fit.');
  else if (score < 0.4) reasons.push('Weak fit — likely not worth applying.');

  return {
    jobId: job.id,
    score,
    seniorityFit: effectiveBand(cv.seniority, job.requiredSeniority),
    skillMatches: matched,
    skillGaps: gaps,
    reasons,
    eligibleForAutoApply
  };
}

function isEligible(
  score: number,
  bandGap: number,
  mode: SearchMode
): boolean {
  // Hard gate: never auto-apply across a big seniority gap in ANY mode.
  if (bandGap > AUTO_APPLY_MAX_GAP) return false;

  switch (mode) {
    case 'basic':
      // Basic mode only surfaces recommendations; it never auto-applies.
      return false;
    case 'hybrid':
      // Hybrid reaches the apply link but requires user confirmation, so
      // "eligible" here means "worth presenting for approval".
      return score >= 0.5 && bandGap <= AUTO_APPLY_MAX_GAP;
    case 'total':
      // Total mode auto-applies only to strong, seniority-matched fits.
      return score >= 0.65 && bandGap === 0;
  }
}

function effectiveBand(cv: SeniorityBand, req: SeniorityBand): SeniorityBand {
  // Report the band we'd be applying under (the lower of the two is honest).
  return SENIORITY_ORDER[cv] <= SENIORITY_ORDER[req] ? cv : req;
}

function titleAffinity(cvTitle: string, jobTitle: string): number {
  if (!cvTitle) return 0.3;
  const a = tokenize(cvTitle);
  const b = tokenize(jobTitle);
  if (a.length === 0 || b.length === 0) return 0.3;
  let overlap = 0;
  for (const t of a) if (b.includes(t)) overlap++;
  return overlap / Math.max(a.length, b.length);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set(['and', 'the', 'for', 'with', 'senior', 'junior', 'lead', 'staff', 'principal']);

/** Mine skills from a posting's description using the same vocabulary idea as the parser. */
function extractJobSkills(job: JobPosting): string[] {
  const text = `${job.title}\n${job.description}`.toLowerCase();
  // A compact, high-signal skill list for job postings.
  const vocab = [
    'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'c++', 'c#', 'php',
    'react', 'next.js', 'vue', 'angular', 'svelte', 'node.js', 'electron', 'express',
    'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'git', 'ci/cd',
    'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'grpc', 'sql',
    'linux', 'bash', 'kafka', 'elasticsearch', 'machine learning', 'pytorch', 'tensorflow',
    'ui/ux', 'html', 'css', 'tailwind', 'vite', 'jest', 'cypress', 'microservices'
  ];
  return vocab.filter((s) => {
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
