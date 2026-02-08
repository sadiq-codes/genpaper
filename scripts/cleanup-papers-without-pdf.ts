#!/usr/bin/env npx tsx
/**
 * Cleanup papers without PDF content
 * 
 * Deletes papers that:
 * - Have no pdf_content (NULL)
 * - Are NOT in any user's library
 * 
 * Also cleans up:
 * - paper_chunks (CASCADE)
 * - Qdrant embeddings
 * 
 * Usage:
 *   npx tsx scripts/cleanup-papers-without-pdf.ts --dry-run   # Preview only
 *   npx tsx scripts/cleanup-papers-without-pdf.ts             # Actually delete
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const qdrantUrl = process.env.QDRANT_URL

const supabase = createClient(supabaseUrl, supabaseKey)

const BATCH_SIZE = 500
const isDryRun = process.argv.includes('--dry-run')

async function getLibraryPaperIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('library_papers')
    .select('paper_id')
  
  if (error) throw error
  return new Set(data?.map(p => p.paper_id) || [])
}

async function deleteFromQdrant(paperIds: string[]): Promise<void> {
  if (!qdrantUrl || paperIds.length === 0) return
  
  try {
    // Delete from paper_chunks collection
    await fetch(`${qdrantUrl}/collections/paper_chunks/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: {
          must: [
            { key: 'paper_id', match: { any: paperIds } }
          ]
        }
      })
    })
    
    // Delete from papers collection
    await fetch(`${qdrantUrl}/collections/papers/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: paperIds
      })
    })
  } catch (err) {
    console.warn('  ⚠️ Qdrant cleanup failed:', err)
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('🗑️  Cleanup Papers Without PDF Content')
  console.log('='.repeat(60))
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes)' : '⚠️  LIVE (will delete!)'}`)
  console.log('')
  
  // Get papers in libraries (to protect)
  const libraryPaperIds = await getLibraryPaperIds()
  console.log(`📚 Papers in libraries (protected): ${libraryPaperIds.size}`)
  
  // Get total count
  const { count: totalWithoutPdf } = await supabase
    .from('papers')
    .select('*', { count: 'exact', head: true })
    .is('pdf_content', null)
  
  console.log(`📄 Papers without pdf_content: ${totalWithoutPdf?.toLocaleString()}`)
  
  let totalDeleted = 0
  let totalChunksDeleted = 0
  let offset = 0
  
  while (true) {
    // Fetch batch of papers without pdf_content
    const { data: papers, error } = await supabase
      .from('papers')
      .select('id')
      .is('pdf_content', null)
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1)
    
    if (error) {
      console.error('Error fetching papers:', error.message)
      break
    }
    
    if (!papers || papers.length === 0) break
    
    // Filter out papers in libraries
    const toDelete = papers
      .filter(p => !libraryPaperIds.has(p.id))
      .map(p => p.id)
    
    if (toDelete.length > 0) {
      if (isDryRun) {
        console.log(`  Would delete ${toDelete.length} papers (batch ${offset / BATCH_SIZE + 1})`)
      } else {
        // Count chunks that will be deleted
        const { count: chunkCount } = await supabase
          .from('paper_chunks')
          .select('*', { count: 'exact', head: true })
          .in('paper_id', toDelete)
        
        // Delete from Qdrant first
        await deleteFromQdrant(toDelete)
        
        // Delete papers (cascades to chunks, citations, etc.)
        const { error: deleteError } = await supabase
          .from('papers')
          .delete()
          .in('id', toDelete)
        
        if (deleteError) {
          console.error(`  ❌ Delete error: ${deleteError.message}`)
        } else {
          totalDeleted += toDelete.length
          totalChunksDeleted += chunkCount || 0
          console.log(`  ✓ Deleted ${toDelete.length} papers, ${chunkCount} chunks (total: ${totalDeleted})`)
        }
      }
    }
    
    // Move offset - but since we're deleting, the next batch starts at same offset
    // unless we're in dry-run mode
    if (isDryRun) {
      offset += BATCH_SIZE
    }
    // In live mode, we don't increment offset because rows shift after delete
    
    // Safety: prevent infinite loop in live mode
    if (!isDryRun && papers.length < BATCH_SIZE) break
    if (isDryRun && papers.length < BATCH_SIZE) break
    
    // Small delay to avoid overwhelming the database
    await new Promise(r => setTimeout(r, 100))
  }
  
  console.log('')
  console.log('='.repeat(60))
  console.log('📊 Summary')
  console.log('='.repeat(60))
  if (isDryRun) {
    console.log(`Would delete: ~${totalWithoutPdf! - libraryPaperIds.size} papers`)
    console.log('\nRun without --dry-run to actually delete.')
  } else {
    console.log(`Papers deleted:  ${totalDeleted.toLocaleString()}`)
    console.log(`Chunks deleted:  ${totalChunksDeleted.toLocaleString()}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
