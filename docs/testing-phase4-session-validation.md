# Testing Phase 4: Session Validation and Error Handling

This guide helps you test the session validation and error handling features implemented in Phase 4.

## Features to Test

### 1. Periodic Session Validation

**What to test:**
- Session is validated every 30 seconds automatically
- Session expiration is detected
- User is notified when session expires

**Test Steps:**
1. Sign in with GitHub (should be authenticated)
2. Open Electron DevTools Console
3. Wait 30 seconds
4. Check console for `session-validation-periodic` and `session-validation-result` logs
5. Verify logs show `authenticated: true` (if still authenticated)

**Expected Logs:**
```json
{"event":"session-validation-periodic","data":{"interval":"30s"}}
{"event":"session-validation-result","data":{"authenticated":true,"login":"verziondev"}}
```

### 2. Session Expiration Detection

**What to test:**
- When session expires, user is notified
- Auth status is updated
- Error message is displayed

**Test Steps:**
1. Sign in with GitHub
2. Manually expire session (or wait for natural expiration)
   - Option: Restart backend server (sessions are in-memory)
   - Option: Wait for session to naturally expire
3. Wait for next validation cycle (up to 30 seconds)
4. Check if error message appears: "Your session has expired. Please sign in again."

**Expected Behavior:**
- `session-expired` log appears
- Auth status changes to `authenticated: false`
- Error message is displayed to user

### 3. Error Recovery - Cookie Read Retry

**What to test:**
- If cookie read fails, system retries automatically
- Retry is logged

**Test Steps:**
1. This is hard to test manually (requires timing issues)
2. Check Electron terminal logs during OAuth flow
3. Look for `oauth-cookie-read-retry` if first attempt fails

**Expected Logs:**
- `cookie-read-attempt` (first attempt)
- `oauth-cookie-read-retry` (if first fails)
- `cookie-read-success` (after retry)

### 4. Error Recovery - Cookie Set Retry

**What to test:**
- If cookie set fails, system retries automatically
- Retry is logged

**Test Steps:**
1. This is hard to test manually (requires timing issues)
2. Check Electron terminal logs during OAuth flow
3. Look for `oauth-cookie-set-retry` if first attempt fails

**Expected Logs:**
- `cookie-set-attempt` (first attempt)
- `oauth-cookie-set-retry` (if first fails)
- `cookie-set-success` (after retry)

### 5. OAuth Error Handling

**What to test:**
- OAuth errors are caught and displayed to user
- Error messages are user-friendly

**Test Steps:**
1. This requires simulating an OAuth error
2. Check Electron terminal for error logs
3. Verify error messages are sent to renderer

**Expected Behavior:**
- `oauth-error-received` log in frontend console
- Error message displayed to user
- User can retry OAuth

### 6. Network Error Handling

**What to test:**
- Network errors don't clear session unnecessarily
- Only 401/Unauthorized errors clear session

**Test Steps:**
1. Sign in with GitHub
2. Stop backend server temporarily
3. Wait for validation cycle
4. Check that session status is NOT cleared (only on 401)

**Expected Behavior:**
- `session-validation-failed` log appears
- Auth status remains (not cleared on network errors)
- Session only cleared on 401/Unauthorized

## Quick Test Checklist

- [ ] Periodic validation runs every 30 seconds
- [ ] Session expiration is detected and user notified
- [ ] Cookie read retry works (check logs)
- [ ] Cookie set retry works (check logs)
- [ ] OAuth errors are handled gracefully
- [ ] Network errors don't clear valid sessions
- [ ] All error scenarios are logged

## Manual Test Sequence

1. **Start all services:**
   ```bash
   npm run dev:be  # Terminal 1
   npm run dev:fe  # Terminal 2
   npm run electron:dev  # Terminal 3
   ```

2. **Sign in with GitHub:**
   - Click "Sign in with GitHub"
   - Authenticate
   - Verify authenticated state

3. **Monitor periodic validation:**
   - Open DevTools Console
   - Wait 30 seconds
   - Check for validation logs

4. **Test session expiration:**
   - Restart backend server (clears sessions)
   - Wait for next validation cycle
   - Verify error message appears

5. **Test error recovery:**
   - Check Electron terminal logs during OAuth
   - Look for retry attempts in logs

## Success Criteria

✅ Session validation runs periodically
✅ Session expiration is detected
✅ Error recovery mechanisms work
✅ User receives clear error messages
✅ All error scenarios are logged
✅ Network errors handled gracefully
