'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProcessingScreen } from '@/components/ProcessingScreen'
import type { GenerateRequest } from '@/types/simplified'
import { useStreamGeneration, useStartGeneration } from '@/lib/hooks/useStreamGeneration'

export default function ProcessingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [hasStarted, setHasStarted] = useState(false)
  
  // Get parameters from URL
  const topic = searchParams.get('topic') || ''
  const length = searchParams.get('length') as 'short' | 'medium' | 'long' || 'medium'
  const style = searchParams.get('style') as 'academic' | 'review' | 'survey' || 'academic'
  const citationStyle = searchParams.get('citationStyle') as 'apa' | 'mla' | 'chicago' | 'ieee' || 'apa'
  const useLibraryOnly = searchParams.get('useLibraryOnly') === 'true'
  const selectedPapers = searchParams.get('selectedPapers')?.split(',').filter(Boolean) || []

  // Generation state
  const { startGeneration, streamUrl } = useStartGeneration()
  
  // Stabilize callbacks to prevent infinite loops
  const handleComplete = useCallback((projectId: string) => {
    // Auto-redirect to view the generated paper
    router.replace(`/projects/${projectId}`)
  }, [router])
  
  const handleError = useCallback((error: string) => {
    console.error('Generation error:', error)
    // Redirect back to generate page with error
    router.push('/generate?error=' + encodeURIComponent(error))
  }, [router])
  
  const handleProgress = useCallback((progress: any) => {
    console.log('Generation progress:', progress)
  }, [])
  
  // Use stream generation hook to get real-time data
  const streamState = useStreamGeneration(streamUrl, {
    onComplete: handleComplete,
    onError: handleError,
    onProgress: handleProgress
  })

  // Start generation when component mounts
  useEffect(() => {
    if (!topic || hasStarted) return
    
    const request: GenerateRequest = {
      topic: topic.trim(),
      libraryPaperIds: selectedPapers,
      useLibraryOnly,
      config: {
        length,
        style,
        citationStyle
      }
    }

    const startGenerationAsync = async () => {
      try {
        await startGeneration(request)
        setHasStarted(true)
      } catch (error) {
        console.error('Failed to start generation:', error)
        router.push('/generate?error=' + encodeURIComponent('Failed to start generation'))
      }
    }

    startGenerationAsync()
  }, [topic, selectedPapers, useLibraryOnly, length, style, citationStyle, hasStarted, startGeneration, router])

  // Redirect back if no topic
  useEffect(() => {
    if (!topic) {
      router.push('/generate')
    }
  }, [topic, router])

  if (!topic) {
    return null
  }

  return (
    <ProcessingScreen 
      topic={topic}
      progress={streamState.progress}
      isConnected={streamState.isConnected}
      error={streamState.error}
    />
  )
} 