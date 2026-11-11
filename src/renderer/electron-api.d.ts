import type { ElectronApiBridge } from '../electron/electronApi';

declare global {
  interface Window {
    electronAPI?: ElectronApiBridge;
  }
}

export {};
