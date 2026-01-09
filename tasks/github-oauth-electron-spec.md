# GitHub OAuth Authentication in Electron App - Implementation Specification

## Document Status
- **Version**: 2.0
- **Date**: 2025-01-09
- **Last Updated**: 2025-01-09
- **Status**: ✅ Implementation Complete
- **Priority**: High

---

## 0. Implementation Decisions Summary

The following key decisions were made to optimize for Electron app compatibility:

1. **Authentication Method**: Token-based authentication using JWT (replaces cookie-based sessions)
2. **Token Storage**: Use `keytar` for secure storage in OS credential vault (Windows Credential Manager, macOS Keychain, Linux Secret Service)
3. **OAuth Flow**: System browser for OAuth (not Electron popup) - uses `shell.openExternal()`
4. **OAuth State Store**: Stateless in-memory Map (no session dependency)
5. **Production Callback**: Custom protocol handler (`mc-server-manager://auth`) for production
6. **Development Callback**: Localhost polling endpoint (`/api/auth/callback/poll`) for development
7. **Token Transfer**: Custom protocol redirect in production, polling in development
8. **API Authentication**: Authorization headers (`Bearer <token>`) instead of cookies
9. **Token Injection**: Electron main process retrieves token from keytar and includes in API requests via IPC
10. **Native Module Support**: `electron-rebuild` for keytar, unpack from ASAR archive
11. **Single Instance Lock**: Prevent multiple app instances on Windows
12. **Backend Dependencies**: Include backend dependencies in production build (jsonwebtoken, etc.)

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
- ✅ Token-based authentication implemented (JWT)
- ✅ System browser OAuth flow works
- ✅ Token storage in OS credential vault (keytar)
- ✅ Custom protocol handler for production
- ✅ Localhost polling fallback for development
- ✅ Main window can access authenticated state
- ✅ Token persists across app restarts

---

## 2. Architecture Overview

### 2.1 Design Principles

1. **Defensive Programming**: Assume failures at every step, validate all assumptions
2. **Extensive Logging**: Log every significant event, state change, and decision point
3. **Explicit Cookie Management**: Don't rely on automatic cookie sharing; manage cookies explicitly
4. **Stateless Where Possible**: Minimize dependency on session cookies for critical flows
5. **Graceful Degradation**: Provide clear error messages and fallback behaviors

### 2.2 Implemented Solution Architecture

The solution uses a **token-based approach**:

1. **Stateless OAuth State Store** ✅
   - In-memory Map for OAuth state validation
   - No dependency on cookies or sessions
   - Automatic cleanup of expired states

2. **JWT Token Authentication** ✅
   - Backend issues JWT tokens after successful OAuth
   - Token contains GitHub access token, login, and scopes
   - Tokens expire after configured time (default 30 days)

3. **Secure Token Storage** ✅
   - Tokens stored in OS credential vault using `keytar`
   - Windows: Credential Manager
   - macOS: Keychain
   - Linux: Secret Service
   - No tokens stored in plain text

4. **System Browser OAuth Flow** ✅
   - OAuth opens in user's default browser (not Electron popup)
   - Better security and user experience
   - Production: Redirects to custom protocol (`mc-server-manager://auth`)
   - Development: Redirects to localhost polling endpoint

5. **Token Injection** ✅
   - Electron main process retrieves token from keytar
   - Token included in Authorization header for all API requests
   - Frontend uses IPC to make authenticated requests

### 2.3 Component Responsibilities

#### Electron Main Process (`electron/main.ts`)
- Register custom protocol handler (`mc-server-manager://`)
- Handle single-instance lock (Windows)
- Open OAuth flow in system browser via `shell.openExternal()`
- Handle custom protocol redirects (production)
- Poll localhost endpoint for token (development fallback)
- Store tokens securely using `keytar`
- Retrieve tokens from keytar and inject into API requests via IPC
- Log all authentication events

