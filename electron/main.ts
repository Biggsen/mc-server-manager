import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { logger } from './src/utils/logger';

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
 * Read session cookie from a window's session
 * Always reads from http://localhost:4000 (backend URL where cookie is set)
 */
async function getSessionCookieFromPopup(authWindow: BrowserWindow): Promise<string | null> {
  const windowId = authWindow.id.toString();
  
  logger.debug('cookie-read-attempt', {
    url: 'http://localhost:4000',
    cookieName: 'connect.sid',
  }, windowId);
  
  try {
    const session = authWindow.webContents.session;
    const cookies = await session.cookies.get({
      url: 'http://localhost:4000',
      name: 'connect.sid',
    });
    
    if (cookies.length > 0) {
      const cookie = cookies[0];
      const cookieValue = cookie.value;
      
      logger.info('cookie-read-success', {
        url: 'http://localhost:4000',
        cookieName: 'connect.sid',
        cookiePresent: true,
        cookieValue: cookieValue.length > 8 
          ? `${cookieValue.slice(0, 4)}...${cookieValue.slice(-4)}`
          : '***',
      }, windowId);
      
      return cookieValue;
    } else {
      logger.warn('cookie-read-failed', {
        url: 'http://localhost:4000',
        cookieName: 'connect.sid',
        cookiePresent: false,
        reason: 'Cookie not found',
      }, windowId);
      return null;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('cookie-read-failed', {
      url: 'http://localhost:4000',
      cookieName: 'connect.sid',
      reason: 'Exception during cookie read',
    }, windowId, errorMsg);
    return null;
  }
}

/**
 * Set session cookie in main window's session
 * Cookie is set directly in session, so renderer doesn't need to manage it
 */
async function setSessionCookieInMainWindow(cookieValue: string): Promise<boolean> {
  logger.debug('cookie-set-attempt', {
    url: 'http://localhost:4000',
    cookieName: 'connect.sid',
    cookieValue: cookieValue.length > 8 
      ? `${cookieValue.slice(0, 4)}...${cookieValue.slice(-4)}`
      : '***',
  }, 'main');
  
  try {
    if (!mainWindow) {
      logger.error('cookie-set-failed', {
        reason: 'Main window not available',
      }, 'main', 'Main window is null');
      return false;
    }
    
    const session = mainWindow.webContents.session;
    await session.cookies.set({
      url: 'http://localhost:4000',
      name: 'connect.sid',
      value: cookieValue,
      domain: 'localhost',  // Explicitly set for Electron compatibility
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',  // Works for Electron localhost
    });
    
    logger.info('cookie-set-success', {
      url: 'http://localhost:4000',
      cookieName: 'connect.sid',
      domain: 'localhost',
      path: '/',
      sameSite: 'lax',
    }, 'main');
    
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('cookie-set-failed', {
      url: 'http://localhost:4000',
      cookieName: 'connect.sid',
      reason: 'Exception during cookie set',
    }, 'main', errorMsg);
    return false;
  }
}


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
