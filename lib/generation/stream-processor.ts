import 'server-only'
import { 
  parseCitationPlaceholders, 
  replacePlaceholders, 
  extractUniquePlaceholders,
  type PlaceholderCitation 
} from '@/lib/citations/placeholder-schema'

/**
 * Stream Post-Processor for Citation Placeholders
 * 
 * Buffers sentences, collects tokens, calls batch API, and replaces inline
 * to reduce per-citation RTT during generation streaming.
 */

interface StreamProcessorOptions {
  projectId: string
  batchSize?: number // Number of placeholders to batch together
  sentenceBufferSize?: number // Number of sentences to buffer before processing
  flushTimeoutMs?: number // Max time to wait before flushing buffer
}

interface ProcessedChunk {
  text: string
  hasPlaceholders: boolean
  unresolvedCount: number
}

export class CitationStreamProcessor {
  private projectId: string
  private batchSize: number
  private sentenceBufferSize: number
  private flushTimeoutMs: number
  
  private buffer: string = ''
  private pendingPlaceholders: Set<string> = new Set()
  private resolvedCitations: Record<string, string> = {}
  private flushTimeout: any | null = null
  
  constructor(options: StreamProcessorOptions) {
    this.projectId = options.projectId
    this.batchSize = options.batchSize || 10
    this.sentenceBufferSize = options.sentenceBufferSize || 3
    this.flushTimeoutMs = options.flushTimeoutMs || 2000
  }

  /**
   * Process incoming text chunk from stream
   * Returns processed text with resolved citations
   */
  async processChunk(chunk: string): Promise<ProcessedChunk> {
    // Add chunk to buffer
    this.buffer += chunk
    
    // Extract sentences from buffer
    const sentences = this.extractCompleteSentences()
    
    if (sentences.length === 0) {
      // No complete sentences yet, just return empty
      return { text: '', hasPlaceholders: false, unresolvedCount: 0 }
    }
    
    // Check if we have enough sentences to process or if timeout reached
    const shouldFlush = sentences.length >= this.sentenceBufferSize || 
                       this.shouldForceFlush()
    
    if (!shouldFlush) {
      // Not ready to flush yet
      this.scheduleFlush()
      return { text: '', hasPlaceholders: false, unresolvedCount: 0 }
    }
    
    // Process the sentences
    return await this.processSentences(sentences)
  }

