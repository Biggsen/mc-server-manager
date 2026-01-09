# GitHub OAuth Authentication in Electron App - Implementation Specification

## Document Status
- **Version**: 1.1
- **Date**: 2025-01-09
- **Last Updated**: 2025-01-09
- **Status**: Implementation Ready
- **Priority**: High

---

## 0. Implementation Decisions Summary

The following key decisions were made to optimize for Electron app compatibility:

1. **OAuth State Store**: Implement stateless in-memory Map (replaces session-based storage)
2. **Cookie Domain**: Set `domain: 'localhost'` explicitly when setting cookies programmatically
3. **Cookie sameSite**: Use `sameSite: 'lax'` (works for Electron localhost)
4. **Cookie Reading URL**: Always read from `http://localhost:4000` (backend URL where cookie is set)
5. **Session Partition**: Use shared partition (`persist:main`) with explicit cookie copying as fallback
6. **Timing Strategy**: Poll/retry until cookie is available (with timeout) instead of fixed delay
7. **Cookie Access**: Set cookie directly in main window's session (no IPC needed for cookie transfer)
8. **Frontend Storage**: Store flag indicating "cookie was set" for debugging only (not cookie value)
9. **API Client**: Keep using `credentials: 'include'` only (no manual Cookie headers)
10. **Validation Endpoint**: Use existing `/api/auth/status` endpoint (no new endpoint needed)

---

## 1. Background and Previous Attempts

### 1.1 Previous Implementation Attempts

Multiple attempts were made to implement GitHub OAuth in the Electron app, encountering several critical issues:

#### Issue 1: Session Cookie Not Persisting Through GitHub Redirect
- **Problem**: When GitHub redirected back to the callback URL, the session cookie set during OAuth initiation was not being sent with the callback request.
- **Root Cause**: Browser security policies (`sameSite` cookie attribute) prevent cookies from being sent on cross-site redirects (GitHub → localhost).
- **Attempted Solutions**:
  - Modified `sameSite` cookie settings (`lax`, `none`, `false`)
  - Adjusted `secure` flag for localhost HTTP
  - Changed cookie `path` and `domain` settings
- **Outcome**: All cookie-based solutions failed due to browser security restrictions.

#### Issue 2: Popup Window Not Closing
- **Problem**: After successful OAuth, the popup window remained open showing the app content instead of closing.
- **Root Cause**: Navigation event handlers (`did-navigate`, `did-navigate-in-page`) only captured the final redirect URL (`http://localhost:5173/`), not the intermediate callback URL (`/auth/github/callback`).
- **Attempted Solutions**:
  - Added delays before closing
  - Checked for redirect URLs
  - Used multiple navigation event types
- **Outcome**: Eventually resolved by using `will-navigate` event to catch callback URL before redirect.

#### Issue 3: Main Window Not Detecting Authenticated State
- **Problem**: After successful OAuth in popup, the main window could not access the authenticated session.
- **Root Cause**: Despite using shared session partition (`persist:main`), cookies were not being shared between popup and main window. Each window created separate sessions.
- **Evidence from Logs**:
  - Popup authenticated with session ID: `1hzuz7Hx42nAiJsbqXieIknqKMIqL4lk` (authenticated: true)
  - Main window requests created new session ID: `s7zZDe5QDFZTYdkWisRsJ2pnQy4v57Mq` (authenticated: false)
  - `document.cookie` was always empty in main window
- **Outcome**: Unresolved - this is the primary issue to address in this specification.

### 1.2 Lessons Learned

1. **Session cookies are unreliable for OAuth in Electron**: Cross-site redirects break cookie-based session management.
2. **Navigation events are timing-sensitive**: The callback URL may be processed and redirected before navigation events fire.
3. **Cookie sharing in Electron is complex**: Even with shared partitions, cookies may not be accessible across windows due to domain/path/origin mismatches.
4. **Extensive logging is essential**: Without detailed logs, debugging OAuth flows is nearly impossible.
5. **Stateless state validation works**: In-memory state storage successfully bypassed cookie issues for OAuth state validation.

### 1.3 Current State

- ✅ OAuth flow completes successfully (GitHub authentication works)
- ✅ Backend correctly stores GitHub token in session
- ✅ Popup window closes automatically after OAuth
- ❌ Main window cannot access authenticated session
- ❌ Cookies not shared between popup and main window

---

## 2. Architecture Overview

### 2.1 Design Principles

