/**
 * Citation Logging & Metrics
 * 
 * Structured logging for citation operations with performance metrics
 * and error tracking for observability.
 */

interface CitationLogContext {
  projectId?: string
  citeKey?: string
  userId?: string
  operation: string
  requestId?: string
}

interface PerformanceMetrics {
  duration: number // milliseconds
  startTime: number
  endTime: number
}

interface CitationEvent extends CitationLogContext {
  level: 'info' | 'warn' | 'error'
  message: string
  metrics?: PerformanceMetrics
  error?: {
    message: string
    code?: string
    stack?: string
  }
  metadata?: Record<string, unknown>
}

class CitationLogger {
  private static instance: CitationLogger
  private requestIdCounter = 0

  static getInstance(): CitationLogger {
    if (!this.instance) {
      this.instance = new CitationLogger()
    }
    return this.instance
  }

  /**
   * Generate unique request ID for tracing
   */
  generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`
  }

  /**
   * Create performance timer
   */
  startTimer(): { end: () => PerformanceMetrics } {
    const startTime = Date.now()
    
    return {
      end: (): PerformanceMetrics => {
        const endTime = Date.now()
        return {
          duration: endTime - startTime,
          startTime,
          endTime
        }
      }
    }
  }

  /**
   * Log citation events with structured format
   */
  private log(event: CitationEvent): void {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level: event.level,
      operation: event.operation,
      message: event.message,
      ...(event.projectId && { projectId: event.projectId }),
      ...(event.citeKey && { citeKey: event.citeKey }),
      ...(event.userId && { userId: event.userId }),
      ...(event.requestId && { requestId: event.requestId }),
      ...(event.metrics && { 
        duration_ms: event.metrics.duration,
        performance: event.metrics 
      }),
      ...(event.error && { error: event.error }),
      ...(event.metadata && { metadata: event.metadata })
    }

    // Use appropriate console method based on level
    switch (event.level) {
      case 'error':
        console.error('CITATION_ERROR', JSON.stringify(logEntry))
        break
      case 'warn':
        console.warn('CITATION_WARN', JSON.stringify(logEntry))
        break
      default:
        console.log('CITATION_INFO', JSON.stringify(logEntry))
        break
    }
  }

  /**
   * Log successful citation addition
   */
  logCitationAdded(context: CitationLogContext & {
    metrics: PerformanceMetrics
    isNew: boolean
    citeKey: string
  }): void {
    this.log({
      ...context,
      level: 'info',
      message: `Citation ${context.isNew ? 'created' : 'retrieved'}`,
      metadata: { isNew: context.isNew }
    })
  }

  /**
   * Log citation resolution performance
   */
  logResolverPerformance(context: CitationLogContext & {
    metrics: PerformanceMetrics
    sourceRef: Record<string, unknown>
    resolved: boolean
    resolvedPaperId?: string
  }): void {
    this.log({
      ...context,
      level: 'info',
      message: `Source resolution ${context.resolved ? 'succeeded' : 'failed'}`,
      metadata: { 
        sourceRef: context.sourceRef,
        resolved: context.resolved,
        resolvedPaperId: context.resolvedPaperId
      }
    })
  }

  /**
   * Log batch operation metrics
   */
  logBatchAdd(context: CitationLogContext & {
    metrics: PerformanceMetrics
    batchSize: number
    successCount: number
    failureCount: number
  }): void {
    this.log({
      ...context,
      level: 'info',
      message: `Batch citation processing completed`,
      metadata: {
        batchSize: context.batchSize,
        successCount: context.successCount,
        failureCount: context.failureCount,
        successRate: context.successCount / context.batchSize
      }
    })
  }

  /**
   * Log citation rendering performance
   */
  logRenderPerformance(context: CitationLogContext & {
    metrics: PerformanceMetrics
    style: string
    citationCount: number
    renderType: 'inline' | 'bibliography'
  }): void {
    this.log({
      ...context,
      level: 'info',
      message: `Citation rendering completed`,
      metadata: {
        style: context.style,
        citationCount: context.citationCount,
        renderType: context.renderType
      }
    })
  }

  /**
   * Log citation rendering failures
   */
  logRenderFailed(context: CitationLogContext & {
    error: Error
    style: string
    citationCount: number
    renderType: 'inline' | 'bibliography'
  }): void {
    this.log({
      ...context,
      level: 'error',
      message: 'Citation rendering failed',
      error: {
        message: context.error.message,
        stack: context.error.stack
      },
      metadata: {
        style: context.style,
        citationCount: context.citationCount,
        renderType: context.renderType
      }
    })
  }

  /**
   * Log API response errors (non-2xx)
   */
  logApiError(context: CitationLogContext & {
    endpoint: string
    statusCode: number
    error: Error | string
    requestBody?: Record<string, unknown>
  }): void {
    this.log({
      ...context,
      level: 'error',
      message: `API error: ${context.endpoint}`,
      error: {
        message: typeof context.error === 'string' ? context.error : context.error.message,
        code: `HTTP_${context.statusCode}`,
        stack: typeof context.error === 'object' ? context.error.stack : undefined
      },
      metadata: {
        endpoint: context.endpoint,
        statusCode: context.statusCode,
        requestBody: context.requestBody
      }
    })
  }

  /**
   * Log validation errors
   */
  logValidationError(context: CitationLogContext & {
    error: Error | string
    input: Record<string, unknown>
  }): void {
    this.log({
      ...context,
      level: 'warn',
      message: 'Validation failed',
      error: {
        message: typeof context.error === 'string' ? context.error : context.error.message,
        code: 'VALIDATION_ERROR'
      },
      metadata: {
        input: context.input
      }
    })
  }

  /**
   * Log rate limiting events
   */
  logRateLimit(context: CitationLogContext & {
    limit: number
    windowMs: number
    retryAfter?: number
  }): void {
    this.log({
      ...context,
      level: 'warn',
      message: 'Rate limit exceeded',
      metadata: {
        limit: context.limit,
        windowMs: context.windowMs,
        retryAfter: context.retryAfter
      }
    })
  }
}

// Export singleton instance
export const citationLogger = CitationLogger.getInstance()

// Export types for use in other modules
export type { CitationLogContext, PerformanceMetrics, CitationEvent }