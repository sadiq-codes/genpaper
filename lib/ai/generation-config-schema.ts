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
    limit: z.number().positive().optional(),
    maxResults: z.number().positive().optional(),
    fromYear: z.number().min(1900).max(new Date().getFullYear()).optional(),
    toYear: z.number().min(1900).max(new Date().getFullYear()).optional(),
    includePreprints: z.boolean().optional(),
    useSemanticSearch: z.boolean().optional(),
    fallbackToKeyword: z.boolean().optional(),
    fallbackToAcademic: z.boolean().optional(),
    forceIngest: z.boolean().optional(),
  }).optional(),
  
  paper_settings: z.object({
    length: z.enum(['short', 'medium', 'long']).default('medium'),
    style: z.enum(['academic', 'review', 'survey']).default('academic'),
    citationStyle: z.enum(['apa', 'mla', 'chicago', 'ieee']).default('apa'),
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
}).passthrough() // Allow additional properties for backward compatibility

export type ValidatedGenerationConfig = z.infer<typeof GenerationConfigSchema>

// Helper to safely validate and extract config
export function validateGenerationConfig(config: unknown): ValidatedGenerationConfig {
  const result = GenerationConfigSchema.safeParse(config ?? {})
  
  if (!result.success) {
    console.warn('⚠️ Invalid generation config, using defaults:', result.error.format())
    
    // Return minimal valid config with defaults
    return {
      paper_settings: {
        length: 'medium',
        style: 'academic', 
        citationStyle: 'apa',
        includeMethodology: true,
        includeFuture: false,
        minCitationCoverage: GENERATION_DEFAULTS.MIN_CITATION_COVERAGE,
        minCitationFloor: GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
        evidenceSnippetLength: GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH,
      }
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
      style: 'academic',
      citationStyle: 'apa', 
      includeMethodology: true,
      includeFuture: false,
      minCitationCoverage: GENERATION_DEFAULTS.MIN_CITATION_COVERAGE,
      minCitationFloor: GENERATION_DEFAULTS.MIN_CITATION_FLOOR,
      evidenceSnippetLength: GENERATION_DEFAULTS.EVIDENCE_SNIPPET_MAX_LENGTH,
    }
  }
  
  return validated
} 