1. **Defensive Programming**: Assume failures at every step, validate all assumptions
2. **Extensive Logging**: Log every significant event, state change, and decision point
3. **Explicit Cookie Management**: Don't rely on automatic cookie sharing; manage cookies explicitly
4. **Stateless Where Possible**: Minimize dependency on session cookies for critical flows
5. **Graceful Degradation**: Provide clear error messages and fallback behaviors

### 2.2 Proposed Solution Architecture

The solution will use a **hybrid approach** combining:

1. **Stateless OAuth State Store** (to be implemented)
   - In-memory Map for OAuth state validation
   - No dependency on cookies for state validation
   - Replaces current session-based state storage

2. **Explicit Cookie Sharing** (new)
   - After OAuth completes in popup, explicitly read the session cookie from popup window
   - Set the cookie directly in main window's session using Electron's session API
   - No IPC needed - cookie is set programmatically in main process
   - Main window automatically includes cookie in requests via `credentials: 'include'`

3. **Session Synchronization** (new)
   - Main window validates session using existing `/api/auth/status` endpoint
   - Periodic session validation to detect cookie expiration
   - Clear error messages if session is lost
   - Frontend stores flag indicating "cookie was set" for debugging/logging only

### 2.3 Component Responsibilities

#### Electron Main Process (`electron/main.ts`)
- Create and manage OAuth popup window with shared session partition (`persist:main`)
- Monitor popup navigation events
- Extract session cookie from popup after OAuth completes
- Set session cookie directly in main window's session
- Log all window lifecycle and navigation events

#### Electron Renderer Process (`frontend/src/App.tsx`, `frontend/src/lib/api.ts`)
- Initiate OAuth flow (via window navigation or IPC if needed)
- Store flag indicating "cookie was set" for debugging/logging (not the cookie value)
- Use `credentials: 'include'` in API requests (cookies sent automatically)
- Validate session status periodically using `/api/auth/status`
- Handle session expiration gracefully

#### Backend (`backend/src/routes/auth.ts`)
- Process OAuth flow (already working)
- Implement stateless in-memory OAuth state store (replaces session-based)
- Set session cookie with `domain: 'localhost'` and `sameSite: 'lax'` for Electron
- Use existing `/api/auth/status` endpoint for validation
- Log all session operations

---

## 3. Detailed Implementation Plan

### Phase 1: Logging Infrastructure

**Objective**: Establish comprehensive logging before making any functional changes.

#### Step 1.1: Define Logging Standards
- **Location**: Create `docs/logging-standards.md`
- **Content**:
  - Log format specification (JSON with consistent fields)
  - Log levels (DEBUG, INFO, WARN, ERROR)
  - Required log fields: `timestamp`, `component`, `event`, `data`, `sessionId`, `windowId`
  - Log aggregation strategy

#### Step 1.2: Implement Logging Utilities
- **Files to Create/Modify**:
  - `electron/src/utils/logger.ts` - Main process logger
  - `frontend/src/lib/logger.ts` - Renderer process logger
  - `backend/src/utils/logger.ts` - Backend logger
- **Features**:
  - Structured JSON logging
  - Log rotation
  - Log level filtering
  - Optional remote log aggregation endpoint

#### Step 1.3: Add Logging to Existing OAuth Flow
- **Files to Modify**:
  - `electron/main.ts` - Log all window events, IPC calls, navigation
  - `frontend/src/lib/api.ts` - Log all API requests/responses, cookie state
  - `backend/src/routes/auth.ts` - Log all OAuth steps, session operations
- **Log Points**:
  - Window creation/destruction
  - Navigation events (all types)
  - Cookie read/write operations
  - Session creation/validation
  - IPC message send/receive
  - API request/response (with sanitized headers)

**Success Criteria**: 
- All OAuth-related events are logged with sufficient detail
- Logs can be used to trace a complete OAuth flow end-to-end
- Log format is consistent across all components

---

### Phase 2: Cookie Management Infrastructure

**Objective**: Implement explicit cookie reading and setting capabilities.

#### Step 2.1: Add Cookie Reading to Electron Main Process
- **File**: `electron/main.ts`
- **Implementation**:
  ```typescript
  // After OAuth callback completes, read cookies from popup
  // Always read from backend URL (localhost:4000) where cookie was set
  async function getSessionCookieFromPopup(authWindow: BrowserWindow): Promise<string | null> {
    // Log: Attempting to read cookies from popup
    try {
      const session = authWindow.webContents.session;
      const cookies = await session.cookies.get({
        url: 'http://localhost:4000',
        name: 'connect.sid'
      });
      // Log: Cookie read result (sanitized)
      return cookies.length > 0 ? cookies[0].value : null;
    } catch (error) {
      // Log: Cookie read error
      return null;
    }
  }
  ```
