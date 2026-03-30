import pLimit from 'p-limit'
import { getPaperReferences } from './academic-apis'
import { checkPaperExists, createPaperMetadata } from '@/lib/db/papers'
import { createChunksForPaper } from '@/lib/content/ingestion'
import { getOrExtractFullText } from '@/lib/services/pdf-processor'
import { tryHtmlFallbackFromDoi, tryEuropePmcFullText, normalizeDoiForLookup } from '@/lib/content/html-extractor'
import type { PaperDTO } from '@/lib/schemas/paper'
import { getServiceClient } from '@/lib/supabase/service'
import {
  extractPaper,
  saveExtractionService,
  hasExtractionService,
} from '@/lib/extraction'
import {
  normalizePaperProcessingStatus,
  isFullTextReadyStatus,
  canMarkFullTextReady,
} from '@/lib/content/processing-status'
import { setPaperProcessingStatus } from '@/lib/content/processing-status-service'
import { normalizeTitle } from '@/lib/search/deduplication'
import type { RankedPaper } from '@/lib/services/paper-aggregation'
import { parseStorageObjectUrl } from '@/lib/supabase/storage-buckets'

type PdfFailureType =
  | 'paywall-or-landing'
  | 'timeout'
  | 'http-4xx'
  | 'http-5xx'
  | 'invalid-pdf'
  | 'too-large'
  | 'network'
  | 'unknown'

type ProcessingMode = 'metadata' | 'full'
type PersistentPdfFetchStatus = 'ok' | 'permanent_fail' | 'transient_fail'

interface PaperLock {
  mode: ProcessingMode
  promise: Promise<PaperProcessResult>
}

export interface PaperProcessResult {
  paperId: string
  paper: RankedPaper
}

export interface BulkPaperProcessResult {
  papers: RankedPaper[]
  paperIds: string[]
}

export interface EnsurePaperContentOptions {
  /**
   * When true, do not enqueue structured findings extraction from ingestion.
   * Use this when extraction is handled in a separate, explicit call.
   */
  skipStructuredExtraction?: boolean
  /**
   * When true, block until structured extraction is finished.
   * Use this for pipeline steps that require extraction to be present before continuing.
   */
  waitForStructuredExtraction?: boolean
  /** Optional cancellation signal from generation pipeline */
  signal?: AbortSignal
}

export interface BulkPaperProcessingOptions extends EnsurePaperContentOptions {
  concurrency?: number
}

export interface EnsurePaperContentByIdOptions extends EnsurePaperContentOptions {
  searchQuery?: string
}

export interface BulkPaperProcessingByIdOptions extends EnsurePaperContentByIdOptions {
  concurrency?: number
}

export interface SchedulePaperContentPreparationOptions extends EnsurePaperContentByIdOptions {
  reason?: string
}

export interface ScheduleBulkPaperContentPreparationOptions extends BulkPaperProcessingByIdOptions {
  reason?: string
}

export interface BulkMetadataRegistrationOptions {
  concurrency?: number
}

interface PaperRecordForIngestion {
  id: string
  title: string | null
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  pdf_url: string | null
  citation_count: number | null
  authors: unknown
  metadata: Record<string, unknown> | null
  source: string | null
}

const paperProcessingLocks = new Map<string, PaperLock>()
const TRANSIENT_PDF_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000

function getMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return { ...(value as Record<string, unknown>) }
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePersistentPdfFetchStatus(value: unknown): PersistentPdfFetchStatus | null {
  if (value === 'ok' || value === 'permanent_fail' || value === 'transient_fail') {
    return value
  }
  return null
}

function classifyPersistentPdfFailure(failureType: PdfFailureType): Exclude<PersistentPdfFetchStatus, 'ok'> {
  if (
    failureType === 'paywall-or-landing' ||
    failureType === 'http-4xx' ||
    failureType === 'invalid-pdf' ||
    failureType === 'too-large'
  ) {
    return 'permanent_fail'
  }
  return 'transient_fail'
}

function shouldRetrySupabaseStoragePdf(
  metadata: Record<string, unknown>,
  pdfUrl?: string | null
): boolean {
  if (!pdfUrl || !parseStorageObjectUrl(pdfUrl)) {
    return false
  }

  const status = normalizePersistentPdfFetchStatus(metadata.pdf_fetch_status)
  if (status !== 'permanent_fail') {
    return false
  }

  const reason = typeof metadata.pdf_fail_reason === 'string'
    ? metadata.pdf_fail_reason.toLowerCase()
    : ''

  return reason.includes('http-4xx') || reason.includes('bucket not found')
}

