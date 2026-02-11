#!/usr/bin/env tsx

/**
 * Backfill Paper Metadata from OpenAlex
 * 
 * Updates existing papers with comprehensive metadata that wasn't captured
 * during initial ingestion. Only processes papers that have a DOI.
 * 
 * Usage:
 *   npx tsx scripts/backfill-paper-metadata.ts
 *   npx tsx scripts/backfill-paper-metadata.ts --limit 1000
 *   npx tsx scripts/backfill-paper-metadata.ts --batch-size 50
 *   npx tsx scripts/backfill-paper-metadata.ts --dry-run
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROGRESS_FILE = '.backfill-metadata-progress.json'
const DEFAULT_BATCH_SIZE = 100  // DOIs to fetch from OpenAlex at once
const DEFAULT_LIMIT = 0  // 0 = no limit, process all
const OPENALEX_DELAY_MS = 150  // Delay between OpenAlex requests (~6 req/sec)
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || process.env.EMAIL || ''

if (!CONTACT_EMAIL) {
  console.error('❌ CONTACT_EMAIL or EMAIL environment variable required for OpenAlex API')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenAlexWork {
  id: string
  doi?: string
  display_name: string
  publication_year?: number
  publication_date?: string
  biblio?: {
    volume?: string
    issue?: string
    first_page?: string
    last_page?: string
  }
  primary_location?: {
    source?: {
      display_name?: string
      publisher?: string
      host_organization_name?: string
    }
    pdf_url?: string
    landing_page_url?: string
    license?: string
  }
  best_oa_location?: {
    pdf_url?: string
    landing_page_url?: string
    license?: string
    source?: {
      publisher?: string
      host_organization_name?: string
    }
  }
  open_access?: {
    is_oa?: boolean
    oa_status?: string
    oa_url?: string
  }
  type?: string
  language?: string
  is_retracted?: boolean
  referenced_works_count?: number
  cited_by_count?: number
  concepts?: Array<{ display_name: string; level?: number; score?: number }>
  keywords?: Array<{ keyword: string }>
  ids?: {
    openalex?: string
    pmid?: string
    pmcid?: string
    mag?: string
  }
}

interface Progress {
  totalProcessed: number
  totalUpdated: number
  totalSkipped: number
  totalErrors: number
  lastProcessedId: string | null
  startedAt: string
  lastUpdated: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function loadProgress(): Progress {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'))
    }
  } catch {}
  return {
    totalProcessed: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    totalErrors: 0,
    lastProcessedId: null,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString()
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
}

async function fetchOpenAlexByDoi(doi: string): Promise<OpenAlexWork | null> {
  try {
    // Clean DOI
    const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//, '').trim()
    const url = `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}?mailto=${encodeURIComponent(CONTACT_EMAIL)}`
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': `GenPaper-Backfill/1.0 (mailto:${CONTACT_EMAIL})`,
      },
    })
    
    if (!response.ok) {
      if (response.status === 404) {
        return null  // Paper not found in OpenAlex
      }
      throw new Error(`OpenAlex API error: ${response.status}`)
    }
    
    return await response.json()
  } catch (err) {
    console.error(`  ❌ Failed to fetch DOI ${doi}:`, err)
    return null
  }
}

function extractMetadata(work: OpenAlexWork): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  
  // Bibliographic fields (for citations)
  if (work.biblio?.volume) metadata.volume = work.biblio.volume
  if (work.biblio?.issue) metadata.issue = work.biblio.issue
  
  // Extract pages
  if (work.biblio?.first_page && work.biblio?.last_page) {
    metadata.pages = `${work.biblio.first_page}-${work.biblio.last_page}`
  } else if (work.biblio?.first_page) {
    metadata.pages = work.biblio.first_page
  }
  
  // Publisher from multiple sources
  const publisher = work.primary_location?.source?.publisher ||
                   work.primary_location?.source?.host_organization_name ||
                   work.best_oa_location?.source?.publisher ||
                   work.best_oa_location?.source?.host_organization_name
  if (publisher) metadata.publisher = publisher
  
  // Publication type
  if (work.type) metadata.paper_type = work.type
  
  // Open access info
  if (work.open_access?.is_oa !== undefined) metadata.is_open_access = work.open_access.is_oa
  if (work.open_access?.oa_status) metadata.open_access_status = work.open_access.oa_status
  
  // License
  const license = work.best_oa_location?.license || work.primary_location?.license
  if (license) metadata.license = license
  
  // Additional metadata
  if (work.language) metadata.language = work.language
  if (work.is_retracted !== undefined) metadata.is_retracted = work.is_retracted
  if (work.referenced_works_count) metadata.references_count = work.referenced_works_count
  
  // Keywords
  const keywords = work.keywords?.map(k => k.keyword).filter(Boolean) || []
  if (keywords.length > 0) metadata.keywords = keywords
  
  // Fields of study from concepts
  const fieldsOfStudy = work.concepts
    ?.filter(c => (c.level ?? 0) <= 1 && (c.score ?? 0) > 0.3)
    .map(c => c.display_name) || []
  if (fieldsOfStudy.length > 0) metadata.fields_of_study = fieldsOfStudy
  
  // Legacy concepts
  if (work.concepts?.length) {
    metadata.concepts = work.concepts.slice(0, 5).map(c => c.display_name)
  }
  
  // External IDs
  const externalIds: Record<string, string> = {}
  if (work.ids?.pmid) externalIds.pmid = work.ids.pmid
  if (work.ids?.pmcid) externalIds.pmcid = work.ids.pmcid
  if (work.ids?.mag) externalIds.mag = work.ids.mag
  if (work.ids?.openalex) externalIds.openalex = work.ids.openalex
  if (Object.keys(externalIds).length > 0) metadata.external_ids = externalIds
  
  return metadata
}

function getBestPdfUrl(work: OpenAlexWork): string | null {
  return work.best_oa_location?.pdf_url ||
         work.primary_location?.pdf_url ||
         work.open_access?.oa_url ||
         null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  
  let batchSize = DEFAULT_BATCH_SIZE
  let limit = DEFAULT_LIMIT
  let dryRun = false
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--batch-size':
        batchSize = parseInt(args[++i], 10)
        break
      case '--limit':
        limit = parseInt(args[++i], 10)
        break
      case '--dry-run':
        dryRun = true
        break
    }
  }
  
  console.log('='.repeat(60))
  console.log('📚 Paper Metadata Backfill from OpenAlex')
  console.log('='.repeat(60))
  console.log(`Batch size:      ${batchSize}`)
  console.log(`Limit:           ${limit || 'No limit'}`)
  console.log(`Dry run:         ${dryRun}`)
  console.log(`Contact email:   ${CONTACT_EMAIL}`)
  console.log('='.repeat(60))
  
  const progress = loadProgress()
  console.log(`\n📊 Resuming from: ${progress.totalProcessed} processed, ${progress.totalUpdated} updated`)
  
  // Query papers with DOI that might need metadata update
  // We check for papers where metadata is null or missing key fields
  let offset = 0
  let totalQueried = 0
  
  while (true) {
    console.log(`\n📥 Fetching batch (offset: ${offset}, batch: ${batchSize})...`)
    
    // Get papers with DOI, ordered by created_at for consistent pagination
    let query = supabase
      .from('papers')
      .select('id, doi, title, metadata, pdf_url, citation_count')
      .not('doi', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batchSize - 1)
    
    // Resume from last processed ID if exists
    if (progress.lastProcessedId && offset === 0) {
      // Skip to where we left off - this is approximate
      // Better approach: use created_at cursor
    }
    
    const { data: papers, error } = await query
    
    if (error) {
      console.error('❌ Database error:', error.message)
      break
    }
    
    if (!papers || papers.length === 0) {
      console.log('✅ No more papers to process')
      break
    }
    
    totalQueried += papers.length
    console.log(`   Found ${papers.length} papers in this batch`)
    
    // Process each paper
    for (const paper of papers) {
      progress.totalProcessed++
      
      // Check if paper already has comprehensive metadata
      const existingMetadata = paper.metadata as Record<string, unknown> || {}
      const hasComprehensiveMetadata = 
        existingMetadata.volume !== undefined ||
        existingMetadata.is_retracted !== undefined ||
        existingMetadata.language !== undefined
      
      if (hasComprehensiveMetadata) {
        progress.totalSkipped++
        continue  // Already has metadata, skip
      }
      
      // Fetch from OpenAlex
      await sleep(OPENALEX_DELAY_MS)
      const work = await fetchOpenAlexByDoi(paper.doi)
      
      if (!work) {
        progress.totalSkipped++
        continue
      }
      
      // Extract new metadata
      const newMetadata = extractMetadata(work)
      
      // Merge with existing metadata
      const mergedMetadata = {
        ...existingMetadata,
        ...newMetadata,
      }
      
      // Also update pdf_url if we found a better one and current is empty
      const newPdfUrl = getBestPdfUrl(work)
      const shouldUpdatePdfUrl = !paper.pdf_url && newPdfUrl
      
      // Update citation count if OpenAlex has a higher value
      const newCitationCount = work.cited_by_count || 0
      const shouldUpdateCitations = newCitationCount > (paper.citation_count || 0)
      
      if (dryRun) {
        console.log(`  📝 Would update ${paper.id}: +${Object.keys(newMetadata).length} fields`)
        progress.totalUpdated++
      } else {
        // Build update object
        const updateObj: Record<string, unknown> = {
          metadata: mergedMetadata,
        }
        if (shouldUpdatePdfUrl) {
          updateObj.pdf_url = newPdfUrl
        }
        if (shouldUpdateCitations) {
          updateObj.citation_count = newCitationCount
        }
        
        const { error: updateError } = await supabase
          .from('papers')
          .update(updateObj)
          .eq('id', paper.id)
        
        if (updateError) {
          console.error(`  ❌ Failed to update ${paper.id}:`, updateError.message)
          progress.totalErrors++
        } else {
          progress.totalUpdated++
          
          // Log occasionally
          if (progress.totalUpdated % 100 === 0) {
            console.log(`  ✅ Updated ${progress.totalUpdated} papers (${progress.totalProcessed} processed)`)
          }
        }
      }
      
      progress.lastProcessedId = paper.id
      
      // Save progress every 50 papers
      if (progress.totalProcessed % 50 === 0) {
        saveProgress(progress)
      }
      
      // Check limit
      if (limit > 0 && progress.totalProcessed >= limit) {
        console.log(`\n⏹️  Reached limit of ${limit} papers`)
        break
      }
    }
    
    // Check if we hit the limit
    if (limit > 0 && progress.totalProcessed >= limit) {
      break
    }
    
    offset += batchSize
    
    // Safety check - if we've queried way more than expected, stop
    if (totalQueried > 500000) {
      console.log('⚠️ Safety limit reached (500K papers)')
      break
    }
  }
  
  // Final save
  saveProgress(progress)
  
  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 Backfill Complete!')
  console.log('='.repeat(60))
  console.log(`Total processed: ${progress.totalProcessed}`)
  console.log(`Total updated:   ${progress.totalUpdated}`)
  console.log(`Total skipped:   ${progress.totalSkipped}`)
  console.log(`Total errors:    ${progress.totalErrors}`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
