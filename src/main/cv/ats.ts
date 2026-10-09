/**
 * ATS analysis engine.
 *
 * Scores a parsed CV against the parsing heuristics of the major Applicant
 * Tracking Systems — both the popular ones (Workday, Greenhouse, Lever) and
 * the niche/enterprise ones (iCIMS, SuccessFactors, SmartRecruiters, BambooHR,
 * Taleo). The scoring is deterministic and rule-based: each system applies a
 * weighted set of checks (contact completeness, section structure, keyword
 * density, formatting red-flags, length). No AI is needed for the structural
 * score; the AI layer can add a "would a recruiter read this?" pass on top.
 */

import type { AtsCheck, AtsReport, AtsSystemName, AtsSystemReport, ParsedCV } from '../../shared/types';

interface CheckDef {
  id: string;
  label: string;
  /** Weight of this check for a given system (0 = not evaluated). */
  weight: number;
  evaluate: (cv: ParsedCV) => { score: number; detail: string };
}

/* --------------------------- individual checks --------------------- */

const contactComplete: CheckDef = {
  id: 'contact',
  label: 'Contact information parseable',
  weight: 1.0,
  evaluate: (cv) => {
    const c = cv.contact;
    let score = 0;
    const parts: string[] = [];
    if (c.email) {
      score += 0.4;
    } else {
      parts.push('missing email');
    }
    if (c.phone) {
      score += 0.3;
    } else {
      parts.push('missing phone');
    }
    if (c.linkedin || c.website) {
      score += 0.3;
    } else {
      parts.push('missing LinkedIn/website');
    }
    return {
      score: clamp01(score),
      detail: parts.length ? `Missing: ${parts.join(', ')}` : 'Email, phone and a profile URL all present.'
    };
  }
};

const sectionStructure: CheckDef = {
  id: 'sections',
  label: 'Recognized section headers',
  weight: 0.9,
  evaluate: (cv) => {
    const wanted = ['experience', 'education', 'skills'];
    const present = wanted.filter((s) => cv.sections[s] && cv.sections[s].length > 10);
    const score = present.length / wanted.length;
    return {
      score,
      detail:
        present.length === wanted.length
          ? 'Experience, Education and Skills sections detected.'
          : `Missing/short sections: ${wanted.filter((s) => !present.includes(s)).join(', ')}`
    };
  }
};

const skillsDensity: CheckDef = {
  id: 'skills',
  label: 'Skill keyword density',
  weight: 0.8,
  evaluate: (cv) => {
    const n = cv.skills.length;
    // 12+ recognizable skills is a strong signal for keyword matching.
    const score = clamp01(n / 12);
    return {
      score,
      detail: `${n} recognized skill${n === 1 ? '' : 's'} found (target ≥ 12).`
    };
  }
};

const lengthSanity: CheckDef = {
  id: 'length',
  label: 'Document length in range',
  weight: 0.5,
  evaluate: (cv) => {
    const words = cv.rawText.split(/\s+/).filter(Boolean).length;
    // 300–1200 words is the sweet spot for most ATS parsers.
    let score = 1;
    if (words < 300) score = clamp01(words / 300);
    else if (words > 1200) score = clamp01(1 - (words - 1200) / 1500);
    return {
      score,
      detail: `${words} words (ideal 300–1200).`
    };
  }
};

const noTablesGraphics: CheckDef = {
  id: 'formatting',
  label: 'No tables / graphics / special layout',
  weight: 0.7,
  evaluate: (cv) => {
    // Heuristic red flags in extracted text that usually mean a table/graphics
    // layout that breaks naive parsers.
    const flags: RegExp[] = [
      /\|\s*\|/, // pipe tables
      /[\u2500-\u257F]/, // box-drawing chars
      /[\u2190-\u21FF]/ // arrows
    ];
    const hits = flags.filter((f) => f.test(cv.rawText)).length;
    const score = clamp01(1 - hits * 0.34);
    return {
      score,
      detail: hits ? `Detected ${hits} layout red-flag(s) that can break parsers.` : 'Clean linear text layout.'
    };
  }
};

const emailFormat: CheckDef = {
  id: 'emailformat',
  label: 'Standard email format (no fancy chars)',
  weight: 0.4,
  evaluate: (cv) => {
    const e = cv.contact.email;
    if (!e) return { score: 0, detail: 'No email found.' };
    const clean = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e);
    return {
      score: clean ? 1 : 0.4,
      detail: clean ? `Email "${e}" is standard.` : `Email "${e}" may not parse cleanly.`
    };
  }
};

const seniorityClarity: CheckDef = {
  id: 'seniority',
  label: 'Clear role title + seniority',
  weight: 0.5,
  evaluate: (cv) => {
    if (!cv.title) return { score: 0.3, detail: 'No clear professional title detected at the top.' };
    return { score: 1, detail: `Title "${cv.title}" present.` };
  }
};

const allChecks: CheckDef[] = [
  contactComplete,
  sectionStructure,
  skillsDensity,
  lengthSanity,
  noTablesGraphics,
  emailFormat,
  seniorityClarity
];

/* --------------------------- per-system weights -------------------- */

