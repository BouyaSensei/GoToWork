/**
 * AI review engine — a recruiter-perspective read of the CV by the local model.
 *
 * The deterministic parts (prompt building + response validation) live here and
 * are unit-testable; the actual model call goes through LocalAIProvider.complete.
 * Any failure surfaces as ProviderError so the service can decide to return
 * nothing for this section instead of fake/template content.
 */

import type { CvAiReport, CvSkillGroup, ParsedCV } from '../../shared/types';
import { extractJson, LocalAIProvider, ProviderError } from '../ai/provider';

const MAX_ITEMS = 6;
const MAX_ITEM_LEN = 200;
const MAX_VERDICT_LEN = 400;
const MAX_COMMENT_LEN = 300;
const MAX_SKILLS = 8;

/** Local models are slow (model load + long generation): a full CV review can
 *  take several minutes on CPU. Generous timeout so the first call survives. */
export const CV_AI_TIMEOUT_MS = 300_000;

/** Build the prompt for the AI review. Pure and testable. */
export function buildCvAiPrompt(cv: ParsedCV): string {
  const skills = cv.skills.length ? cv.skills.join(', ') : 'aucune détectée';
  return [
    "Tu es un recruteur expérimenté. Analyse le CV ci-dessous et réponds UNIQUEMENT avec un objet JSON valide de cette forme exacte, sans aucun texte avant ou après, sans balises markdown :",
    '{"verdict": "<appréciation globale en 1-2 phrases>", "atsScore": <note de lisibilité ATS, nombre entier entre 0 et 100>, "atsComment": "<commentaire sur la lisibilité ATS en 1 phrase>", "role": "<poste visé tel que lu dans le CV>", "seniority": "<junior, mid ou senior, avec nuance courte>", "skillGroups": [{"cat": "<catégorie>", "items": ["<compétences>"]}], "strengths": ["..."], "weaknesses": ["..."], "recommendations": ["..."]}',
    "Règles :",
    "- Réponds en français, de façon concrète et factuelle (aucun buzzword, aucune formule creuse).",
    "- atsScore est un nombre entier entre 0 et 100, sans texte autour.",
    `- Regroupe les compétences clés du CV en 2 à ${MAX_SKILLS + 2} éléments au total, répartis en 2 à 5 catégories qui reflètent ce qu'elles sont (ex. Frontend, Backend, IA, Outils, Soft skills).`,
    "- Si le CV comporte une section centres d'intérêt ou loisirs, ajoute une catégorie « Intérêts » avec ces éléments.",
    `- Chaque liste contient 3 à ${MAX_ITEMS} éléments courts (moins de ${MAX_ITEM_LEN} caractères chacun).`,
    "- Ne jamais inventer d'information qui ne figure pas dans le CV.",
    "- Échappe correctement les guillemets doubles à l'intérieur des chaînes JSON.",
    "",
    `Poste détecté : ${cv.title ?? 'inconnu'}`,
    `Seniorité : ${cv.seniority} (~${cv.estimatedYearsOfExperience} ans)`,
    `Compétences détectées : ${skills}`,
    "---",
    cv.rawText
  ].join('\n');
}

/** Parse + validate the model's raw output. Throws ProviderError on garbage,
 *  including a snippet of the raw answer so failures are diagnosable. */
export function parseCvAiReport(raw: string): CvAiReport {
  const obj = extractJson<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== 'object') {
    throw new ProviderError(
      `Réponse IA illisible (JSON attendu) — début de la réponse : « ${raw.trim().slice(0, 120)} »`,
      ''
    );
  }
  const verdict = cleanText(obj.verdict, MAX_VERDICT_LEN);
  if (!verdict) {
    throw new ProviderError('Réponse IA incomplète (verdict manquant)', '');
  }
  let skillGroups = cleanSkillGroups(obj.skillGroups);
  if (!skillGroups.length) {
    // Older/shorter answers may carry a flat skills list — keep it as one group.
    const flat = cleanList(obj.skills, MAX_SKILLS);
    if (flat.length) skillGroups = [{ cat: 'Compétences', items: flat }];
  }
  return {
    verdict,
    atsScore: cleanScore(obj.atsScore),
    atsComment: cleanText(obj.atsComment, MAX_COMMENT_LEN),
    role: cleanText(obj.role, 120),
    seniority: cleanText(obj.seniority, 120),
    skillGroups,
    // Local models rename the list keys (French variants observed) — tolerate them,
    // or the Points forts / À améliorer columns silently come back empty.
    strengths: cleanList(obj.strengths ?? obj.pointsForts ?? obj.points_forts ?? obj.forces),
    weaknesses: cleanList(
      obj.weaknesses ?? obj.aAmeliorer ?? obj.a_ameliorer ?? obj.ameliorations ?? obj.toImprove
    ),
    recommendations: cleanList(obj.recommendations ?? obj.recommandations)
  };
}

/** Run the AI review against a provider. Throws ProviderError on any failure.
 *  Local 9B models are verbose: when the first answer is truncated (token
 *  limit) we show it back its own cut-off output and demand a shorter one —
 *  parseCvAiReport/extractJson already salvage a partial report as last resort. */
export async function analyzeCvWithAI(
  provider: LocalAIProvider,
  cv: ParsedCV
): Promise<CvAiReport> {
  const prompt = buildCvAiPrompt(cv);
  const firstRaw = await provider.complete({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    maxTokens: 4096
  });
  try {
    return parseCvAiReport(firstRaw);
  } catch (firstErr) {
    const raw = await provider.complete({
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: firstRaw },
        {
          role: 'user',
          content:
            "Ta réponse précédente est coupée au milieu du JSON. Réponds à nouveau avec le JSON COMPLET et beaucoup plus concis : verdict en 1 phrase, atsComment en 1 phrase, 3 éléments max par liste, notes d'une ligne. UNIQUEMENT le JSON, sans texte autour."
        }
      ],
      temperature: 0.3,
      maxTokens: 4096
    });
    try {
      return parseCvAiReport(raw);
    } catch (secondErr) {
      throw secondErr instanceof Error ? secondErr : firstErr;
    }
  }
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/** Clamp an ATS score to 0-100; anything non-numeric becomes 0. */
function cleanScore(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Clean skill groups: tolerate key variants (cat/category/name, items/skills),
 *  drop empty groups, cap at 6 groups × 8 items. */
function cleanSkillGroups(value: unknown): CvSkillGroup[] {
  const groups: CvSkillGroup[] = [];
  if (!Array.isArray(value)) return groups;
  for (const g of value) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const cat = cleanText(o.cat ?? o.category ?? o.name, 60);
    const items = cleanList(o.items ?? o.skills ?? o.list, MAX_SKILLS);
    if (cat && items.length) groups.push({ cat, items });
    if (groups.length >= 6) break;
  }
  return groups;
}

function cleanList(value: unknown, maxItems = MAX_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, MAX_ITEM_LEN))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}
