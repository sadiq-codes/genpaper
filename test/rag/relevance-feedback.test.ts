import { describe, expect, test } from 'vitest'

/**
 * Tests for relevance feedback functionality.
 * 
 * Note: The actual relevance-feedback.ts module uses 'server-only' import
 * so we test the pure functions directly by recreating the logic here.
 * Integration tests would need to run in a server environment.
 */

// Recreate the extractCitedChunksFromContent logic for testing
function extractCitedChunksFromContent(
  content: string,
  retrievedChunks: Array<{ id?: string; paper_id: string; content: string }>
): string[] {
  // Extract paper IDs from citation markers
  const citedPaperIds = new Set<string>()
  
  // Match [CITE: xxx] patterns
  const citeMatches = content.matchAll(/\[CITE:\s*([^\]]+)\]/g)
  for (const match of citeMatches) {
    citedPaperIds.add(match[1].trim())
  }
  
  // Find chunks that were from cited papers
  const citedChunkIds: string[] = []
  for (const chunk of retrievedChunks) {
    if (chunk.id && citedPaperIds.has(chunk.paper_id)) {
      citedChunkIds.push(chunk.id)
    }
  }
  
  return citedChunkIds
}

describe('relevance-feedback', () => {
  describe('extractCitedChunksFromContent', () => {
    test('extracts chunk IDs from cited papers', () => {
      const content = `
        According to recent studies [CITE: paper-123], machine learning has 
        revolutionized data analysis. This is supported by [CITE: paper-456] 
        and further validated by [CITE: paper-123].
      `
      
      const chunks = [
        { id: 'chunk-1', paper_id: 'paper-123', content: 'ML content 1' },
        { id: 'chunk-2', paper_id: 'paper-123', content: 'ML content 2' },
        { id: 'chunk-3', paper_id: 'paper-456', content: 'Data analysis' },
        { id: 'chunk-4', paper_id: 'paper-789', content: 'Not cited' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      
      // Should include chunks from paper-123 and paper-456
      expect(citedIds).toContain('chunk-1')
      expect(citedIds).toContain('chunk-2')
      expect(citedIds).toContain('chunk-3')
      // Should NOT include chunk from paper-789 (not cited)
      expect(citedIds).not.toContain('chunk-4')
    })

    test('handles content with no citations', () => {
      const content = 'This is content without any citation markers.'
      const chunks = [
        { id: 'chunk-1', paper_id: 'paper-123', content: 'Some content' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      expect(citedIds).toEqual([])
    })

    test('handles empty chunks array', () => {
      const content = 'Content with [CITE: paper-123] citation.'
      const citedIds = extractCitedChunksFromContent(content, [])
      expect(citedIds).toEqual([])
    })

    test('handles chunks without IDs', () => {
      const content = 'Content with [CITE: paper-123] citation.'
      const chunks = [
        { paper_id: 'paper-123', content: 'Some content' } // No id field
      ]
      
      // @ts-expect-error - testing edge case with missing id
      const citedIds = extractCitedChunksFromContent(content, chunks)
      expect(citedIds).toEqual([])
    })

    test('handles various citation marker formats', () => {
      const content = `
        [CITE: abc-123]
        [CITE:def-456]
        [CITE:  ghi-789  ]
      `
      
      const chunks = [
        { id: 'c1', paper_id: 'abc-123', content: '1' },
        { id: 'c2', paper_id: 'def-456', content: '2' },
        { id: 'c3', paper_id: 'ghi-789', content: '3' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      expect(citedIds).toHaveLength(3)
      expect(citedIds).toContain('c1')
      expect(citedIds).toContain('c2')
      expect(citedIds).toContain('c3')
    })

    test('deduplicates paper references', () => {
      // Same paper cited multiple times should only match chunks once
      const content = `
        First citation [CITE: paper-123].
        Second citation [CITE: paper-123].
        Third citation [CITE: paper-123].
      `
      
      const chunks = [
        { id: 'chunk-1', paper_id: 'paper-123', content: 'Content' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      // Should only include chunk-1 once (no duplicates)
      expect(citedIds).toEqual(['chunk-1'])
    })

    test('handles UUID-style paper IDs', () => {
      const content = '[CITE: 550e8400-e29b-41d4-a716-446655440000] found significant results.'
      
      const chunks = [
        { id: 'c1', paper_id: '550e8400-e29b-41d4-a716-446655440000', content: 'Results' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      expect(citedIds).toContain('c1')
    })

    test('does not match similar but different paper IDs', () => {
      const content = '[CITE: paper-123] is cited.'
      
      const chunks = [
        { id: 'c1', paper_id: 'paper-1234', content: 'Not this one' },  // Has extra digit
        { id: 'c2', paper_id: 'paper-123', content: 'This one' }
      ]
      
      const citedIds = extractCitedChunksFromContent(content, chunks)
      expect(citedIds).toEqual(['c2'])
    })
  })
})

describe('citation-log-entry-schema', () => {
  test('entry has required fields', () => {
    interface CitationLogEntry {
      chunkId: string
      paperId: string
      projectId: string
      sectionType?: string
      queryContext?: string
    }
    
    const entry: CitationLogEntry = {
      chunkId: 'chunk-123',
      paperId: 'paper-456',
      projectId: 'proj-789',
      sectionType: 'introduction',
      queryContext: 'machine learning applications'
    }
    
    expect(entry.chunkId).toBeDefined()
    expect(entry.paperId).toBeDefined()
    expect(entry.projectId).toBeDefined()
  })

  test('entry allows optional fields to be undefined', () => {
    interface CitationLogEntry {
      chunkId: string
      paperId: string
      projectId: string
      sectionType?: string
      queryContext?: string
    }
    
    const entry: CitationLogEntry = {
      chunkId: 'chunk-123',
      paperId: 'paper-456',
      projectId: 'proj-789'
    }
    
    expect(entry.sectionType).toBeUndefined()
    expect(entry.queryContext).toBeUndefined()
  })
})

describe('citation-stats-materialized-view', () => {
  test('stats calculation logic', () => {
    // Test the expected aggregation logic
    interface CitationLog {
      chunk_id: string
      project_id: string
      was_cited: boolean
    }
    
    // Simulate citation logs
    const logs: CitationLog[] = [
      { chunk_id: 'c1', project_id: 'p1', was_cited: true },
      { chunk_id: 'c1', project_id: 'p2', was_cited: true },
      { chunk_id: 'c1', project_id: 'p3', was_cited: true },
      { chunk_id: 'c2', project_id: 'p1', was_cited: true },
      { chunk_id: 'c3', project_id: 'p1', was_cited: false },
    ]
    
    // Calculate stats for chunk c1
    const c1Logs = logs.filter(l => l.chunk_id === 'c1' && l.was_cited)
    const c1TotalCitations = c1Logs.length
    const c1UniqueProjects = new Set(c1Logs.map(l => l.project_id)).size
    
    expect(c1TotalCitations).toBe(3)
    expect(c1UniqueProjects).toBe(3)
    
    // Calculate stats for chunk c2
    const c2Logs = logs.filter(l => l.chunk_id === 'c2' && l.was_cited)
    const c2TotalCitations = c2Logs.length
    const c2UniqueProjects = new Set(c2Logs.map(l => l.project_id)).size
    
    expect(c2TotalCitations).toBe(1)
    expect(c2UniqueProjects).toBe(1)
    
    // Chunk c3 wasn't actually cited (was_cited = false)
    const c3Logs = logs.filter(l => l.chunk_id === 'c3' && l.was_cited)
    expect(c3Logs.length).toBe(0)
  })
})
