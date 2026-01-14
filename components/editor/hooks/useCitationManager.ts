/**
 * React hooks for CitationManager integration
 * 
 * Provides:
 * - useCitation: Subscribe to a single citation's data
 * - useCitationPrefetch: Prefetch all citations in a document
 * - useCitationManagerConfig: Configure the manager with project context
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getCitationManager, type CitationData, type CitationStyle, type PaperInfo } from '../services/CitationManager'
import type { ProjectPaper } from '../types'

/**
 * Hook to subscribe to a citation's data
 * Automatically handles loading, caching, and updates
 */
export function useCitation(paperId: string | undefined): {
  data: CitationData | null
  isLoading: boolean
  error: string | null
  refetch: () => void
} {
  const [data, setData] = useState<CitationData | null>(null)
  const manager = getCitationManager()

  useEffect(() => {
    if (!paperId) {
      setData(null)
      return
    }

    // Subscribe to updates
    const unsubscribe = manager.subscribe(paperId, setData)

    // Trigger fetch (will use cache if available)
    manager.getCitation(paperId)

    return unsubscribe
  }, [paperId, manager])

  const refetch = useCallback(() => {
    if (paperId) {
      manager.getCitation(paperId)
    }
  }, [paperId, manager])

  return {
    data,
    isLoading: data?.status === 'loading',
    error: data?.status === 'error' ? (data.error || 'Unknown error') : null,
    refetch
  }
}

/**
 * Hook to prefetch all citations in a document
 * Call this at the document/editor level
 * 
 * @param citationIds - Array of paper IDs to prefetch
 * @param enabled - Whether prefetching is enabled
 * @param isConfigured - Whether CitationManager is configured (from useCitationManagerConfig)
 */
export function useCitationPrefetch(
  citationIds: string[],
  enabled: boolean = true,
  isConfigured: boolean = false
): {
  isPrefetching: boolean
  prefetchedCount: number
} {
  const [isPrefetching, setIsPrefetching] = useState(false)
  const [prefetchedCount, setPrefetchedCount] = useState(0)
  const prevIdsRef = useRef<string[]>([])
  const manager = getCitationManager()

  useEffect(() => {
    if (!enabled || citationIds.length === 0) return
    
    // Wait for manager to be configured with projectId
    // This prevents the race condition where prefetch runs before configure
    if (!isConfigured) return

    // Check if IDs changed (avoid unnecessary refetches)
    const prevIds = prevIdsRef.current
    const newIds = citationIds.filter(id => !prevIds.includes(id))
    
    if (newIds.length === 0) return

    prevIdsRef.current = citationIds

    setIsPrefetching(true)
    
    manager.prefetch(citationIds).then(() => {
      setIsPrefetching(false)
      setPrefetchedCount(citationIds.length)
    })
  }, [citationIds, enabled, isConfigured, manager])

  return { isPrefetching, prefetchedCount }
}

/**
 * Hook to configure CitationManager with project context
 * Should be called once at the top of the editor component tree
 * 
 * @param projectId - The project ID
 * @param citationStyle - Any CSL style ID (e.g., 'apa', 'ieee', 'nature', 'chicago-author-date')
 * @returns isConfigured - true when manager has a valid projectId
 */
export function useCitationManagerConfig(
  projectId: string | undefined,
  citationStyle: CitationStyle | string
): boolean {
  const [isConfigured, setIsConfigured] = useState(false)
  const manager = getCitationManager()

  useEffect(() => {
    manager.configure(projectId, citationStyle)
    setIsConfigured(!!projectId)
  }, [projectId, citationStyle, manager])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't clear - other components might still need the cache
      // manager.clear()
    }
  }, [])
  
  return isConfigured
}

/**
 * Hook to get optimistic citation text for a paper
 * Used when inserting citations for immediate feedback
 */
export function useOptimisticCitation(): {
  getOptimisticText: (paper: ProjectPaper) => string
  setOptimistic: (paperId: string, paper: ProjectPaper) => void
} {
  const manager = getCitationManager()

  const getOptimisticText = useCallback((paper: ProjectPaper) => {
    return manager.getOptimisticText(paper)
  }, [manager])

  const setOptimistic = useCallback((paperId: string, paper: ProjectPaper) => {
    manager.setOptimistic(paperId, paper)
  }, [manager])

  return { getOptimisticText, setOptimistic }
}

/**
 * Hook to extract citation IDs from TipTap editor JSON
 */
export function extractCitationIdsFromEditor(editorJson: any): string[] {
  const ids: string[] = []
  
  function traverse(node: any) {
    if (!node) return
    
    if (node.type === 'citation' && node.attrs?.id) {
      ids.push(node.attrs.id)
    }
    
    if (Array.isArray(node.content)) {
      node.content.forEach(traverse)
    }
  }
  
  traverse(editorJson)
  return [...new Set(ids)] // Deduplicate
}

// Re-export types
export type { CitationData, CitationStyle, PaperInfo }
