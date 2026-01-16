/**
 * Fuzzy text matching utilities for AI tool execution.
 * 
 * LLMs often can't reproduce exact text, so we need fuzzy matching
 * to find the intended content in the document.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface MatchResult {
  found: boolean
  matchedText: string
  startIndex: number
  endIndex: number
  similarity: number
}

export interface SectionMatch {
  found: boolean
  sectionName: string
  startIndex: number
  endIndex: number
  contentStart: number
  contentEnd: number
}

// =============================================================================
// LEVENSHTEIN DISTANCE
// =============================================================================

/**
 * Calculate Levenshtein distance between two strings.
 * Optimized for shorter strings (< 1000 chars).
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Use two rows instead of full matrix for memory efficiency
  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i)
  let currRow = new Array(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    currRow[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      )
    }
    ;[prevRow, currRow] = [currRow, prevRow]
  }

  return prevRow[b.length]
}

/**
 * Calculate similarity score (0-1) between two strings.
 */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase())
  return 1 - distance / maxLen
}

// =============================================================================
// FUZZY TEXT MATCHING
// =============================================================================

/**
 * Normalize text for comparison (lowercase, collapse whitespace).
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find the best fuzzy match for a search phrase in the document.
 * 
 * @param document - The full document text
 * @param searchPhrase - The phrase to find (may be inexact)
 * @param minSimilarity - Minimum similarity threshold (0-1), default 0.6
 */
export function fuzzyFindPhrase(
  document: string,
  searchPhrase: string,
  minSimilarity: number = 0.6
): MatchResult {
  const normalizedSearch = normalizeText(searchPhrase)
  const searchWords = normalizedSearch.split(' ').filter(w => w.length > 2)
  
  if (searchWords.length === 0) {
    return { found: false, matchedText: '', startIndex: -1, endIndex: -1, similarity: 0 }
  }

  // Strategy 1: Try exact substring match first (fastest)
  const exactIndex = document.toLowerCase().indexOf(normalizedSearch)
  if (exactIndex !== -1) {
    return {
      found: true,
      matchedText: document.slice(exactIndex, exactIndex + searchPhrase.length),
      startIndex: exactIndex,
      endIndex: exactIndex + searchPhrase.length,
      similarity: 1.0
    }
  }

  // Strategy 2: Find anchor word and expand
  // Look for the most distinctive word (longest, least common)
  const anchorWord = searchWords.reduce((a, b) => a.length > b.length ? a : b)
  const anchorPattern = new RegExp(`\\b${escapeRegex(anchorWord)}\\b`, 'gi')
  const anchorMatches = [...document.matchAll(anchorPattern)]

  if (anchorMatches.length === 0) {
    // Strategy 3: Try word-by-word fuzzy matching
    return fuzzyWordMatch(document, searchPhrase, minSimilarity)
  }

  // For each anchor occurrence, extract surrounding context and compare
  let bestMatch: MatchResult = { found: false, matchedText: '', startIndex: -1, endIndex: -1, similarity: 0 }

  for (const match of anchorMatches) {
    const anchorStart = match.index!
    
    // Expand to capture approximate phrase length
    const contextPadding = Math.floor(searchPhrase.length * 0.5)
    const windowStart = Math.max(0, anchorStart - contextPadding)
    const windowEnd = Math.min(document.length, anchorStart + searchPhrase.length + contextPadding)
    
    // Extract candidate and compare
    const candidate = document.slice(windowStart, windowEnd)
    const sim = similarity(normalizeText(candidate), normalizedSearch)

    if (sim > bestMatch.similarity && sim >= minSimilarity) {
      // Find precise boundaries by trimming to sentence/phrase
      const { start, end } = refineBoundaries(document, windowStart, windowEnd, searchPhrase.length)
      bestMatch = {
        found: true,
        matchedText: document.slice(start, end),
        startIndex: start,
        endIndex: end,
        similarity: sim
      }
    }
  }

  return bestMatch
}

/**
 * Word-by-word fuzzy matching fallback.
 */
function fuzzyWordMatch(
  document: string,
  searchPhrase: string,
  minSimilarity: number
): MatchResult {
  const normalizedDoc = normalizeText(document)
  const normalizedSearch = normalizeText(searchPhrase)
  const searchLen = normalizedSearch.length

  // Slide a window across the document
  const windowSize = Math.floor(searchLen * 1.3) // Allow some slack
  let bestMatch: MatchResult = { found: false, matchedText: '', startIndex: -1, endIndex: -1, similarity: 0 }

  // Sample positions to check (don't check every position for performance)
  const step = Math.max(1, Math.floor(searchLen / 10))
  
  for (let i = 0; i <= normalizedDoc.length - searchLen; i += step) {
    const candidate = normalizedDoc.slice(i, i + windowSize)
    const sim = similarity(candidate, normalizedSearch)

    if (sim > bestMatch.similarity && sim >= minSimilarity) {
      // Map back to original document position
      const originalStart = findOriginalPosition(document, i)
      const originalEnd = findOriginalPosition(document, i + windowSize)
      
      bestMatch = {
        found: true,
        matchedText: document.slice(originalStart, originalEnd),
        startIndex: originalStart,
        endIndex: originalEnd,
        similarity: sim
      }
    }
  }

  return bestMatch
}

