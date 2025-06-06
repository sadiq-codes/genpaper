import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Import our services (note: in production you'd bundle these properly)
import { v5 as uuidv5 } from 'https://esm.sh/uuid@9.0.0'

// Types (in a real deployment, these would be imported from a shared types module)
type PaperSource = 'openalex' | 'crossref' | 'semantic_scholar' | 'arxiv' | 'core'
type PaperSources = PaperSource[]

// Namespace UUID for generating deterministic paper UUIDs
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

interface AcademicPaper {
  canonical_id: string
  title: string
  abstract: string
  year: number
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  citationCount: number
  authors?: string[]
  source: PaperSource
}

interface RankedPaper extends AcademicPaper {
  relevanceScore: number
  combinedScore: number
  bm25Score?: number
  authorityScore?: number
  recencyScore?: number
}

interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  maxResults?: number
  includePreprints?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  sources?: PaperSources
}

interface Author {
  id: string
  name: string
}

// Environment variables
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CONTACT_EMAIL = Deno.env.get('CONTACT_EMAIL') || 'research@example.com'

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Helper functions (simplified versions for the edge function)
function generatePaperUUID(input: string): string {
  return uuidv5(input, PAPER_NAMESPACE)
}

function createCanonicalId(title: string, year?: number, doi?: string): string {
  if (doi) {
    return doi.toLowerCase().trim()
  }
  
  const normalizedTitle = title.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  const input = `${normalizedTitle}${year || ''}`
  return generatePaperUUID(input)
}

function deInvertAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{word: string, positions: number[]}> = []
  
  for (const [word, positions] of Object.entries(invertedIndex)) {
    words.push({ word, positions })
  }
  
  words.sort((a, b) => Math.min(...a.positions) - Math.min(...b.positions))
  
  const result: string[] = []
  let currentPosition = 0
  
  for (const {word, positions} of words) {
    for (const pos of positions.sort((a, b) => a - b)) {
      while (result.length < pos) {
        result.push('')
      }
      result[pos] = word
      currentPosition = Math.max(currentPosition, pos + 1)
    }
  }
  
  return result.join(' ').replace(/\s+/g, ' ').trim()
}

// API integration functions
async function searchOpenAlex(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear, openAccessOnly } = options
  
  let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&mailto=${CONTACT_EMAIL}`
  
  const filters: string[] = []
  
  if (fromYear) filters.push(`from_publication_date:${fromYear}-01-01`)
  if (toYear) filters.push(`to_publication_date:${toYear}-12-31`)
  
  filters.push('type:journal-article')
  
  if (openAccessOnly) filters.push('is_oa:true')
  if (filters.length > 0) url += `&filter=${filters.join(',')}`
  
  url += '&sort=cited_by_count:desc'
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL})` }
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    return data.results?.map((work: any) => ({
      canonical_id: createCanonicalId(work.display_name, work.publication_year, work.doi),
      title: work.display_name,
      abstract: work.abstract_inverted_index ? deInvertAbstract(work.abstract_inverted_index) : '',
      year: work.publication_year || 0,
      venue: work.primary_location?.source?.display_name,
      doi: work.doi,
      url: work.primary_location?.landing_page_url,
      citationCount: work.cited_by_count || 0,
      authors: work.authorships?.map((a: any) => a.author?.display_name).filter(Boolean) || [],
      source: 'openalex' as const
    })) || []
  } catch (error) {
    console.error('OpenAlex search error:', error)
    return []
  }
}

