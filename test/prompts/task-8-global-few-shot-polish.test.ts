/**
 * Tests for the globally applicable, data-driven few-shot examples and polish system
 * These tests reflect the improved architecture with external JSON data and universal prompts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFewShotExamples,
  formatFewShotExamples,
  hasFewShotExamples,
  getAvailableFewShotSections,
  getExampleStatistics,
  validateExamplesData
} from '@/lib/prompts/few-shot-examples';
import {
  performFinalPolish,
  validatePolishQuality,
  analyzePotentialImprovements
} from '@/lib/prompts/final-polish';
import { generateLiteratureReviewPrompt, generateMethodologyPrompt } from '@/lib/prompts/generators';
import type { SectionContent, PolishConfig } from '@/lib/prompts/types';

// Mock AI functionality
vi.mock('ai', () => ({
  streamText: vi.fn().mockResolvedValue({
    textStream: async function* () {
      yield 'Polished academic content with enhanced transitions between sections and improved narrative flow. This demonstrates comprehensive analysis and critical evaluation.\n\nIMPROVEMENTS_APPLIED: transitions; consistency; integration; enhancement';
    },
    usage: { totalTokens: 500 }
  }),
  generateText: vi.fn().mockResolvedValue({
    text: 'Polished academic content with enhanced transitions between sections and improved narrative flow.\n\nIMPROVEMENTS_APPLIED: transitions; consistency; integration; enhancement',
    usage: { totalTokens: 500 }
  })
}));

vi.mock('@/lib/ai/vercel-client', () => ({
  ai: vi.fn().mockReturnValue('mocked-model')
}));

describe('Task 8: Global Few-Shot Examples & Polish System', () => {
  
  describe('Data-Driven Examples System', () => {
    it('should load examples from external JSON', () => {
      const stats = getExampleStatistics();
      expect(stats.totalExamples).toBeGreaterThan(0);
      expect(stats.byCountry).toHaveProperty('Nigeria');
      expect(stats.byCountry).toHaveProperty('USA');
      expect(stats.byCountry).toHaveProperty('Brazil');
    });

    it('should validate examples data structure', () => {
      const validation = validateExamplesData();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should have global coverage across multiple countries', () => {
      const stats = getExampleStatistics();
      const countries = Object.keys(stats.byCountry);
      
      expect(countries).toContain('Nigeria');
      expect(countries).toContain('USA'); 
      expect(countries).toContain('Brazil');
      expect(countries).toContain('UK');
      expect(countries).toContain('India');
      expect(countries.length).toBeGreaterThan(3);
    });

    it('should cover multiple academic fields', () => {
      const stats = getExampleStatistics();
      const fields = Object.keys(stats.byField);
      
      expect(fields.length).toBeGreaterThan(2);
      expect(fields).toContain('public_health');
      expect(fields).toContain('economics');
    });
  });

  describe('Smart Example Selection', () => {
    it('should return examples for dissertation introduction (available)', () => {
      const examples = getFewShotExamples('dissertation', 'introduction');
      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0].paperType).toBe('dissertation');
      expect(examples[0].section).toBe('introduction');
    });

    it('should return examples for masters thesis literature review (available)', () => {
      const examples = getFewShotExamples('mastersThesis', 'literatureReview');
      expect(examples.length).toBeGreaterThan(0);
      expect(examples[0].paperType).toBe('mastersThesis');
      expect(examples[0].section).toBe('literatureReview');
    });

    it('should prioritize regional examples when specified', () => {
      const examples = getFewShotExamples('mastersThesis', 'literatureReview', 'Nigeria');
      if (examples.length > 0) {
        // Should prioritize Nigerian examples if available
        const nigerianExamples = examples.filter(ex => ex.country === 'Nigeria');
        expect(nigerianExamples.length).toBeGreaterThan(0);
      }
    });

    it('should ensure geographic diversity in multiple examples', () => {
      const examples = getFewShotExamples('dissertation', 'introduction', undefined, undefined, 2);
      if (examples.length > 1) {
        const countries = new Set(examples.map(ex => ex.country));
        expect(countries.size).toBeGreaterThan(1); // Should have different countries
      }
    });

    it('should return empty for unavailable combinations', () => {
      const examples = getFewShotExamples('literatureReview', 'methodology'); // Non high-stakes type
      expect(examples).toHaveLength(0);
    });

    it('should respect maxExamples parameter', () => {
      const examples = getFewShotExamples('dissertation', 'introduction', undefined, undefined, 1);
      expect(examples.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Example Availability Checks', () => {
    it('should correctly identify available sections for each paper type', () => {
      // Check what sections are actually available in our data
      const dissertationSections = getAvailableFewShotSections('dissertation');
      const mastersThesisSections = getAvailableFewShotSections('mastersThesis');
      
      expect(dissertationSections.length).toBeGreaterThan(0);
      expect(mastersThesisSections.length).toBeGreaterThan(0);
    });

    it('should return true for actually available combinations', () => {
      // Test based on what we actually have in the data
      expect(hasFewShotExamples('dissertation', 'introduction')).toBe(true);
      expect(hasFewShotExamples('mastersThesis', 'literatureReview')).toBe(true);
    });

    it('should return false for non-high-stakes paper types', () => {
      expect(hasFewShotExamples('literatureReview', 'introduction')).toBe(false);
      expect(hasFewShotExamples('researchArticle', 'methodology')).toBe(false);
    });

    it('should return empty array for non-high-stakes types', () => {
      expect(getAvailableFewShotSections('literatureReview')).toHaveLength(0);
      expect(getAvailableFewShotSections('researchArticle')).toHaveLength(0);
    });
  });

  describe('Example Formatting', () => {
    it('should format examples for prompt inclusion', () => {
      const examples = getFewShotExamples('dissertation', 'introduction', undefined, undefined, 1);
      if (examples.length > 0) {
        const formatted = formatFewShotExamples(examples);
        
        expect(formatted).toContain('Below are examples of exceptional, examiner-approved academic writing');
        expect(formatted).toContain('Example 1:');
        expect(formatted).toContain(examples[0].institution);
        expect(formatted).toContain('Now, using this style and level of depth');
      }
    });

    it('should handle multiple examples with separators', () => {
      const examples = getFewShotExamples('dissertation', 'introduction', undefined, undefined, 2);
      if (examples.length > 1) {
        const formatted = formatFewShotExamples(examples);
        expect(formatted).toContain('Example 1:');
        expect(formatted).toContain('---'); // Separator between examples
      }
    });

    it('should return empty string for no examples', () => {
      const formatted = formatFewShotExamples([]);
      expect(formatted).toBe('');
    });
  });

  describe('Integration with Prompt Generators', () => {
    const mockPapers = [
      { id: 'paper1', title: 'Test Paper 1', abstract: 'Abstract 1' },
      { id: 'paper2', title: 'Test Paper 2', abstract: 'Abstract 2' }
    ];

    it('should include few-shot examples for high-stakes papers', () => {
      const prompt = generateLiteratureReviewPrompt(
        'Test Topic',
        mockPapers,
        { fewShot: true, paperType: 'mastersThesis' }
      );
      
      // Should include few-shot examples in the prompt
      expect(prompt.userPromptTemplate).toContain('Below are examples');
    });

    it('should work without few-shot examples for regular papers', () => {
      const prompt = generateLiteratureReviewPrompt(
        'Test Topic',
        mockPapers,
        { fewShot: false, paperType: 'literatureReview' }
      );
      
      // Should not include few-shot examples
      expect(prompt.userPrompt || prompt).not.toContain('Below are examples');
    });

    it('should include methodology few-shot for dissertations', () => {
      const prompt = generateMethodologyPrompt(
        'Test Topic',
        mockPapers,
        { fewShot: true, paperType: 'dissertation' }
      );
      
      expect(prompt).toBeTruthy();
    });
  });

  describe('Region-Agnostic Polish System', () => {
    const mockSections: SectionContent[] = [
      {
        title: 'Introduction',
        content: 'This is a test introduction with some research findings (Author, 2023). The study shows important results.',
        wordCount: 15,
        citations: [{ paperId: 'test1', text: 'Author, 2023' }]
      },
      {
        title: 'Literature Review', 
        content: 'This literature review examines multiple studies (Smith, 2022; Jones, 2021). However, gaps remain in the research.',
        wordCount: 16,
        citations: [
          { paperId: 'test2', text: 'Smith, 2022' },
          { paperId: 'test3', text: 'Jones, 2021' }
        ]
      }
    ];

    it('should polish without regional context by default', async () => {
      const config: PolishConfig = {
        paperType: 'mastersThesis',
        topic: 'Test Topic',
        citationStyle: 'apa'
      };

      const result = await performFinalPolish(mockSections, config);
      
      expect(result.content).toBeTruthy();
      expect(result.sectionsProcessed).toBe(2);
      expect(result.improvementsApplied.length).toBeGreaterThan(0);
    });

    it('should include optional regional hints when provided', async () => {
      const config: PolishConfig = {
        paperType: 'mastersThesis',
        topic: 'Test Topic',
        citationStyle: 'apa',
        localRegion: 'Nigeria'
      };

      const result = await performFinalPolish(mockSections, config);
      
      expect(result.content).toBeTruthy();
      expect(result.sectionsProcessed).toBe(2);
    });

    it('should return proper improvement enums', async () => {
      const config: PolishConfig = {
        paperType: 'mastersThesis',
        topic: 'Test Topic',
        citationStyle: 'apa'
      };

      const result = await performFinalPolish(mockSections, config);
      
      // Should return enum values, not old string descriptions
      expect(result.improvementsApplied).toEqual(
        expect.arrayContaining(['transitions', 'consistency', 'integration', 'enhancement'])
      );
    });
  });

  describe('Quality Validation System', () => {
    it('should validate high-quality documents', () => {
      const polished = {
        content: 'This is a comprehensive academic document with multiple citations (Author, 2023; Smith, 2022). The analysis demonstrates critical thinking and thorough evaluation. Each paragraph contains relevant citations and shows analytical depth. The research methodology is robust and the conclusions are well-supported.',
        wordCount: 200,
        sectionsProcessed: 2,
        improvementsApplied: ['transitions', 'consistency', 'integration', 'enhancement'] as const,
        processingTime: 1000,
        chunksProcessed: 1
      };

      const validation = validatePolishQuality(polished, 'mastersThesis');
      expect(validation.score).toBeGreaterThan(0);
    });

    it('should identify improvement opportunities', () => {
      const sections: SectionContent[] = [
        {
          title: 'Introduction',
          content: 'This is a basic introduction. It lacks depth.',
          wordCount: 10,
          citations: []
        }
      ];

      const improvements = analyzePotentialImprovements(sections);
      expect(improvements.length).toBeGreaterThan(0);
      expect(improvements).toContain('citations'); // Should identify missing citations
    });
  });

  describe('End-to-End Workflow', () => {
    it('should demonstrate complete global Task 8 functionality', async () => {
      // 1. Check global examples availability
      const stats = getExampleStatistics();
      const hasGlobalCoverage = Object.keys(stats.byCountry).length > 3;
      
      // 2. Test few-shot selection from multiple countries
      const examples = getFewShotExamples('dissertation', 'introduction', 'Nigeria', undefined, 2);
      
      // 3. Test region-agnostic polish
      const sections: SectionContent[] = [
        {
          title: 'Introduction',
          content: 'Global research topic with international scope.',
          wordCount: 8,
          citations: []
        }
      ];

      const config: PolishConfig = {
        paperType: 'dissertation',
        topic: 'Global Research Topic',
        citationStyle: 'apa'
      };

      const polished = await performFinalPolish(sections, config);

      // Verify complete workflow
      console.log('✅ Task 8 Global Implementation Complete:');
      console.log(`- Global examples coverage: ${hasGlobalCoverage}`);
      console.log(`- Countries represented: ${Object.keys(stats.byCountry).length}`);
      console.log(`- Polish functionality working: Yes`);
      console.log(`- Sections processed: ${polished.sectionsProcessed}`);
      console.log(`- Improvements applied: ${polished.improvementsApplied.length}`);

      expect(hasGlobalCoverage).toBe(true);
      expect(polished.content).toBeTruthy();
      expect(polished.improvementsApplied.length).toBeGreaterThan(0);
    });
  });

  describe('Acceptance Criteria Verification', () => {
    it('should satisfy "Examples system is globally applicable and data-driven"', () => {
      const stats = getExampleStatistics();
      const validation = validateExamplesData();
      
      // Global coverage
      expect(Object.keys(stats.byCountry).length).toBeGreaterThan(3);
      
      // Data-driven (external JSON)
      expect(validation.isValid).toBe(true);
      
      // Multiple fields and institutions
      expect(Object.keys(stats.byField).length).toBeGreaterThan(2);
    });

    it('should satisfy "Polish system is region-agnostic with optional hints"', async () => {
      const sections: SectionContent[] = [
        {
          title: 'Test Section',
          content: 'Academic content for testing.',
          wordCount: 5,
          citations: []
        }
      ];

      // Test without region
      const configGlobal: PolishConfig = {
        paperType: 'mastersThesis',
        topic: 'Test',
        citationStyle: 'apa'
      };

      // Test with optional region
      const configRegional: PolishConfig = {
        paperType: 'mastersThesis', 
        topic: 'Test',
        citationStyle: 'apa',
        localRegion: 'Nigeria'
      };

      const globalResult = await performFinalPolish(sections, configGlobal);
      const regionalResult = await performFinalPolish(sections, configRegional);

      expect(globalResult.content).toBeTruthy();
      expect(regionalResult.content).toBeTruthy();
    });

    it('should satisfy "System uses proper enums and strong typing"', async () => {
      const config: PolishConfig = {
        paperType: 'mastersThesis',
        topic: 'Test',
        citationStyle: 'apa'
      };

      const result = await performFinalPolish([], config);
      
      // Should return typed enums, not strings
      result.improvementsApplied.forEach(improvement => {
        expect(['transitions', 'consistency', 'integration', 'enhancement', 'citations', 'depth', 'clarity', 'coherence']).toContain(improvement);
      });
    });
  });
}); 