#!/usr/bin/env tsx

/**
 * Bulk Paper Ingestion by Discipline from OpenAlex
 * 
 * Ingests papers across multiple disciplines with PDF processing for full-text.
 * 
 * Usage:
 *   npx tsx scripts/bulk-ingest-disciplines.ts
 *   npx tsx scripts/bulk-ingest-disciplines.ts --papers-per-discipline 10000
 *   npx tsx scripts/bulk-ingest-disciplines.ts --pdf-concurrency 5
 *   npx tsx scripts/bulk-ingest-disciplines.ts --skip-existing-pdfs
 *   npx tsx scripts/bulk-ingest-disciplines.ts --process-missing-pdfs  # Only process papers without chunks
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { chunkByTokens, normalizeText } from '@/lib/utils/text'
import { isQdrantConfigured, upsertChunks as upsertQdrantChunks, upsertPapers as upsertQdrantPapers } from '@/lib/qdrant/client'
import { isPdfFriendlyDomain } from '@/lib/config/pdf-domains'
import { v5 as uuidv5 } from 'uuid'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENALEX_BASE = 'https://api.openalex.org/works'
const PAGE_SIZE = 50     // Reduced from 200 to ease DB load
const EMBED_BATCH = 25   // Reduced from 100 to ease DB load
const DB_BATCH = 50      // Reduced from 200 to ease DB load
const DB_DELAY_MS = 2000 // Delay between DB batches to let Supabase breathe
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const PROGRESS_FILE = '.bulk-ingest-disciplines-progress.json'
const MAX_RATE_LIMIT_RETRIES = 5  // Max retries before moving on
const OPENALEX_EMAIL = 'api@genpaper.io'  // For polite pool access

// OpenAlex concept IDs for major disciplines
// Format: { name: conceptId }
const DISCIPLINES: Record<string, string> = {
  // Life Sciences
  'Biology': 'C86803240',
  'Microbiology': 'C89423630',
  'Genetics': 'C54355233',
  'Neuroscience': 'C165863068',
  'Immunology': 'C203014093',
  'Biochemistry': 'C55493867',
  'Ecology': 'C18903297',
  'Cell Biology': 'C95444343',
  
  // Physical Sciences
  'Physics': 'C121332964',
  'Chemistry': 'C185592680',
  'Materials Science': 'C192562407',
  'Astronomy': 'C1276947',
  
  // Engineering & Technology
  'Computer Science': 'C41008148',
  'Engineering': 'C127413603',
  'Artificial Intelligence': 'C154945302',
  'Machine Learning': 'C119857082',
  'Robotics': 'C80444323',
  
  // Medical & Health
  'Medicine': 'C71924100',
  'Psychology': 'C15744967',
  'Pharmacology': 'C89423630',
  
  // Earth & Environmental
  'Environmental Science': 'C39432304',
  'Geology': 'C127313418',
  'Climate Science': 'C2522874853',
  
  // Social Sciences
  'Economics': 'C162324750',
  'Sociology': 'C144024400',
  'Political Science': 'C17744445',
  
  // Mathematics
  'Mathematics': 'C33923547',
  'Statistics': 'C105795698',
}

// PDF-friendly domains - imported from central config
// See lib/config/pdf-domains.ts for the full list

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Progress {
  currentDiscipline: string
  completedDisciplines: string[]
  cursor: string | null
  totalIngested: number
  totalPdfsProcessed: number
  startedAt: string
  lastUpdated: string
}

interface OpenAlexWork {
  id: string
  doi: string | null
  title: string
  display_name?: string
  publication_date: string | null
  publication_year?: number
  abstract_inverted_index: Record<string, number[]> | null
  authorships: Array<{ author: { display_name: string } }>
  primary_location: {
    source?: { 
      display_name: string
      publisher?: string
      host_organization_name?: string
    }
    pdf_url?: string
    landing_page_url?: string
    license?: string
  } | null
  best_oa_location?: {
    pdf_url?: string
    landing_page_url?: string
    license?: string
    source?: {
      display_name?: string
      publisher?: string
      host_organization_name?: string
    }
  } | null
  open_access: { 
    is_oa?: boolean
    oa_status?: string
    oa_url: string | null 
  }
  cited_by_count: number
  concepts: Array<{ id: string; display_name: string; score: number; level?: number }>
  // Bibliographic fields
  biblio?: {
    volume?: string
    issue?: string
    first_page?: string
    last_page?: string
  }
  // Additional metadata
  type?: string  // 'article', 'book', 'dataset', etc.
  language?: string
  is_retracted?: boolean
  referenced_works_count?: number
  keywords?: Array<{ keyword: string; score?: number }>
  // External IDs
  ids?: {
    openalex?: string
    doi?: string
    pmid?: string
    pmcid?: string
    mag?: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function generatePaperId(doi: string | null, title: string): string {
  if (doi) {
    const normalized = doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').trim()
    return uuidv5(normalized, PAPER_NAMESPACE)
  }
  return uuidv5(title.toLowerCase().trim(), PAPER_NAMESPACE)
}

function invertedIndexToAbstract(index: Record<string, number[]> | null): string {
  if (!index) return ''
  const words: [string, number][] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) {
      words.push([word, pos])
    }
  }
  words.sort((a, b) => a[1] - b[1])
  return words.map(w => w[0]).join(' ')
}

// Use the centralized isPdfFriendlyDomain function from lib/config/pdf-domains.ts
const isPdfFriendlyUrl = isPdfFriendlyDomain

function getBestPdfUrl(work: OpenAlexWork): string | null {
  // Priority: best_oa_location > primary_location > open_access.oa_url
  const candidates = [
    work.best_oa_location?.pdf_url,
    work.primary_location?.pdf_url,
    work.open_access?.oa_url,
    work.best_oa_location?.landing_page_url,
    work.primary_location?.landing_page_url,
  ].filter(Boolean) as string[]
  
  // Prefer PDF-friendly URLs
  for (const url of candidates) {
    if (isPdfFriendlyUrl(url)) {
      // Convert arXiv abstract URLs to PDF URLs
      if (url.includes('arxiv.org/abs/')) {
        return url.replace('/abs/', '/pdf/') + '.pdf'
      }
      // Convert bioRxiv/medRxiv to full PDF URLs
      if ((url.includes('biorxiv.org') || url.includes('medrxiv.org')) && !url.includes('.pdf')) {
        return url + '.full.pdf'
      }
      return url
    }
  }
  return candidates[0] || null
}

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    }
  } catch {}
  return {
    currentDiscipline: '',
    completedDisciplines: [],
    cursor: null,
    totalIngested: 0,
    totalPdfsProcessed: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString()
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

// ---------------------------------------------------------------------------
// OpenAlex API
// ---------------------------------------------------------------------------

async function fetchOpenAlexPage(
  conceptId: string,
  cursor: string | null,
  minCitations: number = 5,
  retryCount: number = 0
): Promise<{ works: OpenAlexWork[]; nextCursor: string | null }> {
  const params = new URLSearchParams({
    filter: `concepts.id:${conceptId},has_abstract:true,cited_by_count:>${minCitations},publication_year:>2014`,
    select: 'id,doi,title,publication_date,abstract_inverted_index,authorships,primary_location,open_access,cited_by_count,concepts',
    per_page: String(PAGE_SIZE),
    cursor: cursor || '*',
  })
  
  // Always use email for polite pool (10x higher rate limit)
  params.set('mailto', process.env.CONTACT_EMAIL || OPENALEX_EMAIL)
  
  const url = `${OPENALEX_BASE}?${params}`
  const res = await fetch(url)
  
  if (res.status === 429) {
    if (retryCount >= MAX_RATE_LIMIT_RETRIES) {
      console.error(`  ❌ Rate limited ${MAX_RATE_LIMIT_RETRIES} times, skipping this page`)
      return { works: [], nextCursor: null }
    }
    const waitTime = Math.min(60 + retryCount * 30, 180)  // 60s, 90s, 120s, 150s, 180s
    console.warn(`  ⏳ Rate limited (attempt ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES}), waiting ${waitTime}s...`)
    await sleep(waitTime * 1000)
    return fetchOpenAlexPage(conceptId, cursor, minCitations, retryCount + 1)
  }
  
  if (!res.ok) {
    throw new Error(`OpenAlex API error ${res.status}: ${await res.text()}`)
  }
  
  const data = await res.json()
  return {
    works: data.results || [],
    nextCursor: data.meta?.next_cursor || null,
  }
}

// ---------------------------------------------------------------------------
// PDF Processing
// ---------------------------------------------------------------------------

async function processPdf(
  paperId: string,
  pdfUrl: string,
  title: string
): Promise<{ success: boolean; chunks: number; error?: string }> {
  try {
    // Download PDF
    const pdfBuffer = await downloadPdfBuffer(pdfUrl)
    
    // Extract text using GROBID
    const extraction = await extractPdfMetadataTiered(pdfBuffer, {
      grobidUrl: process.env.GROBID_URL,
      enableOcr: false,
      maxTimeoutMs: 120000,
    })
    
    if (!extraction.fullText || extraction.fullText.length < 200) {
      return { success: true, chunks: 0, error: 'No extractable text' }
    }
    
    // Create chunks
    const normalizedText = normalizeText(extraction.fullText)
    const textChunks = await chunkByTokens(normalizedText, paperId, {
      maxTokens: 500,
      overlapTokens: 80,
      minChunkTokens: 50,
    })
    
    if (textChunks.length === 0) {
      return { success: true, chunks: 0, error: 'No chunks created' }
    }
    
    // Generate embeddings
    const embeddings = await generateEmbeddings(textChunks.map(c => c.content))
    
    // Prepare chunk rows (start at index 1, index 0 is abstract)
    const chunkRows = textChunks.map((chunk, idx) => ({
      id: createDeterministicChunkId(paperId, chunk.content, idx + 1),
      paper_id: paperId,
      chunk_index: idx + 1,
      content: chunk.content,
      embedding: embeddings[idx],
    }))
    
    // Insert chunks to Supabase (without embeddings) for text storage
    const chunkRowsNoEmbedding = chunkRows.map(({ embedding, ...rest }) => rest)
    const { error: chunkError } = await supabase
      .from('paper_chunks')
      .upsert(chunkRowsNoEmbedding, { onConflict: 'id', ignoreDuplicates: true })
    
    if (chunkError) {
      return { success: false, chunks: 0, error: `DB: ${chunkError.message}` }
    }
    
    // Insert embeddings ONLY into Qdrant (not Supabase)
    if (isQdrantConfigured()) {
      try {
        await upsertQdrantChunks(chunkRows)
      } catch (qdrantErr) {
        console.warn(`  ⚠️ Qdrant PDF chunk insert failed for ${paperId}:`, qdrantErr)
      }
    } else {
      console.warn(`  ⚠️ Qdrant not configured - embeddings not stored!`)
    }
    
    // Update paper metadata
    await supabase
      .from('papers')
      .update({
        pdf_content: extraction.fullText.slice(0, 500000),
        processing_status: 'processed',
        content_source: 'pdf',
      })
      .eq('id', paperId)
    
    return { success: true, chunks: textChunks.length }
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, chunks: 0, error: msg }
  }
}

// Worker pool for parallel PDF processing
async function processWithWorkerPool<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = await processor(items[index])
      } catch (err) {
        // @ts-ignore
        results[index] = { success: false, chunks: 0, error: String(err) }
      }
    }
  }
  
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker())
  
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Main Ingestion
// ---------------------------------------------------------------------------

async function ingestDiscipline(
  name: string,
  conceptId: string,
  maxPapers: number,
  pdfConcurrency: number,
  progress: Progress
): Promise<{ ingested: number; pdfsProcessed: number }> {
  console.log(`\n📚 Ingesting: ${name} (${conceptId})`)
  console.log('─'.repeat(50))
  
  let cursor = progress.currentDiscipline === name ? progress.cursor : null
  let ingested = 0
  let pdfsProcessed = 0
  let totalChunks = 0
  const startTime = Date.now()
  
  while (ingested < maxPapers) {
    // Fetch page from OpenAlex
    const { works, nextCursor } = await fetchOpenAlexPage(conceptId, cursor)
    
    if (works.length === 0) {
      console.log(`  📭 No more papers for ${name}`)
      break
    }
    
    // Filter papers with valid data
    const validWorks = works.filter(w => 
      w.title && 
      w.abstract_inverted_index && 
      Object.keys(w.abstract_inverted_index).length > 20
    )
    
    if (validWorks.length === 0) {
      cursor = nextCursor
      continue
    }
    
    // Check for existing papers (by DOI)
    const dois = validWorks
      .map(w => w.doi?.replace(/^https?:\/\/doi\.org\//, '').toLowerCase())
      .filter(Boolean) as string[]
    
    const { data: existingPapers } = await supabase
      .from('papers')
      .select('doi')
      .in('doi', dois)
    
    const existingDois = new Set(existingPapers?.map(p => p.doi?.toLowerCase()) || [])
    
    const newWorks = validWorks.filter(w => {
      const doi = w.doi?.replace(/^https?:\/\/doi\.org\//, '').toLowerCase()
      return !doi || !existingDois.has(doi)
    })
    
    if (newWorks.length === 0) {
      cursor = nextCursor
      continue
    }
    
    // Prepare paper data with comprehensive metadata
    const papersToInsert = newWorks.slice(0, maxPapers - ingested).map(work => {
      const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '').trim() || null
      const paperId = generatePaperId(doi, work.title)
      const abstract = invertedIndexToAbstract(work.abstract_inverted_index)
      const authors = work.authorships?.map(a => a.author?.display_name).filter(Boolean) || []
      const pdfUrl = getBestPdfUrl(work)
      
      // Extract pages from biblio
      const pages = work.biblio?.first_page && work.biblio?.last_page
        ? `${work.biblio.first_page}-${work.biblio.last_page}`
        : work.biblio?.first_page || undefined
      
      // Extract keywords
      const keywords = work.keywords?.map(k => k.keyword).filter(Boolean) || []
      
      // Extract fields of study from concepts (level 0-1 with score > 0.3)
      const fieldsOfStudy = work.concepts
        ?.filter(c => (c.level ?? 0) <= 1 && (c.score ?? 0) > 0.3)
        .map(c => c.display_name) || []
      
      // Extract external IDs
      const externalIds: Record<string, string> = {}
      if (work.ids?.pmid) externalIds.pmid = work.ids.pmid
      if (work.ids?.pmcid) externalIds.pmcid = work.ids.pmcid
      if (work.ids?.mag) externalIds.mag = work.ids.mag
      
      // Get publisher from multiple sources
      const publisher = work.primary_location?.source?.publisher ||
                       work.primary_location?.source?.host_organization_name ||
                       work.best_oa_location?.source?.publisher ||
                       work.best_oa_location?.source?.host_organization_name || undefined
      
      // Get license
      const license = work.best_oa_location?.license || 
                     work.primary_location?.license || undefined
      
      // Build comprehensive metadata object
      const metadata: Record<string, unknown> = {
        openalex_id: work.id,
      }
      
      // Bibliographic fields (for citations)
      if (work.biblio?.volume) metadata.volume = work.biblio.volume
      if (work.biblio?.issue) metadata.issue = work.biblio.issue
      if (pages) metadata.pages = pages
      if (publisher) metadata.publisher = publisher
      
      // Publication type
      if (work.type) metadata.paper_type = work.type
      
      // Open access info
      if (work.open_access?.is_oa !== undefined) metadata.is_open_access = work.open_access.is_oa
      if (work.open_access?.oa_status) metadata.open_access_status = work.open_access.oa_status
      if (license) metadata.license = license
      
      // Additional metadata
      if (work.language) metadata.language = work.language
      if (work.is_retracted) metadata.is_retracted = work.is_retracted
      if (work.referenced_works_count) metadata.references_count = work.referenced_works_count
      
      // Keywords and fields of study
      if (keywords.length > 0) metadata.keywords = keywords
      if (fieldsOfStudy.length > 0) metadata.fields_of_study = fieldsOfStudy
      
      // Legacy concepts (for backwards compatibility)
      if (work.concepts?.length) {
        metadata.concepts = work.concepts.slice(0, 5).map(c => c.display_name)
      }
      
      // External IDs
      if (Object.keys(externalIds).length > 0) metadata.external_ids = externalIds
      
      return {
        id: paperId,
        doi,
        title: work.title || work.display_name || 'Untitled',
        abstract,
        authors,
        publication_date: work.publication_date || null,
        venue: work.primary_location?.source?.display_name || null,
        pdf_url: pdfUrl,
        source: 'openalex',
        citation_count: work.cited_by_count || 0,
        metadata,
        pdfUrl, // Keep for PDF processing
      }
    })
    
    // Generate embeddings for abstracts
    const abstracts = papersToInsert.map(p => `${p.title}\n${p.abstract}`)
    const embeddings = await generateEmbeddings(abstracts)
    
    // Insert papers to Supabase (WITHOUT embeddings - Qdrant only)
    const paperRows = papersToInsert.map((p) => ({
      id: p.id,
      doi: p.doi,
      title: p.title,
      abstract: p.abstract,
      authors: p.authors,
      publication_date: p.publication_date,
      venue: p.venue,
      pdf_url: p.pdf_url,
      source: p.source,
      citation_count: p.citation_count,
      metadata: p.metadata,
      // embedding: removed - Qdrant only
      processing_status: 'pending',
    }))
    
    const { error: paperError } = await supabase
      .from('papers')
      .upsert(paperRows, { onConflict: 'id', ignoreDuplicates: true })
    
    if (paperError) {
      console.error(`  ❌ Paper insert error: ${paperError.message}`)
      // On error, wait longer before retrying
      await sleep(DB_DELAY_MS * 2)
      cursor = nextCursor
      continue
    }
    
    // Delay to let Supabase breathe
    await sleep(DB_DELAY_MS)
    
    // Insert abstract chunks to Supabase (WITHOUT embeddings - Qdrant only)
    const chunkRowsForSupabase = papersToInsert.map((p) => ({
      id: createDeterministicChunkId(p.id, p.abstract, 0),
      paper_id: p.id,
      chunk_index: 0,
      content: p.abstract,
      // embedding: removed - Qdrant only
    }))
    
    await supabase
      .from('paper_chunks')
      .upsert(chunkRowsForSupabase, { onConflict: 'id', ignoreDuplicates: true })
    
    // Delay to let Supabase breathe
    await sleep(DB_DELAY_MS)
    
    // Insert embeddings ONLY into Qdrant
    if (isQdrantConfigured()) {
      try {
        // Prepare chunks with embeddings for Qdrant
        const chunkRowsForQdrant = papersToInsert.map((p, i) => ({
          id: createDeterministicChunkId(p.id, p.abstract, 0),
          paper_id: p.id,
          chunk_index: 0,
          content: p.abstract,
          embedding: embeddings[i],
        }))
        
        // Insert paper embeddings to Qdrant
        await upsertQdrantPapers(papersToInsert.map((p, i) => ({
          id: p.id,
          embedding: embeddings[i],
          title: p.title,
          doi: p.doi || undefined,
        })))
        
        // Insert chunk embeddings to Qdrant
        await upsertQdrantChunks(chunkRowsForQdrant)
      } catch (qdrantErr) {
        console.warn(`  ⚠️ Qdrant insert failed:`, qdrantErr)
      }
    } else {
      console.warn(`  ⚠️ Qdrant not configured - embeddings not stored!`)
    }
    
    ingested += papersToInsert.length
    
    // Process PDFs for papers with friendly URLs
    const papersWithPdfs = papersToInsert.filter(p => p.pdfUrl && isPdfFriendlyUrl(p.pdfUrl))
    
    if (papersWithPdfs.length > 0) {
      const pdfResults = await processWithWorkerPool(
        papersWithPdfs,
        p => processPdf(p.id, p.pdfUrl!, p.title),
        pdfConcurrency
      )
      
      const successCount = pdfResults.filter(r => r.success && r.chunks > 0).length
      const chunkCount = pdfResults.reduce((sum, r) => sum + r.chunks, 0)
      pdfsProcessed += successCount
      totalChunks += chunkCount
    }
    
    // Progress update
    const elapsed = (Date.now() - startTime) / 1000
    const rate = ingested / elapsed
    console.log(
      `  📊 ${name}: ${ingested}/${maxPapers} papers | ` +
      `${pdfsProcessed} PDFs (${totalChunks} chunks) | ` +
      `${rate.toFixed(1)}/s`
    )
    
    // Save progress
    progress.currentDiscipline = name
    progress.cursor = nextCursor
    progress.totalIngested += papersToInsert.length
    progress.totalPdfsProcessed += pdfsProcessed
    saveProgress(progress)
    
    cursor = nextCursor
    if (!cursor) break
    
    // Delay between pages to be nice to APIs and let DB recover
    await sleep(DB_DELAY_MS)
  }
  
  console.log(`  ✅ ${name} complete: ${ingested} papers, ${pdfsProcessed} PDFs`)
  return { ingested, pdfsProcessed }
}

// ---------------------------------------------------------------------------
// Process papers missing full-text chunks
// ---------------------------------------------------------------------------

async function processMissingPdfs(pdfConcurrency: number): Promise<void> {
  console.log('\n🔍 Finding papers without full-text chunks...')
  
  // Find papers with only 1 chunk (abstract) and a PDF URL
  const { data: papers, error } = await supabase
    .from('papers')
    .select('id, title, pdf_url')
    .not('pdf_url', 'is', null)
    .eq('processing_status', 'pending')
    .limit(1000)
  
  if (error || !papers) {
    console.error('Error fetching papers:', error?.message)
    return
  }
  
  // Filter to papers with PDF-friendly URLs
  const papersWithFriendlyUrls = papers.filter(p => p.pdf_url && isPdfFriendlyUrl(p.pdf_url))
  
  console.log(`Found ${papersWithFriendlyUrls.length} papers with friendly PDF URLs`)
  
  if (papersWithFriendlyUrls.length === 0) return
  
  let processed = 0
  let totalChunks = 0
  
  // Process in batches
  for (let i = 0; i < papersWithFriendlyUrls.length; i += pdfConcurrency * 2) {
    const batch = papersWithFriendlyUrls.slice(i, i + pdfConcurrency * 2)
    
    const results = await processWithWorkerPool(
      batch,
      p => processPdf(p.id, p.pdf_url!, p.title),
      pdfConcurrency
    )
    
    const successCount = results.filter(r => r.success && r.chunks > 0).length
    const chunkCount = results.reduce((sum, r) => sum + r.chunks, 0)
    processed += successCount
    totalChunks += chunkCount
    
    console.log(`  📄 Processed ${i + batch.length}/${papersWithFriendlyUrls.length} | ${processed} success | ${totalChunks} chunks`)
  }
  
  console.log(`✅ PDF processing complete: ${processed} papers, ${totalChunks} chunks`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  
  let papersPerDiscipline = 20000
  let pdfConcurrency = 3
  let processMissing = false
  let selectedDisciplines: string[] = []
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--papers-per-discipline':
        papersPerDiscipline = parseInt(args[++i], 10)
        break
      case '--pdf-concurrency':
        pdfConcurrency = parseInt(args[++i], 10)
        break
      case '--process-missing-pdfs':
        processMissing = true
        break
      case '--disciplines':
        selectedDisciplines = args[++i].split(',').map(s => s.trim())
        break
    }
  }
  
  console.log('='.repeat(60))
  console.log('📚 Multi-Discipline Paper Ingestion (OpenAlex)')
  console.log('='.repeat(60))
  console.log(`Papers per discipline: ${papersPerDiscipline.toLocaleString()}`)
  console.log(`PDF concurrency:       ${pdfConcurrency}`)
  console.log(`Embeddings:            ${getEmbeddingProviderName()}`)
  console.log(`GROBID:                ${process.env.GROBID_URL || 'Not configured'}`)
  console.log(`Disciplines:           ${selectedDisciplines.length || Object.keys(DISCIPLINES).length}`)
  console.log('='.repeat(60))
  
  // Process missing PDFs only
  if (processMissing) {
    await processMissingPdfs(pdfConcurrency)
    return
  }
  
  const progress = loadProgress()
  const disciplines = selectedDisciplines.length > 0
    ? Object.entries(DISCIPLINES).filter(([name]) => selectedDisciplines.includes(name))
    : Object.entries(DISCIPLINES)
  
  let totalIngested = 0
  let totalPdfs = 0
  
  for (const [name, conceptId] of disciplines) {
    if (progress.completedDisciplines.includes(name)) {
      console.log(`\n⏭️  Skipping ${name} (already completed)`)
      continue
    }
    
    try {
      const { ingested, pdfsProcessed } = await ingestDiscipline(
        name,
        conceptId,
        papersPerDiscipline,
        pdfConcurrency,
        progress
      )
      
      totalIngested += ingested
      totalPdfs += pdfsProcessed
      
      progress.completedDisciplines.push(name)
      progress.cursor = null
      saveProgress(progress)
      
    } catch (err) {
      console.error(`\n❌ Error processing ${name}:`, err)
      saveProgress(progress)
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Final Summary')
  console.log('='.repeat(60))
  console.log(`Total papers ingested: ${totalIngested.toLocaleString()}`)
  console.log(`Total PDFs processed:  ${totalPdfs.toLocaleString()}`)
  console.log(`Disciplines completed: ${progress.completedDisciplines.length}/${disciplines.length}`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
