/**
 * Supabase Type Utilities
 * 
 * This file provides strongly-typed helpers for working with Supabase data.
 * Use these types instead of `any` casts throughout the codebase.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

// ============================================================================
// Client Types
// ============================================================================

/** Typed Supabase client */
export type TypedSupabaseClient = SupabaseClient<Database>

// ============================================================================
// Table Types
// ============================================================================

/** Get the Row type for a table */
export type TableRow<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Row']

/** Get the Insert type for a table */
export type TableInsert<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Insert']

/** Get the Update type for a table */
export type TableUpdate<T extends keyof Database['public']['Tables']> = 
  Database['public']['Tables'][T]['Update']

// ============================================================================
// Common Table Row Types (convenience exports)
// ============================================================================

export type PaperRow = TableRow<'papers'>
export type PaperInsert = TableInsert<'papers'>
export type PaperUpdate = TableUpdate<'papers'>

export type LibraryPaperRow = TableRow<'library_papers'>
export type LibraryPaperInsert = TableInsert<'library_papers'>

export type ResearchProjectRow = TableRow<'research_projects'>
export type ResearchProjectInsert = TableInsert<'research_projects'>
export type ResearchProjectUpdate = TableUpdate<'research_projects'>

export type PaperChunkRow = TableRow<'paper_chunks'>
export type PaperChunkInsert = TableInsert<'paper_chunks'>

export type CitationRow = TableRow<'citations'>
export type CitationInsert = TableInsert<'citations'>

export type ProjectCitationRow = TableRow<'project_citations'>
export type ProfileRow = TableRow<'profiles'>

// Claim and Gap types from generated schema
export type PaperClaimRow = TableRow<'paper_claims'>
export type PaperClaimInsert = TableInsert<'paper_claims'>
export type PaperClaimUpdate = TableUpdate<'paper_claims'>

export type ResearchGapRow = TableRow<'research_gaps'>
export type ResearchGapInsert = TableInsert<'research_gaps'>
export type ResearchGapUpdate = TableUpdate<'research_gaps'>

export type ProjectAnalysisRow = TableRow<'project_analysis'>
export type ProjectAnalysisInsert = TableInsert<'project_analysis'>

export type ProjectEvidenceUsageRow = TableRow<'project_evidence_usage'>

// ============================================================================
// RAG Enhancement Types (for hybrid search and relevance feedback)
// These are manually defined until migrations are applied and types regenerated
// ============================================================================

/**
 * Extended paper_chunks row type with hybrid search fields.
 * After migration 20260115000000_add_hybrid_search.sql is applied:
 * - content_tsv: tsvector for full-text search
 * 
 * Note: The metadata JSONB column exists in the schema but is no longer populated.
 * Chunk metadata extraction (section_type, has_citations, etc.) was removed as it
 * was never used for filtering or retrieval - semantic search uses embeddings only.
 */
export interface PaperChunkWithHybridFields {
  id: string
  paper_id: string
  content: string
  embedding: number[] | null
  chunk_index: number | null
  created_at: string | null
  /** tsvector column for full-text search (auto-populated) */
  content_tsv?: unknown
  /** JSONB metadata - no longer populated (kept for backward compatibility) */
  metadata?: Record<string, unknown> | null
}

/**
 * Citation log entry for tracking which chunks were cited.
 * From migration 20260115100000_add_relevance_feedback.sql
 */
export interface ChunkCitationLogRow {
  id: string
  chunk_id: string
  paper_id: string
  project_id: string
  section_type: string | null
  query_context: string | null
  was_cited: boolean
  cited_at: string
}

export interface ChunkCitationLogInsert {
  id?: string
  chunk_id: string
  paper_id: string
  project_id: string
  section_type?: string | null
  query_context?: string | null
  was_cited?: boolean
  cited_at?: string
}

/**
 * Citation stats from materialized view.
 * Aggregates citation history for boosting.
 */
export interface ChunkCitationStats {
  chunk_id: string
  total_citations: number
  unique_projects: number
  last_cited_at: string
}

/**
 * Return type for hybrid_search_chunks RPC.
 */
export interface HybridSearchResult {
  id: string
  paper_id: string
  content: string
  chunk_index: number | null
  metadata: Record<string, unknown> | null
  similarity: number
  keyword_rank: number | null
  combined_score: number
}

/**
 * Return type for keyword_search_chunks RPC.
 */
export interface KeywordSearchResult {
  id: string
  paper_id: string
  content: string
  chunk_index: number | null
  metadata: Record<string, unknown> | null
  rank: number
}

// ============================================================================
// Query Result Types
// ============================================================================

/**
 * Type for a paper with joined library_papers data
 */
export interface PaperWithLibraryStatus extends PaperRow {
  inLibrary?: boolean
  libraryPaperId?: string
}

/**
 * Type for library paper with joined paper data
 */
export interface LibraryPaperWithPaper extends LibraryPaperRow {
  paper: PaperRow
}

/**
 * Type for research project with counts
 */
export interface ResearchProjectWithCounts extends ResearchProjectRow {
  paperCount?: number
  claimCount?: number
}

// ============================================================================
// Enum Types (from database)
// ============================================================================

export type ProjectStatus = 'draft' | 'generating' | 'complete' | 'error'
export type ClaimType = 'finding' | 'method' | 'background' | 'limitation' | 'future_work'
export type GapType = 'unstudied' | 'contradiction' | 'limitation' | 'methodology'
export type AnalysisType = 'claims' | 'gaps' | 'synthesis' | 'positioning'
export type AnalysisStatus = 'pending' | 'processing' | 'complete' | 'error'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extended paper type for when we need to handle authors in different formats
 * The base PaperRow has authors as Json, this type allows parsing it to string[]
 */
export type PaperRowWithParsedAuthors = PaperRow & {
  parsedAuthors?: string[]
}

/**
 * Type guard to check if a value is a valid paper row
 */
export function isPaperRow(value: unknown): value is PaperRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'title' in value &&
    typeof (value as PaperRow).id === 'string' &&
    typeof (value as PaperRow).title === 'string'
  )
}

/**
 * Safely extract authors array from paper
 * Handles the case where authors might be stored as JSON string, array, or missing
 */
export function extractAuthors(paper: PaperRow): string[] {
  const authors = paper.authors
  if (!authors) return []
  if (Array.isArray(authors)) return authors as string[]
  if (typeof authors === 'string') {
    try {
      const parsed = JSON.parse(authors)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  // Handle object case (Json type from Supabase)
  if (typeof authors === 'object') {
    return []
  }
  return []
}

/**
 * Transform a paper row to a consistent format with author_names
 */
export function transformPaperRow(paper: PaperRow): PaperRow & { author_names: string[] } {
  const authors = extractAuthors(paper)
  return {
    ...paper,
    author_names: authors,
  }
}