- **Logging**: Log cookie read attempts, results, errors
- **Note**: Always read from `http://localhost:4000` (backend URL) where the cookie is set, regardless of popup's current URL

#### Step 2.2: Add Cookie Setting to Electron Main Process
- **File**: `electron/main.ts`
- **Implementation**:
  ```typescript
  // Set session cookie in main window's session
  // Cookie is set directly in session, so renderer doesn't need to manage it
  async function setSessionCookieInMainWindow(cookieValue: string): Promise<boolean> {
    // Log: Attempting to set cookie in main window
    try {
      if (!mainWindow) {
        // Log: Main window not available
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
        sameSite: 'lax'  // Works for Electron localhost
      });
      // Log: Cookie set successfully
      return true;
    } catch (error) {
      // Log: Cookie set error
      return false;
    }
  }
  ```
- **Logging**: Log cookie set attempts, results, errors
- **Note**: Cookie is set directly in main window's session. Renderer uses `credentials: 'include'` and cookie is automatically sent with requests.

#### Step 2.3: Update Preload Script (if needed)
- **File**: `electron/preload.ts`
- **Note**: Since cookies are set directly in main window's session, no IPC is needed for cookie transfer
- **Add** (if OAuth initiation via IPC is desired):
  ```typescript
  contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    // Add OAuth initiation via IPC if needed, otherwise use window navigation
    startGitHubAuth: () => ipcRenderer.invoke('github-auth-start'),
    onAuthComplete: (callback: () => void) => {
      // Notify renderer that cookie was set (no cookie value sent)
      ipcRenderer.on('github-auth-complete', () => callback());
    }
  });
  ```
- **Logging**: Log all exposed API calls

**Success Criteria**:
- Can read session cookie from popup window (from `http://localhost:4000`)
- Can set session cookie in main window's session
- Cookie is automatically included in API requests via `credentials: 'include'`
- All operations are logged

---

### Phase 3: OAuth Flow Integration

**Objective**: Integrate cookie management into the OAuth flow.

#### Step 3.1: Modify OAuth Popup Handler
- **File**: `electron/main.ts`
- **Changes**:
  1. Create popup window with shared session partition (`persist:main`)
  2. After detecting callback URL in `will-navigate`:
     - Poll/retry to read session cookie from popup (with timeout, e.g., 5 seconds)
     - Read from `http://localhost:4000` where cookie was set
     - Log cookie read attempts and results
  3. Once cookie is available:
     - Set cookie directly in main window's session
     - Log cookie set result
     - Notify renderer via IPC that auth completed (no cookie value sent)
  4. After closing popup:
     - Verify cookie was set successfully in main window
     - Log verification result
- **Logging**: Log every step with detailed state information
- **Note**: Use polling/retry with timeout instead of fixed delay for better reliability

#### Step 3.2: Update Frontend OAuth Handler
- **File**: `frontend/src/App.tsx`
- **Changes**:
  1. Listen for `github-auth-complete` IPC event (or detect via navigation)
  2. Store flag indicating "cookie was set" for debugging/logging (not the cookie value)
  3. Make auth status request using existing `/api/auth/status` endpoint
  4. Cookie is automatically included via `credentials: 'include'`
  5. If authentication fails, show error message
- **Logging**: Log auth completion flag, auth status request, results

#### Step 3.3: Update API Client
- **File**: `frontend/src/lib/api.ts`
- **Changes**:
  1. Keep using `credentials: 'include'` in all API requests
  2. Cookie is automatically sent by browser/Electron from session
  3. No manual cookie header management needed
  4. Log API request/response status (cookie handling is automatic)
- **Logging**: Log API requests/responses, authentication status
- **Note**: No need to manually manage cookies - Electron session handles it automatically

**Success Criteria**:
- OAuth flow completes
- Session cookie is transferred from popup to main window
- Main window can make authenticated API requests
- All steps are logged

---

### Phase 4: Session Validation and Error Handling

**Objective**: Ensure session persistence and handle edge cases.

#### Step 4.1: Use Existing Session Status Endpoint
- **File**: `backend/src/routes/auth.ts`
- **Endpoint**: `GET /api/auth/status` (already exists)
- **Functionality**:
  - Returns authentication status, login, and configuration
  - No new endpoint needed
  - Log validation requests and results
- **Logging**: Log all validation requests and results

