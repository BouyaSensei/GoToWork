/**
 * AppService — the main-process orchestrator.
 *
 * Owns the persistent store, the active AI provider, the chatbot, and in-flight
 * search runs. The Electron main entry is a thin IPC router that delegates to
 * this class; keeping all real logic here means it can be unit-tested headless
 * (pass a temp userData dir + injected callbacks) without spinning up Electron.
 */

import { randomUUID } from 'node:crypto';
import type {
  Application,
  AtsReport,
  JobPosting,
  ParsedCV,
  ProviderConfig,
  ProviderHealth,
  SearchMode,
  SearchRun,
  SlopReport,
  UserProfile
} from '../shared/types';
import { IPC } from '../shared/ipc';
import { Store } from './store';
import { LocalAIProvider, ProviderError } from './ai/provider';
import { Chatbot } from './ai/chatbot';
import { parseCV } from './cv/parser';
import { analyzeATS } from './cv/ats';
import { detectSlop } from './cv/slop';
import { matchJobs } from './search/matcher';
import { SearchRunManager } from './search/runManager';

export interface AppServiceOptions {
  userDataDir: string;
  /** Called to push a search-run status update to the renderer. */
  onSearchStatus?: (run: SearchRun) => void;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

export class AppService {
  private readonly store: Store;
  private chatbot: Chatbot | null = null;
  /** runId → jobId → pending approval resolver (hybrid mode). */
  private approvals = new Map<string, Map<string, PendingApproval>>();
  private activeRun: SearchRunManager | null = null;

  constructor(private readonly opts: AppServiceOptions) {
    this.store = new Store(opts.userDataDir);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  /* ------------------------------ CV analysis ---------------------- */

  async parseCv(filePath: string): Promise<ParsedCV> {
    return parseCV(filePath);
  }

  analyzeAts(cv: ParsedCV): AtsReport {
    return analyzeATS(cv);
  }

  detectSlop(cv: ParsedCV): SlopReport {
    return detectSlop(cv);
  }

  /* ------------------------------ providers ------------------------ */

  listProviders(): ProviderConfig[] {
    return this.store.get().providers;
  }

  async saveProvider(p: ProviderConfig): Promise<void> {
    await this.store.update((s) => {
      const idx = s.providers.findIndex((x) => x.id === p.id);
      if (idx >= 0) s.providers[idx] = p;
      else s.providers.push(p);
      if (!s.activeProviderId) s.activeProviderId = p.id;
    });
    this.chatbot = null; // invalidate cached chatbot on provider change
  }

  async removeProvider(id: string): Promise<void> {
    await this.store.update((s) => {
      s.providers = s.providers.filter((p) => p.id !== id);
      if (s.activeProviderId === id) s.activeProviderId = s.providers[0]?.id;
    });
    this.chatbot = null;
  }

  async setActiveProvider(id: string): Promise<void> {
    await this.store.update((s) => {
      s.activeProviderId = id;
    });
    this.chatbot = null;
  }

  async providerHealth(providerId: string): Promise<ProviderHealth> {
    const cfg = this.store.get().providers.find((p) => p.id === providerId);
    if (!cfg) throw new ProviderError(`Unknown provider "${providerId}"`, providerId);
    return new LocalAIProvider(cfg).health();
  }

  private activeProvider(): LocalAIProvider {
    const s = this.store.get();
    const cfg = s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
    if (!cfg) throw new ProviderError('No AI provider configured. Add one in Settings.', '');
    return new LocalAIProvider(cfg);
  }

  /* ------------------------------ profile -------------------------- */

  getProfile(): UserProfile {
    return this.store.get().profile;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    await this.store.update((s) => {
      s.profile = profile;
    });
  }

  /* ------------------------------ search --------------------------- */

  async runSearch(req: {
    mode: SearchMode;
    query: string;
    postings?: JobPosting[];
    cv: ParsedCV;
  }): Promise<SearchRun> {
    const jobs = req.postings ?? [];

    // Holder so the approval callback can reference the manager before it is
    // assigned (breaks the circular closure).
    const ref: { current: SearchRunManager | null } = { current: null };
    const manager = new SearchRunManager(req.query, req.mode, {
      search: async () => jobs,
      apply: (job) => this.applyToJob(job),
      requestApproval: (job, match) =>
        this.requestApproval(ref.current!.current.id, job, match),
      onStatus: this.opts.onSearchStatus
    });
    ref.current = manager;

    // Compute matches with the full CV, then hand them to the manager.
    const matches = matchJobs(req.cv, jobs, { mode: req.mode });
    manager.setMatches(matches);

    this.activeRun = manager;
    return manager.execute();
  }

  /** Hybrid-mode approval gate: resolves when the renderer answers. */
  private requestApproval(runId: string, job: JobPosting, _match: unknown): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let perJob = this.approvals.get(runId);
      if (!perJob) {
        perJob = new Map();
        this.approvals.set(runId, perJob);
      }
      perJob.set(job.id, { resolve });
    });
  }

  respondApproval(runId: string, jobId: string, approved: boolean): void {
    const perJob = this.approvals.get(runId);
    const pending = perJob?.get(jobId);
    if (pending && perJob) {
      pending.resolve(approved);
      perJob.delete(jobId);
    }
  }

  /** Create an application record. Real web automation would live here; for
   *  now we record the intent and return a submitted application. */
  private async applyToJob(job: JobPosting): Promise<Application> {
    const app: Application = {
      id: randomUUID(),
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      url: job.url,
      status: 'submitted',
      submittedAt: Date.now()
    };
    await this.store.update((s) => {
      s.applicationHistory.unshift(app);
    });
    return app;
  }

  /* ------------------------------ chatbot -------------------------- */

  async chatAsk(message: string, ctx: ChatbotContext): Promise<string> {
    if (!this.chatbot) this.chatbot = new Chatbot(this.activeProvider());
    return this.chatbot.ask(message, ctx);
  }

  chatReset(): void {
    this.chatbot?.reset();
  }

  /** Build the chat context from current state (CV summary + search status). */
  buildChatContext(cv?: ParsedCV): Parameters<Chatbot['ask']>[1] {
    const s = this.store.get();
    return {
      userName: s.profile.fullName || undefined,
      cvSummary: cv
        ? `${cv.title ?? 'Role'}, ${cv.seniority} (~${cv.estimatedYearsOfExperience}y). Skills: ${cv.skills.slice(0, 10).join(', ')}.`
        : undefined,
      searchStatus: this.activeRun
        ? `mode=${this.activeRun.current.mode}, status=${this.activeRun.current.status}, applied=${this.activeRun.current.appliedJobIds.length}`
        : 'no active run'
    };
  }
}

export interface ChatbotContext {
  cvSummary?: string;
  atsScore?: number;
  slopVerdict?: string;
  searchStatus?: string;
  userName?: string;
}

// Re-export for the main entry's IPC wiring.
export { IPC };
