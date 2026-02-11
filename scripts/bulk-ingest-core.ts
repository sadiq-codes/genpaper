/**
 * Bulk Paper Ingestion from CORE (COnnecting REpositories)
 *
 * Ingests papers from CORE that are NOT already in the database (via DOI dedup).
 * CORE aggregates from 10K+ institutional repositories, providing papers that
 * OpenAlex may have missed.
 *
 * Usage:
 *   npx tsx scripts/bulk-ingest-core.ts                        # default: 5M papers
 *   npx tsx scripts/bulk-ingest-core.ts --limit 10000          # smaller test run
 *   npx tsx scripts/bulk-ingest-core.ts --offset 1000000       # resume from offset
 *   npx tsx scripts/bulk-ingest-core.ts --resume               # resume from saved progress
 *   npx tsx scripts/bulk-ingest-core.ts --dry-run              # preview without writing
 *   npx tsx scripts/bulk-ingest-core.ts --query "computer science"  # topic filter
 *
 * Discipline Targeting:
 *   --query "machine learning"           # Keyword-based filtering
 *   --query "thesis OR dissertation"     # Target theses (often missed by OpenAlex)
 *   --query "repository:arxiv"           # Target specific repositories
 *   --doc-type thesis                    # Filter by document type
 *
 * Environment variables (required):
 *   CORE_API_KEY                  — CORE API key (get from https://core.ac.uk/services/api)
 *   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY     — Supabase service role key
 *   OPENAI_API_KEY                — OpenAI key (or set EMBEDDING_SERVER_URL for self-hosted)
 *
 * How it works:
 *   1. Fetch papers from CORE with DOI and abstract (49M+ available)
 *   2. Batch-check existing DOIs in database (skip duplicates)
 *   3. Generate embeddings for new papers only
 *   4. Insert into papers + paper_chunks tables
 *   5. Saves offset to disk for resume capability
 *
 * Rate limits:
 *   - Registered users: ~500 requests/minute
 *   - Script respects x-ratelimit-remaining header
 */

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { getServiceClient } from '@/lib/supabase/service'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { chunkByTokens, normalizeText } from '@/lib/utils/text'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CORE_API_BASE = 'https://api.core.ac.uk/v3'
const PAGE_SIZE = 100  // CORE max per page (can't increase)
const EMBED_BATCH = 100 // Papers to embed at once (increased for throughput)
const DB_BATCH = 200   // Rows to insert at once (increased)
const DOI_CHECK_BATCH = 1000 // DOIs to check at once (increased)
const PROGRESS_FILE = path.join(process.cwd(), '.bulk-ingest-core-progress.json')
const FAILED_FILE = path.join(process.cwd(), '.bulk-ingest-core-failed.json')
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const LOG_INTERVAL = 500  // Log progress every N papers ingested
const MIN_DELAY_MS = 100  // Minimum delay between API calls
const RATE_LIMIT_BUFFER = 100 // Start slowing down when this many requests remain
const CONCURRENT_API_REQUESTS = 1 // Sequential fetching for stability (CORE API can be slow)
const FETCH_TIMEOUT_MS = 60000 // Timeout for individual API requests (CORE can be slow)

// ---------------------------------------------------------------------------
// Zod Schemas (runtime validation for external API)
// ---------------------------------------------------------------------------

const CoreWorkSchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  abstract: z.string().nullable(),
  authors: z.array(z.object({
    name: z.string().nullable()
  })).nullable(),
  doi: z.string().nullable(),
  publishedDate: z.string().nullable(),
  yearPublished: z.number().nullable(),
  publisher: z.string().nullable(),
  journals: z.array(z.object({
    title: z.string().nullable()
  })).nullable(),
  downloadUrl: z.string().nullable(),
  documentType: z.string().nullable(),
  language: z.object({
    code: z.string().nullable()
  }).nullable(),
  citationCount: z.number().nullable(),
  fieldOfStudy: z.string().nullable(),
  fullText: z.string().nullable(),
})