#### Electron Renderer Process (`frontend/src/App.tsx`, `frontend/src/lib/api.ts`)
- **Initiate OAuth flow via IPC** (required for Electron - `window.location.origin` is `file://` in production)
- Detect Electron mode and use `electronAPI.startGitHubAuth()` instead of window navigation
- Listen for `github-auth-complete` IPC event
- Use `electronAPI.apiRequest()` for authenticated API calls (handles token injection)
- Validate authentication status periodically using `/api/auth/status`
- Handle token expiration gracefully

#### Backend (`backend/src/routes/auth.ts`)
- Process OAuth flow
- Implement stateless in-memory OAuth state store
- Issue JWT tokens after successful OAuth
- Redirect to custom protocol (production) or localhost polling endpoint (development)
- Validate JWT tokens from Authorization header
- Use `/api/auth/status` endpoint for validation
- Log all authentication operations

---

## 3. Implementation Summary

### Phase 1: Logging Infrastructure ✅

**Completed**: Comprehensive logging infrastructure established.

- ✅ Created `docs/logging-standards.md` with logging standards
- ✅ Implemented structured JSON loggers for main, renderer, and backend processes
- ✅ Added logging to all OAuth-related events
- ✅ Backend includes file logging for production

### Phase 2: Token-Based Authentication ✅

**Completed**: Replaced cookie-based sessions with JWT tokens.

- ✅ Implemented stateless in-memory OAuth state store in backend
- ✅ Added JWT token issuance after successful OAuth
- ✅ Created JWT authentication middleware (`backend/src/middleware/auth.ts`)
- ✅ Updated backend routes to use JWT tokens from Authorization header
- ✅ Removed `express-session` dependency

### Phase 3: Secure Token Storage ✅

**Completed**: Implemented secure token storage using OS credential vault.

- ✅ Added `keytar` dependency for secure token storage
- ✅ Implemented token storage/retrieval in Electron main process
- ✅ Added `electron-rebuild` for native module support
- ✅ Configured ASAR unpacking for keytar module
- ✅ Tokens persist across app restarts

### Phase 4: System Browser OAuth Flow ✅

**Completed**: Replaced Electron popup with system browser OAuth.

- ✅ Removed Electron popup window approach
- ✅ Implemented `shell.openExternal()` for system browser OAuth
- ✅ Registered custom protocol handler (`mc-server-manager://`)
- ✅ Added single-instance lock for Windows
- ✅ Implemented custom protocol URL handling

### Phase 5: Development/Production Callback Handling ✅

**Completed**: Dual-mode callback handling for dev and production.

- ✅ Production: Custom protocol redirect (`mc-server-manager://auth?token=...`)
- ✅ Development: Localhost polling endpoint (`/api/auth/callback/poll`)
- ✅ Backend detects environment and redirects accordingly
- ✅ Electron polls for token in development mode
- ✅ Polling enabled in both dev and production as fallback

### Phase 6: API Request Token Injection ✅

**Completed**: Automatic token injection in API requests.

- ✅ Created IPC handler for authenticated API requests
- ✅ Electron main process retrieves token from keytar
- ✅ Token included in Authorization header automatically
- ✅ Frontend uses `electronAPI.apiRequest()` for authenticated calls
- ✅ Fallback to regular fetch for web mode

### Phase 7: Production Build Configuration ✅

**Completed**: Fixed production build issues.

- ✅ Added `jsonwebtoken` to root dependencies
- ✅ Removed `--ignore=backend/node_modules` from build scripts
- ✅ Added `electron-rebuild` to build process
- ✅ Configured ASAR unpacking for keytar
- ✅ All backend dependencies included in production build

---

## 4. Logging Strategy

### 4.1 Log Levels

- **DEBUG**: Detailed information for debugging (token presence, OAuth state, navigation URLs)
- **INFO**: Normal operational events (OAuth started, system browser opened, authentication successful)
- **WARN**: Warning conditions (token read failed, token validation failed, retry attempts)
- **ERROR**: Error conditions (OAuth failed, token storage failed, authentication lost)

