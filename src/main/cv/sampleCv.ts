/**
 * Sample CVs by level + comparison (same job field).
 *
 * Given a parsed CV, this engine:
 *   1. Detects the user's **job family** ("corps de métier") from the title,
 *      falling back to skill overlap — so every reference stays in the SAME field.
 *   2. Generates three deterministic reference CVs (junior / intermédiaire /
 *      senior) for that field, weaving a couple of the user's real skills into
 *      the mid/senior references so they read as tailored benchmarks.
 *   3. Compares the user's CV against each reference along seniority dimensions
 *      (quantified impact, ownership, leadership, field breadth, architecture)
 *      and produces skill coverage + gaps / strengths / next steps.
 *
 * Everything is rule-based and offline — no AI required — matching the project's
 * "deterministic engines first" philosophy. The AI layer can enrich later.
 */

import type {
  LevelComparison,
  LevelDimension,
  ParsedCV,
  SampleCv,
  SampleCvBundle,
  SampleLevel,
  SeniorityBand
} from '../../shared/types';

/* --------------------------- job family model ---------------------- */

/** Cumulative skill tiers for a field: each tier lists the skills *added* at
 *  that level. The expected set at a level is the union of all lower-or-equal
 *  tiers. Skills are kept within the parser's SKILL_VOCAB so coverage checks
 *  stay fair (the user's mined skills come from that same vocabulary). */
interface SkillLadder {
  junior: string[];
  mid: string[];
  senior: string[];
}

interface JobFamilyDef {
  id: string;
  /** French field label shown in the UI, e.g. "Développeur Frontend". */
  label: string;
  /** Short noun used inside generated sentences, e.g. "frontend". */
  short: string;
  /** Reference title base, e.g. "Développeur Frontend". */
  titleNoun: string;
  /** Matched against the CV title (case-insensitive). */
  detect: RegExp;
  ladder: SkillLadder;
}

// Ordered most-specific-first so "Full-Stack" wins over "Frontend"/"Backend".
const FAMILIES: JobFamilyDef[] = [
  {
    id: 'fullstack',
    label: 'Développeur Full-Stack',
    short: 'full-stack',
    titleNoun: 'Développeur Full-Stack',
    detect: /full[- ]?stack/i,
    ladder: {
      junior: ['javascript', 'react', 'node.js', 'html'],
      mid: ['typescript', 'postgresql', 'docker', 'next.js'],
      senior: ['system design', 'microservices', 'kubernetes', 'graphql']
    }
  },
  {
    id: 'frontend',
    label: 'Développeur Frontend',
    short: 'frontend',
    titleNoun: 'Développeur Frontend',
    detect: /front[- ]?end|frontend|interface|\bui\/ux\b/i,
    ladder: {
      junior: ['html', 'css', 'javascript', 'react'],
      mid: ['typescript', 'next.js', 'tailwind', 'jest', 'vite'],
      senior: ['system design', 'graphql', 'cypress']
    }
  },
  {
    id: 'backend',
    label: 'Développeur Backend',
    short: 'backend',
    titleNoun: 'Développeur Backend',
    detect: /back[- ]?end|backend|\bserveur\b|server/i,
    ladder: {
      junior: ['node.js', 'express', 'postgresql', 'rest'],
      mid: ['typescript', 'docker', 'redis', 'ci/cd'],
      senior: ['microservices', 'system design', 'kubernetes', 'kafka']
    }
  },
  {
    id: 'devops',
    label: 'Ingénieur DevOps / Plateforme',
    short: 'DevOps',
    titleNoun: 'Ingénieur DevOps',
    detect: /devops|plateforme|platform|\bsre\b|infrastructure/i,
    ladder: {
      junior: ['linux', 'docker', 'bash', 'git'],
      mid: ['kubernetes', 'terraform', 'ci/cd', 'aws'],
      senior: ['ansible', 'microservices', 'elasticsearch']
    }
  },
  {
    id: 'data',
    label: 'Ingénieur Data / IA',
    short: 'Data & IA',
    titleNoun: 'Ingénieur Data',
    detect: /\bdata\b|machine learning|\bml\b|scientifique des donn[ée]es/i,
    ladder: {
      junior: ['python', 'sql', 'data analysis'],
      mid: ['machine learning', 'pytorch', 'postgresql'],
      senior: ['llm', 'nlp', 'tensorflow', 'system design']
    }
  },
  {
    id: 'mobile',
    label: 'Développeur Mobile',
    short: 'mobile',
    titleNoun: 'Développeur Mobile',
    detect: /mobile|\bios\b|android/i,
    ladder: {
      junior: ['javascript', 'react', 'html'],
      mid: ['typescript', 'graphql', 'rest'],
      senior: ['system design', 'cypress', 'grpc']
    }
  },
  {
    id: 'qa',
    label: 'Ingénieur QA / Test',
    short: 'QA & test',
    titleNoun: 'Ingénieur QA',
    detect: /\bqa\b|qualit[ée]|\btest/i,
    ladder: {
      junior: ['testing', 'jest', 'cypress'],
      mid: ['python', 'ci/cd', 'docker'],
      senior: ['system design', 'tdd', 'microservices']
    }
  },
  {
    id: 'general',
    label: 'Développeur Logiciel',
    short: 'logiciel',
    titleNoun: 'Développeur Logiciel',
    detect: /./, // fallback — matches anything; used last.
    ladder: {
      junior: ['javascript', 'typescript', 'git', 'rest'],
      mid: ['node.js', 'react', 'docker', 'postgresql'],
      senior: ['system design', 'microservices', 'kubernetes', 'ci/cd']
    }
  }
];

