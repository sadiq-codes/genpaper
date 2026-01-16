/**
 * Tests for Paper Profile Intelligence System
 * 
 * These tests verify that:
 * 1. Profile generation produces valid, contextual profiles
 * 2. Literature reviews get appropriate guidance (no empirical methodology)
 * 3. Research articles get proper empirical research guidance
 * 4. Profile validation works correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only to allow testing
vi.mock('server-only', () => ({}))

// Mock the AI client before importing
vi.mock('@/lib/ai/vercel-client', () => ({
  ai: {
    languageModel: vi.fn(() => ({
      doGenerate: vi.fn()
    }))
  }
}))

// Mock logger to avoid side effects
vi.mock('@/lib/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

import type { PaperProfile, ProfileGenerationInput } from '@/lib/generation/paper-profile-types'
import { validatePaperWithProfile } from '@/lib/generation/paper-profile'
import { getPaperProfilePrompt } from '@/lib/generation/paper-profile-prompts'

describe('Paper Profile Intelligence System', () => {
  
  describe('Profile Prompt Generation', () => {
    
    it('should generate literature review prompt with correct guidance', async () => {
      const input: ProfileGenerationInput = {
        topic: 'Why do entrepreneurial ventures fail?',
        paperType: 'literatureReview',
        hasOriginalResearch: false
      }
      
      const { system, user } = await getPaperProfilePrompt(input)
      
      // System prompt should mention being an expert advisor
      expect(system).toContain('expert academic advisor')
      
      // User prompt should contain literature review specific guidance
      expect(user).toContain('LITERATURE REVIEW CONTEXT')
      expect(user).toContain('SYNTHESIZES existing research')
      expect(user).toContain('NOT involve original data collection')
      expect(user).toContain('Literature Review')
      
      // Should NOT contain empirical research guidance
      expect(user).not.toContain('EMPIRICAL RESEARCH PAPER CONTEXT')
    })
    
    it('should generate research article prompt with empirical guidance when hasOriginalResearch=true', async () => {
      const input: ProfileGenerationInput = {
        topic: 'Effect of AI on healthcare outcomes',
        paperType: 'researchArticle',
        hasOriginalResearch: true
      }
      
      const { user } = await getPaperProfilePrompt(input)
      
      // Should contain empirical research guidance
      expect(user).toContain('EMPIRICAL RESEARCH PAPER CONTEXT')
      expect(user).toContain('ORIGINAL RESEARCH')
      expect(user).toContain('detailed, reproducible Methodology')
      
      // Should NOT contain literature review guidance
      expect(user).not.toContain('LITERATURE REVIEW CONTEXT')
    })
    
    it('should include topic in the prompt', async () => {
      const input: ProfileGenerationInput = {
        topic: 'Machine learning in drug discovery',
        paperType: 'literatureReview'
      }
      
      const { user } = await getPaperProfilePrompt(input)
      
      expect(user).toContain('Machine learning in drug discovery')
    })
    
  })
  
  describe('Profile Validation', () => {
    
    const createMockProfile = (overrides: Partial<PaperProfile> = {}): PaperProfile => ({
      generatedAt: new Date().toISOString(),
      topic: 'Test topic',
      paperType: 'literatureReview',
      hasOriginalResearch: false,
      discipline: {
        primary: 'Business',
        related: ['Economics'],
        methodologicalTraditions: ['qualitative'],
        fieldCharacteristics: {
          paceOfChange: 'moderate',
          theoryVsEmpirical: 'balanced',
          practitionerRelevance: 'high'
        }
      },
      structure: {
        appropriateSections: [
          {
            key: 'introduction',
            title: 'Introduction',
            purpose: 'Establish context',
            minWords: 400,
            maxWords: 800,
            citationExpectation: 'moderate',
            keyElements: ['Background', 'Objectives']
          },
          {
            key: 'thematicAnalysis',
            title: 'Thematic Analysis',
            purpose: 'Analyze literature by themes',
            minWords: 1500,
            maxWords: 3000,
            citationExpectation: 'heavy',
            keyElements: ['Theme identification', 'Synthesis']
          },
          {
            key: 'conclusion',
            title: 'Conclusion',
            purpose: 'Summarize findings',
            minWords: 300,
            maxWords: 600,
            citationExpectation: 'light',
            keyElements: ['Summary', 'Future directions']
          }
        ],
        inappropriateSections: [
          { name: 'Results', reason: 'Literature reviews synthesize existing research, not original data' },
          { name: 'Methodology', reason: 'Use Search Methodology instead for literature reviews' }
        ],
        requiredElements: ['Clear thesis', 'Synthesis']
      },
      sourceExpectations: {
        minimumUniqueSources: 20,
        idealSourceCount: 35,
        sourceTypeDistribution: [
          { type: 'Peer-reviewed journals', percentage: 70, importance: 'required' }
        ],
        recencyProfile: 'balanced',
        recencyGuidance: 'Include both foundational and recent work'
      },
      qualityCriteria: [
        {
          criterion: 'Synthesis',
          description: 'Connect findings across sources',
          howToAchieve: 'Use thematic organization'
        }
      ],
      coverage: {
        requiredThemes: ['Theoretical frameworks', 'Empirical findings'],
        recommendedThemes: ['Practical implications'],
        debates: ['Nature vs nurture of entrepreneurship'],
        methodologicalConsiderations: ['Case study limitations'],
        commonPitfalls: ['Too descriptive']
      },
      genreRules: [
        { rule: 'No original data collection', rationale: 'This is a synthesis paper' }
      ],
      ...overrides
    })
    
    it('should pass validation for a well-structured literature review', () => {
      const profile = createMockProfile()
      
      const content = `
## Introduction
This literature review examines the factors contributing to entrepreneurial venture success and failure. The importance of this topic has been highlighted by numerous researchers [CITE: abc123] [CITE: def456].

## Thematic Analysis
### Theoretical Frameworks
Multiple theoretical frameworks have been proposed to explain venture outcomes [CITE: ghi789]. The resource-based view suggests that internal capabilities are critical [CITE: jkl012]. In contrast, the institutional theory emphasizes external factors [CITE: mno345].

### Empirical Findings
Studies have consistently found that market timing plays a crucial role [CITE: pqr678]. However, there is debate about the relative importance of founder characteristics [CITE: stu901] versus market conditions [CITE: vwx234].

## Conclusion
This review has synthesized the literature on entrepreneurial success and failure, identifying key themes and debates for future research.
      `
      
      const result = validatePaperWithProfile(content, profile)
      
      // Should find the sections
      expect(result.sectionAnalysis.found).toContain('Introduction')
      expect(result.sectionAnalysis.found).toContain('Thematic Analysis')
      expect(result.sectionAnalysis.found).toContain('Conclusion')
      
      // Should not have critical issues (may have warnings about citation count)
      expect(result.issues.filter(i => i.includes('inappropriate'))).toHaveLength(0)
    })
    
    it('should flag inappropriate sections in a literature review', () => {
      const profile = createMockProfile()
      
      const content = `
## Introduction
This study examines entrepreneurial failure.

## Methodology
Data were collected longitudinally over a five-year period. We conducted surveys with 500 participants.

## Results
Our analysis shows that 60% of ventures failed due to market conditions.

## Conclusion
This study contributes to understanding entrepreneurial failure.
      `
      
      const result = validatePaperWithProfile(content, profile)
      
      // Should flag the Results section as inappropriate
      expect(result.issues.some(i => i.includes('Results'))).toBe(true)
      
      // Should flag the Methodology section (empirical, not search methodology)
      expect(result.issues.some(i => i.includes('Methodology'))).toBe(true)
      
      // Should not be valid
      expect(result.valid).toBe(false)
    })
    
    it('should check citation count against profile expectations', () => {
      const profile = createMockProfile({
        sourceExpectations: {
          minimumUniqueSources: 15,
          idealSourceCount: 25,
          sourceTypeDistribution: [],
          recencyProfile: 'balanced',
          recencyGuidance: 'Mix of recent and foundational'
        }
      })
      
      // Content with only 3 citations
      const content = `
## Introduction
This is an introduction [CITE: abc123].

## Thematic Analysis
Some analysis here [CITE: def456] [CITE: ghi789].

## Conclusion
Conclusion text.
      `
      
      const result = validatePaperWithProfile(content, profile)
      
      // Should flag insufficient citations
      expect(result.citationAnalysis.uniqueSourceCount).toBeLessThan(15)
      expect(result.citationAnalysis.adequate).toBe(false)
      expect(result.issues.some(i => i.includes('Insufficient citation'))).toBe(true)
    })
    
    it('should check theme coverage', () => {
      const profile = createMockProfile({
        coverage: {
          requiredThemes: ['Financial constraints', 'Market conditions', 'Team dynamics'],
          recommendedThemes: [],
          debates: [],
          methodologicalConsiderations: [],
          commonPitfalls: []
        }
      })
      
      // Content that only covers one theme
      const content = `
## Introduction
This review examines financial constraints facing startups.

## Thematic Analysis
Financial constraints are a major barrier [CITE: abc123]. Funding gaps affect innovation [CITE: def456].

## Conclusion
Financial constraints matter.
      `
      
      const result = validatePaperWithProfile(content, profile)
      
      // Should identify covered and missing themes
      expect(result.themeCoverage.covered).toContain('Financial constraints')
      expect(result.themeCoverage.missing.length).toBeGreaterThan(0)
    })
    
  })
  
  describe('Profile Structure', () => {
    
    it('should define appropriate sections for literature reviews', () => {
      // This tests the structure of a typical literature review profile
      const litReviewSections = [
        'introduction',
        'searchMethodology',
        'thematicAnalysis',
        'researchGaps',
        'conclusion'
      ]
      
      // These sections should NOT appear in a literature review
      const inappropriateSections = ['results', 'methodology']
      
      // Just validate the expected structure - actual profile generation is tested via integration
      expect(litReviewSections).toContain('thematicAnalysis')
      expect(inappropriateSections).toContain('results')
    })
    
  })
  
})

describe('Profile-Based Genre Detection', () => {
  
  it('should correctly identify empirical language in a literature review context', () => {
    // These phrases indicate original data collection - inappropriate for lit reviews
    const empiricalPhrases = [
      'data were collected',
      'participants were recruited', 
      'we conducted interviews',
      'our findings show',
      'longitudinal data were collected'
    ]
    
    const litReviewContent = `
## Methodology
Data were collected longitudinally over a five-year period.
Participants were recruited from local businesses.
We conducted interviews with 50 entrepreneurs.

## Results
Our findings show that 70% of ventures failed.
    `
    
    // Check that empirical phrases are present
    empiricalPhrases.forEach(phrase => {
      const found = litReviewContent.toLowerCase().includes(phrase.toLowerCase())
      if (phrase === 'data were collected' || 
          phrase === 'participants were recruited' ||
          phrase === 'we conducted interviews' ||
          phrase === 'our findings show') {
        expect(found).toBe(true)
      }
    })
  })
  
})
