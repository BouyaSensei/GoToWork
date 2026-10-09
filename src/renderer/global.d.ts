import type { GoToWorkApi } from '@shared/ipc';

declare global {
  interface Window {
    gotowork: GoToWorkApi;
  }
}

export {};
