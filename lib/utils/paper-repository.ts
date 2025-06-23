/**
 * Paper Repository Module
 * 
 * Handles all database CRUD operations for papers with region support.
 * Separated from business logic for better maintainability.
 */

import { getSB } from '@/lib/supabase/server'
import type { RegionDetectionResult } from './global-region-detection'
import { generatePaperUUID } from '@/lib/db/papers'

// Lazy-loaded Supabase client to avoid calling cookies() at import time
let supabaseClient: Awaited<ReturnType<typeof getSB>> | null = null

async function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = await getSB()
  }
  return supabaseClient
}

export interface PaperData {
  id?: string
  title: string
  authors: string[]
  abstract?: string
  venue?: string
  year?: number
  url?: string
  doi?: string
  pdf_url?: string
  metadata: Record<string, unknown>
  content?: string
  embedding?: number[]
  created_at?: string
  updated_at?: string
}

export interface CreatePaperParams {
  data: PaperData
  chunks?: Array<{
    content: string
    embedding?: number[]
    metadata?: Record<string, unknown>
  }>
}

export interface SearchPapersParams {
  query?: string
  region?: string
  venue?: string
  year?: number
  limit?: number
  offset?: number
  sortBy?: 'created_at' | 'year' | 'title'
  sortOrder?: 'asc' | 'desc'
}

export interface SearchPapersResult {
  papers: PaperData[]
  total: number
  hasMore: boolean
}

export interface RegionStatistics {
  region: string
  count: number
  percentage: number
  confidence_breakdown: {
    high: number
    medium: number
    low: number
  }
  sources_breakdown: {
    url: number
    venue: number
    affiliation: number
    title: number
    user: number
  }
}

/**
 * Create a new paper record
 */
