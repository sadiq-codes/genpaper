/**
 * Consolidated paper deduplication module
 * 
 * Handles deduplication across different paper types and sources with:
 * - DOI-based exact matching
 * - Normalized title matching (catches same paper from different APIs)
 * - arXiv preprint to journal version linking
 * - Citation count preference (keeps higher-cited version)
 */

import type { PaperSource } from '@/types/simplified'

// Base paper interface - minimum fields needed for deduplication
export interface DeduplicatablePaper {
  title: string
  doi?: string | null
  canonical_id?: string
  id?: string
  source?: PaperSource | string
  url?: string
  citationCount?: number
  citation_count?: number
}

// Extended result type with preprint linking
export interface DeduplicatedPaper<T extends DeduplicatablePaper> extends DeduplicatablePaper {
  preprint_id?: string
  siblings?: string[]
}

export interface DeduplicationOptions {
  /** Prefer journal versions over arXiv preprints (default: true) */
  preferJournalOverPreprint?: boolean
  /** Sort by citation count before deduplicating to prefer higher-cited (default: true) */
  preferHigherCitations?: boolean
  /** Link preprints to their journal versions via preprint_id field (default: true) */
  linkPreprints?: boolean
}

const DEFAULT_OPTIONS: Required<DeduplicationOptions> = {
  preferJournalOverPreprint: true,
  preferHigherCitations: true,
  linkPreprints: true,
}

/**
 * Normalize a title for deduplication comparison
 * Strips punctuation, collapses whitespace, lowercases
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize a DOI for comparison
 * Strips common prefixes and lowercases
 */
export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null
  return doi
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .trim()
}

/**
 * Get citation count from paper (handles both field names)
 */
function getCitationCount(paper: DeduplicatablePaper): number {
  return paper.citationCount ?? paper.citation_count ?? 0
}

/**
 * Get unique ID from paper (handles both field names)
 */
function getPaperId(paper: DeduplicatablePaper): string {
  return paper.canonical_id ?? paper.id ?? ''
}

/**
 * Check if paper is from arXiv
 */
function isArxivPaper(paper: DeduplicatablePaper): boolean {
  return paper.source === 'arxiv'
}

/**
 * Check if paper has a DOI (likely journal version)
 */
function hasJournalDoi(paper: DeduplicatablePaper): boolean {
  return !!paper.doi && paper.source !== 'arxiv'
}

/**
 * Deduplicate papers using DOI and normalized title matching
 * 
 * Features:
 * - Exact DOI matching
 * - Normalized title matching (catches duplicates from different sources)
 * - Prefers higher citation counts when duplicates found
 * - Links arXiv preprints to their journal versions
 * 
 * @param papers - Array of papers to deduplicate
 * @param options - Deduplication options
 * @returns Deduplicated array with preprint linking
 */
export function deduplicatePapers<T extends DeduplicatablePaper>(
  papers: T[],
  options: DeduplicationOptions = {}
): T[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  if (papers.length === 0) return []
  
  // Sort by citation count if preferred
  const sorted = opts.preferHigherCitations
    ? [...papers].sort((a, b) => getCitationCount(b) - getCitationCount(a))
    : papers
  
  const seenDois = new Set<string>()
  const seenTitles = new Set<string>()
  const seenIds = new Set<string>()
  const deduplicated: T[] = []
  
  // For preprint linking: track arXiv and journal papers by normalized title
  const arxivByTitle = new Map<string, T>()
  const journalByTitle = new Map<string, T>()
  
  if (opts.linkPreprints) {
    // First pass: categorize papers
    for (const paper of sorted) {
      const normalizedTitle = normalizeTitle(paper.title)
      
      if (isArxivPaper(paper)) {
        if (!arxivByTitle.has(normalizedTitle)) {
          arxivByTitle.set(normalizedTitle, paper)
        }
      } else if (hasJournalDoi(paper)) {
        if (!journalByTitle.has(normalizedTitle)) {
          journalByTitle.set(normalizedTitle, paper)
        }
      }
    }
  }
  
  // Main deduplication pass
  for (const paper of sorted) {
    const normalizedTitle = normalizeTitle(paper.title)
    const normalizedDoi = normalizeDoi(paper.doi)
    const paperId = getPaperId(paper)
    
    // Skip if already seen by DOI, title, or ID
    if (normalizedDoi && seenDois.has(normalizedDoi)) continue
    if (seenTitles.has(normalizedTitle)) continue
    if (paperId && seenIds.has(paperId)) continue
    
    // Handle preprint linking
    if (opts.linkPreprints && opts.preferJournalOverPreprint) {
      // Case 1: This is an arXiv paper with a journal version
      if (isArxivPaper(paper) && journalByTitle.has(normalizedTitle)) {
        const journalVersion = journalByTitle.get(normalizedTitle)!
        const journalId = getPaperId(journalVersion)
        
        // Mark both as seen
        if (normalizedDoi) seenDois.add(normalizedDoi)
        seenTitles.add(normalizedTitle)
        if (paperId) seenIds.add(paperId)
        if (journalId) seenIds.add(journalId)
        
        // Only add journal version if not already in results
        if (!deduplicated.find(p => getPaperId(p) === journalId)) {
          // Create enhanced journal paper with preprint link
          const enhanced = {
            ...journalVersion,
            preprint_id: paper.url,
            siblings: [paperId].filter(Boolean),
          } as T
          deduplicated.push(enhanced)
        }
        continue
      }
      
      // Case 2: This is a journal paper with an arXiv version
      if (hasJournalDoi(paper) && arxivByTitle.has(normalizedTitle)) {
        const arxivVersion = arxivByTitle.get(normalizedTitle)!
        const arxivId = getPaperId(arxivVersion)
        
        // Mark both as seen
        if (normalizedDoi) seenDois.add(normalizedDoi)
        seenTitles.add(normalizedTitle)
        if (paperId) seenIds.add(paperId)
        if (arxivId) seenIds.add(arxivId)
        
        // Add journal version with preprint link
        const enhanced = {
          ...paper,
          preprint_id: arxivVersion.url,
          siblings: [arxivId].filter(Boolean),
        } as T
        deduplicated.push(enhanced)
        continue
      }
    }
    
    // No preprint match - add paper as-is
    if (normalizedDoi) seenDois.add(normalizedDoi)
    seenTitles.add(normalizedTitle)
    if (paperId) seenIds.add(paperId)
    deduplicated.push(paper)
  }
  
  return deduplicated
}

/**
 * Simple deduplication without preprint handling
 * Use this for already-ingested papers where preprint linking isn't needed
 */
export function simpleDeduplicatePapers<T extends DeduplicatablePaper>(
  papers: T[]
): T[] {
  return deduplicatePapers(papers, {
    preferJournalOverPreprint: false,
    preferHigherCitations: false,
    linkPreprints: false,
  })
}
