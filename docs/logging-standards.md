# Logging Standards for MC Server Manager

## Overview

This document defines the logging standards for the MC Server Manager application, with particular focus on OAuth authentication flows in Electron. Comprehensive logging is essential for debugging complex authentication issues.

## Log Format

All logs must follow a consistent JSON structure:

```typescript
{
  timestamp: number,           // Unix timestamp in milliseconds
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  component: string,           // Component identifier
  event: string,               // Event name
  data: object,                // Event-specific data
  sessionId?: string,          // Session ID (sanitized)
  windowId?: string,           // Window ID (for Electron)
  error?: string               // Error message (if applicable)
}
```

## Log Levels

### DEBUG
- Detailed information for debugging
- Cookie values (sanitized - first/last 4 chars only)
- Session IDs (sanitized - first/last 4 chars only)
- Navigation URLs
- Cookie read/write operations
- IPC message details

### INFO
- Normal operational events
- OAuth flow started/completed
- Popup window opened/closed
- Authentication successful
- Session validation results

### WARN
- Warning conditions
- Cookie read failed (retryable)
- Session validation failed (non-critical)
- Retry attempts
- Timing issues

### ERROR
- Error conditions
- OAuth flow failed
- Cookie set failed
- Session lost
- Critical failures

## Component Identifiers

Use these component identifiers consistently:

- `electron-main`: Electron main process
- `electron-renderer`: Electron renderer process
- `backend`: Backend server
- `backend-auth`: Backend authentication routes
- `backend-session`: Backend session management

## Required Log Fields

### All Logs
- `timestamp`: Unix timestamp in milliseconds
- `level`: Log level (DEBUG, INFO, WARN, ERROR)
- `component`: Component identifier
- `event`: Event name (see Event Names section)

### Electron Main Process Logs
- `windowId`: Window identifier (if applicable)
- `data`: Event-specific data

### Electron Renderer Process Logs
- `data`: Event-specific data

### Backend Logs
- `sessionId`: Session ID (sanitized)
- `data`: Event-specific data

## Event Names

### OAuth Flow Events
- `oauth-started`: OAuth flow initiated
- `oauth-popup-created`: OAuth popup window created
- `oauth-popup-navigation`: Popup navigation event
- `oauth-callback-detected`: OAuth callback URL detected
- `oauth-callback-processed`: OAuth callback processed
- `oauth-completed`: OAuth flow completed successfully
- `oauth-failed`: OAuth flow failed

### Cookie Events
- `cookie-read-attempt`: Attempting to read cookie
- `cookie-read-success`: Cookie read successfully
- `cookie-read-failed`: Cookie read failed
- `cookie-set-attempt`: Attempting to set cookie
- `cookie-set-success`: Cookie set successfully
- `cookie-set-failed`: Cookie set failed
- `cookie-verify-attempt`: Verifying cookie
- `cookie-verify-success`: Cookie verified
- `cookie-verify-failed`: Cookie verification failed

### Session Events
- `session-created`: Session created
- `session-validated`: Session validated
- `session-invalid`: Session invalid
- `session-expired`: Session expired
- `session-destroyed`: Session destroyed

### Window Events
- `window-created`: Window created
- `window-closed`: Window closed
- `window-navigation`: Window navigation event

### IPC Events
- `ipc-send`: IPC message sent
- `ipc-receive`: IPC message received
- `ipc-handler-registered`: IPC handler registered

### API Events
- `api-request`: API request made
- `api-response`: API response received
- `api-error`: API request failed

## Log Sanitization

**Never log:**
- Full cookie values (log only presence/absence and first/last 4 chars)
- Full session IDs (log only first/last 4 chars)
- Passwords or tokens
- Full request/response bodies
- Personal information

**Always log:**
- Cookie presence/absence
- Session ID presence/absence (sanitized)
- Error messages
- State transitions
- Operation results (success/failure)
- Timing information

### Sanitization Examples

```typescript
// Cookie value sanitization
const cookieValue = 's%3Aabc123def456.xyz789';
const sanitized = cookieValue.length > 8 
  ? `${cookieValue.slice(0, 4)}...${cookieValue.slice(-4)}`
  : '***';

// Session ID sanitization
const sessionId = '1hzuz7Hx42nAiJsbqXieIknqKMIqL4lk';
const sanitized = sessionId.length > 8
  ? `${sessionId.slice(0, 4)}...${sessionId.slice(-4)}`
  : '***';
```

## Log Aggregation Strategy

### Development
- Logs output to console (stdout/stderr)
- Optional: Write to log files in development directory

### Production
- Logs output to console (stdout/stderr)
- Optional: Write to log files in user data directory
- Log rotation: Keep last 7 days of logs, max 10MB per file

## Implementation Guidelines

1. **Use structured logging**: Always use the defined JSON format
2. **Log at appropriate levels**: Don't log DEBUG in production unless needed
3. **Sanitize sensitive data**: Always sanitize cookies, session IDs, tokens
4. **Include context**: Include relevant context in `data` field
5. **Log errors completely**: Include error messages and stack traces (sanitized)
6. **Log timing**: Include timing information for performance-critical operations
7. **Log state transitions**: Log all significant state changes
8. **Log failures immediately**: Don't wait to log errors

## Example Log Entries

### OAuth Started
```json
{
  "timestamp": 1704816000000,
  "level": "INFO",
  "component": "electron-main",
  "event": "oauth-started",
  "data": {
    "returnTo": "/projects",
    "oauthUrl": "http://localhost:4000/api/auth/github?returnTo=/projects"
  },
  "windowId": "main"
}
```

### Cookie Read Success
```json
{
  "timestamp": 1704816001000,
  "level": "DEBUG",
  "component": "electron-main",
  "event": "cookie-read-success",
  "data": {
    "url": "http://localhost:4000",
    "cookieName": "connect.sid",
    "cookiePresent": true,
    "cookieValue": "s%3Aabc...xyz9"
  },
  "windowId": "oauth-popup"
}
```

### OAuth Failed
```json
{
  "timestamp": 1704816002000,
  "level": "ERROR",
  "component": "backend-auth",
  "event": "oauth-failed",
  "data": {
    "reason": "Invalid OAuth state",
    "expectedState": "abc1...def2",
    "receivedState": "xyz3...ghi4"
  },
  "sessionId": "1hzu...4lk",
  "error": "Invalid OAuth state parameter"
}
```

## Logging Checklist

When implementing logging, ensure:

- [ ] All OAuth-related events are logged
- [ ] Cookie operations are logged with sanitized values
- [ ] Session operations are logged with sanitized IDs
- [ ] IPC messages are logged
- [ ] API requests/responses are logged (sanitized)
- [ ] Error conditions are logged with full context
- [ ] Timing information is included where relevant
- [ ] Log format is consistent across all components
- [ ] Sensitive data is properly sanitized
