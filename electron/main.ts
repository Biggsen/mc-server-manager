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

  try {
    // Set Electron mode environment variable
    process.env.ELECTRON_MODE = 'true';
    process.env.USER_DATA_PATH = app.getPath('userData');
    process.env.PORT = '4000';

    // Import backend server dynamically
    // Path resolution: from electron/dist/main.js, go up to root, then into backend/dist
    const backendPath = join(__dirname, '../../backend/dist/index.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const backendModule = require(backendPath) as { startServer: (port: number) => Promise<void> };
    await backendModule.startServer(4000);
    backendStarted = true;
    console.log('Backend server started on port 4000');
  } catch (error) {
    console.error('Failed to start backend server:', error);
    app.quit();
  }
}

function getIconPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return join(__dirname, '../assets/icon.ico');
  } else if (platform === 'darwin') {
    return join(__dirname, '../assets/icon.icns');
  } else {
    return join(__dirname, '../assets/icon.png');
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
    mainWindow.loadFile(join(__dirname, '../frontend/dist/index.html'));
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
  // Start backend server first
  await startBackendServer();
  
  // Then create window
  createWindow();

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
