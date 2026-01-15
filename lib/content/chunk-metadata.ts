/**
 * Chunk Metadata Extraction
 * 
 * Extracts rich metadata from chunk content to enable:
 * - Section-type filtering (methods, results, discussion, etc.)
 * - Citation-aware retrieval
 * - Entity-based filtering
 * 
 * This metadata is stored in the `metadata` JSONB column of paper_chunks
 * and used by the hybrid search to improve retrieval quality.
 */

export interface ChunkMetadata {
  /** Detected section type */
  section_type: SectionType | null
  /** Contains citation markers like [1], (Author, Year), etc. */
  has_citations: boolean
  /** Contains references to figures or tables */
  has_figures: boolean
  /** Contains numerical data (statistics, percentages, measurements) */
  has_data: boolean
  /** Appears to be a conclusion or summary */
  is_conclusion: boolean
  /** Approximate reading level (based on sentence complexity) */
  complexity_score: number
  /** Key terms extracted from the chunk */
  key_terms: string[]
}

export type SectionType = 
  | 'abstract'
  | 'introduction'
  | 'background'
  | 'literature_review'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'references'
  | 'appendix'
  | 'unknown'

// Section heading patterns (case-insensitive)
const SECTION_PATTERNS: Record<SectionType, RegExp[]> = {
  abstract: [/^abstract\b/i, /^summary\b/i],
  introduction: [/^introduction\b/i, /^\d+\.?\s*introduction\b/i],
  background: [/^background\b/i, /^theoretical\s+framework/i, /^context\b/i],
  literature_review: [/^literature\s+review/i, /^related\s+work/i, /^prior\s+work/i, /^review\s+of/i],
  methods: [
    /^method(s|ology)?\b/i, 
    /^materials?\s+(and|&)\s+methods?/i, 
    /^experimental\s+(design|setup|methods?)/i,
    /^study\s+design/i,
    /^data\s+collection/i,
    /^participants?\b/i,
    /^procedure\b/i
  ],
  results: [
    /^results?\b/i, 
    /^findings?\b/i, 
    /^analysis\b/i,
    /^outcomes?\b/i
  ],
  discussion: [
    /^discussion\b/i, 
    /^interpretation\b/i,
    /^implications?\b/i
  ],
  conclusion: [
    /^conclusion(s)?\b/i, 
    /^concluding\s+remarks/i, 
    /^summary\s+(and|&)\s+conclusion/i,
    /^future\s+(work|directions?|research)/i
  ],
  references: [/^references?\b/i, /^bibliography\b/i, /^works?\s+cited/i],
  appendix: [/^appendix/i, /^supplementary/i, /^supporting\s+information/i],
  unknown: []
}

// Citation patterns
// Note: Avoid /g flag with test() as it maintains lastIndex state
const CITATION_PATTERNS = [
  /\[\d+\]/,                          // [1], [2,3], [1-5]
  /\[\d+[-,]\d+\]/,                   // [1-3], [1,2]
  /\([A-Z][a-z]+(?:\s+et\s+al\.?)?,?\s*\d{4}\)/,  // (Smith, 2023), (Smith et al., 2023)
  /[A-Z][a-z]+\s+(?:et\s+al\.?\s+)?\(\d{4}\)/,   // Smith (2023), Smith et al. (2023)
]

// Figure/table patterns
// Note: Avoid /g flag with test() as it maintains lastIndex state
const FIGURE_PATTERNS = [
  /\bFig(?:ure)?\.?\s*\d+/i,
  /\bTable\s*\d+/i,
  /\bChart\s*\d+/i,
  /\bDiagram\s*\d+/i,
  /\bPlot\s*\d+/i,
  /\bScheme\s*\d+/i,
]

