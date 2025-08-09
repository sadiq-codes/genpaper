/**
 * Title/Year Fuzzy Matching Library
 * 
 * Reusable matching for non-DOI papers with normalized title comparison
 * and Levenshtein distance threshold.
 */

/**
 * Normalize title for fuzzy matching
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

/**
 * Batch find duplicates in a list of papers
 * Returns groups of potentially duplicate papers
 */
export function findDuplicateGroups(
  papers: PaperCandidate[],
  options: {
    threshold?: number
    minSimilarity?: number
  } = {}
): PaperCandidate[][] {
  const { threshold = 2, minSimilarity = 0.9 } = options
  const groups: PaperCandidate[][] = []
  const processed = new Set<string>()
  
  for (let i = 0; i < papers.length; i++) {
    if (processed.has(papers[i].id)) continue
    
    const group = [papers[i]]
    processed.add(papers[i].id)
    
    for (let j = i + 1; j < papers.length; j++) {
      if (processed.has(papers[j].id)) continue
      
      if (isTitleMatch(papers[i].title, papers[j].title, { threshold, minSimilarity })) {
        group.push(papers[j])
        processed.add(papers[j].id)
      }
    }
    
    groups.push(group)
  }
  
  return groups
}