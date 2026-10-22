/**
 * AI highlight engine — the "détail avancé" of the CV analysis.
 *
 * The local model reads the CV and returns a list of issues, each anchored by
 * an EXACT verbatim substring of the CV text (`match`) plus a severity:
 *   - critical    → bloque ou dégrade le recrutement (rouge)
 *   - improvement → axe d'amélioration facultatif (orange)
 *
 * The renderer wraps each `match` in the raw text — no character offsets,
 * which local models cannot be trusted to count. Any `match` that is not found
 * verbatim in the CV is dropped, so hallucinated highlights never render.
 */

import type { CvHighlight, ParsedCV } from '../../shared/types';
import { extractJson, LocalAIProvider, ProviderError } from '../ai/provider';

const MAX_HIGHLIGHTS = 15;
const MAX_MATCH_LEN = 300;
const MAX_NOTE_LEN = 200;

/** Build the prompt for the highlight pass. Pure and testable. */
export function buildCvHighlightPrompt(cv: ParsedCV): string {
  return [
    "Tu es un recruteur expérimenté. Relis le CV ci-dessous et signale les passages à corriger ou améliorer, en répondant UNIQUEMENT avec un objet JSON valide de cette forme exacte, sans aucun texte avant ou après, sans balises markdown :",
    '{"highlights": [{"match": "<passage exact du CV>", "severity": "critical" ou "improvement", "note": "<explication courte>"}]}',
    "Règles :",
    "- `match` DOIT être un extrait COPIÉ COLLÉ mot pour mot du CV (même orthographe, même ponctuation) — jamais de reformulation, jamais d'ellipse « … ».",
    "- Choisis 4 à 12 passages distincts, chacun court (une phrase ou moins).",
    '- severity "critical" : un problème qui bloque ou dégrade sérieusement le recrutement (coordonnées manquantes ou illisibles, fautes d\'orthographe, dates incohérentes, allégations vagues sans chiffre, section vide ou cassée).',
    '- severity "improvement" : un axe d\'amélioration facultatif (formulation perfectible, ordre des sections, mot-clé manquant, mise en avant insuffisante).',
    "- `note` : une explication courte et actionnable, en français, moins de 160 caractères.",
    "- Ne jamais inventer de passage qui n'existe pas dans le CV.",
    "- Échappe correctement les guillemets doubles à l'intérieur des chaînes JSON.",
    "",
    `Poste détecté : ${cv.title ?? 'inconnu'}`,
    "---",
    cv.rawText
  ].join('\n');
}

/** Parse + validate the model's raw output. Throws ProviderError on garbage,
 *  including a snippet of the raw answer so failures are diagnosable.
 *  Matches not found verbatim in `cvText` are dropped (hallucination guard). */
export function parseCvHighlights(raw: string, cvText: string): CvHighlight[] {
  const obj = extractJson<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== 'object') {
    throw new ProviderError(
      `Réponse IA illisible (JSON attendu) — début de la réponse : « ${raw.trim().slice(0, 120)} »`,
      ''
    );
  }
  const list = Array.isArray(obj.highlights) ? obj.highlights : [];
  const out: CvHighlight[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const match =
      typeof o.match === 'string' ? o.match.trim().slice(0, MAX_MATCH_LEN) : '';
    if (!match) continue;
    // Hallucination guard: the anchor must exist verbatim in the CV.
    if (cvText.indexOf(match) === -1) continue;
    out.push({
      match,
      severity: normalizeSeverity(o.severity),
      note: typeof o.note === 'string' ? o.note.trim().slice(0, MAX_NOTE_LEN) : ''
    });
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

/** Tolerate the variants small models emit; anything unknown is a soft issue. */
function normalizeSeverity(value: unknown): 'critical' | 'improvement' {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (s === 'critical' || s === 'critique' || s === 'bloquant' || s === 'grave') return 'critical';
  return 'improvement';
}

/** Run the highlight pass against a provider. Throws ProviderError on any failure. */
export async function highlightCvWithAI(
  provider: LocalAIProvider,
  cv: ParsedCV
): Promise<CvHighlight[]> {
  const raw = await provider.complete({
    messages: [{ role: 'user', content: buildCvHighlightPrompt(cv) }],
    temperature: 0.3,
    maxTokens: 2048
  });
  return parseCvHighlights(raw, cv.rawText);
}