// Statistical/data patterns
// Note: Avoid /g flag with test() as it maintains lastIndex state
const DATA_PATTERNS = [
  /\d+(?:\.\d+)?%/,                    // Percentages: 25%, 15.5%
  /\bp\s*[<>=]\s*0?\.\d+/i,            // p-values: p = 0.003, p < 0.05
  /\bCI\s*[:=]?\s*[\[(]?[\d.]+/i,      // Confidence intervals: CI: 1.2-3.4
  /\bn\s*=\s*\d+/i,                    // Sample sizes: n = 150
  /\br\s*=\s*-?0?\.\d+/i,              // Correlation coefficients: r = 0.85
  /\bM\s*=\s*[\d.]+/i,                 // Means: M = 15.2
  /\bSD\s*=\s*[\d.]+/i,                // Standard deviations: SD = 2.1
  /±\s*[\d.]+/,                        // Plus/minus: ±2.5
  /\d+\s*(?:mg|ml|kg|cm|mm|μm|nm)/i,   // Measurements: 5mg, 10cm
]

// Conclusion indicator patterns
const CONCLUSION_PATTERNS = [
  /\bin\s+conclusion\b/i,
  /\bto\s+summarize\b/i,
  /\bin\s+summary\b/i,
  /\bwe\s+conclude\s+that\b/i,
  /\bthis\s+study\s+demonstrates?\b/i,
  /\bour\s+findings?\s+suggest\b/i,
  /\bfuture\s+research\s+should\b/i,
  /\bfuture\s+work\b/i,
  /\blimitations?\s+of\s+this\s+study\b/i,
]

/**
 * Extract metadata from a chunk's content.
 * 
 * @param content - The chunk content to analyze
 * @param chunkIndex - Position in document (lower = earlier)
 * @param overlapLength - Length of overlap prefix to skip for section detection (default: 0)
 * @returns Extracted metadata
 */
export function extractChunkMetadata(content: string, chunkIndex: number = 0, overlapLength: number = 0): ChunkMetadata {
  const trimmedContent = content.trim()
  const lowerContent = trimmedContent.toLowerCase()
  
  // FIX #3: Detect section type from content AFTER overlap prefix
  // This prevents overlap from previous sections from mislabeling the current chunk
  const section_type = detectSectionType(trimmedContent, chunkIndex, overlapLength)
  
  // Check for citations
  const has_citations = CITATION_PATTERNS.some(pattern => pattern.test(trimmedContent))
  
  // Check for figures/tables
  const has_figures = FIGURE_PATTERNS.some(pattern => pattern.test(trimmedContent))
  
  // Check for statistical data
  const has_data = DATA_PATTERNS.some(pattern => pattern.test(trimmedContent))
  
  // Check for conclusion indicators
  const is_conclusion = CONCLUSION_PATTERNS.some(pattern => pattern.test(lowerContent))
  
  // Calculate complexity score (0-1 based on avg sentence length and vocabulary)
  const complexity_score = calculateComplexity(trimmedContent)
  
  // Extract key terms (simple TF-based extraction)
  const key_terms = extractKeyTerms(trimmedContent)
  
  return {
    section_type,
    has_citations,
    has_figures,
    has_data,
    is_conclusion,
    complexity_score,
    key_terms
  }
}

/**
 * Detect section type from chunk content.
 * 
 * @param content - Full chunk content (may include overlap prefix)
 * @param chunkIndex - Position in document
 * @param overlapLength - Length of overlap prefix to skip (default: 0)
 */
function detectSectionType(content: string, chunkIndex: number, overlapLength: number = 0): SectionType | null {
  // FIX #3: Skip overlap prefix when detecting section headers
  // This prevents "In conclusion..." from a previous section being detected as conclusion
  const newContent = overlapLength > 0 ? content.slice(overlapLength) : content
  
  // Check first 200 chars of NEW content (after overlap) for section headers
  const headerRegion = newContent.slice(0, 200)
  
  for (const [sectionType, patterns] of Object.entries(SECTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(headerRegion)) {
        return sectionType as SectionType
      }
    }
  }
  
  // Heuristics based on content characteristics
  const lowerContent = content.toLowerCase()
  
  // Abstract heuristics (usually first chunk, contains "abstract" keyword)
  if (chunkIndex === 0 && (
    lowerContent.includes('abstract') ||
    lowerContent.includes('this paper') ||
    lowerContent.includes('this study') ||
    lowerContent.includes('we present') ||
    lowerContent.includes('we propose')
  )) {
    return 'abstract'
  }
  
  // Methods heuristics
  if (
    lowerContent.includes('participants were') ||
    lowerContent.includes('we recruited') ||
    lowerContent.includes('data was collected') ||
    lowerContent.includes('the experiment') ||
    lowerContent.includes('the procedure') ||
    /\d+\s+participants/.test(lowerContent)
  ) {
    return 'methods'
  }
  
  // Results heuristics
  if (
    DATA_PATTERNS.filter(p => p.test(content)).length >= 2 ||
    lowerContent.includes('the results show') ||
    lowerContent.includes('we found that') ||
    lowerContent.includes('analysis revealed')
  ) {
    return 'results'
  }
  
  // Discussion heuristics
  if (
    lowerContent.includes('these findings suggest') ||
    lowerContent.includes('this is consistent with') ||
    lowerContent.includes('in contrast to') ||
    lowerContent.includes('one possible explanation')
  ) {
    return 'discussion'
  }
  
  return null
}

/**
 * Calculate text complexity score (0-1).
 */
function calculateComplexity(content: string): number {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)
  if (sentences.length === 0) return 0.5
  
  const words = content.split(/\s+/).filter(w => w.length > 0)
  const avgWordsPerSentence = words.length / sentences.length
  
  // Count long words (>= 8 chars) as complexity indicator
  const longWords = words.filter(w => w.replace(/[^a-zA-Z]/g, '').length >= 8).length
  const longWordRatio = longWords / Math.max(1, words.length)
  
  // Normalize to 0-1 range
  // Average academic sentence: 20-25 words
  // Complex: 30+ words per sentence, 30%+ long words
  const sentenceComplexity = Math.min(1, avgWordsPerSentence / 35)
  const vocabularyComplexity = Math.min(1, longWordRatio / 0.4)
  
  return (sentenceComplexity * 0.6 + vocabularyComplexity * 0.4)
}

/**
 * Extract key terms from content (simple TF-based).
 */
function extractKeyTerms(content: string, maxTerms: number = 5): string[] {
  // Tokenize and normalize
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4)
  
  // Count term frequencies
  const termFreq = new Map<string, number>()
  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      termFreq.set(word, (termFreq.get(word) || 0) + 1)
    }
  }
  
  // Sort by frequency and return top terms
  return Array.from(termFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([term]) => term)
}

// Common stop words to exclude from key terms
const STOP_WORDS = new Set([
  'this', 'that', 'these', 'those', 'which', 'where', 'when', 'what', 'while',
  'with', 'from', 'into', 'have', 'been', 'were', 'being', 'would', 'could',
  'should', 'their', 'there', 'other', 'about', 'more', 'most', 'also', 'such',
  'than', 'then', 'some', 'only', 'very', 'just', 'over', 'under', 'before',
  'after', 'between', 'through', 'during', 'each', 'both', 'however', 'therefore',
  'thus', 'hence', 'because', 'although', 'though', 'since', 'until', 'within',
])

/**
 * Batch extract metadata for multiple chunks.
 */
export function extractMetadataForChunks(
  chunks: Array<{ content: string; chunk_index?: number; overlapLength?: number }>
): ChunkMetadata[] {
  return chunks.map((chunk, idx) => 
    extractChunkMetadata(chunk.content, chunk.chunk_index ?? idx, chunk.overlapLength ?? 0)
  )
}
