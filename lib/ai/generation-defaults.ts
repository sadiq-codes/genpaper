// Generation defaults and configurable constants
// Move all magic numbers here to make the system maintainable

export const GENERATION_DEFAULTS = {
  // Citation coverage settings
  MIN_CITATION_COVERAGE: 0.4, // 40% of papers must be cited (looser)
  MIN_CITATION_FLOOR: 4, // Minimum 4 citations for medium papers
  
  // Content quality thresholds
  MIN_SEMANTIC_SCORE: 0.1,
  MIN_KEYWORD_SCORE: 0.01,
  MIN_SEMANTIC_SCORE_PERMISSIVE: 0.05,
  MIN_KEYWORD_SCORE_PERMISSIVE: 0,
  
  // Evidence processing
  EVIDENCE_SNIPPET_MAX_LENGTH: 115,
  // Chunk search thresholds
  CHUNK_MIN_SCORE_INITIAL: 0.18,
  CHUNK_MIN_SCORE_FALLBACK: 0.12,
  EVIDENCE_WORD_BOUNDARY_THRESHOLD: 0.8, // 80% of max length to consider word boundary
  

  // Token calculation
  TOKENS_PER_WORD_RATIO: 0.75, // ~0.75 tokens per word
  TOKEN_FUDGE_FACTOR: 2.2, // Safety multiplier for token estimation
  MODEL_COMPLETION_TOKEN_LIMIT: 16000, // Safe limit below 16384
  
  // Section headings to search for citation insertion
  LITERATURE_SECTION_HEADINGS: [
    'Literature Review',
    'Related Work', 
    'Literature',
    'Background',
    'Prior Work',
    'State of the Art'
  ],
  
  // (Deprecated) guidance strings removed – prompt library now owns this
} as const

export type PaperLength = 'short' | 'medium' | 'long'
// Citation style removed - system is now citation-agnostic

// Helper to build regex for literature section headings with safety limits
export function buildLiteratureSectionRegex(): RegExp {
  const headings = GENERATION_DEFAULTS.LITERATURE_SECTION_HEADINGS.join('|')
  // Limit greedy match to prevent catastrophic backtracking on large documents
  return new RegExp(`^(#+\\s*(?:${headings})\\s*$[\\s\\S]{0,20000}?)(?=\\n#+\\s|\\n##|\\n$|$)`, 'mi')
}

// Helper to get configurable values with fallbacks
export function getMinCitationCoverage(config?: { minCitationCoverage?: number }): number {
  return config?.minCitationCoverage ?? GENERATION_DEFAULTS.MIN_CITATION_COVERAGE
}

export function getMinCitationFloor(config?: { minCitationFloor?: number }): number {
  return config?.minCitationFloor ?? GENERATION_DEFAULTS.MIN_CITATION_FLOOR
}

export function getEvidenceSnippetLength(config?: { evidenceSnippetLength?: number }): number {
  return config?.evidenceSnippetLength ?? GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH
}

export const CHUNK_LIMIT_MIN = 80

// Search and ingestion defaults
export const SEARCH_DEFAULTS = {
  // Dynamic auto-ingest threshold - scales with library size
  BASE_AUTO_INGEST_THRESHOLD: 5, // Base threshold for new users
  MIN_AUTO_INGEST_THRESHOLD: 3, // Never go below this
  LIBRARY_SIZE_MULTIPLIER: 0.25, // 25% of library size
  // Rate limiting for ingestion
  MAX_INGEST_PER_REQUEST: 25, // Don't ingest more than 25 papers at once
  // Daily limits per user (future: move to user profile)
  DAILY_EMBEDDING_BUDGET_MB: 25, // 25MB of PDFs per day
  DAILY_EMBEDDING_BUDGET_USD: 2.0, // $2 in embedding costs per day
} as const

// Dynamic threshold calculation: min(5, max(librarySize * 0.25, 3))
function calculateAutoIngestThreshold(librarySize: number): number {
  const envThreshold = process.env.NEXT_PUBLIC_INGEST_AUTO_THRESHOLD
  const baseThreshold = envThreshold ? parseInt(envThreshold, 10) : SEARCH_DEFAULTS.BASE_AUTO_INGEST_THRESHOLD
  
  const dynamicThreshold = Math.max(
    SEARCH_DEFAULTS.MIN_AUTO_INGEST_THRESHOLD,
    Math.min(baseThreshold, librarySize * SEARCH_DEFAULTS.LIBRARY_SIZE_MULTIPLIER)
  )
  
  return Math.floor(dynamicThreshold)
}

// Helper to determine if forceIngest should be enabled automatically
export function shouldAutoIngest(userLibraryCount: number, explicitSetting?: boolean): boolean {
  // If user explicitly set it, respect that
  if (typeof explicitSetting === 'boolean') {
    return explicitSetting
  }
  
  // Use dynamic threshold based on library size
  const threshold = calculateAutoIngestThreshold(userLibraryCount)
  return userLibraryCount < threshold
}

// Export for logging/debugging
export function getAutoIngestThreshold(librarySize: number): number {
  return calculateAutoIngestThreshold(librarySize)
}

// Cost estimation helpers
export const COST_ESTIMATES = {
  // OpenAI text-embedding-3-small pricing (as of 2024)
  EMBEDDING_COST_PER_1K_TOKENS: 0.00002, // $0.00002 per 1K tokens
  AVERAGE_TOKENS_PER_PAGE: 500, // Rough estimate
  AVERAGE_PAGES_PER_PAPER: 12, // Academic papers
  AVERAGE_ABSTRACT_TOKENS: 200, // Just abstracts
} as const

// Estimate embedding cost for a batch of papers
export function estimateEmbeddingCost(paperCount: number, includeFullText = false): number {
  const tokensPerPaper = includeFullText 
    ? COST_ESTIMATES.AVERAGE_TOKENS_PER_PAGE * COST_ESTIMATES.AVERAGE_PAGES_PER_PAPER
    : COST_ESTIMATES.AVERAGE_ABSTRACT_TOKENS
  
  const totalTokens = paperCount * tokensPerPaper
  const cost = (totalTokens / 1000) * COST_ESTIMATES.EMBEDDING_COST_PER_1K_TOKENS
  
  return Math.round(cost * 100) / 100 // Round to cents
}

// Format cost for display
export function formatCostEstimate(cost: number): string {
  if (cost < 0.01) return '< $0.01'
  return `≈ $${cost.toFixed(2)}`
} 