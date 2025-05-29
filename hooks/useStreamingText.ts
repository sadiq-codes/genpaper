import { useState, useCallback } from 'react'

interface UseStreamingTextOptions {
  url: string
  body: Record<string, any>
}

interface UseStreamingTextReturn {
  streamedText: string
  isLoading: boolean
  error: string | null
  isComplete: boolean
  startStreaming: (options: UseStreamingTextOptions) => Promise<void>
  reset: () => void
}

export function useStreamingText(): UseStreamingTextReturn {
  const [streamedText, setStreamedText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isComplete, setIsComplete] = useState(false)

  const startStreaming = useCallback(async (options: UseStreamingTextOptions) => {
    setIsLoading(true)
    setError(null)
    setStreamedText('')
    setIsComplete(false)

    try {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options.body),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          setIsComplete(true)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.startsWith('0:')) {
            try {
              // Parse the JSON data after the "0:" prefix
              const jsonData = JSON.parse(line.slice(2))
              if (jsonData && typeof jsonData === 'string') {
                setStreamedText(prev => prev + jsonData)
              }
            } catch (parseError) {
              console.warn('Failed to parse stream chunk:', line, parseError)
            }
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      console.error('Streaming error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setStreamedText('')
    setIsLoading(false)
    setError(null)
    setIsComplete(false)
  }, [])

  return {
    streamedText,
    isLoading,
    error,
    isComplete,
    startStreaming,
    reset,
  }
} 