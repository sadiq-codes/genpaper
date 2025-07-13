/**
 * Development-only logging utilities
 * Prevents verbose logging in production while maintaining debug capabilities
 */

import pino from 'pino'

// 🆕 OPTIMIZATION: Structured logging for generation pipeline observability
interface GenerationMetrics {
  stage: string
  duration_ms: number
  tokens_consumed?: number
  citation_count?: number
  cache_hit?: boolean
  search_providers?: string[]
  search_duration_ms?: number
  error_count?: number
  retry_count?: number
  library_coverage_score?: number
  context_cache_key?: string
  snapshot_count?: number
}

interface SearchMetrics {
  query: string
  duration_ms: number
  providers: string[]
  results_count: number
  cache_hit: boolean
  errors: string[]
  retry_count: number
}

interface CitationMetrics {
  paper_id: string
  tool_duration_ms: number
  success: boolean
  error?: string
  citation_number?: number
}

interface PDFMetrics {
  paper_id: string
  queue_wait_ms: number
  extraction_duration_ms: number
  success: boolean
  error?: string
  file_size_mb?: number
}

// Create structured logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label }
    }
  },
  timestamp: pino.stdTimeFunctions.isoTime
})

// Export for general use
export const debug = logger.debug.bind(logger)
export const info = logger.info.bind(logger)
export const warn = logger.warn.bind(logger)
export const error = logger.error.bind(logger)

// 🆕 Structured logging functions for observability
export const logGenerationMetrics = (metrics: GenerationMetrics) => {
  logger.info({
    type: 'generation_metrics',
    ...metrics
  }, `Generation ${metrics.stage} completed in ${metrics.duration_ms}ms`)
}

export const logSearchMetrics = (metrics: SearchMetrics) => {
  logger.info({
    type: 'search_metrics',
    ...metrics
  }, `Search "${metrics.query}" completed with ${metrics.results_count} results`)
}

export const logCitationMetrics = (metrics: CitationMetrics) => {
  const level = metrics.success ? 'info' : 'warn'
  logger[level]({
    type: 'citation_metrics',
    ...metrics
  }, `Citation tool ${metrics.success ? 'succeeded' : 'failed'} for paper ${metrics.paper_id}`)
}

export const logPDFMetrics = (metrics: PDFMetrics) => {
  const level = metrics.success ? 'info' : 'warn'
  logger[level]({
    type: 'pdf_metrics',
    ...metrics
  }, `PDF processing ${metrics.success ? 'succeeded' : 'failed'} for paper ${metrics.paper_id}`)
}

// 🆕 Performance monitoring helpers
export const createTimer = () => {
  const start = Date.now()
  return {
    end: () => Date.now() - start,
    log: (message: string, data?: Record<string, unknown>) => {
      const duration = Date.now() - start
      logger.info({ duration_ms: duration, ...data }, message)
      return duration
    }
  }
}

// 🆕 Error tracking with context
export const logError = (error: Error, context: Record<string, unknown> = {}) => {
  logger.error({
    type: 'error',
    error_name: error.name,
    error_message: error.message,
    error_stack: error.stack,
    ...context
  }, `Error: ${error.message}`)
}

// 🆕 User journey tracking for UX optimization
export const logUserAction = (action: string, userId: string, metadata: Record<string, unknown> = {}) => {
  logger.info({
    type: 'user_action',
    action,
    user_id: userId,
    ...metadata
  }, `User action: ${action}`)
}

// Export types for use in other modules
export type { GenerationMetrics, SearchMetrics, CitationMetrics, PDFMetrics }

export default logger 