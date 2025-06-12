import { describe, test, expect } from 'vitest'
import {
  checkCitationDensity,
  checkDepthCues,
  performQualityCheck,
  createReviewEvent,
  generateStrongerPrompt,
  DEFAULT_QUALITY_CONFIG,
  type QualityCheckResult
} from '@/lib/utils/citation-depth-checker'

describe('Citation-Density & Depth Checker', () => {
  describe('checkCitationDensity', () => {
    test('should detect proper citation density with sufficient citations', () => {
      const content = `
This is the first paragraph with a citation [CITE:123e4567-e89b-12d3-a456-426614174000].

This is the second paragraph also with a citation [CITE:987fcdeb-51a2-43b1-8901-234567890abc].

This third paragraph has multiple citations [CITE:456e789a-b123-4567-c890-def123456789] and another [CITE:111e2222-3333-4444-5555-666677778888].
      `.trim()

      const result = checkCitationDensity(content, 1)
      
      expect(result.paragraphCount).toBe(3)
      expect(result.citationCount).toBe(4)
      expect(result.citationDensity).toBeCloseTo(1.33, 2)
      expect(result.meetsDensityRequirement).toBe(true)
      expect(result.uncitedParagraphs).toEqual([])
      expect(result.citationsParagraphs).toHaveLength(3)
    })

    test('should detect insufficient citation density', () => {
      const content = `
This is the first paragraph with a citation [CITE:123e4567-e89b-12d3-a456-426614174000].

This is the second paragraph without any citations.

This third paragraph also lacks proper citations.
      `.trim()

      const result = checkCitationDensity(content, 1)
      
      expect(result.paragraphCount).toBe(3)
      expect(result.citationCount).toBe(1)
      expect(result.citationDensity).toBeCloseTo(0.33, 2)
      expect(result.meetsDensityRequirement).toBe(false)
      expect(result.uncitedParagraphs).toEqual([1, 2])
      expect(result.citationsParagraphs).toHaveLength(1)
    })

    test('should handle content with no citations', () => {
      const content = `
This is a paragraph without citations.

Another paragraph also without citations.
      `.trim()

      const result = checkCitationDensity(content, 1)
      
      expect(result.paragraphCount).toBe(2)
      expect(result.citationCount).toBe(0)
      expect(result.citationDensity).toBe(0)
      expect(result.meetsDensityRequirement).toBe(false)
      expect(result.uncitedParagraphs).toEqual([0, 1])
      expect(result.citationsParagraphs).toHaveLength(0)
    })

    test('should handle empty content', () => {
      const result = checkCitationDensity('', 1)
      
      expect(result.paragraphCount).toBe(0)
      expect(result.citationCount).toBe(0)
      expect(result.citationDensity).toBe(0)
      expect(result.meetsDensityRequirement).toBe(false) // Edge case: no paragraphs means requirement is not met
    })
  })

  describe('checkDepthCues', () => {
    test('should detect all required depth cues', () => {
      const content = `
This study compares different methodologies used in the research.
The authors critique the previous approaches and identify significant gaps in the literature.
Statistical analysis shows that 75% of participants demonstrated improved outcomes.
      `.trim()

      const result = checkDepthCues(content, ['compare', 'critique', 'gap', 'statistics'])
      
      expect(result.foundCues).toContain('compare')
      expect(result.foundCues).toContain('critique')
      expect(result.foundCues).toContain('gap')
      expect(result.foundCues).toContain('statistics')
      expect(result.missingCues).toEqual([])
      expect(result.meetsDepthRequirement).toBe(true)
    })

    test('should detect missing depth cues', () => {
      const content = `
This is a simple descriptive paragraph about the topic.
The study showed some findings but lacks critical analysis.
      `.trim()

      const result = checkDepthCues(content, ['compare', 'critique', 'gap', 'statistics'])
      
      // Note: 'lack' matches 'gap' variations, so we expect only one found cue
      expect(result.foundCues).toEqual(['gap'])
      expect(result.missingCues).toEqual(['compare', 'critique', 'statistics'])
      expect(result.meetsDepthRequirement).toBe(false)
    })

    test('should detect partial depth cues (meets 50% requirement)', () => {
      const content = `
The study compares different approaches to the problem.
Results show significant differences between groups.
However, the analysis lacks critical evaluation of methods.
      `.trim()

      const result = checkDepthCues(content, ['compare', 'critique', 'gap', 'statistics'])
      
      expect(result.foundCues).toContain('compare')
      expect(result.foundCues).toContain('statistics') // 'significant' matches 'statistics'
      // We found: compare, critique (via 'critical'), gap (via 'lacks'), statistics (via 'significant')
      expect(result.foundCues).toHaveLength(4)
      expect(result.missingCues).toEqual([])
      expect(result.meetsDepthRequirement).toBe(true) // 4/4 = 100%
    })

    test('should recognize variations of depth cues', () => {
      const content = `
The comparative analysis reveals differences between approaches.
Evaluation of the methodology shows limitations.
Data indicates 65% improvement in outcomes.
      `.trim()

      const result = checkDepthCues(content, ['compare', 'critique', 'statistics'])
      
      // Should find 'compare' via 'comparative', 'critique' via 'evaluation', 'statistics' via 'data'
      expect(result.foundCues).toContain('compare')
      expect(result.foundCues).toContain('critique')
      expect(result.foundCues).toContain('statistics')
      expect(result.meetsDepthRequirement).toBe(true)
    })
  })

  describe('performQualityCheck', () => {
    test('should return excellent quality for high-quality content', () => {
      const content = `
This study compares different methodologies [CITE:123e4567-e89b-12d3-a456-426614174000].

The authors critique previous approaches and identify gaps [CITE:987fcdeb-51a2-43b1-8901-234567890abc].

Statistical analysis shows 75% improvement [CITE:456e789a-b123-4567-c890-def123456789].
      `.trim()

      const result = performQualityCheck(content, ['compare', 'critique', 'gap', 'statistics'], 1)
      
      expect(result.overallQuality).toBe('excellent')
      expect(result.requiresReview).toBe(false)
      expect(result.citationCheck.meetsDensityRequirement).toBe(true)
      expect(result.depthCheck.meetsDepthRequirement).toBe(true)
      expect(result.suggestions).toContain('Excellent citation density and critical depth!')
    })

    test('should return poor quality for content lacking citations and depth', () => {
      const content = `
This is a simple paragraph without proper academic analysis.

Another paragraph that just describes basic information.

No critical thinking or citations are present here.
      `.trim()

      const result = performQualityCheck(content, ['compare', 'critique', 'gap', 'statistics'], 1)
      
      expect(result.overallQuality).toBe('poor')
      expect(result.requiresReview).toBe(true)
      expect(result.citationCheck.meetsDensityRequirement).toBe(false)
      expect(result.depthCheck.meetsDepthRequirement).toBe(false)
      expect(result.suggestions.some(s => s.includes('Critical:'))).toBe(true)
    })

    test('should return needs_review for content with one deficiency', () => {
      const content = `
This study compares different methodologies and critiques previous work [CITE:123e4567-e89b-12d3-a456-426614174000].

The analysis identifies gaps in current research [CITE:987fcdeb-51a2-43b1-8901-234567890abc].

However, this paragraph lacks proper citations.
      `.trim()

      const result = performQualityCheck(content, ['compare', 'critique', 'gap'], 1)
      
      expect(result.overallQuality).toBe('needs_review')
      expect(result.requiresReview).toBe(true)
      expect(result.citationCheck.meetsDensityRequirement).toBe(false) // 2/3 < 1.0
      expect(result.depthCheck.meetsDepthRequirement).toBe(true)
    })
  })

  describe('createReviewEvent', () => {
    test('should create proper review event structure', () => {
      const qualityCheck: QualityCheckResult = {
        citationCheck: {
          paragraphCount: 2,
          citationCount: 0,
          citationDensity: 0,
          citationsParagraphs: [],
          uncitedParagraphs: [0, 1],
          meetsDensityRequirement: false
        },
        depthCheck: {
          requiredCues: ['compare', 'critique'],
          foundCues: [],
          missingCues: ['compare', 'critique'],
          meetsDepthRequirement: false,
          cueDetails: [
            { cue: 'compare', found: false, occurrences: 0 },
            { cue: 'critique', found: false, occurrences: 0 }
          ]
        },
        overallQuality: 'poor',
        requiresReview: true,
        suggestions: ['Critical: No citations found']
      }

      const event = createReviewEvent('literature-review', qualityCheck, 'Literature Review Section')
      
      expect(event.type).toBe('review')
      expect(event.stage).toBe('literature-review')
      expect(event.sectionTitle).toBe('Literature Review Section')
      expect(event.qualityCheck).toEqual(qualityCheck)
      expect(event.timestamp).toBeDefined()
      expect(new Date(event.timestamp)).toBeInstanceOf(Date)
    })
  })

  describe('generateStrongerPrompt', () => {
    test('should enhance prompt for content lacking citations', () => {
      const originalPrompt = 'Write a literature review section.'
      const qualityCheck: QualityCheckResult = {
        citationCheck: {
          paragraphCount: 3,
          citationCount: 0,
          citationDensity: 0,
          citationsParagraphs: [],
          uncitedParagraphs: [0, 1, 2],
          meetsDensityRequirement: false
        },
        depthCheck: {
          requiredCues: ['compare'],
          foundCues: ['compare'],
          missingCues: [],
          meetsDepthRequirement: true,
          cueDetails: [{ cue: 'compare', found: true, occurrences: 1 }]
        },
        overallQuality: 'needs_review',
        requiresReview: true,
        suggestions: ['Add more citations']
      }

      const enhancedPrompt = generateStrongerPrompt(originalPrompt, qualityCheck)
      
      expect(enhancedPrompt).toContain(originalPrompt)
      expect(enhancedPrompt).toContain('EVERY paragraph contains at least one citation')
      expect(enhancedPrompt).toContain('[CITE:paperID]')
      expect(enhancedPrompt).toContain('missing citations in 3 paragraphs')
    })

    test('should enhance prompt for content lacking depth cues', () => {
      const originalPrompt = 'Write a literature review section.'
      const qualityCheck: QualityCheckResult = {
        citationCheck: {
          paragraphCount: 2,
          citationCount: 2,
          citationDensity: 1,
          citationsParagraphs: [],
          uncitedParagraphs: [],
          meetsDensityRequirement: true
        },
        depthCheck: {
          requiredCues: ['compare', 'critique'],
          foundCues: [],
          missingCues: ['compare', 'critique'],
          meetsDepthRequirement: false,
          cueDetails: []
        },
        overallQuality: 'needs_review',
        requiresReview: true,
        suggestions: ['Add critical analysis']
      }

      const enhancedPrompt = generateStrongerPrompt(originalPrompt, qualityCheck)
      
      expect(enhancedPrompt).toContain('CRITICAL ANALYSIS REQUIRED')
      expect(enhancedPrompt).toContain('compare, critique')
      expect(enhancedPrompt).toContain('compare", "critique", "evaluate", and "analyze"')
    })
  })

  describe('Task 7 Acceptance Criteria', () => {
    test('sample text lacking citations should trigger review event', () => {
      const contentWithoutCitations = `
This is a paragraph about research methodology.

Another paragraph discussing findings without proper citations.

The conclusion summarizes the main points.
      `.trim()

      const qualityCheck = performQualityCheck(
        contentWithoutCitations, 
        DEFAULT_QUALITY_CONFIG.requiredDepthCues,
        DEFAULT_QUALITY_CONFIG.minCitationPerPara
      )

      // Should trigger review due to lack of citations
      expect(qualityCheck.requiresReview).toBe(true)
      expect(qualityCheck.citationCheck.meetsDensityRequirement).toBe(false)
      
      const reviewEvent = createReviewEvent('section-review', qualityCheck)
      expect(reviewEvent.type).toBe('review')
      expect(reviewEvent.qualityCheck.requiresReview).toBe(true)
    })

    test('sample text lacking depth cues should trigger review event', () => {
      const contentWithoutDepth = `
This paragraph has proper citations [CITE:123e4567-e89b-12d3-a456-426614174000].

Another cited paragraph [CITE:987fcdeb-51a2-43b1-8901-234567890abc].

Final paragraph with citation [CITE:456e789a-b123-4567-c890-def123456789].
      `.trim()

      const qualityCheck = performQualityCheck(
        contentWithoutDepth, 
        DEFAULT_QUALITY_CONFIG.requiredDepthCues,
        DEFAULT_QUALITY_CONFIG.minCitationPerPara
      )

      // Should trigger review due to lack of depth cues
      expect(qualityCheck.requiresReview).toBe(true)
      expect(qualityCheck.depthCheck.meetsDepthRequirement).toBe(false)
      
      const reviewEvent = createReviewEvent('section-review', qualityCheck)
      expect(reviewEvent.type).toBe('review')
      expect(reviewEvent.qualityCheck.requiresReview).toBe(true)
    })

    test('high-quality content should not trigger review event', () => {
      const highQualityContent = `
This study compares different methodological approaches [CITE:123e4567-e89b-12d3-a456-426614174000].

The authors critique previous research and identify significant gaps [CITE:987fcdeb-51a2-43b1-8901-234567890abc].

Statistical analysis reveals 85% improvement in outcomes [CITE:456e789a-b123-4567-c890-def123456789].
      `.trim()

      const qualityCheck = performQualityCheck(
        highQualityContent, 
        DEFAULT_QUALITY_CONFIG.requiredDepthCues,
        DEFAULT_QUALITY_CONFIG.minCitationPerPara
      )

      // Should NOT trigger review - content is high quality
      expect(qualityCheck.requiresReview).toBe(false)
      expect(qualityCheck.citationCheck.meetsDensityRequirement).toBe(true)
      expect(qualityCheck.depthCheck.meetsDepthRequirement).toBe(true)
      expect(qualityCheck.overallQuality).toBe('excellent')
    })
  })
}) 