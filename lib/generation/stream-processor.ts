import 'server-only'
import { parseCitationPlaceholders, replacePlaceholders, type PlaceholderCitation } from '@/lib/citations/placeholder-schema'
import { isBatchedCitationsEnabled } from '@/lib/config/feature-flags'

/**
 * Stream Post-Processor
 * 
 * Buffers sentence chunks and replaces placeholders in streamed text using batch map.
 * Reduces visible latency vs per-citation calls by batching resolution.
 */

export interface StreamChunk {
  type: 'text' | 'citation' | 'placeholder' | 'error' | 'warning' | 'fallback'
  content: string
  metadata?: Record<string, any>
}

export interface ProcessorState {
  pendingText: string
  bufferedSentences: string[]
  placeholders: PlaceholderCitation[]
  totalSentences: number
  isFinalized: boolean
}

export interface BatchResolutionResult {
  citeKeyMap: Record<string, string>
  resolvedCount: number
  unresolvedCount: number
}

export class StreamProcessor {
  private state: ProcessorState
  private projectId: string
  private sentenceEndPattern = /([.!?])\s+(?=[A-Z])/g
  private errorCount = 0
  private maxErrors = 5
  private retryAttempts = 0
  private maxRetries = 2
  
  constructor(projectId: string, options?: { maxErrors?: number; maxRetries?: number }) {
    this.projectId = projectId
    this.maxErrors = options?.maxErrors || 5
    this.maxRetries = options?.maxRetries || 2
    this.state = {
      pendingText: '',
      bufferedSentences: [],
      placeholders: [],
      totalSentences: 0,
      isFinalized: false
    }
  }

  /**
   * Process incoming text delta and extract sentences with error handling
   */
  processTextDelta(textDelta: string): StreamChunk[] {
    if (this.state.isFinalized) {
      return []
    }

    try {
      this.state.pendingText += textDelta
      const chunks: StreamChunk[] = []

      // Check for excessive buffer size (backpressure protection)
      if (this.state.pendingText.length > 10000) {
        chunks.push({
          type: 'warning',
          content: '',
          metadata: { 
            message: 'Large buffer detected, processing partial content',
            bufferSize: this.state.pendingText.length 
          }
        })
        // Force process what we have
        this.state.bufferedSentences.push(this.state.pendingText.trim())
        this.state.pendingText = ''
        this.state.totalSentences++
      }

      // Extract complete sentences with safety limits
      let match
      let safetyCounter = 0
      const maxIterations = 100
      
      while ((match = this.sentenceEndPattern.exec(this.state.pendingText)) && safetyCounter < maxIterations) {
        safetyCounter++
        const sentence = this.state.pendingText.slice(0, match.index + 1).trim()
        this.state.pendingText = this.state.pendingText.slice(match.index + 1).trim()
        
        if (sentence.length > 0) {
          this.state.bufferedSentences.push(sentence)
          this.state.totalSentences++
          
          // Check if batch processing is enabled
          if (isBatchedCitationsEnabled()) {
            try {
              // Buffer sentences with placeholders for batch processing
              const sentencePlaceholders = parseCitationPlaceholders(sentence)
              if (sentencePlaceholders.length > 0) {
                this.state.placeholders.push(...sentencePlaceholders)
                chunks.push({
                  type: 'placeholder',
                  content: sentence,
                  metadata: { placeholders: sentencePlaceholders.length }
                })
              } else {
                chunks.push({
                  type: 'text',
                  content: sentence
                })
              }
            } catch (parseError) {
              this.errorCount++
              chunks.push({
                type: 'warning',
                content: sentence, // Still emit the content
                metadata: { 
                  message: 'Placeholder parsing failed',
                  error: parseError instanceof Error ? parseError.message : 'Parse error'
                }
              })
            }
          } else {
            // Immediate streaming for non-batched mode
            chunks.push({
              type: 'text',
              content: sentence
            })
          }
        }
        
        // Reset regex lastIndex to avoid infinite loops
        this.sentenceEndPattern.lastIndex = 0
      }

      // Check if we hit safety limits
      if (safetyCounter >= maxIterations) {
        chunks.push({
          type: 'warning',
          content: '',
          metadata: { 
            message: 'Sentence parsing safety limit reached',
            processedSentences: safetyCounter 
          }
        })
      }

      return chunks

    } catch (error) {
      this.errorCount++
      console.error('Stream processing error:', error)
      
      return [{
        type: 'error',
        content: '',
        metadata: {
          message: 'Stream processing failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          errorCount: this.errorCount
        }
      }]
    }
  }

  /**
   * Process citation tool calls (immediate mode)
   */
  processCitationTool(toolCall: any): StreamChunk {
    return {
      type: 'citation',
      content: '',
      metadata: {
        paperId: toolCall.args?.paper_id,
        formatted: toolCall.result?.formatted_citation,
        citationNumber: toolCall.result?.citation_number
      }
    }
  }

