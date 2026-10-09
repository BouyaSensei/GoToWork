/**
 * AI-slop detector.
 *
 * Scores how "AI-generated" a CV reads by hunting for the tell-tale markers of
 * LLM prose: buzzword stacks, hollow adjectives, over-claims, vague verbs and
 * em-dash/emoji formatting tics. The goal is the opposite of the ATS engine —
 * a high score here is BAD. A human-written CV should land in the "clean" band.
 *
 * The lexicon is curated to catch both English and French AI tells (the user's
 * CVs are in French), and each finding carries an actionable rewrite suggestion.
 */

import type { ParsedCV, SlopFinding, SlopReport } from '../../shared/types';

interface LexEntry {
  term: string;
  category: SlopFinding['category'];
  severity: SlopFinding['severity'];
  suggestion: string;
  /** Optional: only flag when this co-occurs (for weak single words). */
  requiresContext?: boolean;
}

/** The curated AI-slop lexicon. Ordered roughly by how damning each is. */
const LEXICON: LexEntry[] = [
  // --- overclaims / hollow superlatives ---
  { term: 'results-driven', category: 'overclaim', severity: 'high', suggestion: 'Replace with a concrete result ("cut build time 40%").' },
  { term: 'results driven', category: 'overclaim', severity: 'high', suggestion: 'Replace with a concrete, measurable outcome.' },
  { term: 'passionate about', category: 'cliche', severity: 'medium', suggestion: 'Show it through an example instead of claiming the feeling.' },
  { term: 'team player', category: 'cliche', severity: 'medium', suggestion: 'Describe a specific collaboration, not the trait.' },
  { term: 'hard worker', category: 'cliche', severity: 'medium', suggestion: 'Evidence beats adjectives — cite a deliverable.' },
  { term: 'go-getter', category: 'cliche', severity: 'high', suggestion: 'Remove; it reads as filler.' },
  { term: 'self-starter', category: 'cliche', severity: 'medium', suggestion: 'Show initiative through an example.' },
  { term: 'fast learner', category: 'cliche', severity: 'medium', suggestion: 'Name a hard thing you learned and how fast.' },
  { term: 'detail-oriented', category: 'vague', severity: 'low', suggestion: 'Optional; only keep if backed by an example.' },
  { term: 'proven track record', category: 'overclaim', severity: 'high', suggestion: 'Cite the track record with numbers.' },
  { term: 'track record of success', category: 'overclaim', severity: 'high', suggestion: 'Replace with a specific achievement.' },

  // --- buzzword stacks ---
  { term: 'synergy', category: 'buzzword', severity: 'high', suggestion: 'Delete; corporate filler.' },
  { term: 'leverage', category: 'buzzword', severity: 'medium', suggestion: 'Use "use" unless you mean financial leverage.' },
  { term: 'streamline', category: 'buzzword', severity: 'low', suggestion: 'Say what you actually simplified.' },
  { term: 'seamless', category: 'buzzword', severity: 'medium', suggestion: 'Describe the integration concretely.' },
  { term: 'robust', category: 'buzzword', severity: 'low', suggestion: 'Explain what makes it robust (tests, scale).' },
  { term: 'scalable', category: 'buzzword', severity: 'low', suggestion: 'State the scale it handles.' },
  { term: 'cutting-edge', category: 'buzzword', severity: 'medium', suggestion: 'Name the specific technology.' },
  { term: 'state-of-the-art', category: 'buzzword', severity: 'medium', suggestion: 'Be specific about the tech.' },
  { term: 'best-in-class', category: 'overclaim', severity: 'high', suggestion: 'Remove; unverifiable superlative.' },
  { term: 'world-class', category: 'overclaim', severity: 'high', suggestion: 'Remove; unverifiable superlative.' },
  { term: 'game-changer', category: 'cliche', severity: 'high', suggestion: 'Remove; hype with no substance.' },
  { term: 'one-stop-shop', category: 'cliche', severity: 'medium', suggestion: 'Describe the capability plainly.' },

  // --- vague verbs / filler ---
  { term: 'in order to', category: 'vague', severity: 'low', suggestion: 'Use "to" — it is tighter.' },
  { term: 'utilize', category: 'vague', severity: 'low', suggestion: 'Prefer "use".' },
  { term: 'facilitate', category: 'vague', severity: 'low', suggestion: 'Say what you enabled, concretely.' },
  { term: 'implement', category: 'vague', severity: 'low', suggestion: 'Keep, but name the system it was implemented in.' },
  { term: 'responsible for', category: 'vague', severity: 'low', suggestion: 'Lead with the action ("Built…", "Led…") instead.' },
  { term: 'helped to', category: 'vague', severity: 'medium', suggestion: 'Own the outcome; drop "helped to".' },

  // --- French AI tells (user writes in French) ---
  { term: 'passionné par', category: 'cliche', severity: 'medium', suggestion: 'Montrez-le par un exemple concret.' },
  { term: 'sens de l\'équipe', category: 'cliche', severity: 'medium', suggestion: 'Décrivez une collaboration précise.' },
  { term: 'orienté résultats', category: 'overclaim', severity: 'high', suggestion: 'Remplacez par un résultat chiffré.' },
  { term: 'gourmand de challenge', category: 'cliche', severity: 'medium', suggestion: 'Montrez un défi relevé, pas le trait.' },
  { term: 'polyvalent', category: 'vague', severity: 'low', suggestion: 'Listez les compétences réelles à la place.' },
  { term: 'maîtrise des outils', category: 'vague', severity: 'low', suggestion: 'Nommez les outils précis avec un niveau.' },
  { term: 'esprit d\'équipe', category: 'cliche', severity: 'medium', suggestion: 'Exemple de collaboration > trait.' },

  // --- formatting tics (checked separately, higher weight) ---
  { term: 'em-dash-stack', category: 'formatting', severity: 'low', suggestion: 'Reduce em-dash / bullet stacking; vary sentence structure.', requiresContext: true }
];