async function searchCrossref(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear } = options
  
  let url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}&sort=score&order=desc`
  
  if (fromYear || toYear) {
    const from = fromYear ? `${fromYear}-01-01` : '1000-01-01'
    const to = toYear ? `${toYear}-12-31` : '3000-12-31'
    url += `&filter=from-pub-date:${from},until-pub-date:${to}`
  }
  
  url += '&filter=has-full-text:true'
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': `GenPaper/1.0 (mailto:${CONTACT_EMAIL})` }
    })
    
    if (!response.ok) return []
    
    const data = await response.json()
    
    return data.message?.items?.map((item: any) => {
      const title = Array.isArray(item.title) ? item.title[0] : item.title || ''
      const year = item.published?.['date-parts']?.[0]?.[0] || 0
      const doi = item.DOI
      
      return {
        canonical_id: createCanonicalId(title, year, doi),
        title,
        abstract: item.abstract || '',
        year,
        venue: item['container-title']?.[0] || '',
        doi,
        url: item.URL,
        citationCount: item['is-referenced-by-count'] || 0,
        authors: item.author?.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean) || [],
        source: 'crossref' as const
      }
    }) || []
  } catch (error) {
    console.error('Crossref search error:', error)
    return []
  }
}

async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<AcademicPaper[]> {
  const { limit = 50, fromYear, toYear } = options
  
  let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=paperId,title,abstract,year,venue,citationCount,isOpenAccess,url,authors`
  
  if (fromYear) url += `&year=${fromYear}-`
  if (toYear && !fromYear) url += `&year=-${toYear}`
  else if (toYear && fromYear) url = url.replace(`&year=${fromYear}-`, `&year=${fromYear}-${toYear}`)
  
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    
    const data = await response.json()
    
    return data.data?.map((paper: any) => ({
      canonical_id: createCanonicalId(paper.title, paper.year),
      title: paper.title,
      abstract: paper.abstract || '',
      year: paper.year || 0,
      venue: paper.venue,
      url: paper.url,
      citationCount: paper.citationCount || 0,
      authors: paper.authors?.map((a: any) => a.name).filter(Boolean) || [],
      source: 'semantic_scholar' as const
    })) || []
  } catch (error) {
    console.error('Semantic Scholar search error:', error)
    return []
  }
}

// Ranking and deduplication
function calculateBM25Score(query: string, title: string, abstract: string): number {
  const k1 = 1.2
  const b = 0.75
  
  const queryTerms = query.toLowerCase().split(/\s+/)
  const titleTerms = title.toLowerCase().split(/\s+/)
  const abstractTerms = abstract.toLowerCase().split(/\s+/)
  const allTerms = [...titleTerms, ...abstractTerms]
  
  let score = 0
  const avgDocLength = 100
  const docLength = allTerms.length
  
  for (const term of queryTerms) {
    const titleFreq = titleTerms.filter(t => t.includes(term)).length
    const abstractFreq = abstractTerms.filter(t => t.includes(term)).length
    const termFreq = titleFreq * 2 + abstractFreq
    
    if (termFreq > 0) {
      const idf = Math.log(1000 / (1 + termFreq))
      const numerator = termFreq * (k1 + 1)
      const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength))
      score += idf * (numerator / denominator)
    }
  }
  
  return score
}

function deduplicateAndRank(papers: AcademicPaper[], query: string): RankedPaper[] {
  const seen = new Set<string>()
  const deduplicated: AcademicPaper[] = []
  
  const sorted = papers.sort((a, b) => b.citationCount - a.citationCount)
  
  for (const paper of sorted) {
    if (!seen.has(paper.canonical_id)) {
      seen.add(paper.canonical_id)
      deduplicated.push(paper)
    }
  }
  
  return deduplicated.map(paper => {
    const bm25Score = calculateBM25Score(query, paper.title, paper.abstract)
    const authorityScore = Math.log10(paper.citationCount + 1) * 0.5
    const recencyScore = Math.max(0, (paper.year - (new Date().getFullYear() - 10)) * 0.1)
    
    const combinedScore = bm25Score + authorityScore + recencyScore
    
    return {
      ...paper,
      relevanceScore: bm25Score,
      combinedScore,
      bm25Score,
      authorityScore,
      recencyScore
    }
  }).sort((a, b) => b.combinedScore - a.combinedScore)
}

// Paper ingestion
async function batchCreateOrGetAuthors(authorNames: string[]): Promise<Author[]> {
  if (authorNames.length === 0) return []
  
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
    
    // Return in the same order as input
    return authorNames.map(name => {
      const author = allAuthors.find(author => author.name === name)
      if (!author) {
        throw new Error(`Author not found after creation: ${name}`)
      }
      return author
    })
  }
  
  // Return existing authors in input order
  return authorNames.map(name => {
    const author = existingAuthors?.find(author => author.name === name)
    if (!author) {
      throw new Error(`Author not found: ${name}`)
    }
    return author
  })
}

