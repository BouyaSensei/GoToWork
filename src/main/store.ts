/**
 * Persistent app state.
 *
 * Stores provider configs, the user profile (LinkedIn/phone/email/cover letter),
 * saved job sources, and application history as JSON in Electron's userData
 * directory. A plain JSON file keeps it transparent and portable — the user can
 * inspect or back it up. All reads/writes are atomic-ish (write to temp then
 * rename) so a crash mid-write never corrupts state.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Application, ProviderConfig, UserProfile } from '../shared/types';

export interface AppState {
  version: 1;
  providers: ProviderConfig[];
  /** The provider id currently selected for AI calls. */
  activeProviderId?: string;
  profile: UserProfile;
  applicationHistory: Application[];
}

const DEFAULT_PROFILE: UserProfile = {
  fullName: '',
  email: '',
  phone: '',
  linkedinUrl: '',
  portfolioUrl: '',
  location: '',
  coverLetter: ''
};

export class Store {
  private readonly filePath: string;
  private cache: AppState | null = null;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'gotowork-state.json');
  }

  async init(): Promise<AppState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as AppState;
      this.cache = this.migrate(parsed);
    } catch {
      this.cache = this.fresh();
      await this.persist();
    }
    return this.cache;
  }

  get(): AppState {
    if (!this.cache) throw new Error('Store not initialized — call init() first.');
    return this.cache;
  }

  async update(mutator: (state: AppState) => void): Promise<AppState> {
    const state = this.get();
    mutator(state);
    await this.persist();
    return state;
  }

  private persist(): Promise<void> {
    if (!this.cache) return Promise.resolve();
    const tmp = `${this.filePath}.tmp`;
    return fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf-8').then(() =>
      fs.rename(tmp, this.filePath)
    );
  }

  private fresh(): AppState {
    return {
      version: 1,
      providers: [],
      profile: { ...DEFAULT_PROFILE },
      applicationHistory: []
    };
  }

  /** Forward-compatible migration hook. */
  private migrate(s: AppState): AppState {
    return {
      version: 1,
      providers: s.providers ?? [],
      activeProviderId: s.activeProviderId,
      profile: { ...DEFAULT_PROFILE, ...(s.profile ?? {}) },
      applicationHistory: s.applicationHistory ?? []
    };
  }
}
