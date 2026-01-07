import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';

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


function createWindow(): void {
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
    mainWindow?.show();
  });

  // Load frontend
  if (isDev) {
    // In development, load from Vite dev server
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
    
    console.log('Loading frontend from:', frontendPath);
    mainWindow.loadFile(frontendPath).catch((err) => {
      console.error('Failed to load frontend:', err);
      mainWindow?.webContents.openDevTools();
    });
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // Start backend server first
    await startBackendServer();
    
    // Give backend a moment to be ready to accept connections
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Then create window
    createWindow();
  } catch (error) {
    console.error('[App] Failed to initialize:', error);
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
