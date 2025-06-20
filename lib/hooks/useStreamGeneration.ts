import { useEffect, useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import type { GenerationProgress, GenerateRequest } from '@/types/simplified'

export interface StreamGenerationState {
  isConnected: boolean
  progress: GenerationProgress | null
  error: string | null
  projectId: string | null
  isComplete: boolean
}

interface UseStreamGenerationOptions {
  onProgress?: (progress: GenerationProgress) => void
  onComplete?: (projectId: string) => void
  onError?: (error: string) => void
}

// Helper hook for starting a generation and managing the stream URL
export function useStartGeneration() {
  const [isStarting, setIsStarting] = useState(false)
  const [generationParams, setGenerationParams] = useState<GenerateRequest | null>(null)
  
  const startGeneration = async (request: GenerateRequest) => {
    setIsStarting(true)
    try {
      // Store the generation parameters for the EventSource
      setGenerationParams(request)
      
    } catch (error) {
      console.error('Failed to start generation:', error)
      throw error
    } finally {
      setIsStarting(false)
    }
  }

  const stopGeneration = () => {
    setGenerationParams(null)
  }

  // Build the EventSource URL with query parameters
  const streamUrl = generationParams ? buildStreamUrl(generationParams) : null

  return {
    startGeneration,
    stopGeneration,
    isStarting,
    streamUrl
  }
}

// Build EventSource URL with query parameters
function buildStreamUrl(request: GenerateRequest): string {
  const params = new URLSearchParams()
  params.set('topic', request.topic)
  
  if (request.libraryPaperIds && request.libraryPaperIds.length > 0) {
    params.set('libraryPaperIds', request.libraryPaperIds.join(','))
  }
  
  if (request.useLibraryOnly) {
    params.set('useLibraryOnly', 'true')
  }
  
  if (request.config) {
    if (request.config.length) params.set('length', request.config.length)
    if (request.config.paperType) params.set('paperType', request.config.paperType)
    if (request.config.includeMethodology !== undefined) {
      params.set('includeMethodology', request.config.includeMethodology.toString())
    }
  }
  
  return `/api/generate/stream?${params.toString()}`
}

// SWR fetcher for EventSource/SSE
const fetchSSE = async (url: string): Promise<EventSource | null> => {
  // Return null if no URL provided (SWR will handle this as no data)
  if (!url) return null
  
  console.log('📡 Creating EventSource for:', url)
  
  return new Promise((resolve, reject) => {
    const eventSource = new EventSource(url, { 
      withCredentials: true 
    })
    
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      console.error('⏰ EventSource connection timeout after 10s')
      console.error('⏰ EventSource readyState:', eventSource.readyState)
      console.error('⏰ EventSource url:', eventSource.url)
      eventSource.close()
      reject(new Error('EventSource connection timeout'))
    }, 10000) // 10 second timeout
    
    eventSource.onopen = () => {
      clearTimeout(timeout)
      console.log('✅ EventSource connected successfully')
      console.log('✅ EventSource readyState:', eventSource.readyState)
      resolve(eventSource)
    }
    
    eventSource.onerror = (error) => {
      clearTimeout(timeout)
      console.error('❌ EventSource connection error:', error)
      console.error('❌ EventSource readyState:', eventSource.readyState)
      console.error('❌ EventSource url:', eventSource.url)
      
      // Check if it's a network error or server error
      if (eventSource.readyState === EventSource.CLOSED) {
        reject(new Error('EventSource connection closed by server'))
      } else {
        reject(new Error('Failed to connect to event stream'))
      }
    }
  })
}

export function useStreamGeneration(
  streamUrl: string | null,
  options: UseStreamGenerationOptions = {}
): StreamGenerationState {
  const { onProgress, onComplete, onError } = options
  
  const [state, setState] = useState<StreamGenerationState>({
    isConnected: false,
    progress: null,
    error: null,
    projectId: null,
    isComplete: false
  })
  
  const eventSourceRef = useRef<EventSource | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Use SWR to manage the EventSource connection
  const { data: eventSource, error: swrError } = useSWR(
    streamUrl, 
    fetchSSE,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      dedupingInterval: 0 // Disable deduping for streaming
    }
  )

  useEffect(() => {
    if (!eventSource) return

    eventSourceRef.current = eventSource
    
    setState(prev => ({ ...prev, isConnected: true, error: null }))

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        
        // Ignore ping messages
        if (data.type === 'ping') return
        
        if (data.type === 'status' && data.projectId) {
          setState(prev => ({ ...prev, projectId: data.projectId }))
        }
        
        if (data.type === 'progress') {
          const progress: GenerationProgress = {
            stage: data.stage,
            progress: data.progress,
            message: data.message,
            content: data.content
          }
          
          setState(prev => ({ ...prev, progress }))
          onProgress?.(progress)
        }
        
        if (data.type === 'complete') {
          const progress: GenerationProgress = {
            stage: 'complete',
            progress: 100,
            message: 'Paper generation completed!',
            content: data.content
          }
          
          setState(prev => ({ 
            ...prev, 
            progress,
            isComplete: true,
            isConnected: false 
          }))
          
          if (data.projectId) {
            // Revalidate project versions using SWR mutate - this is the key Task 5 requirement
            mutate(`/api/projects/${data.projectId}/versions`)
            mutate(`/api/projects/${data.projectId}`)
            onComplete?.(data.projectId)
          }
          
          // Close connection after completion
          eventSource.close()
        }
        
        if (data.type === 'checkpoint' && data.projectId) {
          // Key Task 5 requirement: revalidate on checkpoints
          mutate(`/api/projects/${data.projectId}/versions`)
        }
        
        if (data.type === 'error') {
          const errorMessage = data.error || 'Generation failed'
          setState(prev => ({ 
            ...prev, 
            error: errorMessage,
            isConnected: false 
          }))
          onError?.(errorMessage)
          eventSource.close()
        }
        
      } catch (parseError) {
        console.warn('Failed to parse SSE message:', event.data, parseError)
      }
    }

    const handleError = (error: Event) => {
      console.error('EventSource error:', error)
      setState(prev => ({ 
        ...prev, 
        error: 'Connection error',
        isConnected: false 
      }))
      onError?.('Connection error')
    }

    const handleClose = () => {
      setState(prev => ({ ...prev, isConnected: false }))
    }

    // Attach event listeners
    eventSource.onmessage = handleMessage
    eventSource.onerror = handleError
    eventSource.addEventListener('close', handleClose)

    // Cleanup function
    cleanupRef.current = () => {
      eventSource.onmessage = null
      eventSource.onerror = null
      eventSource.removeEventListener('close', handleClose)
      eventSource.close()
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [eventSource, onProgress, onComplete, onError])

  // Handle SWR errors
  useEffect(() => {
    if (swrError) {
      setState(prev => ({ 
        ...prev, 
        error: 'Failed to connect to stream',
        isConnected: false 
      }))
      onError?.('Failed to connect to stream')
    }
  }, [swrError, onError])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  return state
} 