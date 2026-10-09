/**
 * Manual postings parser — shared between main and renderer.
 *
 * Parses a pasted blob of job text into structured `JobPosting`s. Accepts one or
 * many blocks separated by blank lines; each block's first line may be
 * "Title | Company | Location | URL" with the description on the following
 * lines. Keeping this in @shared means the UI (preview) and the backend (match)
 * parse identically — no drift.
 */

import type { JobPosting, SeniorityBand } from './types';

export function parseManualPostings(blob: string): JobPosting[] {
  const blocks = blob
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const postings: JobPosting[] = [];
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    let title = lines[0].trim();
    let company = '';
    let location = '';
    let url = '';

    if (lines[0].includes('|') && lines.length > 1) {
      const parts = lines[0].split('|').map((p) => p.trim());
      title = parts[0] || `Posting ${i + 1}`;
      company = parts[1] ?? '';
      location = parts[2] ?? '';
      url = parts[3] ?? '';
    }

    const description = lines.slice(1).join('\n').trim() || title;
    // "Remote" often lives in the header's location field, so scan the whole block.
    const remote = /remote|télétravail|telecommute/i.test(block);
    postings.push({
      id: `manual_${i}_${hashString(block)}`,
      title,
      company: company || 'Unknown',
      location: location || '—',
      remote,
      requiredSeniority: detectRequiredSeniority(`${title}\n${description}`),
      url: url || '#',
      source: 'manual',
      description,
      postedAt: new Date().toISOString()
    });
  });

  return postings;
}

export function detectRequiredSeniority(text: string): SeniorityBand {
  const t = text.toLowerCase();
  if (/\b(lead|principal|staff|architect|head of|vp|director)\b/.test(t)) return 'lead';
  if (/\bsenior\b/.test(t)) return 'senior';
  if (/\b(junior|jun\.|entry[- ]level|intern|graduate|débutant|stagiaire)\b/.test(t)) return 'junior';
  return 'mid';
}

export function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
