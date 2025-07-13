import { z } from 'zod'
import { GENERATION_DEFAULTS } from './generation-defaults'

// Zod schema for validating generation configuration
export const GenerationConfigSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional(),
  model: z.string().optional(),
  
  search_parameters: z.object({
    sources: z.array(z.string()).optional(),
    limit: z.number().optional(),
    useSemanticSearch: z.boolean().optional(),
    semanticWeight: z.number().optional(),
    authorityWeight: z.number().optional(),
    recencyWeight: z.number().optional()
  }).optional(),
  
  paper_settings: z.object({
    length: z.enum(['short', 'medium', 'long']).default('medium'),
    paperType: z.enum(['researchArticle', 'literatureReview', 'capstoneProject', 'mastersThesis', 'phdDissertation']).default('researchArticle'),
    // citationStyle removed - system is now citation-agnostic
    localRegion: z.string().optional(), // TASK 6: Regional boosting support
    includeMethodology: z.boolean().default(true),
    includeFuture: z.boolean().default(false),
    
    // New configurable citation parameters
    minCitationCoverage: z.number()
      .min(0)
      .max(1)
      .default(GENERATION_DEFAULTS.MIN_CITATION_COVERAGE),
    minCitationFloor: z.number()
      .int()
      .min(0)
      .default(GENERATION_DEFAULTS.MIN_CITATION_FLOOR),
    evidenceSnippetLength: z.number()
      .int()
      .min(50)
      .max(500)
      .default(GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH),
  }).optional(),
  
  library_papers_used: z.array(z.string().uuid()).optional(),
}).strip() // Strip unknown properties to prevent typos from leaking through

export type ValidatedGenerationConfig = z.infer<typeof GenerationConfigSchema>

// Helper to safely validate and extract config with unknown key detection
export function validateGenerationConfig(config: unknown): ValidatedGenerationConfig {
  const result = GenerationConfigSchema.safeParse(config ?? {})
  
  if (!result.success) {
    console.warn('⚠️ Invalid generation config, using defaults:', result.error.format())
    
    // Log unknown keys for debugging
    const flattened = result.error.flatten()
    if (flattened.formErrors.length > 0) {
      console.warn('🔧 Unknown config keys detected:', flattened.formErrors)
    }
    
    // Return minimal valid config with defaults
    return {
      paper_settings: {
        length: 'medium',
        paperType: 'researchArticle', 
        includeMethodology: true,
        includeFuture: false,
        minCitationCoverage: GENERATION_DEFAULTS.MIN_CITATION_COVERAGE,
        minCitationFloor: GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
        evidenceSnippetLength: GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH,
      }
    }
  }
  
  // Check for unknown keys in successful parse by comparing with original
  if (typeof config === 'object' && config !== null) {
    const originalKeys = Object.keys(config as Record<string, unknown>)
    const validKeys = Object.keys(result.data)
    const unknownKeys = originalKeys.filter(key => !validKeys.includes(key))
    
    if (unknownKeys.length > 0) {
      console.warn('🔧 Unknown config keys stripped:', unknownKeys)
    }
  }
  
  return result.data
}

// Helper to merge user config with defaults
export function mergeWithDefaults(userConfig: unknown): ValidatedGenerationConfig {
  const validated = validateGenerationConfig(userConfig)
  
  // Ensure paper_settings always exists with defaults
  if (!validated.paper_settings) {
    validated.paper_settings = {
      length: 'medium',
      paperType: 'researchArticle',
      includeMethodology: true,
      includeFuture: false,
      minCitationCoverage: GENERATION_DEFAULTS.MIN_CITATION_COVERAGE,
      minCitationFloor: GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
      evidenceSnippetLength: GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH,
    }
  }
  
  return validated
} 