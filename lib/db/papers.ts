import { getSB } from '@/lib/supabase/server'
import type { PaperWithAuthors, Author } from '@/types/simplified'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { PaperDTO } from '@/lib/schemas/paper'
import { debug } from '@/lib/utils/logger' 

// Centralized embedding configuration to ensure consistency


// Fix: Fallback token estimation without tiktoken dependency
// Removed estimateTokenCount and getTokenEncoder - now handled by chunk-processor utility

// Fix: Smart chunk validation with simplified tiktoken usage
// Removed validateAndClampChunk - now handled by chunk-processor utility

// Import the unified chunk processor
import { createChunksForPaper } from '@/lib/content/ingestion'

// Type definitions for database query results
interface PaperAuthorRelation {
  ordinal: number
  author: Author
}

interface DatabasePaper {
  id: string
  title: string
  abstract?: string
  publication_date?: string
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  metadata?: Record<string, unknown>
  source: string
  citation_count: number
  impact_score?: number
  created_at: string
  authors: PaperAuthorRelation[]
}


// Helper function to transform database papers to app format
function transformDatabasePaper(dbPaper: DatabasePaper): PaperWithAuthors {
  const authors = dbPaper.authors
    ?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal)
    ?.map((pa: PaperAuthorRelation) => pa.author) || []

  return {
    ...dbPaper,
    authors,
    author_names: authors.map((a: Author) => a.name)
  }
}

export async function getPaper(paperId: string): Promise<PaperWithAuthors | null> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .eq('id', paperId)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  if (!data) return null

  return transformDatabasePaper(data as DatabasePaper)
}