function getPdfAttemptSkipReason(
  metadata: Record<string, unknown>,
  pdfUrl?: string | null
): string | null {
  if (shouldRetrySupabaseStoragePdf(metadata, pdfUrl)) {
    return null
  }

  const status = normalizePersistentPdfFetchStatus(metadata.pdf_fetch_status)
  if (status === 'permanent_fail') {
    return 'previous permanent PDF failure'
  }
  if (status !== 'transient_fail') {
    return null
  }

  const lastAttemptMs = parseTimestampMs(metadata.pdf_last_attempt_at)
  if (!lastAttemptMs) {
    return null
  }

  const elapsedMs = Date.now() - lastAttemptMs
  if (elapsedMs < TRANSIENT_PDF_RETRY_COOLDOWN_MS) {
    const remainingHours = Math.ceil((TRANSIENT_PDF_RETRY_COOLDOWN_MS - elapsedMs) / (60 * 60 * 1000))
    return `transient PDF failure cooldown (${remainingHours}h remaining)`
  }
  return null
}

function classifyPdfFailure(message: string): PdfFailureType {
  const msg = message.toLowerCase()
  if (msg.includes('html page') || msg.includes('landing page') || msg.includes('paywall') || msg.includes('forbidden')) {
    return 'paywall-or-landing'
  }
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    return 'timeout'
  }
  if (msg.includes('http 4') || msg.includes('status 4')) {
    return 'http-4xx'
  }
  if (msg.includes('http 5') || msg.includes('status 5')) {
    return 'http-5xx'
  }
  if (msg.includes('invalid pdf')) {
    return 'invalid-pdf'
  }
  if (msg.includes('too large')) {
    return 'too-large'
  }
  if (msg.includes('socket') || msg.includes('fetch failed') || msg.includes('econnreset') || msg.includes('network')) {
    return 'network'
  }
  return 'unknown'
}

function shouldAttemptDoiRecovery(failureType: PdfFailureType): boolean {
  // DOI recovery is most effective for access/URL-shape failures.
  // For timeouts/network faults, retrying through DOI adds load without improving odds.
  return failureType === 'paywall-or-landing' || failureType === 'http-4xx'
}

function getPaperLockKey(paper: RankedPaper): string {
  return normalizeDoiForLookup(paper.doi || undefined) || normalizeTitle(paper.title)
}

function convertToPaperDTO(paper: RankedPaper, searchQuery: string): PaperDTO {
  const normalizedDoi = normalizeDoiForLookup(paper.doi || undefined)
  return {
    title: paper.title,
    abstract: paper.abstract || undefined,
    publication_date: paper.year ? `${paper.year}-01-01` : undefined,
    venue: paper.venue || undefined,
    doi: normalizedDoi || undefined,
    pdf_url: paper.pdf_url || undefined,
    metadata: {
      search_query: searchQuery,
      found_at: new Date().toISOString(),
      relevance_score: paper.relevanceScore,
      combined_score: paper.combinedScore,
      authority_score: paper.authorityScore,
      recency_score: paper.recencyScore,
      bm25_score: paper.bm25Score,
      canonical_id: paper.canonical_id,
      api_source: paper.source,
      preprint_id: paper.preprint_id,
      siblings: paper.siblings,
    },
    source: `academic_search_${paper.source}`,
    citation_count: paper.citationCount,
    authors: (paper.authors && paper.authors.length > 0) ? paper.authors : [],
    // Additional bibliographic fields for complete citations
    volume: paper.volume || undefined,
    issue: paper.issue || undefined,
    pages: paper.pages || undefined,
    publisher: paper.publisher || undefined,
    // Extended metadata
    paper_type: paper.paper_type || undefined,
    keywords: paper.keywords || undefined,
    fields_of_study: paper.fields_of_study || undefined,
    tldr: paper.tldr || undefined,
    is_open_access: paper.is_open_access,
    open_access_status: paper.open_access_status || undefined,
    license: paper.license || undefined,
    influential_citation_count: paper.influential_citation_count || undefined,
    references_count: paper.references_count || undefined,
    is_retracted: paper.is_retracted || undefined,
    external_ids: paper.external_ids || undefined,
    language: paper.language || undefined,
  }
}

