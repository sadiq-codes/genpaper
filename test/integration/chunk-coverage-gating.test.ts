/**
 * Integration test for chunk coverage gating system
 * Tests the race condition mitigation between PDF processing and generation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getCoverage, waitForChunkCoverage } from '@/lib/generation/discovery'
import { getSB } from '@/lib/supabase/server'

describe('Chunk Coverage Gating System', () => {
  const testPaperIds: string[] = []
  
  beforeAll(async () => {
    // Create some test papers with different chunk scenarios
    const sb = await getSB()
    
    // Paper 1: Abstract only (chunk_index: 0)
    const { data: paper1 } = await sb
      .from('papers')
      .insert({
        title: 'Test Paper 1 - Abstract Only',
        abstract: 'This is just an abstract',
        authors: []
      })
      .select('id')
      .single()
    
    if (paper1) {
      testPaperIds.push(paper1.id)
      
      // Add abstract chunk
      await sb.from('paper_chunks').insert({
        paper_id: paper1.id,
        chunk_index: 0,
        content: 'Abstract content',
        embedding: new Array(1536).fill(0) // Mock embedding
      })
    }
    
    // Paper 2: Full text (multiple chunks)
    const { data: paper2 } = await sb
      .from('papers')
      .insert({
        title: 'Test Paper 2 - Full Text',
        abstract: 'This has full text',
        authors: []
      })
      .select('id')
      .single()
    
    if (paper2) {
      testPaperIds.push(paper2.id)
      
      // Add multiple chunks
      await sb.from('paper_chunks').insert([
        {
          paper_id: paper2.id,
          chunk_index: 0,
          content: 'Abstract content',
          embedding: new Array(1536).fill(0)
        },
        {
          paper_id: paper2.id,
          chunk_index: 1,
          content: 'Full text chunk 1',
          embedding: new Array(1536).fill(0)
        },
        {
          paper_id: paper2.id,
          chunk_index: 2,
          content: 'Full text chunk 2',
          embedding: new Array(1536).fill(0)
        }
      ])
    }
  })
  
  afterAll(async () => {
    // Clean up test data
    if (testPaperIds.length > 0) {
      const sb = await getSB()
      await sb.from('paper_chunks').delete().in('paper_id', testPaperIds)
      await sb.from('papers').delete().in('id', testPaperIds)
    }
  })
  
  it('should calculate coverage correctly', async () => {
    const coverage = await getCoverage(testPaperIds)
    
    // Should be 50% (1 out of 2 papers has full text)
    expect(coverage).toBeCloseTo(0.5, 1)
  })
  
  it('should return 1.0 for empty paper list', async () => {
    const coverage = await getCoverage([])
    expect(coverage).toBe(1.0)
  })
  
  it('should timeout when target coverage is not reached', async () => {
    const result = await waitForChunkCoverage(
      testPaperIds,
      0.8,  // 80% target (impossible with our test data)
      1000, // 1 second timeout
      500   // check every 500ms
    )
    
    expect(result).toBe(false)
  })
  
  it('should succeed when target coverage is already met', async () => {
    const result = await waitForChunkCoverage(
      testPaperIds,
      0.4,  // 40% target (should be met immediately with 50% actual)
      1000, // 1 second timeout
      500   // check every 500ms
    )
    
    expect(result).toBe(true)
  })
  
  it('should handle database errors gracefully', async () => {
    // Test with non-existent paper IDs
    const coverage = await getCoverage(['non-existent-id'])
    expect(coverage).toBe(0)
  })
}) 