export async function createPaper(params: CreatePaperParams): Promise<string> {
  const { data, chunks = [] } = params

  try {
    const supabase = await getSupabase()
    
    // Build deterministic UUID (use DOI when available)
    const uuidInput = data.doi && data.doi.trim() !== ''
      ? data.doi
      : `${data.title}|${(data.authors && data.authors.length > 0) ? data.authors[0] : ''}|${data.year || ''}`

    const paperIdDeterministic = generatePaperUUID(uuidInput)

    // Upsert paper record with deterministic ID to avoid duplicates / mismatches
    const { data: paperData, error: paperError } = await supabase
      .from('papers')
      .upsert({
        id: paperIdDeterministic,
        title: data.title,
        authors: data.authors,
        abstract: data.abstract,
        venue: data.venue,
        year: data.year,
        url: data.url,
        doi: data.doi,
        pdf_url: data.pdf_url,
        metadata: data.metadata,
        content: data.content,
        embedding: data.embedding
      }, {
        onConflict: 'id',
        ignoreDuplicates: true
      })
      .select('id')
      .single()

    if (paperError) {
      throw new Error(`Failed to create paper: ${paperError.message}`)
    }

    const paperId = paperData?.id
    if (!paperId) {
      throw new Error('Failed to get paper ID from created paper')
    }

    // Insert chunks if provided
    if (chunks.length > 0) {
      const chunkInserts = chunks.map((chunk, index) => ({
        paper_id: paperId,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: {
          ...chunk.metadata,
          chunk_index: index,
          total_chunks: chunks.length
        }
      }))

      const { error: chunksError } = await supabase
        .from('paper_chunks')
        .insert(chunkInserts)

      if (chunksError) {
        console.warn(`Failed to insert chunks for paper ${paperId}:`, chunksError.message)
        // Don't throw error - paper was created successfully
      }
    }

    return paperId

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Update paper metadata with region information
 */
export async function updatePaperRegion(
  paperId: string,
  regionResult: RegionDetectionResult
): Promise<void> {
  if (!regionResult.region) {
    return // Nothing to update
  }

  try {
    const supabase = await getSupabase()
    
    const { error } = await supabase
      .from('papers')
      .update({
        metadata: {
          region: regionResult.region,
          region_confidence: regionResult.confidence,
          region_source: regionResult.source,
          region_matched_pattern: regionResult.matchedPattern,
          region_matched_text: regionResult.matchedText,
          region_was_overridden: regionResult.wasOverridden,
          region_detected_at: new Date().toISOString()
        }
      })
      .eq('id', paperId)

    if (error) {
      throw new Error(`Failed to update paper region: ${error.message}`)
    }

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Batch update regions for multiple papers
 */
export async function batchUpdatePaperRegions(
  updates: Array<{ paperId: string; regionResult: RegionDetectionResult }>
): Promise<{ successful: number; failed: Array<{ paperId: string; error: string }> }> {
  const successful: string[] = []
  const failed: Array<{ paperId: string; error: string }> = []

  // Process in batches of 50 to avoid overwhelming the database
  const batchSize = 50
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    
    const promises = batch.map(async ({ paperId, regionResult }) => {
      try {
        await updatePaperRegion(paperId, regionResult)
        return { success: true as const, paperId }
      } catch (error) {
        return {
          success: false as const,
          paperId: paperId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    })

    const results = await Promise.all(promises)
    
    results.forEach(result => {
      if (result.success) {
        successful.push(result.paperId)
      } else {
        failed.push({ paperId: result.paperId, error: result.error })
      }
    })
  }

  return {
    successful: successful.length,
    failed
  }
}

/**
 * Search papers with advanced filtering
 */
export async function searchPapers(params: SearchPapersParams = {}): Promise<SearchPapersResult> {
  const {
    query,
    region,
    venue,
    year,
    limit = 20,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = params

  try {
    const supabase = await getSupabase()
    
    let queryBuilder = supabase
      .from('papers')
      .select('*', { count: 'exact' })

    // Apply filters
    if (query) {
      queryBuilder = queryBuilder.or(`title.ilike.%${query}%,abstract.ilike.%${query}%`)
    }

    if (region) {
      queryBuilder = queryBuilder.eq('metadata->>region', region)
    }

    if (venue) {
      queryBuilder = queryBuilder.ilike('venue', `%${venue}%`)
    }

    if (year) {
      queryBuilder = queryBuilder.eq('year', year)
    }

    // Apply sorting and pagination
    queryBuilder = queryBuilder
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(offset, offset + limit - 1)

    const { data, error, count } = await queryBuilder

    if (error) {
      throw new Error(`Search failed: ${error.message}`)
    }

    return {
      papers: data || [],
      total: count || 0,
      hasMore: (count || 0) > offset + limit
    }

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Get region statistics for papers
 */
export async function getRegionStatistics(): Promise<RegionStatistics[]> {
  try {
    const supabase = await getSupabase()
    
    // Get total count first
    const { count: totalCount, error: countError } = await supabase
      .from('papers')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      throw new Error(`Failed to get total count: ${countError.message}`)
    }

    // Get region statistics
    const { data: regionData, error: regionError } = await supabase
      .from('papers')
      .select('metadata')
      .not('metadata->>region', 'is', null)

    if (regionError) {
      throw new Error(`Failed to get region data: ${regionError.message}`)
    }

    // Process the data to get statistics
    const regionCounts: Record<string, {
      total: number
      confidence: { high: number; medium: number; low: number }
      sources: { url: number; venue: number; affiliation: number; title: number; user: number }
    }> = {}

    regionData?.forEach(paper => {
      const metadata = paper.metadata as Record<string, unknown>
      const region = metadata?.region as string
      const confidence = (metadata?.region_confidence as string) || 'unknown'
      const source = (metadata?.region_source as string) || 'unknown'

      if (region) {
        if (!regionCounts[region]) {
          regionCounts[region] = {
            total: 0,
          confidence: { high: 0, medium: 0, low: 0 },
          sources: { url: 0, venue: 0, affiliation: 0, title: 0, user: 0 }
        }
      }

        regionCounts[region].total++
      
        // Ensure confidence is one of the expected values
        if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
          regionCounts[region].confidence[confidence]++
        }
        
        // Ensure source is one of the expected values
        if (source === 'url' || source === 'venue' || source === 'affiliation' || source === 'title' || source === 'user') {
          regionCounts[region].sources[source]++
    }
      }
    })

    // Convert to array and calculate percentages
    const statistics: RegionStatistics[] = Object.entries(regionCounts).map(([region, stats]) => ({
        region,
      count: stats.total,
      percentage: totalCount ? (stats.total / totalCount) * 100 : 0,
        confidence_breakdown: stats.confidence,
        sources_breakdown: stats.sources
      }))

    // Sort by count descending
    statistics.sort((a, b) => b.count - a.count)

    return statistics

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Get a paper by ID
 */
export async function getPaperById(paperId: string): Promise<PaperData | null> {
  try {
    const supabase = await getSupabase()
    
    const { data, error } = await supabase
      .from('papers')
      .select('*')
      .eq('id', paperId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return null // Paper not found
      }
      throw new Error(`Failed to get paper: ${error.message}`)
    }

    return data as PaperData

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Delete a paper and its chunks
 */
export async function deletePaper(paperId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    
    // Delete chunks first (foreign key constraint)
    const { error: chunksError } = await supabase
      .from('paper_chunks')
      .delete()
      .eq('paper_id', paperId)

    if (chunksError) {
      throw new Error(`Failed to delete paper chunks: ${chunksError.message}`)
    }

    // Delete the paper
    const { error: paperError } = await supabase
      .from('papers')
      .delete()
      .eq('id', paperId)

    if (paperError) {
      throw new Error(`Failed to delete paper: ${paperError.message}`)
    }

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  totalPapers: number
  papersWithRegions: number
  totalChunks: number
  regionCoverage: number
}> {
  try {
    const supabase = await getSupabase()
    
    // Get total papers count
    const { count: totalPapers, error: papersError } = await supabase
      .from('papers')
      .select('*', { count: 'exact', head: true })

    if (papersError) {
      throw new Error(`Failed to get papers count: ${papersError.message}`)
    }

    // Get papers with regions count
    const { count: papersWithRegions, error: regionsError } = await supabase
      .from('papers')
      .select('*', { count: 'exact', head: true })
      .not('metadata->>region', 'is', null)

    if (regionsError) {
      throw new Error(`Failed to get papers with regions count: ${regionsError.message}`)
    }

    // Get total chunks count
    const { count: totalChunks, error: chunksError } = await supabase
      .from('paper_chunks')
      .select('*', { count: 'exact', head: true })

    if (chunksError) {
      throw new Error(`Failed to get chunks count: ${chunksError.message}`)
    }

    const regionCoverage = totalPapers ? (papersWithRegions || 0) / totalPapers : 0

    return {
      totalPapers: totalPapers || 0,
      papersWithRegions: papersWithRegions || 0,
      totalChunks: totalChunks || 0,
      regionCoverage
    }

  } catch (error) {
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
} 