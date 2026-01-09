/**
 * Logger utility for backend server
 * Provides structured logging with sanitization for sensitive data
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  event: string;
  data: Record<string, unknown>;
  sessionId?: string;
  error?: string;
}

/**
 * Sanitize a value by showing only first and last 4 characters
 */
function sanitizeValue(value: string): string {
  if (value.length <= 8) {
    return '***';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Sanitize cookie value in log data
 */
function sanitizeCookieValue(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };
  if (typeof sanitized.cookieValue === 'string') {
    sanitized.cookieValue = sanitizeValue(sanitized.cookieValue);
  }
  return sanitized;
}

/**
 * Sanitize session ID
 */
function sanitizeSessionId(sessionId?: string): string | undefined {
  if (!sessionId) {
    return undefined;
  }
  return sanitizeValue(sessionId);
}

/**
 * Sanitize log data to remove sensitive information
 */
function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  return sanitizeCookieValue(data);
}

/**
 * Format log entry as JSON string
 */
function formatLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Create a logger instance for a specific component
 */
export function createLogger(component: string) {
  const log = (level: LogLevel, event: string, data: Record<string, unknown> = {}, sessionId?: string, error?: string) => {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      event,
      data: sanitizeLogData(data),
      ...(sessionId && { sessionId: sanitizeSessionId(sessionId) }),
      ...(error && { error }),
    };

    const logLine = formatLogEntry(entry);
    
    // Output to console with appropriate method
    switch (level) {
      case 'DEBUG':
        console.debug(logLine);
        break;
      case 'INFO':
        console.info(logLine);
        break;
      case 'WARN':
        console.warn(logLine);
        break;
      case 'ERROR':
        console.error(logLine);
        break;
    }
  };

  return {
    debug: (event: string, data?: Record<string, unknown>, sessionId?: string) => {
      log('DEBUG', event, data, sessionId);
    },
    info: (event: string, data?: Record<string, unknown>, sessionId?: string) => {
      log('INFO', event, data, sessionId);
    },
    warn: (event: string, data?: Record<string, unknown>, sessionId?: string, error?: string) => {
      log('WARN', event, data, sessionId, error);
    },
    error: (event: string, data?: Record<string, unknown>, sessionId?: string, error?: string) => {
      log('ERROR', event, data, sessionId, error);
    },
  };
}

/**
 * Default logger for backend component
 */
export const logger = createLogger('backend');
