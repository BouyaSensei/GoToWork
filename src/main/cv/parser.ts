/**
 * CV document parser.
 *
 * Reads a .pdf or .docx file from disk and produces a structured `ParsedCV`.
 * Extraction is deliberately heuristic + deterministic (no AI required for the
 * structural pass): we parse text, split into sections, pull contact fields
 * with regexes, mine a skill vocabulary, and infer seniority from years of
 * experience plus title keywords. The AI layer can later enrich this, but the
 * core structure is reproducible and unit-testable offline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContactInfo, ParsedCV, SeniorityBand } from '../../shared/types';

// pdf-parse and mammoth are CommonJS; esModuleInterop gives us their default exports.
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

export class CVParseError extends Error {
  constructor(message: string, public readonly file?: string) {
    super(message);
    this.name = 'CVParseError';
  }
}

/** Known section headers (normalized to lowercase for matching). */
const SECTION_HEADERS: Record<string, string> = {
  summary: 'Summary',
  profile: 'Profile',
  experience: 'Experience',
  employment: 'Employment',
  work: 'Work History',
  education: 'Education',
  skills: 'Skills',
  skillset: 'Skill Set',
  projects: 'Projects',
  certifications: 'Certifications',
  languages: 'Languages',
  awards: 'Awards'
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{2,4})?/;
const LINKEDIN_RE = /linkedin\.com\/(?:in|pub)\/[a-zA-Z0-9_\-/%.]+/i;
const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/i;

/** A curated skill vocabulary for mining (English + French, common tech roles). */
const SKILL_VOCAB: string[] = [
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'c++', 'c#', 'php', 'ruby',
  'react', 'next.js', 'vue', 'angular', 'svelte', 'node.js', 'electron', 'express',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform', 'ansible', 'git', 'ci/cd',
  'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'grpc', 'sql', 'nosql',
  'linux', 'bash', 'powershell', 'kafka', 'rabbitmq', 'elasticsearch', 'nginx',
  'machine learning', 'pytorch', 'tensorflow', 'llm', 'nlp', 'data analysis',
  'figma', 'ui/ux', 'html', 'css', 'tailwind', 'vite', 'webpack', 'jest', 'cypress',
  'agile', 'scrum', 'microservices', 'system design', 'testing', 'tdd'
];

export interface ParseOptions {
  /** Override the detected source file name (for in-memory tests). */
  sourceFile?: string;
}

export async function parseCV(filePath: string, opts: ParseOptions = {}): Promise<ParsedCV> {
  const abs = path.resolve(filePath);
  const ext = path.extname(abs).toLowerCase();
  let text: string;

  if (ext === '.pdf') {
    const buf = await fs.readFile(abs);
    const result = await pdfParse(buf);
    text = result.text ?? '';
  } else if (ext === '.docx') {
    const buf = await fs.readFile(abs);
    const result = await mammoth.extractRawText({ buffer: buf });
    text = result.value ?? '';
  } else if (ext === '.txt' || ext === '.md') {
    text = await fs.readFile(abs, 'utf-8');
  } else {
    throw new CVParseError(`Unsupported file type "${ext}" (expected .pdf, .docx, .txt)`, abs);
  }

  const normalized = normalizeWhitespace(text);
  if (normalized.trim().length < 40) {
    throw new CVParseError('Document appears to be empty or has no extractable text', abs);
  }

  const contact = extractContact(normalized);
  const sections = splitSections(normalized);
  const skills = mineSkills(normalized, sections['skills'] ?? '');
  const years = estimateYears(normalized, sections['experience'] ?? '');
  const seniority = inferSeniority(years, normalized);
  const title = detectTitle(normalized);

  return {
    sourceFile: opts.sourceFile ?? path.basename(abs),
    rawText: normalized,
    contact,
    sections,
    seniority,
    estimatedYearsOfExperience: years,
    skills,
    title
  };
}

/* ------------------------- contact extraction ---------------------- */

