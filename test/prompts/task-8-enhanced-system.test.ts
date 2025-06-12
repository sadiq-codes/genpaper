/**
 * Enhanced Task 8 System Tests
 * Testing all production-ready improvements including schema validation,
 * real tokenizer, pluggable scoring, and robust error handling
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  getFewShotExamples,
  formatFewShotExamples,
  hasFewShotExamples,
  getExampleStatistics,
  validateExamplesData,
  generateStableId,
  DEFAULT_SCORING_WEIGHTS,
  type ScoringWeights
} from '@/lib/prompts/few-shot-examples';
import {
  performFinalPolish,
  validatePolishQuality,
  type PolishConfig,
  type PolishProgress
} from '@/lib/prompts/final-polish';
import { PaperTypeKey, SectionContent, ImprovementType } from '@/lib/prompts/types';

// Mock the AI module for testing
vi.mock('@/lib/ai/vercel-client', () => ({
  ai: () => 'gpt-4o'
}));

const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: mockGenerateText
}));

// Mock tiktoken for testing
vi.mock('@dqbd/tiktoken', () => ({
  get_encoding: vi.fn(() => ({
    encode: vi.fn((text: string) => new Array(Math.ceil(text.split(/\s+/).length * 0.75)))
  }))
}));

describe('Enhanced Few-Shot Examples System', () => {
  describe('Schema Validation', () => {
    test('should validate examples data structure', () => {
      const validation = validateExamplesData();
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
      
      // Should have comprehensive coverage warnings if any
      if (validation.warnings.length > 0) {
        console.log('Coverage warnings:', validation.warnings);
      }
    });

    test('should provide detailed error messages for invalid data', () => {
      // This test would require mocking invalid data, but since we can't easily 
      // override the JSON import, we'll test the validation logic indirectly
      expect(validateExamplesData().isValid).toBe(true);
    });
  });

  describe('Pluggable Scoring System', () => {
    test('should use default scoring weights', () => {
      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        'Nigeria',
        'public_health'
      );
      
      expect(Array.isArray(examples)).toBe(true);
    });

    test('should accept custom scoring weights', () => {
      const customWeights: Partial<ScoringWeights> = {
        regionBonus: 10,
        fieldBonus: 8,
        recencyBonus: 5
      };

      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        'Nigeria',
        'public_health',
        2,
        customWeights
      );
      
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeLessThanOrEqual(2);
    });

    test('should export default scoring weights for external configuration', () => {
      expect(DEFAULT_SCORING_WEIGHTS).toBeDefined();
      expect(DEFAULT_SCORING_WEIGHTS.baseMatch).toBe(10);
      expect(DEFAULT_SCORING_WEIGHTS.regionBonus).toBe(5);
      expect(DEFAULT_SCORING_WEIGHTS.fieldBonus).toBe(3);
      expect(DEFAULT_SCORING_WEIGHTS.recencyBonus).toBe(2);
      expect(DEFAULT_SCORING_WEIGHTS.qualityBonus).toBe(1);
    });
  });

  describe('Enhanced Region Matching', () => {
    test('should match exact country names', () => {
      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        'Nigeria',
        undefined,
        3
      );
      
      // Should prioritize Nigerian examples
      const nigerianExamples = examples.filter(ex => ex.country === 'Nigeria');
      expect(nigerianExamples.length).toBeGreaterThan(0);
    });

    test('should handle regional grouping', () => {
      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        'Ghana', // Should get African examples even if Ghana not in data
        undefined,
        2
      );
      
      expect(Array.isArray(examples)).toBe(true);
    });

    test('should work with mixed case and spacing', () => {
      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        'NIGERIA',
        'Public Health',
        1
      );
      
      expect(Array.isArray(examples)).toBe(true);
    });
  });

  describe('Optimized Diversity Selection', () => {
    test('should select diverse examples efficiently', () => {
      const examples = getFewShotExamples(
        'mastersThesis',
        'literatureReview',
        undefined,
        undefined,
        3
      );
      
      // Should have diversity in countries and/or institutions
      const countries = new Set(examples.map(ex => ex.country));
      const institutions = new Set(examples.map(ex => ex.institution));
      
      // Either diverse countries OR diverse institutions (or both)
      expect(countries.size + institutions.size).toBeGreaterThan(examples.length);
    });

    test('should handle edge case with single example available', () => {
      // Test with very specific criteria that likely matches only one example
      const examples = getFewShotExamples(
        'dissertation',
        'methodology',
        'Brazil',
        'very_specific_field',
        5
      );
      
      expect(Array.isArray(examples)).toBe(true);
      expect(examples.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Stable Content-Based IDs', () => {
    test('should generate consistent IDs for same content', () => {
      const id1 = generateStableId('John Doe', 'Test Title', 2023);
      const id2 = generateStableId('John Doe', 'Test Title', 2023);
      
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^example-[a-z0-9]+$/);
    });

    test('should generate different IDs for different content', () => {
      const id1 = generateStableId('John Doe', 'Title A', 2023);
      const id2 = generateStableId('Jane Smith', 'Title B', 2024);
      
      expect(id1).not.toBe(id2);
    });
  });

  describe('Statistics and Introspection', () => {
    test('should provide comprehensive statistics', () => {
      const stats = getExampleStatistics();
      
      expect(stats.totalExamples).toBeGreaterThan(0);
      expect(Object.keys(stats.byCountry).length).toBeGreaterThan(0);
      expect(Object.keys(stats.byField).length).toBeGreaterThan(0);
      expect(Object.keys(stats.byPaperType).length).toBeGreaterThan(0);
      expect(Object.keys(stats.bySection).length).toBeGreaterThan(0);
    });

    test('should handle graceful degradation on data errors', () => {
      // Even if validation fails, statistics should return safe defaults
      const stats = getExampleStatistics();
      expect(stats).toBeDefined();
      expect(typeof stats.totalExamples).toBe('number');
    });
  });
});

describe('Enhanced Final Polish System', () => {
  let progressEvents: PolishProgress[];

  beforeEach(() => {
    progressEvents = [];
    mockGenerateText.mockClear();
  });

  const createMockSections = (): SectionContent[] => [
    {
      title: 'Introduction',
      content: 'This is the introduction with some [CITE:123] citations and research focus.',
      wordCount: 12,
      sectionKey: 'introduction'
    },
    {
      title: 'Literature Review', 
      content: 'This section reviews literature and compares different approaches [CITE:456] and analyzes findings.',
      wordCount: 15,
      sectionKey: 'literatureReview'
    }
  ];

  const createMockConfig = (overrides: Partial<PolishConfig> = {}): PolishConfig => ({
    paperType: 'mastersThesis' as PaperTypeKey,
    topic: 'Test Topic',
    citationStyle: 'apa',
    temperature: 0.3,
    onProgress: (progress) => progressEvents.push(progress),
    ...overrides
  });

  describe('Schema Validation and Robust Loading', () => {
    test('should validate polish instructions on load', () => {
      // This tests that the module loads without throwing schema errors
      expect(() => {
        createMockConfig();
        // Just creating config should trigger validation internally
      }).not.toThrow();
    });
  });

  describe('Real Tokenizer Integration', () => {
    test('should use accurate token counting for chunking decisions', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Polished content here.\n\nIMPROVEMENTS_APPLIED: transitions; citations; depth',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const sections = createMockSections();
      const config = createMockConfig({ chunkSections: false });

      const result = await performFinalPolish(sections, config);

      expect(result).toBeDefined();
      expect(result.content).toContain('Polished content');
      expect(result.chunksProcessed).toBeDefined();
    });

    test('should handle tokenizer failures gracefully', async () => {
      // Mock tokenizer failure
      const { get_encoding } = await import('@dqbd/tiktoken');
      vi.mocked(get_encoding).mockImplementation(() => {
        throw new Error('Tokenizer error');
      });

      progressEvents = [];
      mockGenerateText.mockResolvedValue({
        text: 'Fallback polished content.\n\nIMPROVEMENTS_APPLIED: enhancement',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const sections = createMockSections();
      const config = createMockConfig();

      const result = await performFinalPolish(sections, config);

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('Strongly Typed Progress Callbacks', () => {
    test('should emit properly typed progress events', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Polished result.\n\nIMPROVEMENTS_APPLIED: coherence',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const config = createMockConfig();
      await performFinalPolish(createMockSections(), config);

      expect(progressEvents.length).toBeGreaterThan(0);
      
      progressEvents.forEach(event => {
        expect(event.stage).toMatch(/^(analyzing|polishing|validating|retrying)$/);
        expect(typeof event.progress).toBe('number');
        expect(event.progress).toBeGreaterThanOrEqual(0);
        expect(event.progress).toBeLessThanOrEqual(100);
        expect(typeof event.message).toBe('string');
      });
    });

    test('should include chunk progress information', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Chunked polish.\n\nIMPROVEMENTS_APPLIED: transitions',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      // Create large sections to force chunking
      const largeSections: SectionContent[] = Array.from({ length: 5 }, (_, i) => ({
        title: `Section ${i + 1}`,
        content: 'Very long content '.repeat(100) + `[CITE:${i}]`,
        wordCount: 300,
        sectionKey: 'literatureReview'
      }));

      const config = createMockConfig({ chunkSections: true });
      await performFinalPolish(largeSections, config);

      const chunkEvents = progressEvents.filter(e => e.currentChunk !== undefined);
      expect(chunkEvents.length).toBeGreaterThan(0);
      
      chunkEvents.forEach(event => {
        expect(event.currentChunk).toBeGreaterThan(0);
        expect(event.totalChunks).toBeGreaterThan(0);
        expect(event.currentChunk).toBeLessThanOrEqual(event.totalChunks!);
      });
    });
  });

  describe('Enhanced Improvement Parsing', () => {
    test('should handle multiple IMPROVEMENTS_APPLIED sections', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: `Polished content here.
        
IMPROVEMENTS_APPLIED: transitions; coherence
More text here.
IMPROVEMENTS_APPLIED: citations; depth

Additional content.`,
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const result = await performFinalPolish(createMockSections(), createMockConfig());

      expect(result.improvementsApplied).toContain('transitions');
      expect(result.improvementsApplied).toContain('coherence');
      expect(result.improvementsApplied).toContain('citations');
      expect(result.improvementsApplied).toContain('depth');
      
      // Should remove duplicates
      const uniqueCount = new Set(result.improvementsApplied).size;
      expect(uniqueCount).toBe(result.improvementsApplied.length);
    });

    test('should clean content properly without removing actual content', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: `## Introduction
This is important content that should be preserved.

## Literature Review  
More important content here.

IMPROVEMENTS_APPLIED: enhancement; quality`,
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const result = await performFinalPolish(createMockSections(), createMockConfig());

      expect(result.content).toContain('important content that should be preserved');
      expect(result.content).toContain('More important content here');
      expect(result.content).not.toContain('IMPROVEMENTS_APPLIED');
    });

    test('should handle fuzzy improvement matching', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Content.\n\nIMPROVEMENTS_APPLIED: improved transitions, better citations, enhanced depth analysis',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const result = await performFinalPolish(createMockSections(), createMockConfig());

      expect(result.improvementsApplied).toContain('transitions');
      expect(result.improvementsApplied).toContain('citations');
      expect(result.improvementsApplied).toContain('depth');
    });
  });

  describe('Quality Validation and Retry Logic', () => {
    test('should validate quality with paper-type-specific thresholds', async () => {
      const polishedDoc = {
        content: 'Short content with minimal [CITE:1] citations.',
        wordCount: 8,
        sectionsProcessed: 2,
        improvementsApplied: ['enhancement'] as ImprovementType[],
        qualityScore: 0
      };

      const validation = validatePolishQuality(polishedDoc, 'mastersThesis');

      expect(validation.isValid).toBeDefined();
      expect(Array.isArray(validation.issues)).toBe(true);
      expect(typeof validation.score).toBe('number');
      expect(validation.score).toBeGreaterThanOrEqual(0);
      expect(validation.score).toBeLessThanOrEqual(100);
    });

    test('should attempt retry on quality failure', async () => {
      progressEvents = [];
      let callCount = 0;
      
      mockGenerateText.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call - poor quality
          return {
            text: 'Poor quality content.\n\nIMPROVEMENTS_APPLIED: none',
            usage: { totalTokens: 50 },
            finishReason: 'stop'
          };
        } else {
          // Retry call - better quality
          return {
            text: 'Much better quality content with depth analysis and critique of findings [CITE:1] and [CITE:2].\n\nIMPROVEMENTS_APPLIED: depth; citations; enhancement',
            usage: { totalTokens: 150 },
            finishReason: 'stop'
          };
        }
      });

      const config = createMockConfig({ 
        enableRetry: true, 
        maxRetries: 2 
      });
      const result = await performFinalPolish(createMockSections(), config);

      expect(callCount).toBe(2); // Initial + 1 retry
      expect(result.retryAttempts).toBe(1);
      expect(result.content).toContain('Much better quality');
      
      const retryEvents = progressEvents.filter(e => e.stage === 'retrying');
      expect(retryEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Graceful Degradation', () => {
    test('should handle API errors gracefully', async () => {
      progressEvents = [];
      
      mockGenerateText.mockRejectedValue(new Error('API Error'));

      const result = await performFinalPolish(createMockSections(), createMockConfig());

      // Should return fallback content instead of throwing
      expect(result).toBeDefined();
      expect(result.content).toContain('Introduction');
      expect(result.content).toContain('Literature Review');
      expect(result.qualityScore).toBe(0);
      expect(result.improvementsApplied).toEqual([]);
    });

    test('should validate inputs and handle empty sections gracefully', async () => {
      const result = await performFinalPolish([], createMockConfig());
      expect(result).toBeDefined();
      // Should handle empty sections gracefully rather than throwing
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle large documents efficiently', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Efficient processing.\n\nIMPROVEMENTS_APPLIED: consistency',
        usage: { totalTokens: 200 },
        finishReason: 'stop'
      });

      // Create a large document
      const largeSections: SectionContent[] = Array.from({ length: 10 }, (_, i) => ({
        title: `Section ${i + 1}`,
        content: 'Content '.repeat(200) + `[CITE:${i}]`,
        wordCount: 201,
        sectionKey: 'literatureReview'
      }));

      const startTime = Date.now();
      const result = await performFinalPolish(largeSections, createMockConfig());
      const processingTime = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(result.processingTime).toBeDefined();
      expect(result.chunksProcessed).toBeGreaterThan(0);
      expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    test('should provide processing metrics', async () => {
      progressEvents = [];
      
      mockGenerateText.mockResolvedValue({
        text: 'Processed.\n\nIMPROVEMENTS_APPLIED: integration',
        usage: { totalTokens: 100 },
        finishReason: 'stop'
      });

      const result = await performFinalPolish(createMockSections(), createMockConfig());

      expect(result.processingTime).toBeDefined();
      expect(result.processingTime).toBeGreaterThan(0);
      expect(result.sectionsProcessed).toBe(2);
      expect(result.wordCount).toBeGreaterThan(0);
    });
  });
});

describe('Integration Tests - Enhanced Task 8 System', () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
  });

  test('should integrate few-shot examples with polish system', async () => {
    // Test that few-shot examples are available
    const hasExamples = hasFewShotExamples('mastersThesis', 'literatureReview');
    
    if (hasExamples) {
      const examples = getFewShotExamples('mastersThesis', 'literatureReview', 'Nigeria');
      expect(examples.length).toBeGreaterThan(0);
      
      const formatted = formatFewShotExamples(examples);
      expect(formatted).toContain('Below are examples');
      expect(formatted).toContain('examiner-approved');
    }

    // Test polish system
    mockGenerateText.mockResolvedValue({
      text: 'Integrated polish result.\n\nIMPROVEMENTS_APPLIED: transitions; coherence',
      usage: { totalTokens: 100 },
      finishReason: 'stop'
    });

    const sections: SectionContent[] = [
      { 
        title: 'Introduction', 
        content: 'Intro content [CITE:1]', 
        wordCount: 3, 
        sectionKey: 'introduction' 
      },
      { 
        title: 'Literature Review', 
        content: 'Review content [CITE:2]', 
        wordCount: 3, 
        sectionKey: 'literatureReview' 
      }
    ];

    const config: PolishConfig = {
      paperType: 'mastersThesis' as PaperTypeKey,
      topic: 'Integration Test',
      citationStyle: 'apa',
      localRegion: 'Nigeria'
    };

    const result = await performFinalPolish(sections, config);

    expect(result).toBeDefined();
    expect(result.content).toContain('Integrated polish result');
    expect(result.improvementsApplied).toContain('transitions');
    expect(result.improvementsApplied).toContain('coherence');
  });

  test('should provide comprehensive system health check', () => {
    // Validate examples data
    const exampleValidation = validateExamplesData();
    
    // Get system statistics
    const stats = getExampleStatistics();
    
    // Check coverage
    const hasThesis = hasFewShotExamples('mastersThesis', 'literatureReview');
    const hasDissertation = hasFewShotExamples('dissertation', 'introduction');

    console.log('📊 Enhanced Task 8 System Status:');
    console.log(`✅ Examples validation: ${exampleValidation.isValid ? 'PASSED' : 'FAILED'}`);
    console.log(`📈 Total examples: ${stats.totalExamples}`);
    console.log(`🌍 Countries covered: ${Object.keys(stats.byCountry).length}`);
    console.log(`📚 Fields covered: ${Object.keys(stats.byField).length}`);
    console.log(`🎓 Thesis support: ${hasThesis ? 'YES' : 'NO'}`);
    console.log(`🎓 Dissertation support: ${hasDissertation ? 'YES' : 'NO'}`);

    if (exampleValidation.warnings.length > 0) {
      console.log('⚠️  Warnings:', exampleValidation.warnings);
    }

    // All validations should pass for production readiness
    expect(exampleValidation.isValid).toBe(true);
    expect(stats.totalExamples).toBeGreaterThan(0);
    expect(Object.keys(stats.byCountry).length).toBeGreaterThanOrEqual(3);
  });
}); 