async function ingestPaper(paper: RankedPaper, searchQuery: string): Promise<string | null> {
  try {
    // Fix: Use consistent UUID generation
    const paperId = paper.doi 
      ? generatePaperUUID(paper.doi)
      : generatePaperUUID(`${paper.title}${paper.year || ''}`)
    
    // Fix: Ensure impact_score is normalized to 0-1 range (same as other services)
    const rawScore = paper.combinedScore || 0
    const normalizedImpactScore = rawScore > 0 ? 1 - 1 / (rawScore + 1) : 0
    
    // Check for PDF URL via Unpaywall if we have a DOI
    let pdfUrl = paper.pdf_url
    if (paper.doi && !pdfUrl) {
      try {
        console.log(`📄 Checking Unpaywall for DOI: ${paper.doi}`)
        const unpaywallUrl = `https://api.unpaywall.org/v2/${paper.doi}?email=${CONTACT_EMAIL}`
        const unpaywallResponse = await fetch(unpaywallUrl)
        
        if (unpaywallResponse.ok) {
          const unpaywallData = await unpaywallResponse.json()
          if (unpaywallData.is_oa && unpaywallData.best_oa_location?.url_for_pdf) {
            pdfUrl = unpaywallData.best_oa_location.url_for_pdf
            console.log(`✅ Found PDF URL via Unpaywall: ${pdfUrl}`)
          }
        }
      } catch (error) {
        console.log(`⚠️ Unpaywall lookup failed for ${paper.doi}:`, error)
        // Continue without PDF - this is not a critical failure
      }
    }
    
    const { error } = await supabase
      .from('papers')
      .upsert({
        id: paperId,
        title: paper.title,
        abstract: paper.abstract,
        publication_date: paper.year ? `${paper.year}-01-01` : null,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        pdf_url: pdfUrl, // Use the potentially updated PDF URL
        metadata: {
          search_query: searchQuery,
          found_at: new Date().toISOString(),
          relevance_score: paper.relevanceScore,
          combined_score: paper.combinedScore,
          canonical_id: paper.canonical_id,
          api_source: paper.source,
          pdf_source: pdfUrl ? (pdfUrl === paper.pdf_url ? 'original' : 'unpaywall') : null
        },
        source: `academic_search_${paper.source}`,
        citation_count: paper.citationCount,
        impact_score: normalizedImpactScore
      })
    
    if (error) throw error
    
    // Fix: Handle authors with batch operations (eliminate N+1)
    if (paper.authors && paper.authors.length > 0) {
      await upsertPaperAuthors(paperId, paper.authors)
    }
    
    return paperId
  } catch (error) {
    console.error('Paper ingestion error:', error)
    return null
  }
}

// Fix: Batch paper-author relationship management
async function upsertPaperAuthors(paperId: string, authorNames: string[]): Promise<void> {
  if (authorNames.length === 0) return
  
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

// Main fetchSources function
async function fetchSources(topic: string, options: SearchOptions = {}): Promise<RankedPaper[]> {
  console.log(`Starting fetchSources for topic: "${topic}"`)
  
  const {
    maxResults = 25,
    sources = ['openalex', 'crossref', 'semantic_scholar']
  } = options
  
  // Execute parallel searches
  const searchPromises: Promise<AcademicPaper[]>[] = []
  
  if (sources.includes('openalex')) {
    searchPromises.push(searchOpenAlex(topic, options))
  }
  
  if (sources.includes('crossref')) {
    searchPromises.push(searchCrossref(topic, options))
  }
  
  if (sources.includes('semantic_scholar')) {
    searchPromises.push(searchSemanticScholar(topic, options))
  }
  
  // Wait for all searches to complete
  const results = await Promise.all(searchPromises)
  const allPapers = results.flat()
  
  console.log(`Found ${allPapers.length} total papers`)
  
  if (allPapers.length === 0) {
    return []
  }
  
  // Deduplicate and rank
  const rankedPapers = deduplicateAndRank(allPapers, topic)
  const topPapers = rankedPapers.slice(0, maxResults)
  
  console.log(`Returning ${topPapers.length} top papers`)
  
  // Ingest papers into database
  const ingestPromises = topPapers.map(paper => ingestPaper(paper, topic))
  await Promise.all(ingestPromises)
  
  return topPapers
}

// HTTP handler
serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    const { topic, options = {} } = await req.json()
    
    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const papers = await fetchSources(topic, options)
    
    return new Response(
      JSON.stringify({
        success: true,
        topic,
        papers,
        count: papers.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('fetchSources error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}) 