function withCanonicalId(paper: RankedPaper, paperId: string): RankedPaper {
  return {
    ...paper,
    canonical_id: paperId,
    relevanceScore: paper.relevanceScore,
    combinedScore: paper.combinedScore,
    bm25Score: paper.bm25Score,
    authorityScore: paper.authorityScore,
    recencyScore: paper.recencyScore,
    pdf_url: paper.pdf_url,
  }
}

function parsePaperSource(rawSource: string | null): RankedPaper['source'] {
  const source = (rawSource || 'openalex').replace(/^academic_search_/, '')
  return source as RankedPaper['source']
}

function parseAuthors(authors: unknown): string[] {
  if (!Array.isArray(authors)) return []
  return authors
    .map(author => {
      if (typeof author === 'string') return author.trim()
      if (author && typeof author === 'object' && 'name' in author) {
        const name = (author as { name?: unknown }).name
        return typeof name === 'string' ? name.trim() : ''
      }
      return ''
    })
    .filter(Boolean)
}

function toRankedPaperFromRecord(record: PaperRecordForIngestion): RankedPaper {
  const metadata = (record.metadata || {}) as Record<string, unknown>
  const parsedYear = record.publication_date
    ? new Date(record.publication_date).getFullYear()
    : new Date().getFullYear()
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()

  return {
    canonical_id: record.id,
    title: record.title || 'Untitled',
    abstract: record.abstract || '',
    year,
    venue: record.venue || undefined,
    doi: record.doi || undefined,
    pdf_url: record.pdf_url || undefined,
    citationCount: typeof record.citation_count === 'number' ? record.citation_count : 0,
    authors: parseAuthors(record.authors),
    source: parsePaperSource(record.source),
    relevanceScore: typeof metadata.relevance_score === 'number' ? metadata.relevance_score : 0.5,
    combinedScore: typeof metadata.combined_score === 'number' ? metadata.combined_score : 0.5,
    bm25Score: typeof metadata.bm25_score === 'number' ? metadata.bm25_score : undefined,
    authorityScore: typeof metadata.authority_score === 'number' ? metadata.authority_score : undefined,
    recencyScore: typeof metadata.recency_score === 'number' ? metadata.recency_score : undefined,
  }
}

async function getPaperForIngestion(paperId: string): Promise<RankedPaper> {
  const serviceClient = getServiceClient()
  const { data, error } = await serviceClient
    .from('papers')
    .select('id, title, abstract, publication_date, venue, doi, pdf_url, citation_count, authors, metadata, source')
    .eq('id', paperId)
    .single()

  if (error || !data) {
    throw new Error(`Paper not found for ingestion: ${paperId}`)
  }

  return toRankedPaperFromRecord(data as PaperRecordForIngestion)
}

function dedupeByIdentity(papers: RankedPaper[]): RankedPaper[] {
  const seen = new Set<string>()
  const unique: RankedPaper[] = []

  for (const paper of papers) {
    const key = normalizeDoiForLookup(paper.doi || undefined) || normalizeTitle(paper.title)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(paper)
  }

  return unique
}

async function processWithLock(
  paper: RankedPaper,
  mode: ProcessingMode,
  runner: () => Promise<PaperProcessResult>
): Promise<PaperProcessResult> {
  const lockKey = getPaperLockKey(paper)
  const existing = paperProcessingLocks.get(lockKey)

  if (existing) {
    if (mode === 'full' && existing.mode === 'metadata') {
      // Wait for metadata registration to complete, then continue with full mode.
      await existing.promise
    } else {
      return existing.promise
    }
  }

  let promise!: Promise<PaperProcessResult>
  promise = (async () => {
    try {
      return await runner()
    } finally {
      const current = paperProcessingLocks.get(lockKey)
      if (current?.promise === promise) {
        paperProcessingLocks.delete(lockKey)
      }
    }
  })()

  paperProcessingLocks.set(lockKey, { mode, promise })
  return promise
}

async function ensurePaperMetadataInternal(
  paper: RankedPaper,
  searchQuery: string
): Promise<PaperProcessResult> {
  const paperDTO = convertToPaperDTO(paper, searchQuery)
  const normalizedDoi = normalizeDoiForLookup(paperDTO.doi || undefined) || undefined
  if (normalizedDoi && paperDTO.doi !== normalizedDoi) {
    paperDTO.doi = normalizedDoi
  }

  const { exists, paperId: existingId } = await checkPaperExists(paperDTO.doi, paperDTO.title)
  let paperId: string

  if (exists && existingId) {
    paperId = existingId
    console.log(`📚 Paper already exists: ${paperId}`)
  } else {
    paperId = await createPaperMetadata(paperDTO)
    console.log(`📚 Created new paper: ${paperId}`)
  }

  return { paperId, paper: withCanonicalId(paper, paperId) }
}

