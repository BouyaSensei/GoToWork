/**
 * Shared domain types for GoToWork.
 * These are the single source of truth consumed by both the Electron main
 * process (backend engines) and the React renderer (UI). Keep them serializable:
 * everything crossing the IPC bridge must be plain JSON.
 */

/* ------------------------------------------------------------------ */
/*  AI providers                                                       */
/* ------------------------------------------------------------------ */

export type ProviderKind = 'ollama' | 'lmstudio' | 'openai-compatible';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** Human label shown in the UI, e.g. "Ollama (local)". */
  label: string;
  /** Base URL, e.g. http://127.0.0.1:11434/v1 for Ollama's OpenAI-compat endpoint. */
  baseUrl: string;
  /** Optional API key. Local providers usually leave this empty. */
  apiKey?: string;
  /** Model name, e.g. "qwen2.5-coder:7b" or "local-model". */
  model: string;
  enabled: boolean;
}

export interface ProviderHealth {
  providerId: string;
  reachable: boolean;
  models?: string[];
  error?: string;
  latencyMs?: number;
}

/** A single chat completion request/response, normalized across providers. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When true the provider must return strict JSON (we parse defensively). */
  jsonMode?: boolean;
}

/* ------------------------------------------------------------------ */
/*  CV analysis                                                        */
/* ------------------------------------------------------------------ */

export interface ContactInfo {
  email?: string;
  phone?: string;
  linkedin?: string;
  location?: string;
  website?: string;
}

/** Structured data extracted from a raw CV document. */
export interface ParsedCV {
  sourceFile: string;
  rawText: string;
  contact: ContactInfo;
  sections: Record<string, string>;
  /** Detected seniority band, inferred from years of experience + keywords. */
  seniority: SeniorityBand;
  estimatedYearsOfExperience: number;
  skills: string[];
  title?: string;
}

export type SeniorityBand = 'junior' | 'mid' | 'senior' | 'lead';

/* ------------------------------------------------------------------ */
/*  ATS analysis                                                       */
/* ------------------------------------------------------------------ */

export type AtsSystemName =
  | 'Workday'
  | 'Greenhouse'
  | 'Lever'
  | 'iCIMS'
  | 'SAP SuccessFactors'
  | 'SmartRecruiters'
  | 'BambooHR'
  | 'Taleo';

export interface AtsCheck {
  id: string;
  label: string;
  /** 0..1 score for this individual check. */
  score: number;
  passed: boolean;
  detail: string;
}

export interface AtsSystemReport {
  system: AtsSystemName;
  popularity: 'popular' | 'niche';
  overallScore: number; // 0..1
  checks: AtsCheck[];
}

export interface AtsReport {
  cvFile: string;
  /** Aggregate readability score across all systems, 0..1. */
  aggregateScore: number;
  perSystem: AtsSystemReport[];
  topIssues: string[];
  recommendations: string[];
}

/* ------------------------------------------------------------------ */
/*  AI-slop detection                                                  */
/* ------------------------------------------------------------------ */

export interface SlopFinding {
  id: string;
  category: 'cliche' | 'buzzword' | 'vague' | 'overclaim' | 'formatting';
  term: string;
  count: number;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

export interface SlopReport {
  cvFile: string;
  /** 0 = clean, 1 = heavy AI-slop. */
  slopScore: number;
  findings: SlopFinding[];
  verdict: 'clean' | 'mild' | 'sloppy';
  summary: string;
}

/* ------------------------------------------------------------------ */
/*  Job search & matching                                              */
/* ------------------------------------------------------------------ */

export interface JobPosting {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  /** Detected seniority requirement from the posting text. */
  requiredSeniority: SeniorityBand;
  salary?: string;
  url: string;
  source: string; // e.g. 'indeed', 'linkedin', 'handwritten'
  description: string;
  postedAt?: string;
}

export interface MatchScore {
  jobId: string;
  /** Overall 0..1 fit between the CV and this posting. */
  score: number;
  seniorityFit: SeniorityBand; // effective band after down/up-weighting
  skillMatches: string[];
  skillGaps: string[];
  reasons: string[];
  /** Whether the mode's guardrails allow auto-applying to this posting. */
  eligibleForAutoApply: boolean;
}

export type SearchMode = 'basic' | 'hybrid' | 'total';

export interface SearchRun {
  id: string;
  mode: SearchMode;
  query: string;
  createdAt: number;
  status: 'idle' | 'searching' | 'awaiting-approval' | 'applying' | 'done' | 'error';
  results: MatchScore[];
  appliedJobIds: string[];
  log: LogEntry[];
  /** The job currently awaiting user approval (hybrid mode), if any. */
  pendingApproval?: { jobId: string; title: string; company: string };
}

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

/* ------------------------------------------------------------------ */
/*  Application tracking                                               */
/* ------------------------------------------------------------------ */

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

export interface Application {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string;
  url: string;
  status: ApplicationStatus;
  submittedAt?: number;
  note?: string;
}

/* ------------------------------------------------------------------ */
/*  Profile (the predefined popular fields)                            */
/* ------------------------------------------------------------------ */

export interface UserProfile {
  fullName: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  portfolioUrl?: string;
  location?: string;
  /** Cover letter / motivation letter body, scanned by the AI. */
  coverLetter: string;
}

/* ------------------------------------------------------------------ */
/*  Chatbot                                                            */
/* ------------------------------------------------------------------ */

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}
