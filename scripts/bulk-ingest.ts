/**
 * Bulk Paper Ingestion from OpenAlex
 *
 * Pre-indexes academic papers so autocomplete has instant access to a
 * global corpus via pgvector search.
 *
 * Usage:
 *   npx tsx scripts/bulk-ingest.ts                        # default: 5M papers, last 10 years, cited>5
 *   npx tsx scripts/bulk-ingest.ts --limit 10000          # smaller test run
 *   npx tsx scripts/bulk-ingest.ts --min-citations 20     # higher quality filter
 *   npx tsx scripts/bulk-ingest.ts --year-from 2020       # recent only
 *   npx tsx scripts/bulk-ingest.ts --cursor "..."         # resume from cursor
 *   npx tsx scripts/bulk-ingest.ts --resume               # resume from saved progress
 *   npx tsx scripts/bulk-ingest.ts --dry-run              # preview without writing
 *   npx tsx scripts/bulk-ingest.ts --retry-failed         # retry papers that failed previously
 *
 * PDF Processing (for long-running server jobs):
 *   npx tsx scripts/bulk-ingest.ts --with-pdfs            # download & process PDFs
 *   npx tsx scripts/bulk-ingest.ts --with-pdfs --pdf-min-citations 50  # only PDFs for highly-cited
 *   npx tsx scripts/bulk-ingest.ts --with-pdfs --pdf-concurrency 3     # parallel PDF downloads
 *
 * Environment variables (required):
 *   CONTACT_EMAIL               — polite pool access for OpenAlex (no rate limits)
 *   NEXT_PUBLIC_SUPABASE_URL    — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase service role key
 *   OPENAI_API_KEY              — OpenAI key (or set EMBEDDING_SERVER_URL for self-hosted)
 *   EMBEDDING_SERVER_URL        — self-hosted embedding server (optional)
 *   GROBID_URL                  — GROBID server URL for PDF extraction (optional)
 *
 * How it works:
 *   1. Cursor-paginate through OpenAlex /works endpoint (200 papers per page)
 *   2. Batch-generate embeddings (50 at a time via embedding server)
 *   3. Batch-insert into papers + paper_chunks tables
 *   4. Each paper gets one abstract chunk for immediate RAG availability
 *   5. Optionally download PDFs, extract full text, create multiple chunks
 *   6. Saves cursor to disk for resume capability
 *
 * Cost estimate (5M papers, metadata only):
 *   - OpenAI text-embedding-3-small: ~$60-100 one-time
 *   - Self-hosted all-MiniLM-L6-v2: $0 (just compute time, ~24-48 hours)
 *
 * Cost estimate with PDF processing (highly-cited subset):
 *   - Storage: ~100GB for 100K papers with PDFs
 *   - Compute: significantly longer runtime (days for full corpus)
 */

// Load environment variables from .env.local
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { getServiceClient } from '@/lib/supabase/service'
import { generateEmbeddings } from '@/lib/utils/embedding'
import { getEmbeddingProviderName } from '@/lib/ai/vercel-client'
import { createDeterministicChunkId } from '@/lib/utils/deterministic-id'
import { downloadPdfBuffer } from '@/lib/pdf/pdf-utils'
import { extractPdfMetadataTiered } from '@/lib/pdf/tiered-extractor'
import { chunkByTokens, normalizeText } from '@/lib/utils/text'
import { isQdrantConfigured, upsertChunks as upsertQdrantChunks, upsertPapers as upsertQdrantPapers } from '@/lib/qdrant/client'
import { isPdfFriendlyDomain } from '@/lib/config/pdf-domains'
import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPENALEX_BASE = 'https://api.openalex.org/works'
const PAGE_SIZE = 200  // OpenAlex max per page
const EMBED_BATCH = 50 // Papers to embed at once
const DB_BATCH = 100   // Rows to insert at once
const PROGRESS_FILE = path.join(process.cwd(), '.bulk-ingest-progress.json')
const FAILED_FILE = path.join(process.cwd(), '.bulk-ingest-failed.json')
const PDF_QUEUE_FILE = path.join(process.cwd(), '.bulk-ingest-pdf-queue.json')
const PAPER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const LOG_INTERVAL_PAGES = 10  // Log progress every N pages
const DEFAULT_PDF_CONCURRENCY = 2  // Parallel PDF downloads
const DEFAULT_PDF_MIN_CITATIONS = 50  // Only process PDFs for highly-cited papers

// PDF-friendly domains - imported from central config
// See lib/config/pdf-domains.ts for the full list

