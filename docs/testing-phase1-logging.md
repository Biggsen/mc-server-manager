# Testing Phase 1: Logging Infrastructure

This guide helps you test the logging infrastructure we just implemented.

## Prerequisites

- All code has been built successfully
- Backend, frontend, and Electron code compile without errors

## Testing Steps

### 1. Test Backend Logging

Start the backend server and observe logs:

```bash
npm run dev:be
```

**Expected Logs:**
- When you access `/api/auth/status`, you should see:
  ```json
  {"timestamp":...,"level":"INFO","component":"backend-auth","event":"session-validated",...}
  ```

**Test Actions:**
1. Open browser to `http://localhost:4000/api/auth/status`
2. Check console output for structured JSON logs
3. Verify logs include: timestamp, level, component, event, data

### 2. Test Frontend Logging (Web Mode)

Start the frontend dev server:

```bash
npm run dev:fe
```

**Expected Logs:**
- Open browser DevTools Console (F12)
- Navigate to `http://localhost:5173`
- You should see logs when:
  - App loads and checks auth status
  - API requests are made
  - OAuth is initiated

**Test Actions:**
1. Open `http://localhost:5173` in browser
2. Open DevTools Console (F12)
3. Look for structured JSON logs with:
   - `api-request` events
   - `api-response` events
   - `auth-status-request` events
   - `oauth-initiation` events

### 3. Test Electron Logging

Start Electron in development mode:

```bash
npm run electron:dev
```

**Expected Logs:**
- In the terminal where you ran `electron:dev`, you should see:
  - `app-initializing` log
  - `window-created` log
  - `window-loading` log
  - `window-navigation` logs when navigating

**Test Actions:**
1. Run `npm run electron:dev`
2. Watch the terminal output for structured JSON logs
3. In the Electron app:
   - Click "Sign in with GitHub" button
   - Check terminal for `oauth-initiation` log
   - Check browser console (DevTools) for frontend logs

### 4. Test OAuth Flow Logging

**Backend Logs (Terminal running `npm run dev:be`):**
1. Click "Sign in with GitHub" in the app
2. You should see:
   - `oauth-started` log
   - `oauth-state-created` log (DEBUG level)
   - When callback happens: `oauth-callback-detected`
   - `oauth-token-exchange-start` (DEBUG)
   - `oauth-token-received` (DEBUG)
   - `session-created` log
   - `oauth-completed` log

**Frontend Logs (Browser DevTools Console):**
1. You should see:
   - `oauth-initiation` log
   - `api-request` logs for auth status checks
   - `api-response` logs

**Electron Logs (Terminal running `npm run electron:dev`):**
1. You should see:
   - `window-navigation` logs
   - `window-external-link` logs (if external browser opens)

## Verification Checklist

### Log Format Verification
- [ ] All logs are valid JSON
- [ ] All logs have `timestamp` field (number)
- [ ] All logs have `level` field (DEBUG, INFO, WARN, or ERROR)
- [ ] All logs have `component` field (string)
- [ ] All logs have `event` field (string)
- [ ] All logs have `data` field (object)

### Sanitization Verification
- [ ] Cookie values are sanitized (show only first/last 4 chars)
- [ ] Session IDs are sanitized (show only first/last 4 chars)
- [ ] No full tokens or passwords in logs

### Component-Specific Verification
- [ ] Backend logs include `sessionId` field (when available)
- [ ] Electron logs include `windowId` field (when applicable)
- [ ] Frontend logs don't include sensitive data

### Event Coverage
- [ ] OAuth flow events are logged
- [ ] API request/response events are logged
- [ ] Window lifecycle events are logged (Electron)
- [ ] Session events are logged (backend)

## Common Issues

### No Logs Appearing
- Check that you're looking in the right place:
  - Backend: Terminal running `npm run dev:be`
  - Frontend: Browser DevTools Console
  - Electron: Terminal running `npm run electron:dev`

### Logs Not in JSON Format
- Check that logger utilities are imported correctly
- Verify TypeScript compiled without errors

### Missing Events
- Check that logging calls were added to all relevant functions
- Verify log level (DEBUG logs might not show in production)

## Next Steps

Once logging is verified:
1. Proceed to Phase 2: Cookie Management Infrastructure
2. Use logs to debug any OAuth issues
3. Logs will be essential for debugging cookie transfer in Phase 3
