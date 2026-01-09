import { app, BrowserWindow, shell, ipcMain, net } from 'electron';
import { join } from 'path';
import { logger } from './src/utils/logger';

// Dynamic import for keytar to handle native module loading
let keytar: typeof import('keytar') | null = null;
async function getKeytar() {
  if (keytar) return keytar;
  try {
    keytar = await import('keytar');
    return keytar;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('keytar-import-failed', {
      error: errorMsg,
    }, 'main', `Failed to import keytar: ${errorMsg}`);
    throw error;
  }
}

let mainWindow: BrowserWindow | null = null;
let backendStarted = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Dynamic import to handle both development and production builds
async function startBackendServer(): Promise<void> {
  if (backendStarted) {
    return;
  }

  // In development, the backend is already started by npm run dev:be
  // Only start it in production (packaged app)
  if (isDev) {
    console.log('Development mode: Using backend from dev:be script');
    backendStarted = true;
    return;
  }

  try {
    // Set Electron mode environment variable
    process.env.ELECTRON_MODE = 'true';
    process.env.USER_DATA_PATH = app.getPath('userData');
    process.env.PORT = '4000';

    // Import backend server dynamically
    // In packaged app, app.getAppPath() returns the path to app.asar or app directory
    // Always use app.getAppPath() in production for consistent path resolution
    const appPath = app.getAppPath();
    
    // Set NODE_PATH to include root node_modules for module resolution
    // This allows the backend to find dependencies from the root node_modules (workspace hoisting)
    const nodeModulesPath = join(appPath, 'node_modules');
    if (!process.env.NODE_PATH) {
      process.env.NODE_PATH = nodeModulesPath;
    } else {
      process.env.NODE_PATH = `${nodeModulesPath}${require('path').delimiter}${process.env.NODE_PATH}`;
    }
    
    const backendPath = join(appPath, 'backend/dist/index.js');
    
    console.log('[Backend] App path:', appPath);
    console.log('[Backend] Loading backend from:', backendPath);
    console.log('[Backend] __dirname:', __dirname);
    console.log('[Backend] app.isPackaged:', app.isPackaged);
    
    // Check if the backend file exists
    const fs = require('fs');
    const fileExists = fs.existsSync(backendPath);
    if (!fileExists) {
      throw new Error(`Backend file not found at: ${backendPath}`);
    }
    
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const backendModule = require(backendPath) as { startServer: (port: number) => Promise<void> };
    
    if (!backendModule || typeof backendModule.startServer !== 'function') {
      throw new Error('Backend module does not export startServer function');
    }
    
    console.log('[Backend] Starting server on port 4000...');
    await backendModule.startServer(4000);
    backendStarted = true;
    console.log('[Backend] Server started successfully on port 4000');
  } catch (error) {
    console.error('[Backend] Failed to start backend server:', error);
    console.error('[Backend] Error details:', error instanceof Error ? error.stack : error);
    // Don't quit immediately - show error to user
    if (mainWindow) {
      mainWindow.webContents.openDevTools();
    }
    // Re-throw to prevent the app from continuing if backend fails
    throw error;
  }
}

function getIconPath(): string {
  const platform = process.platform;
  const appPath = app.getAppPath();
  if (platform === 'win32') {
    return join(appPath, 'assets/icon.ico');
  } else if (platform === 'darwin') {
    return join(appPath, 'assets/icon.icns');
  } else {
    return join(appPath, 'assets/icon.png');
  }
}

/**
 * Handle auth callback from custom protocol
 */
async function handleAuthCallback(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    
    if (parsed.protocol !== 'mc-server-manager:') {
      logger.warn('auth-callback-invalid-protocol', {
        protocol: parsed.protocol,
      }, 'main');
      return;
    }
    
    const token = parsed.searchParams.get('token');
    const login = parsed.searchParams.get('login');
    
    if (!token || !login) {
      logger.error('auth-callback-missing-data', {
        hasToken: Boolean(token),
        hasLogin: Boolean(login),
      }, 'main', 'Missing token or login in callback');
      return;
    }
    
    // Store token securely
    const keytarModule = await getKeytar();
    await keytarModule.setPassword('mc-server-manager', 'github-token', token);
    
    logger.info('auth-token-stored', {
      login,
    }, 'main');
    
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('github-auth-complete', { login });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('auth-callback-failed', {
      error: errorMsg,
    }, 'main', `Failed to handle auth callback: ${errorMsg}`);
    
    if (mainWindow) {
      mainWindow.webContents.send('github-auth-error', {
        error: 'Failed to complete authentication',
      });
    }
  }
}

// IPC handler for OAuth initiation - opens system browser
ipcMain.handle('github-auth-start', async (_event, returnTo?: string) => {
  logger.info('oauth-start-system-browser', {
    returnTo,
    isDev,
  }, 'main');
  
  // Build OAuth URL
  const oauthUrl = new URL('http://localhost:4000/api/auth/github');
  if (returnTo) {
    oauthUrl.searchParams.set('returnTo', returnTo);
  }
  
  // Always start polling as fallback (works in both dev and prod)
  // In dev: polls localhost callback endpoint
  // In prod: polls as fallback if custom protocol doesn't work
  startPollingForToken();
  
  // Open in system browser (not Electron window)
  shell.openExternal(oauthUrl.toString());
  
  return { opened: true };
});

// Poll for token in development mode
let tokenPollInterval: NodeJS.Timeout | null = null;

