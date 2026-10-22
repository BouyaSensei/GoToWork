/**
 * AI highlight engine — the "détail avancé" of the CV analysis.
 *
 * The local model reads the CV and returns a list of issues, each anchored by
 * a verbatim substring of the CV text (`match`) plus a severity:
 *   - critical    → bloque ou dégrade le recrutement (rouge)
 *   - improvement → axe d'amélioration facultatif (orange)
 *
 * The parser resolves every anchor to exact offsets into `rawText` — verbatim
 * first, then whitespace-normalized (local models routinely rewrite line
 * breaks and double spaces). Anchors that cannot be resolved are dropped, so
 * hallucinated highlights never render. The renderer only slices by offset.
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
    "- `match` : citez un fragment court et distinctif du passage à signaler (5 à 15 mots), tel qu'il est écrit dans le CV — sans reformuler, sans ellipse « … ».",
    "- Choisis 3 à 8 passages distincts, chacun court (une phrase ou moins).",
    '- severity "critical" : un problème qui bloque ou dégrade sérieusement le recrutement (coordonnées manquantes ou illisibles, fautes d\'orthographe, dates incohérentes, allégations vagues sans chiffre, section vide ou cassée).',
    '- severity "improvement" : un axe d\'amélioration facultatif (formulation perfectible, ordre des sections, mot-clé manquant, mise en avant insuffisante).',
    "- `note` : une explication courte et actionnable, en français, moins de 160 caractères.",
    "- Ne jamais inventer de passage qui n'existe pas dans le CV.",
    "- N'utilise JAMAIS de guillemets doubles à l'intérieur des valeurs (utilise « » si besoin) — c'est la première cause de JSON invalide.",
    "- Échappe correctement les guillemets doubles à l'intérieur des chaînes JSON.",
    "",
    `Poste détecté : ${cv.title ?? 'inconnu'}`,
    "---",
    cv.rawText
  ].join('\n');
}

/** Parse + validate the model's raw output. Throws ProviderError on garbage,
 *  including a snippet of the raw answer so failures are diagnosable.
 *  Each anchor is resolved to offsets in `cvText` (verbatim first, then
 *  whitespace-normalized); unresolvable anchors are dropped (hallucination guard). */
export function parseCvHighlights(raw: string, cvText: string): CvHighlight[] {
  const obj = extractJson<Record<string, unknown>>(raw);
  if (!obj || typeof obj !== 'object') {
    throw new ProviderError(
      `Réponse IA illisible (JSON attendu) — début de la réponse : « ${raw.trim().slice(0, 120)} »`,
      ''
    );
  }
  const list = Array.isArray(obj.highlights) ? obj.highlights : [];
  const index = buildNormalizedIndex(cvText);
  const out: CvHighlight[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const match =
      typeof o.match === 'string' ? o.match.trim().slice(0, MAX_MATCH_LEN) : '';
    if (!match) continue;
    // Hallucination guard: the anchor must exist in the CV.
    const span = resolveAnchor(cvText, index, match);
    if (!span) continue;
    out.push({
      start: span[0],
      end: span[1],
      severity: normalizeSeverity(o.severity),
      note: typeof o.note === 'string' ? o.note.trim().slice(0, MAX_NOTE_LEN) : ''
    });
    if (out.length >= MAX_HIGHLIGHTS) break;
  }
  return out;
}

/** Whitespace runs collapsed to single spaces, plus a map from each normalized
 *  position back to its original index — lets near-verbatim anchors resolve. */
function buildNormalizedIndex(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      // One space per whitespace run, mapped to the run's first char.
      if (norm.length > 0 && !/\s/.test(norm[norm.length - 1])) {
        norm += ' ';
        map.push(i);
      }
    } else {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

/** Resolve a model anchor to [start, end) in the original text, or null. */
function resolveAnchor(
  cvText: string,
  index: { norm: string; map: number[] },
  match: string
): [number, number] | null {
  const verbatim = cvText.indexOf(match);
  if (verbatim !== -1) return [verbatim, verbatim + match.length];
  // Models rewrite whitespace: retry on the collapsed form.
  const needle = match.replace(/\s+/g, ' ').trim();
  if (!needle) return null;
  const at = index.norm.indexOf(needle);
  if (at === -1) return null;
  const lastNorm = at + needle.length - 1;
  return [index.map[at], index.map[lastNorm] + 1];
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