export function detectSlop(cv: ParsedCV): SlopReport {
  const text = cv.rawText.toLowerCase();
  const findings: SlopFinding[] = [];

  for (const entry of LEXICON) {
    if (entry.term === 'em-dash-stack') continue; // handled below
    const count = countOccurrences(text, entry.term);
    if (count > 0) {
      findings.push({
        id: entry.term.replace(/\s+/g, '-'),
        category: entry.category,
        term: entry.term,
        count,
        severity: entry.severity,
        suggestion: entry.suggestion
      });
    }
  }

  // Formatting tic: many em-dashes or a wall of bullets.
  const emDashCount = (cv.rawText.match(/—/g) ?? []).length;
  if (emDashCount >= 4) {
    findings.push({
      id: 'em-dash-stack',
      category: 'formatting',
      term: `— (×${emDashCount})`,
      count: emDashCount,
      severity: 'low',
      suggestion: 'Reduce em-dash / bullet stacking; vary sentence structure.'
    });
  }

  // Weighted score. Severity weights: high=3, medium=2, low=1.
  const sevWeight: Record<SlopFinding['severity'], number> = { high: 3, medium: 2, low: 1 };
  let weighted = 0;
  for (const f of findings) {
    weighted += sevWeight[f.severity] * Math.min(f.count, 3);
  }
  // Normalize: ~8 weighted points ≈ fully sloppy.
  const slopScore = Math.round((weighted / 8) * 100) / 100;

  const verdict: SlopReport['verdict'] = slopScore < 0.25 ? 'clean' : slopScore < 0.6 ? 'mild' : 'sloppy';

  return {
    cvFile: cv.sourceFile,
    slopScore,
    findings,
    verdict,
    summary: summarize(verdict, findings)
  };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function summarize(verdict: SlopReport['verdict'], findings: SlopFinding[]): string {
  if (findings.length === 0) {
    return 'No AI-slop markers detected. The CV reads as human-written and specific.';
  }
  const high = findings.filter((f) => f.severity === 'high').length;
  switch (verdict) {
    case 'clean':
      return `Minor markers only (${findings.length}). Mostly clean — tighten ${high ? `${high} over-claim(s)` : 'a few phrases'}.`;
    case 'mild':
      return `Some AI-slop present: ${findings.length} marker(s), ${high} high-severity. Rewrite the flagged lines with concrete results.`;
    case 'sloppy':
      return `Heavy AI-slop: ${findings.length} marker(s) incl. ${high} over-claims. This reads as LLM-generated — do a human pass with numbers and specifics.`;
  }
}