const CoreResponseSchema = z.object({
  totalHits: z.number(),
  limit: z.number(),
  offset: z.number(),
  results: z.array(CoreWorkSchema),
})

type CoreWork = z.infer<typeof CoreWorkSchema>
type CoreResponse = z.infer<typeof CoreResponseSchema>

interface Progress {
  offset: number
  totalIngested: number
  totalSkipped: number
  totalDuplicates: number
  totalErrors: number
  query: string
  startedAt: string
  lastUpdated: string
}

interface FailedPaper {
  coreId: number
  doi: string | null
  title: string
  error: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Process items with a streaming worker pool.
 * As soon as one worker finishes, it picks up the next item.
 * More efficient than batch-based processing.
 */
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
        // @ts-ignore - caller handles error shape
        results[index] = { success: false, chunks: 0, error: err }
      }
    }
  }
  
  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker())
  
  await Promise.all(workers)
  return results
}

function generatePaperId(doi: string | null, title: string, year: number | null, authors: string[]): string {
  if (doi) {
    const normalized = doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
    return uuidv5(normalized, PAPER_NAMESPACE)
  }
  const firstAuthor = authors[0]?.toLowerCase().trim() || ''
  const key = [title.toLowerCase().trim(), firstAuthor, year ? String(year) : ''].filter(Boolean).join('|')
  return uuidv5(key, PAPER_NAMESPACE)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    limit: 5_000_000,
    offset: 0,
    dryRun: false,
    resume: false,
    query: '_exists_:doi AND _exists_:abstract', // Default: papers with DOI and abstract
    docType: null as string | null,
    yearFrom: null as number | null,
    yearTo: null as number | null,
    withPdfs: false,
    pdfConcurrency: 2,
  }

  let i = 0
  while (i < args.length) {
    switch (args[i]) {
      case '--limit':
        opts.limit = parseInt(args[++i], 10)
        i++
        break
      case '--offset':
        opts.offset = parseInt(args[++i], 10)
        i++
        break
      case '--resume':
        opts.resume = true
        i++
        break
      case '--dry-run':
        opts.dryRun = true
        i++
        break
      case '--query':
        opts.query = args[++i]
        i++
        break
      case '--doc-type':
        opts.docType = args[++i]
        i++
        break
      case '--year-from':
        opts.yearFrom = parseInt(args[++i], 10)
        i++
        break
      case '--year-to':
        opts.yearTo = parseInt(args[++i], 10)
        i++
        break
      case '--with-pdfs':
        opts.withPdfs = true
        i++
        break
      case '--pdf-concurrency':
        opts.pdfConcurrency = parseInt(args[++i], 10)
        i++
        break
      default:
        i++
    }
  }

  return opts
}

function saveProgress(progress: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

function loadProgress(): Progress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    }
  } catch (err) {
    console.warn('⚠️ Failed to load progress file:', err instanceof Error ? err.message : err)
  }
  return null
}

function loadFailedPapers(): FailedPaper[] {
  try {
    if (fs.existsSync(FAILED_FILE)) {
      return JSON.parse(fs.readFileSync(FAILED_FILE, 'utf-8'))
    }
  } catch (err) {
    console.warn('⚠️ Failed to load failed papers file:', err instanceof Error ? err.message : err)
  }
  return []
}

function saveFailedPapers(papers: FailedPaper[]) {
  fs.writeFileSync(FAILED_FILE, JSON.stringify(papers, null, 2))
}

function appendFailedPapers(newFailures: FailedPaper[]) {
  if (newFailures.length === 0) return
  const existing = loadFailedPapers()
  const existingIds = new Set(existing.map(p => p.coreId))
  const unique = newFailures.filter(p => !existingIds.has(p.coreId))
  saveFailedPapers([...existing, ...unique])
}

// ---------------------------------------------------------------------------
// DOI Deduplication
// ---------------------------------------------------------------------------