// ---------------------------------------------------------------------------
// Zod Schemas (runtime validation for external API)
// ---------------------------------------------------------------------------

const OpenAlexWorkSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  publication_year: z.number().nullable(),
  publication_date: z.string().nullable().optional(), // ISO 8601 date, e.g. "2018-02-13"
  doi: z.string().nullable(),
  abstract_inverted_index: z.record(z.array(z.number())).nullable(),
  authorships: z.array(z.object({
    author: z.object({ display_name: z.string() }).nullable()
  })).nullable(),
  primary_location: z.object({
    source: z.object({
      display_name: z.string(),
      publisher: z.string().optional()
    }).nullable(),
    pdf_url: z.string().nullable()
  }).nullable(),
  best_oa_location: z.object({ pdf_url: z.string().nullable() }).nullable(),
  open_access: z.object({ is_oa: z.boolean() }).nullable(),
  cited_by_count: z.number(),
  biblio: z.object({
    volume: z.string().nullable(),
    issue: z.string().nullable(),
    first_page: z.string().nullable(),
    last_page: z.string().nullable()
  }).nullable()
})

const OpenAlexResponseSchema = z.object({
  results: z.array(OpenAlexWorkSchema),
  meta: z.object({
    count: z.number(),
    per_page: z.number(),
    next_cursor: z.string().nullable()
  })
})

type OpenAlexWork = z.infer<typeof OpenAlexWorkSchema>
type OpenAlexResponse = z.infer<typeof OpenAlexResponseSchema>

interface Progress {
  cursor: string | null
  totalIngested: number
  totalSkipped: number
  totalErrors: number
  startedAt: string
  lastUpdated: string
}

interface FailedPaper {
  doi: string | null
  title: string
  openalexId: string
  error: string
  timestamp: string
}

interface PdfQueueItem {
  paperId: string
  pdfUrl: string
  doi: string | null
  title: string
  citationCount: number
  queuedAt: string
}

