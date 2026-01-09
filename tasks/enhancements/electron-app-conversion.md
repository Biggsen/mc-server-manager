# Electron App Conversion – Specification

## Overview

This specification outlines the conversion of MC Server Manager from a web-based application (separate frontend and backend processes) to a standalone Electron desktop application. The goal is to package the entire application as a single executable that runs the backend server internally and displays the frontend in a native window.

**Priority:** Medium  
**Status:** ✅ Mostly Complete  
**MVP Gap:** No

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

**Note:** Implementation uses `electron-packager` for builds (not `electron-builder`). `electron-builder` is available but not currently configured.

#### Electron Builder Configuration
```json
{
  "build": {
    "appId": "com.mcservermanager.app",
    "productName": "MC Server Manager",
    "directories": {
      "output": "dist-electron"
    },
    "files": [
      "electron/**/*",
      "backend/dist/**/*",
      "frontend/dist/**/*",
      "templates/**/*",
      "package.json"
    ],
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico"
    },
    "mac": {
      "target": ["dmg"],
      "icon": "assets/icon.icns",
      "category": "public.app-category.utilities"
    },
    "linux": {
      "target": ["AppImage"],
      "icon": "assets/icon.png",
      "category": "Utility"
    }
  }
}
```

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
```typescript
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { spawn } from 'child_process';

let backendProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

async function startBackendServer(): Promise<void> {
  // Option 1: Spawn backend as separate process
  const backendPath = join(__dirname, '../backend/dist/index.js');
  backendProcess = spawn('node', [backendPath], {
    env: {
      ...process.env,
      PORT: '4000',
      ELECTRON_MODE: 'true',
      USER_DATA_PATH: app.getPath('userData')
    }
  });

  // Option 2: Import and start backend directly (preferred)
  // This requires refactoring backend to export server initialization
}
```

**BrowserWindow Creation**
```typescript
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js')
    },
    icon: getIconPath()
  });

  // Load frontend
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../frontend/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
```

**App Lifecycle**
```typescript
app.whenReady().then(() => {
  startBackendServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackendServer();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackendServer();
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
Use Electron's `app.getPath('userData')` for data storage:

**New Config Module** (`backend/src/config.ts`)
```typescript
import { app } from 'electron';

// In Electron mode, use app.getPath('userData')
// In web mode, use process.cwd()
export function getDataRoot(): string {
  if (process.env.ELECTRON_MODE === 'true') {
    return process.env.USER_DATA_PATH || app.getPath('userData');
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
Modify `backend/src/index.ts` to export server creation:

```typescript
import express from 'express';
// ... other imports

export function createApp(): express.Application {
  const app = express();
  // ... middleware setup
  registerRoutes(app);
  // ... error handlers
  return app;
}

export async function startServer(port: number = 4000): Promise<void> {
  const app = createApp();
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`MC Server Manager backend listening on port ${port}`);
      resolve();
    });
  });
}

// Only start if run directly (not imported)
if (require.main === module) {
  startServer(Number(process.env.PORT ?? 4000));
}
```

#### Electron Integration
In `electron/main.ts`:
```typescript
import { startServer } from '../backend/dist/index';

async function startBackendServer(): Promise<void> {
  await startServer(4000);
  console.log('Backend server started');
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
Frontend already uses environment variable:
```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
```

In Electron production, this will resolve to `/api` which won't work with `file://` protocol. Options:

**Option A: Use absolute localhost URL**
```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? 
  (import.meta.env.MODE === 'production' ? 'http://localhost:4000/api' : '/api');
```

**Option B: Use Electron IPC** (more complex, better for native features)

### 5. GitHub OAuth Flow ✅

#### Implemented Flow (Token-Based)
1. User clicks "Login with GitHub"
2. System browser opens for GitHub OAuth (via `shell.openExternal()`)
3. GitHub redirects to backend callback
4. Backend issues JWT token and redirects:
   - **Production**: Custom protocol (`mc-server-manager://auth?token=...`)
   - **Development**: Localhost polling endpoint (`http://localhost:4000/api/auth/callback/poll`)
5. Token stored securely in OS credential vault (keytar)
6. Token automatically included in API requests via Authorization header

**Implementation Details:**
- Uses token-based authentication (JWT) instead of cookies
- Tokens stored in OS credential vault (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- Custom protocol handler registered: `mc-server-manager://`
- Single-instance lock prevents multiple app instances
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
- NSIS installer
- Auto-updater support (electron-updater)
- Windows-specific path handling

#### macOS
- DMG installer
- Code signing (required for distribution)
- Notarization (required for Gatekeeper)
- App Sandbox considerations

#### Linux
- AppImage (portable)
- DEB/RPM packages (optional)
- Desktop file integration

---

## Data Migration

### User Data Location

#### Development (Current)
- `backend/data/` (relative to project root)

#### Electron Production
- **Windows**: `%APPDATA%/MC Server Manager/`
- **macOS**: `~/Library/Application Support/MC Server Manager/`
- **Linux**: `~/.config/MC Server Manager/`

### Migration Strategy

1. **On First Launch**
   - Check if data exists in old location
   - If found, prompt user to migrate
   - Copy data to new Electron userData location

2. **Migration Script**
   ```typescript
   import { app } from 'electron';
   import { existsSync, copyFileSync } from 'fs';
   import { join } from 'path';

   function migrateDataIfNeeded(): void {
     const oldDataPath = join(process.cwd(), 'backend', 'data');
     const newDataPath = join(app.getPath('userData'), 'data');
     
     if (existsSync(oldDataPath) && !existsSync(newDataPath)) {
       // Copy data
       // Show migration dialog
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
- [x] App launches successfully
- [x] Backend server starts automatically
- [x] Frontend loads correctly
- [x] API calls work (localhost:4000)
- [x] GitHub OAuth flow works (token-based, system browser)
- [x] Token storage works (keytar, persists across restarts)
- [x] Custom protocol handler works (production)
- [x] Localhost polling works (development)
- [ ] Project creation works (needs testing)
- [ ] File uploads work (needs testing)
- [ ] Build system works (needs testing)
- [ ] Local runs work (Docker) (needs testing)
- [x] Data persists between app restarts (userData path)
- [x] App quits cleanly (backend stops)
- [x] Single-instance lock works (Windows)

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
- [x] Fix API base URL for production (uses IPC for authenticated requests)
- [x] Test frontend loading in Electron
- [x] Verify API communication

### Phase 4: OAuth & Native Features (Week 2-3) ✅
- [x] Implement GitHub OAuth flow (token-based, system browser)
- [x] Add custom protocol handler (`mc-server-manager://`)
- [x] Implement app lifecycle management
- [x] Add error handling and logging (structured JSON logging)
- [x] Add single-instance lock (Windows)

### Phase 5: Packaging & Testing (Week 3-4) ✅ (Partial)
- [x] Configure Electron Packager (using `electron-packager`, not `electron-builder`)
- [x] Create app icons (Windows, macOS, Linux)
- [x] Test Windows build (working)
- [ ] Test macOS build (not yet tested)
- [ ] Test Linux build (not yet tested)
- [ ] Implement data migration (not yet implemented)
- [x] Write documentation (logging standards, OAuth spec)

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
  electron-builder.yml
```

---

**Document Version:** 2.0  
**Last Updated:** 2025-01-09  
**Status:** ✅ Implementation Complete (Core Features)
