/**
 * Job-source abstraction.
 *
 * A `JobSource` yields candidate `JobPosting`s for a query. We ship one source
 * that always works — the manual source, where the user pastes postings (or a
 * block of them) and we parse them into structured records. Remote sources
 * (RSS feeds, public APIs, or a browser-automation bridge) plug in behind the
 * same interface so they can be added without touching the matcher or UI.
 *
 * We deliberately do NOT ship a scraper for Indeed/LinkedIn: those sites are
 * bot-walled and scraping them violates their ToS. The manual source + optional
 * user-supplied RSS/API sources is the honest, durable design. A browser bridge
 * (the app can drive the user's own logged-in session) is the sanctioned path
 * for "apply on my behalf" in total mode.
 */

import type { JobPosting } from '../../shared/types';
import { detectRequiredSeniority, hashString, parseManualPostings } from '../../shared/manualPostings';

export interface JobSource {
  readonly id: string;
  readonly label: string;
  /** Fetch postings matching a free-text query. */
  search(query: string): Promise<JobPosting[]>;
}

/* ----------------------------- manual source ----------------------- */

/** A JobSource backed by a user-pasted blob. */
export class ManualJobSource implements JobSource {
  readonly id = 'manual';
  readonly label = 'Manual / pasted postings';
  constructor(private readonly blob: string) {}
  async search(): Promise<JobPosting[]> {
    return parseManualPostings(this.blob);
  }
}

/* ----------------------------- RSS source -------------------------- */

/** A minimal RSS/Atom job-feed source for sites that expose a public feed.
 *  Parses <item><title>/<link>/<description> into postings. No auth required
 *  for public feeds; user supplies the feed URL. */
export class RssJobSource implements JobSource {
  readonly id: string;
  readonly label: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly feedUrl: string,
    label?: string,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {
    this.id = `rss_${hashString(feedUrl)}`;
    this.label = label ?? 'RSS feed';
    this.fetchImpl = fetchImpl;
  }

  async search(): Promise<JobPosting[]> {
    const res = await this.fetchImpl(this.feedUrl);
    if (!res.ok) throw new Error(`Feed request failed: HTTP ${res.status}`);
    const xml = await res.text();
    return parseRss(xml, this.label);
  }
}

export function parseRss(xml: string, sourceLabel: string): JobPosting[] {
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map((m) => m[0]);
  if (items.length === 0) {
    // Atom fallback.
    return [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)]
      .map((m) => m[0])
      .map((entry, i) => atomToPosting(entry, i, sourceLabel));
  }
  return items.map((item, i) => rssItemToPosting(item, i, sourceLabel));
}

function field(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim()) : '';
}

function rssItemToPosting(item: string, i: number, sourceLabel: string): JobPosting {
  const title = field(item, 'title') || `Posting ${i + 1}`;
  const link = field(item, 'link');
  const description = stripHtml(field(item, 'description'));
  return toPosting(title, link, description, i, sourceLabel);
}

function atomToPosting(entry: string, i: number, sourceLabel: string): JobPosting {
  const title = field(entry, 'title') || `Posting ${i + 1}`;
  const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
  const summary = stripHtml(field(entry, 'summary') || field(entry, 'content'));
  return toPosting(title, linkMatch?.[1] ?? '#', summary, i, sourceLabel);
}

function toPosting(title: string, url: string, description: string, i: number, sourceLabel: string): JobPosting {
  return {
    id: `rss_${i}_${hashString(url + title)}`,
    title,
    company: 'Unknown',
    location: '—',
    remote: /remote|télétravail/i.test(description),
    requiredSeniority: detectRequiredSeniority(`${title}\n${description}`),
    url,
    source: sourceLabel,
    description,
    postedAt: new Date().toISOString()
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
