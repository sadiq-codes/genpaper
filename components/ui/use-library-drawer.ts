'use client'

import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'

// =============================================================================
// Types
// =============================================================================

export interface SearchResult {
  id: string
  canonicalId?: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  abstract?: string
  doi?: string
  url?: string
  pdfUrl?: string
  citationCount?: number
  relevanceScore?: number
  source: string
  type: 'library' | 'search'
}

export type SearchMode = 'library' | 'online'

export interface PaperActions {
  canAdd: boolean
  canSave: boolean
  canSelect: boolean
  isAdded: boolean
  isSaved: boolean
  isSelected: boolean
}

export interface UseLibraryDrawerOptions {
  isOpen: boolean
  onClose: () => void
  onAddToProject?: (paperId: string, title: string) => void
  currentProjectId?: string
  initialQuery?: string
  libraryOnlyMode?: boolean
  onSelectForProject?: (paper: { id: string; title: string; authors: string[]; year: number | null }) => void
  selectedPaperIds?: string[]
}

// =============================================================================
// API fetchers
// =============================================================================

const LIBRARY_PAGE_SIZE = 25

async function fetchLibraryPapers({ 
  offset = 0, 
  limit = LIBRARY_PAGE_SIZE 
}: { 
  offset?: number
  limit?: number 
} = {}): Promise<SearchResult[]> {
  const response = await fetch(
    `/api/papers?library=me&sortBy=added_at&sortOrder=desc&maxResults=${limit}&offset=${offset}`
  )
  if (!response.ok) throw new Error('Failed to load library')
  
  const data = await response.json()
  return data.papers.map((item: any) => ({
    id: item.paper.id,
    canonicalId: typeof item.paper.metadata?.canonical_id === 'string' ? item.paper.metadata.canonical_id : undefined,
    title: item.paper.title,
    authors: item.paper.author_names || [],
    year: item.paper.publication_date ? new Date(item.paper.publication_date).getFullYear() : null,
    journal: item.paper.venue,
    abstract: item.paper.abstract,
    doi: item.paper.doi,
    url: item.paper.pdf_url || (item.paper.doi ? `https://doi.org/${item.paper.doi}` : undefined),
    pdfUrl: item.paper.pdf_url || undefined,
    citationCount: item.paper.citation_count,
    source: item.paper.source || 'library',
    type: 'library' as const
  }))
}

async function searchPapersFast(
  query: string, 
  signal?: AbortSignal
): Promise<{ papers: SearchResult[], phase: 'fast' }> {
  const response = await fetch('/api/library-search/fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      options: {
        maxResults: 25,
        sources: ['openalex', 'crossref', 'semantic_scholar']
      }
    }),
    signal,
  })

  if (!response.ok) throw new Error('Search failed')
  
  const data = await response.json()
  if (!data.success) throw new Error('Search failed')
  
  return {
    papers: data.papers.map((paper: any) => ({
      id: paper.canonical_id,
      canonicalId: paper.canonical_id,
      title: paper.title,
      authors: paper.authors || [],
      year: paper.year,
      journal: paper.venue,
      abstract: paper.abstract,
      doi: paper.doi,
      url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
      citationCount: paper.citationCount,
      relevanceScore: paper.bm25Score,
      source: paper.source,
      type: 'search' as const
    })),
    phase: 'fast'
  }
}

async function rerankPapers(
  query: string,
  papers: SearchResult[],
  signal?: AbortSignal
): Promise<SearchResult[]> {
  if (papers.length === 0) return papers
  
  const response = await fetch('/api/library-search/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      papers: papers.map(p => ({
        canonical_id: p.id,
        title: p.title,
        abstract: p.abstract,
        authors: p.authors,
        year: p.year,
        venue: p.journal,
        doi: p.doi,
        url: p.url,
        citationCount: p.citationCount,
        source: p.source
      }))
    }),
    signal,
  })

  if (!response.ok) throw new Error('Rerank failed')
  
  const data = await response.json()
  if (!data.success) throw new Error('Rerank failed')
  
  return data.papers.map((paper: any) => ({
    id: paper.canonical_id,
    canonicalId: paper.canonical_id,
    title: paper.title,
    authors: paper.authors || [],
    year: paper.year,
    journal: paper.venue,
    abstract: paper.abstract,
    doi: paper.doi,
    url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : undefined),
    citationCount: paper.citationCount,
    relevanceScore: paper.semanticScore,
    source: paper.source,
    type: 'search' as const
  }))
}