async function getExistingDois(dois: string[]): Promise<Set<string>> {
  if (dois.length === 0) return new Set()
  
  const supabase = getServiceClient()
  const normalizedDois = dois.map(d => d.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim())
  
  const { data, error } = await supabase
    .from('papers')
    .select('doi')
    .in('doi', normalizedDois)
  
  if (error) {
    console.error('Error checking existing DOIs:', error.message)
    return new Set()
  }
  
  return new Set((data || []).map(p => p.doi?.toLowerCase()).filter(Boolean))
}

// ---------------------------------------------------------------------------
// CORE API Fetcher
// ---------------------------------------------------------------------------

async function fetchCorePage(
  query: string,
  offset: number,
  apiKey: string,
  docType?: string | null,
  yearFrom?: number | null,
  yearTo?: number | null,
): Promise<{ data: CoreResponse; rateLimitRemaining: number }> {
  // Build query with filters
  let fullQuery = query
  
  // Add document type filter if specified
  if (docType) {
    fullQuery += ` AND documentType:${docType}`
  }
  
  // Add year range filter if specified
  if (yearFrom || yearTo) {
    const fromYear = yearFrom || 1900
    const toYear = yearTo || new Date().getFullYear()
    fullQuery += ` AND yearPublished:[${fromYear} TO ${toYear}]`
  }
  
  const params = new URLSearchParams({
    q: fullQuery,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    // Request specific fields to reduce payload
    // exclude: 'fullText', // Keep payload smaller
  })

  const url = `${CORE_API_BASE}/search/works/?${params.toString()}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'GenPaper-BulkIngest/1.0',
      },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  const rateLimitRemaining = parseInt(res.headers.get('x-ratelimit-remaining') || '500', 10)

  if (res.status === 429) {
    const retryAfter = res.headers.get('x-ratelimit-retry-after')
    console.warn(`⏳ Rate limited. Retry after: ${retryAfter}`)
    // Wait until the reset time
    const resetTime = retryAfter ? new Date(retryAfter).getTime() : Date.now() + 60000
    const waitMs = Math.max(resetTime - Date.now(), 60000)
    console.warn(`   Waiting ${(waitMs / 1000).toFixed(0)}s...`)
    await sleep(waitMs)
    return fetchCorePage(query, offset, apiKey, docType, yearFrom, yearTo)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Retry on 500 errors (CORE backend issues)
    if (res.status >= 500 && res.status < 600) {
      console.warn(`⚠️ CORE API error ${res.status}, retrying in 5s...`)
      await sleep(5000)
      return fetchCorePage(query, offset, apiKey, docType, yearFrom, yearTo)
    }
    throw new Error(`CORE API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const parsed = CoreResponseSchema.safeParse(json)
  
  if (!parsed.success) {
    console.error('CORE response validation failed:', parsed.error.issues.slice(0, 3))
    // Fall back to unvalidated data with warning
    console.warn('⚠️ Proceeding with unvalidated response')
    return { data: json as CoreResponse, rateLimitRemaining }
  }
  
  return { data: parsed.data, rateLimitRemaining }
}

// ---------------------------------------------------------------------------
// Batch DB Operations
// ---------------------------------------------------------------------------

async function batchInsertPapers(
  papers: Array<{
    id: string
    title: string
    abstract: string
    authors: string[]
    publication_date: string | undefined
    venue: string | undefined
    doi: string | undefined
    pdf_url: string | undefined
    source: string
    citation_count: number
    embedding: number[]
    metadata: Record<string, unknown> | null
  }>
) {
  const supabase = getServiceClient()

  const rows = papers.map((p) => ({
    id: p.id,
    title: p.title,
    abstract: p.abstract,
    authors: p.authors,
    publication_date: p.publication_date,
    venue: p.venue,
    doi: p.doi,
    pdf_url: p.pdf_url,
    source: p.source,
    citation_count: p.citation_count,
    embedding: p.embedding,
    metadata: p.metadata,
    owner_id: null,       // Global paper
    is_public: false,
    processing_status: 'processed',
  }))

  const { error } = await supabase
    .from('papers')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })

  if (error) {
    throw new Error(`Papers insert failed: ${error.message}`)
  }
}