export async function ensurePaperMetadata(
  paper: RankedPaper,
  searchQuery: string = ''
): Promise<PaperProcessResult> {
  return processWithLock(paper, 'metadata', async () => {
    return ensurePaperMetadataInternal(paper, searchQuery)
  })
}

export async function ensurePaperContentReady(
  paper: RankedPaper,
  searchQuery: string = '',
  options: EnsurePaperContentOptions = {},
  resolvedPaperId?: string
): Promise<PaperProcessResult> {
  return processWithLock(paper, 'full', async () => {
    if (options.signal?.aborted) {
      throw new Error('Run was cancelled')
    }
    const metadataResult = resolvedPaperId
      ? { paperId: resolvedPaperId, paper: withCanonicalId(paper, resolvedPaperId) }
      : await ensurePaperMetadataInternal(paper, searchQuery)
    const { paperId } = metadataResult
    const paperDTO = convertToPaperDTO(paper, searchQuery)
    const normalizedDoi = normalizeDoiForLookup(paperDTO.doi || undefined) || undefined

    // Single-source-of-truth content state check.
    const serviceClient = getServiceClient()
    const { data: paperRecord, error: paperRecordError } = await serviceClient
      .from('papers')
      .select('processing_status, pdf_content, content_source, metadata')
      .eq('id', paperId)
      .single()

    if (paperRecordError) {
      throw new Error(`Failed to read existing paper content for ${paperId}: ${paperRecordError.message}`)
    }

    const processingStatus = normalizePaperProcessingStatus(paperRecord?.processing_status)
    const paperMetadata = getMetadataObject(paperRecord?.metadata)
    let metadataPatch: Record<string, unknown> = {}

    const markPdfFetchSuccess = () => {
      const nowIso = new Date().toISOString()
      metadataPatch = {
        ...metadataPatch,
        pdf_fetch_status: 'ok',
        pdf_fail_reason: null,
        pdf_last_attempt_at: nowIso,
        pdf_last_success_at: nowIso,
      }
    }

    const markPdfFetchFailure = (
      status: Exclude<PersistentPdfFetchStatus, 'ok'>,
      reason: string
    ) => {
      const existingFailCountRaw =
        typeof metadataPatch.pdf_fail_count === 'number'
          ? metadataPatch.pdf_fail_count
          : paperMetadata.pdf_fail_count
      const existingFailCount = typeof existingFailCountRaw === 'number' ? existingFailCountRaw : 0
      metadataPatch = {
        ...metadataPatch,
        pdf_fetch_status: status,
        pdf_fail_reason: reason.slice(0, 300),
        pdf_last_attempt_at: new Date().toISOString(),
        pdf_fail_count: existingFailCount + 1,
      }
    }

    const persistMetadataPatch = async () => {
      if (Object.keys(metadataPatch).length === 0) return
      const mergedMetadata = { ...paperMetadata, ...metadataPatch }
      const { error: metadataUpdateError } = await serviceClient
        .from('papers')
        .update({ metadata: mergedMetadata })
        .eq('id', paperId)
      if (metadataUpdateError) {
        console.warn(`Failed to persist PDF metadata for ${paperId}:`, metadataUpdateError.message)
        return
      }
      Object.assign(paperMetadata, mergedMetadata)
      metadataPatch = {}
    }

    const returnAsAbstractReady = async (logMessage: string): Promise<PaperProcessResult> => {
      await persistMetadataPatch()

      if (paperRecord?.processing_status !== 'abstract_ready') {
        await setPaperProcessingStatus(paperId, 'abstract_ready', { serviceClient })
      }

      if (!options.skipStructuredExtraction) {
        const extractionText = [paperDTO.title, paperDTO.abstract].filter(Boolean).join('\n\n')
        const extractionPromise = runStructuredExtraction(paperId, paperDTO, extractionText)
        if (options.waitForStructuredExtraction) {
          await extractionPromise
        } else {
          extractionPromise.catch(err => {
            console.warn(`⚠️ Structured extraction failed for ${paperId}:`, err instanceof Error ? err.message : err)
          })
        }
      }

      console.log(logMessage)
      return metadataResult
    }

    if (isFullTextReadyStatus(processingStatus)) {
      if (paperRecord?.processing_status !== 'full_text_ready') {
        await setPaperProcessingStatus(paperId, 'full_text_ready', {
          serviceClient,
          pdfContent: paperRecord?.pdf_content,
          contentSource: paperRecord?.content_source,
        })
      }

      if (!options.skipStructuredExtraction) {
        const extractionText = paperRecord?.pdf_content || [paperDTO.title, paperDTO.abstract].filter(Boolean).join('\n\n')
        const extractionPromise = runStructuredExtraction(paperId, paperDTO, extractionText)
        if (options.waitForStructuredExtraction) {
          await extractionPromise
        } else {
          extractionPromise.catch(err => {
            console.warn(`⚠️ Structured extraction failed for ${paperId}:`, err instanceof Error ? err.message : err)
          })
        }
      }

      console.log(`📚 Full text already ready, skipping ingestion: ${paperDTO.title}`)
      return metadataResult
    }

    if (processingStatus === 'abstract_ready') {
      const canUpgrade = paperDTO.pdf_url || normalizedDoi
      if (!canUpgrade) {
        return returnAsAbstractReady(`📚 Abstract-ready paper, skipping PDF ingestion: ${paperDTO.title}`)
      }

      const skipReason = getPdfAttemptSkipReason(paperMetadata, paperDTO.pdf_url)
      if (skipReason) {
        return returnAsAbstractReady(`📚 Abstract-ready paper, skipping PDF ingestion (${skipReason}): ${paperDTO.title}`)
      }

      console.log(`📄 Abstract-ready but PDF/DOI available — attempting full-text upgrade: ${paperDTO.title}`)
    }

    console.log(`📄 No content — attempting PDF extraction: ${paperDTO.title}`)

    const contentParts: string[] = []
    contentParts.push(paperDTO.title)
    if (paperDTO.abstract) {
      contentParts.push(paperDTO.abstract)
    }

    let pdfProcessingMs = 0
    let acquiredFullText = false
    let fullTextReadyContent: string | null = null
    let fullTextReadySource: 'pdf' | 'html' | null = null

    if (options.signal?.aborted) {
      throw new Error('Run was cancelled')
    }

    if (paperDTO.pdf_url) {
      const pdfStartTime = Date.now()
      try {
        const text = await getOrExtractFullText({ pdfUrl: paperDTO.pdf_url, paperId, ocr: true, timeoutMs: 60000 })
        pdfProcessingMs = Date.now() - pdfStartTime

        if (text && text.length > 100) {
          contentParts.push(text)
          acquiredFullText = true
          fullTextReadyContent = text
          fullTextReadySource = 'pdf'
          markPdfFetchSuccess()
          console.log(`✅ PDF success: ${text.length} chars from ${paperDTO.pdf_url} [${pdfProcessingMs}ms]`)
        } else {
          markPdfFetchFailure('permanent_fail', `empty_pdf_text:${text?.length || 0}`)
          console.warn(`⚠️ PDF empty: ${paperDTO.pdf_url} returned ${text?.length || 0} chars [${pdfProcessingMs}ms]`)
        }
      } catch (pdfErr) {
        pdfProcessingMs = Date.now() - pdfStartTime
        const errorMessage = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        const failureType = classifyPdfFailure(errorMessage)

        console.warn(`❌ PDF failed [${failureType}]: ${paperDTO.pdf_url}`)
        console.warn(`   Reason: ${errorMessage.slice(0, 200)}`)
        console.warn(`   Duration: ${pdfProcessingMs}ms | Paper: "${paperDTO.title.slice(0, 50)}..."`)

        if (normalizedDoi && shouldAttemptDoiRecovery(failureType)) {
          let recovered = false

          try {
            const htmlResult = await tryHtmlFallbackFromDoi(normalizedDoi, 30_000)
            if (htmlResult?.content && htmlResult.content.length > 200) {
              contentParts.push(htmlResult.content)
              acquiredFullText = true
              fullTextReadyContent = htmlResult.content
              fullTextReadySource = 'html'
              markPdfFetchSuccess()
              console.log(`✅ HTML-from-DOI recovery: ${htmlResult.content.length} chars after PDF failure`)
              recovered = true
              try {
                const serviceClient = getServiceClient()
                await serviceClient.from('papers').update({
                  pdf_content: htmlResult.content,
                  content_source: 'html',
                }).eq('id', paperId)
              } catch (persistErr) {
                console.warn(`Failed to persist HTML content for ${paperId}:`, persistErr)
              }
            }
          } catch (htmlErr) {
            console.warn(`❌ HTML-from-DOI recovery failed for ${normalizedDoi}:`, htmlErr instanceof Error ? htmlErr.message : String(htmlErr))
          }

          if (!recovered) {
            try {
              const epmcResult = await tryEuropePmcFullText(normalizedDoi, 30_000)
              if (epmcResult?.content && epmcResult.content.length > 200) {
                contentParts.push(epmcResult.content)
                acquiredFullText = true
                fullTextReadyContent = epmcResult.content
                fullTextReadySource = 'html'
                markPdfFetchSuccess()
                console.log(`✅ Europe PMC XML recovery: ${epmcResult.content.length} chars after PDF failure`)
                try {
                  const serviceClient = getServiceClient()
                  await serviceClient.from('papers').update({
                    pdf_content: epmcResult.content,
                    content_source: 'html',
                  }).eq('id', paperId)
                } catch (persistErr) {
                  console.warn(`Failed to persist EPMC content for ${paperId}:`, persistErr)
                }
              }
            } catch (epmcErr) {
              console.warn(`❌ Europe PMC XML recovery failed for ${normalizedDoi}:`, epmcErr instanceof Error ? epmcErr.message : String(epmcErr))
            }
          }
        } else if (normalizedDoi) {
          console.log(`📄 Skipping DOI fallback for failure class "${failureType}"`)
        }

        if (!acquiredFullText) {
          const persistentFailureStatus = classifyPersistentPdfFailure(failureType)
          markPdfFetchFailure(persistentFailureStatus, `${failureType}:${errorMessage.slice(0, 180)}`)
        }
      }
    } else if (normalizedDoi) {
      console.log(`📄 No PDF URL, trying content fallbacks via DOI for: "${paperDTO.title.slice(0, 50)}..."`)
      let recovered = false

      try {
        const htmlResult = await tryHtmlFallbackFromDoi(normalizedDoi, 30_000)
        if (htmlResult?.content && htmlResult.content.length > 200) {
          contentParts.push(htmlResult.content)
          acquiredFullText = true
          fullTextReadyContent = htmlResult.content
          fullTextReadySource = 'html'
          markPdfFetchSuccess()
          console.log(`✅ HTML-from-DOI success: ${htmlResult.content.length} chars for "${paperDTO.title.slice(0, 50)}..."`)
          recovered = true
          try {
            const serviceClient = getServiceClient()
            await serviceClient.from('papers').update({
              pdf_content: htmlResult.content,
              content_source: 'html',
            }).eq('id', paperId)
          } catch (persistErr) {
            console.warn(`Failed to persist HTML content for ${paperId}:`, persistErr)
          }
        }
      } catch (htmlErr) {
        console.warn(`❌ HTML-from-DOI failed for ${normalizedDoi}:`, htmlErr instanceof Error ? htmlErr.message : String(htmlErr))
      }

      if (!recovered) {
        try {
          const epmcResult = await tryEuropePmcFullText(normalizedDoi, 30_000)
          if (epmcResult?.content && epmcResult.content.length > 200) {
            contentParts.push(epmcResult.content)
            acquiredFullText = true
            fullTextReadyContent = epmcResult.content
            fullTextReadySource = 'html'
            markPdfFetchSuccess()
            console.log(`✅ Europe PMC XML success: ${epmcResult.content.length} chars for "${paperDTO.title.slice(0, 50)}..."`)
            try {
              const serviceClient = getServiceClient()
              await serviceClient.from('papers').update({
                pdf_content: epmcResult.content,
                content_source: 'html',
              }).eq('id', paperId)
            } catch (persistErr) {
              console.warn(`Failed to persist EPMC content for ${paperId}:`, persistErr)
            }
          }
        } catch (epmcErr) {
          console.warn(`❌ Europe PMC XML failed for ${normalizedDoi}:`, epmcErr instanceof Error ? epmcErr.message : String(epmcErr))
        }
      }
      if (!recovered) {
        markPdfFetchFailure('transient_fail', 'doi_fulltext_unavailable')
      }
    } else {
      console.log(`📄 No PDF URL and no DOI for: "${paperDTO.title.slice(0, 50)}..."`)
    }

    const fullText = contentParts.join('\n\n')
    const finalChunkCount = await createChunksForPaper(paperId, fullText)
    console.log(`📚 Ingested paper with ${finalChunkCount} chunks: ${paperDTO.title}`)

    if (!options.skipStructuredExtraction && finalChunkCount > 0) {
      const extractionPromise = runStructuredExtraction(paperId, paperDTO, fullText)
      if (options.waitForStructuredExtraction) {
        await extractionPromise
      } else {
        extractionPromise.catch(err => {
          console.warn(`⚠️ Structured extraction failed for ${paperId}:`, err instanceof Error ? err.message : err)
        })
      }
    }

    if (finalChunkCount > 0) {
      try {
        if (acquiredFullText) {
          const persistedFullText = (fullTextReadyContent || fullText).slice(0, 1_000_000)
          const persistedSource = fullTextReadySource || 'pdf'
          const mergedMetadata = Object.keys(metadataPatch).length > 0
            ? { ...paperMetadata, ...metadataPatch }
            : undefined
          const updatePayload: {
            pdf_content: string
            content_source: 'pdf' | 'html'
            metadata?: Record<string, unknown>
          } = {
            pdf_content: persistedFullText,
            content_source: persistedSource,
          }
          if (mergedMetadata) {
            updatePayload.metadata = mergedMetadata
          }

          const { error: persistError } = await serviceClient
            .from('papers')
            .update(updatePayload)
            .eq('id', paperId)

          if (persistError) {
            throw new Error(`Failed to persist full-text content for ${paperId}: ${persistError.message}`)
          }

          if (mergedMetadata) {
            Object.assign(paperMetadata, mergedMetadata)
            metadataPatch = {}
          }

          const nextStatus = canMarkFullTextReady(persistedFullText, persistedSource)
            ? 'full_text_ready'
            : 'abstract_ready'

          await setPaperProcessingStatus(paperId, nextStatus, {
            serviceClient,
            pdfContent: persistedFullText,
            contentSource: persistedSource,
          })
        } else {
          await persistMetadataPatch()
          await setPaperProcessingStatus(paperId, 'abstract_ready', { serviceClient })
        }
      } catch (statusErr) {
        console.warn(`Failed to update processing_status for paper ${paperId}:`, statusErr)
      }
    } else {
      try {
        await persistMetadataPatch()
        await setPaperProcessingStatus(paperId, 'failed', { serviceClient })
        console.warn(`⚠️ No chunks created for paper ${paperId}, marked as failed`)
      } catch (statusErr) {
        console.warn(`Failed to update processing_status to failed for paper ${paperId}:`, statusErr)
      }
    }

    await fetchAndStoreReferencesForPaper(paper, paperId)

    return metadataResult
  })
}

