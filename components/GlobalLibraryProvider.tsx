'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import CommandPalette from '@/components/ui/command-palette'
import LibraryDrawer from '@/components/ui/library-drawer'

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
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showLibraryDrawer, setShowLibraryDrawer] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [currentProjectId, setCurrentProjectId] = useState<string>()

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
        console.log(`✅ Paper "${title}" added to current project`)
        
        // Optional: Show success feedback
        // You could add a toast notification here
        
        // Close library drawer after successful addition
        closeLibraryDrawer()
      } else {
        throw new Error('Failed to add paper to project')
      }

    } catch (error) {
      console.error('Error adding paper to project:', error)
      // You could show an error toast here
    }
  }, [currentProjectId, closeLibraryDrawer])

  // Handle library search from command palette
  const handleLibrarySearch = useCallback((query: string) => {
    openLibraryDrawer(query)
  }, [openLibraryDrawer])

  // Handle project search from command palette
  const handleProjectSearch = useCallback((query: string) => {
    // Use Next.js router for SPA navigation instead of window.location
    // Note: This would require importing useRouter and passing it down
    // For now, we'll use window.location for simplicity
    window.location.href = `/projects?search=${encodeURIComponent(query)}`
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
      
      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onLibrarySearch={handleLibrarySearch}
        onProjectSearch={handleProjectSearch}
      />
      
      {/* Library Drawer */}
      <LibraryDrawer
        isOpen={showLibraryDrawer}
        onClose={closeLibraryDrawer}
        onAddToProject={addPaperToProject}
        currentProjectId={currentProjectId}
        initialQuery={libraryQuery}
      />
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