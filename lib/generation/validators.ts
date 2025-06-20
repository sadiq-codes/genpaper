import { z } from 'zod'
import { loadPrompts, validateDepthCues } from '@/lib/prompts/loader'
import type { PaperTypeKey, PaperType } from '@/lib/prompts/types'

// Citation validation schema
export const citationSchema = z.object({
  doi: z.string().optional(),
  title: z.string().min(1, 'Title is required'),
  authors: z.array(z.string()).min(1, 'At least one author is required'),
  year: z.number().int().min(1800).max(2030).optional(),
  journal: z.string().optional(),
  pages: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  url: z.string().url().optional(),
  abstract: z.string().optional(),
  reason: z.string().min(1, 'Reason for citation is required'),
  section: z.string().min(1, 'Section name is required'),
  start_pos: z.number().int().min(0).optional(),
  end_pos: z.number().int().min(0).optional(),
  context: z.string().optional()
})

// Validation function for citation tool calls
export const validateCitationArgs = (args: Record<string, unknown>): { valid: boolean; error?: string } => {
  try {
    citationSchema.parse(args)
    return { valid: true }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        valid: false, 
        error: `Validation failed: ${error.errors.map(e => e.message).join(', ')}` 
      }
    }
    return { valid: false, error: 'Unknown validation error' }
  }
}

// Prompt template validation
export function validatePromptTemplate(paperType: string): { valid: boolean; errors: string[] } {
  try {
    const library = loadPrompts();
    const paperTypeConfig = library.paperTypes[paperType as PaperTypeKey];
    
    if (!paperTypeConfig) {
      return {
        valid: false,
        errors: [`Paper type '${paperType}' not found in prompt library. Available types: ${Object.keys(library.paperTypes).join(', ')}`]
      };
    }

    // Validate depth cues are present
    const missingCues = validateDepthCues(
      library.templates.outline, // Assuming outline template
      paperTypeConfig.depthCues || []
    );
    
    if (missingCues.length > 0) {
      return {
        valid: false,
        errors: [`Template for ${paperType} missing depth cues: ${missingCues.join(', ')}`]
      };
    }

    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [`Template validation error: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

// MLA citation style validation
export function validateMLACitationStyle(content: string, citations: string[]): void {
  console.log(`🔍 Validating MLA citation style compliance...`)
  
  // Check for proper parenthetical citation format in MLA
  const mlaParentheticalRegex = /\([A-Za-z]+(?:\s+\d+)?\)/g
  const parentheticalCitations = content.match(mlaParentheticalRegex) || []
  
  // Check for proper in-text integration
  const citationMarkers = citations.length
  const naturalIntegration = content.split(/[.!?]\s+/).filter(sentence => 
    sentence.includes('argues') || 
    sentence.includes('suggests') || 
    sentence.includes('reports') ||
    sentence.includes('findings') ||
    sentence.includes('according to')
  ).length
  
  console.log(`📋 MLA Style Analysis:`)
  console.log(`   📊 Total citations: ${citationMarkers}`)
  console.log(`   📝 Parenthetical citations found: ${parentheticalCitations.length}`)
  console.log(`   🔗 Natural integrations found: ${naturalIntegration}`)
  
  // Provide style recommendations
  if (parentheticalCitations.length < citationMarkers * 0.3) {
    console.warn(`⚠️ MLA Recommendation: Consider more parenthetical citations (Author Page) format`)
  }
  
  if (naturalIntegration < citationMarkers * 0.2) {
    console.warn(`⚠️ MLA Recommendation: Consider more natural author integration in sentences`)
  }
  
  console.log(`✅ MLA style validation completed`)
}

// Content structure validation
export function extractSections(content: string): string[] {
  const headers = content.match(/#{1,3}\s+(.+)/g) || []
  return headers.map(h => h.replace(/#{1,3}\s+/, '').trim())
}

export function extractAbstract(content: string): string {
  const match = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return match ? match[1].trim() : ''
} 