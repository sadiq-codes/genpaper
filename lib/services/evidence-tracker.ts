import 'server-only'
import { getSB } from '@/lib/supabase/server'

/**
 * Evidence Tracker Service
 * 
 * Tracks used evidence across sections to prevent repetition and chunk reuse.
 * Persists to database for resumable generation and cross-session tracking.
 * 
 * Uses in-memory cache for performance with database persistence for durability.
 */

interface UsedEvidence {
  paperId: string
  contentHash: string
  sectionTitle: string
  usageTimestamp: Date
}

interface EvidenceLedgerEntry {
  paperId: string
  contentHash: string
  sectionTitle: string
  contentPreview: string
}

interface UsageStats {
  totalUsedChunks: number
  paperIds: string[]
  sectionUsage: Record<string, number>
}

// In-memory cache for fast lookups (synced with DB)
// Using WeakRef-like pattern with timestamps for TTL-based cleanup
interface CacheEntry {
  ledger: Map<string, UsedEvidence>
  lastAccessed: number
}

const projectLedgers = new Map<string, CacheEntry>()
let currentProjectId: string | null = null

// Track which projects have been loaded from DB (with timestamps)
const loadedFromDb = new Map<string, number>()

// Pending persistence promises for flush mechanism
// Using Set to track all individual promises (avoids race condition with overwriting)
const pendingPersistence = new Map<string, Set<Promise<void>>>()

// Cache settings
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let cleanupInterval: NodeJS.Timeout | null = null

/**
 * Start the cache cleanup interval (called lazily on first use)
 */
function ensureCleanupInterval(): void {
  if (cleanupInterval) return
  
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    const expiredProjects: string[] = []
    
    for (const [projectId, entry] of projectLedgers) {
      if (now - entry.lastAccessed > CACHE_TTL_MS) {
        expiredProjects.push(projectId)
      }
    }
    
    for (const projectId of expiredProjects) {
      projectLedgers.delete(projectId)
      loadedFromDb.delete(projectId)
      console.log(`🧹 Cleaned up expired cache for project ${projectId}`)
    }
  }, CACHE_CLEANUP_INTERVAL_MS)
  
  // Don't prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }
}

function getLedger(projectId?: string | null): Map<string, UsedEvidence> {
  ensureCleanupInterval()
  const pid = projectId || currentProjectId || '__global__'
  const now = Date.now()
  
  if (!projectLedgers.has(pid)) {
    projectLedgers.set(pid, {
      ledger: new Map<string, UsedEvidence>(),
      lastAccessed: now
    })
  } else {
    // Update last accessed time
    const entry = projectLedgers.get(pid)!
    entry.lastAccessed = now
  }
  
  return projectLedgers.get(pid)!.ledger
}

export class EvidenceTracker {
  /** Set the active project for subsequent operations */
  static setProject(projectId: string | null): void {
    currentProjectId = projectId
  }
  
  /** Get the active project id */
  static getProject(): string | null {
    return currentProjectId
  }
  
  /**
   * Load evidence from database into memory cache
   * Called at start of generation to restore previous state
   */
  static async loadFromDatabase(projectId: string): Promise<void> {
    if (loadedFromDb.has(projectId)) {
      return // Already loaded
    }
    
    try {
      const supabase = await getSB()
      const { data, error } = await supabase
        .from('project_evidence_usage')
        .select('paper_id, content_hash, section_title, created_at')
        .eq('project_id', projectId)
      
      if (error) {
        console.warn('Failed to load evidence from database:', error)
        return
      }
      
      const ledger = getLedger(projectId)
      for (const row of data || []) {
        const key = `${row.paper_id}:${row.content_hash}`
        ledger.set(key, {
          paperId: row.paper_id,
          contentHash: row.content_hash,
          sectionTitle: row.section_title,
          usageTimestamp: new Date(row.created_at)
        })
      }
      
      loadedFromDb.set(projectId, Date.now())
      console.log(`📚 Loaded ${data?.length || 0} evidence entries from database for project ${projectId}`)
    } catch (error) {
      console.warn('Error loading evidence from database:', error)
    }
  }
  