#### Step 4.2: Implement Periodic Session Validation
- **File**: `frontend/src/App.tsx`
- **Implementation**:
  - Validate session every 30 seconds
  - If session invalid, clear stored cookie and show error
  - Log validation results
- **Logging**: Log all validation checks

#### Step 4.3: Add Error Recovery
- **Files**: `frontend/src/App.tsx`, `electron/main.ts`
- **Scenarios**:
  1. Cookie not received after OAuth: Retry cookie read, show error
  2. Cookie set fails: Retry with different settings, show error
  3. Session expires: Clear cookie, prompt re-authentication
  4. Cookie mismatch: Clear old cookie, request new one
- **Logging**: Log all error scenarios and recovery attempts

**Success Criteria**:
- Session validation works correctly
- Errors are detected and handled gracefully
- User receives clear error messages
- All error scenarios are logged

---

### Phase 5: Backend Cookie Configuration

**Objective**: Ensure backend sets cookies correctly for Electron.

#### Step 5.1: Review Session Cookie Configuration
- **File**: `backend/src/index.ts`
- **Current Settings**:
  - `httpOnly: true`
  - `secure: false`
  - `path: "/"`
  - `sameSite: "lax"` (currently set)
- **Required Changes**:
  - Keep `sameSite: "lax"` (works for Electron localhost)
  - Ensure `domain` is not set (allows localhost without port restriction)
  - Verify `path` is `/` (allows all paths)
  - Cookie will be read and set programmatically in Electron, so backend config is for initial setting
- **Logging**: Log cookie configuration on server start

#### Step 5.2: Add Cookie Debugging Endpoint
- **File**: `backend/src/routes/auth.ts`
- **Endpoint**: `GET /api/auth/debug/cookies`
- **Functionality**:
  - Return all cookies received in request
  - Return session cookie configuration
  - Return current session state
  - **WARNING**: Only enable in development mode
- **Logging**: Log all debug endpoint accesses

**Success Criteria**:
- Backend cookies are configured correctly
- Cookie debugging is available
- Configuration is logged

---

## 4. Logging Strategy

### 4.1 Log Levels

- **DEBUG**: Detailed information for debugging (cookie values, session IDs, navigation URLs)
- **INFO**: Normal operational events (OAuth started, popup opened, authentication successful)
- **WARN**: Warning conditions (cookie read failed, session validation failed, retry attempts)
- **ERROR**: Error conditions (OAuth failed, cookie set failed, session lost)

### 4.2 Required Log Points

#### Electron Main Process
- [ ] Window creation (popup and main)
- [ ] Window destruction
- [ ] Navigation events (will-navigate, did-navigate, did-navigate-in-page)
- [ ] IPC message send/receive
- [ ] Cookie read operations (with sanitized values)
- [ ] Cookie set operations (with sanitized values)
- [ ] OAuth flow state changes
- [ ] Error conditions

#### Electron Renderer Process
- [ ] OAuth initiation
- [ ] IPC message send/receive
- [ ] Cookie storage/retrieval
- [ ] API request/response (with sanitized headers)
- [ ] Session validation results
- [ ] Error conditions

#### Backend
- [ ] OAuth route access
- [ ] OAuth state storage/validation
- [ ] Session creation/update
- [ ] Cookie set operations
- [ ] Session validation requests
- [ ] Error conditions

### 4.3 Log Format

```typescript
{
  timestamp: number,           // Unix timestamp in milliseconds
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  component: string,           // 'electron-main' | 'electron-renderer' | 'backend'
  event: string,               // Event name (e.g., 'oauth-started', 'cookie-read')
  data: object,                // Event-specific data
  sessionId?: string,          // Session ID (if available)
  windowId?: string,           // Window ID (for Electron)
  error?: string               // Error message (if applicable)
}
```

### 4.4 Log Sanitization

**Never log**:
- Full cookie values (log only presence/absence and first/last 4 chars)
- Full session IDs (log only first/last 4 chars)
- Passwords or tokens
- Full request/response bodies

**Always log**:
- Cookie presence/absence
- Session ID presence/absence
- Error messages
- State transitions
- Operation results (success/failure)

---

## 5. Testing Strategy

### 5.1 Unit Tests

- Cookie read/set operations
- Session validation logic
- OAuth state validation
- Error handling

### 5.2 Integration Tests

- Complete OAuth flow in Electron
- Cookie transfer from popup to main window
- Session persistence across app restarts
- Error recovery scenarios

### 5.3 Manual Testing Checklist