export async function getPapersByIds(paperIds: string[]): Promise<PaperWithAuthors[]> {
  if (!paperIds || paperIds.length === 0) {
    return []
  }

  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', paperIds)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}

export async function getRecentPapers(
  limit = 10
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  const { data, error } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .order('publication_date', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw error

  return (data || []).map((paper: DatabasePaper) => transformDatabasePaper(paper))
}


// Removed optimizeVectorIndex - now handled automatically by the database

// Task 3: Type definitions for RPC functions
interface SearchResult {
  paper_id: string
  title: string
  abstract: string
  publication_date: string
  venue: string
  doi: string
  citation_count: number
  similarity_score?: number
  semantic_score?: number
  keyword_score?: number
  combined_score?: number
}

interface HybridSearchResult {
  paper_id: string
  semantic_score: number
  keyword_score: number
  combined_score: number
}

interface SimilarPapersResult {
  paper_id: string
  score: number
}

// Task 3: Semantic similarity search functions
export async function semanticSearchPapers(
  query: string,
  options: {
    limit?: number
    minYear?: number
    maxYear?: number
    sources?: string[]
    threshold?: number
  } = {}
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  
  // Prepare JSONB configuration for the RPC
  const searchConfig = {
    query,
    limit: options.limit || 20,
    threshold: options.threshold || 0.1,
    ...(options.minYear && { minYear: options.minYear }),
    ...(options.maxYear && { maxYear: options.maxYear }),
    ...(options.sources && { sources: options.sources })
  }
  
  // Call the enhanced RPC function
  const { data: searchResults, error } = await supabase
    .rpc('semantic_search_papers', { search_config: searchConfig })
  
  if (error) {
    console.error('Enhanced semantic search failed:', error)
    throw error
  }
  
  if (!searchResults || searchResults.length === 0) {
    return []
  }
  
  // Get paper IDs for author fetching
  const paperIds = searchResults.map((result: SearchResult) => result.paper_id)
  
  // Fetch authors for all papers in one query
  const { data: authorsData, error: authorsError } = await supabase
    .from('paper_authors')
    .select(`
      paper_id,
        ordinal,
      authors (
        id,
        name
      )
    `)
    .in('paper_id', paperIds)
    .order('ordinal')
  
  if (authorsError) {
    console.error('Error fetching authors:', authorsError)
  }
  
  // Group authors by paper ID
  const authorsByPaper = new Map<string, PaperAuthorRelation[]>()
  authorsData?.forEach(item => {
    if (!authorsByPaper.has(item.paper_id)) {
      authorsByPaper.set(item.paper_id, [])
    }
    const author = item.authors as unknown as { id: string; name: string }
    authorsByPaper.get(item.paper_id)!.push({
      ordinal: item.ordinal,
      author: {
        id: author.id,
        name: author.name
      }
    })
  })
  
  // Transform results to include authors and search scores
  return searchResults.map((result: SearchResult) => ({
    id: result.paper_id,
    title: result.title,
    abstract: result.abstract,
    publication_date: result.publication_date,
    venue: result.venue,
    doi: result.doi,
    url: null,
    pdf_url: null,
    metadata: {
      search_scores: {
        similarity_score: result.similarity_score
      }
    },
    source: 'search',
    citation_count: result.citation_count,
    impact_score: null,
    created_at: new Date().toISOString(),
    authors: authorsByPaper.get(result.paper_id) || []
  }))
}

export async function hybridSearchPapers(
  query: string,
  options: {
    limit?: number
    excludePaperIds?: string[]
    minYear?: number
    maxYear?: number
    sources?: string[]
    semanticWeight?: number
  } = {}
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  const { 
    limit = 10, 
    minYear = 2000, 
    sources, 
    semanticWeight = 0.7,
    excludePaperIds = [],
    maxYear = 2024
  } = options

  console.log(`🔍 Hybrid Search Starting:`)
  console.log(`   🎯 Query: "${query}"`)
  console.log(`   📊 Limit: ${limit}`)
  console.log(`   📅 Min Year: ${minYear}`)
  console.log(`   📅 Max Year: ${maxYear}`)
  console.log(`   🏷️ Sources Filter: ${sources ? `[${sources.join(', ')}]` : 'None'}`)
  console.log(`   ⚖️ Semantic Weight: ${semanticWeight}`)
  console.log(`   🚫 Excluded IDs: ${excludePaperIds.length > 0 ? `[${excludePaperIds.join(', ')}]` : 'None'}`)

  // 1. Generate embedding for the query using centralized configuration
  console.log(`🧠 Generating embedding for query...`)
  const [queryEmbedding] = await generateEmbeddings([query])
  console.log(`✅ Embedding generated: ${queryEmbedding.length} dimensions`)

  // 2. Call the hybrid search RPC function
  console.log(`🗄️ Calling hybrid_search_papers RPC...`)
  
  // Add diagnostic check for embeddings
  const { error: countError } = await supabase
    .from('papers')
    .select('id', { count: 'exact' })
    .not('embedding', 'is', null)
    .limit(1)
  
  if (countError) {
    console.warn(`⚠️ Error checking embedding count:`, countError)
  } else {
    console.log(`📊 Papers with embeddings available for search`)
  }
  
  // Test embedding quality by checking if query embedding looks reasonable
  console.log(`🧪 Query embedding sample (first 10 dims): [${queryEmbedding.slice(0, 10).map(x => x.toFixed(3)).join(', ')}]`)
  console.log(`🧪 Embedding magnitude: ${Math.sqrt(queryEmbedding.reduce((sum, x) => sum + x*x, 0)).toFixed(3)}`)
  
  // Check if RPC function exists
  const { error: funcError } = await supabase
    .rpc('hybrid_search_papers', {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit * 2,
      min_year: minYear,
      semantic_weight: semanticWeight
    })
    .limit(0) // Don't return results, just test if function exists
  
  if (funcError) {
    console.error(`❌ RPC function test failed:`, funcError)
    console.error(`💡 This suggests the hybrid_search_papers function doesn't exist or has wrong signature`)
    throw new Error(`Vector search function not available: ${funcError.message}`)
  }
  
  const { data: searchResults, error } = await supabase
    .rpc('hybrid_search_papers', {
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: limit * 2,
      min_year: minYear,
      semantic_weight: semanticWeight
    })

  if (error) {
    console.error(`❌ RPC search failed:`, error)
    console.error(`💡 Falling back to basic text search...`)
    
    // Fallback to basic text search if RPC fails
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2)
    const { data: fallbackResults, error: fallbackError } = await supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .or(queryWords.map(word => `title.ilike.%${word}%,abstract.ilike.%${word}%`).join(','))
      .gte('publication_date', `${minYear}-01-01`)
      .order('citation_count', { ascending: false })
      .limit(limit)
    
    if (fallbackError) {
      console.error(`❌ Fallback search also failed:`, fallbackError)
      throw error // Throw original RPC error
    }
    
    console.log(`✅ Fallback search found ${fallbackResults?.length || 0} papers`)
    
    if (fallbackResults && fallbackResults.length > 0) {
      const transformedResults = fallbackResults.map((paper) => ({
        ...transformDatabasePaper(paper as DatabasePaper),
        relevance_score: 0.5, // Default relevance score for fallback
        semantic_score: 0.0,
        keyword_score: 0.5
      }))
      
      return transformedResults
    }
    
    throw error // If both searches fail, throw original error
  }

  console.log(`📋 RPC returned ${searchResults?.length || 0} initial results`)
  if (searchResults && searchResults.length > 0) {
    console.log(`📊 Score distribution:`)
    const scores = searchResults.map((r: HybridSearchResult) => ({
      combined: r.combined_score,
      semantic: r.semantic_score,
      keyword: r.keyword_score
    }))
    
    const maxCombined = Math.max(...scores.map((s: { combined: number }) => s.combined))
    const minCombined = Math.min(...scores.map((s: { combined: number }) => s.combined))
    const avgCombined = scores.reduce((sum: number, s: { combined: number }) => sum + s.combined, 0) / scores.length
    
    console.log(`   🎯 Combined: max=${maxCombined.toFixed(4)}, min=${minCombined.toFixed(4)}, avg=${avgCombined.toFixed(4)}`)
    
    searchResults.slice(0, 5).forEach((result: HybridSearchResult, idx: number) => {
      console.log(`   ${idx + 1}. Paper ID: ${result.paper_id}`)
      console.log(`      Combined Score: ${result.combined_score.toFixed(4)}`)
      console.log(`      Semantic Score: ${result.semantic_score.toFixed(4)}`)
      console.log(`      Keyword Score: ${result.keyword_score.toFixed(4)}`)
    })
    if (searchResults.length > 5) {
      console.log(`   ... and ${searchResults.length - 5} more results`)
    }
    
    // CRITICAL: Check why semantic scores are all 0.0000
    const allSemanticZero = searchResults.every((r: HybridSearchResult) => r.semantic_score === 0)
    if (allSemanticZero) {
      console.error(`🚨 CRITICAL: All semantic scores are 0.0000!`)
      console.error(`💡 This suggests:`)
      console.error(`   1. Papers in database have no embeddings`)
      console.error(`   2. Vector similarity function is broken`)
      console.error(`   3. Embedding dimensions don't match`)
      console.error(`   4. RPC function is using keyword-only search`)
      
      // Check if returned papers actually have embeddings
      const samplePaperIds = searchResults.slice(0, 3).map((r: HybridSearchResult) => r.paper_id)
      const { data: embeddingCheck, error: embeddingError } = await supabase
        .from('papers')
        .select('id, title, embedding')
        .in('id', samplePaperIds)
        .limit(3)
      
      if (!embeddingError && embeddingCheck) {
        console.log(`🔍 Sample paper embedding check:`)
        embeddingCheck.forEach(paper => {
          const hasEmbedding = paper.embedding && paper.embedding.length > 0
          console.log(`   📄 "${paper.title?.substring(0, 50)}...": ${hasEmbedding ? `✅ Has embedding (${paper.embedding.length} dims)` : '❌ No embedding'}`)
        })
      }
    }
  } else {
    console.warn(`⚠️ RPC returned no results - this indicates a deeper issue with vector search`)
    console.warn(`   🧠 Query embedding: ${queryEmbedding.length} dimensions`)
    console.warn(`   📅 Min year filter: ${minYear}`)
    console.warn(`   ⚖️ Semantic weight: ${semanticWeight}`)
    console.warn(`   💡 Possible issues: No papers with embeddings, year filter too restrictive, or database connectivity`)
  }

  // 3. Filter out excluded papers
  const filteredResults = (searchResults || []).filter(
    (result: HybridSearchResult) => 
      !excludePaperIds.includes(result.paper_id) &&
      result.combined_score >= 0.0001 // Reduced from 0.0001 to be more permissive
  )

  console.log(`🔧 After filtering excluded papers: ${filteredResults.length} results`)
  if (filteredResults.length !== (searchResults?.length || 0)) {
    const excludedCount = (searchResults?.length || 0) - filteredResults.length
    console.log(`   🚫 Excluded ${excludedCount} papers (${excludedCount - excludePaperIds.length} low scores, ${excludePaperIds.length} from exclude list)`)
  }

  // 4. Get full paper details for the top results
  if (filteredResults.length === 0) {
    console.warn(`⚠️ No papers found after filtering - trying more permissive approach`)
    
    // Try again with even more permissive filtering if we got 0 results
    const veryPermissiveResults = (searchResults || []).filter(
      (result: HybridSearchResult) => 
        !excludePaperIds.includes(result.paper_id) &&
        (result.combined_score > 0 || result.semantic_score > 0 || result.keyword_score > 0)
    )
    
    console.log(`🔧 Permissive filtering found: ${veryPermissiveResults.length} results`)
    
    if (veryPermissiveResults.length === 0) {
      console.warn(`⚠️ Still no papers found - returning empty result`)
      return []
    }
    
    // Use the permissive results instead
    const topPermissiveResults = veryPermissiveResults.slice(0, limit)
    console.log(`📄 Using permissive results - fetching full details for ${topPermissiveResults.length} papers...`)
    
    let papersQuery = supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .in('id', topPermissiveResults.map((r: HybridSearchResult) => r.paper_id))

    // Apply source filter if provided
    if (sources && sources.length > 0) {
      papersQuery = papersQuery.in('source', sources)
      console.log(`🏷️ Applied source filter: [${sources.join(', ')}]`)
    }

    const { data: papers, error: papersError } = await papersQuery

    if (papersError) {
      console.error(`❌ Failed to fetch paper details:`, papersError)
      throw papersError
    }

    console.log(`📚 Retrieved ${papers?.length || 0} full paper records (permissive)`)

    // Transform and sort by hybrid score
    const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
    
    const finalResults = topPermissiveResults
      .map((result: HybridSearchResult) => {
        const paper = paperMap.get(result.paper_id)
        if (!paper) {
          console.warn(`⚠️ Paper ${result.paper_id} not found in detailed results`)
          return null
        }
        
        const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
        
        return {
          ...transformedPaper,
          relevance_score: result.combined_score,
          semantic_score: result.semantic_score,
          keyword_score: result.keyword_score
        }
      })
      .filter(Boolean) as PaperWithAuthors[]

    console.log(`✅ Permissive hybrid search completed: ${finalResults.length} final papers`)
    return finalResults
  }

  // 5. Get full paper details for the top results
  const topResults = filteredResults.slice(0, limit)
  console.log(`📄 Fetching full details for top ${topResults.length} papers...`)
  
  let papersQuery = supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', topResults.map((r: HybridSearchResult) => r.paper_id))

  // Apply source filter if provided
  if (sources && sources.length > 0) {
    console.log(`🏷️ Applying source filter: [${sources.join(', ')}]`)
    // Check if any papers match the source filter before applying it
    const sourceFilterTest = await supabase
      .from('papers')
      .select('id', { count: 'exact' })
      .in('id', topResults.map((r: HybridSearchResult) => r.paper_id))
      .in('source', sources)
      .limit(1)
    
    if (sourceFilterTest.data && sourceFilterTest.data.length > 0) {
      papersQuery = papersQuery.in('source', sources)
      console.log(`✅ Source filter will be applied - ${sourceFilterTest.data.length} papers match`)
    } else {
      console.warn(`⚠️ Source filter would exclude all papers - skipping source filter`)
    }
  }

  const { data: papers, error: papersError } = await papersQuery

  if (papersError) {
    console.error(`❌ Failed to fetch paper details:`, papersError)
    throw papersError
  }

  console.log(`📚 Retrieved ${papers?.length || 0} full paper records`)
  
  // If we got 0 papers due to source filtering, try without the filter
  if ((!papers || papers.length === 0) && sources && sources.length > 0) {
    console.warn(`⚠️ Source filter returned 0 papers, retrying without source filter...`)
    
    const { data: unfilteredPapers, error: unfilteredError } = await supabase
      .from('papers')
      .select(`
        *,
        authors:paper_authors(
          ordinal,
          author:authors(*)
        )
      `)
      .in('id', topResults.map((r: HybridSearchResult) => r.paper_id))
    
    if (unfilteredError) {
      console.error(`❌ Failed to fetch unfiltered paper details:`, unfilteredError)
      throw unfilteredError
    }
    
    console.log(`📚 Retrieved ${unfilteredPapers?.length || 0} unfiltered paper records`)
    
    // Use the unfiltered results
    const paperMap = new Map(unfilteredPapers?.map(p => [p.id, p]) || [])
    
    const finalResults = topResults
      .map((result: HybridSearchResult) => {
        const paper = paperMap.get(result.paper_id)
        if (!paper) {
          console.warn(`⚠️ Paper ${result.paper_id} not found in detailed results`)
          return null
        }
        
        const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
        
        return {
          ...transformedPaper,
          relevance_score: result.combined_score,
          semantic_score: result.semantic_score,
          keyword_score: result.keyword_score
        }
      })
      .filter(Boolean) as PaperWithAuthors[]

    console.log(`✅ Unfiltered hybrid search completed: ${finalResults.length} final papers`)
    return finalResults
  }

  // Transform and sort by hybrid score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  const finalResults = topResults
    .map((result: HybridSearchResult) => {
      const paper = paperMap.get(result.paper_id)
      if (!paper) {
        console.warn(`⚠️ Paper ${result.paper_id} not found in detailed results`)
        return null
      }
      
      const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
      
      return {
        ...transformedPaper,
        relevance_score: result.combined_score,
        semantic_score: result.semantic_score,
        keyword_score: result.keyword_score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]

  return finalResults
}

export async function findSimilarPapers(
  paperId: string,
  limit = 5
): Promise<PaperWithAuthors[]> {
  const supabase = await getSB()
  
  // Get the embedding for the reference paper
  const { data: referencePaper, error: refError } = await supabase
    .from('papers')
    .select('embedding')
    .eq('id', paperId)
    .single()
  
  if (refError) throw refError
  if (!referencePaper?.embedding) {
    throw new Error('Reference paper has no embedding')
  }
  
  // Find similar papers using cosine similarity
  const { data: matches, error } = await supabase
    .rpc('find_similar_papers', {
      query_embedding: referencePaper.embedding,
      exclude_paper_id: paperId,
      match_count: limit
    })
  
  if (error) throw error
  if (!matches || matches.length === 0) return []
  
  // Get full paper details
  const { data: papers, error: papersError } = await supabase
    .from('papers')
    .select(`
      *,
      authors:paper_authors(
        ordinal,
        author:authors(*)
      )
    `)
    .in('id', (matches as SimilarPapersResult[]).map(m => m.paper_id))
  
  if (papersError) throw papersError
  
  // Transform and sort by similarity score
  const paperMap = new Map(papers?.map(p => [p.id, p]) || [])
  
  return (matches as SimilarPapersResult[])
    .map(match => {
      const paper = paperMap.get(match.paper_id)
      if (!paper) return null
      
      const transformedPaper = transformDatabasePaper(paper as DatabasePaper)
      
      return {
        ...transformedPaper,
        relevance_score: match.score
      }
    })
    .filter(Boolean) as PaperWithAuthors[]
}

// Search paper chunks for RAG with adaptive scoring
export async function searchPaperChunks(
  query: string,
  options: {
    paperIds?: string[]
    limit?: number
    minScore?: number
    adaptiveScoring?: boolean
  } = {}
): Promise<Array<{paper_id: string, content: string, score: number}>> {
  const supabase = await getSB()
  
  // Generate embedding for the query
  const [queryEmbedding] = await generateEmbeddings([query])
  
  const {
    paperIds,
    limit = 50,
    minScore = 0.1,
    adaptiveScoring = true
  } = options
  
  // Adaptive scoring: try progressively lower thresholds
  const scoreThresholds = adaptiveScoring 
    ? [0.6, 0.45, 0.3, minScore] // High → Medium → Low → User specified
    : [minScore] // Single pass with user threshold
  
  const allResults: Array<{paper_id: string, content: string, score: number}> = []
  let targetReached = false
  
  for (const threshold of scoreThresholds) {
    if (targetReached) break
    
    console.log(`🔍 Chunk search attempt with minScore=${threshold}`)
    
    // Call the RPC function with correct parameters
  const { data: searchResults, error } = await supabase
      .rpc('match_paper_chunks', {
        query_embedding: queryEmbedding,
        match_count: limit,
        min_score: threshold,
        paper_ids: paperIds || null
      })
  
  if (error) {
      console.error(`Enhanced chunk search failed at threshold ${threshold}:`, error)
      continue // Try next threshold
    }
    
    if (searchResults && searchResults.length > 0) {
      // Filter out duplicates from previous passes
      const existingIds = new Set(allResults.map(r => r.paper_id + '::' + r.content.substring(0, 100)))
      const newResults = (searchResults as Array<{paper_id: string, content: string, score: number}>).filter((result) => {
        const key = result.paper_id + '::' + result.content.substring(0, 100)
        return !existingIds.has(key)
      })
      
      allResults.push(...newResults)
      
      console.log(`   ✅ Found ${newResults.length} new chunks (${allResults.length} total)`)
      const scores = (searchResults as Array<{score: number}>).map(r => r.score)
      console.log(`   📊 Score range: ${Math.min(...scores).toFixed(3)} – ${Math.max(...scores).toFixed(3)}`)
      
      // Check if we have enough high-quality results
      if (allResults.length >= limit * 0.8 || threshold >= 0.5) {
        targetReached = true
        console.log(`   🎯 Target reached with ${allResults.length} chunks at threshold ${threshold}`)
      }
    } else {
      console.log(`   ❌ No chunks found at threshold ${threshold}`)
    }
  }
  
  // Sort by score and limit results
  const finalResults = allResults
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  
  console.log(`✅ Adaptive chunk search complete: ${finalResults.length} chunks retrieved`)
  if (adaptiveScoring && scoreThresholds.length > 1) {
    console.log(`   🔄 Used ${scoreThresholds.length} threshold levels for optimal recall`)
  }
  
  return finalResults
}


// Clean, Simple Ingestion Interface

/**
 * THE ONLY ENTRY POINT for paper ingestion - Clean Gatekeeper Architecture
 * 
 * This function is the front door that validates requests and decides whether to:
 * 1. Process immediately (for small content)
 * 2. Hand off to background queue (for PDFs and large content)
 * 3. Create metadata only (for lightweight ingestion)
 * 
 * The key insight: This function NEVER does heavy processing itself.
 * It's purely a decision-maker and dispatcher.
 * 
 * @param paperData - Complete paper metadata
 * @param options - Processing configuration
 * @returns Result with paper ID and processing status
 */
export async function ingestPaper(
  paperData: PaperDTO,
  options: { fullText?: string; pdfUrl?: string; background?: boolean; priority?: 'low' | 'normal' | 'high' } = {}
): Promise<{ paperId: string; isNew: boolean; status: 'metadata_only' | 'processed' | 'queued' }> {
  
  // 1. Check for duplicates (idempotent)
  const { exists, paperId: existingId } = await checkPaperExists(paperData.doi, paperData.title)
  if (exists && existingId) {
    console.log(`📚 Paper already exists: ${existingId}`)
    
    // If we have new content for existing paper, process it
    if (options.pdfUrl) {
      await queuePdfProcessing(existingId, options.pdfUrl, paperData.title, options.priority || 'normal')
      return { paperId: existingId, isNew: false, status: 'queued' }
    } else if (options.fullText) {
      await processContentImmediately(existingId, options.fullText)
      return { paperId: existingId, isNew: false, status: 'processed' }
    }
    
    return { paperId: existingId, isNew: false, status: 'metadata_only' }
  }

  // 2. Create the basic paper metadata record
  const newPaperId = await createPaperMetadata(paperData)
  console.log(`📚 Created new paper: ${newPaperId}`)

  // 3. Decide how to handle content
  if (options.pdfUrl) {
    // If there's a PDF URL, ALWAYS queue it for background processing
    await queuePdfProcessing(newPaperId, options.pdfUrl, paperData.title, options.priority || 'normal')
    return { paperId: newPaperId, isNew: true, status: 'queued' }
  } 
  else if (options.fullText) {
    // If raw text is provided, process it immediately (or queue if requested)
    if (options.background) {
      // TODO: Implement proper background text processing queue
      console.log(`📋 Background text processing requested for ${newPaperId} - processing immediately`)
      await processContentImmediately(newPaperId, options.fullText)
    } else {
      await processContentImmediately(newPaperId, options.fullText)
    }
    return { paperId: newPaperId, isNew: true, status: 'processed' }
  }

  // Embedding is now generated during createPaperMetadata, so we're done
    return { paperId: newPaperId, isNew: true, status: 'processed' }
}

/**
 * Create paper metadata (extracted from old ingestPaperLightweight)
 */
async function createPaperMetadata(paperData: PaperDTO): Promise<string> {
  const supabase = await getSB()
  
  // Use pre-enriched metadata (region detection handled by caller)
  const enrichedMetadata = paperData.metadata || {}
  
  // Generate embedding from title + abstract before inserting
  // This is required because the database has a NOT NULL constraint on the embedding column
  const text = `${paperData.title}\n${paperData.abstract || ''}`
  const [embedding] = await generateEmbeddings([text])
  
  // Insert paper metadata with embedding
  const { data, error } = await supabase
    .from('papers')
    .insert({
      title: paperData.title,
      abstract: paperData.abstract,
      publication_date: paperData.publication_date,
      venue: paperData.venue,
      doi: paperData.doi,
      url: paperData.url,
      pdf_url: paperData.pdf_url,
      metadata: enrichedMetadata,
      source: paperData.source || 'unknown',
      citation_count: paperData.citation_count || 0,
      impact_score: Math.max(paperData.impact_score || 0, 0),
      embedding: embedding // Generate embedding immediately to satisfy NOT NULL constraint
    })
    .select('id')
    .single()
  
  if (error) throw error
  if (!data) throw new Error('Failed to create paper - no ID returned')
  
  const paperId = data.id
  
  // Handle authors
  if (paperData.authors && paperData.authors.length > 0) {
    await upsertPaperAuthors(paperId, paperData.authors)
  }
  
  return paperId
}


/**
 * Process content immediately (synchronous)
 */
async function processContentImmediately(paperId: string, fullText: string): Promise<void> {
  // Use the new content ingestion system
  await createChunksForPaper(paperId, fullText)
}

/**
 * Queue PDF processing
 */
async function queuePdfProcessing(paperId: string, pdfUrl: string, title: string, priority: 'low' | 'normal' | 'high'): Promise<void> {
  const { PDFProcessingQueue } = await import('@/lib/services/pdf-queue')
  const queue = PDFProcessingQueue.getInstance()
  
  // Get user ID from context (for quota tracking)  
  const supabase = await getSB()
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id || 'system'
  
  await queue.addJob(paperId, pdfUrl, title, userId, priority)
}

// Optimized batch author creation to replace createOrGetAuthor loops
export async function batchCreateOrGetAuthors(authorNames: string[]): Promise<Author[]> {
  if (authorNames.length === 0) return []
  
  const supabase = await getSB()
  
  // 1. Fetch all existing authors in one query
  const { data: existingAuthors, error: fetchError } = await supabase
    .from('authors')
    .select('*')
    .in('name', authorNames)
  
  if (fetchError) throw fetchError
  
  // 2. Find which authors don't exist yet
  const existingNames = new Set(existingAuthors?.map(a => a.name) || [])
  const newAuthorNames = authorNames.filter(name => !existingNames.has(name))
  
  // 3. Insert new authors in batch with ON CONFLICT handling
  if (newAuthorNames.length > 0) {
    const { data: newAuthors, error: insertError } = await supabase
      .from('authors')
      .upsert(
        newAuthorNames.map(name => ({ name })),
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select()
    
    if (insertError) throw insertError
    
    // Combine existing and new authors
    const allAuthors = [...(existingAuthors || []), ...(newAuthors || [])]
    
    // Return in the same order as input with proper null checking
    return authorNames.map(name => {
      const author = allAuthors.find(author => author.name === name)
      if (!author) {
        throw new Error(`Author not found after creation: ${name}`)
      }
      return author
    })
  }
  
  // Return existing authors in input order with proper null checking
  return authorNames.map(name => {
    const author = existingAuthors?.find(author => author.name === name)
    if (!author) {
      throw new Error(`Author not found: ${name}`)
    }
    return author
  })
}

// Optimized paper-author relationship management
export async function upsertPaperAuthors(paperId: string, authorNames: string[]): Promise<void> {
  if (authorNames.length === 0) return
  
  const supabase = await getSB()
  
  // 1. Get all authors efficiently (using batch function)
  const authors = await batchCreateOrGetAuthors(authorNames)
  
  // 2. Get current author IDs for this paper
  const { data: currentRelations } = await supabase
    .from('paper_authors')
    .select('author_id')
    .eq('paper_id', paperId)
  
  const currentAuthorIds = new Set(currentRelations?.map(r => r.author_id) || [])
  const newAuthorIds = authors.map(a => a.id)
  
  // 3. Delete relationships that should no longer exist
  const authorsToRemove = [...currentAuthorIds].filter(id => !newAuthorIds.includes(id))
  if (authorsToRemove.length > 0) {
    await supabase
      .from('paper_authors')
      .delete()
      .eq('paper_id', paperId)
      .in('author_id', authorsToRemove)
  }
  
  // 4. Insert new relationships in batch
  const relationshipsToInsert = authors.map((author, index) => ({
    paper_id: paperId,
    author_id: author.id,
    ordinal: index + 1
  }))
  
  const { error } = await supabase
    .from('paper_authors')
    .upsert(relationshipsToInsert, {
      onConflict: 'paper_id,author_id',
      ignoreDuplicates: false
    })
  
  if (error) throw error
}

// Check if paper exists by DOI to prevent duplicates
export async function checkPaperExists(doi?: string, title?: string): Promise<{ exists: boolean, paperId?: string }> {
  const supabase = await getSB()
  
  // First check by DOI if available
  if (doi) {
    const { data, error } = await supabase
      .from('papers')
      .select('id')
      .eq('doi', doi)
      .single()
    
    if (!error && data) {
      return { exists: true, paperId: data.id }
    }
  }
  
  // Fallback: check by normalized title for papers without DOI
  if (title) {
    const normalizedTitle = title.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    
    const { data, error } = await supabase
      .from('papers')
      .select('id, title')
      .ilike('title', `%${normalizedTitle}%`)
      .limit(5)
    
    if (!error && data) {
      // Check for close title matches
      for (const paper of data) {
        const paperTitle = paper.title.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        
        // Simple similarity check - if 90% of words match
        const titleWords = normalizedTitle.split(' ')
        const paperWords = paperTitle.split(' ')
        const commonWords = titleWords.filter(word => paperWords.includes(word))
        
        if (commonWords.length / titleWords.length > 0.9) {
          return { exists: true, paperId: paper.id }
        }
      }
    }
  }
  
  return { exists: false }
}

/**
 * Update citation fields for a paper
 */
export async function updatePaperCitationFields(
  paperId: string,
  citationData: {
    volume?: string
    issue?: string
    page?: string
    publisher?: string
    isbn?: string
    issn?: string
  }
): Promise<void> {
  const supabase = await getSB()
  
  const { error } = await supabase
    .from('papers')
    .update({
      volume: citationData.volume || null,
      issue: citationData.issue || null,
      page_range: citationData.page || null,
      publisher: citationData.publisher || null,
      isbn: citationData.isbn || null,
      issn: citationData.issn || null
    })
    .eq('id', paperId)

  if (error) {
    throw new Error(`Failed to update paper citation fields: ${error.message}`)
  }

  debug.info('Updated paper citation fields', { paperId, fields: Object.keys(citationData) })
}