  /**
   * Track usage of a piece of evidence in a specific section
   * Persists to both memory cache and database
   * 
   * Note: Database persistence is tracked for flush() support
   */
  static async trackUsage(
    paperId: string, 
    content: string, 
    sectionTitle: string, 
    projectId?: string
  ): Promise<void> {
    const pid = projectId || currentProjectId
    const contentHash = this.generateContentHash(content)
    const key = `${paperId}:${contentHash}`
    
    // Update in-memory cache
    const ledger = getLedger(pid)
    ledger.set(key, {
      paperId,
      contentHash,
      sectionTitle,
      usageTimestamp: new Date()
    })
    
    // Persist to database with tracking for flush support
    if (pid && pid !== '__global__') {
      const persistPromise = this.persistToDatabase(pid, paperId, contentHash, sectionTitle, content.slice(0, 200))
        .catch(err => console.warn('Failed to persist evidence usage:', err))
      
      // Track the pending promise in a Set (avoids race conditions with multiple concurrent calls)
      let promiseSet = pendingPersistence.get(pid)
      if (!promiseSet) {
        promiseSet = new Set<Promise<void>>()
        pendingPersistence.set(pid, promiseSet)
      }
      promiseSet.add(persistPromise)
      
      // Clean up this specific promise after completion
      persistPromise.finally(() => {
        const currentSet = pendingPersistence.get(pid)
        if (currentSet) {
          currentSet.delete(persistPromise)
          // Clean up empty sets
          if (currentSet.size === 0) {
            pendingPersistence.delete(pid)
          }
        }
      })
    }
  }
  
  /**
   * Flush all pending database writes for a project
   * Call this at end of generation to ensure all evidence is persisted
   */
  static async flush(projectId?: string): Promise<void> {
    const pid = projectId || currentProjectId
    if (!pid) return
    
    const promiseSet = pendingPersistence.get(pid)
    if (promiseSet && promiseSet.size > 0) {
      await Promise.all(promiseSet)
    }
  }
  
  /**
   * Flush all pending database writes across all projects
   */
  static async flushAll(): Promise<void> {
    const allPromises: Promise<void>[] = []
    for (const promiseSet of pendingPersistence.values()) {
      allPromises.push(...promiseSet)
    }
    await Promise.all(allPromises)
  }
  
  /**
   * Track usage synchronously (for backward compatibility)
   * Use trackUsage for new code
   */
  static trackUsageSync(
    paperId: string, 
    content: string, 
    sectionTitle: string, 
    projectId?: string
  ): void {
    const pid = projectId || currentProjectId
    const contentHash = this.generateContentHash(content)
    const key = `${paperId}:${contentHash}`
    
    // Update in-memory cache only
    const ledger = getLedger(pid)
    ledger.set(key, {
      paperId,
      contentHash,
      sectionTitle,
      usageTimestamp: new Date()
    })
  }
  
  /**
   * Persist evidence to database
   */
  private static async persistToDatabase(
    projectId: string,
    paperId: string,
    contentHash: string,
    sectionTitle: string,
    contentPreview: string
  ): Promise<void> {
    try {
      const supabase = await getSB()
      await supabase.rpc('track_evidence_usage', {
        p_project_id: projectId,
        p_paper_id: paperId,
        p_content_hash: contentHash,
        p_section_title: sectionTitle,
        p_content_preview: contentPreview
      })
    } catch (error) {
      // Log but don't throw - we have in-memory cache as backup
      console.warn('Database evidence tracking failed:', error)
    }
  }

  /**
   * Check if a piece of evidence has already been used
   */
  static isAlreadyUsed(paperId: string, content: string, projectId?: string): boolean {
    const contentHash = this.generateContentHash(content)
    const key = `${paperId}:${contentHash}`
    return getLedger(projectId).has(key)
  }
  
  /**
   * Check if evidence is used (async version that checks database if needed)
   */
  static async isAlreadyUsedAsync(
    paperId: string, 
    content: string, 
    projectId?: string
  ): Promise<boolean> {
    const pid = projectId || currentProjectId
    
    // First check memory cache
    if (this.isAlreadyUsed(paperId, content, pid || undefined)) {
      return true
    }
    
    // If not in cache and we have a project ID, check database
    if (pid && pid !== '__global__') {
      try {
        const supabase = await getSB()
        const contentHash = this.generateContentHash(content)
        const { data } = await supabase.rpc('is_evidence_used', {
          p_project_id: pid,
          p_paper_id: paperId,
          p_content_hash: contentHash
        })
        return data === true
      } catch {
        return false
      }
    }
    
    return false
  }

  /**
   * Filter out already-used evidence from a list of chunks
   */
  static filterUnusedEvidence<T extends { paper_id?: string; content?: string }>(
    chunks: T[],
    projectId?: string
  ): T[] {
    return chunks.filter(chunk => {
      if (!chunk.paper_id || !chunk.content) return true
      return !this.isAlreadyUsed(chunk.paper_id, chunk.content, projectId)
    })
  }

