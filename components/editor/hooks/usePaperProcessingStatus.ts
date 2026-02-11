/**
 * Hook for tracking paper processing status
 * 
 * Polls the processing status API and provides:
 * - Individual paper statuses
 * - Summary counts (pending, processing, processed, failed)
 * - Whether all papers are processed
 * - Trigger to retry failed papers
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'

export type ProcessingStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface PaperProcessingState {
  statuses: Record<string, ProcessingStatus>
  summary: {
    total: number
    pending: number
    processing: number
    processed: number
    failed: number
    allProcessed: boolean
  }
  isPolling: boolean
  error: string | null
}

interface UsePaperProcessingStatusOptions {
  projectId: string | undefined
  /** Whether to enable polling (default: true) */
  enabled?: boolean
  /** Polling interval in ms (default: 3000) */
  pollInterval?: number
  /** Stop polling when all processed (default: true) */
  stopWhenComplete?: boolean
  /** Callback when all papers are processed */
  onAllProcessed?: () => void
  /** Callback when a paper fails */
  onPaperFailed?: (paperId: string) => void
}

export function usePaperProcessingStatus({
  projectId,
  enabled = true,
  pollInterval = 3000,
  stopWhenComplete = true,
  onAllProcessed,
  onPaperFailed,
}: UsePaperProcessingStatusOptions) {
  const [state, setState] = useState<PaperProcessingState>({
    statuses: {},
    summary: {
      total: 0,
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      allProcessed: false,
    },
    isPolling: false,
    error: null,
  })

  const previousStatusesRef = useRef<Record<string, ProcessingStatus>>({})
  const hasNotifiedCompleteRef = useRef(false)
  const isFirstFetchRef = useRef(true)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)
  
  // Store callbacks in refs to avoid dependency issues
  // This prevents infinite re-render loops when callbacks are inline functions
  const onAllProcessedRef = useRef(onAllProcessed)
  const onPaperFailedRef = useRef(onPaperFailed)
  
  // Keep refs updated
  useEffect(() => {
    onAllProcessedRef.current = onAllProcessed
    onPaperFailedRef.current = onPaperFailed
  }, [onAllProcessed, onPaperFailed])

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    if (!projectId) return

    try {
      const response = await fetch(`/api/papers/process?projectId=${projectId}`)
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`)
      }

      const data = await response.json()
      
      // Check for newly failed papers
      const previousStatuses = previousStatusesRef.current
      for (const [paperId, status] of Object.entries(data.statuses as Record<string, ProcessingStatus>)) {
        if (status === 'failed' && previousStatuses[paperId] !== 'failed') {
          onPaperFailedRef.current?.(paperId)
        }
      }
      previousStatusesRef.current = data.statuses

      setState(prev => ({
        ...prev,
        statuses: data.statuses,
        summary: data.summary,
        error: null,
      }))

      // Check if all processed
      // Skip notification on first fetch — papers were already done before we started polling
      if (data.summary.allProcessed && !hasNotifiedCompleteRef.current) {
        if (isFirstFetchRef.current) {
          // Already complete on load — suppress the toast
          hasNotifiedCompleteRef.current = true
        } else {
          hasNotifiedCompleteRef.current = true
          onAllProcessedRef.current?.()
        }
      }
      isFirstFetchRef.current = false

      return data.summary.allProcessed
    } catch (error) {
      console.error('[usePaperProcessingStatus] Error:', error)
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
      return false
    }
  }, [projectId]) // Removed callback dependencies - using refs instead

  // Start/stop polling
  useEffect(() => {
    if (!enabled || !projectId) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setState(prev => ({ ...prev, isPolling: false }))
      return
    }

    // Initial fetch
    setState(prev => ({ ...prev, isPolling: true }))
    fetchStatus()

    // Start polling
    pollingRef.current = setInterval(async () => {
      const allComplete = await fetchStatus()
      
      if (allComplete && stopWhenComplete) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        setState(prev => ({ ...prev, isPolling: false }))
      }
    }, pollInterval)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [enabled, projectId, pollInterval, stopWhenComplete, fetchStatus])

  // Retry failed papers
  const retryFailed = useCallback(async () => {
    if (!projectId) return

    const failedPaperIds = Object.entries(state.statuses)
      .filter(([, status]) => status === 'failed')
      .map(([id]) => id)

    if (failedPaperIds.length === 0) return

    try {
      const response = await fetch('/api/papers/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paperIds: failedPaperIds,
          waitForCompletion: false,
        }),
      })

      if (!response.ok) {
        throw new Error('Retry request failed')
      }

      toast.info('Retrying failed papers...')
      
      // Reset the complete notification flag so we can notify again
      hasNotifiedCompleteRef.current = false
      
      // Fetch status again after a short delay
      setTimeout(fetchStatus, 1000)
    } catch (error) {
      console.error('[usePaperProcessingStatus] Retry error:', error)
      toast.error('Failed to retry paper processing')
    }
  }, [projectId, state.statuses, fetchStatus])

  // Retry a specific paper
  const retryPaper = useCallback(async (paperId: string) => {
    try {
      const response = await fetch('/api/papers/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paperIds: [paperId],
          waitForCompletion: false,
        }),
      })

      if (!response.ok) {
        throw new Error('Retry request failed')
      }

      toast.info('Retrying paper processing...')
      
      // Update local state to show processing
      setState(prev => ({
        ...prev,
        statuses: {
          ...prev.statuses,
          [paperId]: 'processing',
        },
        summary: {
          ...prev.summary,
          failed: Math.max(0, prev.summary.failed - 1),
          processing: prev.summary.processing + 1,
        },
      }))

      // Fetch status again after a short delay
      setTimeout(fetchStatus, 2000)
    } catch (error) {
      console.error('[usePaperProcessingStatus] Retry paper error:', error)
      toast.error('Failed to retry paper processing')
    }
  }, [fetchStatus])

  // Get status for a specific paper
  const getStatus = useCallback((paperId: string): ProcessingStatus => {
    return state.statuses[paperId] || 'pending'
  }, [state.statuses])

  return {
    ...state,
    getStatus,
    retryFailed,
    retryPaper,
    refetch: fetchStatus,
  }
}
