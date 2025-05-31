'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  FileText, 
  BookOpen, 
  Edit3,
  AlertCircle,
  Zap
} from 'lucide-react'

interface ComponentErrorFallbackProps {
  error?: Error
  onRetry?: () => void
  title?: string
  description?: string
}

// Generic component error fallback
export function ComponentErrorFallback({
  error,
  onRetry,
  title = "Component Error",
  description = "This component encountered an error."
}: ComponentErrorFallbackProps) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-red-900">{title}</h3>
            <p className="text-sm text-red-700 mt-1">{description}</p>
            {error && process.env.NODE_ENV === 'development' && (
              <pre className="text-xs text-red-600 mt-2 bg-red-100 p-2 rounded overflow-x-auto">
                {error.message}
              </pre>
            )}
          </div>
          {onRetry && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onRetry}
              className="border-red-200 text-red-700 hover:bg-red-100"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Editor-specific error fallback
export function EditorErrorFallback({
  error,
  onRetry,
  onSafeMode
}: ComponentErrorFallbackProps & { onSafeMode?: () => void }) {
  return (
    <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
      <Card className="w-full max-w-md border-orange-200 bg-orange-50">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
            <Edit3 className="w-6 h-6 text-orange-600" />
          </div>
          <CardTitle className="text-lg text-orange-900">Editor Error</CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <p className="text-sm text-orange-800 text-center">
            The text editor encountered an error. Your content should be automatically saved.
          </p>
          
          {error && process.env.NODE_ENV === 'development' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Dev Error:</strong> {error.message}
              </AlertDescription>
            </Alert>
          )}
          
          <div className="flex flex-col gap-2">
            {onRetry && (
              <Button onClick={onRetry} size="sm" className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Editor
              </Button>
            )}
            
            {onSafeMode && (
              <Button 
                variant="outline" 
                onClick={onSafeMode} 
                size="sm" 
                className="w-full"
              >
                <Zap className="w-4 h-4 mr-2" />
                Safe Mode (Plain Text)
              </Button>
            )}
          </div>
          
          <p className="text-xs text-orange-600 text-center">
            Try refreshing the page if the problem persists.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// Outline panel error fallback
export function OutlinePanelErrorFallback({
  error,
  onRetry
}: ComponentErrorFallbackProps) {
  return (
    <div className="p-4">
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="text-center">
            <FileText className="w-8 h-8 text-blue-600 mx-auto mb-3" />
            <h3 className="font-medium text-blue-900 mb-2">Outline Panel Error</h3>
            <p className="text-sm text-blue-700 mb-3">
              Unable to load document outline.
            </p>
            
            {error && process.env.NODE_ENV === 'development' && (
              <div className="text-xs text-blue-600 mb-3 bg-blue-100 p-2 rounded">
                {error.message}
              </div>
            )}
            
            {onRetry && (
              <Button 
                size="sm" 
                onClick={onRetry}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Outline
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Citation panel error fallback
export function CitationPanelErrorFallback({
  error,
  onRetry
}: ComponentErrorFallbackProps) {
  return (
    <div className="p-4">
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4">
          <div className="text-center">
            <BookOpen className="w-8 h-8 text-green-600 mx-auto mb-3" />
            <h3 className="font-medium text-green-900 mb-2">Citations Error</h3>
            <p className="text-sm text-green-700 mb-3">
              Unable to load citations and references.
            </p>
            
            {error && process.env.NODE_ENV === 'development' && (
              <div className="text-xs text-green-600 mb-3 bg-green-100 p-2 rounded">
                {error.message}
              </div>
            )}
            
            {onRetry && (
              <Button 
                size="sm" 
                onClick={onRetry}
                className="bg-green-600 hover:bg-green-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Citations
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Loading state error fallback (for when loading states fail)
export function LoadingErrorFallback({
  error,
  onRetry,
  message = "Failed to load content"
}: ComponentErrorFallbackProps & { message?: string }) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-gray-500" />
        </div>
        <h3 className="font-medium text-gray-900 mb-2">{message}</h3>
        
        {error && (
          <p className="text-sm text-gray-600 mb-4">
            {error.message || "An unexpected error occurred"}
          </p>
        )}
        
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
      </div>
    </div>
  )
} 