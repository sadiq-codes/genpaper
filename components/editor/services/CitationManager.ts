/**
 * CitationManager - Centralized citation data management
 * 
 * Features:
 * - Batch loading with request deduplication
 * - Unified caching with style-aware keys
 * - Subscription model for reactive updates
 * - Optimistic updates for immediate feedback
 * - Automatic cache invalidation on style changes
 */

import type { ProjectPaper } from '../types'

// CitationStyle now accepts any CSL style ID string
export type CitationStyle = string

export interface CitationData {
  id: string
  renderedText: string
  paper?: PaperInfo
  status: 'loading' | 'loaded' | 'error'
  error?: string
}

export interface PaperInfo {
  id: string
  title: string
  authors: string[]
  year: number | null
  journal?: string
  doi?: string
}

type Subscriber = (data: CitationData) => void
type BatchCallback = () => void

// Singleton instance
let instance: CitationManager | null = null

export class CitationManager {
  private projectId: string | null = null
  private citationStyle: CitationStyle = 'apa' // Default to APA
  
  // Cache: key = `${paperId}` (style is handled via invalidation)
  private cache = new Map<string, CitationData>()
  
  // Subscribers: paperId -> Set of callbacks
  private subscribers = new Map<string, Set<Subscriber>>()
  
  // Pending requests: paperId -> Promise (for deduplication)
  private pendingRequests = new Map<string, Promise<CitationData>>()
  
  // Batch queue for efficient loading
  private batchQueue = new Set<string>()
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private batchCallbacks: BatchCallback[] = []
  
  // Batch timing configuration
  private readonly BATCH_DELAY = 50 // ms to wait before executing batch
  private readonly BATCH_SIZE = 50 // max citations per batch request

  private constructor() {}

  static getInstance(): CitationManager {
    if (!instance) {
      instance = new CitationManager()
    }
    return instance
  }

  /**
   * Check if manager is configured with a valid project
   */
  isConfigured(): boolean {
    return this.projectId !== null
  }

  /**
   * Configure the manager with project context
   */
  configure(projectId: string | undefined, style: CitationStyle): void {
    const styleChanged = this.citationStyle !== style
    const projectChanged = this.projectId !== projectId
    
    this.projectId = projectId || null
    this.citationStyle = style
    
    // Invalidate cache if style changed
    if (styleChanged) {
      this.invalidateCache()
    }
    
    // Clear everything if project changed
    if (projectChanged) {
      this.cache.clear()
      this.pendingRequests.clear()
    }
  }

  /**
   * Get citation style
   */
  getStyle(): CitationStyle {
    return this.citationStyle
  }

