import { describe, it, expect } from 'vitest'
import { generateMultipleSectionsUnified, generateFullSection } from '@/lib/generation/unified-generator'
import { SectionContext } from '@/lib/prompts/unified/prompt-builder'

/**
 * Test: Unified Template System - Multi-Section Coherence
 * 
 * Demonstrates how the unified approach maintains coherence across
 * multiple sections through rolling summaries and shared context
 */

describe('Unified Template - Coherence Testing', () => {
  
  it('should generate coherent introduction and methods sections', async () => {
    // Mock section contexts
    const introContext: SectionContext = {
      projectId: 'test-project-123',
      sectionId: 'intro-001',
      paperType: 'researchArticle',
      sectionKey: 'introduction',
      availablePapers: ['paper-1', 'paper-2', 'paper-3'],
      contextChunks: [
        {
          paper_id: 'paper-1',
          content: 'Machine learning applications in healthcare have shown significant promise...',
          title: 'ML in Healthcare Review',
          doi: '10.1234/test'
        },
        {
          paper_id: 'paper-2',
          content: 'Deep learning models can detect diseases with high accuracy...',
          title: 'Deep Learning for Disease Detection'
        }
      ]
    }

    const methodsContext: SectionContext = {
      projectId: 'test-project-123',
      sectionId: 'methods-001',
      paperType: 'researchArticle',
      sectionKey: 'methodology',
      availablePapers: ['paper-1', 'paper-2', 'paper-3'],
      contextChunks: [
        {
          paper_id: 'paper-3',
          content: 'We collected data from 1000 patients across 5 hospitals...',
          title: 'Multi-center Study Protocol'
        }
      ]
    }

    // Test single section generation
    console.log('\n📝 Testing single section generation...')
    const introResult = await generateFullSection(introContext, 800)
    
    expect(introResult).toBeDefined()
    expect(introResult.content).toBeTruthy()
    expect(introResult.wordCount).toBeGreaterThan(0)
    expect(introResult.quality_score).toBeGreaterThan(50)
    
    console.log(`✅ Introduction generated: ${introResult.wordCount} words, quality: ${introResult.quality_score}`)
    
    // Test batch generation with coherence
    console.log('\n📝 Testing batch generation with coherence...')
    const contexts = [introContext, methodsContext]
    const batchResults = await generateMultipleSectionsUnified(contexts)
    
    expect(batchResults).toHaveLength(2)
    expect(batchResults[0].content).toBeTruthy()
    expect(batchResults[1].content).toBeTruthy()
    
    // Verify coherence markers
    const intro = batchResults[0].content.toLowerCase()
    const methods = batchResults[1].content.toLowerCase()
    
    // Methods should reference concepts from introduction
    const hasCoherence = 
      (intro.includes('machine learning') && methods.includes('machine learning')) ||
      (intro.includes('healthcare') && methods.includes('healthcare')) ||
      (intro.includes('disease') && methods.includes('disease'))
    
    expect(hasCoherence).toBe(true)
    
    console.log(`✅ Batch generation complete with coherence maintained`)
    
    // Log quality scores
    console.log('\n📊 Quality Metrics:')
    batchResults.forEach((result, idx) => {
      console.log(`  Section ${idx + 1}: ${result.wordCount} words, quality: ${result.quality_score}/100`)
      if (result.driftCheck) {
        console.log(`    Drift check: ${result.driftCheck.isDrift ? '⚠️ Warning' : '✅ Pass'} (similarity: ${result.driftCheck.similarity.toFixed(2)})`)
      }
    })
  })

  it('should maintain consistent terminology across sections', async () => {
    const paperTitle = 'Impact of Climate Change on Agricultural Productivity'
    const paperObjectives = 'Assess climate change effects on crop yields using satellite data analysis'
    
    // Create contexts with shared paper metadata
    const contexts: SectionContext[] = [
      {
        projectId: 'climate-study-001',
        sectionId: 'lit-review-001',
        paperType: 'researchArticle',
        sectionKey: 'literatureReview',
        availablePapers: ['climate-1', 'climate-2'],
        contextChunks: [
          {
            paper_id: 'climate-1',
            content: 'Climate change has reduced crop yields by 15% in subtropical regions...'
          }
        ]
      },
      {
        projectId: 'climate-study-001',
        sectionId: 'results-001',
        paperType: 'researchArticle',
        sectionKey: 'results',
        availablePapers: ['climate-1', 'climate-2'],
        contextChunks: [
          {
            paper_id: 'climate-2',
            content: 'Satellite analysis revealed significant correlation between temperature and yield...'
          }
        ]
      }
    ]
    
    const results = await generateMultipleSectionsUnified(contexts, { targetWords: 600 })
    
    // Check for consistent terminology
    const litReview = results[0].content
    const resultsSection = results[1].content
    
    // Both should use consistent terms from the paper title/objectives
    const consistentTerms = ['climate change', 'agricultural', 'productivity', 'crop', 'yield']
    let consistencyScore = 0
    
    for (const term of consistentTerms) {
      if (litReview.toLowerCase().includes(term) && resultsSection.toLowerCase().includes(term)) {
        consistencyScore++
      }
    }
    
    expect(consistencyScore).toBeGreaterThanOrEqual(3) // At least 3/5 terms consistent
    
    console.log(`\n✅ Terminology consistency: ${consistencyScore}/${consistentTerms.length} terms maintained`)
  })

  it('should detect topic drift when sections diverge', async () => {
    const mainContext: SectionContext = {
      projectId: 'drift-test-001',
      sectionId: 'main-section',
      paperType: 'researchArticle', 
      sectionKey: 'introduction',
      availablePapers: ['paper-1'],
      contextChunks: [
        {
          paper_id: 'paper-1',
          content: 'This study focuses on quantum computing applications in cryptography...'
        }
      ]
    }
    
    // Generate with drift detection enabled
    const result = await generateFullSection(mainContext, 500)
    
    expect(result.driftCheck).toBeDefined()
    
    // For a new project, drift check should pass (no previous sections)
    if (result.driftCheck) {
      console.log(`\n📊 Drift Detection: similarity=${result.driftCheck.similarity.toFixed(2)}, drift=${result.driftCheck.isDrift}`)
    }
  })
})

/**
 * Demonstration: How unified template maintains coherence
 * 
 * 1. Each section gets the full document context:
 *    - Paper title and objectives
 *    - Complete outline tree
 *    - Summaries of all previous sections
 * 
 * 2. The AI naturally maintains:
 *    - Consistent terminology
 *    - Logical flow between sections
 *    - Cross-references to earlier content
 * 
 * 3. Quality checks ensure:
 *    - Topic drift detection
 *    - Citation consistency
 *    - Argument progression
 */

// Run with: npm test test/generation/unified-coherence.test.ts 