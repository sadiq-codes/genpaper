import 'server-only'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { cosineSimilarity } from './base-retrieval'
import type { RetrievedChunk, PaperMetadata } from './base-retrieval'

/**
 * ContextBuilder - Transforms retrieved chunks into optimized LLM context
 * 
 * Responsibilities:
 * - Chunk compression (sentence-level filtering)
 * - Context formatting for prompts
 * - Token budget management
 * - Section-aware organization
 * 
 * This class does NOT handle:
 * - Retrieval (see ChunkRetriever)
 * - Caching (handled by GenerationContextService)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ContextConfig {
  /** Target token budget for context */
  maxTokens: number
  /** Minimum relevance score for sentences (0-1) */
  sentenceMinScore: number
  /** Whether to compress chunks by filtering sentences */
  enableCompression: boolean
  /** Whether to include source citations in context */
  includeCitations: boolean
  /** Group chunks by paper or interleave by relevance */
  groupByPaper: boolean
  /** Estimated tokens per character (for budget calculation) */
  tokensPerChar: number
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 8000,
  sentenceMinScore: 0.3,
  // DISABLED BY DEFAULT: Compression strips surrounding context needed for natural citations
  // LLM loses ability to paraphrase and synthesize when it only sees isolated sentences
  // Only enable as emergency fallback when context would exceed model limits
  enableCompression: false,
  includeCitations: true,
  groupByPaper: false,
  tokensPerChar: 0.25 // ~4 chars per token for English
}

export interface CompressedChunk extends RetrievedChunk {
  /** Original content before compression */
  originalContent: string
  /** Sentences that passed relevance filter */
  relevantSentences: string[]
  /** Compression ratio (compressed/original) */
  compressionRatio: number
}

export interface BuiltContext {
  /** Formatted context string for LLM */
  formattedContext: string
  /** Chunks included in context */
  chunks: RetrievedChunk[]
  /** Estimated token count */
  estimatedTokens: number
  /** Was compression applied */
  wasCompressed: boolean
  /** Metrics about context building */
  metrics: {
    originalChunks: number
    includedChunks: number
    originalSentences: number
    includedSentences: number
    compressionRatio: number
  }
}

export interface SectionContext {
  sectionKey: string
  sectionTitle: string
  keyPoints: string[]
  context: BuiltContext
}

// =============================================================================
// CONTEXT BUILDER CLASS
// =============================================================================

export class ContextBuilder {
  private config: ContextConfig
  
