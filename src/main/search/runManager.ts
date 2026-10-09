/**
 * Search-run state machine.
 *
 * A `SearchRunManager` drives one search run through its lifecycle:
 *   idle → searching → [awaiting-approval] → applying → done | error
 *
 * The mode determines how far the machine goes on its own:
 *   - basic : stop after scoring; results are recommendations only.
 *   - hybrid: stop at `awaiting-approval` for each eligible job; the user
 *             approves/rejects, then we proceed to apply.
 *   - total : run straight through to applying every eligible job.
 *
 * The manager is pure logic + injected side-effect functions (search, apply),
 * which keeps it unit-testable without a network or a browser. The real web
 * automation lives in the injected `apply` callback.
 */

import type { Application, JobPosting, LogEntry, MatchScore, SearchMode, SearchRun } from '../../shared/types';

export interface RunCallbacks {
  /** Fetch candidate postings for a query. Injected so tests can fake it. */
  search: (query: string) => Promise<JobPosting[]>;
  /** Apply to one job. Returns the created application. Injected for testability. */
  apply: (job: JobPosting, match: MatchScore) => Promise<Application>;
  /** Ask the user to approve a job (hybrid mode). Resolves true = proceed. */
  requestApproval?: (job: JobPosting, match: MatchScore) => Promise<boolean>;
  /** Emit progress events to the UI (renderer). */
  onStatus?: (run: SearchRun) => void;
}

export class SearchRunManager {
  private run: SearchRun;
  private readonly cb: RunCallbacks;
  private jobsById = new Map<string, JobPosting>();

  constructor(query: string, mode: SearchMode, cb: RunCallbacks) {
    this.cb = cb;
    this.run = {
      id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      mode,
      query,
      createdAt: Date.now(),
      status: 'idle',
      results: [],
      appliedJobIds: [],
      log: []
    };
  }

  get current(): SearchRun {
    return this.run;
  }

  private log(level: LogEntry['level'], message: string): void {
    this.run.log.push({ ts: Date.now(), level, message });
    this.emit();
  }

  private setStatus(status: SearchRun['status']): void {
    this.run.status = status;
    this.emit();
  }

  private emit(): void {
    // Structural clone so the renderer gets a stable snapshot.
    this.cb.onStatus?.({ ...this.run, results: [...this.run.results], log: [...this.run.log] });
  }

  /** Execute the full run for the active mode. */
  async execute(): Promise<SearchRun> {
    try {
      this.setStatus('searching');
      this.log('info', `Searching for "${this.run.query}" (mode: ${this.run.mode})…`);

      const jobs = await this.cb.search(this.run.query);
      this.jobsById = new Map(jobs.map((j) => [j.id, j]));
      this.log('success', `Found ${jobs.length} candidate job(s).`);

      if (jobs.length === 0) {
        this.setStatus('done');
        this.log('warn', 'No jobs found — try broadening the query.');
        return this.run;
      }

      // Matching is done by the caller and injected via setMatches, OR we score
      // here. We accept pre-computed matches to keep this class decoupled from
      // the matcher (which needs the full ParsedCV).
      const matches = this.run.results;
      if (matches.length === 0) {
        this.log('warn', 'No match scores supplied — nothing to act on.');
        this.setStatus('done');
        return this.run;
      }

      // Sort by score desc, stable.
      const ranked = [...matches].sort((a, b) => b.score - a.score);
      this.run.results = ranked;
      this.emit();

      if (this.run.mode === 'basic') {
        this.log('info', 'Basic mode: surfacing recommendations only (no auto-apply).');
        this.setStatus('done');
        return this.run;
      }

      // hybrid + total: iterate eligible jobs.
      for (const match of ranked) {
        const job = this.jobsById.get(match.jobId);
        if (!job) continue;

        if (this.run.mode === 'hybrid') {
          if (!match.eligibleForAutoApply) {
            this.log('info', `Skipping "${job.title}" at ${job.company} (not eligible for approval).`);
            continue;
          }
          this.setStatus('awaiting-approval');
          this.run.pendingApproval = { jobId: job.id, title: job.title, company: job.company };
          this.emit();
          const approved = this.cb.requestApproval
            ? await this.cb.requestApproval(job, match)
            : false;
          this.run.pendingApproval = undefined;
          if (!approved) {
            this.log('info', `User declined "${job.title}" at ${job.company}.`);
            continue;
          }
        } else if (this.run.mode === 'total') {
          if (!match.eligibleForAutoApply) {
            this.log('warn', `"${job.title}" at ${job.company} not eligible for auto-apply — skipping.`);
            continue;
          }
        }

        this.setStatus('applying');
        this.log('info', `Applying to "${job.title}" at ${job.company}…`);
        try {
          await this.cb.apply(job, match);
          this.run.appliedJobIds.push(job.id);
          this.log('success', `Applied to "${job.title}" at ${job.company}.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log('error', `Application failed for "${job.title}": ${msg}`);
        }
      }

      this.setStatus('done');
      this.log('success', `Run complete: ${this.run.appliedJobIds.length} application(s) submitted.`);
      return this.run;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('error', `Run failed: ${msg}`);
      this.setStatus('error');
      return this.run;
    }
  }

  /** Inject pre-computed match scores before execute() (keeps matcher decoupled). */
  setMatches(matches: MatchScore[]): void {
    this.run.results = matches;
    this.emit();
  }
}
