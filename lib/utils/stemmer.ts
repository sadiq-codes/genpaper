/**
 * Stemming utilities using Porter Stemmer algorithm.
 * 
 * Stemming reduces words to their root form, enabling matching of related words:
 * - "religion" → "religi"
 * - "religious" → "religi"
 * - "literature" → "literatur"
 * - "literary" → "literari"
 * 
 * Used by:
 * - Quick relevance filter (semantic-rerank.ts)
 * - Hybrid search fallback (papers.ts)
 */

import { PorterStemmer } from 'natural'

/**
 * Stem a single word using Porter Stemmer algorithm.
 * 
 * @param word - The word to stem
 * @returns The stemmed root form
 * 
 * @example
 * stem('religious') // → 'religi'
 * stem('religion')  // → 'religi'
 * stem('analyzing') // → 'analyz'
 * stem('analysis')  // → 'analysi'
 */
export function stem(word: string): string {
  return PorterStemmer.stem(word.toLowerCase())
}

/**
 * Extract and stem all significant words from a text.
 * Returns a Set for efficient O(1) lookup.
 * 
 * @param text - The text to process
 * @param minLength - Minimum word length to include (default: 3)
 * @returns Set of stemmed words
 * 
 * @example
 * stemWords('Religious themes in American literature')
 * // → Set { 'religi', 'theme', 'american', 'literatur' }
 */
export function stemWords(text: string, minLength = 3): Set<string> {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > minLength)
    .map(w => w.replace(/[^a-z]/g, '')) // Remove non-alpha characters
    .filter(w => w.length > minLength)  // Re-check length after cleaning
  
  return new Set(words.map(stem))
}

/**
 * Get both the original word and its stemmed form.
 * Useful for building search queries that match both forms.
 * 
 * @param word - The word to process
 * @returns Array containing original word and its stem (deduplicated)
 * 
 * @example
 * getWordAndStem('religious') // → ['religious', 'religi']
 * getWordAndStem('run')       // → ['run'] (stem is same as original)
 */
export function getWordAndStem(word: string): string[] {
  const lower = word.toLowerCase()
  const stemmed = stem(lower)
  
  // Return unique values only
  if (lower === stemmed) {
    return [lower]
  }
  return [lower, stemmed]
}

/**
 * Expand a list of words to include their stems.
 * Useful for building broader search queries.
 * 
 * @param words - Array of words to expand
 * @returns Array of unique words including stems
 * 
 * @example
 * expandWithStems(['religion', 'literature'])
 * // → ['religion', 'religi', 'literature', 'literatur']
 */
export function expandWithStems(words: string[]): string[] {
  const expanded = words.flatMap(getWordAndStem)
  return [...new Set(expanded)]
}
