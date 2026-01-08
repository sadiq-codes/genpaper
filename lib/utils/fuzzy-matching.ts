/**
 * Text Similarity & Fuzzy Matching Library
 * 
 * Consolidated text comparison utilities:
 * - Jaccard similarity (word overlap) for general text comparison
 * - Levenshtein distance for character-level matching
 * - Title matching for paper deduplication
 */

/**
 * Normalize text for comparison
 * Strip punctuation, collapse whitespace, lowercase
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ')     // Collapse multiple spaces
    .trim()
}

/**
 * Calculate Jaccard similarity between two texts (word overlap)
 * Returns value between 0-1 where 1 means identical word sets
 * 
 * @param text1 - First text to compare
 * @param text2 - Second text to compare  
 * @param options - Configuration options
 * @param options.minWordLength - Minimum word length to include (default: 2)
 * @param options.minUnionSize - Minimum union size for valid comparison (default: 3)
 */
export function jaccardSimilarity(
  text1: string, 
  text2: string,
  options: { minWordLength?: number; minUnionSize?: number } = {}
): number {
  const { minWordLength = 2, minUnionSize = 3 } = options
  
  const normalize = (str: string) => str.toLowerCase().replace(/[^\w\s]/g, '').trim()
  const t1 = normalize(text1)
  const t2 = normalize(text2)
  
  const words1 = new Set(t1.split(/\s+/).filter(w => w.length > minWordLength))
  const words2 = new Set(t2.split(/\s+/).filter(w => w.length > minWordLength))
  
  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])
  
  // Require minimum union size to avoid false positives with short texts
  if (union.size < minUnionSize) {
    return 0
  }
  
  return intersection.size / union.size
}

/**
 * Compute Levenshtein distance between two strings
 * Uses dynamic programming for optimal edit distance
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix = []
  
  // Initialize first row and column
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j
  }
  
  // Fill the matrix
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }
  
  return matrix[str2.length][str1.length]
}

/**
 * Calculate title similarity score (0-1, higher = more similar)
 */
export function titleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1)
  const norm2 = normalizeTitle(title2)
  
  if (norm1 === norm2) return 1.0
  
  const maxLength = Math.max(norm1.length, norm2.length)
  if (maxLength === 0) return 1.0
  
  const distance = levenshteinDistance(norm1, norm2)
  return Math.max(0, 1 - (distance / maxLength))
}

/**
 * Check if two titles are fuzzy matches
 * Uses configurable threshold and Levenshtein distance
 */
export function isTitleMatch(
  title1: string, 
  title2: string, 
  options: {
    threshold?: number      // Max allowed Levenshtein distance (default: 2)
    minSimilarity?: number  // Min similarity score 0-1 (default: 0.85)
  } = {}
): boolean {
  const { threshold = 2, minSimilarity = 0.85 } = options
  
  const norm1 = normalizeTitle(title1)
  const norm2 = normalizeTitle(title2)
  
  // Exact match after normalization
  if (norm1 === norm2) return true
  
  // Too short to reliably match
  if (norm1.length < 3 || norm2.length < 3) return false
  
  // Check Levenshtein threshold
  const distance = levenshteinDistance(norm1, norm2)
  if (distance <= threshold) return true
  
  // Check similarity score
  const similarity = titleSimilarity(title1, title2)
  return similarity >= minSimilarity
}

/**
 * Find best matching paper from a list
 */
export interface PaperCandidate {
  id: string
  title: string
  year?: number
}

export interface MatchResult {
  paper: PaperCandidate
  distance: number
  similarity: number
  yearMatch: boolean
}

export function findBestTitleMatch(
  targetTitle: string,
  targetYear: number | undefined,
  candidates: PaperCandidate[],
  options: {
    threshold?: number           // Max Levenshtein distance (default: 2)
    minSimilarity?: number       // Min similarity score (default: 0.85)
    yearBonus?: number           // Extra threshold for year matches (default: 1)
    preferredIds?: Set<string>   // Preferred paper IDs (e.g., from user library)
  } = {}
): MatchResult | null {
  const { 
    threshold = 2, 
    minSimilarity = 0.85, 
    yearBonus = 1,
    preferredIds = new Set()
  } = options
  
  const normalizedTarget = normalizeTitle(targetTitle)
  const matches: MatchResult[] = []
  
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTitle(candidate.title)
    const distance = levenshteinDistance(normalizedTarget, normalizedCandidate)
    const similarity = titleSimilarity(targetTitle, candidate.title)
    const yearMatch = targetYear ? candidate.year === targetYear : false
    
    // Apply threshold with year bonus
    const effectiveThreshold = threshold + (yearMatch ? yearBonus : 0)
    
    if (distance <= effectiveThreshold && similarity >= minSimilarity) {
      matches.push({
        paper: candidate,
        distance,
        similarity,
        yearMatch
      })
    }
  }
  
  if (matches.length === 0) return null
  
  // Sort by quality: distance (asc), similarity (desc), year match, preference
  matches.sort((a, b) => {
    // Distance comparison (lower is better)
    if (a.distance !== b.distance) return a.distance - b.distance
    
    // Similarity comparison (higher is better) 
    if (a.similarity !== b.similarity) return b.similarity - a.similarity
    
    // Year match bonus
    if (a.yearMatch !== b.yearMatch) return a.yearMatch ? -1 : 1
    
    // Preference for library papers
    const aPreferred = preferredIds.has(a.paper.id)
    const bPreferred = preferredIds.has(b.paper.id)
    if (aPreferred !== bPreferred) return aPreferred ? -1 : 1
    
    return 0
  })
  
  return matches[0]
}