- [ ] OAuth popup opens correctly
- [ ] GitHub authentication completes
- [ ] Popup closes automatically
- [ ] Main window shows authenticated state
- [ ] Session persists after app restart
- [ ] Session expires correctly
- [ ] Error messages are clear
- [ ] Logs contain sufficient detail for debugging

---

## 6. Known Pitfalls and Mitigations

### 6.1 Cookie Domain Mismatch

**Pitfall**: Cookies set for `localhost:4000` may not be accessible from `localhost:5173`.

**Mitigation**: 
- When setting cookies programmatically in Electron, use `domain: 'localhost'` (without port)
- This allows cookie to work across all localhost ports
- Always read cookies from `http://localhost:4000` (backend URL) where they're set
- Log cookie domain/path in all operations

### 6.2 Timing Issues

**Pitfall**: Cookie may not be available immediately after OAuth callback.

**Mitigation**:
- Poll/retry reading cookie from popup with timeout (e.g., 5 seconds max)
- Wait for cookie to be available before setting it in main window
- Verify cookie was set successfully before closing popup
- Log timing of all operations

### 6.3 Session Expiration

**Pitfall**: Session may expire between OAuth and first API request.

**Mitigation**:
- Set reasonable session expiration (24 hours)
- Implement session refresh mechanism
- Log session expiration events

### 6.4 Multiple Windows

**Pitfall**: Multiple app instances may create conflicting sessions.

**Mitigation**:
- Use single app instance enforcement
- Clear old sessions on app start
- Log all session operations

---

## 7. Implementation Checklist

### Phase 1: Logging Infrastructure
- [ ] Create logging standards document
- [ ] Implement logger utilities (main, renderer, backend)
- [ ] Add logging to existing OAuth flow
- [ ] Verify logs are comprehensive

### Phase 2: Cookie Management
- [ ] Implement stateless in-memory OAuth state store in backend
- [ ] Implement cookie reading in main process (from `http://localhost:4000`)
- [ ] Implement cookie setting in main process (directly in main window session)
- [ ] Update preload script (minimal, no cookie IPC needed)
- [ ] Test cookie operations in isolation

### Phase 3: OAuth Integration
- [ ] Modify OAuth popup handler
- [ ] Update frontend OAuth handler
- [ ] Update API client
- [ ] Test complete OAuth flow

### Phase 4: Session Validation
- [ ] Use existing `/api/auth/status` endpoint for validation
- [ ] Implement periodic validation in frontend
- [ ] Add error recovery
- [ ] Test error scenarios

### Phase 5: Backend Configuration
- [ ] Review cookie configuration
- [ ] Add cookie debugging endpoint
- [ ] Verify configuration

### Final Steps
- [ ] Remove debug instrumentation (keep essential logs)
- [ ] Update documentation
- [ ] Create user guide
- [ ] Performance testing

---

## 8. Success Criteria

The implementation is considered successful when:

1. ✅ User can click "Sign in with GitHub" in Electron app
2. ✅ OAuth popup opens and user authenticates with GitHub
3. ✅ Popup closes automatically after authentication
4. ✅ Main window immediately shows authenticated state
5. ✅ User can make authenticated API requests
6. ✅ Session persists across app restarts
7. ✅ All operations are logged with sufficient detail
8. ✅ Error scenarios are handled gracefully with clear messages
9. ✅ No "Invalid OAuth state" errors
10. ✅ No session cookie sharing issues

---

## 9. Rollback Plan

If implementation fails:

1. **Keep stateless OAuth state store** (to be implemented)
2. **Revert cookie management changes** if they cause issues
3. **Maintain extensive logging** for future debugging
4. **Document all findings** for next attempt

---

## 10. Future Improvements

- [ ] Implement OAuth token refresh
- [ ] Add support for multiple OAuth providers
- [ ] Implement session encryption
- [ ] Add biometric authentication for Electron
- [ ] Implement session sharing across Electron instances

---

## Appendix A: Code Structure

```
electron/
  main.ts              # Main process, OAuth popup, cookie management
  preload.ts           # IPC bridge
  src/
    utils/
      logger.ts        # Main process logger

frontend/
  src/
    lib/
      api.ts           # API client with cookie management
      logger.ts        # Renderer logger
    App.tsx            # OAuth UI and session management

backend/
  src/
    routes/
      auth.ts          # OAuth routes, session validation
    utils/
      logger.ts        # Backend logger
    index.ts           # Session configuration
```

---

## Appendix B: Key Dependencies

- `electron`: Window management, IPC, cookie API
- `express-session`: Backend session management
- `express`: Backend server
- `crypto`: OAuth state generation

---

**End of Specification**