  /**
   * Force flush all remaining content (call at stream end)
   */
  async flush(): Promise<ProcessedChunk> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }
    
    if (this.buffer.length === 0) {
      return { text: '', hasPlaceholders: false, unresolvedCount: 0 }
    }
    
    // Process any remaining content
    const remainingText = this.buffer
    this.buffer = ''
    
    return await this.processText(remainingText)
  }

  /**
   * Extract complete sentences from buffer
   */
  private extractCompleteSentences(): string[] {
    const sentenceEnders = /[.!?]+\s+/g
    const matches = Array.from(this.buffer.matchAll(sentenceEnders))
    
    if (matches.length === 0) {
      return []
    }
    
    // Get text up to the last sentence boundary
    const lastMatch = matches[matches.length - 1]
    const cutPoint = lastMatch.index! + lastMatch[0].length
    
    const sentences = this.buffer.slice(0, cutPoint)
    this.buffer = this.buffer.slice(cutPoint)
    
    return sentences.split(sentenceEnders).filter(s => s.trim().length > 0)
  }

  /**
   * Process a batch of sentences
   */
  private async processSentences(sentences: string[]): Promise<ProcessedChunk> {
    const text = sentences.join(' ')
    return await this.processText(text)
  }

  /**
   * Process text and resolve citations
   */
  private async processText(text: string): Promise<ProcessedChunk> {
    // Find all citation placeholders in the text
    const placeholders = extractUniquePlaceholders(text)
    
    if (placeholders.length === 0) {
      // No placeholders, return text as-is
      return { text, hasPlaceholders: false, unresolvedCount: 0 }
    }
    
    // Separate new placeholders from already resolved ones
    const newPlaceholders = placeholders.filter(p => {
      const key = `${p.type}:${p.value}`
      return !this.resolvedCitations[key] && !this.pendingPlaceholders.has(key)
    })
    
    // Mark new placeholders as pending
    newPlaceholders.forEach(p => {
      const key = `${p.type}:${p.value}`
      this.pendingPlaceholders.add(key)
    })
    
    // Batch resolve new placeholders if we have enough or if forced
    if (newPlaceholders.length >= this.batchSize || this.shouldForceFlush()) {
      await this.batchResolvePlaceholders(newPlaceholders)
    }
    
    // Replace resolved placeholders in text
    const { text: processedText, unresolvedCount } = replacePlaceholders(
      text, 
      this.resolvedCitations
    )
    
    return {
      text: processedText,
      hasPlaceholders: placeholders.length > 0,
      unresolvedCount
    }
  }

  /**
   * Batch resolve placeholders using CitationService directly
   */
  private async batchResolvePlaceholders(placeholders: PlaceholderCitation[]): Promise<void> {
    if (placeholders.length === 0) return
    
    try {
      // Use CitationService directly instead of API call (server-side)
      const { CitationService } = await import('@/lib/citations/immediate-bibliography')
      
      // Process all placeholders in parallel
      const results = await Promise.allSettled(
        placeholders.map(async (placeholder) => {
          const sourceRef = {
            ...(placeholder.type === 'doi' && { doi: placeholder.value }),
            ...(placeholder.type === 'paperId' && { paperId: placeholder.value }),
            ...(placeholder.type === 'title' && { title: placeholder.value }),
            ...(placeholder.type === 'url' && { url: placeholder.value })
          }

          const result = await CitationService.add({
            projectId: this.projectId,
            sourceRef,
            reason: placeholder.context || 'stream generation',
            quote: null
          })

          return {
            key: `${placeholder.type}:${placeholder.value}`,
            citeKey: result.citeKey
          }
        })
      )

      // Update resolved citations map
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          this.resolvedCitations[result.value.key] = result.value.citeKey
          this.pendingPlaceholders.delete(result.value.key)
        }
      })

      // Remove failed ones from pending
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const placeholder = placeholders[index]
          const key = `${placeholder.type}:${placeholder.value}`
          this.pendingPlaceholders.delete(key)
        }
      })
      
    } catch (error) {
      console.error('Batch citation resolution failed:', error)
      
      // Remove from pending on error so we don't block indefinitely
      placeholders.forEach(p => {
        const key = `${p.type}:${p.value}`
        this.pendingPlaceholders.delete(key)
      })
    }
  }

  /**
   * Schedule flush timeout
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) return
    
    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null
      // This would trigger a flush in a real streaming scenario
      // For now, we just clear the timeout
    }, this.flushTimeoutMs)
  }

  /**
   * Check if we should force flush due to timeout or other conditions
   */
  private shouldForceFlush(): boolean {
    // Force flush if we have too many pending placeholders
    return this.pendingPlaceholders.size >= this.batchSize * 2
  }

  /**
   * Get current buffer state (for debugging)
   */
  getState() {
    return {
      bufferLength: this.buffer.length,
      pendingPlaceholders: this.pendingPlaceholders.size,
      resolvedCitations: Object.keys(this.resolvedCitations).length,
      hasFlushTimeout: !!this.flushTimeout
    }
  }

  /**
   * Clear all state (for cleanup)
   */
  clear(): void {
    this.buffer = ''
    this.pendingPlaceholders.clear()
    this.resolvedCitations = {}
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
      this.flushTimeout = null
    }
  }
}

/**
 * Factory function to create stream processor
 */
export function createCitationStreamProcessor(options: StreamProcessorOptions): CitationStreamProcessor {
  return new CitationStreamProcessor(options)
}

/**
 * Helper function to process a complete text with citations
 * (for non-streaming scenarios)
 */
export async function processCitationsInText(
  text: string, 
  projectId: string
): Promise<{ processedText: string; citationCount: number; unresolvedCount: number }> {
  const processor = createCitationStreamProcessor({ projectId })
  
  // Process the entire text
  const result = await processor.processChunk(text)
  const finalResult = await processor.flush()
  
  const processedText = result.text + finalResult.text
  const placeholders = extractUniquePlaceholders(text)
  
  processor.clear()
  
  return {
    processedText,
    citationCount: placeholders.length,
    unresolvedCount: finalResult.unresolvedCount
  }
}