### 4.2 Required Log Points

#### Electron Main Process
- [x] Window creation (main window)
- [x] Window destruction
- [x] Custom protocol handler registration
- [x] Protocol URL handling
- [x] IPC message send/receive
- [x] Token storage/retrieval from keytar
- [x] OAuth flow state changes
- [x] Error conditions

#### Electron Renderer Process
- [x] OAuth initiation via IPC
- [x] IPC message send/receive
- [x] API request/response (with token injection)
- [x] Authentication status validation
- [x] Error conditions

#### Backend
- [x] OAuth route access
- [x] OAuth state storage/validation
- [x] JWT token issuance
- [x] Token validation from Authorization header
- [x] Authentication status requests
- [x] Error conditions

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
- Full JWT token values (log only presence/absence)
- Full GitHub access tokens
- Passwords
- Full request/response bodies

**Always log**:
- Token presence/absence
- Authentication status
- Error messages
- State transitions
- Operation results (success/failure)
- OAuth flow steps

---

## 5. Testing Strategy

### 5.1 Unit Tests

- Token storage/retrieval from keytar
- JWT token creation and validation
- OAuth state validation
- Error handling

### 5.2 Integration Tests

- Complete OAuth flow in Electron
- Token transfer via custom protocol (production)
- Token transfer via localhost polling (development)
- Token persistence across app restarts
- Error recovery scenarios

### 5.3 Manual Testing Checklist

- [x] System browser opens for OAuth (not Electron popup)
- [x] GitHub authentication completes in system browser
- [x] Custom protocol redirect works in production
- [x] Localhost polling works in development
- [x] Main window shows authenticated state after OAuth
- [x] Token persists after app restart (stored in keytar)
- [x] Authenticated API requests work
- [x] Token expiration handled gracefully
- [x] Error messages are clear
- [x] Logs contain sufficient detail for debugging
- [x] Production build includes all dependencies
- [x] Native module (keytar) works in production

---

## 6. Known Pitfalls and Mitigations

### 6.1 Custom Protocol Registration

**Pitfall**: Custom protocol handler may not work in development mode (app not installed).

**Mitigation**: 
- Use localhost polling endpoint for development mode
- Custom protocol only used in production (when app is installed)
- Backend detects environment and redirects accordingly
- Polling enabled in both dev and production as fallback

### 6.2 Native Module Loading

**Pitfall**: `keytar` native module may not load in production build.

