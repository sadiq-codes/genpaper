import { describe, it, expect, beforeEach } from 'vitest';
import { 
  loadPrompts, 
  getPromptTemplate,
  getAvailablePaperTypes,
  getAvailableSections,
  validateDepthCues,
  clearPromptCache
} from '../../lib/prompts';

describe('Prompt Loader', () => {
  beforeEach(() => {
    clearPromptCache();
  });

  describe('loadPrompts', () => {
    it('should load and validate prompt templates successfully', () => {
      const library = loadPrompts();
      
      expect(library).toBeDefined();
      expect(library.paperTypes).toBeDefined();
      expect(library.paperTypes.researchArticle).toBeDefined();
      expect(library.paperTypes.literatureReview).toBeDefined();
    });

    it('should cache loaded prompts on subsequent calls', () => {
      const library1 = loadPrompts();
      const library2 = loadPrompts();
      
      expect(library1).toBe(library2); // Same reference due to caching
    });

    it('should force reload when requested', () => {
      const library1 = loadPrompts();
      const library2 = loadPrompts(true);
      
      expect(library1).toEqual(library2); // Same content
      expect(library1).not.toBe(library2); // Different reference
    });
  });

  describe('getPromptTemplate', () => {
    it('should return prompt template for valid paper type and section', () => {
      const template = getPromptTemplate('researchArticle', 'introduction');
      
      expect(template).toBeDefined();
      expect(template?.systemPrompt).toBeDefined();
      expect(template?.userPromptTemplate).toBeDefined();
      expect(template?.requiredDepthCues).toBeDefined();
      expect(Array.isArray(template?.requiredDepthCues)).toBe(true);
    });

    it('should return null for invalid paper type', () => {
      const template = getPromptTemplate('invalidType' as any, 'introduction');
      expect(template).toBeNull();
    });

    it('should return null for invalid section', () => {
      const template = getPromptTemplate('researchArticle', 'invalidSection' as any);
      expect(template).toBeNull();
    });
  });

  describe('getAvailablePaperTypes', () => {
    it('should return array of available paper types', () => {
      const types = getAvailablePaperTypes();
      
      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('researchArticle');
      expect(types).toContain('literatureReview');
      expect(types.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getAvailableSections', () => {
    it('should return sections for research article', () => {
      const sections = getAvailableSections('researchArticle');
      
      expect(Array.isArray(sections)).toBe(true);
      expect(sections).toContain('outline');
      expect(sections).toContain('introduction');
      expect(sections).toContain('literatureReview');
    });

    it('should return sections for literature review', () => {
      const sections = getAvailableSections('literatureReview');
      
      expect(Array.isArray(sections)).toBe(true);
      expect(sections).toContain('outline');
      expect(sections).toContain('introduction');
      expect(sections).toContain('conclusion');
    });

    it('should return empty array for invalid paper type', () => {
      const sections = getAvailableSections('invalidType' as any);
      expect(sections).toEqual([]);
    });
  });

  describe('validateDepthCues', () => {
    it('should return empty array when all depth cues are present', () => {
      const template = {
        systemPrompt: 'You must compare and critique the evidence',
        userPromptTemplate: 'Write with statistical analysis',
        requiredDepthCues: ['compare', 'critique', 'statistics']
      };
      
      const missing = validateDepthCues(template, ['compare', 'critique']);
      expect(missing).toEqual([]);
    });

    it('should return missing depth cues', () => {
      const template = {
        systemPrompt: 'You must compare the evidence',
        userPromptTemplate: 'Write the section',
        requiredDepthCues: ['compare']
      };
      
      const missing = validateDepthCues(template, ['compare', 'critique', 'statistics']);
      expect(missing).toContain('critique');
      expect(missing).toContain('statistics');
      expect(missing).not.toContain('compare');
    });

    it('should be case insensitive', () => {
      const template = {
        systemPrompt: 'You must COMPARE and Critique the evidence',
        userPromptTemplate: 'Write with STATISTICAL analysis',
        requiredDepthCues: ['compare']
      };
      
      const missing = validateDepthCues(template, ['compare', 'critique', 'statistical']);
      expect(missing).toEqual([]);
    });
  });

  describe('Schema Validation', () => {
    it('should validate that required depth cues are present in templates', () => {
      const library = loadPrompts();
      const researchArticle = library.paperTypes.researchArticle;
      
      // Check that depth cues from paper type appear in section templates
      const intro = researchArticle.sections.introduction;
      if (intro) {
        const missing = validateDepthCues(intro, researchArticle.depthCues);
        // Not all paper-level depth cues need to be in every section, 
        // but section-specific ones should be present
        expect(missing.length).toBeLessThan(researchArticle.depthCues.length);
      }
    });

    it('should ensure all required paper types exist', () => {
      const library = loadPrompts();
      
      expect(library.paperTypes.researchArticle).toBeDefined();
      expect(library.paperTypes.literatureReview).toBeDefined();
      
      // Check required fields
      expect(library.paperTypes.researchArticle.name).toBeDefined();
      expect(library.paperTypes.researchArticle.description).toBeDefined();
      expect(library.paperTypes.researchArticle.sections.outline).toBeDefined();
      expect(library.paperTypes.researchArticle.depthCues).toBeDefined();
    });

    it('should ensure all section templates have required depth cues', () => {
      const library = loadPrompts();
      
      Object.entries(library.paperTypes).forEach(([paperTypeKey, paperType]) => {
        Object.entries(paperType.sections).forEach(([sectionKey, section]) => {
          expect(section.requiredDepthCues).toBeDefined();
          expect(Array.isArray(section.requiredDepthCues)).toBe(true);
          expect(section.requiredDepthCues.length).toBeGreaterThan(0);
        });
      });
    });
  });
}); 