/**
 * usePaperManagement - Manages project papers (add/remove)
 * 
 * Responsibilities:
 * - Papers list state
 * - Adding papers to project
 * - Removing papers from project
 * - Remove confirmation dialog state
 */

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import type { ProjectPaper } from '../types'

interface RemovePaperDialogState {
  open: boolean
  paperId: string
  paperTitle: string
  claimCount: number
}

interface UsePaperManagementOptions {
  projectId?: string
  initialPapers?: ProjectPaper[]
  /** Callback when paper is added (e.g., to trigger re-analysis) */
  onPaperAdded?: () => void
  /** Callback to update analysis state when paper is removed */
  onPaperRemoved?: (paperId: string) => void
}

interface UsePaperManagementReturn {
  /** Current papers list */
  papers: ProjectPaper[]
  /** Set papers list */
  setPapers: React.Dispatch<React.SetStateAction<ProjectPaper[]>>
  /** Add paper to project */
  addPaper: (paperId: string, title: string) => Promise<void>
  /** Initiate paper removal (shows confirmation) */
  removePaper: (paperId: string, claimCount: number) => void
  /** Confirm paper removal */
  confirmRemovePaper: (deleteClaims: boolean) => Promise<void>
  /** Remove paper dialog state */
  removePaperDialog: RemovePaperDialogState
  /** Close remove paper dialog */
  closeRemovePaperDialog: () => void
  /** Whether a paper operation is in progress */
  isLoading: boolean
}

export function usePaperManagement({
  projectId,
  initialPapers = [],
  onPaperAdded,
  onPaperRemoved,
}: UsePaperManagementOptions): UsePaperManagementReturn {
  const [papers, setPapers] = useState<ProjectPaper[]>(initialPapers)
  const [isLoading, setIsLoading] = useState(false)
  const [removePaperDialog, setRemovePaperDialog] = useState<RemovePaperDialogState>({
    open: false,
    paperId: '',
    paperTitle: '',
    claimCount: 0,
  })

  const addPaper = useCallback(async (paperId: string, title: string) => {
    if (!projectId) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/editor/papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, paperId }),
      })

      const data = await response.json()

      if (response.status === 409) {
        toast.info('Paper already in project')
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add paper')
      }

      setPapers(prev => [...prev, data.paper])

      toast.success('Paper added to project', {
        description: title.slice(0, 50) + (title.length > 50 ? '...' : ''),
        action: onPaperAdded ? {
          label: 'Re-analyze',
          onClick: onPaperAdded,
        } : undefined,
      })
    } catch (error) {
      console.error('Error adding paper:', error)
      toast.error('Failed to add paper')
    } finally {
      setIsLoading(false)
    }
  }, [projectId, onPaperAdded])

  const removePaper = useCallback((paperId: string, claimCount: number) => {
    const paper = papers.find(p => p.id === paperId)
    if (!paper) return

    setRemovePaperDialog({
      open: true,
      paperId,
      paperTitle: paper.title,
      claimCount,
    })
  }, [papers])

  const confirmRemovePaper = useCallback(async (deleteClaims: boolean) => {
    if (!projectId) return

    const { paperId } = removePaperDialog

    setIsLoading(true)
    try {
      const response = await fetch(
        `/api/editor/papers?projectId=${projectId}&paperId=${paperId}&deleteClaims=${deleteClaims}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        throw new Error('Failed to remove paper')
      }

      const data = await response.json()

      setPapers(prev => prev.filter(p => p.id !== paperId))

      if (deleteClaims) {
        onPaperRemoved?.(paperId)
      }

      toast.success('Paper removed', {
        description: data.claimsDeleted > 0 ? `${data.claimsDeleted} claims also removed` : undefined,
      })
    } catch (error) {
      console.error('Error removing paper:', error)
      toast.error('Failed to remove paper')
    } finally {
      setIsLoading(false)
      setRemovePaperDialog({ open: false, paperId: '', paperTitle: '', claimCount: 0 })
    }
  }, [projectId, removePaperDialog, onPaperRemoved])

  const closeRemovePaperDialog = useCallback(() => {
    setRemovePaperDialog(prev => ({ ...prev, open: false }))
  }, [])

  return {
    papers,
    setPapers,
    addPaper,
    removePaper,
    confirmRemovePaper,
    removePaperDialog,
    closeRemovePaperDialog,
    isLoading,
  }
}