/* ------------------------------ level meta ------------------------- */

const LEVELS: SampleLevel[] = ['junior', 'mid', 'senior'];

const LEVEL_LABEL: Record<SampleLevel, string> = {
  junior: 'Junior',
  mid: 'Intermédiaire',
  senior: 'Senior'
};

const LEVEL_YEARS: Record<SampleLevel, string> = {
  junior: '0–2 ans',
  mid: '3–5 ans',
  senior: '6+ ans'
};

/* ------------------------------ helpers ---------------------------- */

/** Union of all ladder tiers up to and including `level`. */
export function fullLadderUpTo(family: JobFamilyDef, level: SampleLevel): string[] {
  const out: string[] = [];
  for (const l of LEVELS) {
    if (l === level || LEVELS.indexOf(l) < LEVELS.indexOf(level)) out.push(...family.ladder[l]);
  }
  // De-duplicate, preserve order.
  return Array.from(new Set(out));
}

function familySkillSet(family: JobFamilyDef): Set<string> {
  return new Set(fullLadderUpTo(family, 'senior').map((s) => s.toLowerCase()));
}

/** Detect the user's job family from title first, then skill overlap. */
export function detectJobFamily(cv: ParsedCV): JobFamilyDef {
  const title = (cv.title ?? '').toLowerCase();
  if (title) {
    for (const f of FAMILIES) {
      if (f.id === 'general') continue; // never match the fallback on title alone
      if (f.detect.test(title)) return f;
    }
  }

  // Skill-overlap inference: pick the field whose ladder shares the most skills.
  const userSkills = new Set(cv.skills.map((s) => s.toLowerCase()));
  let best = FAMILIES[FAMILIES.length - 1]; // general
  let bestScore = 0;
  for (const f of FAMILIES) {
    if (f.id === 'general') continue;
    const set = familySkillSet(f);
    let score = 0;
    for (const s of userSkills) if (set.has(s)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/* --------------------------- sample CV text ------------------------ */

/** Preferred "headline" skills to name inside generated sentences, so the
 *  prose reads naturally (frameworks first, not "des modules html"). */
const HEADLINE_PRIORITY = [
  'react', 'typescript', 'node.js', 'next.js', 'vue', 'angular', 'svelte',
  'python', 'pytorch', 'tensorflow', 'kubernetes', 'terraform', 'docker',
  'graphql', 'microservices', 'machine learning', 'llm', 'javascript'
];

/** Pick two representative skills from the expected set for use in prose. */
function pickHeadline(expected: string[]): [string, string] {
  const inPriority = HEADLINE_PRIORITY.filter((p) => expected.includes(p));
  const rest = expected.filter((s) => !inPriority.includes(s));
  const pool = [...inPriority, ...rest];
  return [pool[0] ?? '', pool[1] ?? pool[0] ?? ''];
}

function buildSampleCvText(family: JobFamilyDef, level: SampleLevel, extraSkills: string[]): string {
  const expected = fullLadderUpTo(family, level);
  const [s1, s2] = pickHeadline(expected);

  // Weave a couple of the user's real (out-of-ladder) skills into mid/senior.
  const skillLine =
    level === 'junior'
      ? expected.join(', ')
      : Array.from(new Set([...expected, ...extraSkills])).join(', ');

  const head = [
    'Alex Martin',
    `${family.titleNoun} ${LEVEL_LABEL[level]}`,
    'Paris, France · alex.martin@email.fr · +33 6 12 34 56 78 · linkedin.com/in/alexmartin',
    ''
  ].join('\n');

  let summary = '';
  let experience = '';
  let education = '';

  if (level === 'junior') {
    summary =
      `Développeur ${family.short} junior, à l'aise avec ${s1} et ${s2}. ` +
      "Je cherche un premier poste pour mettre en pratique mes bases solides et progresser sur des projets concrets.";
    experience = [
      'Stage — Développeur Junior · Studio Web (2024, 6 mois)',
      `• Participe au développement d'interfaces ${s1} sous la supervision d'un développeur senior.`,
      '• Corrige des bugs et améliore la lisibilité du code existant.',
      '',
      'Projet académique — Application web (2023)',
      `• Développe un site vitrine en ${s1} et ${s2} pour un projet de fin d'études.`
    ].join('\n');
    education = 'Licence / BUT informatique · Université de Paris (2021–2024)';
  } else if (level === 'mid') {
    summary =
      `Développeur ${family.short} intermédiaire avec 3 à 5 ans d'expérience. ` +
      "J'autonomise des fonctionnalités de bout en bout et j'ai l'habitude de mesurer l'impact de mon travail.";
    experience = [
      'Développeur · Scale-up (2022–présent)',
      `• Conçoit et développe des modules ${s1} utilisés quotidiennement par les équipes.`,
      `• Réduit le temps de chargement de 35 % en optimisant ${s2}.`,
      '• Met en place une suite de tests qui divise les régressions par deux.',
      '',
      'Développeur Junior · Agence (2020–2022)',
      `• Développe des pages et composants ${s1} pour plusieurs clients.`
    ].join('\n');
    education = 'Licence / BUT informatique · Université de Paris (2018–2021)';
  } else {
    summary =
      `Développeur ${family.short} senior, plus de 6 ans d'expérience. ` +
      "J'architecte des solutions, je pilote des initiatives techniques et j'accompagne les développeurs plus juniors de l'équipe.";
    experience = [
      'Lead technique · Scale-up (2019–présent)',
      `• Pilote la conception d'architecture ${s1} pour une plateforme utilisée par des milliers d'utilisateurs.`,
      "• Migre le cœur du système vers des microservices, réduisant les coûts d'infrastructure de 30 %.",
      '• Mentore quatre développeurs juniors et anime les revues de code.',
      '• Définit la roadmap technique avec le produit et les autres équipes.',
      '',
      'Développeur · EdTech (2016–2019)',
      `• Responsable de modules critiques ${s2}, de la conception à la mise en production.`,
      '',
      'Développeur Junior · ESN (2014–2016)',
      `• Développe et maintient des applications ${s1} pour des clients variés.`
    ].join('\n');
    education = 'Licence informatique · Université de Paris (2012–2015) · Formation continue en architecture logicielle';
  }

  return [head, `Profil\n${summary}`, '', `Expérience\n${experience}`, '', `Compétences\n${skillLine}`, '', `Formation\n${education}`].join('\n');
}

/* --------------------------- dimension scoring --------------------- */

interface DimDef {
  id: string;
  label: string;
  weight: number;
  /** Returns a 0..1 score from the (lowercased) CV text + skill set. */
  score: (text: string, skills: Set<string>) => number;
}

const DIMENSIONS: DimDef[] = [
  {
    id: 'impact',
    label: 'Résultats chiffrés',
    weight: 0.25,
    score: (text) => {
      const patterns = [/\d+\s*%/g, /\$\s?\d/g, /\b\d{2,}\s*(ms|kb|mb|gb)\b/gi, /\b\d+\s*(jours?|heures?|semaines?)\b/gi];
      let hits = 0;
      for (const re of patterns) hits += (text.match(re) ?? []).length;
      return clamp01(hits / 4);
    }
  },
  {
    id: 'ownership',
    label: 'Propriété & portée',
    weight: 0.2,
    score: (text) => {
      const kws = ['pilote', 'piloté', 'responsable de', 'à la tête', 'conçu', 'conçoit', 'architecte', 'owned', 'led ', 'de bout en bout'];
      return clamp01(kws.filter((k) => text.includes(k)).length / 4);
    }
  },
  {
    id: 'leadership',
    label: 'Leadership & mentorat',
    weight: 0.1,
    score: (text) => {
      const kws = ['mentor', 'mentore', 'encadrement', 'équipe de', 'lead technique', 'revue de code', 'code review', 'onboarding'];
      return clamp01(kws.filter((k) => text.includes(k)).length / 3);
    }
  },
  {
    id: 'breadth',
    label: 'Maîtrise du métier',
    weight: 0.3,
    // Field-specific: computed in compareOne() because it needs the family's ladder.
    score: () => 0
  },
  {
    id: 'architecture',
    label: 'Architecture & conception',
    weight: 0.15,
    score: (text) => {
      const kws = ['system design', 'architecture', 'scalab', 'microservices', "conception d'architecture", 'design system', 'kubernetes'];
      return clamp01(kws.filter((k) => text.includes(k)).length / 3);
    }
  }
];

/** Expected dimension thresholds per level (what a CV at that level shows). */
const EXPECTED: Record<SampleLevel, Record<string, number>> = {
  junior: { impact: 0.2, ownership: 0.2, leadership: 0, breadth: 0.5, architecture: 0 },
  mid: { impact: 0.5, ownership: 0.5, leadership: 0.3, breadth: 0.7, architecture: 0.2 },
  senior: { impact: 0.8, ownership: 0.8, leadership: 0.6, breadth: 0.9, architecture: 0.6 }
};

const BAND_INDEX: Record<SeniorityBand, number> = { junior: 0, mid: 1, senior: 2, lead: 3 };

/* ------------------------------ comparator ------------------------- */

function compareOne(cv: ParsedCV, family: JobFamilyDef, level: SampleLevel): LevelComparison {
  const text = cv.rawText.toLowerCase();
  const userSkills = new Set(cv.skills.map((s) => s.toLowerCase()));
  const expectedSkills = fullLadderUpTo(family, level);
  const expectedSet = new Set(expectedSkills.map((s) => s.toLowerCase()));
  const fullLadder = fullLadderUpTo(family, 'senior');

  // `breadth` is field-specific: coverage of the skills expected AT this level
  // (not the whole ladder — a junior isn't expected to know everything).
  const breadthScore = clamp01(
    Array.from(userSkills).filter((s) => expectedSet.has(s)).length / Math.max(1, expectedSkills.length)
  );
  const dimScores: Record<string, number> = {};
  for (const d of DIMENSIONS) {
    dimScores[d.id] = d.id === 'breadth' ? breadthScore : d.score(text, userSkills);
  }

  // Fit score: weighted "how much of this level's profile do you already meet".
  let fit = 0;
  let weightSum = 0;
  for (const d of DIMENSIONS) {
    const exp = EXPECTED[level][d.id] ?? 0;
    const term = exp > 0 ? Math.min(1, dimScores[d.id] / exp) : 1; // neutral if not expected
    fit += d.weight * term;
    weightSum += d.weight;
  }
  const fitScore = round2(fit / weightSum);

  // Verdict: start from the detected band, refine with the fit score.
  const bandIdx = BAND_INDEX[cv.seniority];
  const levelIdx = LEVELS.indexOf(level);
  let verdict: LevelComparison['verdict'] = bandIdx > levelIdx ? 'above' : bandIdx < levelIdx ? 'below' : 'at';
  if (verdict === 'below' && fitScore >= 0.75) verdict = 'at';
  if (verdict === 'at' && fitScore < 0.45) verdict = 'below';
  if (verdict === 'above' && fitScore < 0.4) verdict = 'at';

  // Skill coverage within the field ladder up to this level.
  const present = expectedSkills.filter((s) => userSkills.has(s.toLowerCase()));
  const missing = expectedSkills.filter((s) => !userSkills.has(s.toLowerCase()));

  const dimensions: LevelDimension[] = DIMENSIONS.map((d) => ({
    id: d.id,
    label: d.label,
    score: round2(dimScores[d.id]),
    detail: dimDetail(d.id, dimScores[d.id])
  }));

  return {
    level,
    jobFamily: family.label,
    fitScore,
    verdict,
    skillCoverage: { present, missing },
    dimensions,
    gaps: buildGaps(missing, dimScores, EXPECTED[level], level),
    strengths: buildStrengths(cv, fullLadder, expectedSet, dimScores, EXPECTED[level]),
    nextSteps: buildNextSteps(missing, dimScores, EXPECTED[level], level)
  };
}

function dimDetail(id: string, score: number): string {
  const pct = `${Math.round(score * 100)} %`;
  switch (id) {
    case 'impact':
      return `Signaux chiffrés détectés : ${pct}.`;
    case 'ownership':
      return `Formulation de responsabilité : ${pct}.`;
    case 'leadership':
      return `Mentorat / encadrement : ${pct}.`;
    case 'breadth':
      return `Couverture des compétences du métier : ${pct}.`;
    case 'architecture':
      return `Conception / architecture : ${pct}.`;
    default:
      return pct;
  }
}

function buildGaps(
  missing: string[],
  dimScores: Record<string, number>,
  expected: Record<string, number>,
  level: SampleLevel
): string[] {
  const gaps: string[] = [];
  if (missing.length) gaps.push(`Compétences attendues absentes : ${missing.slice(0, 4).join(', ')}.`);

  const weak = (id: string) => expected[id] > 0 && dimScores[id] < expected[id] * 0.6;
  if (weak('impact')) gaps.push('Peu de résultats chiffrés : ajoutez des %, délais réduits ou coûts évités.');
  if (weak('ownership')) gaps.push('Portée floue : formulez « pilote », « responsable de » plutôt que « a fait partie de ».');
  if (level === 'senior' && weak('leadership')) gaps.push('Pas de signal de mentorat / encadrement d\'équipe, attendu à ce niveau.');
  if (level === 'senior' && weak('architecture')) gaps.push('Aucune conception d\'architecture ou de microservices mise en avant.');
  if (weak('breadth')) gaps.push(`Maîtrise partielle du métier : élargissez le panel de compétences (voir liste attendue).`);

  return gaps.length ? gaps.slice(0, 5) : ['Aucun écart majeur par rapport à ce niveau.'];
}

function buildStrengths(
  cv: ParsedCV,
  fullLadder: string[],
  expectedSet: Set<string>,
  dimScores: Record<string, number>,
  expected: Record<string, number>
): string[] {
  const strengths: string[] = [];
  const userSkills = new Set(cv.skills.map((s) => s.toLowerCase()));

  // Skills that belong to the field ladder but sit ABOVE this level's set.
  const beyond = fullLadder.filter((s) => userSkills.has(s.toLowerCase()) && !expectedSet.has(s.toLowerCase()));
  if (beyond.length) strengths.push(`Compétences déjà au niveau supérieur : ${beyond.slice(0, 4).join(', ')}.`);

  const strong = (id: string) => expected[id] > 0 && dimScores[id] >= expected[id];
  if (strong('impact')) strengths.push('Résultats bien chiffrés — un vrai signal pour les recruteurs.');
  if (strong('leadership')) strengths.push('Leadership / mentorat déjà présent dans le CV.');
  if (strong('architecture')) strengths.push('Conception d\'architecture mise en avant, au niveau attendu.');
  if (strong('ownership')) strengths.push('Responsabilités clairement formulées.');

  return strengths.length ? strengths.slice(0, 4) : ['Le CV est cohérent avec ce niveau, sans écart majeur.'];
}

function buildNextSteps(
  missing: string[],
  dimScores: Record<string, number>,
  expected: Record<string, number>,
  level: SampleLevel
): string[] {
  const steps: string[] = [];
  if (missing.length) steps.push(`Ajoutez ${missing.slice(0, 2).join(', ')} à votre section Compétences.`);

  const weak = (id: string) => expected[id] > 0 && dimScores[id] < expected[id] * 0.6;
  if (weak('impact')) steps.push('Chiffrez 2–3 réalisations marquantes (impact en %, gain de temps, coût évité).');
  if (weak('ownership')) steps.push('Réécrivez vos puces en verbes d\'action avec un résultat mesurable.');
  if (level === 'senior' && weak('leadership')) steps.push('Ajoutez une ligne sur le mentorat / l\'encadrement d\'équipe.');
  if (level === 'senior' && weak('architecture')) steps.push('Décrivez un projet d\'architecture que vous avez conduit de bout en bout.');

  return steps.length ? steps.slice(0, 5) : ['Votre CV atteint déjà ce niveau — visez le palier supérieur.'];
}

/* ------------------------------ entry point ------------------------ */

export function buildSampleCvBundle(cv: ParsedCV): SampleCvBundle {
  const family = detectJobFamily(cv);
  const fullSet = familySkillSet(family);
  // A couple of the user's real, out-of-ladder skills to weave into mid/senior.
  const extraSkills = cv.skills.filter((s) => !fullSet.has(s.toLowerCase())).slice(0, 2);

  const samples: SampleCv[] = LEVELS.map((level) => ({
    level,
    levelLabel: LEVEL_LABEL[level],
    jobFamily: family.label,
    title: `${family.titleNoun} ${LEVEL_LABEL[level]}`,
    yearsLabel: LEVEL_YEARS[level],
    skills: fullLadderUpTo(family, level),
    rawText: buildSampleCvText(family, level, extraSkills)
  }));

  const comparisons: LevelComparison[] = LEVELS.map((level) => compareOne(cv, family, level));

  return {
    jobFamily: family.label,
    userTitle: cv.title ?? '',
    userSeniority: cv.seniority,
    samples,
    comparisons
  };
}

/* ------------------------------ utils ------------------------------ */

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