export async function ensurePaperContentReadyById(
  paperId: string,
  options: EnsurePaperContentByIdOptions = {}
): Promise<PaperProcessResult> {
  const paper = await getPaperForIngestion(paperId)
  return ensurePaperContentReady(paper, options.searchQuery || '', options, paperId)
}

export function schedulePaperContentPreparationById(
  paperId: string,
  options: SchedulePaperContentPreparationOptions = {}
): void {
  const { reason = 'background_preparation', ...contentOptions } = options

  void ensurePaperContentReadyById(paperId, contentOptions)
    .then(result => {
      console.log(`[PaperContent] Early preparation finished (${reason}) for ${result.paperId}`)
    })
    .catch(error => {
      console.warn(
        `[PaperContent] Early preparation failed (${reason}) for ${paperId}:`,
        error instanceof Error ? error.message : error
      )
    })
}

export async function ensureBulkPaperMetadata(
  papers: RankedPaper[],
  searchQuery: string = '',
  options: BulkMetadataRegistrationOptions = {}
): Promise<BulkPaperProcessResult> {
  const uniquePapers = dedupeByIdentity(papers)
  const concurrency = options.concurrency ?? 10
  const limit = pLimit(concurrency)

  const paperIds: string[] = []
  const registeredPapers: RankedPaper[] = []

  const results = await Promise.allSettled(
    uniquePapers.map(paper => limit(() => ensurePaperMetadata(paper, searchQuery)))
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      paperIds.push(result.value.paperId)
      registeredPapers.push(result.value.paper)
    } else {
      console.warn('Paper metadata registration failed:', result.reason)
    }
  }

  return { papers: registeredPapers, paperIds }
}

