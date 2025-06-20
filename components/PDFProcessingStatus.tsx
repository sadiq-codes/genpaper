'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, AlertCircle, Clock, XCircle, Loader2 } from 'lucide-react'

interface ProcessingStatus {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'poisoned'
  progress: number
  message: string
  extractionMethod?: string
  confidence?: string
  timeElapsed?: number
}

interface PDFProcessingStatusProps {
  jobId: string
  paperTitle: string
  onComplete?: (success: boolean) => void
}

export function PDFProcessingStatus({ 
  jobId, 
  paperTitle, 
  onComplete 
}: PDFProcessingStatusProps) {
  const [status, setStatus] = useState<ProcessingStatus>({
    jobId,
    status: 'pending',
    progress: 0,
    message: 'Initializing PDF processing...'
  })

  useEffect(() => {
    const supabase = createClient()
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('pdf-processing')
      .on('broadcast', { event: 'status-update' }, (payload: { payload: ProcessingStatus }) => {
        const update = payload.payload
        if (update.jobId === jobId) {
          setStatus(update)
          
          // Notify parent component when completed
          if (update.status === 'completed' && onComplete) {
            onComplete(true)
          } else if ((update.status === 'failed' || update.status === 'poisoned') && onComplete) {
            onComplete(false)
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId, onComplete])

  const getStatusIcon = () => {
    switch (status.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'poisoned':
        return <AlertCircle className="h-4 w-4 text-orange-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = () => {
    switch (status.status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'poisoned':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatTimeElapsed = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const getExtractionMethodBadge = () => {
    if (!status.extractionMethod) return null
    
    const methodLabels = {
      'doi-lookup': 'DOI Lookup',
      'grobid': 'GROBID',
      'text-layer': 'Text Layer',
      'ocr': 'OCR',
      'fallback': 'Fallback'
    }

    const methodColors = {
      'doi-lookup': 'bg-purple-100 text-purple-800',
      'grobid': 'bg-blue-100 text-blue-800',
      'text-layer': 'bg-green-100 text-green-800',
      'ocr': 'bg-orange-100 text-orange-800',
      'fallback': 'bg-gray-100 text-gray-800'
    }

    return (
      <Badge className={methodColors[status.extractionMethod as keyof typeof methodColors]}>
        {methodLabels[status.extractionMethod as keyof typeof methodLabels]}
      </Badge>
    )
  }

  const getConfidenceBadge = () => {
    if (!status.confidence) return null
    
    const confidenceColors = {
      'high': 'bg-green-100 text-green-800',
      'medium': 'bg-yellow-100 text-yellow-800',
      'low': 'bg-red-100 text-red-800'
    }

    return (
      <Badge className={confidenceColors[status.confidence as keyof typeof confidenceColors]}>
        {status.confidence} confidence
      </Badge>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {getStatusIcon()}
          Processing PDF
        </CardTitle>
        <p className="text-xs text-gray-600 truncate" title={paperTitle}>
          {paperTitle}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <Badge className={getStatusColor()}>
            {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
          </Badge>
          {status.timeElapsed && (
            <span className="text-xs text-gray-500">
              {formatTimeElapsed(status.timeElapsed)}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {status.status === 'processing' && (
          <div className="space-y-2">
            <Progress value={status.progress} className="h-2" />
            <p className="text-xs text-gray-600">{status.progress}% complete</p>
          </div>
        )}

        {/* Status Message */}
        <p className="text-sm text-gray-700">{status.message}</p>

        {/* Extraction Details */}
        {(status.extractionMethod || status.confidence) && (
          <div className="flex gap-2 flex-wrap">
            {getExtractionMethodBadge()}
            {getConfidenceBadge()}
          </div>
        )}

        {/* Additional Info for Completed Status */}
        {status.status === 'completed' && (
          <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
            ✅ PDF successfully processed and ready for paper generation
          </div>
        )}

        {/* Error Info */}
        {status.status === 'failed' && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            ❌ Processing failed. The paper is still available in your library with basic metadata.
          </div>
        )}

        {/* Poison Pill Info */}
        {status.status === 'poisoned' && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ This PDF has failed processing multiple times and has been marked as problematic.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default PDFProcessingStatus 