import 'server-only'

/**
 * Evidence Tracker Service
 * 
 * Tracks used evidence across sections to prevent repetition and chunk reuse.
 * Maintains a persistent ledger of paper_id + content hashes that have been used.
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

// In-memory storage (per-project) for now - can be persisted to DB later
const projectLedgers = new Map<string, Map<string, UsedEvidence>>()
let currentProjectId: string | null = null

function getLedger(projectId?: string | null): Map<string, UsedEvidence> {
  const pid = projectId || currentProjectId || '__global__'
  if (!projectLedgers.has(pid)) {
    projectLedgers.set(pid, new Map<string, UsedEvidence>())
  }
  return projectLedgers.get(pid) as Map<string, UsedEvidence>
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
   * Track usage of a piece of evidence in a specific section
   */
  static trackUsage(paperId: string, content: string, sectionTitle: string, projectId?: string): void {
    const contentHash = this.generateContentHash(content)
    const key = `${paperId}:${contentHash}`
    const ledger = getLedger(projectId)
    ledger.set(key, {
      paperId,
      contentHash,
      sectionTitle,
      usageTimestamp: new Date()
    })
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

    // Format for template display
    return entries
      .map(entry => `• ${entry.paperId}: "${entry.contentPreview}" (used in ${entry.sectionTitle})`)
      .join('\n')
  }

  /**
   * Clear the evidence ledger (for testing or project reset)
   */
  static clearLedger(projectId?: string): void {
    if (projectId) {
      projectLedgers.delete(projectId)
      return
    }
    projectLedgers.clear()
    currentProjectId = null
  }

  /**
   * Get usage statistics
   */
  static getUsageStats(projectId?: string): {
    totalUsedChunks: number
    paperIds: string[]
    sectionUsage: Record<string, number>
  } {
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
   * Generate a content hash for deduplication
   */
  private static generateContentHash(content: string): string {
    // Simple hash function - normalize and take first/last 50 chars
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
  static trackBulkUsage<T extends { paper_id?: string; content?: string }>(
    chunks: T[],
    sectionTitle: string,
    projectId?: string
  ): void {
    for (const chunk of chunks) {
      if (chunk.paper_id && chunk.content) {
        this.trackUsage(chunk.paper_id, chunk.content, sectionTitle, projectId)
      }
    }
  }
}
