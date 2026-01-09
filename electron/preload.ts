import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // Required: OAuth initiation via IPC (window.location.origin doesn't work in Electron)
  startGitHubAuth: (returnTo?: string) => ipcRenderer.invoke('github-auth-start', returnTo),
  // Notify renderer that auth completed
  onAuthComplete: (callback: (status?: { login: string }) => void) => {
    ipcRenderer.on('github-auth-complete', (_event, status) => callback(status));
  },
  // Notify renderer of OAuth errors
  onAuthError: (callback: (error: { error: string }) => void) => {
    ipcRenderer.on('github-auth-error', (_event, error) => callback(error));
  },
  // Make API request via Electron net module (includes token automatically)
  apiRequest: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => 
    ipcRenderer.invoke('api-request', url, options),
});
