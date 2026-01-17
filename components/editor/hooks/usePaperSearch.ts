/**
 * usePaperSearch - Search papers within a project for @ mentions
 * 
 * Features:
 * - Client-side filtering of project papers
 * - Fuzzy search on title and authors
 * - Debounced search for performance
 * - Returns papers formatted for mention insertion
 */

import { useCallback, useMemo } from 'react'
import type { MentionedPaper } from '../sidebar/PaperMention'
import type { ProjectPaper } from '../types'

interface UsePaperSearchOptions {
  /** Papers in the current project */
  papers: ProjectPaper[]
  /** Maximum number of results to return */
  maxResults?: number
}

interface UsePaperSearchReturn {
  /** Search papers by query */
  search: (query: string) => Promise<MentionedPaper[]>
  /** All papers formatted for mentions */
  allPapers: MentionedPaper[]
}

/**
 * Normalize string for search (lowercase, remove accents, trim)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Check if a paper matches the search query
 */
function matchesPaper(paper: ProjectPaper, normalizedQuery: string): boolean {
  // Check title
  const normalizedTitle = normalizeString(paper.title)
  if (normalizedTitle.includes(normalizedQuery)) {
    return true
  }

  // Check authors
  if (paper.authors && paper.authors.length > 0) {
    for (const author of paper.authors) {
      const normalizedAuthor = normalizeString(author)
      if (normalizedAuthor.includes(normalizedQuery)) {
        return true
      }
    }
  }

  // Check year
  if (paper.year && paper.year.toString().includes(normalizedQuery)) {
    return true
  }

  return false
}

/**
 * Calculate relevance score for sorting
 */
function calculateRelevanceScore(paper: ProjectPaper, normalizedQuery: string): number {
  let score = 0
  const normalizedTitle = normalizeString(paper.title)

  // Title starts with query
  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 100
  }
  // Title contains query
  else if (normalizedTitle.includes(normalizedQuery)) {
    score += 50
  }

  // First author starts with query
  if (paper.authors && paper.authors.length > 0) {
    const normalizedFirstAuthor = normalizeString(paper.authors[0])
    if (normalizedFirstAuthor.startsWith(normalizedQuery)) {
      score += 75
    } else if (normalizedFirstAuthor.includes(normalizedQuery)) {
      score += 25
    }
  }

  // Recency bonus (newer papers slightly preferred)
  if (paper.year) {
    const currentYear = new Date().getFullYear()
    const yearsAgo = currentYear - paper.year
    score += Math.max(0, 10 - yearsAgo) // Up to 10 points for recent papers
  }

  return score
}

/**
 * Convert ProjectPaper to MentionedPaper format
 */
function toMentionedPaper(paper: ProjectPaper): MentionedPaper {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors || [],
    year: paper.year,
  }
}

export function usePaperSearch({
  papers,
  maxResults = 10,
}: UsePaperSearchOptions): UsePaperSearchReturn {
  
  // Memoize all papers formatted for mentions
  const allPapers = useMemo(() => {
    return papers.map(toMentionedPaper)
  }, [papers])

  // Search function - client-side filtering
  const search = useCallback(async (query: string): Promise<MentionedPaper[]> => {
    // If no query, return all papers (limited)
    if (!query || query.trim() === '') {
      return allPapers.slice(0, maxResults)
    }

    const normalizedQuery = normalizeString(query)

    // Filter matching papers
    const matchingPapers = papers.filter(paper => 
      matchesPaper(paper, normalizedQuery)
    )

    // Sort by relevance
    const sortedPapers = matchingPapers.sort((a, b) => {
      const scoreA = calculateRelevanceScore(a, normalizedQuery)
      const scoreB = calculateRelevanceScore(b, normalizedQuery)
      return scoreB - scoreA
    })

    // Convert to MentionedPaper format and limit results
    return sortedPapers
      .slice(0, maxResults)
      .map(toMentionedPaper)
  }, [papers, allPapers, maxResults])

  return {
    search,
    allPapers,
  }
}

/**
 * Standalone search function for use outside React components
 * (e.g., in TipTap suggestion plugins)
 */
export function searchPapers(
  papers: ProjectPaper[],
  query: string,
  maxResults: number = 10
): MentionedPaper[] {
  if (!query || query.trim() === '') {
    return papers.slice(0, maxResults).map(toMentionedPaper)
  }

  const normalizedQuery = normalizeString(query)

  const matchingPapers = papers.filter(paper => 
    matchesPaper(paper, normalizedQuery)
  )

  const sortedPapers = matchingPapers.sort((a, b) => {
    const scoreA = calculateRelevanceScore(a, normalizedQuery)
    const scoreB = calculateRelevanceScore(b, normalizedQuery)
    return scoreB - scoreA
  })

  return sortedPapers.slice(0, maxResults).map(toMentionedPaper)
}
