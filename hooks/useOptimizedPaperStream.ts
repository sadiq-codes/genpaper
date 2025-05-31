import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { debounce } from 'lodash'

interface UseOptimizedPaperStreamReturn {
  content: string
  isLoading: boolean
  error: string | null
  chunkCount: number
  wordCount: number
  lastUpdated: Date | null
  startGeneration: (projectId: string, topicTitle: string, outline?: string) => Promise<void>
  stopGeneration: () => void
  isConnected: boolean
}

interface ChunkBuffer {
  seq: number
  text: string
  timestamp: number
}

export function useOptimizedPaperStream(projectId: string): UseOptimizedPaperStreamReturn {
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  
  const abortControllerRef = useRef<AbortController | null>(null)
  const supabase = createClient()
  const chunkBufferRef = useRef<ChunkBuffer[]>([])
  const lastLoadTime = useRef<number>(0)

  // Memoized word count calculation
  const wordCount = useMemo(() => {
    return Math.round(content.length / 5) // Rough approximation
  }, [content])

  // Debounced content update to prevent excessive re-renders
  const debouncedContentUpdate = useCallback(
    debounce((newContent: string, chunks: number, updated: Date) => {
      setContent(newContent)
      setChunkCount(chunks)
      setLastUpdated(updated)
    }, 150), // 150ms debounce
    []
  )

  // Optimized content loading with caching
  const loadExistingContent = useCallback(async (force = false) => {
    const now = Date.now()
    
    // Skip if loaded recently and not forced
    if (!force && now - lastLoadTime.current < 1000) {
      return
    }
    
    lastLoadTime.current = now

    try {
      // Use materialized view for better performance
      const { data, error } = await supabase
        .from('paper_content_materialized')
        .select('content, chunk_count, last_updated, estimated_words')
        .eq('project_id', projectId)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading paper content:', error)
        return
      }

      if (data) {
        debouncedContentUpdate(
          data.content || '',
          data.chunk_count || 0,
          data.last_updated ? new Date(data.last_updated) : new Date()
        )
      }
    } catch (err) {
      console.error('Error in loadExistingContent:', err)
    }
  }, [projectId, supabase, debouncedContentUpdate])

  // Initial load
  useEffect(() => {
    loadExistingContent(true)
  }, [projectId, loadExistingContent])

  // Optimized real-time subscription with connection management
  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout

    const setupSubscription = () => {
      const channel = supabase
        .channel(`paper_chunks:${projectId}`, {
          config: {
            presence: { key: projectId },
            broadcast: { self: false }
          }
        })
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'paper_chunks',
            filter: `project_id=eq.${projectId}`
          },
          (payload) => {
            // Buffer chunks for batch processing
            const chunk: ChunkBuffer = {
              seq: payload.new.seq,
              text: payload.new.text,
              timestamp: Date.now()
            }
            
            chunkBufferRef.current.push(chunk)
            
            // Process buffer every 200ms
            setTimeout(() => processChunkBuffer(), 200)
          }
        )
        .on('presence', { event: 'sync' }, () => {
          setIsConnected(true)
        })
        .on('presence', { event: 'leave' }, () => {
          setIsConnected(false)
          // Auto-reconnect after 5 seconds
          reconnectTimer = setTimeout(setupSubscription, 5000)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setIsConnected(true)
          } else if (status === 'CHANNEL_ERROR') {
            setIsConnected(false)
            // Retry connection
            reconnectTimer = setTimeout(setupSubscription, 2000)
          }
        })

      return channel
    }

    const processChunkBuffer = debounce(() => {
      if (chunkBufferRef.current.length > 0) {
        // Sort by sequence and update content
        chunkBufferRef.current.sort((a, b) => a.seq - b.seq)
        
        // Reload full content for consistency
        loadExistingContent()
        
        // Clear buffer
        chunkBufferRef.current = []
      }
    }, 300)

    const channel = setupSubscription()

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      supabase.removeChannel(channel)
      setIsConnected(false)
    }
  }, [projectId, supabase, loadExistingContent])

  // Optimized generation with better error handling
  const startGeneration = useCallback(async (
    projectId: string, 
    topicTitle: string, 
    outline?: string
  ) => {
    setIsLoading(true)
    setError(null)
    
    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    abortControllerRef.current = new AbortController()
    const timeoutId = setTimeout(() => {
      abortControllerRef.current?.abort()
      setError('Generation timed out after 5 minutes')
    }, 300000) // 5 minute timeout

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

      // Monitor streaming progress
      if (response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let bytesReceived = 0

        try {
          while (true) {
            const { done, value } = await reader.read()
            
            if (done) break
            
            bytesReceived += value.length
            
            // Log progress every 10KB
            if (bytesReceived % 10240 === 0) {
              console.log(`Streaming progress: ${bytesReceived} bytes received`)
            }
          }
        } finally {
          reader.releaseLock()
          clearTimeout(timeoutId)
        }
      }

    } catch (err) {
      clearTimeout(timeoutId)
      
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
  }, [])

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }, [])

  return {
    content,
    isLoading,
    error,
    chunkCount,
    wordCount,
    lastUpdated,
    startGeneration,
    stopGeneration,
    isConnected
  }
} 