/**
 * Map normalized position back to original document position.
 */
function findOriginalPosition(original: string, normalizedPos: number): number {
  let origIdx = 0
  let normIdx = 0
  let inWhitespace = false

  while (normIdx < normalizedPos && origIdx < original.length) {
    const char = original[origIdx]
    const isWs = /\s/.test(char)

    if (isWs) {
      if (!inWhitespace) {
        normIdx++ // Count first whitespace
        inWhitespace = true
      }
    } else {
      normIdx++
      inWhitespace = false
    }
    origIdx++
  }

  return origIdx
}

/**
 * Refine match boundaries to align with word/sentence boundaries.
 */
function refineBoundaries(
  document: string,
  start: number,
  end: number,
  targetLength: number
): { start: number; end: number } {
  // Expand to word boundaries
  while (start > 0 && !/\s/.test(document[start - 1])) start--
  while (end < document.length && !/\s/.test(document[end])) end++

  // If too long, try to trim to sentence boundaries
  if (end - start > targetLength * 1.5) {
    const content = document.slice(start, end)
    const sentenceEnd = content.search(/[.!?]\s/)
    if (sentenceEnd > targetLength * 0.5) {
      end = start + sentenceEnd + 1
    }
  }

  return { start, end }
}

// =============================================================================
// SECTION MATCHING
// =============================================================================

/**
 * Common section heading patterns in academic papers.
 */
const SECTION_PATTERNS = [
  /^#{1,3}\s*(.+)$/gm,                    // Markdown headings
  /^([A-Z][A-Za-z\s]+):?\s*$/gm,          // Title Case headings
  /^(\d+\.?\s*[A-Z][A-Za-z\s]+):?\s*$/gm, // Numbered headings
]

/**
 * Find a section by name in the document.
 */
export function findSection(document: string, sectionName: string): SectionMatch {
  const normalizedName = sectionName.toLowerCase().trim()
  
  // Find all headings
  const headings: Array<{ name: string; start: number; end: number }> = []
  
  for (const pattern of SECTION_PATTERNS) {
    // Reset lastIndex
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    
    while ((match = pattern.exec(document)) !== null) {
      const name = match[1]?.trim().replace(/^#+\s*/, '').replace(/:$/, '')
      if (name) {
        headings.push({
          name,
          start: match.index,
          end: match.index + match[0].length
        })
      }
    }
  }

  // Sort by position
  headings.sort((a, b) => a.start - b.start)

  // Find best matching section
  let bestMatch: { heading: typeof headings[0]; sim: number } | null = null

  for (const heading of headings) {
    const sim = similarity(heading.name.toLowerCase(), normalizedName)
    if (!bestMatch || sim > bestMatch.sim) {
      bestMatch = { heading, sim }
    }
  }

  if (!bestMatch || bestMatch.sim < 0.5) {
    return { found: false, sectionName: '', startIndex: -1, endIndex: -1, contentStart: -1, contentEnd: -1 }
  }

  // Find section end (next heading or end of document)
  const headingIndex = headings.findIndex(h => h.start === bestMatch!.heading.start)
  const nextHeading = headings[headingIndex + 1]
  const contentEnd = nextHeading ? nextHeading.start : document.length

  return {
    found: true,
    sectionName: bestMatch.heading.name,
    startIndex: bestMatch.heading.start,
    endIndex: bestMatch.heading.end,
    contentStart: bestMatch.heading.end,
    contentEnd
  }
}

/**
 * Find text within a specific section.
 */
export function findInSection(
  document: string,
  sectionName: string,
  searchPhrase: string,
  minSimilarity: number = 0.6
): MatchResult {
  const section = findSection(document, sectionName)
  
  if (!section.found) {
    // Fall back to searching entire document
    return fuzzyFindPhrase(document, searchPhrase, minSimilarity)
  }

  const sectionContent = document.slice(section.contentStart, section.contentEnd)
  const result = fuzzyFindPhrase(sectionContent, searchPhrase, minSimilarity)

  if (result.found) {
    // Adjust indices to document coordinates
    return {
      ...result,
      startIndex: result.startIndex + section.contentStart,
      endIndex: result.endIndex + section.contentStart
    }
  }

  return result
}

// =============================================================================
// HELPERS
// =============================================================================

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
