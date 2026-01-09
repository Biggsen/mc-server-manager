/**
 * Logger utility for Electron renderer process
 * Provides structured logging with sanitization for sensitive data
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  event: string;
  data: Record<string, unknown>;
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
 * Sanitize session ID in log data
 */
function sanitizeSessionId(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };
  if (typeof sanitized.sessionId === 'string') {
    sanitized.sessionId = sanitizeValue(sanitized.sessionId);
  }
  return sanitized;
}

/**
 * Sanitize log data to remove sensitive information
 */
function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  let sanitized = sanitizeCookieValue(data);
  sanitized = sanitizeSessionId(sanitized);
  return sanitized;
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
  const log = (level: LogLevel, event: string, data: Record<string, unknown> = {}, error?: string) => {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component,
      event,
      data: sanitizeLogData(data),
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
    debug: (event: string, data?: Record<string, unknown>) => {
      log('DEBUG', event, data);
    },
    info: (event: string, data?: Record<string, unknown>) => {
      log('INFO', event, data);
    },
    warn: (event: string, data?: Record<string, unknown>, error?: string) => {
      log('WARN', event, data, error);
    },
    error: (event: string, data?: Record<string, unknown>, error?: string) => {
      log('ERROR', event, data, error);
    },
  };
}

/**
 * Default logger for electron-renderer component
 */
export const logger = createLogger('electron-renderer');