export async function ensureBulkPaperContentReady(
  papers: RankedPaper[],
  searchQuery: string = '',
  options: BulkPaperProcessingOptions = {}
): Promise<BulkPaperProcessResult> {
  const uniquePapers = dedupeByIdentity(papers)
  const concurrency = options.concurrency ?? 8
  const limit = pLimit(concurrency)

  const paperIds: string[] = []
  const readyPapers: RankedPaper[] = []

  const results = await Promise.allSettled(
    uniquePapers.map(paper =>
      limit(() =>
        ensurePaperContentReady(paper, searchQuery, {
          skipStructuredExtraction: options.skipStructuredExtraction,
          waitForStructuredExtraction: options.waitForStructuredExtraction,
        })
      )
    )
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      paperIds.push(result.value.paperId)
      readyPapers.push(result.value.paper)
    } else {
      console.warn('Paper full-content processing failed:', result.reason)
    }
  }

  return { papers: readyPapers, paperIds }
}

export async function ensureBulkPaperContentReadyByIds(
  paperIds: string[],
  options: BulkPaperProcessingByIdOptions = {}
): Promise<BulkPaperProcessResult> {
  const uniquePaperIds = Array.from(new Set(paperIds.filter(Boolean)))
  const concurrency = options.concurrency ?? 8
  const limit = pLimit(concurrency)

  const readyIds: string[] = []
  const readyPapers: RankedPaper[] = []

  const results = await Promise.allSettled(
    uniquePaperIds.map(paperId =>
      limit(() =>
        ensurePaperContentReadyById(paperId, {
          searchQuery: options.searchQuery,
          skipStructuredExtraction: options.skipStructuredExtraction,
          waitForStructuredExtraction: options.waitForStructuredExtraction,
        })
      )
    )
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      readyIds.push(result.value.paperId)
      readyPapers.push(result.value.paper)
    } else {
      console.warn('Paper full-content processing by ID failed:', result.reason)
    }
  }

  return { papers: readyPapers, paperIds: readyIds }
}

