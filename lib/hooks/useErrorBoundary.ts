'use client'

import { useState, useCallback } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorId: string
}

export function useErrorBoundary() {
  const [errorState, setErrorState] = useState<ErrorBoundaryState>({
    hasError: false,
    error: null,
    errorId: ''
  })

  const captureError = useCallback((error: Error, context?: string) => {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    console.error('Error captured:', error, context)
    
    setErrorState({
      hasError: true,
      error,
      errorId
    })

    // In production, send to error tracking service
    if (process.env.NODE_ENV === 'production') {
      // Send to error tracking service like Sentry
      console.log('Would send to error tracking service:', {
        error: error.message,
        stack: error.stack,
        context,
        errorId,
        url: window.location.href,
        timestamp: new Date().toISOString()
      })
    }
  }, [])

  const resetError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null,
      errorId: ''
    })
  }, [])

  const retryWithErrorHandling = useCallback(async (fn: () => Promise<void> | void) => {
    try {
      resetError()
      await fn()
    } catch (error) {
      captureError(error as Error, 'Retry operation failed')
    }
  }, [captureError, resetError])

  return {
    ...errorState,
    captureError,
    resetError,
    retryWithErrorHandling
  }
} 