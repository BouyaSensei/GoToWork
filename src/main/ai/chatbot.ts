/**
 * Chatbot service.
 *
 * Wraps a `LocalAIProvider` with a job-search-aware system prompt. The context
 * (CV summary, ATS/slop scores, current search run status) is injected into the
 * system message so the assistant can answer "how's my search going?", "which
 * jobs are worth applying to?", "why did I not get auto-applied to X?" etc.
 *
 * The service keeps a rolling conversation buffer (bounded) and streams nothing
 * — it returns completed turns, which is simpler over IPC and matches how the
 * renderer renders messages.
 */

import type { ChatMessage, ProviderConfig } from '../../shared/types';
import { LocalAIProvider } from './provider';

export interface ChatContext {
  /** One-paragraph summary of the parsed CV (title, seniority, top skills). */
  cvSummary?: string;
  atsScore?: number;
  slopVerdict?: string;
  /** Live status line for the active search run, if any. */
  searchStatus?: string;
  /** The user's name, so the assistant can address them. */
  userName?: string;
}

const MAX_TURNS = 20;

export class Chatbot {
  private history: ChatMessage[] = [];

  constructor(private readonly provider: LocalAIProvider) {}

  async ask(userMessage: string, ctx: ChatContext): Promise<string> {
    const system = buildSystemPrompt(ctx);
    this.history.push({ role: 'user', content: userMessage });
    // Keep the window bounded.
    if (this.history.length > MAX_TURNS) this.history = this.history.slice(-MAX_TURNS);

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...this.history
    ];

    const reply = await this.provider.complete({
      messages,
      temperature: 0.6,
      maxTokens: 700
    });

    this.history.push({ role: 'assistant', content: reply });
    if (this.history.length > MAX_TURNS) this.history = this.history.slice(-MAX_TURNS);
    return reply;
  }

  reset(): void {
    this.history = [];
  }
}

function buildSystemPrompt(ctx: ChatContext): string {
  const parts: string[] = [
    'You are GoToWork, a job-search copilot running inside a desktop app.',
    'Be concise, practical and honest. Answer in the user\'s language (default French).',
    'Never fabricate job results; only reference what is provided in context.'
  ];

  if (ctx.userName) parts.push(`The user's name is ${ctx.userName}.`);
  if (ctx.cvSummary) parts.push(`CV summary: ${ctx.cvSummary}`);
  if (typeof ctx.atsScore === 'number') {
    parts.push(`ATS readability score: ${(ctx.atsScore * 100).toFixed(0)}%.`);
  }
  if (ctx.slopVerdict) parts.push(`AI-slop verdict: ${ctx.slopVerdict}.`);
  if (ctx.searchStatus) parts.push(`Current search status: ${ctx.searchStatus}`);

  return parts.join('\n');
}

/** Build a chatbot from a provider config (helper for the main entry). */
export function createChatbot(config: ProviderConfig): Chatbot {
  return new Chatbot(new LocalAIProvider(config));
}
