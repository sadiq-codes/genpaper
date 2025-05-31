import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UsePaperStreamReturn {
  content: string
  isLoading: boolean
  error: string | null
  chunkCount: number
  lastUpdated: Date | null
  startGeneration: (projectId: string, topicTitle: string, outline?: string) => Promise<void>
  stopGeneration: () => void
}

export function usePaperStream(projectId: string): UsePaperStreamReturn {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const supabase = createClient()

  // Load existing content when component mounts
  useEffect(() => {
    loadExistingContent()
  }, [projectId])

  // Set up real-time subscription for chunk updates
  useEffect(() => {
    const channel = supabase
      .channel(`paper_chunks:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'paper_chunks',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          // When a new chunk is inserted, reload the full content
          // This ensures proper ordering via the paper_full view
          loadExistingContent()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [projectId])

  const loadExistingContent = async () => {
    try {
      const { data, error } = await supabase
        .from('paper_full')
        .select('content, chunk_count, last_updated')
        .eq('project_id', projectId)
        .single()

      if (error && error.code !== 'PGRST116') { // Not found is ok
        console.error('Error loading paper content:', error)
        return
      }

      if (data) {
        setContent(data.content || '')
        setChunkCount(data.chunk_count || 0)
        setLastUpdated(data.last_updated ? new Date(data.last_updated) : null)
      }
    } catch (err) {
      console.error('Error in loadExistingContent:', err)
    }
  }

  const startGeneration = async (projectId: string, topicTitle: string, outline?: string) => {
    setIsLoading(true)
    setError(null)
    
    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController()

    try {
      const response = await fetch('/api/research/generate/paper-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          topicTitle,
          outline
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      // The content will be updated via real-time subscription
      // We just need to handle the streaming response to ensure it completes
      if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            
            if (done) break
            
            // Decode chunk (for progress monitoring if needed)
            const chunk = decoder.decode(value, { stream: true })
            // Real content updates come through Supabase realtime
          }
        } finally {
          reader.releaseLock()
        }
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Generation was cancelled')
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate paper'
        setError(errorMessage)
        console.error('Generation error:', err)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }

  return {
    content,
    isLoading,
    error,
    chunkCount,
    lastUpdated,
    startGeneration,
    stopGeneration
  }
} 