interface PdfProgress {
  totalQueued: number
  totalProcessed: number
  totalFailed: number
  lastProcessedAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function deInvertAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{ word: string; position: number }> = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      words.push({ word, position })
    }
  }
  return words
    .sort((a, b) => a.position - b.position)
    .map((w) => w.word)
    .join(' ')
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
    yearFrom: new Date().getFullYear() - 10,
    yearTo: null as number | null, // null = no upper bound (current year)
    minCitations: 5,
    dryRun: false,
    cursor: null as string | null,
    resume: false,
    retryFailed: false,
    // PDF processing options
    withPdfs: false,
    pdfMinCitations: DEFAULT_PDF_MIN_CITATIONS,
    pdfConcurrency: DEFAULT_PDF_CONCURRENCY,
    processPdfQueue: false,  // Process queued PDFs only (no new ingestion)
  }

  let i = 0
  while (i < args.length) {
    switch (args[i]) {
      case '--limit':
        opts.limit = parseInt(args[++i], 10)
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
      case '--min-citations':
        opts.minCitations = parseInt(args[++i], 10)
        i++
        break
      case '--cursor':
        opts.cursor = args[++i]
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
      case '--retry-failed':
        opts.retryFailed = true
        i++
        break
      case '--with-pdfs':
        opts.withPdfs = true
        i++
        break
      case '--pdf-min-citations':
        opts.pdfMinCitations = parseInt(args[++i], 10)
        i++
        break
      case '--pdf-concurrency':
        opts.pdfConcurrency = parseInt(args[++i], 10)
        i++
        break
      case '--process-pdf-queue':
        opts.processPdfQueue = true
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

// ---------------------------------------------------------------------------
// Failed Papers Queue (for retry)
// ---------------------------------------------------------------------------

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
  // Dedupe by openalexId
  const existingIds = new Set(existing.map(p => p.openalexId))
  const unique = newFailures.filter(p => !existingIds.has(p.openalexId))
  saveFailedPapers([...existing, ...unique])
}

// ---------------------------------------------------------------------------
// PDF Queue Management
// ---------------------------------------------------------------------------

function loadPdfQueue(): PdfQueueItem[] {
  try {
    if (fs.existsSync(PDF_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(PDF_QUEUE_FILE, 'utf-8'))
    }
  } catch (err) {
    console.warn('⚠️ Failed to load PDF queue file:', err instanceof Error ? err.message : err)
  }
  return []
}

function savePdfQueue(queue: PdfQueueItem[]) {
  fs.writeFileSync(PDF_QUEUE_FILE, JSON.stringify(queue, null, 2))
}

function appendToPdfQueue(items: PdfQueueItem[]) {
  if (items.length === 0) return
  const existing = loadPdfQueue()
  const existingIds = new Set(existing.map(p => p.paperId))
  const unique = items.filter(p => !existingIds.has(p.paperId))
  savePdfQueue([...existing, ...unique])
}

// ---------------------------------------------------------------------------
// PDF Processing Functions
// ---------------------------------------------------------------------------

/**
 * Process a single PDF: download, extract text, create chunks
 * NOTE: We do NOT store the PDF file itself - only the extracted text chunks
 * This saves significant storage costs while retaining full-text RAG capability
 */
async function processSinglePdf(
  item: PdfQueueItem,
  dryRun: boolean
): Promise<{ success: boolean; chunksCreated: number; error?: string }> {
  const { paperId, pdfUrl, title } = item
  
  if (dryRun) {
    console.log(`  [DRY PDF] ${title.slice(0, 50)} | ${pdfUrl.slice(0, 50)}...`)
    return { success: true, chunksCreated: 0 }
  }

  try {
    // 1. Download PDF (temporarily, for text extraction only)
    console.log(`  📥 Downloading: ${title.slice(0, 40)}...`)
    const pdfBuffer = await downloadPdfBuffer(pdfUrl)

    // 2. Extract text using tiered extractor
    console.log(`  🔍 Extracting text...`)
    const extraction = await extractPdfMetadataTiered(pdfBuffer, {
      grobidUrl: process.env.GROBID_URL,
      enableOcr: true,
      maxTimeoutMs: 120000
    })

    // PDF buffer is now discarded (garbage collected) - we only keep extracted text

    if (!extraction.fullText || extraction.fullText.length < 100) {
      // Keep paper but mark as abstract-only
      return { success: true, chunksCreated: 0, error: 'No extractable text' }
    }

    // 3. Create chunks from full text
    const normalizedText = normalizeText(extraction.fullText)
    const textChunks = await chunkByTokens(normalizedText, paperId, {
      maxTokens: 500,
      overlapTokens: 80,
      minChunkTokens: 50
    })

    if (textChunks.length === 0) {
      return { success: true, chunksCreated: 0, error: 'No chunks created' }
    }

    // 4. Generate embeddings for all chunks
    const chunkContents = textChunks.map(c => c.content)
    const embeddings = await generateEmbeddings(chunkContents)

    // 5. Prepare chunk rows (start at index 1, index 0 is reserved for abstract)
    const chunkRows = textChunks.map((chunk, idx) => ({
      id: createDeterministicChunkId(paperId, chunk.content, idx + 1),
      paper_id: paperId,
      chunk_index: idx + 1,
      content: chunk.content,
      embedding: embeddings[idx]
    }))

    // 6. Insert chunks and update paper metadata
    const supabase = getServiceClient()
    
    // Insert chunks to Supabase WITHOUT embeddings (Qdrant only)
    const chunkRowsWithoutEmbedding = chunkRows.map(({ embedding, ...rest }) => rest)
    const { error: chunkError } = await supabase
      .from('paper_chunks')
      .upsert(chunkRowsWithoutEmbedding, { onConflict: 'paper_id,chunk_index', ignoreDuplicates: true })
    
    if (chunkError) {
      return { success: false, chunksCreated: 0, error: `Chunk insert: ${chunkError.message}` }
    }

    // Insert embeddings to Qdrant only
    if (isQdrantConfigured()) {
      try {
        await upsertQdrantChunks(chunkRows)
      } catch (qdrantErr) {
        console.warn(`  ⚠️ Qdrant PDF chunk insert failed for ${paperId}:`, qdrantErr)
      }
    }

    // Update paper metadata (keep original pdf_url as external reference)
    // Store extracted text in pdf_content for backup/reference
    // Map extraction method to valid content_source values: 'pdf', 'html', 'abstract-only'
    const contentSource = ['grobid', 'text-layer', 'ocr', 'fallback'].includes(extraction.extractionMethod)
      ? 'pdf'
      : extraction.extractionMethod === 'doi-lookup'
        ? 'abstract-only'  // DOI lookup only gets metadata, not full text
        : 'pdf'  // Default to 'pdf' for any PDF-derived content
    
    const { error: updateError } = await supabase
      .from('papers')
      .update({
        pdf_content: extraction.fullText.slice(0, 1000000), // Limit to 1M chars
        processing_status: 'processed',
        content_source: contentSource
      })
      .eq('id', paperId)

    if (updateError) {
      console.warn(`  ⚠️ Failed to update paper ${paperId}: ${updateError.message}`)
    }

    console.log(`  ✅ Processed: ${textChunks.length} chunks from ${title.slice(0, 40)}`)
    return { success: true, chunksCreated: textChunks.length }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { success: false, chunksCreated: 0, error: errorMsg }
  }
}

/**
 * Process PDF queue with concurrency control
 */
async function processPdfQueue(concurrency: number, dryRun: boolean): Promise<void> {
  const queue = loadPdfQueue()
  
  if (queue.length === 0) {
    console.log('📭 No PDFs in queue to process')
    return
  }

  console.log('='.repeat(60))
  console.log('📄 Processing PDF Queue')
  console.log('='.repeat(60))
  console.log(`PDFs to process: ${queue.length}`)
  console.log(`Concurrency:     ${concurrency}`)
  console.log(`Dry run:         ${dryRun}`)
  console.log('='.repeat(60))

  let processed = 0
  let succeeded = 0
  let failed = 0
  let totalChunks = 0
  const stillQueued: PdfQueueItem[] = []
  const startTime = Date.now()

  // Process in batches with concurrency
  for (let i = 0; i < queue.length; i += concurrency) {
    const batch = queue.slice(i, i + concurrency)
    
    const results = await Promise.all(
      batch.map(item => processSinglePdf(item, dryRun))
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      const item = batch[j]
      processed++

      if (result.success) {
        succeeded++
        totalChunks += result.chunksCreated
      } else {
        failed++
        // Re-queue failed items (but limit retries by checking timestamp)
        const queuedDate = new Date(item.queuedAt)
        const hoursSinceQueued = (Date.now() - queuedDate.getTime()) / (1000 * 60 * 60)
        if (hoursSinceQueued < 72) { // Keep in queue for up to 72 hours
          stillQueued.push(item)
        }
        console.log(`  ❌ Failed: ${item.title.slice(0, 40)} - ${result.error}`)
      }
    }

    // Progress update
    if (processed % 10 === 0 || processed === queue.length) {
      const elapsed = (Date.now() - startTime) / 1000
      const rate = processed / elapsed
      console.log(
        `  📊 ${processed}/${queue.length} | ` +
        `✅ ${succeeded} | ❌ ${failed} | ` +
        `📑 ${totalChunks} chunks | ` +
        `${rate.toFixed(1)} PDFs/s`
      )
    }

    // Small delay between batches
    if (i + concurrency < queue.length) {
      await sleep(500)
    }
  }

  // Update queue file
  savePdfQueue(stillQueued)

  const totalElapsed = (Date.now() - startTime) / 1000
  console.log('\n' + '='.repeat(60))
  console.log('📊 PDF Processing Summary')
  console.log('='.repeat(60))
  console.log(`Processed: ${processed}`)
  console.log(`Succeeded: ${succeeded}`)
  console.log(`Failed:    ${failed}`)
  console.log(`Chunks:    ${totalChunks}`)
  console.log(`Time:      ${(totalElapsed / 60).toFixed(1)} minutes`)
  if (stillQueued.length > 0) {
    console.log(`Remaining: ${stillQueued.length} (will retry)`)
  }
  console.log('='.repeat(60))
}

// ---------------------------------------------------------------------------
// OpenAlex Fetcher
// ---------------------------------------------------------------------------

async function fetchPage(
  cursor: string | null,
  yearFrom: number,
  yearTo: number | null,
  minCitations: number,
  email: string
): Promise<OpenAlexResponse> {
  // Build filter: has abstract, minimum citations, year range
  const filters: string[] = [
    'has_abstract:true',
    'type:article|review',
    `cited_by_count:>${minCitations}`,
  ]
  if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`)
  if (yearTo !== null) filters.push(`to_publication_date:${yearTo}-12-31`)

  const params = new URLSearchParams({
    filter: filters.join(','),
    per_page: String(PAGE_SIZE),
    sort: 'cited_by_count:desc',
    // Include publication_date for precise dates
    select: 'id,display_name,publication_year,publication_date,doi,abstract_inverted_index,authorships,primary_location,best_oa_location,open_access,cited_by_count,biblio',
    mailto: email,
  })

  if (cursor) {
    params.set('cursor', cursor)
  } else {
    params.set('cursor', '*') // initial cursor
  }

  const url = `${OPENALEX_BASE}?${params.toString()}`

  const res = await fetch(url, {
    headers: { 'User-Agent': `GenPaper-BulkIngest/1.0 (mailto:${email})` },
  })

  if (res.status === 429) {
    console.warn('⏳ Rate limited, waiting 30s...')
    await sleep(30_000)
    return fetchPage(cursor, yearFrom, yearTo, minCitations, email)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAlex API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const parsed = OpenAlexResponseSchema.safeParse(json)
  
  if (!parsed.success) {
    console.error('OpenAlex response validation failed:', parsed.error.issues.slice(0, 3))
    // Fall back to unvalidated data with warning (API may have added new fields)
    console.warn('⚠️ Proceeding with unvalidated response - check for API changes')
    return json as OpenAlexResponse
  }
  
  return parsed.data
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
    embedding: number[]  // Used for Qdrant only
    metadata: Record<string, unknown> | null
  }>
) {
  const supabase = getServiceClient()

  // Insert to Supabase WITHOUT embeddings (Qdrant only)
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
    // embedding: removed - Qdrant only
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

  // Insert embeddings to Qdrant only
  if (isQdrantConfigured()) {
    try {
      await upsertQdrantPapers(papers.map(p => ({
        id: p.id,
        embedding: p.embedding,
        title: p.title,
        doi: p.doi,
      })))
    } catch (qdrantErr) {
      console.warn(`  ⚠️ Qdrant paper insert failed:`, qdrantErr)
    }
  } else {
    console.warn(`  ⚠️ Qdrant not configured - paper embeddings not stored!`)
  }
}

async function batchInsertChunks(
  chunks: Array<{
    id: string
    paper_id: string
    chunk_index: number
    content: string
    embedding: number[]  // Used for Qdrant only
  }>
) {
  const supabase = getServiceClient()

  // Insert to Supabase WITHOUT embeddings (Qdrant only)
  const rowsWithoutEmbedding = chunks.map(({ embedding, ...rest }) => rest)
  
  const { error } = await supabase
    .from('paper_chunks')
    .upsert(rowsWithoutEmbedding, { onConflict: 'paper_id,chunk_index', ignoreDuplicates: true })

  if (error) {
    throw new Error(`Chunks insert failed: ${error.message}`)
  }

  // Insert embeddings to Qdrant only
  if (isQdrantConfigured()) {
    try {
      await upsertQdrantChunks(chunks)
    } catch (qdrantErr) {
      console.warn(`  ⚠️ Qdrant chunk insert failed:`, qdrantErr)
    }
  } else {
    console.warn(`  ⚠️ Qdrant not configured - chunk embeddings not stored!`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs()
  const email = process.env.CONTACT_EMAIL || process.env.EMAIL

  if (!email) {
    console.error('❌ CONTACT_EMAIL or EMAIL environment variable required for OpenAlex polite pool')
    process.exit(1)
  }

  // Handle retry-failed mode
  if (opts.retryFailed) {
    await retryFailedPapers(email, opts.dryRun)
    return
  }

  // Handle PDF queue processing mode
  if (opts.processPdfQueue) {
    await processPdfQueue(opts.pdfConcurrency, opts.dryRun)
    return
  }

  // Resume support
  let progress: Progress = {
    cursor: opts.cursor,
    totalIngested: 0,
    totalSkipped: 0,
    totalErrors: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }

  if (opts.resume) {
    const saved = loadProgress()
    if (saved) {
      progress = saved
      console.log(`📂 Resuming from saved progress: ${progress.totalIngested} papers ingested, cursor: ${progress.cursor?.slice(0, 20)}...`)
    }
  }

  console.log('='.repeat(60))
  console.log('📚 Bulk Paper Ingestion (OpenAlex)')
  console.log('='.repeat(60))
  console.log(`Target:         ${opts.limit.toLocaleString()} papers`)
  console.log(`Year range:     ${opts.yearFrom} – ${opts.yearTo || 'now'}`)
  console.log(`Min citations:  ${opts.minCitations}`)
  console.log(`Email:          ${email}`)
  console.log(`Embeddings:     ${getEmbeddingProviderName()}`)
  console.log(`Dry run:        ${opts.dryRun}`)
  console.log(`Already done:   ${progress.totalIngested.toLocaleString()}`)
  if (opts.withPdfs) {
    console.log(`PDF processing: enabled (citations >= ${opts.pdfMinCitations}, OA only)`)
    console.log(`PDF concurrency: ${opts.pdfConcurrency}`)
  }
  console.log('='.repeat(60))

  const startTime = Date.now()
  let pageCount = 0

  while (progress.totalIngested + progress.totalSkipped < opts.limit) {
    // 1. Fetch a page from OpenAlex
    const page = await fetchPage(
      progress.cursor,
      opts.yearFrom,
      opts.yearTo,
      opts.minCitations,
      email
    )

    if (!page.results || page.results.length === 0) {
      console.log('📭 No more results from OpenAlex')
      break
    }

    pageCount++

    // First page: log total available
    if (pageCount === 1 && !opts.resume) {
      console.log(`\n📊 OpenAlex reports ${page.meta.count.toLocaleString()} matching papers\n`)
    }

    // 2. Filter papers with usable abstracts
    const validWorks: Array<{ work: OpenAlexWork; abstract: string; authors: string[] }> = []

    for (const work of page.results) {
      if (!work.display_name || work.display_name.length < 5) continue
      if (!work.abstract_inverted_index) {
        progress.totalSkipped++
        continue
      }

      const abstract = deInvertAbstract(work.abstract_inverted_index)
      if (abstract.length < 30) {
        progress.totalSkipped++
        continue
      }

      const authors = work.authorships
        ?.map((a) => a.author?.display_name)
        .filter((n): n is string => Boolean(n)) || []

      validWorks.push({ work, abstract, authors })
    }

    if (validWorks.length === 0) {
      progress.cursor = page.meta.next_cursor
      if (!progress.cursor) break
      continue
    }

    if (opts.dryRun) {
      for (const { work, abstract } of validWorks) {
        console.log(`  [DRY] ${work.display_name.slice(0, 70)} | citations: ${work.cited_by_count} | abstract: ${abstract.length} chars`)
        progress.totalIngested++
      }
      progress.cursor = page.meta.next_cursor
      if (!progress.cursor) break
      continue
    }

    // 3. Generate embeddings in sub-batches
    for (let b = 0; b < validWorks.length; b += EMBED_BATCH) {
      const batch = validWorks.slice(b, b + EMBED_BATCH)

      // Embedding input: title + abstract (same as createPaperMetadata)
      const texts = batch.map(({ work, abstract }) => `${work.display_name}\n${abstract}`)

      let embeddings: number[][]
      try {
        embeddings = await generateEmbeddings(texts)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`  ❌ Embedding failed for batch of ${batch.length}:`, errorMsg)
        progress.totalErrors += batch.length
        // Queue failed papers for retry
        const failures: FailedPaper[] = batch.map(({ work }) => ({
          doi: work.doi,
          title: work.display_name,
          openalexId: work.id,
          error: `Embedding: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        }))
        appendFailedPapers(failures)
        continue
      }

      // 4. Prepare paper rows + chunk rows
      const paperRows: Parameters<typeof batchInsertPapers>[0] = []
      const chunkRows: Parameters<typeof batchInsertChunks>[0] = []

      for (let i = 0; i < batch.length; i++) {
        const { work, abstract, authors } = batch[i]
        const embedding = embeddings[i]

        const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '') || undefined
        const paperId = generatePaperId(doi || null, work.display_name, work.publication_year, authors)

        const pdfUrl = work.best_oa_location?.pdf_url || work.primary_location?.pdf_url || undefined

        const pages = work.biblio?.first_page && work.biblio?.last_page
          ? `${work.biblio.first_page}-${work.biblio.last_page}`
          : work.biblio?.first_page || undefined

        const metadata: Record<string, unknown> = {}
        if (work.biblio?.volume) metadata.volume = work.biblio.volume
        if (work.biblio?.issue) metadata.issue = work.biblio.issue
        if (pages) metadata.pages = pages
        if (work.primary_location?.source?.publisher) metadata.publisher = work.primary_location.source.publisher

        paperRows.push({
          id: paperId,
          title: work.display_name,
          abstract,
          authors,
          // Prefer precise publication_date, fall back to year-01-01
          publication_date: work.publication_date || (work.publication_year ? `${work.publication_year}-01-01` : undefined),
          venue: work.primary_location?.source?.display_name || undefined,
          doi,
          pdf_url: pdfUrl,
          source: 'openalex',
          citation_count: work.cited_by_count || 0,
          embedding,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        })

        // One abstract chunk per paper for immediate RAG
        const chunkId = createDeterministicChunkId(paperId, abstract, 0)
        chunkRows.push({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: abstract,
          embedding,
        })
      }

      // 5. Batch insert (papers first, then chunks due to FK constraint)
      try {
        // Insert in sub-batches to avoid payload size limits
        for (let d = 0; d < paperRows.length; d += DB_BATCH) {
          // Insert papers first (chunks have FK to papers)
          await batchInsertPapers(paperRows.slice(d, d + DB_BATCH))
          // Then insert chunks
          await batchInsertChunks(chunkRows.slice(d, d + DB_BATCH))
        }
        progress.totalIngested += batch.length

        // 6. Queue PDFs for processing if enabled and paper meets criteria
        if (opts.withPdfs) {
          const pdfQueueItems: PdfQueueItem[] = []
          for (let i = 0; i < batch.length; i++) {
            const { work, authors } = batch[i]
            const pdfUrl = work.best_oa_location?.pdf_url || work.primary_location?.pdf_url
            const isOpenAccess = work.open_access?.is_oa === true
            
            // Only queue if:
            // 1. Has PDF URL
            // 2. Meets citation threshold
            // 3. Is truly open access
            // 4. Domain is known to allow programmatic downloads (avoids 403 errors)
            if (pdfUrl && 
                work.cited_by_count >= opts.pdfMinCitations && 
                isOpenAccess && 
                isPdfFriendlyDomain(pdfUrl)) {
              const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '') || null
              const paperId = generatePaperId(doi, work.display_name, work.publication_year, authors)
              
              pdfQueueItems.push({
                paperId,
                pdfUrl,
                doi,
                title: work.display_name,
                citationCount: work.cited_by_count,
                queuedAt: new Date().toISOString()
              })
            }
          }
          
          if (pdfQueueItems.length > 0) {
            appendToPdfQueue(pdfQueueItems)
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`  ❌ DB insert failed:`, errorMsg)
        progress.totalErrors += batch.length
        // Queue failed papers for retry
        const failures: FailedPaper[] = batch.map(({ work }) => ({
          doi: work.doi,
          title: work.display_name,
          openalexId: work.id,
          error: `DB: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        }))
        appendFailedPapers(failures)
      }
    }

    // 6. Advance cursor + save progress
    progress.cursor = page.meta.next_cursor
    progress.lastUpdated = new Date().toISOString()
    saveProgress(progress)

    // Log progress
    const elapsed = (Date.now() - startTime) / 1000
    const rate = progress.totalIngested / elapsed
    const remaining = opts.limit - progress.totalIngested - progress.totalSkipped
    const eta = remaining > 0 ? remaining / rate : 0

    // Log progress every N pages for consistent updates
    if (pageCount % LOG_INTERVAL_PAGES === 0) {
      console.log(
        `  📊 ${progress.totalIngested.toLocaleString()} ingested | ` +
        `${progress.totalSkipped.toLocaleString()} skipped | ` +
        `${progress.totalErrors} errors | ` +
        `${rate.toFixed(0)} papers/s | ` +
        `ETA: ${(eta / 3600).toFixed(1)}h`
      )
    }

    if (!progress.cursor) {
      console.log('📭 Reached end of OpenAlex results')
      break
    }

    // Small delay to be polite (OpenAlex is generous but no need to hammer)
    await sleep(100)
  }

  // Clean up progress file on completion
  if (progress.totalIngested + progress.totalSkipped >= opts.limit || !progress.cursor) {
    try { 
      fs.unlinkSync(PROGRESS_FILE) 
    } catch (err) {
      // File might not exist, that's fine
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('⚠️ Failed to clean up progress file:', err instanceof Error ? err.message : err)
      }
    }
  }

  const totalElapsed = (Date.now() - startTime) / 1000
  const failedPapers = loadFailedPapers()
  const pdfQueue = loadPdfQueue()

  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary')
  console.log('='.repeat(60))
  console.log(`Ingested:  ${progress.totalIngested.toLocaleString()}`)
  console.log(`Skipped:   ${progress.totalSkipped.toLocaleString()}`)
  console.log(`Errors:    ${progress.totalErrors}`)
  console.log(`Time:      ${(totalElapsed / 60).toFixed(1)} minutes`)
  console.log(`Rate:      ${(progress.totalIngested / totalElapsed).toFixed(0)} papers/s`)
  if (failedPapers.length > 0) {
    console.log(`Failed:    ${failedPapers.length} papers queued in ${FAILED_FILE}`)
    console.log(`           Run with --retry-failed to retry them`)
  }
  if (pdfQueue.length > 0) {
    console.log(`PDF Queue: ${pdfQueue.length} papers awaiting PDF processing`)
    console.log(`           Run with --process-pdf-queue to process them`)
  }
  console.log('='.repeat(60))
}

// ---------------------------------------------------------------------------
// Retry Failed Papers
// ---------------------------------------------------------------------------

async function retryFailedPapers(email: string, dryRun: boolean) {
  const failedPapers = loadFailedPapers()
  
  if (failedPapers.length === 0) {
    console.log('📭 No failed papers to retry')
    return
  }

  console.log('='.repeat(60))
  console.log('🔄 Retrying Failed Papers')
  console.log('='.repeat(60))
  console.log(`Papers to retry: ${failedPapers.length}`)
  console.log(`Dry run:         ${dryRun}`)
  console.log('='.repeat(60))

  let successCount = 0
  let stillFailedCount = 0
  const stillFailed: FailedPaper[] = []

  // Process in batches
  for (let i = 0; i < failedPapers.length; i += EMBED_BATCH) {
    const batch = failedPapers.slice(i, i + EMBED_BATCH)
    const openalexIds = batch.map(p => p.openalexId.replace('https://openalex.org/', ''))
    
    // Fetch fresh data from OpenAlex
    const url = `${OPENALEX_BASE}?filter=openalex:${openalexIds.join('|')}&per_page=${EMBED_BATCH}&mailto=${email}`
    
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `GenPaper-BulkIngest/1.0 (mailto:${email})` },
      })
      
      if (!res.ok) {
        throw new Error(`OpenAlex error ${res.status}`)
      }
      
      const json = await res.json()
      const parsed = OpenAlexResponseSchema.safeParse(json)
      const works = parsed.success ? parsed.data.results : (json as OpenAlexResponse).results

      if (dryRun) {
        for (const work of works) {
          console.log(`  [DRY RETRY] ${work.display_name.slice(0, 60)}`)
          successCount++
        }
        continue
      }

      // Process same as main loop
      const validWorks: Array<{ work: OpenAlexWork; abstract: string; authors: string[] }> = []
      
      for (const work of works) {
        if (!work.abstract_inverted_index) continue
        const abstract = deInvertAbstract(work.abstract_inverted_index)
        if (abstract.length < 30) continue
        const authors = work.authorships
          ?.map((a) => a.author?.display_name)
          .filter((n): n is string => Boolean(n)) || []
        validWorks.push({ work, abstract, authors })
      }

      if (validWorks.length === 0) continue

      const texts = validWorks.map(({ work, abstract }) => `${work.display_name}\n${abstract}`)
      const embeddings = await generateEmbeddings(texts)

      const paperRows: Parameters<typeof batchInsertPapers>[0] = []
      const chunkRows: Parameters<typeof batchInsertChunks>[0] = []

      for (let j = 0; j < validWorks.length; j++) {
        const { work, abstract, authors } = validWorks[j]
        const embedding = embeddings[j]
        const doi = work.doi?.replace(/^https?:\/\/doi\.org\//, '') || undefined
        const paperId = generatePaperId(doi || null, work.display_name, work.publication_year, authors)
        const pdfUrl = work.best_oa_location?.pdf_url || work.primary_location?.pdf_url || undefined
        const pages = work.biblio?.first_page && work.biblio?.last_page
          ? `${work.biblio.first_page}-${work.biblio.last_page}`
          : work.biblio?.first_page || undefined

        const metadata: Record<string, unknown> = {}
        if (work.biblio?.volume) metadata.volume = work.biblio.volume
        if (work.biblio?.issue) metadata.issue = work.biblio.issue
        if (pages) metadata.pages = pages
        if (work.primary_location?.source?.publisher) metadata.publisher = work.primary_location.source.publisher

        paperRows.push({
          id: paperId,
          title: work.display_name,
          abstract,
          authors,
          publication_date: work.publication_date || (work.publication_year ? `${work.publication_year}-01-01` : undefined),
          venue: work.primary_location?.source?.display_name || undefined,
          doi,
          pdf_url: pdfUrl,
          source: 'openalex',
          citation_count: work.cited_by_count || 0,
          embedding,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        })

        const chunkId = createDeterministicChunkId(paperId, abstract, 0)
        chunkRows.push({
          id: chunkId,
          paper_id: paperId,
          chunk_index: 0,
          content: abstract,
          embedding,
        })
      }

      await Promise.all([
        batchInsertPapers(paperRows),
        batchInsertChunks(chunkRows),
      ])

      successCount += validWorks.length
      console.log(`  ✅ Retried ${validWorks.length} papers successfully`)
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`  ❌ Retry failed for batch:`, errorMsg)
      stillFailedCount += batch.length
      // Keep these in the failed queue with updated error
      for (const paper of batch) {
        stillFailed.push({
          ...paper,
          error: `Retry: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        })
      }
    }

    await sleep(100)
  }

  // Update failed papers file
  if (stillFailed.length > 0) {
    saveFailedPapers(stillFailed)
  } else {
    try { fs.unlinkSync(FAILED_FILE) } catch { /* ignore */ }
  }

  console.log('\n' + '='.repeat(60))
  console.log('📊 Retry Summary')
  console.log('='.repeat(60))
  console.log(`Succeeded:     ${successCount}`)
  console.log(`Still failed:  ${stillFailedCount}`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
