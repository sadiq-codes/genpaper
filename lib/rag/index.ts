/**
 * RAG (Retrieval-Augmented Generation) Services
 * 
 * Consolidated retrieval services for grounded AI completions.
 * 
 * Architecture:
 * - base-retrieval.ts: Shared utilities (cosineSimilarity, chunk search, etc.)
 * - generation-context.ts: Paper generation with caching
 * - editor-context.ts: Editor autocomplete with claims + verification
 */

// Base utilities
export {
  cosineSimilarity,
  getFirstAuthorLastName,
  normalizeScore,
  searchChunks,
  fetchPaperMetadata,
  formatChunksForPrompt,
  formatPapersForPrompt,
  deduplicateChunks,
  balanceChunks,
  createEmptyResult,
  type RetrievedChunk,
  type PaperMetadata,
  type BaseRetrievalOptions,
  type BaseRetrievalResult
} from './base-retrieval'

// Generation context (for paper generation pipeline)
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
