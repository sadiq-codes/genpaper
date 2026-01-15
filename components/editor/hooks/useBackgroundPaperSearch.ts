/**
 * useBackgroundPaperSearch - Searches for relevant papers in the background for write mode
 * 
 * When a user selects "Write myself" mode, this hook:
 * 1. Searches for papers based on the project topic
 * 2. Automatically adds found papers to the project
 * 3. Provides status updates via state
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { ProjectPaper } from '../types'

interface UseBackgroundPaperSearchOptions {
  /** Project ID to add papers to */
  projectId?: string
  /** Topic to search for */
  topic?: string
  /** Whether to run the search (usually isWriteMode && !hasExistingPapers) */
  enabled?: boolean
  /** Maximum number of papers to find */
  maxPapers?: number
  /** Callback when papers are found and added */
  onPapersFound?: (papers: ProjectPaper[]) => void
}

interface UseBackgroundPaperSearchReturn {
  /** Whether search is in progress */
  isSearching: boolean
  /** Number of papers found so far */
  papersFound: number
  /** Any error that occurred */
  error: string | null
  /** Manually trigger search */
  triggerSearch: () => Promise<void>
}

export function useBackgroundPaperSearch({
  projectId,
  topic,
  enabled = false,
  maxPapers = 10,
  onPapersFound,
}: UseBackgroundPaperSearchOptions): UseBackgroundPaperSearchReturn {
  const [isSearching, setIsSearching] = useState(false)
  const [papersFound, setPapersFound] = useState(0)
  const [error, setError] = useState<string | null>(null)
  
  // Track if we've already run the search
  const hasSearchedRef = useRef(false)

  const searchAndAddPapers = useCallback(async () => {
    if (!projectId || !topic) return
    
    setIsSearching(true)
    setError(null)
    
    try {
      // Step 1: Search for papers
      const searchResponse = await fetch(
        `/api/papers?search=${encodeURIComponent(topic)}&maxResults=${maxPapers}&ingest=true`
      )
      
      if (!searchResponse.ok) {
        throw new Error('Failed to search for papers')
      }
      
      const searchData = await searchResponse.json()
      const foundPapers = searchData.papers || []
      
      if (foundPapers.length === 0) {
        toast.info('No papers found', {
          description: 'Try adding papers manually from the library',
        })
        return
      }
      
      // Step 2: Add papers to the project
      const addedPapers: ProjectPaper[] = []
      
      for (const paper of foundPapers.slice(0, maxPapers)) {
        try {
          const addResponse = await fetch('/api/editor/papers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId,
              paperId: paper.id,
            }),
          })
          
          if (addResponse.ok) {
            const addData = await addResponse.json()
            addedPapers.push(addData.paper)
            setPapersFound(prev => prev + 1)
          } else if (addResponse.status === 409) {
            // Paper already in project, skip
            continue
          }
        } catch {
          // Individual paper add failed, continue with others
          console.warn(`Failed to add paper ${paper.id}`)
        }
      }
      
      if (addedPapers.length > 0) {
        toast.success(`Found ${addedPapers.length} relevant papers`, {
          description: 'Check the Research tab to see the sources',
          duration: 5000,
        })
        
        onPapersFound?.(addedPapers)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      setError(message)
      console.error('Background paper search failed:', err)
      
      toast.error('Paper search failed', {
        description: 'You can still add papers manually from the library',
      })
    } finally {
      setIsSearching(false)
    }
  }, [projectId, topic, maxPapers, onPapersFound])

  // Auto-run search when enabled
  useEffect(() => {
    if (!enabled || !projectId || !topic || hasSearchedRef.current) {
      return
    }
    
    // Mark as searched to prevent re-runs
    hasSearchedRef.current = true
    
    // Delay slightly to allow UI to settle
    const timer = setTimeout(() => {
      searchAndAddPapers()
    }, 1500)
    
    return () => clearTimeout(timer)
  }, [enabled, projectId, topic, searchAndAddPapers])

  return {
    isSearching,
    papersFound,
    error,
    triggerSearch: searchAndAddPapers,
  }
}