  /**
   * Get formatted ledger for template usage
   */
  static getFormattedLedger(projectId?: string): string {
    const ledger = getLedger(projectId)
    if (ledger.size === 0) {
      return ''
    }

    const entries: EvidenceLedgerEntry[] = []
    for (const [key, evidence] of ledger) {
      entries.push({
        paperId: evidence.paperId,
        contentHash: evidence.contentHash,
        sectionTitle: evidence.sectionTitle,
        contentPreview: key.split(':').slice(1).join(':').substring(0, 100) + '...'
      })
    }

    return entries
      .map(entry => `• ${entry.paperId}: "${entry.contentPreview}" (used in ${entry.sectionTitle})`)
      .join('\n')
  }

  /**
   * Clear the evidence ledger (for testing or project reset)
   * Clears both memory cache and database
   */
  static async clearLedger(projectId?: string): Promise<void> {
    // Wait for pending persistence first
    if (projectId) {
      await this.flush(projectId)
    } else {
      await this.flushAll()
    }
    
    // Clear memory cache
    if (projectId) {
      projectLedgers.delete(projectId)
      loadedFromDb.delete(projectId)
      pendingPersistence.delete(projectId)
      
      // Clear database
      try {
        const supabase = await getSB()
        await supabase.rpc('clear_project_evidence', { p_project_id: projectId })
      } catch (error) {
        console.warn('Failed to clear evidence from database:', error)
      }
    } else {
      projectLedgers.clear()
      loadedFromDb.clear()
      pendingPersistence.clear()
      currentProjectId = null
    }
  }
  
  /**
   * Clear ledger synchronously (memory only, for backward compatibility)
   */
  static clearLedgerSync(projectId?: string): void {
    if (projectId) {
      projectLedgers.delete(projectId)
      loadedFromDb.delete(projectId)
      pendingPersistence.delete(projectId)
    } else {
      projectLedgers.clear()
      loadedFromDb.clear()
      pendingPersistence.clear()
      currentProjectId = null
    }
  }
  
  /**
   * Get cache statistics for monitoring
   */
  static getCacheStats(): { 
    projectCount: number
    totalEntries: number
    pendingWrites: number 
  } {
    let totalEntries = 0
    for (const entry of projectLedgers.values()) {
      totalEntries += entry.ledger.size
    }
    return {
      projectCount: projectLedgers.size,
      totalEntries,
      pendingWrites: pendingPersistence.size
    }
  }

  /**
   * Get usage statistics
   */
  static getUsageStats(projectId?: string): UsageStats {
    const paperIds = new Set<string>()
    const sectionUsage: Record<string, number> = {}
    const ledger = getLedger(projectId)
    
    for (const evidence of ledger.values()) {
      paperIds.add(evidence.paperId)
      sectionUsage[evidence.sectionTitle] = (sectionUsage[evidence.sectionTitle] || 0) + 1
    }

    return {
      totalUsedChunks: ledger.size,
      paperIds: Array.from(paperIds),
      sectionUsage
    }
  }
  
  /**
   * Get usage statistics from database (for persistence verification)
   */
  static async getUsageStatsFromDb(projectId: string): Promise<UsageStats | null> {
    try {
      const supabase = await getSB()
      const { data, error } = await supabase.rpc('get_evidence_stats', {
        p_project_id: projectId
      })
      
      if (error || !data || data.length === 0) {
        return null
      }
      
      const stats = data[0]
      return {
        totalUsedChunks: stats.total_used || 0,
        paperIds: [], // Not returned by RPC, would need additional query
        sectionUsage: stats.section_usage || {}
      }
    } catch {
      return null
    }
  }

  /**
   * Generate a content hash for deduplication
   */
  private static generateContentHash(content: string): string {
    const normalized = content
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
    
    if (normalized.length <= 100) {
      return normalized
    }
    
    return normalized.substring(0, 50) + '::' + normalized.substring(normalized.length - 50)
  }

  /**
   * Track evidence usage from a list of chunks after they're used
   */
  static async trackBulkUsage<T extends { paper_id?: string; content?: string }>(
    chunks: T[],
    sectionTitle: string,
    projectId?: string
  ): Promise<void> {
    const trackPromises = chunks
      .filter(chunk => chunk.paper_id && chunk.content)
      .map(chunk => 
        this.trackUsage(chunk.paper_id!, chunk.content!, sectionTitle, projectId)
      )
    
    await Promise.all(trackPromises)
  }
  
  /**
   * Track evidence usage synchronously (for backward compatibility)
   */
  static trackBulkUsageSync<T extends { paper_id?: string; content?: string }>(
    chunks: T[],
    sectionTitle: string,
    projectId?: string
  ): void {
    for (const chunk of chunks) {
      if (chunk.paper_id && chunk.content) {
        this.trackUsageSync(chunk.paper_id, chunk.content, sectionTitle, projectId)
      }
    }
  }
}
