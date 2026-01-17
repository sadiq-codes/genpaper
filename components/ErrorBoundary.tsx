'use client'

import { Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  /** Title shown in the error UI */
  title?: string
  /** Description shown in the error UI */
  description?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error Boundary component for catching and handling React errors gracefully.
 * 
 * Usage:
 * ```tsx
 * <ErrorBoundary title="Editor Error" description="The editor encountered an issue.">
 *   <ResearchEditor {...props} />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Render custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {this.props.title || 'Something went wrong'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.props.description || 
              'An unexpected error occurred. Please try again or refresh the page.'}
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="mb-4 max-w-md text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Error details
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                {this.state.error.message}
                {this.state.error.stack && `\n\n${this.state.error.stack}`}
              </pre>
            </details>
          )}
          <Button onClick={this.handleRetry} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Specialized error boundary for editor components
 */
export function EditorErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      title="Editor Error"
      description="The editor encountered an issue. Your work has been auto-saved. Please try again."
    >
      {children}
    </ErrorBoundary>
  )
}

/**
 * Specialized error boundary for chat/AI components
 */
export function ChatErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      title="Chat Error"
      description="The AI assistant encountered an issue. Please try again."
    >
      {children}
    </ErrorBoundary>
  )
}

/**
 * Specialized error boundary for analysis components
 */
export function AnalysisErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      title="Analysis Error"
      description="The analysis module encountered an issue. Please refresh and try again."
    >
      {children}
    </ErrorBoundary>
  )
}