type WeightMap = Record<string, number>;

const SYSTEM_WEIGHTS: Record<AtsSystemName, { popularity: 'popular' | 'niche'; weights: WeightMap }> = {
  Workday: {
    popularity: 'popular',
    weights: { contact: 1.2, sections: 1.0, skills: 0.9, length: 0.6, formatting: 0.8, emailformat: 0.5, seniority: 0.6 }
  },
  Greenhouse: {
    popularity: 'popular',
    weights: { contact: 1.0, sections: 1.1, skills: 1.0, length: 0.7, formatting: 0.9, emailformat: 0.4, seniority: 0.5 }
  },
  Lever: {
    popularity: 'popular',
    weights: { contact: 1.0, sections: 1.0, skills: 1.0, length: 0.6, formatting: 0.8, emailformat: 0.4, seniority: 0.6 }
  },
  iCIMS: {
    popularity: 'niche',
    weights: { contact: 1.1, sections: 1.0, skills: 0.9, length: 0.8, formatting: 1.0, emailformat: 0.5, seniority: 0.5 }
  },
  'SAP SuccessFactors': {
    popularity: 'niche',
    weights: { contact: 1.2, sections: 1.0, skills: 0.8, length: 0.9, formatting: 1.1, emailformat: 0.6, seniority: 0.5 }
  },
  SmartRecruiters: {
    popularity: 'niche',
    weights: { contact: 1.0, sections: 0.9, skills: 1.0, length: 0.6, formatting: 0.7, emailformat: 0.4, seniority: 0.5 }
  },
  BambooHR: {
    popularity: 'niche',
    weights: { contact: 1.0, sections: 0.8, skills: 0.9, length: 0.7, formatting: 0.6, emailformat: 0.5, seniority: 0.4 }
  },
  Taleo: {
    popularity: 'niche',
    weights: { contact: 1.1, sections: 1.0, skills: 0.9, length: 0.8, formatting: 1.0, emailformat: 0.5, seniority: 0.5 }
  }
};

/* ------------------------------ entry point ------------------------ */

export function analyzeATS(cv: ParsedCV): AtsReport {
  const perSystem: AtsSystemReport[] = [];

  for (const [system, cfg] of Object.entries(SYSTEM_WEIGHTS) as [AtsSystemName, (typeof SYSTEM_WEIGHTS)[keyof typeof SYSTEM_WEIGHTS]][]) {
    const checks: AtsCheck[] = [];
    let weightedSum = 0;
    let weightTotal = 0;

    for (const def of allChecks) {
      const weight = cfg.weights[def.id] ?? 0;
      if (weight === 0) continue;
      const { score, detail } = def.evaluate(cv);
      checks.push({
        id: def.id,
        label: def.label,
        score: round2(score),
        passed: score >= 0.7,
        detail
      });
      weightedSum += score * weight;
      weightTotal += weight;
    }

    const overallScore = weightTotal > 0 ? round2(weightedSum / weightTotal) : 0;
    perSystem.push({
      system,
      popularity: cfg.popularity,
      overallScore,
      checks
    });
  }

  // Aggregate across systems (average of overall scores).
  const aggregateScore = round2(
    perSystem.reduce((sum, s) => sum + s.overallScore, 0) / Math.max(1, perSystem.length)
  );

  const { topIssues, recommendations } = buildRecommendations(perSystem);

  return {
    cvFile: cv.sourceFile,
    aggregateScore,
    perSystem,
    topIssues,
    recommendations
  };
}

function buildRecommendations(perSystem: AtsSystemReport[]): {
  topIssues: string[];
  recommendations: string[];
} {
  // Collect the weakest checks across systems.
  const weak = new Map<string, { label: string; worst: number }>();
  for (const sys of perSystem) {
    for (const c of sys.checks) {
      if (!c.passed) {
        const prev = weak.get(c.id);
        if (!prev || c.score < prev.worst) weak.set(c.id, { label: c.label, worst: c.score });
      }
    }
  }

  const topIssues = Array.from(weak.values())
    .sort((a, b) => a.worst - b.worst)
    .slice(0, 5)
    .map((w) => w.label);

  const recommendations: string[] = [];
  if (weak.has('contact')) recommendations.push('Add a clearly parseable email, phone number and LinkedIn URL near the top.');
  if (weak.has('sections')) recommendations.push('Use standard section headers: Experience, Education, Skills.');
  if (weak.has('skills')) recommendations.push('List at least 12 concrete, keyword-rich skills (tools, languages, frameworks).');
  if (weak.has('length')) recommendations.push('Aim for 300–1200 words — trim filler or expand thin sections.');
  if (weak.has('formatting')) recommendations.push('Remove tables, columns, icons and graphics; use a single-column linear layout.');
  if (weak.has('emailformat')) recommendations.push('Use a plain ASCII email address without special characters.');
  if (weak.has('seniority')) recommendations.push('Put your professional title on the first line so parsers capture your role.');
  if (recommendations.length === 0) {
    recommendations.push('Your CV is well structured for ATS parsing. Focus next on tailoring keywords per job.');
  }

  return { topIssues, recommendations };
}

/* ------------------------------ utils ------------------------------ */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
