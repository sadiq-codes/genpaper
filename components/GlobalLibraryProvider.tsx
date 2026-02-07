'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'

// Lazy load heavy components - only load when opened
// This saves ~50KB from initial bundle
const CommandPalette = dynamic(() => import('@/components/ui/command-palette'), {
  ssr: false,
  loading: () => null, // No loading state - modal will just appear
})

const LibraryDrawer = dynamic(() => import('@/components/ui/library-drawer'), {
  ssr: false,
  loading: () => null, // No loading state - drawer will just appear
})

interface GlobalLibraryContextType {
  openCommandPalette: () => void
  openLibraryDrawer: (query?: string) => void
  closeLibraryDrawer: () => void
  addPaperToProject: (paperId: string, title: string) => Promise<void>
  setCurrentProject: (projectId: string) => void
}

const GlobalLibraryContext = createContext<GlobalLibraryContextType | null>(null)

interface GlobalLibraryProviderProps {
  children: ReactNode
}

export default function GlobalLibraryProvider({ children }: GlobalLibraryProviderProps) {
  const queryClient = useQueryClient()
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showLibraryDrawer, setShowLibraryDrawer] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [currentProjectId, setCurrentProjectId] = useState<string>()

  // Prefetch library papers so the drawer opens instantly
  useEffect(() => {
    queryClient.prefetchInfiniteQuery({
      queryKey: ['library', 'papers'],
      queryFn: async () => {
        const res = await fetch('/api/papers?library=me&sortBy=added_at&sortOrder=desc&maxResults=25&offset=0')
        if (!res.ok) return []
        const data = await res.json()
        return data.papers.map((item: any) => ({
          id: item.paper.id,
          title: item.paper.title,
          authors: item.paper.author_names || [],
          year: item.paper.publication_date ? new Date(item.paper.publication_date).getFullYear() : null,
          journal: item.paper.venue,
          abstract: item.paper.abstract,
          doi: item.paper.doi,
          url: item.paper.pdf_url || (item.paper.doi ? `https://doi.org/${item.paper.doi}` : undefined),
          citationCount: item.paper.citation_count,
          source: item.paper.source || 'library',
          type: 'library' as const,
        }))
      },
      initialPageParam: 0,
      staleTime: 5 * 60 * 1000,
    })
  }, [queryClient])

  // Handle Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Ignore if user is in an input, textarea, or contenteditable
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA' || 
          target.contentEditable === 'true'
        ) {
          return
        }
        
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Open command palette
  const openCommandPalette = useCallback(() => {
    setShowCommandPalette(true)
  }, [])

  // Open library drawer
  const openLibraryDrawer = useCallback((query = '') => {
    setLibraryQuery(query)
    setShowLibraryDrawer(true)
  }, [])

  // Close library drawer
  const closeLibraryDrawer = useCallback(() => {
    setShowLibraryDrawer(false)
    setLibraryQuery('')
  }, [])

  // Set current project for "Add to Project" functionality
  const setCurrentProject = useCallback((projectId: string) => {
    setCurrentProjectId(projectId)
  }, [])

  // Add paper to current project
  const addPaperToProject = useCallback(async (paperId: string, title: string) => {
    if (!currentProjectId) {
      console.warn('No current project set')
      return
    }

    try {
      // First ensure paper is in user's library
      const libraryResponse = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paperId })
      })

      // Even if it fails (paper already in library), continue
      if (!libraryResponse.ok && libraryResponse.status !== 409) {
        console.warn('Failed to add paper to library, but continuing...')
      }

      // Add paper to project's citations/sources
      const projectResponse = await fetch(`/api/projects/${currentProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_source',
          paperId,
          title
        })
      })

      if (projectResponse.ok) {
        console.log(`Paper "${title}" added to current project`)
        
        // Close library drawer after successful addition
        closeLibraryDrawer()
      } else {
        throw new Error('Failed to add paper to project')
      }

    } catch (error) {
      console.error('Error adding paper to project:', error)
    }
  }, [currentProjectId, closeLibraryDrawer])

  // Handle library search from command palette
  const handleLibrarySearch = useCallback((query: string) => {
    openLibraryDrawer(query)
  }, [openLibraryDrawer])

  // Handle upload PDF from command palette - navigate to library page
  // The library page has the full upload UI
  const handleUploadPdf = useCallback(() => {
    window.location.href = '/library'
  }, [])

  const contextValue: GlobalLibraryContextType = {
    openCommandPalette,
    openLibraryDrawer,
    closeLibraryDrawer,
    addPaperToProject,
    setCurrentProject
  }

  return (
    <GlobalLibraryContext.Provider value={contextValue}>
      {children}
      
      {/* Command Palette - only render when open (lazy loaded) */}
      {showCommandPalette && (
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onLibrarySearch={handleLibrarySearch}
          onUploadPdf={handleUploadPdf}
        />
      )}
      
      {/* Library Drawer - only render when open (lazy loaded) */}
      {showLibraryDrawer && (
        <LibraryDrawer
          isOpen={showLibraryDrawer}
          onClose={closeLibraryDrawer}
          onAddToProject={addPaperToProject}
          currentProjectId={currentProjectId}
          initialQuery={libraryQuery}
        />
      )}
    </GlobalLibraryContext.Provider>
  )
}

/**
 * Hook to use the global library context.
 * Currently unused but available for components that need direct library access.
 * The drawer can be opened via the GlobalLibraryProvider's onOpen callback.
 */
export function useGlobalLibrary() {
  const context = useContext(GlobalLibraryContext)
  if (!context) {
    throw new Error('useGlobalLibrary must be used within a GlobalLibraryProvider')
  }
  return context
}
