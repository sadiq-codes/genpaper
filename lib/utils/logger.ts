// Structured logging utility with different levels

interface LogContext {
  [key: string]: unknown
}

interface Logger {
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
  debug: (message: string, context?: LogContext) => void
}

const isDevelopment = process.env.NODE_ENV === 'development'

function formatLogMessage(level: string, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString()
  const contextStr = context ? ` ${JSON.stringify(context)}` : ''
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`
}

function shouldLog(level: string): boolean {
  if (isDevelopment) return true
  
  // In production, only log warnings and errors by default
  // Can be overridden with DEBUG environment variable
  const debugEnabled = process.env.DEBUG === '*' || process.env.DEBUG?.includes('pdf')
  
  switch (level) {
    case 'debug':
      return debugEnabled
    case 'info':
      return debugEnabled
    case 'warn':
    case 'error':
      return true
    default:
      return false
  }
}

export const logger: Logger = {
  info: (message: string, context?: LogContext) => {
    if (shouldLog('info')) {
      console.log(formatLogMessage('info', message, context))
    }
  },

  warn: (message: string, context?: LogContext) => {
    if (shouldLog('warn')) {
      console.warn(formatLogMessage('warn', message, context))
    }
  },

  error: (message: string, context?: LogContext) => {
    if (shouldLog('error')) {
      // Only include stack trace in development
      const errorContext = isDevelopment ? context : {
        ...context,
        // Remove sensitive data from production logs
        stack: undefined
      }
      console.error(formatLogMessage('error', message, errorContext))
    }
  },

  debug: (message: string, context?: LogContext) => {
    if (shouldLog('debug')) {
      console.debug(formatLogMessage('debug', message, context))
    }
  }
} 