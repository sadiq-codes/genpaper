/**
 * Integration Tests for Unified ingestPaper() Function
 * 
 * Tests all presets, advanced options, and real-world scenarios
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ingestPaper, type UnifiedIngestOptions } from '@/lib/db/papers'
import { type PaperDTO } from '@/lib/schemas/paper'

// Test data
const samplePaper: PaperDTO = {
  title: "Unified Architecture for Academic Paper Processing: A Test Case Study",
  authors: ["Dr. Jane Smith", "Prof. John Doe"],
  abstract: "This paper presents a comprehensive approach to unifying academic paper ingestion pipelines. We demonstrate how a single entry point can handle multiple processing scenarios while maintaining backwards compatibility and performance.",
  publication_date: "2024-01-15",
  venue: "Journal of Software Architecture",
  doi: "10.1000/test.unified.2024.001",
  url: "https://example.com/papers/unified-test",
  metadata: {
    keywords: ["architecture", "unification", "academic", "processing"],
    affiliations: ["University of Testing", "Research Institute of Quality"]
  },
  source: "test-suite",
  citation_count: 42,
  impact_score: 8.5
}

const sampleFullText = `
# Introduction

Academic paper processing has long been fragmented across multiple ingestion pathways. This research addresses the fundamental challenge of creating a unified, efficient, and maintainable architecture.

## Background

Traditional systems often implement separate functions for different processing scenarios:
- Lightweight metadata ingestion
- Full-text processing with chunking
- PDF-based ingestion with background processing

## Methodology

We propose a single entry point approach with configurable options that can handle all scenarios while maintaining optimal performance characteristics.

## Results

Our unified architecture demonstrates:
1. 75% reduction in code complexity
2. 100% backward compatibility
3. Enhanced error handling and monitoring
4. Configurable processing pipelines

## Conclusion

The unified approach provides significant benefits for both developers and system administrators while maintaining the flexibility required for diverse use cases.
`

describe('Unified ingestPaper() Integration Tests', () => {
  beforeAll(async () => {
    console.log('🧪 Starting unified ingestion integration tests...')
  })

  afterAll(async () => {
    console.log('✅ Unified ingestion integration tests completed')
  })

  describe('Preset Configurations', () => {
    it('should handle "fast" preset correctly', async () => {
      const options: UnifiedIngestOptions = {
        preset: 'fast'
      }

      const result = await ingestPaper(samplePaper, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.isNewPaper).toBe(true)
      expect(result.contentQueued).toBe(false) // Fast preset skips content
      expect(result.embedingGenerated).toBe(true) // Should generate abstract embedding
      expect(result.statistics).toBeUndefined() // Fast preset disables stats
    }, 30000)

    it('should handle "background" preset correctly', async () => {
      const options: UnifiedIngestOptions = {
        preset: 'background',
        fullText: sampleFullText
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Background Processing Test Paper",
        doi: "10.1000/test.background.2024.001"
      }, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.isNewPaper).toBe(true)
      expect(result.contentQueued).toBe(true) // Background preset queues processing
      expect(result.statistics).toBeUndefined() // Background preset disables stats
    }, 30000)

    it('should handle "full" preset with all features', async () => {
      const options: UnifiedIngestOptions = {
        preset: 'full',
        fullText: sampleFullText
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Full Processing Test Paper",
        doi: "10.1000/test.full.2024.001"
      }, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.isNewPaper).toBe(true)
      expect(result.embedingGenerated).toBe(true) // Full processing
      expect(result.statistics).toBeDefined() // Full preset enables stats
      expect(result.statistics?.processingTimeMs).toBeGreaterThan(0)
      expect(result.statistics?.regionDetected).toBeDefined() // Region detection enabled
    }, 30000)
  })

  describe('Advanced Option Combinations', () => {
    it('should handle validation-only mode', async () => {
      const options: UnifiedIngestOptions = {
        validateOnly: true,
        enableRegionDetection: true,
        generateStatistics: true
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Validation Test Paper"
      }, options)

      expect(result.paperId).toBeNull() // No actual paper created
      expect(result.isNewPaper).toBe(false)
      expect(result.validationResult).toBeDefined()
      expect(result.validationResult?.valid).toBe(true)
      expect(result.validationResult?.regionPreview).toBeDefined()
      expect(result.statistics?.processingTimeMs).toBeGreaterThan(0)
    }, 15000)

    it('should handle full processing with all options', async () => {
      const options: UnifiedIngestOptions = {
        fullText: sampleFullText,
        enableRegionDetection: true,
        generateStatistics: true,
        concurrency: 3
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Advanced Options Test Paper",
        doi: "10.1000/test.advanced.2024.001"
      }, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.isNewPaper).toBe(true)
      expect(result.embedingGenerated).toBe(true)
      expect(result.statistics).toBeDefined()
      expect(result.statistics?.regionDetected).toBeDefined()
      expect(result.statistics?.chunksProcessed).toBeDefined()
      expect(result.statistics?.chunksProcessed?.total).toBeGreaterThan(0)
    }, 45000)

    it('should handle preset override with custom options', async () => {
      const options: UnifiedIngestOptions = {
        preset: 'fast', // Start with fast preset
        generateStatistics: true, // Override to enable stats
        enableRegionDetection: true // Override to enable region detection
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Preset Override Test Paper",
        doi: "10.1000/test.override.2024.001"
      }, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.statistics).toBeDefined() // Should be enabled despite fast preset
      expect(result.statistics?.regionDetected).toBeDefined() // Should be enabled
    }, 30000)
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing required fields gracefully', async () => {
      const invalidPaper = {
        ...samplePaper,
        title: "",
        authors: []
      }

      const options: UnifiedIngestOptions = {
        validateOnly: true
      }

      const result = await ingestPaper(invalidPaper, options)

      expect(result.validationResult).toBeDefined()
      expect(result.validationResult?.valid).toBe(false)
      expect(result.validationResult?.errors.length).toBeGreaterThan(0)
    }, 15000)

    it('should handle duplicate papers idempotently', async () => {
      const duplicatePaper = {
        ...samplePaper,
        doi: "10.1000/test.duplicate.2024.001"
      }

      // First ingestion
      const result1 = await ingestPaper(duplicatePaper, {})
      expect(result1.isNewPaper).toBe(true)

      // Second ingestion with same DOI
      const result2 = await ingestPaper(duplicatePaper, {})
      expect(result2.isNewPaper).toBe(false)
      expect(result2.paperId).toBe(result1.paperId)
    }, 30000)

    it('should handle large content processing', async () => {
      const largeContent = sampleFullText.repeat(10) // Create larger content

      const options: UnifiedIngestOptions = {
        fullText: largeContent,
        generateStatistics: true,
        concurrency: 2
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Large Content Test Paper",
        doi: "10.1000/test.large.2024.001"
      }, options)

      expect(result.paperId).toBeTypeOf('string')
      expect(result.embedingGenerated).toBe(true)
      expect(result.statistics?.chunksProcessed?.total).toBeGreaterThan(5)
      expect(result.statistics?.processingTimeMs).toBeLessThan(30000) // Should complete in reasonable time
    }, 45000)
  })

  describe('Performance and Monitoring', () => {
    it('should provide detailed statistics when requested', async () => {
      const options: UnifiedIngestOptions = {
        fullText: sampleFullText,
        enableRegionDetection: true,
        generateStatistics: true
      }

      const result = await ingestPaper({
        ...samplePaper,
        title: "Statistics Test Paper",
        doi: "10.1000/test.stats.2024.001"
      }, options)

      expect(result.statistics).toBeDefined()
      expect(result.statistics?.processingTimeMs).toBeGreaterThan(0)
      expect(result.statistics?.regionDetected).toBeDefined()
      expect(result.statistics?.chunksProcessed).toBeDefined()
      expect(typeof result.statistics?.chunksProcessed?.total).toBe('number')
      expect(typeof result.statistics?.chunksProcessed?.successful).toBe('number')
      expect(typeof result.statistics?.chunksProcessed?.failed).toBe('number')
    }, 30000)

    it('should handle concurrent processing efficiently', async () => {
      const papers = Array.from({ length: 3 }, (_, i) => ({
        ...samplePaper,
        title: `Concurrent Test Paper ${i + 1}`,
        doi: `10.1000/test.concurrent.2024.00${i + 1}`
      }))

      const startTime = Date.now()
      
      const results = await Promise.all(
        papers.map(paper => 
          ingestPaper(paper, {
            preset: 'fast',
            generateStatistics: true
          })
        )
      )

      const totalTime = Date.now() - startTime

      expect(results).toHaveLength(3)
      results.forEach((result, i) => {
        expect(result.paperId).toBeTypeOf('string')
        expect(result.isNewPaper).toBe(true)
      })

      // Should complete all 3 papers reasonably quickly
      expect(totalTime).toBeLessThan(15000)
    }, 30000)
  })
}) 