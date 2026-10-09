/**
 * Electron main entry.
 *
 * Creates the BrowserWindow (with a hardened preload), then registers every IPC
 * handler as a thin router into `AppService`. All real logic lives in the
 * service + engines; this file only owns window lifecycle and IPC plumbing.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { AppService } from './service';
import { IPC } from '../shared/ipc';
import type {
  AnalyzeAtsRequest,
  ChatAskRequest,
  DetectSlopRequest,
  ParseCvRequest,
  PickFileRequest,
  ProfileSaveRequest,
  ProviderHealthRequest,
  SearchRunRequest
} from '../shared/ipc';

let win: BrowserWindow | null = null;
let service: AppService;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    title: 'GoToWork',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC.cvParse, (_e, req: ParseCvRequest) => service.parseCv(req.filePath));
  ipcMain.handle(IPC.pickFile, async (_e, req: PickFileRequest) => {
    if (!win) return null;
    const options: Electron.OpenDialogOptions = {
      title: req.title ?? 'Choisir un fichier',
      properties: ['openFile'],
      filters: req.filters?.map((f) => ({ name: f.name, extensions: f.extensions }))
    };
    const res = await dialog.showOpenDialog(win, options);
    return res.canceled ? null : res.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.cvAnalyzeAts, (_e, req: AnalyzeAtsRequest) => service.analyzeAts(req.cv));
  ipcMain.handle(IPC.cvDetectSlop, (_e, req: DetectSlopRequest) => service.detectSlop(req.cv));

  ipcMain.handle(IPC.providerList, () => service.listProviders());
  ipcMain.handle(IPC.providerSave, (_e, p) => service.saveProvider(p));
  ipcMain.handle(IPC.providerRemove, (_e, id: string) => service.removeProvider(id));
  ipcMain.handle(IPC.providerSetActive, (_e, id: string) => service.setActiveProvider(id));
  ipcMain.handle(IPC.providerHealth, (_e, req: ProviderHealthRequest) =>
    service.providerHealth(req.providerId)
  );

  ipcMain.handle(IPC.profileGet, () => service.getProfile());
  ipcMain.handle(IPC.profileSave, (_e, req: ProfileSaveRequest) => service.saveProfile(req.profile));

  ipcMain.handle(IPC.searchRun, (_e, req: SearchRunRequest) => service.runSearch(req));
  ipcMain.on(
    IPC.searchApprove,
    (_e, payload: { runId: string; jobId: string; approved: boolean }) =>
      service.respondApproval(payload.runId, payload.jobId, payload.approved)
  );

  ipcMain.handle(IPC.chatAsk, (_e, req: ChatAskRequest) =>
    service.chatAsk(req.message, req.context)
  );
  ipcMain.handle(IPC.chatReset, () => service.chatReset());
}

app.whenReady().then(async () => {
  service = new AppService({
    userDataDir: app.getPath('userData'),
    onSearchStatus: (run) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.searchStatus, run);
    }
  });
  await service.init();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
