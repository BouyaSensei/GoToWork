/**
 * Sample CVs by level + comparison (same job field).
 *
 * Given a parsed CV, this engine:
 *   1. Detects the user's **job family** ("corps de métier") from the title,
 *      falling back to skill overlap — so every reference stays in the SAME field.
 *   2. Generates three deterministic reference CVs (junior / intermédiaire /
 *      senior) for that field. The prose is grounded in what recruiters and
 *      hiring managers actually reward in real, well-regarded CVs: action-verb
 *      bullets following "what you built + tech + scale metric + business
 *      impact", a large share of quantified lines, and level-appropriate
 *      signals (junior = deployed projects; mid = end-to-end ownership + first
 *      mentorship; senior = architecture, team leadership, migrations).
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

/** A single, metric-rich achievement bullet. `min` is the lowest level for
 *  which this line reads as credible (so a junior CV never shows senior scope). */
interface Achievement {
  min: SampleLevel;
  text: string; // French bullet; may use {s1}/{s2}/{scale} tokens.
}

/** Field-specific, realistic content used to build the reference-CV prose.
 *  Modeled on real, recruiter-praised CVs (XYZ / action+system+metric+impact). */
interface FieldContent {
  /** Headline scale phrase for the field, e.g. "2M+ utilisateurs mensuels". */
  scale: string;
  /** Summary line per level; may use {years}/{s1}/{s2}/{scale}. */
  summary: Record<SampleLevel, string>;
  /** Field-specific, quantified achievement bullets (realistic numbers). */
  achievements: Achievement[];
  /** Junior-friendly personal-project bullets (key entry-level signal). */
  projects: string[];
  /** Formation line per level. */
  education: Record<SampleLevel, string>;
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
  /** Realistic, level-appropriate content for the generated reference CVs. */
  content: FieldContent;
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
    },
    content: {
      scale: '500K+ utilisateurs actifs',
      summary: {
        junior: "Développeur full-stack junior avec {years} d'expérience et un portfolio de projets déployés. À l'aise avec {s1} (front) et {s2} (back), orienté produits complets.",
        mid: "Développeur full-stack intermédiaire avec {years} d'expérience. J'ai livré des fonctionnalités de bout en bout (front + back + base) et mesuré leur impact sur la performance et l'adoption.",
        senior: "Développeur full-stack senior avec {years} d'expérience. J'architecte des systèmes complets servant {scale} et je fais progresser l'équipe via le mentoring et les revues de conception."
      },
      achievements: [
        { min: 'junior', text: "Développe une application web complète en {s1} et {s2} (CRUD, authentification) déployée en production." },
        { min: 'junior', text: "Réduit le temps de réponse d'une API de 800ms à 300ms en ajoutant un index SQL et une mise en cache." },
        { min: 'mid', text: "Conçoit et livre un service REST/GraphQL {s2} utilisé par l'application mobile, avec 95 % de couverture de tests." },
        { min: 'mid', text: "Optimise les requêtes {s2}, passant le p95 de 400ms à 90ms sur l'endpoint le plus sollicité." },
        { min: 'mid', text: "Met en place un pipeline CI/CD (Docker) réduisant le temps de déploiement de 30 min à 6 min." },
        { min: 'senior', text: "Architecte une plateforme full-stack servant {scale}, atteignant 99,9 % d'uptime et un p95 < 150ms." },
        { min: 'senior', text: "Pilote la migration d'un monolithe vers des microservices (Docker/Kubernetes) sans interruption de service." },
        { min: 'senior', text: "Mentore 4 développeurs et anime les revues d'architecture, réduisant les incidents de production de 40 %." }
      ],
      projects: [
        "SaaS de gestion de tâches en React + Node.js + PostgreSQL, déployé sur AWS (authentification, paiements Stripe).",
        "API publique REST documentée (OpenAPI) avec tests E2E, open source (120 étoiles GitHub)."
      ],
      education: {
        junior: 'Licence / BUT Informatique · Formation continue en développement web',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications cloud (AWS/Azure)'
      }
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
    },
    content: {
      scale: '2M+ utilisateurs mensuels',
      summary: {
        junior: "Développeur frontend junior avec {years} d'expérience et un portfolio de projets déployés. Solide sur {s1} et {s2}, orienté performance et accessibilité.",
        mid: "Développeur frontend intermédiaire avec {years} d'expérience. J'ai livré des interfaces de bout en bout et mesuré leur impact (performance, conversion) sur des applications à fort trafic.",
        senior: "Développeur frontend senior avec {years} d'expérience. J'architecte des interfaces servant {scale} et je fais progresser l'équipe via le mentoring et les revues de conception."
      },
      achievements: [
        { min: 'junior', text: "Réduit le temps de chargement d'une page de 2,1s à 0,8s en optimisant le rendu {s1} et la taille du bundle." },
        { min: 'junior', text: "Développe des composants réutilisables {s1} utilisés par 3 équipes produit." },
        { min: 'junior', text: "Améliore le score Lighthouse d'un site de 62 à 94 (performance + accessibilité)." },
        { min: 'mid', text: "Conçoit et développe un module {s1} utilisé quotidiennement par des milliers d'utilisateurs, avec 85 % de couverture de tests." },
        { min: 'mid', text: "Optimise le rendu {s1}, réduisant le temps d'affichage initial de 40 % (3,2s → 1,9s)." },
        { min: 'mid', text: "Met en place un design system de 40+ composants adopté par 2 équipes produit." },
        { min: 'senior', text: "Architecte la refonte frontend d'une plateforme servant {scale}, atteignant 98 Lighthouse et réduisant le TTI de 5,8s à 2,1s." },
        { min: 'senior', text: "Pilote la migration Angular → React pour une application à fort trafic, sans interruption de service." },
        { min: 'senior', text: "Bâtit un design system de 120+ composants adopté par 8 équipes, standardisant le développement frontend." },
        { min: 'senior', text: "Mentore 4 développeurs et anime les revues de conception, réduisant les régressions de production de 35 %." }
      ],
      projects: [
        "E-commerce React + TypeScript (SSR) déployé sur Vercel — 98 Lighthouse, panier et paiement.",
        "Dashboard temps réel en React + WebSocket affichant des métriques live, open source (120 étoiles)."
      ],
      education: {
        junior: 'Licence / BUT Informatique · Certification frontend',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Formation en architecture frontend'
      }
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
    },
    content: {
      scale: '30M+ requêtes API par jour',
      summary: {
        junior: "Développeur backend junior avec {years} d'expérience et des projets déployés. À l'aise avec {s1} et {s2}, orienté APIs robustes et bases de données.",
        mid: "Développeur backend intermédiaire avec {years} d'expérience. J'ai conçu des services de bout en bout (API, base, cache) et mesuré leur impact sur la performance et la fiabilité.",
        senior: "Développeur backend senior avec {years} d'expérience. J'architecte des systèmes distribués traitant {scale} et je fais progresser l'équipe via le mentoring et les revues de conception."
      },
      achievements: [
        { min: 'junior', text: "Développe des endpoints REST {s1} (CRUD, validation) avec une couverture de tests de 80 %." },
        { min: 'junior', text: "Réduit le temps de réponse d'une API de 900ms à 250ms en ajoutant un index et une cache Redis." },
        { min: 'mid', text: "Conçoit un service {s1} gérant l'authentification et les rôles, utilisé par 3 applications front." },
        { min: 'mid', text: "Optimise les requêtes {s2}, passant le p95 de 450ms à 80ms sur l'endpoint le plus sollicité." },
        { min: 'mid', text: "Met en place une cache Redis, réduisant la charge base de données de 60 %." },
        { min: 'senior', text: "Architecte une plateforme de microservices traitant {scale} avec 99,98 % d'uptime." },
        { min: 'senior', text: "Pilote la migration monolithe → microservices (Kafka, Kubernetes) en zéro downtime, réduisant la charge requêtes de 64 %." },
        { min: 'senior', text: "Conçoit un API gateway (rate limiting, auth) centralisant 7 services et réduisant les coûts d'infra de 30 %." },
        { min: 'senior', text: "Mentore 3 ingénieurs sur le system design et l'optimisation SQL, améliorant la vélocité de l'équipe de 35 %." }
      ],
      projects: [
        "API REST {s1} + PostgreSQL (auth JWT, pagination) déployée sur AWS ECS, documentée OpenAPI.",
        "Pipeline d'indexation en {s2} traitant 1M d'entrées/heure, open source."
      ],
      education: {
        junior: 'Licence / BUT Informatique · Certification backend',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications cloud (AWS/GCP)'
      }
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
    },
    content: {
      scale: "des dizaines d'équipes produit",
      summary: {
        junior: "Ingénieur DevOps junior avec {years} d'expérience. À l'aise avec {s1} et {s2}, orienté automatisation et fiabilité des déploiements.",
        mid: "Ingénieur DevOps intermédiaire avec {years} d'expérience. J'ai industrialisé les déploiements (CI/CD, conteneurs) et mesuré l'impact sur la fréquence de release et la fiabilité.",
        senior: "Ingénieur DevOps / plateforme senior avec {years} d'expérience. J'architecte des plateformes servant {scale} et je fais progresser les équipes via le mentoring et les standards d'infra."
      },
      achievements: [
        { min: 'junior', text: "Automatise les déploiements avec Docker et des scripts {s2}, réduisant le temps de mise en prod de 40 min à 8 min." },
        { min: 'junior', text: "Met en place la surveillance (logs, alertes) pour une application {s1}." },
        { min: 'mid', text: "Industrialise un pipeline CI/CD ({s1}) passant les déploiements de hebdomadaires à quotidiens." },
        { min: 'mid', text: "Conteneurise 6 services sur Kubernetes, améliorant la scalabilité et réduisant les incidents de 40 %." },
        { min: 'mid', text: "Met en place l'infra-as-code (Terraform), réduisant la dérive configuration et le temps d'onboarding de 50 %." },
        { min: 'senior', text: "Architecte une plateforme Kubernetes multi-équipes servant {scale}, avec autoscaling et zéro downtime." },
        { min: 'senior', text: "Pilote la migration vers l'infra-as-code (Terraform), réduisant les coûts cloud de 30 %." },
        { min: 'senior', text: "Définit les standards SRE (SLO, on-call, postmortem) adoptés par 5 équipes, réduisant le MTTR de 45 %." },
        { min: 'senior', text: "Mentore 3 ingénieurs et anime la guild architecture infra." }
      ],
      projects: [
        "Homelab Kubernetes (Terraform + Helm) documenté, déployant une stack full-stack en moins de 10 min.",
        "Pipeline CI/CD GitHub Actions avec déploiement blue/green, open source."
      ],
      education: {
        junior: 'BUT / Licence Informatique · Certification cloud (AWS/Azure)',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications DevOps/SRE (CKA, Terraform)'
      }
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
    },
    content: {
      scale: '2 To de données par jour',
      summary: {
        junior: "Ingénieur Data junior avec {years} d'expérience et des projets concrets. À l'aise avec {s1} et {s2}, orienté qualité des données et analyse.",
        mid: "Ingénieur Data intermédiaire avec {years} d'expérience. J'ai construit des pipelines et des modèles de bout en bout et mesuré leur impact (précision, temps de traitement, décision business).",
        senior: "Ingénieur Data / IA senior avec {years} d'expérience. J'architecte des plateformes data traitant {scale} et je fais progresser l'équipe via le mentoring et les revues de modèles."
      },
      achievements: [
        { min: 'junior', text: "Construit des dashboards {s1} (SQL, Python) suivis par 50+ utilisateurs métier." },
        { min: 'junior', text: "Automatise un rapport hebdomadaire en Python, faisant gagner 3 h/semaine à l'équipe." },
        { min: 'mid', text: "Conçoit un pipeline ETL ({s1}) traitant {scale} et réduisant le temps de traitement de 6 h à 45 min." },
        { min: 'mid', text: "Développe un modèle de prédiction ({s2}) améliorant la précision de 12 points, déployé en production." },
        { min: 'mid', text: "Met en place la validation de données (Great Expectations), réduisant les incidents data de 50 %." },
        { min: 'senior', text: "Architecte une plateforme data/ML servant {scale}, avec orchestration (Airflow) et gouvernance." },
        { min: 'senior', text: "Pilote le déploiement de modèles LLM en production, réduisant le coût d'inférence de 40 %." },
        { min: 'senior', text: "Met en place la data governance (catalogue, qualité, accès) adoptée par 6 équipes." },
        { min: 'senior', text: "Mentore 3 ingénieurs data et anime les revues de conception des modèles." }
      ],
      projects: [
        "Pipeline ETL Python + Airflow traitant un jeu de données public, documenté et testé.",
        "Modèle ML (PyTorch) déployé en API avec A/B test, open source."
      ],
      education: {
        junior: 'Licence / Master Informatique ou Statistiques · Certification data',
        mid: 'Master Informatique / Data Science',
        senior: 'Master / Doctorat Data & IA · Certifications cloud/ML'
      }
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
    },
    content: {
      scale: '1M+ téléchargements cumulés',
      summary: {
        junior: "Développeur mobile junior avec {years} d'expérience et des apps déployées. À l'aise avec {s1} et {s2}, orienté performance et UX fluide.",
        mid: "Développeur mobile intermédiaire avec {years} d'expérience. J'ai livré des fonctionnalités de bout en bout (offline, push, perf) et mesuré leur impact sur la rétention et la stabilité.",
        senior: "Développeur mobile senior avec {years} d'expérience. J'architecte des applications comptabilisant {scale} et je fais progresser l'équipe via le mentoring et les standards de qualité."
      },
      achievements: [
        { min: 'junior', text: "Développe une fonctionnalité {s1} (navigation, offline) utilisée par des milliers d'utilisateurs." },
        { min: 'junior', text: "Corrige des fuites mémoire réduisant le crash rate de 2,1 % à 0,8 %." },
        { min: 'mid', text: "Conçoit et livre un module {s1} (offline-first, sync) améliorant la rétention de 8 %." },
        { min: 'mid', text: "Optimise le démarrage de l'app, réduisant le cold start de 4s à 1,2s." },
        { min: 'mid', text: "Met en place les tests E2E ({s2}), réduisant les régressions en prod de 40 %." },
        { min: 'senior', text: "Architecte une application {s1} comptabilisant {scale}, avec un crash rate < 0,5 % et 4,7/5 sur les stores." },
        { min: 'senior', text: "Pilote la migration vers une architecture modulaire (feature-first), accélérant les releases de 30 %." },
        { min: 'senior', text: "Définit les standards de performance et d'accessibilité mobile, adoptés par 3 équipes." },
        { min: 'senior', text: "Mentore 4 développeurs mobiles et anime les revues de code." }
      ],
      projects: [
        "App mobile {s1} (offline, push notifications) publiée sur les stores, open source.",
        "Kit de composants mobile réutilisables avec tests E2E, utilisé par 2 apps."
      ],
      education: {
        junior: 'Licence / BUT Informatique · Certification mobile',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications (React Native/Flutter)'
      }
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
    },
    content: {
      scale: '95 % de couverture sur les parcours critiques',
      summary: {
        junior: "Ingénieur QA junior avec {years} d'expérience. À l'aise avec {s1} et {s2}, orienté fiabilité et détection précoce des défauts.",
        mid: "Ingénieur QA intermédiaire avec {years} d'expérience. J'ai industrialisé la qualité (automatisation, CI) et mesuré l'impact sur les défauts échappés et le temps de release.",
        senior: "Ingénieur QA / Test senior avec {years} d'expérience. J'architecte la stratégie de test (atteignant {scale}) et je fais progresser l'équipe via le mentoring et les standards qualité."
      },
      achievements: [
        { min: 'junior', text: "Rédige des tests {s1} pour les parcours critiques, atteignant 80 % de couverture." },
        { min: 'junior', text: "Automatise une batterie de tests de régression réduisant le temps de validation de 2 j à 3 h." },
        { min: 'mid', text: "Industrialise la suite d'automatisation ({s1}) dans la CI, détectant les régressions avant merge." },
        { min: 'mid', text: "Met en place des tests de charge (k6), identifiant un goulot qui réduit le p95 de 300ms à 120ms." },
        { min: 'mid', text: "Réduit le taux de défauts échappés de 40 % grâce à une meilleure couverture E2E." },
        { min: 'senior', text: "Architecte la stratégie de test (pyramide, qualité dans la CI) servant {scale}." },
        { min: 'senior', text: "Pilote la mise en place du TDD et des tests contractuels, réduisant les incidents post-release de 50 %." },
        { min: 'senior', text: "Met en place l'observabilité des tests (détection flaky, métriques) adoptée par 4 équipes." },
        { min: 'senior', text: "Mentore 3 ingénieurs QA et anime les revues de qualité." }
      ],
      projects: [
        "Suite E2E {s1} open source couvrant un parcours critique, intégrée en CI.",
        "Outil de charge k6 + dashboards, documenté et réutilisable."
      ],
      education: {
        junior: 'Licence / BUT Informatique · Certification QA (ISTQB)',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications qualité/automatisation'
      }
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
    },
    content: {
      scale: 'des applications à fort trafic',
      summary: {
        junior: "Développeur logiciel junior avec {years} d'expérience et un portfolio de projets. À l'aise avec {s1} et {s2}, orienté résultats et apprentissage rapide.",
        mid: "Développeur logiciel intermédiaire avec {years} d'expérience. J'ai livré des fonctionnalités de bout en bout et mesuré leur impact sur la performance et l'adoption.",
        senior: "Développeur logiciel senior avec {years} d'expérience. J'architecte des systèmes robustes servant {scale} et je fais progresser l'équipe via le mentoring et les revues de conception."
      },
      achievements: [
        { min: 'junior', text: "Développe des fonctionnalités {s1} (CRUD, API) avec une couverture de tests de 75 %." },
        { min: 'junior', text: "Réduit le temps d'exécution d'un traitement batch de 20 min à 4 min." },
        { min: 'mid', text: "Conçoit et livre un service {s1} utilisé par 3 équipes, avec 90 % de couverture de tests." },
        { min: 'mid', text: "Optimise les performances (cache, requêtes), réduisant le p95 de 500ms à 100ms." },
        { min: 'mid', text: "Met en place la CI/CD (Docker), réduisant le temps de déploiement de 30 min à 5 min." },
        { min: 'senior', text: "Architecte une plateforme {s1} servant {scale}, atteignant 99,9 % d'uptime." },
        { min: 'senior', text: "Pilote la migration vers des microservices (Kubernetes) sans interruption de service." },
        { min: 'senior', text: "Mentore 4 développeurs et anime les revues d'architecture, réduisant les incidents de production de 40 %." }
      ],
      projects: [
        "Application web complète {s1} + API, déployée en production avec authentification et tests.",
        "Outil open source {s2} (150 étoiles GitHub) avec documentation et CI."
      ],
      education: {
        junior: 'Licence / BUT Informatique',
        mid: 'Licence / Master Informatique',
        senior: 'Master / Ingénieur Informatique · Certifications cloud/architecture'
      }
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

/** Ordinal rank used to order achievements / pick level-appropriate lines. */
const LEVEL_RANK: Record<SampleLevel, number> = { junior: 0, mid: 1, senior: 2 };

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

/** Replace {token} placeholders in a template with provided values. */
function fillTokens(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

function buildSampleCvText(family: JobFamilyDef, level: SampleLevel, extraSkills: string[]): string {
  const c = family.content;
  const expected = fullLadderUpTo(family, level);
  const [s1, s2] = pickHeadline(expected);
  const vars: Record<string, string> = { s1, s2, years: LEVEL_YEARS[level], scale: c.scale };

  // Select tier-appropriate achievements, most advanced first (so a senior CV
  // leads with its strongest lines and a junior never shows senior scope).
  const eligible = c.achievements
    .filter((a) => LEVEL_RANK[a.min] <= LEVEL_RANK[level])
    .sort((a, b) => LEVEL_RANK[b.min] - LEVEL_RANK[a.min]);

  const primaryCount = level === 'junior' ? 2 : 3;
  const secondaryCount = level === 'junior' ? 0 : level === 'mid' ? 1 : 2;
  const primary = eligible.slice(0, primaryCount).map((a) => `• ${fillTokens(a.text, vars)}`);
  const secondary = eligible.slice(primaryCount, primaryCount + secondaryCount).map((a) => `• ${fillTokens(a.text, vars)}`);

  // Weave a couple of the user's real (out-of-ladder) skills into mid/senior.
  const skillLine =
    level === 'junior' ? expected.join(', ') : Array.from(new Set([...expected, ...extraSkills])).join(', ');

  const head = [
    'Alex Martin',
    `${family.titleNoun} ${LEVEL_LABEL[level]}`,
    'Paris, France · alex.martin@email.fr · +33 6 12 34 56 78 · linkedin.com/in/alexmartin'
  ].join('\n');

  const summary = fillTokens(c.summary[level], vars);

  // Role titles (current + previous), scaled by level.
  const roleTitles: Record<SampleLevel, [string, string]> = {
    junior: ['Stage — Développeur Junior · Studio Web (2024, 6 mois)', 'Projets personnels'],
    mid: ['Développeur · Scale-up (2022–présent)', 'Développeur Junior · Agence (2020–2022)'],
    senior: ['Lead technique · Scale-up (2019–présent)', 'Développeur · EdTech (2016–2019)']
  };
  const [role1Title, role2Title] = roleTitles[level];

  const exp: string[] = [role1Title, ...primary];
  if (level === 'junior') {
    // Junior CVs live on deployed projects — a key entry-level signal.
    exp.push('', role2Title, ...c.projects.map((p) => `• ${fillTokens(p, vars)}`));
  } else {
    exp.push('', role2Title, ...secondary);
  }

  return [head, `Profil\n${summary}`, '', `Expérience\n${exp.join('\n')}`, '', `Compétences\n${skillLine}`, '', `Formation\n${c.education[level]}`].join('\n');
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
  if (level === 'senior' && weak('leadership')) gaps.push("Pas de signal de mentorat / encadrement d'équipe, attendu à ce niveau.");
  if (level === 'senior' && weak('architecture')) gaps.push("Aucune conception d'architecture ou de microservices mise en avant.");
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
  if (strong('architecture')) strengths.push("Conception d'architecture mise en avant, au niveau attendu.");
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
  if (weak('ownership')) steps.push("Réécrivez vos puces en verbes d'action avec un résultat mesurable.");
  if (level === 'senior' && weak('leadership')) steps.push('Ajoutez une ligne sur le mentorat / l\'encadrement d\'équipe.');
  if (level === 'senior' && weak('architecture')) steps.push("Décrivez un projet d'architecture que vous avez conduit de bout en bout.");

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
