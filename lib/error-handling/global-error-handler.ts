interface ErrorReport {
  message: string
  stack?: string
  url: string
  userAgent: string
  timestamp: string
  userId?: string
  projectId?: string
  context?: Record<string, unknown>
}

class GlobalErrorHandler {
  private static instance: GlobalErrorHandler
  private errorQueue: ErrorReport[] = []
  private isOnline = true
  private isInitialized = false

  private constructor() {
    // Only initialize if we're in the browser
    if (typeof window !== 'undefined') {
      this.setupGlobalHandlers()
      this.setupNetworkListener()
      this.isInitialized = true
    }
  }

  static getInstance(): GlobalErrorHandler {
    if (!GlobalErrorHandler.instance) {
      GlobalErrorHandler.instance = new GlobalErrorHandler()
    }
    return GlobalErrorHandler.instance
  }

  private setupGlobalHandlers() {
    // Only set up handlers if we're in the browser
    if (typeof window === 'undefined') return

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureError(new Error(event.reason), {
        type: 'unhandledrejection',
        promise: event.promise
      })
    })

    // Handle global JavaScript errors
    window.addEventListener('error', (event) => {
      this.captureError(event.error || new Error(event.message), {
        type: 'javascript',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      })
    })

    // Handle React error boundary errors (if needed)
    window.addEventListener('react-error', (event: Event) => {
      const customEvent = event as CustomEvent<{
        error: Error
        errorInfo?: { componentStack?: string }
      }>
      this.captureError(customEvent.detail.error, {
        type: 'react',
        componentStack: customEvent.detail.errorInfo?.componentStack
      })
    })
  }

  private setupNetworkListener() {
    // Only set up listeners if we're in the browser
    if (typeof window === 'undefined') return

    window.addEventListener('online', () => {
      this.isOnline = true
      this.flushErrorQueue()
    })

    window.addEventListener('offline', () => {
      this.isOnline = false
    })
  }

  captureError(error: Error, context?: Record<string, unknown>) {
    // If we're not in the browser, just log and return
    if (typeof window === 'undefined') {
      if (process.env.NODE_ENV === 'development') {
        console.error('Server-side error:', error.message, context)
      }
      return
    }

    const errorReport: ErrorReport = {
      message: error.message,
      stack: error.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      context
    }

    // Add to queue for offline handling
    this.errorQueue.push(errorReport)

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Global Error Handler')
      console.error('Error:', error)
      console.error('Context:', context)
      console.error('Report:', errorReport)
      console.groupEnd()
    }

    // Send immediately if online, otherwise queue
    if (this.isOnline) {
      this.sendErrorReport(errorReport)
    }
  }

  private async sendErrorReport(report: ErrorReport) {
    try {
      // In production, send to error tracking service
      if (process.env.NODE_ENV === 'production') {
        // Example: Send to your error tracking service
        await fetch('/api/errors', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(report)
        })
      }
    } catch (sendError) {
      console.error('Failed to send error report:', sendError)
      // Keep in queue for retry
    }
  }

  private async flushErrorQueue() {
    const errors = [...this.errorQueue]
    this.errorQueue = []

    for (const error of errors) {
      await this.sendErrorReport(error)
    }
  }

  // Method to manually capture errors with additional context
  captureException(error: Error, context?: {
    userId?: string
    projectId?: string
    action?: string
    extra?: Record<string, unknown>
  }) {
    this.captureError(error, context)
  }

  // Method to capture custom messages
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>) {
    if (level === 'error') {
      this.captureError(new Error(message), { ...context, level })
    } else {
      // For non-error messages, just log in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[${level.toUpperCase()}] ${message}`, context)
      }
    }
  }

  // Method to initialize handlers after client-side hydration
  initializeIfNeeded() {
    if (typeof window !== 'undefined' && !this.isInitialized) {
      this.setupGlobalHandlers()
      this.setupNetworkListener()
      this.isInitialized = true
    }
  }
}

// Create but don't immediately initialize the instance
let globalErrorHandlerInstance: GlobalErrorHandler | null = null

export const globalErrorHandler = {
  getInstance: () => {
    if (!globalErrorHandlerInstance) {
      globalErrorHandlerInstance = GlobalErrorHandler.getInstance()
    }
    return globalErrorHandlerInstance
  },
  captureError: (error: Error, context?: Record<string, unknown>) => {
    const instance = globalErrorHandlerInstance || GlobalErrorHandler.getInstance()
    instance.captureError(error, context)
  },
  captureException: (error: Error, context?: {
    userId?: string
    projectId?: string
    action?: string
    extra?: Record<string, unknown>
  }) => {
    const instance = globalErrorHandlerInstance || GlobalErrorHandler.getInstance()
    instance.captureException(error, context)
  },
  captureMessage: (message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>) => {
    const instance = globalErrorHandlerInstance || GlobalErrorHandler.getInstance()
    instance.captureMessage(message, level, context)
  }
}

// Export types for use in other files
export type { ErrorReport } 