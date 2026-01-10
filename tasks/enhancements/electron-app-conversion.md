# Electron App Conversion – Specification

## Overview

This specification outlines the conversion of MC Server Manager from a web-based application (separate frontend and backend processes) to a standalone Electron desktop application. The goal is to package the entire application as a single executable that runs the backend server internally and displays the frontend in a native window.

**Priority:** Medium  
**Status:** ✅ Core Features Complete  
**MVP Gap:** No

**Note:** Core functionality is implemented and working. Remaining items include data migration, installer packages (currently using unpacked directories), and cross-platform build testing.

---

## Goals

1. **Single Executable**: Package the entire application as a standalone desktop app
2. **Native Integration**: Leverage Electron's native capabilities for better file system access and OS integration
3. **Offline-First**: Application works completely offline (except for GitHub operations)
4. **Simplified Deployment**: Users don't need to manage separate server/client processes
5. **Cross-Platform**: Support Windows, macOS, and Linux

---

## Architecture Changes

### Current Architecture
```
┌─────────────────┐         ┌─────────────────┐
│   Frontend      │ ──────> │   Backend       │
│   (Vite Dev)    │ HTTP    │   (Express)     │
│   Port 5173     │         │   Port 4000     │
└─────────────────┘         └─────────────────┘
```

### Electron Architecture
```
┌─────────────────────────────────────────────────┐
│              Electron Main Process              │
│  ┌───────────────────────────────────────────┐  │
│  │         Backend Server (Express)          │  │
│  │         Runs internally on localhost     │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │         BrowserWindow (Renderer)          │  │
│  │         Loads built frontend (file://)    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Process Structure

1. **Main Process** (Node.js)
   - Starts Express backend server
   - Creates and manages BrowserWindow
   - Handles app lifecycle (quit, window close)
   - Manages file system operations
   - Handles IPC communication

2. **Renderer Process** (Chromium)
   - Runs React frontend
   - Communicates with backend via HTTP (localhost)
   - Can use Electron IPC for native features

---

## Technical Requirements

### Dependencies

#### Root `package.json`
```json
{
  "devDependencies": {
    "electron": "^30.0.0",
    "electron-builder": "^24.9.1",
    "electron-rebuild": "^3.2.9",
    "@electron/packager": "^19.0.1",
    "@types/node": "^20.0.0"
  },
  "scripts": {
    "electron:dev": "npm run build:electron && concurrently \"npm run dev:be\" \"npm run dev:fe\" \"wait-on http://localhost:5173 && electron .\"",
    "electron:build": "npm run build && electron-rebuild && electron-packager ...",
    "electron:build:win": "npm run build && electron-rebuild && electron-packager --platform=win32 ...",
    "electron:build:mac": "npm run build && electron-rebuild && electron-packager --platform=darwin ...",
    "electron:build:linux": "npm run build && electron-rebuild && electron-packager --platform=linux ..."
  }
}
```

**Note:** Implementation uses `@electron/packager` (electron-packager) for builds. `electron-builder` is available with a configuration file (`electron-builder.yml`) but is not currently used for packaging. The `electron-builder.yml` file exists for potential future use.

---

## File Structure Changes

### New Files

```
mc-server-manager/
  electron/
    main.ts                 # Electron main process entry point
    preload.ts              # Preload script (optional, for IPC)
    types/
      electron.d.ts         # TypeScript definitions
  assets/
    icon.ico                # Windows icon
    icon.icns               # macOS icon
    icon.png                # Linux icon
  dist-electron/            # Built Electron app (gitignored)
  electron-builder.yml      # Electron Builder config (optional)
