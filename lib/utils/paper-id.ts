import { collisionResistantHash } from '@/lib/utils/hash'

/**
 * Format a YYYY-MM-DD string (UTC) – OpenAlex & Crossref accept ISO-8601 dates.
 */
export function formatDateForAPI(year: number, month = 1, day = 1): string {
  const yyyy = `${year}`.padStart(4, '0')
  const mm = `${month}`.padStart(2, '0')
  const dd = `${day}`.padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Generate a collision-resistant, *stable* canonical identifier so the same
 * paper coming from multiple sources collapses into one entry.
 *
 * Heuristics:
 *   1. If a DOI is available → `doi:{normalisedDoi}` (most reliable)
 *   2. If an arXiv URL is present → `arxiv:{id}`
 *   3. Fallback: a hash of clean(title)|year (source-agnostic for cross-API dedup)
 */
export function createCanonicalId(
  title: string | undefined,
  year?: number,
  doi?: string,
  _source?: string,  // Kept for API compatibility but not used in fallback hash
  url?: string
): string {
  if (doi) {
    return `doi:${normaliseDoi(doi)}`
  }
  if (url?.includes('arxiv')) {
    return `arxiv:${extractArxivId(url)}`
  }
  const normalisedTitle = (title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .trim()
  // NOTE: Source is intentionally excluded from the hash to ensure the same paper
  // from different APIs (OpenAlex, Crossref, Semantic Scholar) gets the same canonical_id
  const input = `${normalisedTitle}-${year || 'unknown'}`
  return `paper:${collisionResistantHash(input)}`
}

/**
 * Remove duplicates *by* canonical_id, preserving the first occurrence.
 */
export function deduplicate<P extends { canonical_id: string }>(items: P[]): P[] {
  const seen = new Set<string>()
  return items.filter((p) => {
    if (seen.has(p.canonical_id)) return false
    seen.add(p.canonical_id)
    return true
  })
}

// ────────────────────────────────────────────────────────────────────────────
// private helpers
// ────────────────────────────────────────────────────────────────────────────

function normaliseDoi(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .trim()
}

function extractArxivId(u: string): string {
  const m = u.match(/arxiv\.org\/(abs|pdf)\/(.+?)(v\d+)?$/i)
  return m ? m[2] : u
} 