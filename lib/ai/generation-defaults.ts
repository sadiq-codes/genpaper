// Generation defaults and configurable constants
// Move all magic numbers here to make the system maintainable

export const GENERATION_DEFAULTS = {
  // Citation coverage settings
  MIN_CITATION_COVERAGE: 0.7, // 70% of papers should be cited
  MIN_CITATION_FLOOR: 12, // Absolute minimum citations regardless of paper count
  
  // Content quality thresholds
  MIN_SEMANTIC_SCORE: 0.1,
  MIN_KEYWORD_SCORE: 0.01,
  MIN_SEMANTIC_SCORE_PERMISSIVE: 0.05,
  MIN_KEYWORD_SCORE_PERMISSIVE: 0,
  
  // Evidence processing
  EVIDENCE_SNIPPET_MAX_LENGTH: 115,
  EVIDENCE_WORD_BOUNDARY_THRESHOLD: 0.8, // 80% of max length to consider word boundary
  
  // Word targets by length (words per section)
  WORD_TARGETS: {
    short: { wordsPerSection: 400, estimatedSections: 6, totalWords: 2400 },
    medium: { wordsPerSection: 900, estimatedSections: 6, totalWords: 5400 },
    long: { wordsPerSection: 1600, estimatedSections: 6, totalWords: 9600 }
  },
  
  // Token calculation
  TOKENS_PER_WORD_RATIO: 0.75, // ~0.75 tokens per word
  TOKEN_FUDGE_FACTOR: 2.2, // Safety multiplier for token estimation
  MODEL_COMPLETION_TOKEN_LIMIT: 16000, // Safe limit below 16384
  
  // Chunk limits by paper length
  CHUNK_LIMITS: {
    short: 20,
    medium: 40,
    long: 80
  },
  
  // Section headings to search for citation insertion
  LITERATURE_SECTION_HEADINGS: [
    'Literature Review',
    'Related Work', 
    'Literature',
    'Background',
    'Prior Work',
    'State of the Art'
  ],
  
  // Length guidance for prompts
  LENGTH_GUIDANCE: {
    short: '1,500–2,500 words (≈3–4 sections)',
    medium: '3,000–5,000 words (≈5–6 sections)',
    long: '6,000–10,000 words (≈7–8 sections)',
  }
} as const

export type PaperLength = 'short' | 'medium' | 'long'
export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee'

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