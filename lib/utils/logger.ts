/**
 * Development-only logging utilities
 * Prevents verbose logging in production while maintaining debug capabilities
 */

const isDevelopment = process.env.NODE_ENV === 'development'
const isDebugEnabled = process.env.DEBUG_LOGGING === 'true' || isDevelopment

export const debug = {
  log: (...args: unknown[]) => {
    if (isDebugEnabled) {
      console.log(...args)
    }
  },
  
  warn: (...args: unknown[]) => {
    if (isDebugEnabled) {
      console.warn(...args)
    }
  },
  
  error: (...args: unknown[]) => {
    // Always log errors regardless of environment
    console.error(...args)
  },
  
  info: (...args: unknown[]) => {
    if (isDebugEnabled) {
      console.info(...args)
    }
  },
  
  // Production-safe performance logging
  perf: (label: string, fn: () => void | Promise<void>) => {
    if (isDebugEnabled) {
      const start = Date.now()
      const result = fn()
      
      if (result instanceof Promise) {
        return result.finally(() => {
          console.log(`⏱️ ${label}: ${Date.now() - start}ms`)
        })
      } else {
        console.log(`⏱️ ${label}: ${Date.now() - start}ms`)
        return result
      }
    } else {
      return fn()
    }
  },
  
  // Count items for performance monitoring
  count: (label: string, count: number) => {
    if (isDebugEnabled) {
      console.log(`📊 ${label}: ${count}`)
    }
  }
}

export default debug 