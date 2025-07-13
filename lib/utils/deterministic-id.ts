import { createHash } from 'node:crypto'
import { v5 as uuidv5 } from 'uuid'

// Define fixed namespaces for different types of entities
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const AUTHOR_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
const CHUNK_NAMESPACE = '6ba7b812-9dad-11d1-80b4-00c04fd430c8'

/**
 * Generate a deterministic UUID for a paper to prevent duplicates
 * Uses DOI when available, otherwise creates a UUID from title, author, and year
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
    // Normalize DOI format and create a consistent UUID
    const normalizedDoi = paper.doi.toLowerCase().replace(/^doi:/, '').trim()
    return uuidv5(normalizedDoi, PAPER_NAMESPACE)
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
  
  // Generate UUID v5 from the key
  return uuidv5(key, PAPER_NAMESPACE)
}

/**
 * Generate a deterministic UUID for an author
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
  
  return uuidv5(key, AUTHOR_NAMESPACE)
}

/**
 * Generate a deterministic UUID for a content chunk
 * @param paperId The ID of the parent paper
 * @param chunkContent The first 100 characters of the chunk's content
 * @param chunkIndex The index of the chunk within the paper
 * @returns A unique, deterministic UUID for the chunk
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
  
  return uuidv5(key, CHUNK_NAMESPACE)
}