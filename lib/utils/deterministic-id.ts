import { createHash } from 'node:crypto'

/**
 * Generate a deterministic ID for a paper to prevent duplicates
 * Uses DOI when available, otherwise creates a hash from title, author, and year
 */
export function generateDeterministicPaperId(paper: {
  doi?: string | null
  title: string
  authors?: Array<{ name: string } | string> | string[]
  year?: number | string | null
  publication_date?: string | null
}): string {
  // Prefer DOI as it's globally unique
  if (paper.doi) {
    // Normalize DOI format and create a consistent ID
    const normalizedDoi = paper.doi.toLowerCase().replace(/^doi:/, '').trim()
    return `doi-${createHash('sha1').update(normalizedDoi).digest('hex').substring(0, 16)}`
  }
  
  // Extract year from publication_date if year not provided
  let year = paper.year
  if (!year && paper.publication_date) {
    const match = paper.publication_date.match(/(\d{4})/)
    year = match ? parseInt(match[1]) : undefined
  }
  
  // Get first author name
  let firstAuthor = ''
  if (paper.authors && paper.authors.length > 0) {
    const author = paper.authors[0]
    firstAuthor = typeof author === 'string' ? author : author.name || ''
  }
  
  // Create a deterministic key from available metadata
  const key = [
    paper.title.toLowerCase().trim(),
    firstAuthor.toLowerCase().trim(),
    year ? year.toString() : ''
  ].filter(Boolean).join('|')
  
  // Generate SHA1 hash and take first 16 characters for reasonable length
  const hash = createHash('sha1').update(key).digest('hex').substring(0, 16)
  return `paper-${hash}`
}

/**
 * Generate a deterministic ID for an author
 * Uses only the author's name to consolidate all work under a single ID,
 * even when affiliations change over time or are represented differently
 */
export function generateDeterministicAuthorId(author: {
  name: string
  affiliation?: string // Still useful as metadata, but not for ID generation
}): string {
  // Use only the normalized name for the unique key
  // This consolidates authors even when affiliations change or are missing
  const key = author.name.toLowerCase().trim()
  
  const hash = createHash('sha1').update(key).digest('hex').substring(0, 12)
  return `author-${hash}`
}

/**
 * Generate a deterministic ID for a content chunk
 * @param paperId The ID of the parent paper
 * @param chunkContent The first 100 characters of the chunk's content
 * @param chunkIndex The index of the chunk within the paper
 * @returns A unique, deterministic ID for the chunk
 */
export function createDeterministicChunkId(
  paperId: string,
  chunkContent: string,
  chunkIndex: number
): string {
  // Use a small prefix of the content to make the ID deterministic
  // even if the chunking algorithm changes slightly.
  const contentPrefix = chunkContent.substring(0, 100)
  
  const key = `${paperId}|${chunkIndex}|${contentPrefix}`
  const hash = createHash('sha1').update(key).digest('hex').substring(0, 16)
  
  return `chunk-${hash}`
} 