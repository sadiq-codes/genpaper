// Performance monitoring and analytics for GenPaper

interface PerformanceMetric {
  name: string
  value: number
  timestamp: number
  metadata?: Record<string, any>
}

interface StreamingMetrics {
  chunkCount: number
  totalBytes: number
  duration: number
  averageChunkSize: number
  chunksPerSecond: number
}

interface EditorMetrics {
  wordCount: number
  charCount: number
  renderTime: number
  updateLatency: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = []
  private streamingSession: {
    startTime: number
    chunkCount: number
    totalBytes: number
  } | null = null

  // Track streaming performance
  startStreamingSession() {
    this.streamingSession = {
      startTime: performance.now(),
      chunkCount: 0,
      totalBytes: 0
    }
    
    this.recordMetric('streaming_session_started', 1)
  }

  recordStreamingChunk(chunkSize: number) {
    if (!this.streamingSession) return

    this.streamingSession.chunkCount++
    this.streamingSession.totalBytes += chunkSize

    // Record throughput metrics every 10 chunks
    if (this.streamingSession.chunkCount % 10 === 0) {
      const duration = performance.now() - this.streamingSession.startTime
      const throughput = this.streamingSession.totalBytes / (duration / 1000) // bytes/sec
      
      this.recordMetric('streaming_throughput', throughput, {
        chunkCount: this.streamingSession.chunkCount,
        totalBytes: this.streamingSession.totalBytes,
        duration
      })
    }
  }

  endStreamingSession(): StreamingMetrics {
    if (!this.streamingSession) {
      throw new Error('No active streaming session')
    }

    const duration = performance.now() - this.streamingSession.startTime
    const metrics: StreamingMetrics = {
      chunkCount: this.streamingSession.chunkCount,
      totalBytes: this.streamingSession.totalBytes,
      duration,
      averageChunkSize: this.streamingSession.totalBytes / this.streamingSession.chunkCount,
      chunksPerSecond: this.streamingSession.chunkCount / (duration / 1000)
    }

    this.recordMetric('streaming_session_completed', 1, metrics)
    this.streamingSession = null

    return metrics
  }

  // Track editor performance
  recordEditorUpdate(metrics: EditorMetrics) {
    this.recordMetric('editor_word_count', metrics.wordCount)
    this.recordMetric('editor_char_count', metrics.charCount)
    this.recordMetric('editor_render_time', metrics.renderTime)
    this.recordMetric('editor_update_latency', metrics.updateLatency)
  }

  // Track database performance
  recordDatabaseQuery(operation: string, duration: number, metadata?: Record<string, any>) {
    this.recordMetric(`db_${operation}_duration`, duration, metadata)
  }

  // Track real-time subscription performance
  recordRealtimeEvent(event: string, latency?: number) {
    this.recordMetric(`realtime_${event}`, latency || 1, {
      timestamp: Date.now()
    })
  }

  // Track citation processing performance
  recordCitationProcessing(count: number, duration: number) {
    this.recordMetric('citation_processing_count', count)
    this.recordMetric('citation_processing_duration', duration)
    this.recordMetric('citation_processing_rate', count / (duration / 1000))
  }

  // Core metric recording
  private recordMetric(name: string, value: number, metadata?: Record<string, any>) {
    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: performance.now(),
      metadata
    }

    this.metrics.push(metric)

    // Keep only last 1000 metrics to prevent memory leaks
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000)
    }

    // Log significant performance issues
    this.checkForPerformanceIssues(metric)
  }

  private checkForPerformanceIssues(metric: PerformanceMetric) {
    const thresholds = {
      'editor_update_latency': 100, // ms
      'streaming_throughput': 1000, // bytes/sec (minimum)
      'db_query_duration': 1000, // ms
      'editor_render_time': 50, // ms
    }

    const threshold = thresholds[metric.name as keyof typeof thresholds]
    
    if (threshold) {
      if (metric.name === 'streaming_throughput' && metric.value < threshold) {
        console.warn(`🐌 Low streaming throughput: ${metric.value} bytes/sec`)
      } else if (metric.name !== 'streaming_throughput' && metric.value > threshold) {
        console.warn(`⚠️ Performance issue detected: ${metric.name} took ${metric.value}ms`)
      }
    }
  }

  // Get performance summary
  getPerformanceSummary(timeWindow: number = 60000): Record<string, any> {
    const now = performance.now()
    const recentMetrics = this.metrics.filter(m => now - m.timestamp < timeWindow)

    const summary: Record<string, any> = {}

    // Group metrics by name and calculate statistics
    const groupedMetrics = recentMetrics.reduce((acc, metric) => {
      if (!acc[metric.name]) acc[metric.name] = []
      acc[metric.name].push(metric.value)
      return acc
    }, {} as Record<string, number[]>)

    Object.entries(groupedMetrics).forEach(([name, values]) => {
      summary[name] = {
        count: values.length,
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        last: values[values.length - 1]
      }
    })

    return summary
  }

  // Export metrics for analysis
  exportMetrics(format: 'json' | 'csv' = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2)
    } else {
      const headers = ['timestamp', 'name', 'value', 'metadata']
      const rows = this.metrics.map(m => [
        m.timestamp,
        m.name,
        m.value,
        JSON.stringify(m.metadata || {})
      ])
      
      return [headers, ...rows].map(row => row.join(',')).join('\n')
    }
  }

  // Clear metrics
  clearMetrics() {
    this.metrics = []
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor()

// Hook for React components
export function usePerformanceMonitor() {
  const recordEditorUpdate = (metrics: EditorMetrics) => {
    performanceMonitor.recordEditorUpdate(metrics)
  }

  const recordDatabaseQuery = (operation: string, duration: number, metadata?: Record<string, any>) => {
    performanceMonitor.recordDatabaseQuery(operation, duration, metadata)
  }

  const recordRealtimeEvent = (event: string, latency?: number) => {
    performanceMonitor.recordRealtimeEvent(event, latency)
  }

  const getPerformanceSummary = (timeWindow?: number) => {
    return performanceMonitor.getPerformanceSummary(timeWindow)
  }

  return {
    recordEditorUpdate,
    recordDatabaseQuery,
    recordRealtimeEvent,
    getPerformanceSummary
  }
}

// Web Vitals tracking
export function trackWebVitals() {
  if (typeof window === 'undefined') return

  // Track Core Web Vitals
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      const metricName = entry.entryType === 'measure' ? entry.name : entry.entryType
      performanceMonitor.recordMetric(`web_vital_${metricName}`, entry.duration || entry.startTime)
    })
  })

  // Observe different performance entry types
  try {
    observer.observe({ entryTypes: ['measure', 'paint', 'largest-contentful-paint'] })
  } catch (error) {
    console.warn('Performance observer not supported:', error)
  }

  // Track custom metrics
  const trackResourceTiming = () => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    
    resources.forEach(resource => {
      if (resource.initiatorType === 'fetch') {
        performanceMonitor.recordMetric('api_request_duration', resource.duration, {
          url: resource.name,
          responseStart: resource.responseStart,
          responseEnd: resource.responseEnd
        })
      }
    })
  }

  // Track every 30 seconds
  setInterval(trackResourceTiming, 30000)
}

// Type exports
export type { PerformanceMetric, StreamingMetrics, EditorMetrics } 