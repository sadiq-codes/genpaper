/**
 * usePaperManagement - Manages project papers (add/remove)
 * 
 * Uses React Query for:
 * - Optimistic updates on add/remove
 * - Automatic cache invalidation
 * - Deduplication of requests
 * 
 * Responsibilities:
 * - Papers list state
 * - Adding papers to project
 * - Removing papers from project
 * - Remove confirmation dialog state
 */

import { useState, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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

// API functions
async function addPaperToProject(
  projectId: string, 
  paperId: string
): Promise<{ paper: ProjectPaper; alreadyExists: boolean }> {
  const response = await fetch('/api/editor/papers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, paperId }),
  })

  const data = await response.json()

  if (response.status === 409) {
    return { paper: data.paper, alreadyExists: true }
  }

  if (!response.ok) {
    throw new Error(data.error || 'Failed to add paper')
  }

  return { paper: data.paper, alreadyExists: false }
}

async function removePaperFromProject(
  projectId: string,
  paperId: string,
  deleteClaims: boolean
): Promise<{ claimsDeleted: number }> {
  const response = await fetch(
    `/api/editor/papers?projectId=${projectId}&paperId=${paperId}&deleteClaims=${deleteClaims}`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    throw new Error('Failed to remove paper')
  }

  return response.json()
}

export function usePaperManagement({
  projectId,
  initialPapers = [],
  onPaperAdded,
  onPaperRemoved,
}: UsePaperManagementOptions): UsePaperManagementReturn {
  const queryClient = useQueryClient()
  const [papers, setPapers] = useState<ProjectPaper[]>(initialPapers)
  const [removePaperDialog, setRemovePaperDialog] = useState<RemovePaperDialogState>({
    open: false,
    paperId: '',
    paperTitle: '',
    claimCount: 0,
  })

  // Add paper mutation with optimistic update
  const addPaperMutation = useMutation({
    mutationFn: ({ paperId }: { paperId: string; title: string }) => 
      addPaperToProject(projectId!, paperId),
    onMutate: async ({ paperId, title }) => {
      // Optimistically add a placeholder paper
      const optimisticPaper: ProjectPaper = {
        id: paperId,
        title,
        authors: [],
        year: new Date().getFullYear(),
      }
      
      setPapers(prev => {
        // Check if already exists
        if (prev.some(p => p.id === paperId)) return prev
        return [...prev, optimisticPaper]
      })
      
      return { optimisticPaper }
    },
    onSuccess: (data, { title }) => {
      if (data.alreadyExists) {
        toast.info('Paper already in project')
        return
      }

      // Replace optimistic paper with real data
      setPapers(prev => 
        prev.map(p => p.id === data.paper.id ? data.paper : p)
      )

      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'papers'] })
      queryClient.invalidateQueries({ queryKey: ['library', 'papers'] })

      toast.success('Paper added to project', {
        description: title.slice(0, 50) + (title.length > 50 ? '...' : ''),
        action: onPaperAdded ? {
          label: 'Re-analyze',
          onClick: onPaperAdded,
        } : undefined,
      })
    },
    onError: (error, { paperId }) => {
      // Rollback optimistic update
      setPapers(prev => prev.filter(p => p.id !== paperId))
      console.error('Error adding paper:', error)
      toast.error('Failed to add paper')
    },
  })

  // Remove paper mutation
  const removePaperMutation = useMutation({
    mutationFn: ({ paperId, deleteClaims }: { paperId: string; deleteClaims: boolean }) =>
      removePaperFromProject(projectId!, paperId, deleteClaims),
    onMutate: async ({ paperId }) => {
      // Store current papers for potential rollback
      const previousPapers = papers
      
      // Optimistically remove
      setPapers(prev => prev.filter(p => p.id !== paperId))
      
      return { previousPapers }
    },
    onSuccess: (data, { paperId, deleteClaims }) => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'papers'] })
      
      if (deleteClaims) {
        onPaperRemoved?.(paperId)
      }

      toast.success('Paper removed', {
        description: data.claimsDeleted > 0 ? `${data.claimsDeleted} claims also removed` : undefined,
      })
    },
    onError: (error, _, context) => {
      // Rollback optimistic update
      if (context?.previousPapers) {
        setPapers(context.previousPapers)
      }
      console.error('Error removing paper:', error)
      toast.error('Failed to remove paper')
    },
    onSettled: () => {
      setRemovePaperDialog({ open: false, paperId: '', paperTitle: '', claimCount: 0 })
    },
  })

  const addPaper = useCallback(async (paperId: string, title: string) => {
    if (!projectId) return
    addPaperMutation.mutate({ paperId, title })
  }, [projectId, addPaperMutation])

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
    removePaperMutation.mutate({ paperId, deleteClaims })
  }, [projectId, removePaperDialog, removePaperMutation])

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
    isLoading: addPaperMutation.isPending || removePaperMutation.isPending,
  }
}
