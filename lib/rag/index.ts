/**
 * RAG (Retrieval-Augmented Generation) Services
 * 
 * Consolidated retrieval services for grounded AI completions.
 * 
 * Architecture:
 * - base-retrieval.ts: Shared types and utilities
 * - chunk-retriever.ts: Core retrieval with hybrid search + reranking
 * - context-builder.ts: Context compression and formatting
 * - generation-context.ts: High-level API with caching for generation pipeline
 * - editor-context.ts: Editor autocomplete with claims + verification
 * - relevance-feedback.ts: Citation-based retrieval boosting
 * 
 * Features:
 * - Hybrid search: Vector (semantic) + Keyword (BM25) with RRF fusion
 * - Cross-encoder reranking: Cohere rerank for top candidates
 * - Chunk compression: Sentence-level relevance filtering
 * - Citation boosting: Chunks cited in past papers get relevance boost
 * - Chunk metadata: Section type, citations, data detection
 */

// Base utilities and types
export {
  cosineSimilarity,
  getFirstAuthorLastName,
  normalizeScore,
  fetchPaperMetadata,
  formatChunksForPrompt,
  formatPapersForPrompt,
  deduplicateChunks,
  balanceChunks,
  createEmptyResult,
  reciprocalRankFusion,
  type SearchMode,
  type RetrievedChunk,
  type PaperMetadata,
  type BaseRetrievalResult
} from './base-retrieval'

// Chunk Retriever (core retrieval with reranking)
export {
  ChunkRetriever,
  getChunkRetriever,
  resetChunkRetriever,
  DEFAULT_RETRIEVAL_CONFIG,
  type RetrievalConfig,
  type RetrievalRequest,
  type RetrievalResult
} from './chunk-retriever'

// Context Builder (compression and formatting)
export {
  ContextBuilder,
  getContextBuilder,
  resetContextBuilder,
  DEFAULT_CONTEXT_CONFIG,
  type ContextConfig,
  type CompressedChunk,
  type BuiltContext,
  type SectionContext as BuiltSectionContext
} from './context-builder'

// Relevance feedback
export {
  logChunkCitation,
  logChunkCitations,
  logSectionCitations,
  extractCitedChunksFromContent,
  getChunkCitationStats,
  refreshCitationStats,
  type CitationLogEntry
} from './relevance-feedback'

// Generation context (high-level API for paper generation)
export {
  GenerationContextService,
  type GenerationRetrievalParams,
  type GenerationRetrievalResult,
  type PaperChunk
} from './generation-context'

// Editor context (for autocomplete)
export {
  retrieveEditorContext,
  formatEditorContextForPrompt,
  verifyCitation,
  verifyAllCitations,
  type RetrievedClaim,
  type EditorRetrievalOptions,
  type EditorContext,
  type CitationVerificationResult
} from './editor-context'
