/**
 * useVersionHistory - Hook for managing document version history
 * 
 * Provides:
 * - Fetching version list for a project (with stale-while-revalidate caching)
 * - Getting full version content
 * - Restoring versions
 * - Creating manual save points
 */

import { useState, useCallback, useRef } from 'react'

export interface Version {
  id: string
  created_at: string
  word_count: number | null
  trigger_type: 'auto' | 'manual' | 'restore'
  label: string | null
}

export interface VersionWithContent extends Version {
  content: string
  project_id: string
}

/** How long (ms) before cached versions are considered stale */
const STALE_MS = 30_000

interface UseVersionHistoryReturn {
  /** List of versions (without content) */
  versions: Version[]
  /** Loading state */
  isLoading: boolean
  /** Error message if any */
  error: string | null
  /** Fetch versions for the project (skips if cache is fresh) */
  fetchVersions: () => Promise<void>
  /** Get full content of a specific version */
  getVersionContent: (versionId: string) => Promise<VersionWithContent | null>
  /** Restore a version (returns the restored content) */
  restoreVersion: (versionId: string) => Promise<string | null>
  /** Create a manual save point with optional label */
  createSavePoint: (label?: string) => Promise<boolean>
  /** Delete a specific version */
  deleteVersion: (versionId: string) => Promise<boolean>
  /** Clear error state */
  clearError: () => void
}

export function useVersionHistory(projectId: string | undefined): UseVersionHistoryReturn {
  const [versions, setVersions] = useState<Version[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cache timing — skip network calls when data is fresh
  const lastFetchedAtRef = useRef(0)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  /**
   * Fetch versions from the API.
   * @param force — bypass the stale check (used after mutations)
   */
  const fetchVersionsInner = useCallback(async (force: boolean) => {
    if (!projectId) return

    // Skip if cache is fresh and this isn't a forced refresh
    if (!force && Date.now() - lastFetchedAtRef.current < STALE_MS) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/editor/versions?projectId=${projectId}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch versions')
      }

      setVersions(data.versions || [])
      lastFetchedAtRef.current = Date.now()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch versions'
      setError(message)
      console.error('Failed to fetch versions:', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  /** Public fetch — respects the stale cache window */
  const fetchVersions = useCallback(() => fetchVersionsInner(false), [fetchVersionsInner])

  /** Force-refresh after a mutation */
  const forceRefresh = useCallback(() => fetchVersionsInner(true), [fetchVersionsInner])

  const getVersionContent = useCallback(async (versionId: string): Promise<VersionWithContent | null> => {
    if (!projectId) return null

    try {
      const res = await fetch(`/api/editor/versions/${versionId}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch version content')
      }

      return data.version
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch version content'
      setError(message)
      console.error('Failed to fetch version content:', err)
      return null
    }
  }, [projectId])

  const restoreVersion = useCallback(async (versionId: string): Promise<string | null> => {
    if (!projectId) return null

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/editor/versions/${versionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to restore version')
      }

      // Force-refresh after mutation
      await forceRefresh()

      return data.restoredContent
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore version'
      setError(message)
      console.error('Failed to restore version:', err)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [projectId, forceRefresh])

  const createSavePoint = useCallback(async (label?: string): Promise<boolean> => {
    if (!projectId) return false

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/editor/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, label }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create save point')
      }

      // Force-refresh after mutation
      await forceRefresh()

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create save point'
      setError(message)
      console.error('Failed to create save point:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [projectId, forceRefresh])

  const deleteVersion = useCallback(async (versionId: string): Promise<boolean> => {
    if (!projectId) return false

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/editor/versions/${versionId}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete version')
      }

      // Force-refresh after mutation
      await forceRefresh()

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete version'
      setError(message)
      console.error('Failed to delete version:', err)
      return false
    } finally {
      setIsLoading(false)
    }
  }, [projectId, forceRefresh])

  return {
    versions,
    isLoading,
    error,
    fetchVersions,
    getVersionContent,
    restoreVersion,
    createSavePoint,
    deleteVersion,
    clearError,
  }
}
