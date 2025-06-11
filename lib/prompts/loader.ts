import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import { 
  PromptLibrary, 
  PromptLoadError, 
  PromptValidationError,
  PaperTypeKey, 
  SectionKey,
  PromptTemplate
} from './types';

// Cache for loaded prompts to avoid repeated file reads
let promptCache: PromptLibrary | null = null;

/**
 * Loads and validates prompt templates from JSON files
 * @param forceReload - Whether to force reload from file system
 * @returns Validated prompt library
 * @throws PromptLoadError for file system errors
 * @throws PromptValidationError for schema validation errors
 */
export function loadPrompts(forceReload = false): PromptLibrary {
  if (promptCache && !forceReload) {
    return promptCache;
  }

  try {
    // Load schema and templates
    const schemaPath = join(process.cwd(), 'lib/prompts/promptSchema.json');
    const templatesPath = join(process.cwd(), 'lib/prompts/templates.json');
    
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const templates = JSON.parse(readFileSync(templatesPath, 'utf8'));

    // Validate templates against schema
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(schema);
    const isValid = validate(templates);

    if (!isValid) {
      const errors = validate.errors?.map(err => 
        `${err.instancePath}: ${err.message}`
      ) || ['Unknown validation error'];
      
      const error = new Error(`Prompt template validation failed: ${errors.join(', ')}`) as PromptValidationError;
      error.name = 'PromptValidationError';
      error.validationErrors = errors;
      throw error;
    }

    // Cache and return validated templates
    promptCache = templates as PromptLibrary;
    return promptCache;

  } catch (error) {
    if (error instanceof Error && error.name === 'PromptValidationError') {
      throw error;
    }

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