async function batchInsertChunks(
  chunks: Array<{
    id: string
    paper_id: string
    chunk_index: number
    content: string
    embedding: number[]
  }>
) {
  const supabase = getServiceClient()

  // Strip embeddings — Supabase stores text only; Qdrant stores vectors
  const rowsWithoutEmbedding = chunks.map(({ embedding, ...rest }) => rest)

  const { error } = await supabase
    .from('paper_chunks')
    .upsert(rowsWithoutEmbedding, { onConflict: 'id', ignoreDuplicates: true })

  if (error) {
    throw new Error(`Chunks insert failed: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs()
  const apiKey = process.env.CORE_API_KEY

  if (!apiKey) {
    console.error('❌ CORE_API_KEY environment variable required')
    console.error('   Get one at: https://core.ac.uk/services/api')
    process.exit(1)
  }

  // Resume support
  let progress: Progress = {
    offset: opts.offset,
    totalIngested: 0,
    totalSkipped: 0,
    totalDuplicates: 0,
    totalErrors: 0,
    query: opts.query,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }

  if (opts.resume) {
    const saved = loadProgress()
    if (saved) {
      progress = saved
      console.log(`📂 Resuming from saved progress:`)
      console.log(`   Offset: ${progress.offset}`)
      console.log(`   Ingested: ${progress.totalIngested}`)
      console.log(`   Duplicates skipped: ${progress.totalDuplicates}`)
    }
  }

  console.log('='.repeat(60))
  console.log('📚 Bulk Paper Ingestion (CORE)')
  console.log('='.repeat(60))
  console.log(`Target:         ${opts.limit.toLocaleString()} new papers`)
  console.log(`Query:          ${opts.query}`)
  if (opts.docType) console.log(`Document type:  ${opts.docType}`)
  if (opts.yearFrom || opts.yearTo) {
    console.log(`Year range:     ${opts.yearFrom || '1900'} – ${opts.yearTo || 'now'}`)
  }
  console.log(`Embeddings:     ${getEmbeddingProviderName()}`)
  console.log(`Dry run:        ${opts.dryRun}`)
  console.log(`Start offset:   ${progress.offset}`)
  console.log(`Already done:   ${progress.totalIngested.toLocaleString()}`)
  console.log('='.repeat(60))

  const startTime = Date.now()
  let lastRateLimitRemaining = 500

  // First request to get total count
  const firstPage = await fetchCorePage(opts.query, 0, apiKey, opts.docType, opts.yearFrom, opts.yearTo)
  console.log(`\n📊 CORE reports ${firstPage.data.totalHits.toLocaleString()} matching papers\n`)

  // Process a batch of works (used by both sequential and parallel processing)
  async function processBatch(works: CoreWork[]): Promise<{ ingested: number; errors: number }> {
    if (works.length === 0) return { ingested: 0, errors: 0 }

    // Embedding input: title + abstract
    const texts = works.map(work => `${work.title}\n${work.abstract}`)

    let embeddings: number[][]
    try {
      embeddings = await generateEmbeddings(texts)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ❌ Embedding failed for batch of ${works.length}:`, errorMsg)
      const failures: FailedPaper[] = works.map(work => ({
        coreId: work.id,
        doi: work.doi,
        title: work.title || 'Unknown',
        error: `Embedding: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      }))
      appendFailedPapers(failures)
      return { ingested: 0, errors: works.length }
    }

    // Prepare paper rows + chunk rows
    const paperRows: Parameters<typeof batchInsertPapers>[0] = []
    const chunkRows: Parameters<typeof batchInsertChunks>[0] = []

    for (let i = 0; i < works.length; i++) {
      const work = works[i]
      const embedding = embeddings[i]

      const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
      const authors = work.authors?.map(a => a.name).filter((n): n is string => Boolean(n)) || []
      const paperId = generatePaperId(doi || null, work.title!, work.yearPublished, authors)

      const venue = work.journals?.[0]?.title || work.publisher || undefined

      const metadata: Record<string, unknown> = {
        coreId: work.id,
      }
      if (work.documentType) metadata.documentType = work.documentType
      if (work.language?.code) metadata.language = work.language.code
      if (work.fieldOfStudy) metadata.fieldOfStudy = work.fieldOfStudy

      paperRows.push({
        id: paperId,
        title: work.title!,
        abstract: work.abstract!,
        authors,
        publication_date: work.publishedDate || (work.yearPublished ? `${work.yearPublished}-01-01` : undefined),
        venue,
        doi,
        pdf_url: work.downloadUrl || undefined,
        source: 'core',
        citation_count: work.citationCount || 0,
        embedding,
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
      })

      // One abstract chunk per paper for immediate RAG
      const chunkId = createDeterministicChunkId(paperId, work.abstract!, 0)
      chunkRows.push({
        id: chunkId,
        paper_id: paperId,
        chunk_index: 0,
        content: work.abstract!,
        embedding,
      })
    }

    // Batch insert (papers first, then chunks due to FK constraint)
    try {
      for (let d = 0; d < paperRows.length; d += DB_BATCH) {
        await batchInsertPapers(paperRows.slice(d, d + DB_BATCH))
        await batchInsertChunks(chunkRows.slice(d, d + DB_BATCH))
      }
      
      // Process PDFs if enabled - using streaming worker pool
      if (opts.withPdfs) {
        const papersWithPdfs = works
          .filter(w => w.downloadUrl)
          .map(w => ({
            paperId: generatePaperId(
              w.doi?.replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim() || null,
              w.title!,
              w.yearPublished,
              w.authors?.map(a => a.name).filter((n): n is string => Boolean(n)) || []
            ),
            pdfUrl: w.downloadUrl!,
            title: w.title || 'Unknown'
          }))
        
        if (papersWithPdfs.length > 0) {
          console.log(`  📄 Processing ${papersWithPdfs.length} PDFs (concurrency: ${opts.pdfConcurrency})...`)
          const results = await processWithWorkerPool<
            { paperId: string; pdfUrl: string; title: string },
            { success: boolean; chunks: number }
          >(
            papersWithPdfs,
            (p) => processPdf(p.paperId, p.pdfUrl, p.title),
            opts.pdfConcurrency
          )
          const pdfSuccess = results.filter((r) => r.success).length
          const pdfFailed = results.filter((r) => !r.success).length
          const totalChunks = results.reduce((sum, r) => sum + r.chunks, 0)
          console.log(`  📄 PDFs: ${pdfSuccess} processed (${totalChunks} chunks), ${pdfFailed} failed`)
        }
      }
      
      return { ingested: works.length, errors: 0 }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ❌ DB insert failed:`, errorMsg)
      const failures: FailedPaper[] = works.map(work => ({
        coreId: work.id,
        doi: work.doi,
        title: work.title || 'Unknown',
        error: `DB: ${errorMsg}`,
        timestamp: new Date().toISOString(),
      }))
      appendFailedPapers(failures)
      return { ingested: 0, errors: works.length }
    }
  }
  
  // PDF processing function
  async function processPdf(paperId: string, pdfUrl: string, title: string): Promise<{ success: boolean; chunks: number }> {
    try {
      // Download PDF
      const pdfBuffer = await downloadPdfBuffer(pdfUrl)
      
      // Extract text using GROBID or fallback
      const extraction = await extractPdfMetadataTiered(pdfBuffer, {
        grobidUrl: process.env.GROBID_URL,
        enableOcr: false, // Skip OCR for speed
        maxTimeoutMs: 60000
      })
      
      if (!extraction.fullText || extraction.fullText.length < 100) {
        return { success: true, chunks: 0 }
      }
      
      // Create chunks from full text
      const normalizedText = normalizeText(extraction.fullText)
      const textChunks = await chunkByTokens(normalizedText, paperId, {
        maxTokens: 500,
        overlapTokens: 80,
        minChunkTokens: 50
      })
      
      if (textChunks.length === 0) {
        return { success: true, chunks: 0 }
      }
      
      // Generate embeddings
      const embeddings = await generateEmbeddings(textChunks.map(c => c.content))
      
      // Prepare chunk rows (start at index 1, index 0 is abstract)
      const chunkRows = textChunks.map((chunk, idx) => ({
        id: createDeterministicChunkId(paperId, chunk.content, idx + 1),
        paper_id: paperId,
        chunk_index: idx + 1,
        content: chunk.content,
        embedding: embeddings[idx]
      }))
      
      // Insert chunks
      const supabase = getServiceClient()
      const chunkRowsNoEmbedding = chunkRows.map(({ embedding, ...rest }) => rest)
      const { error: chunkError } = await supabase
        .from('paper_chunks')
        .upsert(chunkRowsNoEmbedding, { onConflict: 'id', ignoreDuplicates: true })
      
      if (chunkError) {
        console.warn(`    ⚠️ Chunk insert failed for ${title.slice(0, 30)}: ${chunkError.message}`)
        return { success: false, chunks: 0 }
      }
      
      // Update paper with extracted content
      const contentSource = ['grobid', 'text-layer'].includes(extraction.extractionMethod) ? 'pdf' : 'abstract-only'
      await supabase
        .from('papers')
        .update({
          pdf_content: extraction.fullText.slice(0, 500000),
          processing_status: 'processed',
          content_source: contentSource
        })
        .eq('id', paperId)
      
      return { success: true, chunks: textChunks.length }
      
    } catch (err) {
      // Silent fail - PDF processing is best-effort
      return { success: false, chunks: 0 }
    }
  }

  while (progress.totalIngested < opts.limit) {
    // 1. Fetch multiple pages in parallel for higher throughput
    const pagePromises: Promise<{ data: CoreResponse; rateLimitRemaining: number }>[] = []
    const offsets: number[] = []
    
    for (let p = 0; p < CONCURRENT_API_REQUESTS; p++) {
      const offset = progress.offset + (p * PAGE_SIZE)
      offsets.push(offset)
      pagePromises.push(
        fetchCorePage(opts.query, offset, apiKey, opts.docType, opts.yearFrom, opts.yearTo)
          .catch(err => {
            console.error(`  ❌ Failed to fetch offset ${offset}:`, err instanceof Error ? err.message : err)
            return { data: { totalHits: 0, limit: 0, offset: 0, results: [] }, rateLimitRemaining: 500 }
          })
      )
    }
    
    const pages = await Promise.all(pagePromises)
    
    // Combine all results
    let allResults: CoreWork[] = []
    for (const { data: page, rateLimitRemaining } of pages) {
      lastRateLimitRemaining = Math.min(lastRateLimitRemaining, rateLimitRemaining)
      if (page.results && page.results.length > 0) {
        allResults = allResults.concat(page.results)
      }
    }
    
    if (allResults.length === 0) {
      console.log('📭 No more results from CORE')
      break
    }

    // 2. Extract DOIs and check for duplicates (batch check for all pages)
    const worksWithDoi = allResults.filter(w => w.doi && w.title && w.abstract)
    const dois = worksWithDoi.map(w => w.doi!).filter(Boolean)
    
    let existingDois = new Set<string>()
    if (!opts.dryRun && dois.length > 0) {
      existingDois = await getExistingDois(dois)
    }

    // 3. Filter to new papers only
    const newWorks = worksWithDoi.filter(w => {
      const normalizedDoi = w.doi!.toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '').trim()
      return !existingDois.has(normalizedDoi)
    })

    const duplicateCount = worksWithDoi.length - newWorks.length
    progress.totalDuplicates += duplicateCount
    progress.totalSkipped += allResults.length - worksWithDoi.length

    if (newWorks.length === 0) {
      progress.offset += PAGE_SIZE * CONCURRENT_API_REQUESTS
      
      if (progress.offset % (PAGE_SIZE * 20) === 0) {
        console.log(`  ⏭️  Offset ${progress.offset}: All ${allResults.length} papers already in DB or invalid`)
      }
      
      const delay = lastRateLimitRemaining < RATE_LIMIT_BUFFER ? MIN_DELAY_MS * 3 : MIN_DELAY_MS
      await sleep(delay)
      continue
    }

    if (opts.dryRun) {
      for (const work of newWorks) {
        console.log(`  [DRY] ${work.title?.slice(0, 60)} | DOI: ${work.doi}`)
        progress.totalIngested++
      }
      progress.offset += PAGE_SIZE * CONCURRENT_API_REQUESTS
      continue
    }

    // 4. Process in parallel embedding batches for higher throughput
    const batchPromises: Promise<{ ingested: number; errors: number }>[] = []
    for (let b = 0; b < newWorks.length; b += EMBED_BATCH) {
      const batch = newWorks.slice(b, b + EMBED_BATCH)
      batchPromises.push(processBatch(batch))
    }
    
    const batchResults = await Promise.all(batchPromises)
    
    for (const result of batchResults) {
      progress.totalIngested += result.ingested
      progress.totalErrors += result.errors
    }

    // 5. Advance offset + save progress
    progress.offset += PAGE_SIZE * CONCURRENT_API_REQUESTS
    progress.lastUpdated = new Date().toISOString()
    saveProgress(progress)

    // Log progress
    const elapsed = (Date.now() - startTime) / 1000
    const rate = progress.totalIngested / elapsed
    const remaining = opts.limit - progress.totalIngested
    const eta = remaining > 0 && rate > 0 ? remaining / rate : 0

    if (progress.totalIngested % LOG_INTERVAL < EMBED_BATCH * CONCURRENT_API_REQUESTS) {
      console.log(
        `  📊 ${progress.totalIngested.toLocaleString()} ingested | ` +
        `${progress.totalDuplicates.toLocaleString()} dupes | ` +
        `${progress.totalSkipped.toLocaleString()} skipped | ` +
        `${progress.totalErrors} errors | ` +
        `${rate.toFixed(1)} papers/s | ` +
        `ETA: ${(eta / 3600).toFixed(1)}h | ` +
        `Rate limit: ${lastRateLimitRemaining}`
      )
    }

    // Adaptive delay based on rate limit remaining
    const delay = lastRateLimitRemaining < RATE_LIMIT_BUFFER 
      ? MIN_DELAY_MS * 3 
      : MIN_DELAY_MS
    await sleep(delay)
  }

  // Clean up progress file on completion
  if (progress.totalIngested >= opts.limit) {
    try { 
      fs.unlinkSync(PROGRESS_FILE) 
    } catch {
      // File might not exist, that's fine
    }
  }

  const totalElapsed = (Date.now() - startTime) / 1000
  const failedPapers = loadFailedPapers()

  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary')
  console.log('='.repeat(60))
  console.log(`Ingested:    ${progress.totalIngested.toLocaleString()}`)
  console.log(`Duplicates:  ${progress.totalDuplicates.toLocaleString()} (already in DB)`)
  console.log(`Skipped:     ${progress.totalSkipped.toLocaleString()} (no DOI/abstract)`)
  console.log(`Errors:      ${progress.totalErrors}`)
  console.log(`Time:        ${(totalElapsed / 60).toFixed(1)} minutes`)
  console.log(`Rate:        ${(progress.totalIngested / totalElapsed).toFixed(1)} papers/s`)
  if (failedPapers.length > 0) {
    console.log(`Failed:      ${failedPapers.length} papers queued in ${FAILED_FILE}`)
  }
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
