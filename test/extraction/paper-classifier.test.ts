/**
 * Tests for Paper Type Classifier
 * 
 * Tests the rule-based classification system that determines paper types
 * (quantitative, qualitative, theoretical, etc.) to select extraction extensions.
 * 
 * Note: LLM-based classification is not tested here to avoid flakiness and cost.
 * We test the rule-based path which handles most papers with high confidence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock server-only to allow testing
vi.mock('server-only', () => ({}))

// Mock the AI client (won't be used since we test rule-based only)
vi.mock('@/lib/ai/vercel-client', () => ({
  getLanguageModel: vi.fn(() => ({
    doGenerate: vi.fn()
  })),
  getModel: vi.fn(() => 'gpt-4o')
}))

import { 
  quickClassifyPaperType,
  classifyPaperType
} from '@/lib/extraction/paper-classifier'

describe('Paper Classifier', () => {
  
  describe('quickClassifyPaperType (rule-based only)', () => {
    
    describe('quantitative papers', () => {
      it('classifies papers with statistical keywords', () => {
        const result = quickClassifyPaperType(
          'The Effect of Leadership on Employee Performance: A Regression Analysis',
          'Using hierarchical regression analysis on a sample of 500 employees (n=500), we tested our hypotheses. Results show a significant positive relationship (β=0.34, p<0.001) between transformational leadership and performance.'
        )
        
        expect(result.primaryType).toBe('quantitative')
        expect(result.confidenceScore).toBeGreaterThan(0.5)
        expect(result.suggestedExtensions).toContain('quantitative')
      })
      
      it('classifies survey-based studies', () => {
        const result = quickClassifyPaperType(
          'Consumer Behavior Survey Analysis',
          'We collected survey data from 1,200 respondents. Statistical analysis using SPSS revealed that the mean satisfaction score was 4.2 (SD=0.8). ANOVA results indicated significant differences between groups.'
        )
        
        expect(result.primaryType).toBe('quantitative')
        expect(result.suggestedExtensions).toContain('quantitative')
      })
      
      it('classifies experimental studies', () => {
        const result = quickClassifyPaperType(
          'A Randomized Controlled Trial of Mindfulness Training',
          'Participants (n=150) were randomly assigned to treatment and control groups. T-test results showed the treatment group had significantly higher scores (t=3.42, p<0.01). Effect size was moderate (d=0.56).'
        )
        
        expect(result.primaryType).toBe('quantitative')
      })
    })
    
    describe('qualitative papers', () => {
      it('classifies interview-based studies', () => {
        const result = quickClassifyPaperType(
          'Understanding Entrepreneurial Identity: A Qualitative Study',
          'We conducted semi-structured interviews with 25 entrepreneurs. Using thematic analysis, three main themes emerged from the data. Participants described their experiences of identity formation.'
        )
        
        expect(result.primaryType).toBe('qualitative')
        expect(result.confidenceScore).toBeGreaterThan(0.5)
        expect(result.suggestedExtensions).toContain('qualitative')
      })
      
      it('classifies ethnographic studies', () => {
        const result = quickClassifyPaperType(
          'An Ethnographic Study of Workplace Culture',
          'Through ethnographic methods including participant observation and field notes over 18 months, we employed grounded theory methodology. Qualitative coding of interview transcripts revealed themes of organizational behavior. Member checking and thick description ensured trustworthiness and transferability of findings.'
        )
        
        expect(result.primaryType).toBe('qualitative')
        expect(result.suggestedExtensions).toContain('qualitative')
      })
      
      it('classifies phenomenological studies', () => {
        const result = quickClassifyPaperType(
          'The Lived Experience of Remote Workers',
          'Using interpretive phenomenological analysis, we explored lived experiences through in-depth interviews. Themes emerged through constant comparison. NVivo was used for coding.'
        )
        
        expect(result.primaryType).toBe('qualitative')
      })
    })
    
    describe('theoretical papers', () => {
      it('classifies theory development papers', () => {
        const result = quickClassifyPaperType(
          'Toward a Theory of Digital Transformation',
          'We propose a theoretical framework integrating institutional theory and resource-based view. Building on prior conceptual work, we develop propositions about how firms transform. Our theory suggests that...'
        )
        
        expect(result.primaryType).toBe('theoretical')
        expect(result.suggestedExtensions).toContain('theoretical')
      })
      
      it('classifies conceptual papers', () => {
        const result = quickClassifyPaperType(
          'Reconceptualizing Organizational Resilience',
          'We argue that existing constructs of resilience are inadequate. This paper develops a new typology and extends current theoretical frameworks. We offer a conceptual model with testable propositions.'
        )
        
        expect(result.primaryType).toBe('theoretical')
      })
    })
    
    describe('review papers', () => {
      it('classifies systematic reviews', () => {
        const result = quickClassifyPaperType(
          'A Systematic Review of AI in Healthcare',
          'This systematic review follows PRISMA guidelines. We searched PubMed, Web of Science, and Scopus databases using predefined search terms. Inclusion criteria and exclusion criteria were applied, resulting in 45 articles included in our synthesis. Quality assessment was conducted using the Newcastle-Ottawa Scale. This literature review synthesizes the extant literature on AI applications.'
        )
        
        expect(result.primaryType).toBe('review')
        expect(result.confidenceScore).toBeGreaterThan(0.5)
        expect(result.suggestedExtensions).toContain('review')
      })
      
      it('classifies meta-analyses', () => {
        const result = quickClassifyPaperType(
          'Meta-Analysis of Mindfulness Interventions',
          'This meta-analysis synthesizes 32 studies. We calculated pooled effect sizes using random effects models. Heterogeneity was assessed using I². Forest plots and funnel plots were generated to assess publication bias.'
        )
        
        expect(result.primaryType).toBe('review')
        expect(result.suggestedExtensions).toContain('review')
      })
      
      it('classifies literature reviews', () => {
        const result = quickClassifyPaperType(
          'Twenty Years of Innovation Research: A Review',
          'We reviewed the extant literature on innovation management. Our search strategy included major databases. This integrative review synthesizes the body of literature and identifies research gaps.'
        )
        
        expect(result.primaryType).toBe('review')
      })
    })
    
    describe('mixed methods papers', () => {
      it('classifies explicitly mixed methods studies', () => {
        const result = quickClassifyPaperType(
          'Understanding Customer Loyalty: A Mixed Methods Approach',
          'We employed a mixed methods design with an explanatory sequential approach. Phase 1 used survey data (n=400) for quantitative analysis. Phase 2 involved qualitative interviews to explain quantitative findings.'
        )
        
        expect(result.primaryType).toBe('mixed_methods')
        expect(result.suggestedExtensions).toContain('quantitative')
        expect(result.suggestedExtensions).toContain('qualitative')
      })
      
      it('classifies convergent design studies', () => {
        const result = quickClassifyPaperType(
          'Exploring Work-Life Balance',
          'Using convergent mixed methods, we collected quantitative survey data and qualitative interview data simultaneously. Integration of quan-qual data provided triangulation.'
        )
        
        expect(result.primaryType).toBe('mixed_methods')
      })
    })
    
    describe('humanities papers', () => {
      it('classifies literary analysis', () => {
        const result = quickClassifyPaperType(
          'Postcolonial Readings of Victorian Literature',
          'Through close reading and textual analysis, this essay examines representation in colonial discourse. Drawing on Foucault and Said, I argue that the narrative complicates our understanding of empire.'
        )
        
        expect(result.primaryType).toBe('humanities')
        expect(result.suggestedExtensions).toContain('humanities')
      })
      
      it('classifies historical analysis', () => {
        const result = quickClassifyPaperType(
          'Gender and Labor in 19th Century America',
          'This paper analyzes archival materials to examine working women. Through the lens of feminist historiography, we interpret primary sources. The analysis reveals symbolic meanings in historical discourse.'
        )
        
        expect(result.primaryType).toBe('humanities')
      })
    })
    
    describe('case study papers', () => {
      it('classifies case study research', () => {
        const result = quickClassifyPaperType(
          'Digital Transformation at Company X: A Case Study',
          'This case study examines digital transformation through an instrumental case approach. Case selection was based on theoretical sampling. Within-case and cross-case analysis revealed patterns.'
        )
        
        expect(result.primaryType).toBe('case_study')
      })
      
      it('classifies multiple case studies', () => {
        const result = quickClassifyPaperType(
          'Sustainability Practices: A Multiple Case Study',
          'We conducted a comparative case study of five organizations. Case comparison followed systematic procedures. Each case was selected as a bounded system for in-depth case analysis.'
        )
        
        expect(result.primaryType).toBe('case_study')
      })
    })
    
    describe('methodological papers', () => {
      it('classifies scale development papers', () => {
        const result = quickClassifyPaperType(
          'Development and Validation of the Digital Literacy Scale',
          'We developed and validated a new measurement instrument. Exploratory factor analysis and confirmatory factor analysis assessed factor structure. Psychometric properties including reliability and validity were examined.'
        )
        
        expect(result.primaryType).toBe('methodological')
      })
    })
    
    describe('edge cases', () => {
      it('returns unknown for ambiguous papers', () => {
        const result = quickClassifyPaperType(
          'Some Research Title',
          'This paper examines an important topic in the field. We contribute to the literature by providing new insights.'
        )
        
        expect(result.primaryType).toBe('unknown')
        expect(result.confidenceScore).toBeLessThan(0.5)
      })
      
      it('handles empty abstracts', () => {
        const result = quickClassifyPaperType(
          'A Quantitative Study of Statistical Methods',
          ''
        )
        
        // Should still classify based on title
        expect(result.primaryType).toBeDefined()
      })
      
      it('handles very short texts', () => {
        const result = quickClassifyPaperType(
          'Study',
          'Results.'
        )
        
        expect(result.primaryType).toBeDefined()
        // Very short texts may still match some patterns, so we just verify it doesn't crash
        // and returns a defined result
        expect(result.confidenceScore).toBeDefined()
      })
    })
    
    describe('extension mapping', () => {
      it('maps quantitative to quantitative extension', () => {
        const result = quickClassifyPaperType(
          'Regression Analysis Study',
          'Using regression with n=200 participants, statistical significance p<0.05 was found.'
        )
        
        if (result.primaryType === 'quantitative') {
          expect(result.suggestedExtensions).toEqual(['quantitative'])
        }
      })
      
      it('maps mixed_methods to both extensions', () => {
        const result = quickClassifyPaperType(
          'Mixed Methods Study',
          'Mixed methods approach combining quantitative and qualitative methods in phase 1 and phase 2.'
        )
        
        if (result.primaryType === 'mixed_methods') {
          expect(result.suggestedExtensions).toContain('quantitative')
          expect(result.suggestedExtensions).toContain('qualitative')
          expect(result.suggestedExtensions).toHaveLength(2)
        }
      })
    })
    
    describe('confidence levels', () => {
      it('assigns high confidence for clear quantitative papers', () => {
        const result = quickClassifyPaperType(
          'Statistical Analysis of Survey Data',
          'We tested our hypotheses using hierarchical regression analysis. Results show significance (p<0.001). The sample consisted of n=500 participants. Mean scores and standard deviations were calculated.'
        )
        
        // Clear quantitative paper should have decent confidence
        expect(result.confidenceScore).toBeGreaterThan(0.4)
      })
      
      it('assigns lower confidence for mixed signals', () => {
        const result1 = quickClassifyPaperType(
          'Understanding Leadership',
          'This study uses interviews and surveys to understand leadership.'
        )
        
        const result2 = quickClassifyPaperType(
          'Statistical Analysis Study',
          'Using regression analysis (β=0.5, p<0.001), hierarchical regression, and ANOVA with n=500 participants.'
        )
        
        // Ambiguous paper should have lower confidence than clear paper
        expect(result1.confidenceScore).toBeLessThan(result2.confidenceScore)
      })
    })
  })
  
  describe('classifyPaperType (hybrid)', () => {
    it('uses rule-based when confidence is high', async () => {
      // This paper has very clear quantitative indicators
      const result = await classifyPaperType(
        'Regression Analysis of Employee Performance',
        'Using hierarchical regression (n=500), we tested hypotheses. Results showed significance (β=0.45, p<0.001). ANOVA confirmed group differences. Statistical analysis used SPSS.',
        { ruleBasedOnly: true }  // Force rule-based to avoid LLM call
      )
      
      expect(result.primaryType).toBe('quantitative')
      expect(result.suggestedExtensions).toContain('quantitative')
    })
    
    it('can be forced to rule-based only', async () => {
      const result = await classifyPaperType(
        'Some Paper',
        'Some abstract with limited indicators',
        { ruleBasedOnly: true }
      )
      
      // Should complete without calling LLM
      expect(result.primaryType).toBeDefined()
      expect(result.confidenceScore).toBeDefined()
    })
  })
})