async function addPaperToLibraryApi({
  paper,
  searchQuery,
}: {
  paper: SearchResult
  searchQuery?: string
}): Promise<{ paperId: string }> {
  const response = await fetch('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      paper.type === 'search'
        ? {
            searchQuery,
            searchResult: {
              canonical_id: paper.canonicalId || paper.id,
              title: paper.title,
              abstract: paper.abstract,
              authors: paper.authors,
              year: paper.year,
              venue: paper.journal,
              doi: paper.doi,
              url: paper.url,
              pdfUrl: paper.pdfUrl,
              citationCount: paper.citationCount,
              relevanceScore: paper.relevanceScore,
              source: paper.source,
            },
          }
        : { paperId: paper.id }
    )
  })
  if (!response.ok) throw new Error('Failed to add paper to library')
  const data = await response.json()
  return { paperId: data.paperId || paper.id }
}

// =============================================================================
// Hook
// =============================================================================

export function useLibraryDrawer({
  isOpen,
  onAddToProject,
  currentProjectId,
  initialQuery = '',
  libraryOnlyMode = false,
  onSelectForProject,
  selectedPaperIds = [],
}: UseLibraryDrawerOptions) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('library')
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null)
  const [addedPapers, setAddedPapers] = useState<Set<string>>(new Set())
  const [savedToLibraryPapers, setSavedToLibraryPapers] = useState<Set<string>>(new Set())
  const [resolvedPaperIds, setResolvedPaperIds] = useState<Map<string, string>>(new Map())
  const [isTyping, setIsTyping] = useState(false)
  
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)

  // =========================================================================
  // Queries
  // =========================================================================

  const {
    data: libraryData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingLibrary,
    error: libraryError,
    refetch: refetchLibrary,
  } = useInfiniteQuery({
    queryKey: ['library', 'papers'],
    queryFn: ({ pageParam = 0 }) => fetchLibraryPapers({ offset: pageParam, limit: LIBRARY_PAGE_SIZE }),
    getNextPageParam: (lastPage, allPages) => 
      lastPage.length === LIBRARY_PAGE_SIZE ? allPages.length * LIBRARY_PAGE_SIZE : undefined,
    initialPageParam: 0,
    enabled: isOpen,
    staleTime: 5 * 60 * 1000,
  })

  const libraryPapers = useMemo(
    () => libraryData?.pages.flat() ?? [],
    [libraryData]
  )

  const { 
    data: fastSearchData,
    isFetching: isFetchingFast,
    error: fastSearchError,
    refetch: refetchFastSearch,
  } = useQuery({
    queryKey: ['papers', 'search', 'fast', debouncedQuery],
    queryFn: async ({ signal }) => {
      const result = await searchPapersFast(debouncedQuery, signal)
      return result.papers
    },
    enabled: isOpen && searchMode === 'online' && debouncedQuery.length >= 3,
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const fastResultIds = useMemo(
    () => fastSearchData?.map(p => p.id).join(',') ?? '',
    [fastSearchData]
  )

  const { 
    data: rerankedData,
    isFetching: isReranking
  } = useQuery({
    queryKey: ['papers', 'search', 'rerank', debouncedQuery, fastResultIds],
    queryFn: async ({ signal }) => {
      if (!fastSearchData || fastSearchData.length === 0) return null
      return await rerankPapers(debouncedQuery, fastSearchData, signal)
    },
    enabled: isOpen && searchMode === 'online' && debouncedQuery.length >= 3 && !!fastSearchData && fastSearchData.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const onlineResults = rerankedData ?? fastSearchData ?? []
  const isSearchingOnline = isFetchingFast

  const addToLibraryMutation = useMutation({
    mutationFn: addPaperToLibraryApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library', 'papers'] })
    }
  })

  // =========================================================================
  // Effects
  // =========================================================================

  // Debounce search query
  useEffect(() => {
    if (searchMode === 'online' && query.trim().length < 3) {
      setDebouncedQuery('')
      setIsTyping(false)
      return
    }
    
    if (searchMode === 'online' && query.trim().length >= 3) {
      setIsTyping(true)
    }
    
    const timer = setTimeout(() => {
      startTransition(() => {
        setDebouncedQuery(query)
        setIsTyping(false)
      })
    }, searchMode === 'online' ? 500 : 150)
    
    return () => clearTimeout(timer)
  }, [query, searchMode])

  // Reset when drawer opens
  useEffect(() => {
    if (isOpen) {
      setAddedPapers(new Set())
      setSavedToLibraryPapers(new Set())
      setResolvedPaperIds(new Map())
      setIsTyping(false)
      if (initialQuery) {
        setQuery(initialQuery)
        if (initialQuery.trim()) {
          setSearchMode('online')
        }
      }
    }
  }, [isOpen, initialQuery])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

  // Infinite scroll observer
  useEffect(() => {
    if (!isOpen || searchMode !== 'library') return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    
    const currentRef = loadMoreRef.current
    if (currentRef) observer.observe(currentRef)
    
    return () => {
      if (currentRef) observer.unobserve(currentRef)
      observer.disconnect()
    }
  }, [isOpen, searchMode, hasNextPage, isFetchingNextPage, fetchNextPage])

  // =========================================================================
  // Computed
  // =========================================================================

  const filteredLibraryPapers = useMemo(() => {
    if (!query.trim()) return libraryPapers
    const q = query.toLowerCase()
    return libraryPapers.filter(paper =>
      paper.title.toLowerCase().includes(q) ||
      paper.authors.some(author => author.toLowerCase().includes(q)) ||
      paper.journal?.toLowerCase().includes(q) ||
      paper.abstract?.toLowerCase().includes(q)
    )
  }, [libraryPapers, query])

  const libraryIdsSet = useMemo(
    () => new Set(libraryPapers.flatMap((paper) => {
      const ids = [paper.id]
      if (paper.canonicalId) {
        ids.push(paper.canonicalId)
      }
      return ids
    })),
    [libraryPapers]
  )

  const enrichedOnlineResults = useMemo(() => {
    return onlineResults.map(paper => ({
      ...paper,
      type: libraryIdsSet.has(paper.id) || resolvedPaperIds.has(paper.id) ? 'library' as const : 'search' as const
    }))
  }, [onlineResults, libraryIdsSet, resolvedPaperIds])

  const results = searchMode === 'library' ? filteredLibraryPapers : enrichedOnlineResults
  const isSearching = searchMode === 'online' && (isSearchingOnline || isTyping)
  const hasSearchRequest = searchMode === 'online' && debouncedQuery.length >= 3
  const activeError = searchMode === 'library'
    ? libraryError
    : hasSearchRequest
      ? fastSearchError
      : null
  const errorMessage = activeError instanceof Error
    ? activeError.message
    : searchMode === 'library'
      ? 'Failed to load your saved papers.'
      : 'Failed to search papers.'
  const showErrorState = !!activeError && results.length === 0 && !isSearching && !isLoadingLibrary

  // Display flags
  const showEmptyLibrary = searchMode === 'library' && libraryPapers.length === 0 && !query && !isLoadingLibrary
  const showNoResults = results.length === 0 && query.trim().length >= 3 && !isSearching && !isLoadingLibrary
  const showSearchPrompt = searchMode === 'online' && !query && !isSearching && onlineResults.length === 0
  const showMinCharsHint = searchMode === 'online' && query.trim().length > 0 && query.trim().length < 3
  const showSkeletons = (isLoadingLibrary && libraryPapers.length === 0) || 
                        (isSearching && results.length === 0)

  // =========================================================================
  // Handlers
  // =========================================================================

  const handleAddToProject = useCallback(async (paper: SearchResult) => {
    if (!currentProjectId || addedPapers.has(paper.id)) return

    setAddedPapers(prev => new Set(prev).add(paper.id))

    try {
      let projectPaperId = paper.id
      if (paper.type === 'search') {
        const { paperId } = await addToLibraryMutation.mutateAsync({
          paper,
          searchQuery: debouncedQuery || query,
        })
        projectPaperId = paperId
        setResolvedPaperIds((prev) => new Map(prev).set(paper.id, paperId))
      }
      onAddToProject?.(projectPaperId, paper.title)
    } catch (error) {
      setAddedPapers(prev => {
        const next = new Set(prev)
        next.delete(paper.id)
        return next
      })
      console.error('Error adding paper:', error)
    }
  }, [currentProjectId, onAddToProject, addedPapers, addToLibraryMutation, debouncedQuery, query])

  const handleSaveToLibrary = useCallback(async (paper: SearchResult) => {
    if (savedToLibraryPapers.has(paper.id) || paper.type === 'library') return

    setSavedToLibraryPapers(prev => new Set(prev).add(paper.id))

    try {
      const { paperId } = await addToLibraryMutation.mutateAsync({
        paper,
        searchQuery: debouncedQuery || query,
      })
      setResolvedPaperIds((prev) => new Map(prev).set(paper.id, paperId))
    } catch (error) {
      setSavedToLibraryPapers(prev => {
        const next = new Set(prev)
        next.delete(paper.id)
        return next
      })
      console.error('Error saving paper to library:', error)
    }
  }, [savedToLibraryPapers, addToLibraryMutation, debouncedQuery, query])

  const handleSelectForProject = useCallback(async (paper: SearchResult) => {
    if (!onSelectForProject) return
    
    let selectedPaperId = resolvedPaperIds.get(paper.id) || paper.id

    if (paper.type === 'search') {
      setSavedToLibraryPapers(prev => new Set(prev).add(paper.id))
      
      try {
        const { paperId } = await addToLibraryMutation.mutateAsync({
          paper,
          searchQuery: debouncedQuery || query,
        })
        selectedPaperId = paperId
        setResolvedPaperIds((prev) => new Map(prev).set(paper.id, paperId))
      } catch (error) {
        setSavedToLibraryPapers(prev => {
          const next = new Set(prev)
          next.delete(paper.id)
          return next
        })
        console.error('Error adding paper to library:', error)
        return
      }
    }
    
    onSelectForProject({
      id: selectedPaperId,
      title: paper.title,
      authors: paper.authors,
      year: paper.year
    })
  }, [onSelectForProject, addToLibraryMutation, debouncedQuery, query, resolvedPaperIds])

  const handleUploadPdf = useCallback((paperId: string) => {
    uploadTargetRef.current = paperId
    fileInputRef.current?.click()
  }, [])

  const retry = useCallback(() => {
    if (searchMode === 'library') {
      void refetchLibrary()
      return
    }

    if (debouncedQuery.length >= 3) {
      void refetchFastSearch()
    }
  }, [debouncedQuery.length, refetchFastSearch, refetchLibrary, searchMode])

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const paperId = uploadTargetRef.current
    if (!file || !paperId) return

    e.target.value = ''

    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are allowed')
      return
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 20MB')
      return
    }

    const toastId = toast.loading('Uploading PDF...')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/papers/${paperId}/upload-pdf`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Upload failed')
      }

      const data = await res.json()

      let cacheUpdated = false
      queryClient.setQueriesData(
        { queryKey: ['library', 'papers'] },
        (old: any) => {
          if (!old?.pages) return old
          cacheUpdated = true
          return {
            ...old,
            pages: old.pages.map((page: SearchResult[]) =>
              page.map((p: SearchResult) =>
                p.id === paperId ? { ...p, pdfUrl: data.pdfUrl, url: data.pdfUrl } : p
              )
            ),
          }
        }
      )

      if (!cacheUpdated) {
        queryClient.invalidateQueries({ queryKey: ['library', 'papers'] })
      }

      toast.success('PDF uploaded', { id: toastId })
    } catch (error) {
      console.error('PDF upload error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload PDF', { id: toastId })
    }
  }, [queryClient])

  // Compute actions for a paper
  const getPaperActions = useCallback((paper: SearchResult): PaperActions => ({
    canAdd: !!currentProjectId,
    canSave: libraryOnlyMode && !currentProjectId && !onSelectForProject,
    canSelect: !!onSelectForProject,
    isAdded: addedPapers.has(paper.id) || addedPapers.has(resolvedPaperIds.get(paper.id) || ''),
    isSaved: savedToLibraryPapers.has(paper.id) || resolvedPaperIds.has(paper.id) || paper.type === 'library',
    isSelected: selectedPaperIds.includes(resolvedPaperIds.get(paper.id) || paper.id),
  }), [currentProjectId, libraryOnlyMode, onSelectForProject, addedPapers, savedToLibraryPapers, selectedPaperIds, resolvedPaperIds])

  return {
    // State
    query,
    setQuery,
    searchMode,
    setSearchMode,
    expandedAbstract,
    setExpandedAbstract,

    // Refs
    loadMoreRef,
    fileInputRef,

    // Results
    results,
    libraryPapers,
    isSearching,
    isSearchingOnline,
    isReranking,
    isTyping,

    // Pagination
    hasNextPage,
    isFetchingNextPage,

    // Display flags
    showEmptyLibrary,
    showErrorState,
    showNoResults,
    showSearchPrompt,
    showMinCharsHint,
    showSkeletons,
    errorMessage,

    // Handlers
    handleAddToProject,
    handleSaveToLibrary,
    handleSelectForProject,
    handleUploadPdf,
    handleFileSelected,
    getPaperActions,
    retry,

    // Constants
    LIBRARY_PAGE_SIZE,
  }
}
