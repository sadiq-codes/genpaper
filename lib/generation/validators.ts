import { z } from 'zod'

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

// Simplified paper type validation - no longer depends on prompt templates
export function validatePaperType(paperType: string): { valid: boolean; errors: string[] } {
  const validTypes = [
    'research-paper',
    'review-paper', 
    'case-study',
    'short-paper',
    'conference-paper',
    'journal-article',
    'thesis-chapter'
  ]
  
  if (!validTypes.includes(paperType)) {
    return {
      valid: false,
      errors: [`Paper type '${paperType}' not supported. Available types: ${validTypes.join(', ')}`]
    }
  }
  
  return { valid: true, errors: [] }
}

// Content validation - checks basic structure requirements
export function validateContentStructure(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Check minimum length
  const wordCount = content.split(/\s+/).length
  if (wordCount < 100) {
    errors.push(`Content too short: ${wordCount} words (minimum 100)`)
  }
  
  // Check for basic academic structure
  if (!content.includes('##') && !content.includes('#')) {
    errors.push('Content should include section headers')
  }
  
  // Check for citations (basic pattern)
  const citationPattern = /\([A-Za-z]+(?:\s+\d+)?\)|(?:et al\.|[\w\s]+\s+\(\d{4}\))/g
  const citations = content.match(citationPattern) || []
  if (citations.length === 0) {
    errors.push('Content should include citations')
  }
  
  return {
    valid: errors.length === 0,
    errors
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