**Mitigation**:
- Use `electron-rebuild` to rebuild native modules for Electron
- Unpack `keytar` from ASAR archive (native modules can't be in ASAR)
- Add `--asarUnpack=**/node_modules/keytar/**` to build script
- Test token storage in production build

### 6.3 Token Expiration

**Pitfall**: JWT tokens may expire between OAuth and first API request.

**Mitigation**:
- Set reasonable token expiration (default 30 days, configurable via `JWT_EXPIRY`)
- Frontend validates token periodically
- Clear expired tokens from keytar
- Prompt re-authentication when token expires
- Log token expiration events

### 6.4 Multiple Windows

**Pitfall**: Multiple app instances may create conflicting sessions.

**Mitigation**:
- Use single app instance enforcement
- Clear old sessions on app start
- Log all session operations

### 6.5 Frontend URL Construction in Electron

**Pitfall**: `window.location.origin` is `file://` in Electron production, breaking OAuth URL construction.

**Mitigation**:
- Always detect Electron mode before using `window.location.origin`
- Use IPC (`electronAPI.startGitHubAuth()`) for OAuth initiation in Electron
- Fall back to window navigation only in web mode
- Never construct OAuth URLs using `window.location.origin` in Electron

---

## 7. Implementation Checklist

### Phase 1: Logging Infrastructure ✅
- [x] Create logging standards document
- [x] Implement logger utilities (main, renderer, backend)
- [x] Add logging to existing OAuth flow
- [x] Verify logs are comprehensive

### Phase 2: Token-Based Authentication ✅
- [x] Implement stateless in-memory OAuth state store in backend
- [x] Implement JWT token issuance after OAuth
- [x] Create JWT authentication middleware
- [x] Update backend routes to use JWT tokens
- [x] Remove express-session dependency

### Phase 3: Secure Token Storage ✅
- [x] Add keytar dependency for secure storage
- [x] Implement token storage/retrieval in Electron main process
- [x] Add electron-rebuild for native module support
- [x] Configure ASAR unpacking for keytar
- [x] Test token persistence across app restarts

### Phase 4: System Browser OAuth Flow ✅
- [x] Remove Electron popup window approach
- [x] Implement system browser OAuth via shell.openExternal()
- [x] Register custom protocol handler
- [x] Add single-instance lock for Windows
- [x] Implement custom protocol URL handling

### Phase 5: Development/Production Callback ✅
- [x] Implement custom protocol redirect for production
- [x] Implement localhost polling for development
- [x] Add backend callback detection logic
- [x] Enable polling in both dev and production
- [x] Test both callback methods

### Phase 6: API Request Token Injection ✅
- [x] Create IPC handler for authenticated API requests
- [x] Implement token retrieval from keytar
- [x] Add Authorization header injection
- [x] Update frontend to use electronAPI.apiRequest()
- [x] Test authenticated API requests

### Phase 7: Production Build Configuration ✅
- [x] Add jsonwebtoken to root dependencies
- [x] Fix backend dependencies in build
- [x] Add electron-rebuild to build process
- [x] Configure ASAR unpacking
- [x] Test production build

### Final Steps
- [ ] Remove debug instrumentation (keep essential logs)
- [ ] Update documentation
- [ ] Create user guide
- [ ] Performance testing

---

## 8. Success Criteria

The implementation is considered successful when:

1. ✅ User can click "Sign in with GitHub" in Electron app
2. ✅ System browser opens for GitHub OAuth (not Electron popup)
3. ✅ User authenticates with GitHub in system browser
4. ✅ Main window immediately shows authenticated state after OAuth
5. ✅ User can make authenticated API requests
6. ✅ Token persists across app restarts (stored in OS credential vault)
7. ✅ All operations are logged with sufficient detail
8. ✅ Error scenarios are handled gracefully with clear messages
9. ✅ No "Invalid OAuth state" errors
10. ✅ No cookie-based session issues (using tokens instead)
11. ✅ Production build works correctly with all dependencies
12. ✅ Custom protocol handler works in production
13. ✅ Localhost polling works in development

---

## 9. Implementation Notes

### Key Changes from Original Plan

The implementation diverged from the original cookie-based approach due to fundamental issues with cookies in Electron OAuth flows. The final implementation uses:

1. **Token-based authentication** instead of cookies
2. **System browser** instead of Electron popup
3. **OS credential vault** (keytar) instead of session cookies
4. **Custom protocol handler** for production callbacks
5. **Localhost polling** for development callbacks

### Why This Approach Works Better

- **No cookie domain/path issues**: Tokens are stored securely in OS vault
- **Better security**: Tokens in OS credential vault vs cookies
- **Better UX**: System browser is more familiar to users
- **More reliable**: No cookie sharing issues between windows
- **Cross-platform**: Works consistently on Windows, macOS, and Linux

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
      auth.ts          # OAuth routes, JWT token issuance
    middleware/
      auth.ts          # JWT authentication middleware
    utils/
      logger.ts        # Backend logger
    index.ts           # Server configuration (no session middleware)
```

---

## Appendix B: Key Dependencies

- `electron`: Window management, IPC, shell API
- `keytar`: Secure token storage in OS credential vault
- `jsonwebtoken`: JWT token creation and validation
- `express`: Backend server
- `crypto`: OAuth state generation
- `electron-rebuild`: Rebuild native modules for Electron
- `@types/jsonwebtoken`: TypeScript types for jsonwebtoken

---

**End of Specification**
