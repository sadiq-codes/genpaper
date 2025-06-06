'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  AlertTriangle, 
  Home, 
  Bug,
  ChevronDown,
  ChevronUp 
} from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetOnPropsChange?: boolean
  resetKeys?: Array<string | number>
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  errorId: string
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      errorId: '',
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Generate a unique error ID for tracking
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    return {
      hasError: true,
      error,
      errorId,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    this.setState({
      errorInfo,
    })

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo)

    // In a real app, you'd send this to an error reporting service
    this.logErrorToService(error, errorInfo)
  }

  componentDidUpdate(prevProps: Props) {
    const { resetOnPropsChange, resetKeys } = this.props
    const { hasError } = this.state

    // Auto-reset if props changed and resetOnPropsChange is true
    if (hasError && resetOnPropsChange && prevProps.children !== this.props.children) {
      this.resetErrorBoundary()
    }

    // Reset if any of the resetKeys changed
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (resetKey, idx) => prevProps.resetKeys![idx] !== resetKey
      )
      if (hasResetKeyChanged) {
        this.resetErrorBoundary()
      }
    }
  }

  resetErrorBoundary = () => {
    // Clear any pending reset timeout
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      errorId: '',
    })
  }

  handleRetry = () => {
    this.resetErrorBoundary()
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }))
  }

  private logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // In production, send to error tracking service like Sentry, LogRocket, etc.
    const errorData = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorId: this.state.errorId,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    }

    // For now, just log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Error Boundary Report')
      console.error('Error ID:', errorData.errorId)
      console.error('Error:', error)
      console.error('Component Stack:', errorInfo.componentStack)
      console.error('Full Report:', errorData)
      console.groupEnd()
    }
  }

  render() {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      const { error, errorInfo, showDetails, errorId } = this.state

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl text-gray-900">
                Oops! Something went wrong
              </CardTitle>
              <p className="text-gray-600 mt-2">
                We encountered an unexpected error. Don&apos;t worry, we&apos;ve been notified and are working on a fix.
              </p>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <Alert>
                <Bug className="h-4 w-4" />
                <AlertDescription>
                  Error ID: <code className="font-mono text-sm">{errorId}</code>
                  <br />
                  Please include this ID when reporting the issue.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={this.handleRetry} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                <Button variant="outline" onClick={this.handleReload} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
                <Button variant="outline" onClick={this.handleGoHome} className="flex-1">
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Button>
              </div>

              {/* Error Details (for developers) */}
              {process.env.NODE_ENV === 'development' && (
                <div className="border-t pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={this.toggleDetails}
                    className="mb-3"
                  >
                    {showDetails ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Hide Details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Show Details (Dev)
                      </>
                    )}
                  </Button>

                  {showDetails && (
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">Error Message:</h4>
                        <pre className="text-xs bg-red-50 p-3 rounded border overflow-x-auto text-red-800">
                          {error?.message}
                        </pre>
                      </div>
                      
                      {error?.stack && (
                        <div>
                          <h4 className="font-semibold text-sm text-gray-900 mb-2">Stack Trace:</h4>
                          <pre className="text-xs bg-gray-100 p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto">
                            {error.stack}
                          </pre>
                        </div>
                      )}
                      
                      {errorInfo?.componentStack && (
                        <div>
                          <h4 className="font-semibold text-sm text-gray-900 mb-2">Component Stack:</h4>
                          <pre className="text-xs bg-blue-50 p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto">
                            {errorInfo.componentStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
} 