export function extractContact(text: string): ContactInfo {
  const email = text.match(EMAIL_RE)?.[0];
  const linkedin = text.match(LINKEDIN_RE)?.[0];
  const website = text.match(URL_RE)?.[0];

  // Phone: prefer a token that starts with + or a country code and has >= 9 digits.
  let phone: string | undefined;
  const candidates = text.match(PHONE_RE) ?? [];
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) {
      phone = c.trim();
      break;
    }
  }

  // Location: a line that looks like "City, Country" near the top.
  const location = detectLocation(text);

  return { email, phone, linkedin, website, location };
}

function detectLocation(text: string): string | undefined {
  const lines = text.split('\n').slice(0, 12);
  for (const line of lines) {
    const t = line.trim();
    // Heuristic: "City, Country" with a comma and short words, no digits/emails.
    if (/^[A-ZÀ-Ý][\w'’-]+(,\s*[A-ZÀ-Ý][\w'’-]+)+$/.test(t) && t.length < 40 && !EMAIL_RE.test(t)) {
      return t;
    }
  }
  return undefined;
}

/* --------------------------- section split ------------------------- */

export function splitSections(text: string): Record<string, string> {
  const lines = text.split('\n');
  const sections: Record<string, string> = {};
  let currentKey = 'overview';
  sections[currentKey] = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const lower = line.toLowerCase().replace(/[:：\s]+$/, '');
    if (line.length < 30 && SECTION_HEADERS[lower]) {
      currentKey = lower;
      sections[currentKey] = '';
      continue;
    }
    sections[currentKey] += `${rawLine}\n`;
  }

  // Trim and drop empties.
  for (const k of Object.keys(sections)) {
    sections[k] = sections[k].trim();
  }
  return sections;
}

/* ----------------------------- skill mining ------------------------ */

export function mineSkills(fullText: string, skillsSection: string): string[] {
  const haystack = `${skillsSection}\n${fullText}`.toLowerCase();
  const found = new Set<string>();
  for (const skill of SKILL_VOCAB) {
    // Word-boundary match so "go" doesn't match inside "google".
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(haystack)) found.add(skill);
  }
  return Array.from(found).sort();
}

/* --------------------------- seniority logic ----------------------- */

export function estimateYears(text: string, experienceSection: string): number {
  // Direct "X years of experience" statement wins.
  const explicit = text.match(/(\d{1,2})\s*\+?\s*years?/i);
  if (explicit) return parseInt(explicit[1], 10);

  // Fallback heuristic: estimate from the number of role blocks in the
  // experience section (each blank-line-separated block ≈ one role).
  const blocks = (experienceSection.match(/\n\s*\n/g) ?? []).length;
  return Math.min(40, Math.max(1, blocks * 2));
}

export function inferSeniority(years: number, text: string): SeniorityBand {
  const t = text.toLowerCase();
  // Explicit title keywords override the years heuristic.
  if (/\b(lead|principal|staff|architect|head of|vp|director)\b/.test(t)) return 'lead';
  if (/\bsenior\b/.test(t)) return 'senior';
  if (/\b(junior|jun\.|entry[- ]level|intern|graduate|débutant)\b/.test(t)) return 'junior';

  if (years >= 8) return 'senior';
  if (years >= 4) return 'mid';
  return 'junior';
}

function detectTitle(text: string): string | undefined {
  // First non-empty line that is short and not a contact field is often the title.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 6)) {
    if (line.length > 40) continue;
    if (EMAIL_RE.test(line) || LINKEDIN_RE.test(line) || PHONE_RE.test(line)) continue;
    if (/^(summary|profile|experience|education|skills)/i.test(line)) continue;
    // Title-like: contains a role noun.
    if (/\b(developer|engineer|designer|analyst|manager|consultant|scientist|architect|devops)\b/i.test(line)) {
      return line;
    }
  }
  return undefined;
}

/* ------------------------------ utils ------------------------------ */

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\u00a0/g, ' ');
}
