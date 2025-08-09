import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createClient } from '@/lib/supabase/server'
import { CitationService } from '@/lib/citations/immediate-bibliography'

/**
 * Concurrency Test for Citation Add
 * 
 * Proves idempotency under race conditions.
 * 10 parallel add calls for same (project, source) should result in:
 * - Exactly one DB row
 * - 9 calls return existing citation
 * - All calls return same citeKey
 */

describe('Citation Add Concurrency', () => {
  let testProjectId: string
  let testUserId: string
  let testPaperId: string
  let supabase: any

  beforeEach(async () => {
    supabase = await createClient()
    
    // Create unique test identifiers
    const timestamp = Date.now()
    testUserId = `test-user-${timestamp}`
    testProjectId = `test-project-${timestamp}`
    testPaperId = `test-paper-${timestamp}`

    // Insert test paper
    await supabase.from('papers').insert({
      id: testPaperId,
      title: 'Concurrency Test Paper',
      doi: `10.1234/concurrency.test.${timestamp}`,
      url: `https://example.com/concurrency-test-${timestamp}`,
      publication_date: '2024-01-01',
      venue: 'Concurrency Journal',
      created_at: new Date().toISOString()
    })

    // Insert test project
    await supabase.from('research_projects').insert({
      id: testProjectId,
      user_id: testUserId,
      topic: 'Concurrency Testing Project',
      citation_style: 'apa',
      created_at: new Date().toISOString()
    })
  })

  afterEach(async () => {
    // Cleanup test data
    await supabase.from('project_citations').delete().eq('project_id', testProjectId)
    await supabase.from('research_projects').delete().eq('id', testProjectId)
    await supabase.from('papers').delete().eq('id', testPaperId)
  })

  test('10 parallel adds produce exactly one DB row', async () => {
    const sourceRef = {
      paperId: testPaperId
    }

    // Create 10 parallel citation add operations
    const addPromises = Array.from({ length: 10 }, (_, index) =>
      CitationService.add({
        projectId: testProjectId,
        sourceRef,
        reason: `Concurrent add ${index + 1}`,
        quote: null
      })
    )

    // Execute all operations in parallel
    const results = await Promise.all(addPromises)

    // Verify all operations completed successfully
    expect(results).toHaveLength(10)
    results.forEach(result => {
      expect(result).toBeDefined()
      expect(result.citeKey).toBeTruthy()
      expect(result.projectCitationId).toBeTruthy()
    })

    // Verify all results have the same citeKey
    const firstCiteKey = results[0].citeKey
    results.forEach(result => {
      expect(result.citeKey).toBe(firstCiteKey)
    })

    // Count how many were new vs existing
    const newResults = results.filter(r => r.isNew)
    const existingResults = results.filter(r => !r.isNew)

    expect(newResults).toHaveLength(1) // Exactly one new
    expect(existingResults).toHaveLength(9) // 9 returned existing

    // Verify exactly one DB row was created
    const { data: citations, error } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)
      .eq('paper_id', testPaperId)

    expect(error).toBeNull()
    expect(citations).toHaveLength(1)

    // Verify the citation has the expected properties
    const citation = citations[0]
    expect(citation.project_id).toBe(testProjectId)
    expect(citation.paper_id).toBe(testPaperId)
    expect(citation.cite_key).toBe(firstCiteKey)
    expect(citation.csl_json).toBeTruthy()
  })

  test('race condition with different source references', async () => {
    // Create additional test paper
    const paper2Id = `test-paper-2-${Date.now()}`
    await supabase.from('papers').insert({
      id: paper2Id,
      title: 'Second Concurrency Test Paper',
      doi: `10.1234/concurrency.test2.${Date.now()}`,
      publication_date: '2024-01-02'
    })

    // Test concurrent adds for different papers
    const addPromises = [
      // 5 adds for first paper
      ...Array.from({ length: 5 }, (_, index) =>
        CitationService.add({
          projectId: testProjectId,
          sourceRef: { paperId: testPaperId },
          reason: `Paper 1 add ${index + 1}`,
          quote: null
        })
      ),
      // 5 adds for second paper
      ...Array.from({ length: 5 }, (_, index) =>
        CitationService.add({
          projectId: testProjectId,
          sourceRef: { paperId: paper2Id },
          reason: `Paper 2 add ${index + 1}`,
          quote: null
        })
      )
    ]

    const results = await Promise.all(addPromises)

    // Group results by citeKey
    const resultsByKey = new Map<string, typeof results>()
    results.forEach(result => {
      const key = result.citeKey
      if (!resultsByKey.has(key)) {
        resultsByKey.set(key, [])
      }
      resultsByKey.get(key)!.push(result)
    })

    // Should have exactly 2 distinct citeKeys
    expect(resultsByKey.size).toBe(2)

    // Each group should have exactly 1 new and 4 existing
    for (const [citeKey, groupResults] of resultsByKey) {
      expect(groupResults).toHaveLength(5)
      const newCount = groupResults.filter(r => r.isNew).length
      const existingCount = groupResults.filter(r => !r.isNew).length
      expect(newCount).toBe(1)
      expect(existingCount).toBe(4)
    }

    // Verify exactly 2 DB rows
    const { data: citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    expect(citations).toHaveLength(2)

    // Cleanup additional paper
    await supabase.from('papers').delete().eq('id', paper2Id)
  })

  test('concurrent adds with DOI resolution', async () => {
    const sourceRef = {
      doi: `10.1234/concurrency.test.${Date.now()}`
    }

    // Update the test paper to have this DOI
    await supabase
      .from('papers')
      .update({ doi: sourceRef.doi })
      .eq('id', testPaperId)

    // Run parallel adds using DOI resolution
    const addPromises = Array.from({ length: 8 }, (_, index) =>
      CitationService.add({
        projectId: testProjectId,
        sourceRef,
        reason: `DOI concurrent add ${index + 1}`,
        quote: null
      })
    )

    const results = await Promise.all(addPromises)

    // All should resolve to the same citation
    const firstCiteKey = results[0].citeKey
    results.forEach(result => {
      expect(result.citeKey).toBe(firstCiteKey)
    })

    // Should have exactly 1 new and 7 existing
    const newCount = results.filter(r => r.isNew).length
    const existingCount = results.filter(r => !r.isNew).length
    expect(newCount).toBe(1)
    expect(existingCount).toBe(7)

    // Verify single DB row
    const { data: citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    expect(citations).toHaveLength(1)
  })

  test('concurrent adds with title matching', async () => {
    const sourceRef = {
      title: 'Concurrency Test Paper',
      year: 2024
    }

    // Run parallel adds using title matching
    const addPromises = Array.from({ length: 6 }, (_, index) =>
      CitationService.add({
        projectId: testProjectId,
        sourceRef,
        reason: `Title concurrent add ${index + 1}`,
        quote: null
      })
    )

    const results = await Promise.all(addPromises)

    // All should resolve to the same citation
    const firstCiteKey = results[0].citeKey
    results.forEach(result => {
      expect(result.citeKey).toBe(firstCiteKey)
    })

    // Should have exactly 1 new and 5 existing
    const newCount = results.filter(r => r.isNew).length
    const existingCount = results.filter(r => !r.isNew).length
    expect(newCount).toBe(1)
    expect(existingCount).toBe(5)

    // Verify single DB row
    const { data: citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    expect(citations).toHaveLength(1)
  })

  test('high concurrency stress test', async () => {
    const sourceRef = {
      paperId: testPaperId
    }

    // Create 50 parallel operations to stress test
    const addPromises = Array.from({ length: 50 }, (_, index) =>
      CitationService.add({
        projectId: testProjectId,
        sourceRef,
        reason: `Stress test add ${index + 1}`,
        quote: null
      })
    )

    const results = await Promise.all(addPromises)

    // All should succeed
    expect(results).toHaveLength(50)
    results.forEach(result => {
      expect(result).toBeDefined()
      expect(result.citeKey).toBeTruthy()
    })

    // All should have same citeKey
    const firstCiteKey = results[0].citeKey
    results.forEach(result => {
      expect(result.citeKey).toBe(firstCiteKey)
    })

    // Exactly 1 new, 49 existing
    const newCount = results.filter(r => r.isNew).length
    const existingCount = results.filter(r => !r.isNew).length
    expect(newCount).toBe(1)
    expect(existingCount).toBe(49)

    // Single DB row
    const { data: citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    expect(citations).toHaveLength(1)
  })

  test('concurrent adds across different projects', async () => {
    // Create second project
    const project2Id = `test-project-2-${Date.now()}`
    await supabase.from('research_projects').insert({
      id: project2Id,
      user_id: testUserId,
      topic: 'Second Concurrency Project',
      citation_style: 'apa',
      created_at: new Date().toISOString()
    })

    const sourceRef = {
      paperId: testPaperId
    }

    // Run concurrent adds across both projects
    const addPromises = [
      // 5 adds for first project
      ...Array.from({ length: 5 }, (_, index) =>
        CitationService.add({
          projectId: testProjectId,
          sourceRef,
          reason: `Project 1 add ${index + 1}`,
          quote: null
        })
      ),
      // 5 adds for second project
      ...Array.from({ length: 5 }, (_, index) =>
        CitationService.add({
          projectId: project2Id,
          sourceRef,
          reason: `Project 2 add ${index + 1}`,
          quote: null
        })
      )
    ]

    const results = await Promise.all(addPromises)

    // Group by project
    const project1Results = results.slice(0, 5)
    const project2Results = results.slice(5)

    // Each project should have consistent citeKeys within itself
    const project1CiteKey = project1Results[0].citeKey
    const project2CiteKey = project2Results[0].citeKey

    project1Results.forEach(result => {
      expect(result.citeKey).toBe(project1CiteKey)
    })

    project2Results.forEach(result => {
      expect(result.citeKey).toBe(project2CiteKey)
    })

    // Each project should have 1 new, 4 existing
    expect(project1Results.filter(r => r.isNew)).toHaveLength(1)
    expect(project1Results.filter(r => !r.isNew)).toHaveLength(4)
    expect(project2Results.filter(r => r.isNew)).toHaveLength(1)
    expect(project2Results.filter(r => !r.isNew)).toHaveLength(4)

    // Each project should have exactly 1 DB row
    const { data: project1Citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    const { data: project2Citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', project2Id)

    expect(project1Citations).toHaveLength(1)
    expect(project2Citations).toHaveLength(1)

    // Cleanup second project
    await supabase.from('project_citations').delete().eq('project_id', project2Id)
    await supabase.from('research_projects').delete().eq('id', project2Id)
  })

  test('error handling during concurrent operations', async () => {
    // Test with invalid sourceRef that should fail resolution
    const invalidSourceRef = {
      doi: 'invalid.doi.format'
    }

    const addPromises = Array.from({ length: 5 }, (_, index) =>
      CitationService.add({
        projectId: testProjectId,
        sourceRef: invalidSourceRef,
        reason: `Invalid add ${index + 1}`,
        quote: null
      }).catch(error => ({ error: error.message }))
    )

    const results = await Promise.all(addPromises)

    // All should fail with the same error
    results.forEach(result => {
      expect(result).toHaveProperty('error')
      expect((result as any).error).toContain('Could not resolve source reference')
    })

    // No DB rows should be created
    const { data: citations } = await supabase
      .from('project_citations')
      .select('*')
      .eq('project_id', testProjectId)

    expect(citations).toHaveLength(0)
  })
})