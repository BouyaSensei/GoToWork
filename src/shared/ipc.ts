/**
 * IPC channel contract + payload types.
 *
 * Single source of truth for every renderer↔main message. Keeping the names
 * and shapes here (in @shared) means the preload bridge and the React UI can't
 * drift apart. All payloads are plain JSON (serializable).
 */

import type {
  AtsReport,
  ChatTurn,
  JobPosting,
  ParsedCV,
  ProviderConfig,
  ProviderHealth,
  SearchMode,
  SearchRun,
  SlopReport,
  UserProfile
} from './types';

/* ------------------------------ channel names ---------------------- */

export const IPC = {
  // CV analysis
  cvParse: 'cv:parse',
  cvAnalyzeAts: 'cv:analyze-ats',
  cvDetectSlop: 'cv:detect-slop',
  pickFile: 'dialog:pick-file',

  // AI providers
  providerList: 'provider:list',
  providerSave: 'provider:save',
  providerRemove: 'provider:remove',
  providerSetActive: 'provider:set-active',
  providerHealth: 'provider:health',

  // Profile
  profileGet: 'profile:get',
  profileSave: 'profile:save',

  // Job search
  searchRun: 'search:run',
  searchStatus: 'search:status', // main → renderer (progress push)
  searchApprove: 'search:approve', // renderer → main (hybrid approval reply)

  // Chatbot
  chatAsk: 'chat:ask',
  chatReset: 'chat:reset'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/* ------------------------------ payload types ---------------------- */

export interface ParseCvRequest {
  filePath: string;
}

export interface PickFileRequest {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface AnalyzeAtsRequest {
  cv: ParsedCV;
}

export interface DetectSlopRequest {
  cv: ParsedCV;
}

export interface ProviderHealthRequest {
  providerId: string;
}

export interface ProfileSaveRequest {
  profile: UserProfile;
}

export interface SearchRunRequest {
  mode: SearchMode;
  query: string;
  /** Pre-parsed postings (from the manual source) if the user pasted them. */
  postings?: JobPosting[];
  /** Parsed CV, so the main process can compute matches without re-reading disk. */
  cv: ParsedCV;
}

export interface ChatAskRequest {
  message: string;
  context: {
    cvSummary?: string;
    atsScore?: number;
    slopVerdict?: string;
    searchStatus?: string;
    userName?: string;
  };
}

/** The typed API surface exposed to the renderer via window.gotowork. */
export interface GoToWorkApi {
  parseCv(req: ParseCvRequest): Promise<ParsedCV>;
  analyzeAts(req: AnalyzeAtsRequest): Promise<AtsReport>;
  detectSlop(req: DetectSlopRequest): Promise<SlopReport>;
  pickFile(req?: PickFileRequest): Promise<string | null>;

  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(p: ProviderConfig): Promise<void>;
  removeProvider(id: string): Promise<void>;
  setActiveProvider(id: string): Promise<void>;
  providerHealth(req: ProviderHealthRequest): Promise<ProviderHealth>;

  getProfile(): Promise<UserProfile>;
  saveProfile(req: ProfileSaveRequest): Promise<void>;

  runSearch(req: SearchRunRequest): Promise<SearchRun>;
  onSearchStatus(cb: (run: SearchRun) => void): () => void;
  respondApproval(runId: string, jobId: string, approved: boolean): Promise<void>;

  chatAsk(req: ChatAskRequest): Promise<string>;
  chatReset(): Promise<void>;
}

/** A single chat turn as it appears in the UI (mirrors shared ChatTurn). */
export type { ChatTurn };
