// Server-only prompt loader - uses direct imports instead of filesystem
import 'server-only'

import { 
  PromptLibrary, 
  PromptLoadError, 
  PaperTypeKey, 
  SectionKey,
  PromptTemplate
} from './types';

// Direct imports of JSON files (works in Edge Runtime)
import promptTemplates from './templates.json';

// Cache for loaded prompts to avoid repeated validation
let promptCache: PromptLibrary | null = null;

/**
 * Loads and validates prompt templates from imported JSON (Edge Runtime compatible)
 * @param forceReload - Whether to force reload and revalidation
 * @returns Validated prompt library
 * @throws PromptLoadError for import errors
 * @throws PromptValidationError for schema validation errors
 */
export function loadPrompts(forceReload = false): PromptLibrary {
  if (promptCache && !forceReload) {
    return promptCache;
  }

  try {
    // Validate templates against schema using a simple validation approach
    // (avoiding AJV dependency for Edge Runtime compatibility)
    const templates = promptTemplates as PromptLibrary;
    
    // Basic validation - check required structure
    if (!templates.paperTypes) {
      throw new Error('Missing paperTypes in templates');
    }

    // Validate each paper type has required sections
    const requiredSections = ['outline'];
    for (const [paperType, config] of Object.entries(templates.paperTypes)) {
      if (!config.sections) {
        throw new Error(`Missing sections for paper type: ${paperType}`);
      }
      
      for (const sectionKey of requiredSections) {
        if (!config.sections[sectionKey as SectionKey]) {
          throw new Error(`Missing required section '${sectionKey}' for paper type: ${paperType}`);
        }
      }
    }

    // Cache and return validated templates
    promptCache = templates;
    return promptCache;

  } catch (error) {
    const loadError = new Error(`Failed to load prompt templates: ${error}`) as PromptLoadError;
    loadError.name = 'PromptLoadError';
    loadError.details = error;
    throw loadError;
  }
}

/**
 * Gets a specific prompt template for a paper type and section
 * @param paperType - The type of paper (e.g., 'researchArticle')
 * @param section - The section key (e.g., 'introduction')
 * @returns The prompt template or null if not found
 */
export function getPromptTemplate(
  paperType: PaperTypeKey, 
  section: SectionKey
): PromptTemplate | null {
  try {
    const library = loadPrompts();
    const paperTypeConfig = library.paperTypes[paperType];
    
    if (!paperTypeConfig) {
      return null;
    }

    return paperTypeConfig.sections[section] || null;
  } catch (error) {
    console.error(`Error loading prompt template for ${paperType}.${section}:`, error);
    return null;
  }
}

/**
 * Gets all available paper types
 * @returns Array of paper type keys
 */
export function getAvailablePaperTypes(): PaperTypeKey[] {
  try {
    const library = loadPrompts();
    return Object.keys(library.paperTypes) as PaperTypeKey[];
  } catch (error) {
    console.error('Error loading available paper types:', error);
    return [];
  }
}

/**
 * Gets all available sections for a paper type
 * @param paperType - The paper type to get sections for
 * @returns Array of section keys
 */
export function getAvailableSections(paperType: PaperTypeKey): SectionKey[] {
  try {
    const library = loadPrompts();
    const paperTypeConfig = library.paperTypes[paperType];
    
    if (!paperTypeConfig) {
      return [];
    }

    return Object.keys(paperTypeConfig.sections) as SectionKey[];
  } catch (error) {
    console.error(`Error loading sections for ${paperType}:`, error);
    return [];
  }
}

/**
 * Validates that a prompt template contains all required depth cues
 * @param template - The prompt template to validate
 * @param requiredCues - Array of required depth cues
 * @returns Array of missing depth cues (empty if all present)
 */
export function validateDepthCues(
  template: PromptTemplate, 
  requiredCues: string[]
): string[] {
  const templateText = (template.systemPrompt + ' ' + template.userPromptTemplate).toLowerCase();
  
  return requiredCues.filter(cue => 
    !templateText.includes(cue.toLowerCase())
  );
}

/**
 * Clears the prompt cache (useful for testing)
 */
export function clearPromptCache(): void {
  promptCache = null;
} 