export function scheduleBulkPaperContentPreparationByIds(
  paperIds: string[],
  options: ScheduleBulkPaperContentPreparationOptions = {}
): void {
  const uniquePaperIds = Array.from(new Set(paperIds.filter(Boolean)))
  if (uniquePaperIds.length === 0) {
    return
  }

  const { reason = 'background_preparation', ...contentOptions } = options

  void ensureBulkPaperContentReadyByIds(uniquePaperIds, contentOptions)
    .then(result => {
      console.log(
        `[PaperContent] Early bulk preparation finished (${reason}) for ${result.paperIds.length}/${uniquePaperIds.length} papers`
      )
    })
    .catch(error => {
      console.warn(
        `[PaperContent] Early bulk preparation failed (${reason}) for ${uniquePaperIds.length} papers:`,
        error instanceof Error ? error.message : error
      )
    })
}

async function runStructuredExtraction(
  paperId: string,
  paper: PaperDTO,
  fullText: string
): Promise<void> {
  const alreadyExtracted = await hasExtractionService(paperId)
  if (alreadyExtracted) {
    console.log(`📄 Extraction already exists for: ${paper.title.slice(0, 50)}...`)
    return
  }

  console.log(`🔬 Starting extraction for: ${paper.title.slice(0, 50)}...`)

  const textParts = []
  if (paper.title) textParts.push(`Title: ${paper.title}`)
  if (paper.abstract) textParts.push(`Abstract: ${paper.abstract}`)
  if (fullText) textParts.push(fullText)

  const result = await extractPaper({
    paperId,
    text: textParts.join('\n\n'),
  })

  if (result.success && result.extraction) {
    await saveExtractionService(result.extraction)
    console.log(`✅ Extraction saved for: ${paper.title.slice(0, 50)}...`)
  } else {
    console.warn(`⚠️ Extraction failed for ${paperId}: ${result.error || 'unknown error'}`)
  }
}

async function fetchAndStoreReferencesForPaper(paper: RankedPaper, paperId: string): Promise<void> {
  try {
    // Use canonical_id as fallback instead of paperId (which is a Supabase UUID)
    const refs = await getPaperReferences(paper.doi, paper.canonical_id)
    if (refs.length === 0) return

    const supabase = getServiceClient()
    const rows = refs.slice(0, 100).map(r => ({
      paper_id: paperId,
      reference_csl: r,
    }))
    await supabase.from('paper_references').insert(rows).select()
    console.log(`📚 Stored ${rows.length} references for paper ${paperId}`)
  } catch (e) {
    console.warn('Reference ingestion failed', e)
  }
}
