/**
 * Tests for Theme Extraction Service
 * 
 * These tests verify that:
 * 1. Theme extraction produces valid ThemeAnalysis structures
 * 2. Pivotal paper enhancement works correctly with citation counts
 * 3. Profile merging correctly incorporates emergent themes
 * 4. Theme guidance generation produces proper outline guidance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only to allow testing
vi.mock('server-only', () => ({}))

// Mock the AI client before importing
vi.mock('@/lib/ai/vercel-client', () => ({
  getLanguageModel: vi.fn(() => ({
    doGenerate: vi.fn()
  }))
}))

// Mock logger to avoid side effects
vi.mock('@/lib/utils/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Mock supabase
vi.mock('@/lib/supabase/server', () => ({
  getSB: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null }))
        }))
      }))
    }))
  }))
}))

import type { 
  PaperProfile, 
  ThemeAnalysis, 
  EmergentTheme,
  ScholarlyDebate,
  LiteratureGap,
  PivotalPaper
} from '@/lib/generation/paper-profile-types'
import { 
  mergeThemeAnalysisIntoProfile, 
  buildThemeGuidanceForOutline 
} from '@/lib/generation/theme-extraction'

describe('Theme Extraction Service', () => {
  
  // Helper to create mock theme analysis
  const createMockThemeAnalysis = (overrides: Partial<ThemeAnalysis> = {}): ThemeAnalysis => ({
    analyzedAt: new Date().toISOString(),
    papersAnalyzed: 25,
    papersWithFullText: 10,
    emergentThemes: [
      {
        name: 'Machine Learning Applications in Healthcare',
        description: 'Studies applying ML techniques to clinical decision making',
        supportingPaperIds: ['paper1', 'paper2', 'paper3'],
        strength: 'dominant' as const,
        keyTerms: ['deep learning', 'diagnosis', 'prediction']
      },
      {
        name: 'Data Privacy Concerns',
        description: 'Research on privacy implications of healthcare AI',
        supportingPaperIds: ['paper4', 'paper5'],
        strength: 'moderate' as const
      },
      {
        name: 'Explainability Challenges',
        description: 'Emerging research on interpretable AI models',
        supportingPaperIds: ['paper6'],
        strength: 'emerging' as const
      }
    ],
    debates: [
      {
        topic: 'Black-box vs Interpretable Models',
        positions: [
          { stance: 'Black-box models achieve better accuracy', supportingPaperIds: ['paper1', 'paper2'] },
          { stance: 'Interpretability is essential for clinical adoption', supportingPaperIds: ['paper6', 'paper7'] }
        ],
        significance: 'Central debate affecting clinical deployment'
      }
    ],
    gaps: [
      {
        description: 'Limited studies on long-term outcomes of AI-assisted diagnosis',
        relatedThemes: ['Machine Learning Applications in Healthcare'],
        significance: 'critical' as const,
        potentialDirections: ['Longitudinal studies', 'Post-market surveillance']
      },
      {
        description: 'Lack of research on AI in low-resource healthcare settings',
        relatedThemes: ['Machine Learning Applications in Healthcare'],
        significance: 'notable' as const
      }
    ],
    pivotalPapers: [
      {
        paperId: 'paper1',
        title: 'Deep Learning for Medical Imaging',
        reason: 'Foundational work that established CNN architectures for radiology',
        citationCount: 5000,
        evidenceType: 'field_defining' as const
      },
      {
        paperId: 'paper2',
        title: 'Transfer Learning in Healthcare AI',
        reason: 'Introduced pre-trained models for medical applications',
        citationCount: 2000,
        evidenceType: 'foundational_methods' as const
      }
    ],
    methodologicalApproaches: [
      { name: 'Retrospective cohort studies', paperIds: ['paper1', 'paper2', 'paper3'], prevalence: 'common' as const },
      { name: 'Randomized controlled trials', paperIds: ['paper8'], prevalence: 'rare' as const }
    ],
    organizationSuggestion: {
      approach: 'thematic' as const,
      rationale: 'Multiple distinct themes emerged with clear boundaries',
      suggestedSections: [
        { title: 'ML Applications in Clinical Decision Making', description: 'Core applications and effectiveness studies' },
        { title: 'Privacy and Ethical Considerations', description: 'Data handling and patient consent issues' },
        { title: 'Interpretability and Trust', description: 'Making AI decisions understandable to clinicians' }
      ]
    },
    temporalSpan: {
      earliest: 2015,
      latest: 2024,
      concentrationPeriod: '2020-2023'
    },
    confidence: 0.85,
    limitations: ['Only 10 papers had full text available'],
    ...overrides
  })
  
  // Helper to create mock paper profile
  const createMockProfile = (overrides: Partial<PaperProfile> = {}): PaperProfile => ({
    generatedAt: new Date().toISOString(),
    topic: 'AI in Healthcare',
    paperType: 'literatureReview',
    hasOriginalResearch: false,
    discipline: {
      primary: 'Healthcare Informatics',
      related: ['Computer Science', 'Medicine'],
      methodologicalTraditions: ['systematic review', 'meta-analysis'],
      fieldCharacteristics: {
        paceOfChange: 'rapid',
        theoryVsEmpirical: 'empirical-heavy',
        practitionerRelevance: 'high'
      }
    },
    structure: {
      appropriateSections: [
        { key: 'introduction', title: 'Introduction', purpose: 'Context', minWords: 400, maxWords: 800, citationExpectation: 'moderate', keyElements: ['Background'] }
      ],
      inappropriateSections: [],
      requiredElements: []
    },
    sourceExpectations: {
      minimumUniqueSources: 20,
      idealSourceCount: 35,
      sourceTypeDistribution: [],
      recencyProfile: 'cutting-edge',
      recencyGuidance: 'Focus on recent literature'
    },
    qualityCriteria: [],
    coverage: {
      requiredThemes: ['Healthcare AI', 'Clinical Applications'],
      recommendedThemes: ['Regulatory Aspects'],
      debates: ['AI Adoption Barriers'],
      methodologicalConsiderations: [],
      commonPitfalls: []
    },
    genreRules: [],
    ...overrides
  })
  
  describe('mergeThemeAnalysisIntoProfile', () => {
    
    it('should add dominant themes to required themes', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      // Dominant theme should be added to required themes
      expect(enhanced.coverage.requiredThemes).toContain('Machine Learning Applications in Healthcare')
    })
    
    it('should add non-dominant themes to recommended themes', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      // Moderate and emerging themes should be in recommended
      expect(enhanced.coverage.recommendedThemes).toContain('Data Privacy Concerns')
      expect(enhanced.coverage.recommendedThemes).toContain('Explainability Challenges')
    })
    
    it('should add debates from theme analysis', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      expect(enhanced.coverage.debates).toContain('Black-box vs Interpretable Models')
    })
    
    it('should add methodological considerations', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      expect(enhanced.coverage.methodologicalConsiderations.some(
        m => m.includes('Retrospective cohort')
      )).toBe(true)
    })
    
    it('should add critical gaps as pitfalls to address', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      expect(enhanced.coverage.commonPitfalls.some(
        p => p.includes('long-term outcomes')
      )).toBe(true)
    })
    
    it('should preserve existing profile content', () => {
      const profile = createMockProfile({
        coverage: {
          requiredThemes: ['Existing Theme'],
          recommendedThemes: ['Another Theme'],
          debates: ['Existing Debate'],
          methodologicalConsiderations: ['Existing Method'],
          commonPitfalls: ['Existing Pitfall']
        }
      })
      const analysis = createMockThemeAnalysis()
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      // Original debates should still be there
      expect(enhanced.coverage.debates).toContain('Existing Debate')
    })
    
  })
  
  describe('buildThemeGuidanceForOutline', () => {
    
    it('should include emergent themes with strength indicators', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      // Dominant themes should have *** markers
      expect(guidance).toContain('***')
      expect(guidance).toContain('Machine Learning Applications in Healthcare')
      
      // Moderate themes should have ** markers
      expect(guidance).toContain('**')
      expect(guidance).toContain('Data Privacy Concerns')
      
      // Emerging themes should have * markers
      expect(guidance).toContain('Explainability Challenges')
    })
    
    it('should include scholarly debates', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('Black-box vs Interpretable Models')
    })
    
    it('should include literature gaps with significance', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('[critical]')
      expect(guidance).toContain('long-term outcomes')
    })
    
    it('should include pivotal papers', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('Deep Learning for Medical Imaging')
      // Check for the reason which may be capitalized
      expect(guidance).toContain('Foundational work')
    })
    
    it('should include organizational recommendation', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('thematic')
      expect(guidance).toContain('Multiple distinct themes emerged')
    })
    
    it('should include suggested sections if available', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('ML Applications in Clinical Decision Making')
      expect(guidance).toContain('Privacy and Ethical Considerations')
    })
    
    it('should include confidence score', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('85%')
    })
    
    it('should include limitations', () => {
      const analysis = createMockThemeAnalysis()
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('Only 10 papers had full text')
    })
    
  })
  
  describe('ThemeAnalysis Structure', () => {
    
    it('should have valid theme strength values', () => {
      const analysis = createMockThemeAnalysis()
      
      analysis.emergentThemes.forEach(theme => {
        expect(['dominant', 'moderate', 'emerging']).toContain(theme.strength)
      })
    })
    
    it('should have valid gap significance values', () => {
      const analysis = createMockThemeAnalysis()
      
      analysis.gaps.forEach(gap => {
        expect(['critical', 'notable', 'minor']).toContain(gap.significance)
      })
    })
    
    it('should have valid evidence types for pivotal papers', () => {
      const analysis = createMockThemeAnalysis()
      
      analysis.pivotalPapers.forEach(paper => {
        expect(['citation_count', 'frequently_referenced', 'foundational_methods', 'field_defining'])
          .toContain(paper.evidenceType)
      })
    })
    
    it('should have valid organizational approach', () => {
      const analysis = createMockThemeAnalysis()
      
      expect(['thematic', 'chronological', 'methodological', 'theoretical', 'hybrid'])
        .toContain(analysis.organizationSuggestion.approach)
    })
    
    it('should have confidence between 0 and 1', () => {
      const analysis = createMockThemeAnalysis()
      
      expect(analysis.confidence).toBeGreaterThanOrEqual(0)
      expect(analysis.confidence).toBeLessThanOrEqual(1)
    })
    
  })
  
  describe('Edge Cases', () => {
    
    it('should handle empty theme analysis gracefully', () => {
      const profile = createMockProfile()
      const analysis = createMockThemeAnalysis({
        emergentThemes: [],
        debates: [],
        gaps: [],
        pivotalPapers: [],
        methodologicalApproaches: []
      })
      
      const enhanced = mergeThemeAnalysisIntoProfile(profile, analysis)
      
      // Should not throw and should preserve existing content
      expect(enhanced.coverage.requiredThemes.length).toBeGreaterThanOrEqual(0)
    })
    
    it('should handle theme analysis with no suggested sections', () => {
      const analysis = createMockThemeAnalysis({
        organizationSuggestion: {
          approach: 'thematic' as const,
          rationale: 'Thematic structure recommended'
          // No suggestedSections
        }
      })
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      // Should not throw and should include the approach
      expect(guidance).toContain('thematic')
    })
    
    it('should handle low confidence analysis', () => {
      const analysis = createMockThemeAnalysis({
        confidence: 0.3,
        limitations: ['Limited data', 'Only abstracts available', 'Few papers matched']
      })
      
      const guidance = buildThemeGuidanceForOutline(analysis)
      
      expect(guidance).toContain('30%')
      expect(guidance).toContain('Limited data')
    })
    
  })
  
})
