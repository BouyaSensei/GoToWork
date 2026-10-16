/**
 * AI review engine — a recruiter-perspective read of the CV by the local model.
 *
 * The deterministic parts (prompt building + response validation) live here and
 * are unit-testable; the actual model call goes through LocalAIProvider.complete.
 * Any failure surfaces as ProviderError so the service can decide to return
 * nothing for this section instead of fake/template content.
 */

import type { CvAiReport, ParsedCV } from '../../shared/types';
import { extractJson, LocalAIProvider, ProviderError } from '../ai/provider';

const MAX_ITEMS = 6;
const MAX_ITEM_LEN = 200;
const MAX_VERDICT_LEN = 400;

/** Local models are slow (model load + long generation): a full CV review can
 *  take several minutes on CPU. Generous timeout so the first call survives. */
export const CV_AI_TIMEOUT_MS = 300_000;

/** Build the prompt for the AI review. Pure and testable. */
export function buildCvAiPrompt(cv: ParsedCV): string {
  const skills = cv.skills.length ? cv.skills.join(', ') : 'aucune détectée';
  return [
    "Tu es un recruteur expérimenté. Analyse le CV ci-dessous et réponds UNIQUEMENT avec un objet JSON valide de cette forme exacte :",
    '{"verdict": "<appréciation globale en 1-2 phrases>", "strengths": ["..."], "weaknesses": ["..."], "recommendations": ["..."]}',
    "Règles :",
    "- Réponds en français, de façon concrète et factuelle (aucun buzzword, aucune formule creuse).",
    `- Chaque liste contient 3 à ${MAX_ITEMS} éléments courts (moins de ${MAX_ITEM_LEN} caractères chacun).`,
    "- Ne jamais inventer d'information qui ne figure pas dans le CV.",
    "",
    `Poste détecté : ${cv.title ?? 'inconnu'}`,
    `Seniorité : ${cv.seniority} (~${cv.estimatedYearsOfExperience} ans)`,
    `Compétences détectées : ${skills}`,
    "---",
    cv.rawText
  ].join('\n');
}

/** Parse + validate the model's raw output. Throws ProviderError on garbage. */
export function parseCvAiReport(raw: string): CvAiReport {
  const obj = extractJson<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== 'object') {
    throw new ProviderError('Réponse IA illisible (JSON attendu)', '');
  }
  const verdict = cleanText(obj.verdict, MAX_VERDICT_LEN);
  if (!verdict) {
    throw new ProviderError('Réponse IA incomplète (verdict manquant)', '');
  }
  return {
    verdict,
    strengths: cleanList(obj.strengths),
    weaknesses: cleanList(obj.weaknesses),
    recommendations: cleanList(obj.recommendations)
  };
}

/** Run the AI review against a provider. Throws ProviderError on any failure. */
export async function analyzeCvWithAI(
  provider: LocalAIProvider,
  cv: ParsedCV
): Promise<CvAiReport> {
  const raw = await provider.complete({
    messages: [{ role: 'user', content: buildCvAiPrompt(cv) }],
    temperature: 0.3,
    maxTokens: 1200
  });
  return parseCvAiReport(raw);
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, MAX_ITEM_LEN))
    .filter((x) => x.length > 0)
    .slice(0, MAX_ITEMS);
}
