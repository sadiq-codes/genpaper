'use client'

/**
 * Citation Formatter Hook
 * 
 * Provides citation formatting using 100% local processing via citation-js.
 * No API calls needed - instant formatting.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  formatInline,
  formatBibliography,
  isStyleAvailable,
  loadStyle,
  resolveStyleId,
  isNumericStyle,
  clearCaches,
  type CitationPaper,
} from '@/lib/citations/local-formatter'

export type { CitationPaper }

export interface UseCitationFormatterReturn {
  /** Format a single inline citation */
  format: (paper: CitationPaper, citationNumber?: number) => string
  /** Format complete bibliography */
  formatBibliography: (papers: CitationPaper[], citationNumbers?: Map<string, number>) => string
  /** Whether the style is fully loaded (for non-bundled styles) */
  isStyleLoaded: boolean
  /** Whether style is currently loading */
  isLoading: boolean
  /** The resolved style ID being used */
  currentStyle: string
  /** Whether this is a numeric style (IEEE, Vancouver, etc.) */
  isNumeric: boolean
  /** Clear formatting caches */
  clearCache: () => void
}

/**
 * Hook for formatting citations locally
 * 
 * @param styleId - Citation style ID (e.g., 'apa', 'ieee', 'modern-language-association')
 * @returns Formatting functions and state
 */
export function useCitationFormatter(styleId: string = 'apa'): UseCitationFormatterReturn {
  const resolvedStyle = useMemo(() => resolveStyleId(styleId), [styleId])
  const isNumeric = useMemo(() => isNumericStyle(resolvedStyle), [resolvedStyle])
  
  const [isStyleLoaded, setIsStyleLoaded] = useState(() => isStyleAvailable(resolvedStyle))
  const [isLoading, setIsLoading] = useState(false)
  
  // Load style if not available
  useEffect(() => {
    if (isStyleAvailable(resolvedStyle)) {
      setIsStyleLoaded(true)
      setIsLoading(false)
      return
    }
    
    let mounted = true
    setIsLoading(true)
    
    loadStyle(resolvedStyle).then(success => {
      if (mounted) {
        setIsStyleLoaded(success)
        setIsLoading(false)
      }
    })
    
    return () => { mounted = false }
  }, [resolvedStyle])
  
  // Clear caches when style changes
  useEffect(() => {
    clearCaches()
  }, [resolvedStyle])
  
  // Format function - always synchronous, uses fallback if style not loaded
  const format = useCallback((paper: CitationPaper, citationNumber?: number): string => {
    return formatInline(paper, resolvedStyle, citationNumber)
  }, [resolvedStyle])
  
  // Bibliography format function
  const formatBib = useCallback((
    papers: CitationPaper[],
    citationNumbers?: Map<string, number>
  ): string => {
    return formatBibliography(papers, resolvedStyle, citationNumbers)
  }, [resolvedStyle])
  
  // Clear cache function
  const clearCache = useCallback(() => {
    clearCaches()
  }, [])
  
  return {
    format,
    formatBibliography: formatBib,
    isStyleLoaded,
    isLoading,
    currentStyle: resolvedStyle,
    isNumeric,
    clearCache,
  }
}

/**
 * Clear all citation caches globally
 * Call this when papers are updated or removed
 */
export function clearAllCitationCaches(): void {
  clearCaches()
}
