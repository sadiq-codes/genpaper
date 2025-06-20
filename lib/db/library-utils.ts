/**
 * Shared utilities for library operations
 * Eliminates duplicate data transformation logic between server and client operations
 */

import type { Paper, LibraryPaper, Author } from '@/types/simplified'
import { Tables } from '@/types/supabase'

// Proper types for Supabase relationships
type DbPaper = Tables<'papers'>
type DbAuthor = Tables<'authors'>  
type DbPaperAuthor = Tables<'paper_authors'>

// What Supabase actually returns when we join paper_authors with authors
type PaperAuthorJoin = DbPaperAuthor & {
  author: DbAuthor
}

// Type for what Supabase actually returns from our query
type PaperWithAuthorJoins = DbPaper & {
  authors: PaperAuthorJoin[]
}

/**
 * Transform paper data from Supabase query result to LibraryPaper format
 * Centralizes the author transformation logic to avoid duplication
 */
export function transformPaperWithAuthors(
  libraryPaper: LibraryPaper & { paper: PaperWithAuthorJoins }
): LibraryPaper {
  const paper = libraryPaper.paper
  const authors = paper.authors
    ?.sort((a: PaperAuthorJoin, b: PaperAuthorJoin) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    ?.map((pa: PaperAuthorJoin): Author => ({
      id: pa.author.id,
      name: pa.author.name
    })) || []

  return {
    ...libraryPaper,
    paper: {
      ...paper,
      authors
    }
  }
}

/**
 * Standard Supabase select query for papers with authors
 * Prevents inconsistencies in query structure
 */
export const PAPER_WITH_AUTHORS_SELECT = `
  *,
  paper:papers(
    *,
    authors:paper_authors(
      ordinal,
      author:authors(*)
    )
  )
`

/**
 * Standard sorting configuration for library queries
 */
export function applySorting(
  query: any,
  sortBy: string = 'added_at',
  sortOrder: string = 'desc'
) {
  if (sortBy === 'added_at') {
    return query.order('added_at', { ascending: sortOrder === 'asc' })
  } else if (sortBy === 'title') {
    return query.order('paper.title', { ascending: sortOrder === 'asc' })
  } else if (sortBy === 'publication_date') {
    return query.order('paper.publication_date', { ascending: sortOrder === 'asc', nullsFirst: false })
  } else if (sortBy === 'citation_count') {
    return query.order('paper.citation_count', { ascending: sortOrder === 'asc', nullsFirst: false })
  }
  return query
}

/**
 * Standard filtering configuration for library queries
 */
export function applyFilters(query: any, filters: { search?: string; source?: string }) {
  if (filters.search) {
    query = query.or(
      `paper.title.ilike.%${filters.search}%,paper.abstract.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`
    )
  }

  if (filters.source) {
    query = query.eq('paper.source', filters.source)
  }

  return query
}

// Export types for reuse
export type { PaperAuthorJoin, PaperWithAuthorJoins } 