  /**
   * Finalize stream and process any remaining content
   */
  async finalize(): Promise<StreamChunk[]> {
    if (this.state.isFinalized) {
      return []
    }

    this.state.isFinalized = true
    const chunks: StreamChunk[] = []

    // Add any remaining pending text as final sentence
    if (this.state.pendingText.trim().length > 0) {
      this.state.bufferedSentences.push(this.state.pendingText.trim())
      this.state.totalSentences++
    }

    // Process batch citations if enabled
    if (isBatchedCitationsEnabled() && this.state.placeholders.length > 0) {
      try {
        const batchResult = await this.resolvePlaceholdersBatch()
        
        // Rewrite all buffered sentences with resolved citations
        const processedSentences = this.state.bufferedSentences.map(sentence => {
          const result = replacePlaceholders(sentence, batchResult.citeKeyMap)
          return result.text
        })

        // Emit processed content
        for (const sentence of processedSentences) {
          chunks.push({
            type: 'text',
            content: sentence,
            metadata: { processed: true }
          })
        }

        // Emit batch resolution summary
        chunks.push({
          type: 'citation',
          content: '',
          metadata: {
            batchResolution: true,
            resolved: batchResult.resolvedCount,
            unresolved: batchResult.unresolvedCount,
            total: this.state.placeholders.length
          }
        })

      } catch (error) {
        console.error('Batch resolution failed during finalization:', error)
        this.errorCount++
        
        // Emit warning event first
        chunks.push({
          type: 'warning',
          content: '',
          metadata: {
            message: 'Citation batch resolution failed, using fallbacks',
            error: error instanceof Error ? error.message : 'Unknown error',
            placeholderCount: this.state.placeholders.length
          }
        })
        
        // Emit content with graceful fallback citations
        const fallbackSentences = this.state.bufferedSentences.map(sentence => {
          // Extract author/year info from placeholders when possible
          return sentence.replace(/\[\[CITE:([^:]+):([^\]]+)\]\]/g, (match, type, value) => {
            if (type === 'paperId') {
              return '(Source, n.d.)'
            } else if (type === 'doi') {
              return `(DOI: ${value.slice(0, 20)}...)`
            } else {
              return `(${value.slice(0, 30)}...)`
            }
          })
        })

        for (const sentence of fallbackSentences) {
          chunks.push({
            type: 'fallback',
            content: sentence,
            metadata: { 
              fallback: true,
              originalPlaceholders: this.state.placeholders.length 
            }
          })
        }

        // Only emit error if we've exceeded max errors
        if (this.errorCount >= this.maxErrors) {
          chunks.push({
            type: 'error',
            content: '',
            metadata: {
              message: 'Maximum errors exceeded, stream may be unstable',
              errorCount: this.errorCount,
              maxErrors: this.maxErrors
            }
          })
        }
      }
    } else {
      // No batch processing needed, emit buffered content as-is
      for (const sentence of this.state.bufferedSentences) {
        chunks.push({
          type: 'text',
          content: sentence
        })
      }
    }

    return chunks
  }

  /**
   * Get current processing state
   */
  getState(): Readonly<ProcessorState> {
    return { ...this.state }
  }

  /**
   * Get processing metrics
   */
  getMetrics() {
    return {
      totalSentences: this.state.totalSentences,
      bufferedSentences: this.state.bufferedSentences.length,
      pendingCharacters: this.state.pendingText.length,
      placeholderCount: this.state.placeholders.length,
      isFinalized: this.state.isFinalized
    }
  }

  /**
   * Resolve placeholders via batch API with retry logic
   */
  private async resolvePlaceholdersBatch(): Promise<BatchResolutionResult> {
    if (this.state.placeholders.length === 0) {
      return { citeKeyMap: {}, resolvedCount: 0, unresolvedCount: 0 }
    }

    // Deduplicate placeholders
    const uniquePlaceholders = this.deduplicatePlaceholders(this.state.placeholders)

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

        const response = await fetch('/api/citations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: this.projectId,
            refs: uniquePlaceholders
          }),
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          throw new Error(`Batch API failed: ${response.status} - ${errorText}`)
        }

        const data = await response.json()
        const citeKeyMap = data.citeKeyMap || {}
        
        const resolvedCount = Object.keys(citeKeyMap).length
        const unresolvedCount = uniquePlaceholders.length - resolvedCount

        return { citeKeyMap, resolvedCount, unresolvedCount }

      } catch (error) {
        console.error(`Batch citation resolution attempt ${attempt + 1} failed:`, error)
        this.retryAttempts = attempt
        
        if (attempt === this.maxRetries) {
          // Final attempt failed, create fallback map
          const fallbackMap: Record<string, string> = {}
          for (const placeholder of uniquePlaceholders) {
            const key = `${placeholder.type}:${placeholder.value}`
            fallbackMap[key] = placeholder.fallbackText || this.generateFallbackCitation(placeholder)
          }
          
          return {
            citeKeyMap: fallbackMap,
            resolvedCount: 0,
            unresolvedCount: uniquePlaceholders.length
          }
        }
        
        // Wait before retry with exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000)
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error('Batch resolution retry logic failed unexpectedly')
  }

  /**
   * Generate a fallback citation when resolution fails
   */
  private generateFallbackCitation(placeholder: PlaceholderCitation): string {
    switch (placeholder.type) {
      case 'paperId':
        return '(Source, n.d.)'
      case 'doi':
        return `(DOI: ${placeholder.value.slice(0, 20)}...)`
      case 'title':
        return `(${placeholder.value.slice(0, 30)}...)`
      case 'url':
        return '(Web source)'
      default:
        return '(Citation unavailable)'
    }
  }

  /**
   * Remove duplicate placeholders based on type:value combination
   */
  private deduplicatePlaceholders(placeholders: PlaceholderCitation[]): PlaceholderCitation[] {
    const seen = new Set<string>()
    const unique: PlaceholderCitation[] = []

    for (const placeholder of placeholders) {
      const key = `${placeholder.type}:${placeholder.value}`
      if (!seen.has(key)) {
        seen.add(key)
        unique.push(placeholder)
      }
    }

    return unique
  }

  /**
   * Create a simple stream processor for immediate use
   */
  static createSimple(projectId: string): {
    process: (textDelta: string) => string[]
    finalize: () => Promise<string[]>
  } {
    const processor = new StreamProcessor(projectId)
    
    return {
      process: (textDelta: string) => {
        const chunks = processor.processTextDelta(textDelta)
        return chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content)
      },
      finalize: async () => {
        const chunks = await processor.finalize()
        return chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content)
      }
    }
  }
}