function startPollingForToken(): void {
  if (tokenPollInterval) {
    return; // Already polling
  }
  
  logger.info('token-poll-started', {}, 'main');
  
  let pollCount = 0;
  const maxPolls = 120; // Poll for up to 2 minutes (1 second intervals)
  
  tokenPollInterval = setInterval(async () => {
    pollCount++;
    
    if (pollCount > maxPolls) {
      logger.warn('token-poll-timeout', {}, 'main', 'Token polling timed out');
      if (tokenPollInterval) {
        clearInterval(tokenPollInterval);
        tokenPollInterval = null;
      }
      return;
    }
    
    try {
      // Poll the backend endpoint for pending token
      const request = net.request({
        method: 'GET',
        url: 'http://localhost:4000/api/auth/callback/poll',
      });
      
      let responseData = '';
      
      request.on('response', (response) => {
        response.on('data', (chunk: Buffer) => {
          responseData += chunk.toString();
        });
        
        response.on('end', async () => {
          try {
            const result = JSON.parse(responseData);
            
            if (result.token && result.login) {
              logger.info('token-poll-success', {
                login: result.login,
                pollCount,
              }, 'main');
              
              // Store token
              const keytarModule = await getKeytar();
              await keytarModule.setPassword('mc-server-manager', 'github-token', result.token);
              
              // Notify renderer
              if (mainWindow) {
                mainWindow.webContents.send('github-auth-complete', { login: result.login });
              }
              
              // Stop polling
              if (tokenPollInterval) {
                clearInterval(tokenPollInterval);
                tokenPollInterval = null;
              }
            }
          } catch (error) {
            // Ignore parse errors
          }
        });
      });
      
      request.on('error', () => {
        // Ignore request errors - continue polling
      });
      
      request.end();
    } catch (error) {
      // Ignore errors - continue polling
    }
  }, 1000); // Poll every second
}

// IPC handler to make API requests via Electron net module (includes token)
ipcMain.handle('api-request', async (_event, url: string, options?: { 
  method?: string; 
  headers?: Record<string, string>; 
  body?: string 
}) => {
  // Get token from keytar
  let token: string | null = null;
  try {
    const keytarModule = await getKeytar();
    token = await keytarModule.getPassword('mc-server-manager', 'github-token');
  } catch (error) {
    logger.warn('token-read-failed', {
      error: error instanceof Error ? error.message : String(error),
    }, 'main');
  }
  
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: options?.method || 'GET',
      url,
    });
    
    // Set headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    };
    
    // Add Authorization header if token exists
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value);
    }
    
    let responseData = '';
    
    request.on('response', (response) => {
      response.on('data', (chunk: Buffer) => {
        responseData += chunk.toString();
      });
      
      response.on('end', () => {
        try {
          const jsonData = JSON.parse(responseData);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data: jsonData,
            text: responseData,
          });
        } catch {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            data: null,
            text: responseData,
            error: 'Invalid JSON response',
          });
        }
      });
    });
    
    request.on('error', (error: Error) => {
      reject(error);
    });
    
    if (options?.body) {
      request.write(options.body);
    }
    request.end();
  });
});

function createWindow(): void {
  logger.info('window-created', {
    isDev,
    width: 1200,
    height: 800,
  }, 'main');
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
    icon: getIconPath(),
    show: false, // Don't show until ready
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    logger.debug('window-ready-to-show', {}, 'main');
    mainWindow?.show();
  });

  // Load frontend
  if (isDev) {
    // In development, load from Vite dev server
    logger.info('window-loading', {
      url: 'http://localhost:5173',
      mode: 'development',
    }, 'main');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    // Use app.getAppPath() to get the correct path in packaged app
    const appPath = app.getAppPath();
    let frontendPath: string;
    
    if (appPath.endsWith('.asar')) {
      // In asar, use the path directly
      frontendPath = join(appPath, 'frontend/dist/index.html');
    } else {
      // Not in asar, use relative path
      frontendPath = join(__dirname, '../frontend/dist/index.html');
    }
    
    logger.info('window-loading', {
      path: frontendPath,
      mode: 'production',
    }, 'main');
    mainWindow.loadFile(frontendPath).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('window-load-failed', {
        path: frontendPath,
      }, 'main', errorMsg);
      mainWindow?.webContents.openDevTools();
    });
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logger.debug('window-external-link', {
      url,
    }, 'main');
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Log navigation events
  mainWindow.webContents.on('will-navigate', (event, url) => {
    logger.debug('window-navigation', {
      type: 'will-navigate',
      url,
    }, 'main');
  });

  mainWindow.webContents.on('did-navigate', (event, url) => {
    logger.debug('window-navigation', {
      type: 'did-navigate',
      url,
    }, 'main');
  });

  mainWindow.on('closed', () => {
    logger.info('window-closed', {}, 'main');
    mainWindow = null;
  });
}

// Register custom protocol handler
app.setAsDefaultProtocolClient('mc-server-manager');

// Handle protocol URL (macOS/Linux)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleAuthCallback(url);
});

// Handle protocol URL (Windows - second instance)
if (process.platform === 'win32') {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    process.exit(0);
  }
  
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('mc-server-manager://'));
    if (url) {
      handleAuthCallback(url);
    }
  });
}

app.whenReady().then(async () => {
  // Set app user model ID for Windows taskbar icon
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.mcservermanager.app');
  }
  
  try {
    logger.info('app-initializing', {
      isDev,
      isPackaged: app.isPackaged,
    });
    
    // Start backend server first
    await startBackendServer();
    
    // Give backend a moment to be ready to accept connections
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Then create window
    createWindow();
    
    logger.info('app-initialized', {});
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('app-initialization-failed', {}, undefined, errorMsg);
    // Create window anyway to show error to user
    createWindow();
    if (mainWindow) {
      mainWindow.webContents.openDevTools();
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Cleanup can be added here if needed
});

// Security: Prevent new window creation
// Note: setWindowOpenHandler in createWindow() already handles this,
// but we add this as a fallback for any windows created later
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
