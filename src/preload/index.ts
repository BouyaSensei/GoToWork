/**
 * Preload bridge.
 *
 * Exposes a minimal, typed `window.gotowork` API to the renderer via
 * contextBridge. The renderer never touches ipcRenderer directly — it only sees
 * the methods in `GoToWorkApi`. This keeps the IPC surface small and auditable,
 * and means the renderer runs with nodeIntegration off (safer).
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { GoToWorkApi } from '../shared/ipc';
import type { SearchRun } from '../shared/types';

// The preload script runs in an isolated sandbox and must be self-contained:
// it cannot `require` shared code at runtime. So the channel strings are kept
// here (they mirror @shared/ipc exactly) and only *types* are imported — which
// erase at compile time and never create a runtime dependency.
const IPC = {
  cvParse: 'cv:parse',
  cvAnalyzeAts: 'cv:analyze-ats',
  cvDetectSlop: 'cv:detect-slop',
  pickFile: 'dialog:pick-file',

  providerList: 'provider:list',
  providerSave: 'provider:save',
  providerRemove: 'provider:remove',
  providerSetActive: 'provider:set-active',
  providerHealth: 'provider:health',

  profileGet: 'profile:get',
  profileSave: 'profile:save',

  searchRun: 'search:run',
  searchStatus: 'search:status',
  searchApprove: 'search:approve',

  chatAsk: 'chat:ask',
  chatReset: 'chat:reset'
} as const;

const api: GoToWorkApi = {
  parseCv: (req) => ipcRenderer.invoke(IPC.cvParse, req),
  analyzeAts: (req) => ipcRenderer.invoke(IPC.cvAnalyzeAts, req),
  detectSlop: (req) => ipcRenderer.invoke(IPC.cvDetectSlop, req),
  pickFile: (req) => ipcRenderer.invoke(IPC.pickFile, req ?? {}),

  listProviders: () => ipcRenderer.invoke(IPC.providerList),
  saveProvider: (p) => ipcRenderer.invoke(IPC.providerSave, p),
  removeProvider: (id) => ipcRenderer.invoke(IPC.providerRemove, id),
  setActiveProvider: (id) => ipcRenderer.invoke(IPC.providerSetActive, id),
  providerHealth: (req) => ipcRenderer.invoke(IPC.providerHealth, req),

  getProfile: () => ipcRenderer.invoke(IPC.profileGet),
  saveProfile: (req) => ipcRenderer.invoke(IPC.profileSave, req),

  runSearch: (req) => ipcRenderer.invoke(IPC.searchRun, req),
  onSearchStatus: (cb) => {
    const listener = (_event: unknown, run: SearchRun) => cb(run);
    ipcRenderer.on(IPC.searchStatus, listener);
    return () => ipcRenderer.removeListener(IPC.searchStatus, listener);
  },
  respondApproval: (runId, jobId, approved) =>
    ipcRenderer.invoke(IPC.searchApprove, { runId, jobId, approved }),

  chatAsk: (req) => ipcRenderer.invoke(IPC.chatAsk, req),
  chatReset: () => ipcRenderer.invoke(IPC.chatReset)
};

contextBridge.exposeInMainWorld('gotowork', api);