  /**
   * Subscribe to citation updates
   * Returns unsubscribe function
   */
  subscribe(paperId: string, callback: Subscriber): () => void {
    if (!this.subscribers.has(paperId)) {
      this.subscribers.set(paperId, new Set())
    }
    this.subscribers.get(paperId)!.add(callback)
    
    // Immediately call with cached data if available
    const cached = this.cache.get(paperId)
    if (cached) {
      callback(cached)
    }
    
    return () => {
      const subs = this.subscribers.get(paperId)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          this.subscribers.delete(paperId)
        }
      }
    }
  }

  /**
   * Notify all subscribers of a citation update
   */
  private notify(paperId: string, data: CitationData): void {
    const subs = this.subscribers.get(paperId)
    if (subs) {
      subs.forEach(callback => callback(data))
    }
  }

  /**
   * Get citation data (from cache or fetch)
   * Uses batching for efficient network usage
   */
  async getCitation(paperId: string): Promise<CitationData> {
    // Check cache first
    const cached = this.cache.get(paperId)
    if (cached && cached.status === 'loaded') {
      return cached
    }

    // Check if already pending
    const pending = this.pendingRequests.get(paperId)
    if (pending) {
      return pending
    }

    // Add to batch queue
    return this.queueForBatch(paperId)
  }

  /**
   * Queue a citation for batch loading
   */
  private queueForBatch(paperId: string): Promise<CitationData> {
    return new Promise((resolve) => {
      this.batchQueue.add(paperId)
      
      // Set loading state immediately
      const loadingData: CitationData = {
        id: paperId,
        renderedText: '(...)',
        status: 'loading'
      }
      this.cache.set(paperId, loadingData)
      this.notify(paperId, loadingData)
      
      // Store callback to resolve when batch completes
      this.batchCallbacks.push(() => {
        const data = this.cache.get(paperId)
        resolve(data || loadingData)
      })
      
      // Schedule batch execution
      this.scheduleBatch()
    })
  }

  /**
   * Schedule batch execution with debouncing
   */
  private scheduleBatch(): void {
    if (this.batchTimer) return
    
    this.batchTimer = setTimeout(() => {
      this.executeBatch()
    }, this.BATCH_DELAY)
  }

  /**
   * Execute batched citation fetch
   */
  private async executeBatch(): Promise<void> {
    this.batchTimer = null
    
    const paperIds = Array.from(this.batchQueue)
    const callbacks = [...this.batchCallbacks]
    
    this.batchQueue.clear()
    this.batchCallbacks = []
    
    if (paperIds.length === 0) return
    
    // Split into chunks if needed
    const chunks: string[][] = []
    for (let i = 0; i < paperIds.length; i += this.BATCH_SIZE) {
      chunks.push(paperIds.slice(i, i + this.BATCH_SIZE))
    }
    
    // Fetch all chunks in parallel
    await Promise.all(chunks.map(chunk => this.fetchBatch(chunk)))
    
    // Resolve all callbacks
    callbacks.forEach(cb => cb())
  }

  /**
   * Fetch a batch of citations from API
   */
  private async fetchBatch(paperIds: string[]): Promise<void> {
    if (!this.projectId) {
      // No project - set error state for all
      paperIds.forEach(id => {
        const errorData: CitationData = {
          id,
          renderedText: `[${id.slice(0, 8)}...]`,
          status: 'error',
          error: 'No project configured'
        }
        this.cache.set(id, errorData)
        this.notify(id, errorData)
      })
      return
    }

    try {
      // Fetch rendered citations
      const response = await fetch('/api/citations/render-inline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: this.projectId,
          citeKeys: paperIds,
          style: this.citationStyle
        })
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()
      
      // API now returns both rendered text AND paper info in a single response
      // No need for separate fetchPaperInfoBatch call
      const citationsMap = new Map<string, { rendered: string; paper?: PaperInfo }>()
      
      for (const citation of data.data?.citations || []) {
        citationsMap.set(citation.citeKey, {
          rendered: citation.rendered,
          paper: citation.paper ? {
            id: citation.paper.id,
            title: citation.paper.title || 'Untitled',
            authors: citation.paper.authors || [],
            year: citation.paper.year || null,
            journal: citation.paper.journal,
            doi: citation.paper.doi,
          } : undefined
        })
      }

      // Update cache with results (paper info already included from API)
      paperIds.forEach(id => {
        const citationInfo = citationsMap.get(id)
        const rendered = citationInfo?.rendered || `[${id.slice(0, 8)}...]`
        const paper = citationInfo?.paper
        
        const citationData: CitationData = {
          id,
          renderedText: rendered,
          paper,
          status: 'loaded'
        }
        
        this.cache.set(id, citationData)
        this.notify(id, citationData)
      })
    } catch (err) {
      console.error('[CitationManager] Batch fetch failed:', err)
      
      // Set error state for all
      paperIds.forEach(id => {
        const errorData: CitationData = {
          id,
          renderedText: `[${id.slice(0, 8)}...]`,
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load'
        }
        this.cache.set(id, errorData)
        this.notify(id, errorData)
      })
    }
  }

  /**
   * Fetch paper info for multiple papers
   */
  private async fetchPaperInfoBatch(paperIds: string[]): Promise<Map<string, PaperInfo>> {
    const result = new Map<string, PaperInfo>()
    
    // Fetch in parallel with individual requests
    // TODO: Create a batch endpoint for paper info
    await Promise.all(
      paperIds.map(async (id) => {
        try {
          const cached = this.cache.get(id)
          if (cached?.paper) {
            result.set(id, cached.paper)
            return
          }
          
          const res = await fetch(`/api/papers/${id}`)
          if (!res.ok) return
          
          const paper = await res.json()
          const info: PaperInfo = {
            id: paper.id,
            title: paper.title || 'Untitled',
            authors: paper.authors || [],
            year: paper.year || (paper.publication_date ? new Date(paper.publication_date).getFullYear() : null),
            journal: paper.journal || paper.venue,
            doi: paper.doi,
          }
          result.set(id, info)
        } catch {
          // Ignore individual failures
        }
      })
    )
    
    return result
  }

  /**
   * Prefetch citations for a list of paper IDs
   * Call this when loading a document to batch all citations upfront
   */
  async prefetch(paperIds: string[]): Promise<void> {
    // Filter out already cached
    const uncached = paperIds.filter(id => {
      const cached = this.cache.get(id)
      return !cached || cached.status !== 'loaded'
    })
    
    if (uncached.length === 0) return
    
    // Add all to batch queue and execute immediately
    uncached.forEach(id => this.batchQueue.add(id))
    
    // Cancel any pending batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    
    // Execute immediately
    await this.executeBatch()
  }

  /**
   * Invalidate cache (called when style changes)
   */
  private invalidateCache(): void {
    // Keep paper info but clear rendered text
    this.cache.forEach((data, id) => {
      if (data.status === 'loaded') {
        const invalidated: CitationData = {
          ...data,
          renderedText: '(...)',
          status: 'loading'
        }
        this.cache.set(id, invalidated)
        this.notify(id, invalidated)
      }
    })
    
    // Re-fetch all cached citations with new style
    const paperIds = Array.from(this.cache.keys())
    if (paperIds.length > 0) {
      this.prefetch(paperIds)
    }
  }

  /**
   * Get optimistic citation text for immediate display
   * Used when inserting a new citation
   */
  getOptimisticText(paper: ProjectPaper): string {
    const authors = paper.authors || []
    const year = paper.year || 'n.d.'
    
    if (authors.length === 0) {
      return `(${year})`
    }
    
    // Extract last name from first author
    const firstAuthor = authors[0]
    const lastName = firstAuthor.includes(',') 
      ? firstAuthor.split(',')[0].trim()
      : firstAuthor.split(' ').pop() || firstAuthor
    
    if (authors.length === 1) {
      return `(${lastName}, ${year})`
    } else if (authors.length === 2) {
      const secondAuthor = authors[1]
      const lastName2 = secondAuthor.includes(',')
        ? secondAuthor.split(',')[0].trim()
        : secondAuthor.split(' ').pop() || secondAuthor
      return `(${lastName} & ${lastName2}, ${year})`
    } else {
      return `(${lastName} et al., ${year})`
    }
  }

  /**
   * Set optimistic data for a citation (before API confirms)
   */
  setOptimistic(paperId: string, paper: ProjectPaper): void {
    const optimisticData: CitationData = {
      id: paperId,
      renderedText: this.getOptimisticText(paper),
      paper: {
        id: paper.id,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year: paper.year || null,
        journal: paper.journal,
        doi: paper.doi
      },
      status: 'loading' // Still loading real data
    }
    
    this.cache.set(paperId, optimisticData)
    this.notify(paperId, optimisticData)
    
    // Queue for real fetch
    this.queueForBatch(paperId)
  }

  /**
   * Update a citation's CSL JSON and refresh cache
   * Used after editing citation metadata
   */
  async updateCitation(paperId: string, cslJson: {
    title: string
    author: Array<{ family: string; given: string }>
    type: string
    'container-title'?: string
    issued?: { 'date-parts': number[][] }
    DOI?: string
    [key: string]: unknown
  }): Promise<void> {
    if (!this.projectId) {
      throw new Error('CitationManager not configured with a project')
    }

    // Call API to update
    const response = await fetch(`/api/citations/${paperId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: this.projectId,
        csl_json: cslJson
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to update citation')
    }

    // Invalidate this citation from cache to force re-fetch
    this.cache.delete(paperId)
    this.pendingRequests.delete(paperId)

    // Re-fetch the updated citation
    await this.prefetch([paperId])
  }

  /**
   * Invalidate a single citation (force re-fetch on next access)
   */
  invalidateCitation(paperId: string): void {
    this.cache.delete(paperId)
    this.pendingRequests.delete(paperId)
    
    // Notify subscribers that data is stale
    const loadingData: CitationData = {
      id: paperId,
      renderedText: '(...)',
      status: 'loading'
    }
    this.notify(paperId, loadingData)
  }

  /**
   * Clear all data (for cleanup)
   */
  clear(): void {
    this.cache.clear()
    this.pendingRequests.clear()
    this.subscribers.clear()
    this.batchQueue.clear()
    this.batchCallbacks = []
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
  }

  /**
   * Get cache stats for debugging
   */
  getStats(): { cached: number; subscribers: number; pending: number } {
    return {
      cached: this.cache.size,
      subscribers: this.subscribers.size,
      pending: this.batchQueue.size
    }
  }
}

// Export singleton getter
export function getCitationManager(): CitationManager {
  return CitationManager.getInstance()
}
