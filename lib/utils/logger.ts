// Centralized logging utility to replace raw console calls
// Allows easy switching to cloud logging or silencing in production

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

class Logger {
  private logLevel: LogLevel
  private isDev: boolean

  constructor() {
    this.logLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
    this.isDev = process.env.NODE_ENV !== 'production'
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    }
    return levels[level] >= levels[this.logLevel]
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const prefix = this.isDev ? this.getEmoji(level) : `[${level.toUpperCase()}]`
    const contextStr = context ? ` ${JSON.stringify(context)}` : ''
    return `${timestamp} ${prefix} ${message}${contextStr}`
  }

  private getEmoji(level: LogLevel): string {
    const emojis = {
      debug: '🔍',
      info: '📝',
      warn: '⚠️',
      error: '❌'
    }
    return emojis[level]
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context))
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context))
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context))
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context))
    }
  }

  // Generation-specific logging methods
  generation(stage: string, progress: number, message: string, context?: LogContext): void {
    this.info(`[${stage.toUpperCase()}:${progress}%] ${message}`, context)
  }

  citation(message: string, context?: LogContext): void {
    this.info(`📌 ${message}`, context)
  }

  analytics(message: string, data: LogContext): void {
    this.info(`📊 ${message}`, data)
  }

  toolCall(message: string, context?: LogContext): void {
    this.debug(`🔧 ${message}`, context)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export type for external usage
export type { LogLevel, LogContext } 