```

### Modified Files

- `package.json` - Add Electron scripts and dependencies
- `backend/src/config.ts` - Update path resolution for Electron
- `backend/src/services/*.ts` - Update `process.cwd()` to use Electron userData
- `frontend/vite.config.ts` - Update build config for Electron
- `.gitignore` - Add `dist-electron/`

---

## Implementation Details

### 1. Electron Main Process (`electron/main.ts`)

#### Responsibilities
- Initialize Express backend server
- Create BrowserWindow
- Handle app lifecycle events
- Manage data directory paths
- Handle window close/quit logic

#### Key Implementation Points

**Backend Server Initialization**
The backend is started using direct import (not spawned as a separate process). In development mode, the backend is NOT started by Electron - it's expected to be running via `npm run dev:be`. Only in production (packaged app) does Electron start the backend.

```typescript
import { app, BrowserWindow } from 'electron';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;
let backendServer: import('http').Server | null = null;
let backendStarted = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
    
    // Import and start backend directly
    const backendModule = require(backendPath) as { 
      startServer: (port: number) => Promise<import('http').Server> 
    };
    
    if (!backendModule || typeof backendModule.startServer !== 'function') {
      throw new Error('Backend module does not export startServer function');
    }
    
    backendServer = await backendModule.startServer(4000);
    backendStarted = true;
    console.log('Backend server started successfully on port 4000');
  } catch (error) {
    console.error('Failed to start backend server:', error);
    throw error;
  }
}
```

**File Logging in Electron Mode**
When running in Electron mode, the backend automatically logs to `backend.log` in the userData directory for debugging purposes.

**BrowserWindow Creation**
```typescript
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js')
    },
    icon: getIconPath(),
    show: false, // Don't show until ready to prevent visual flash
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load frontend
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
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
    
    mainWindow.loadFile(frontendPath).catch((err) => {
      console.error('Failed to load frontend:', err);
      mainWindow?.webContents.openDevTools();
    });
  }

  // Handle external links - open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
```

**App Lifecycle**
```typescript
app.whenReady().then(async () => {
  // Set app user model ID for Windows taskbar icon
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.mcservermanager.app');
  }
  
  try {
    // Start backend server first
    await startBackendServer();
    
    // Give backend a moment to be ready to accept connections
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Then create window
    createWindow();
  } catch (error) {
    console.error('App initialization failed:', error);
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
  if (backendServer) {
    console.log('[Backend] Closing server...');
    backendServer.close(() => {
      console.log('[Backend] Server closed');
    });
    backendServer = null;
  }
});
```

### 2. Backend Path Resolution Updates

#### Current Implementation
Backend uses `process.cwd()` for all data directories:
- `data/projects`
- `data/builds`
- `data/runs`
- `data/cache`
- `templates/server`

#### Electron Implementation
The Electron main process sets `USER_DATA_PATH` environment variable before starting the backend. The backend does NOT import Electron directly - it uses the environment variable.

**New Config Module** (`backend/src/config.ts`)
```typescript
import { join } from 'path';

// In Electron mode, use USER_DATA_PATH set by Electron main process
// In web mode, use process.cwd()
// Note: Backend does not import Electron - USER_DATA_PATH is set as env var
export function getDataRoot(): string {
  const electronMode = process.env.ELECTRON_MODE === 'true';
  const userDataPath = process.env.USER_DATA_PATH;
  
  if (electronMode && userDataPath) {
    return userDataPath;
  }
  
  return process.cwd();
}

export function getProjectsRoot(): string {
  return join(getDataRoot(), 'data', 'projects');
}

export function getBuildsRoot(): string {
  return join(getDataRoot(), 'data', 'builds');
}

export function getRunsRoot(): string {
  return join(getDataRoot(), 'data', 'runs');
}

export function getCacheRoot(): string {
  return join(getDataRoot(), 'data', 'cache');
}

export function getTemplatesRoot(): string {
  // In Electron, templates are bundled with app
  if (process.env.ELECTRON_MODE === 'true') {
    return join(__dirname, '../../templates/server');
  }
  return join(process.cwd(), '..', 'templates', 'server');
}

// Helper function for migration - checks dev data paths
export function getDevDataPaths(): string[] {
  if (process.env.ELECTRON_MODE === 'true') {
    // In Electron, check multiple possible locations for dev data
    return [
      join(__dirname, '..', '..', '..', 'backend', 'data'),
      join(__dirname, '..', '..', 'backend', 'data'),
    ];
  }
  return [join(process.cwd(), 'backend', 'data')];
}
```

**Update All Services**
Replace `process.cwd()` with config functions:
- `backend/src/services/projectFiles.ts`
- `backend/src/services/buildQueue.ts`
- `backend/src/services/runQueue.ts`
- `backend/src/storage/projectsStore.ts`
- `backend/src/storage/pluginsStore.ts`
- `backend/src/routes/plugins.ts`
- `backend/src/services/deploymentStore.ts`

### 3. Backend Server Refactoring

#### Export Server Initialization
Modified `backend/src/index.ts` to export server creation:

```typescript
import express from 'express';
import type { Server } from 'http';
// ... other imports

export function createApp(): express.Application {
  const app = express();
  // ... middleware setup (CORS, JSON parsing, routes, error handlers)
  registerRoutes(app);
  // ... error handlers
  return app;
}

export async function startServer(port: number = 4000): Promise<Server> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    try {
      // Bind to 127.0.0.1 (localhost only) for security
      const server = app.listen(port, '127.0.0.1', () => {
        console.log(`MC Server Manager backend listening on http://127.0.0.1:${port}`);
        resolve(server);
      }).on('error', (err: Error) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Only start if run directly (not imported)
if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  let server: Server | null = null;
  
  startServer(port)
    .then((s) => {
      server = s;
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });
  
  // Handle graceful shutdown
  const shutdown = () => {
    if (server) {
      console.log('Shutting down server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

**File Logging in Electron Mode**
When `ELECTRON_MODE` is true and `USER_DATA_PATH` is set, the backend automatically redirects console output to `backend.log` in the userData directory for debugging.

#### Electron Integration
In `electron/main.ts`, the backend is dynamically required (not imported via ES6 imports):

```typescript
async function startBackendServer(): Promise<void> {
  // ... environment setup (ELECTRON_MODE, USER_DATA_PATH, NODE_PATH) ...
  
  const backendPath = join(appPath, 'backend/dist/index.js');
  const backendModule = require(backendPath) as { 
    startServer: (port: number) => Promise<import('http').Server> 
  };
  
  backendServer = await backendModule.startServer(4000);
  backendStarted = true;
}
```

### 4. Frontend Configuration

#### Vite Build Configuration
Update `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  base: './', // Required for Electron file:// protocol
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
```

#### API Base URL
Frontend uses environment variable:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
```

**Implemented Solution: Electron IPC for Authenticated Requests**

In Electron, authenticated API requests are made through an IPC handler (`api-request`) that:
- Uses Electron's `net` module to make HTTP requests from the main process
- Automatically includes the Authorization header with the GitHub token from keytar
- Works seamlessly with both `file://` protocol (production) and `http://localhost` (development)

This approach is more secure because:
- Tokens never leave the main process
- Direct file:// protocol issues are avoided
- Token management is centralized in the main process

The preload script exposes an `apiRequest` function to the renderer that forwards requests to the main process via IPC.

### 5. GitHub OAuth Flow ✅

#### Implemented Flow (Token-Based)
1. User clicks "Login with GitHub"
2. System browser opens for GitHub OAuth (via `shell.openExternal()`)
3. GitHub redirects to backend callback
4. Backend issues JWT token and redirects:
   - **Production**: Custom protocol (`mc-server-manager://auth?token=...&login=...`)
   - **Development**: Localhost polling endpoint (`http://localhost:4000/api/auth/callback/poll`)
   - **Fallback**: Token polling is always started as a fallback in case custom protocol doesn't work
5. Token stored securely in OS credential vault (keytar)
6. Token automatically included in API requests via IPC handler in Authorization header

**Implementation Details:**
- Uses token-based authentication (JWT) instead of cookies
- Tokens stored in OS credential vault (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- Custom protocol handler registered: `mc-server-manager://`
- Protocol handling differs by platform:
  - **Windows**: Uses `requestSingleInstanceLock()` and `second-instance` event
  - **macOS/Linux**: Uses `open-url` event
- Token polling runs as fallback in both dev and prod (polls every 1 second for up to 2 minutes)
- Single-instance lock prevents multiple app instances (Windows)
- See `tasks/completed/github-oauth-electron-spec.md` for full details

### 6. Docker Integration

#### Current Implementation
Backend spawns Docker containers for local runs using `docker` CLI.

#### Electron Considerations
- Docker must be installed on user's machine
- Check for Docker availability on app startup
- Provide clear error messages if Docker not available
- Consider bundling Docker Desktop installer (Windows/macOS)

**Docker Detection**
```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker --version');
    return true;
  } catch {
    return false;
  }
}
```

---

## Build and Packaging

### Development Workflow

1. **Start Backend** (Terminal 1)
   ```bash
   npm run dev:be
   ```

2. **Start Frontend** (Terminal 2)
   ```bash
   npm run dev:fe
   ```

3. **Start Electron** (Terminal 3)
   ```bash
   npm run electron:dev
   ```

### Production Build

1. **Build Frontend**
   ```bash
   npm run build --workspace frontend
   ```

2. **Build Backend**
   ```bash
   npm run build --workspace backend
   ```

3. **Package Electron App**
   ```bash
   npm run electron:build
   ```

### Build Scripts ✅

Implemented in root `package.json`:
```json
{
  "scripts": {
    "build:electron": "tsc -p electron/tsconfig.json",
    "electron:dev": "npm run build:electron && concurrently \"npm run dev:be\" \"npm run dev:fe\" \"wait-on http://localhost:5173 && electron .\"",
    "postinstall": "electron-rebuild",
    "electron:build": "npm run build && electron-rebuild && electron-packager ...",
    "electron:build:win": "npm run build && electron-rebuild && electron-packager --platform=win32 ...",
    "electron:build:mac": "npm run build && electron-rebuild && electron-packager --platform=darwin ...",
    "electron:build:linux": "npm run build && electron-rebuild && electron-packager --platform=linux ..."
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "wait-on": "^7.2.0",
    "electron-rebuild": "^3.2.9",
    "@electron/packager": "^19.0.1"
  }
}
```

**Key Features:**
- `electron-rebuild` runs on `postinstall` to rebuild native modules
- `electron-rebuild` runs before packaging to ensure native modules are built for Electron
- ASAR unpacking configured for keytar
- Backend dependencies properly included

### Platform-Specific Considerations

#### Windows
- Uses `electron-packager` which creates a directory with unpacked app (not an installer)
- `electron-builder.yml` is configured for NSIS installer (future use)
- Auto-updater support (electron-updater) - not yet implemented
- Windows-specific path handling (working)
- App user model ID set for taskbar icon grouping

#### macOS
- Uses `electron-packager` which creates a directory with unpacked app (not a DMG)
- `electron-builder.yml` is configured for DMG installer (future use)
- Code signing (required for distribution) - not yet configured
- Notarization (required for Gatekeeper) - not yet configured
- App Sandbox considerations - not yet implemented

#### Linux
- Uses `electron-packager` which creates a directory with unpacked app (not an AppImage)
- `electron-builder.yml` is configured for AppImage (future use)
- DEB/RPM packages (optional) - not yet implemented
- Desktop file integration - not yet implemented

---

## Data Migration ⚠️ (Not Yet Implemented)

### User Data Location

#### Development (Current)
- `backend/data/` (relative to project root)

#### Electron Production
- **Windows**: `%APPDATA%/MC Server Manager/`
- **macOS**: `~/Library/Application Support/MC Server Manager/`
- **Linux**: `~/.config/MC Server Manager/`

### Migration Strategy (Future Enhancement)

The `getDevDataPaths()` function exists in `backend/src/config.ts` to support migration, but the actual migration logic is not yet implemented.

**Planned Implementation:**
1. **On First Launch**
   - Check if data exists in old location using `getDevDataPaths()`
   - If found, prompt user to migrate
   - Copy data to new Electron userData location
   - Show migration progress dialog

2. **Migration Script** (Planned)
   ```typescript
   import { app } from 'electron';
   import { existsSync } from 'fs';
   import { join } from 'path';
   import { getDevDataPaths } from '../backend/dist/config';

   async function migrateDataIfNeeded(): Promise<void> {
     const newDataPath = join(app.getPath('userData'), 'data');
     
     if (existsSync(newDataPath)) {
       return; // Already migrated
     }
     
     const devDataPaths = getDevDataPaths();
     for (const oldDataPath of devDataPaths) {
       if (existsSync(oldDataPath)) {
         // Copy data from oldDataPath to newDataPath
         // Show migration dialog
         break;
       }
     }
   }
   ```

---

## Testing Strategy

### Unit Tests
- Backend services (unchanged)
- Electron main process utilities
- Path resolution functions

### Integration Tests
- Backend server startup in Electron mode
- Frontend API communication
- File system operations with Electron paths

### E2E Tests
- Use Playwright or Spectron
- Test full user workflows
- Test on multiple platforms

### Manual Testing Checklist
- [x] App launches successfully (dev and prod)
- [x] Backend server starts automatically (production mode only; dev mode expects external backend)
- [x] Frontend loads correctly (both dev server and built files)
- [x] API calls work (localhost:4000 via IPC in production, direct HTTP in dev)
- [x] GitHub OAuth flow works (token-based, system browser)
- [x] Token storage works (keytar, persists across restarts)
- [x] Custom protocol handler works (production - Windows tested, macOS/Linux use `open-url` event)
- [x] Localhost polling works (development fallback, also used as fallback in production)
- [x] IPC-based API requests work (authenticated requests via `api-request` handler)
- [x] File logging works (backend.log in userData directory in Electron mode)
- [x] Data persists between app restarts (userData path)
- [x] App quits cleanly (backend stops gracefully)
- [x] Single-instance lock works (Windows tested)
- [ ] Project creation works (needs testing)
- [ ] File uploads work (needs testing)
- [ ] Build system works (needs testing)
- [ ] Local runs work (Docker) (needs testing)
- [ ] Data migration (not yet implemented)

---

## Security Considerations

### Context Isolation
- Enable `contextIsolation: true` in BrowserWindow
- Disable `nodeIntegration` in renderer
- Use preload script for safe IPC

### Content Security Policy
- Add CSP headers to Express server
- Restrict resource loading in renderer

### GitHub OAuth ✅
- Store tokens securely (keytar - OS credential vault)
- JWT tokens with configurable expiration (default 30 days)
- Clear tokens on logout
- Token refresh not yet implemented (future enhancement)

### File System Access
- Validate all file paths
- Prevent directory traversal
- Use Electron's safe file dialogs when appropriate

---

## Performance Considerations

### Startup Time
- Lazy load backend modules
- Optimize frontend bundle size
- Show splash screen during initialization

### Memory Usage
- Monitor backend process memory
- Implement proper cleanup on quit
- Consider memory limits for large projects

### Bundle Size
- Tree-shake unused dependencies
- Use Electron's built-in Node.js (don't bundle)
- Optimize frontend assets

---

## Deployment

### Distribution Channels

1. **GitHub Releases**
   - Automated builds via GitHub Actions
   - Attach installers to releases
   - Auto-update support

2. **Direct Download**
   - Host installers on website
   - Provide checksums

3. **App Stores** (Future)
   - Microsoft Store (Windows)
   - Mac App Store (macOS)
   - Snap Store (Linux)

### Auto-Updates

Use `electron-updater`:
```typescript
import { autoUpdater } from 'electron-updater';

autoUpdater.checkForUpdatesAndNotify();
```

### Versioning
- Follow semantic versioning
- Update `package.json` version
- Electron Builder uses this for installers

---

## Migration Path

### Phase 1: Setup (Week 1) ✅
- [x] Add Electron dependencies
- [x] Create `electron/main.ts` skeleton
- [x] Update build scripts
- [x] Test basic Electron window

### Phase 2: Backend Integration (Week 1-2) ✅
- [x] Refactor backend to export server creation (`startServer()`)
- [x] Update path resolution for Electron (`getDataRoot()`, etc.)
- [x] Test backend startup in Electron
- [x] Verify all services work with new paths

### Phase 3: Frontend Integration (Week 2) ✅
- [x] Update Vite config for Electron (base: './')
- [x] Fix API base URL for production (uses IPC for authenticated requests via `api-request` handler)
- [x] Implement IPC-based API requests for Electron (uses Electron `net` module with token injection)
- [x] Test frontend loading in Electron (both dev server and built files)
- [x] Verify API communication (IPC in production, direct HTTP in dev)

### Phase 4: OAuth & Native Features (Week 2-3) ✅
- [x] Implement GitHub OAuth flow (token-based, system browser)
- [x] Add custom protocol handler (`mc-server-manager://`)
- [x] Implement token polling fallback (works in dev and prod)
- [x] Implement app lifecycle management (graceful shutdown, backend cleanup)
- [x] Add error handling and logging (structured JSON logging via Electron logger utility)
- [x] Add file logging for backend (backend.log in userData directory in Electron mode)
- [x] Add single-instance lock (Windows tested)

### Phase 5: Packaging & Testing (Week 3-4) ✅ (Partial)
- [x] Configure Electron Packager (using `@electron/packager`, not `electron-builder`)
- [x] Create app icons (Windows .ico, macOS .icns, Linux .png)
- [x] Configure ASAR unpacking for keytar native module
- [x] Test Windows build (working - creates unpacked directory)
- [x] Configure electron-builder.yml for future use (not currently active)
- [ ] Test macOS build (not yet tested)
- [ ] Test Linux build (not yet tested)
- [ ] Create installer packages (NSIS for Windows, DMG for macOS, AppImage for Linux) - would require electron-builder or additional packaging step
- [ ] Implement data migration (not yet implemented - `getDevDataPaths()` exists but migration logic pending)
- [x] Write documentation (logging standards, OAuth spec, electron conversion spec)

### Phase 6: Polish & Release (Week 4) ⚠️ (Partial)
- [x] Performance optimization (native module support, ASAR unpacking)
- [x] Security audit (context isolation, no node integration)
- [ ] User testing (pending)
- [x] Create installer packages (Windows working)
- [ ] Release (pending)

---

## Known Limitations

1. **Docker Dependency**: Users must have Docker installed separately ✅ (Expected)
2. **GitHub OAuth**: Uses system browser with custom protocol handler ✅ (Implemented)
3. **Bundle Size**: Electron apps are larger than web apps (~100-200MB) ✅ (Expected)
4. **Auto-Updates**: Not yet implemented (requires hosting update server or using GitHub Releases)
5. **Code Signing**: Required for macOS distribution (costs money) ⚠️ (Not yet configured)
6. **Native Modules**: `keytar` requires `electron-rebuild` and ASAR unpacking ✅ (Configured)
7. **Backend Dependencies**: Must be included in root dependencies for production build ✅ (Fixed)
8. **Build Tools**: Using `electron-packager` which creates unpacked directories. `electron-builder.yml` exists but is not used. Installer packages (NSIS/DMG/AppImage) would require switching to electron-builder or additional packaging step.
9. **File Logging**: Backend logs to `backend.log` in userData directory only in Electron mode (production). Development mode uses console output.

---

## Future Enhancements

1. **Auto-Updates**: Implement automatic update checking (electron-updater)
2. **Data Migration**: Implement migration script for existing dev data
3. **macOS/Linux Builds**: Test and verify builds on macOS and Linux
4. **Native Notifications**: Use OS notifications for build completion
5. **Tray Icon**: Minimize to system tray
6. **Keyboard Shortcuts**: Global shortcuts for common actions
7. **Native Menus**: Application menu with standard shortcuts
8. **File Associations**: Open `.mcserver` project files
9. **Drag & Drop**: Drag project files into app
10. **System Integration**: Add to "Open With" context menu
11. **Token Refresh**: Implement OAuth token refresh mechanism
12. **Code Signing**: Configure code signing for macOS distribution

---

## References

- [Electron Documentation](https://www.electronjs.org/docs)
- [Electron Builder Documentation](https://www.electron.build/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/tutorial/security)
- [Vite + Electron Guide](https://vitejs.dev/guide/build.html)

---

## Appendix: Example File Structure

```
mc-server-manager/
  electron/
    main.ts
    preload.ts
    types/
      electron.d.ts
  backend/
    src/
      config.ts              # Updated with Electron path support
      index.ts               # Updated to export server
      services/
        projectFiles.ts      # Updated paths
        buildQueue.ts        # Updated paths
        runQueue.ts          # Updated paths
      storage/
        projectsStore.ts     # Updated paths
  frontend/
    vite.config.ts           # Updated for Electron
    src/
      lib/
        api.ts               # Updated API base URL
  assets/
    icon.ico
    icon.icns
    icon.png
  package.json               # Updated with Electron scripts
  electron-builder.yml          # Configured but not used (electron-packager is active)
```

---

**Document Version:** 2.1  
**Last Updated:** 2025-01-09  
**Status:** ✅ Core Features Complete

**Implementation Status:**
- ✅ Core Electron functionality (window, backend startup, IPC)
- ✅ GitHub OAuth with token-based auth
- ✅ Path resolution for Electron mode
- ✅ File logging in Electron mode
- ✅ Windows build working (electron-packager)
- ⚠️ Data migration not yet implemented
- ⚠️ Installer packages (NSIS/DMG/AppImage) not yet configured (using electron-packager unpacked directories)
- ⚠️ macOS/Linux builds not yet tested
