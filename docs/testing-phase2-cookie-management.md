# Testing Phase 2: Cookie Management Infrastructure

This guide helps you test the Phase 2 infrastructure we just implemented.

## What Can Be Tested Now

### 1. Backend Stateless OAuth State Store

The stateless in-memory OAuth state store replaces session-based storage. We can test this by:

**Test Steps:**
1. Start backend: `npm run dev:be`
2. Make a request to start OAuth: `http://localhost:4000/api/auth/github`
3. Check backend logs for:
   - `oauth-state-created` log with `storeSize` field
   - State should be stored in memory (not in session)

**Expected Behavior:**
- OAuth state is created and stored in memory
- Log shows `storeSize: 1` (or incrementing)
- State cleanup runs every 5 minutes (check logs after 10+ minutes for cleanup)

**Verification:**
- Check backend terminal for structured logs
- State should be stored without session dependency
- Multiple OAuth attempts should increment `storeSize`

### 2. Electron Cookie Functions (Compilation Check)

The cookie reading/setting functions are implemented but require OAuth popup to test fully.

**Test Steps:**
1. Build Electron: `npm run build:electron`
2. Verify no compilation errors
3. Functions are available in `electron/main.ts`:
   - `getSessionCookieFromPopup()`
   - `setSessionCookieInMainWindow()`

**Expected Behavior:**
- Code compiles without errors
- Functions are defined and typed correctly

### 3. Preload Script IPC Methods (Availability Check)

The preload script exposes IPC methods, but handlers aren't implemented yet (Phase 3).

**Test Steps:**
1. Build Electron: `npm run build:electron`
2. Start Electron: `npm run electron:dev`
3. Open DevTools Console
4. Check if `window.electronAPI` is available:
   ```javascript
   console.log(window.electronAPI);
   ```

**Expected Behavior:**
- `window.electronAPI.isElectron` should be `true`
- `window.electronAPI.startGitHubAuth` should be a function
- `window.electronAPI.onAuthComplete` should be a function

**Note:** Calling these methods won't work yet (handlers not implemented in Phase 3)

## What Cannot Be Tested Yet

The following require Phase 3 implementation:

1. **Cookie Reading from Popup** - Requires OAuth popup window (Phase 3)
2. **Cookie Setting in Main Window** - Requires OAuth flow completion (Phase 3)
3. **Full OAuth Flow** - Requires IPC handlers (Phase 3)
4. **Cookie Transfer** - Requires complete OAuth integration (Phase 3)

## Quick Test Script

Run this to verify basic functionality:

```bash
# 1. Test backend stateless state store
curl http://localhost:4000/api/auth/github
# Check backend logs for oauth-state-created with storeSize

# 2. Verify Electron compiles
npm run build:electron

# 3. Verify preload exposes methods (in Electron DevTools Console)
# window.electronAPI.startGitHubAuth
# window.electronAPI.onAuthComplete
```

## Success Criteria

- [ ] Backend stateless state store creates states correctly
- [ ] Backend logs show `storeSize` incrementing
- [ ] Electron code compiles without errors
- [ ] Preload script exposes IPC methods
- [ ] TypeScript types are correct

## Next Steps

Once Phase 2 infrastructure is verified, proceed to Phase 3 where we'll:
- Implement IPC handlers
- Create OAuth popup window
- Test cookie reading/setting in real OAuth flow
- Test complete authentication flow
