'use client'

import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  Database, 
  Wifi,
  WifiOff
} from 'lucide-react'

interface QueryErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  queryKeys?: string[][]
}

export function QueryErrorBoundary({ 
  children, 
  fallback,
  queryKeys = [] 
}: QueryErrorBoundaryProps) {
  const queryClient = useQueryClient()

  const handleQueryRetry = () => {
    // Retry all failed queries
    queryClient.refetchQueries({
      type: 'all',
      stale: true
    })
  }

  const handleInvalidateQueries = () => {
    // Invalidate specific query keys if provided, otherwise invalidate all
    if (queryKeys.length > 0) {
      queryKeys.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey })
      })
    } else {
      queryClient.invalidateQueries()
    }
  }

  const handleClearCache = () => {
    queryClient.clear()
    window.location.reload()
  }

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  const queryErrorFallback = (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-yellow-600" />
          </div>
          <CardTitle className="text-xl text-gray-900">
            Data Loading Error
          </CardTitle>
          <p className="text-gray-600 text-sm mt-2">
            We&apos;re having trouble loading your data. This might be a temporary network issue.
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {!isOnline && (
            <Alert>
              <WifiOff className="h-4 w-4" />
              <AlertDescription>
                You appear to be offline. Please check your internet connection.
              </AlertDescription>
            </Alert>
          )}

          {isOnline && (
            <Alert>
              <Wifi className="h-4 w-4" />
              <AlertDescription>
                Connection detected. The issue might be temporary.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={handleQueryRetry} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry Loading
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleInvalidateQueries}
              className="w-full"
            >
              <Database className="w-4 h-4 mr-2" />
              Refresh Data
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleClearCache}
              size="sm"
              className="w-full text-xs"
            >
              Clear Cache & Reload
            </Button>
          </div>

          <p className="text-xs text-gray-500 text-center">
            If the problem persists, please contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <ErrorBoundary
      fallback={fallback || queryErrorFallback}
      onError={(error, errorInfo) => {
        console.error('Query Error Boundary:', error, errorInfo)
        
        // Log query-specific error details
        console.group('🔍 Query Error Details')
        console.error('Network State:', navigator.onLine ? 'Online' : 'Offline')
        console.error('Query Cache Size:', queryClient.getQueryCache().getAll().length)
        console.error('Failed Queries:', queryClient.getQueryCache().getAll().filter(q => q.state.status === 'error'))
        console.groupEnd()
      }}
      resetKeys={queryKeys.flat()}
      resetOnPropsChange={true}
    >
      {children}
    </ErrorBoundary>
  )
}

// Hook to use QueryErrorBoundary with specific query keys
export function useQueryErrorBoundary(queryKeys: string[][]) {
  return { queryKeys }
} 