# Testing Phase 3: OAuth Flow Integration

This guide helps you test the complete OAuth flow in Electron.

## Prerequisites

1. Backend server running: `npm run dev:be`
2. Frontend dev server running: `npm run dev:fe`
3. Electron app: `npm run electron:dev`

## Test Steps

### 1. Start All Services

**Terminal 1 - Backend:**
```bash
npm run dev:be
```

**Terminal 2 - Frontend:**
```bash
npm run dev:fe
```

**Terminal 3 - Electron:**
```bash
npm run electron:dev
```

### 2. Test OAuth Flow in Electron

1. **Click "Sign in with GitHub" button** in the Electron app
2. **Observe the OAuth popup window** - should open automatically
3. **Authenticate with GitHub** in the popup
4. **Popup should close automatically** after authentication
5. **Main window should show authenticated state** (avatar, username)

### 3. What to Check

#### Backend Logs (Terminal 1)
- `oauth-started` - OAuth flow initiated
- `oauth-state-created` - State stored in memory (storeSize should increment)
- `oauth-callback-detected` - Callback received
- `oauth-state-validated` - State validated from store
- `session-created` - Session created with GitHub token
- `oauth-completed` - OAuth flow completed

#### Electron Main Process Logs (Terminal 3)
- `ipc-oauth-start` - IPC handler called
- `oauth-popup-created` - Popup window created
- `oauth-popup-loading` - Popup loading OAuth URL
- `oauth-popup-navigation` - Navigation events
- `oauth-callback-detected` - Callback URL detected
- `cookie-poll-start` - Starting to poll for cookie
- `cookie-read-success` - Cookie read from popup
- `cookie-set-success` - Cookie set in main window
- `cookie-verify-success` - Cookie verified in main window
- `oauth-complete-notification-sent` - Notification sent to renderer
- `oauth-popup-closed` - Popup closed

#### Frontend/Renderer Logs (Electron DevTools Console)
- `oauth-initiation` - OAuth started (method: IPC)
- `oauth-initiation-ipc` - Using IPC method
- `oauth-listener-registered` - IPC listener set up
- `oauth-complete-received` - IPC event received
- `auth-status-after-oauth` - Auth status checked
- `api-request` / `api-response` - API calls with cookies

### 4. Verification Checklist

- [ ] OAuth popup opens when clicking "Sign in with GitHub"
- [ ] Popup navigates to GitHub OAuth page
- [ ] After GitHub auth, popup closes automatically
- [ ] Main window shows authenticated state (avatar, username)
- [ ] Can make authenticated API requests (e.g., fetch projects)
- [ ] All logs appear in correct format
- [ ] No errors in any terminal/console

### 5. Common Issues

#### Popup doesn't open
- Check Electron terminal for errors
- Verify IPC handler is registered
- Check preload script is loaded

#### Cookie not transferred
- Check Electron logs for cookie read/set operations
- Verify popup uses `persist:main` partition
- Check cookie domain/path settings

#### Main window not authenticated
- Check if cookie was set successfully
- Verify cookie verification logs
- Check if IPC notification was sent
- Verify frontend listener is registered

#### OAuth state validation fails
- Check backend logs for state store size
- Verify state is stored in memory (not session)
- Check state expiry (10 minutes)

## Success Criteria

✅ OAuth flow completes successfully
✅ Session cookie is transferred from popup to main window
✅ Main window can make authenticated API requests
✅ All steps are logged with sufficient detail
✅ No errors in any component

## Next Steps

Once Phase 3 is verified, proceed to Phase 4: Session Validation and Error Handling