  constructor(config?: Partial<ContextConfig>) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  }
  
  /**
   * Build optimized context from retrieved chunks.
   */
  async buildContext(
    chunks: RetrievedChunk[],
    query: string,
    papers: Map<string, PaperMetadata>,
    config?: Partial<ContextConfig>
  ): Promise<BuiltContext> {
    const mergedConfig = { ...this.config, ...config }
    
    if (chunks.length === 0) {
      return this.createEmptyContext()
    }
    
    let processedChunks: RetrievedChunk[] = chunks
    let wasCompressed = false
    let originalSentences = 0
    let includedSentences = 0
    
    // Step 1: Compress chunks if enabled
    if (mergedConfig.enableCompression) {
      const compressed = await this.compressChunks(chunks, query, mergedConfig)
      processedChunks = compressed.chunks
      wasCompressed = true
      originalSentences = compressed.originalSentences
      includedSentences = compressed.includedSentences
    }
    
    // Step 2: Apply token budget
    const budgetedChunks = this.applyTokenBudget(
      processedChunks, 
      mergedConfig.maxTokens,
      mergedConfig.tokensPerChar
    )
    
    // Step 3: Organize chunks
    const organizedChunks = mergedConfig.groupByPaper
      ? this.groupChunksByPaper(budgetedChunks)
      : budgetedChunks
    
    // Step 4: Format for prompt
    const formattedContext = this.formatContext(
      organizedChunks, 
      papers, 
      mergedConfig.includeCitations
    )
    
    const estimatedTokens = Math.ceil(formattedContext.length * mergedConfig.tokensPerChar)
    
    return {
      formattedContext,
      chunks: organizedChunks,
      estimatedTokens,
      wasCompressed,
      metrics: {
        originalChunks: chunks.length,
        includedChunks: organizedChunks.length,
        originalSentences,
        includedSentences,
        compressionRatio: wasCompressed && originalSentences > 0 
          ? includedSentences / originalSentences 
          : 1.0
      }
    }
  }
  
  /**
   * Build context for multiple sections with shared token budget.
   */
  async buildSectionContexts(
    sections: Array<{
      sectionKey: string
      sectionTitle: string
      keyPoints: string[]
      chunks: RetrievedChunk[]
    }>,
    papers: Map<string, PaperMetadata>,
    totalTokenBudget: number,
    config?: Partial<ContextConfig>
  ): Promise<SectionContext[]> {
    const mergedConfig = { ...this.config, ...config }
    
    // Distribute token budget across sections
    const perSectionBudget = Math.floor(totalTokenBudget / sections.length)
    
    const sectionContexts: SectionContext[] = []
    
    for (const section of sections) {
      // Build query from section info
      const sectionQuery = `${section.sectionTitle}: ${section.keyPoints.join('. ')}`
      
      const context = await this.buildContext(
        section.chunks,
        sectionQuery,
        papers,
        { ...mergedConfig, maxTokens: perSectionBudget }
      )
      
      sectionContexts.push({
        sectionKey: section.sectionKey,
        sectionTitle: section.sectionTitle,
        keyPoints: section.keyPoints,
        context
      })
    }
    
    return sectionContexts
  }
  
  // ===========================================================================
  // COMPRESSION METHODS
  // ===========================================================================
  
  /**
   * Compress chunks by filtering out low-relevance sentences.
   */
  private async compressChunks(
    chunks: RetrievedChunk[],
    query: string,
    config: ContextConfig
  ): Promise<{
    chunks: RetrievedChunk[]
    originalSentences: number
    includedSentences: number
  }> {
    // Generate query embedding for sentence comparison
    const [queryEmbedding] = await generateEmbeddings([query])
    
    let totalOriginalSentences = 0
    let totalIncludedSentences = 0
    
    const compressedChunks: RetrievedChunk[] = []
    
    for (const chunk of chunks) {
      const sentences = this.splitIntoSentences(chunk.content)
      totalOriginalSentences += sentences.length
      
      if (sentences.length <= 2) {
        // Don't compress very short chunks
        compressedChunks.push(chunk)
        totalIncludedSentences += sentences.length
        continue
      }
      
      // Score each sentence
      const sentenceScores = await this.scoreSentences(sentences, queryEmbedding)
      
      // Filter by threshold
      const relevantSentences = sentences.filter((_, i) => 
        sentenceScores[i] >= config.sentenceMinScore
      )
      
      if (relevantSentences.length === 0) {
        // Keep at least the highest-scoring sentence
        const maxIdx = sentenceScores.indexOf(Math.max(...sentenceScores))
        relevantSentences.push(sentences[maxIdx])
      }
      
      totalIncludedSentences += relevantSentences.length
      
      // Create compressed chunk
      compressedChunks.push({
        ...chunk,
        content: relevantSentences.join(' '),
        metadata: {
          ...chunk.metadata,
          compressed: true,
          originalLength: chunk.content.length,
          compressionRatio: relevantSentences.length / sentences.length
        }
      })
    }
    
    return {
      chunks: compressedChunks,
      originalSentences: totalOriginalSentences,
      includedSentences: totalIncludedSentences
    }
  }
  
  /**
   * Split text into sentences with proper handling of abbreviations.
   */
  private splitIntoSentences(text: string): string[] {
    // Handle common abbreviations
    const ABBREVIATIONS = [
      'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'vs', 'etc', 'e\\.g', 'i\\.e', 
      'U\\.S', 'Fig', 'No', 'Vol', 'pp', 'al', 'et'
    ]
    const abbrevPattern = ABBREVIATIONS.join('|')
    
    // Split on sentence boundaries, avoiding abbreviations
    const sentencePattern = new RegExp(
      `(?<!(?:${abbrevPattern}))\\.\\s+|[!?]\\s+`,
      'g'
    )
    
    const sentences = text
      .split(sentencePattern)
      .map(s => s.trim())
      .filter(s => s.length > 10) // Filter out very short fragments
    
    return sentences
  }
  
  /**
   * Score sentences by relevance to query using embeddings.
   */
  private async scoreSentences(
    sentences: string[],
    queryEmbedding: number[]
  ): Promise<number[]> {
    if (sentences.length === 0) return []
    
    // Batch embed sentences
    const embeddings = await generateEmbeddings(sentences)
    
    // Calculate cosine similarity for each
    return embeddings.map(emb => cosineSimilarity(queryEmbedding, emb))
  }
  
  // ===========================================================================
  // TOKEN BUDGET METHODS
  // ===========================================================================
  
  /**
   * Apply token budget by truncating chunks that exceed limit.
   */
  private applyTokenBudget(
    chunks: RetrievedChunk[],
    maxTokens: number,
    tokensPerChar: number
  ): RetrievedChunk[] {
    let currentTokens = 0
    const result: RetrievedChunk[] = []
    
    for (const chunk of chunks) {
      const chunkTokens = Math.ceil(chunk.content.length * tokensPerChar)
      
      if (currentTokens + chunkTokens <= maxTokens) {
        result.push(chunk)
        currentTokens += chunkTokens
      } else {
        // Truncate this chunk to fit remaining budget
        const remainingTokens = maxTokens - currentTokens
        if (remainingTokens > 100) { // Only include if we can fit meaningful content
          const remainingChars = Math.floor(remainingTokens / tokensPerChar)
          result.push({
            ...chunk,
            content: chunk.content.slice(0, remainingChars) + '...',
            metadata: { ...chunk.metadata, truncated: true }
          })
        }
        break
      }
    }
    
    return result
  }
  
  // ===========================================================================
  // ORGANIZATION METHODS
  // ===========================================================================
  
  /**
   * Group chunks by paper for coherent reading.
   */
  private groupChunksByPaper(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const byPaper = new Map<string, RetrievedChunk[]>()
    
    for (const chunk of chunks) {
      const existing = byPaper.get(chunk.paper_id) || []
      existing.push(chunk)
      byPaper.set(chunk.paper_id, existing)
    }
    
    // Sort chunks within each paper by chunk_index if available
    for (const paperChunks of byPaper.values()) {
      paperChunks.sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
    }
    
    // Flatten, keeping papers in order of first chunk's score
    const paperOrder = Array.from(byPaper.entries())
      .map(([paperId, paperChunks]) => ({
        paperId,
        chunks: paperChunks,
        topScore: Math.max(...paperChunks.map(c => c.score))
      }))
      .sort((a, b) => b.topScore - a.topScore)
    
    return paperOrder.flatMap(p => p.chunks)
  }
  
  // ===========================================================================
  // FORMATTING METHODS
  // ===========================================================================
  
  /**
   * Format chunks into a context string for LLM prompts.
   */
  private formatContext(
    chunks: RetrievedChunk[],
    papers: Map<string, PaperMetadata>,
    includeCitations: boolean
  ): string {
    if (chunks.length === 0) {
      return 'No relevant content found in the provided papers.'
    }
    
    const formattedChunks = chunks.map((chunk, idx) => {
      const paper = papers.get(chunk.paper_id)
      
      let header = `[Source ${idx + 1}]`
      if (includeCitations && paper) {
        const firstAuthor = this.getFirstAuthorLastName(paper.authors)
        header = `[${firstAuthor}, ${paper.year} - ${paper.id}]`
      }
      
      return `${header}\n${chunk.content.trim()}`
    })
    
    return formattedChunks.join('\n\n---\n\n')
  }
  
  /**
   * Extract first author's last name.
   */
  private getFirstAuthorLastName(authors: string[]): string {
    if (!authors || authors.length === 0) return 'Unknown'
    
    const firstAuthor = authors[0]
    const parts = firstAuthor.trim().split(/\s+/)
    
    if (parts.length === 0) return 'Unknown'
    if (parts.length === 1) return parts[0]
    
    return parts[parts.length - 1]
  }
  
  /**
   * Create empty context result.
   */
  private createEmptyContext(): BuiltContext {
    return {
      formattedContext: 'No relevant content found.',
      chunks: [],
      estimatedTokens: 0,
      wasCompressed: false,
      metrics: {
        originalChunks: 0,
        includedChunks: 0,
        originalSentences: 0,
        includedSentences: 0,
        compressionRatio: 1.0
      }
    }
  }
  
  /**
   * Update configuration.
   */
  setConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let builderInstance: ContextBuilder | null = null

export function getContextBuilder(config?: Partial<ContextConfig>): ContextBuilder {
  if (!builderInstance) {
    builderInstance = new ContextBuilder(config)
  } else if (config) {
    builderInstance.setConfig(config)
  }
  return builderInstance
}

// Reset for testing
export function resetContextBuilder(): void {
  builderInstance = null
}
