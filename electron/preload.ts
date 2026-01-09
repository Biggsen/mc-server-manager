import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Required: OAuth initiation via IPC (window.location.origin doesn't work in Electron)
  startGitHubAuth: (returnTo?: string) => ipcRenderer.invoke('github-auth-start', returnTo),
  // Notify renderer that cookie was set (no cookie value sent)
  onAuthComplete: (callback: () => void) => {
    ipcRenderer.on('github-auth-complete', () => callback());
  },
});
