import 'server-only'
import z from 'zod'

/**
 * Placeholder Citation Schema
 * 
 * Standardizes model output placeholders for batched citation resolution.
 * Format: [[CITE:reference_type:reference_value]]
 */

// Supported reference types for placeholders
export const REFERENCE_TYPES = {
  doi: 'doi',
  paperId: 'paperId', 
  title: 'title',
  url: 'url'
} as const

export type ReferenceType = keyof typeof REFERENCE_TYPES

// Placeholder citation schema
export const PlaceholderCitationSchema = z.object({
  type: z.enum(['doi', 'paperId', 'title', 'url']),
  value: z.string().min(1, 'Reference value cannot be empty'),
  context: z.string().optional(), // Surrounding text for verification
  fallbackText: z.string().optional() // Fallback display text if resolution fails
})

export type PlaceholderCitation = z.infer<typeof PlaceholderCitationSchema>

// Batch citation reference schema for API
export const BatchCitationRefSchema = z.object({
  refs: z.array(PlaceholderCitationSchema).min(1, 'At least one reference required'),
  projectId: z.string().uuid('Valid project ID required')
})

export type BatchCitationRef = z.infer<typeof BatchCitationRefSchema>

// Citation placeholder regex patterns
export const CITATION_PLACEHOLDER_PATTERNS = {
  // Main pattern: [[CITE:type:value]]
  main: /\[\[CITE:([^:]+):([^\]]+)\]\]/g,
  
  // Extended pattern with context: [[CITE:type:value|context]]
  withContext: /\[\[CITE:([^:]+):([^|]+)\|([^\]]+)\]\]/g,
  
  // Any citation placeholder
  any: /\[\[CITE:[^\]]+\]\]/g
} as const

/**
 * Parse citation placeholders from text
 */
export function parseCitationPlaceholders(text: string): PlaceholderCitation[] {
  const placeholders: PlaceholderCitation[] = []
  
  // Try extended pattern first (with context)
  const withContextMatches = Array.from(text.matchAll(CITATION_PLACEHOLDER_PATTERNS.withContext))
  for (const match of withContextMatches) {
    const [, type, value, context] = match
    if (isValidReferenceType(type)) {
      placeholders.push({
        type: type as ReferenceType,
        value: value.trim(),
        context: context.trim()
      })
    }
  }
  
  // Then try main pattern (without context)
  const mainMatches = Array.from(text.matchAll(CITATION_PLACEHOLDER_PATTERNS.main))
  for (const match of mainMatches) {
    const [fullMatch, type, value] = match
    
    // Skip if already captured with context
    if (withContextMatches.some(ctx => ctx[0] === fullMatch)) {
      continue
    }
    
    if (isValidReferenceType(type)) {
      placeholders.push({
        type: type as ReferenceType,
        value: value.trim()
      })
    }
  }
  
  return placeholders
}

/**
 * Generate citation placeholder text
 */
export function createCitationPlaceholder(
  type: ReferenceType, 
  value: string,
  context?: string
): string {
  if (context) {
    return `[[CITE:${type}:${value}|${context}]]`
  }
  return `[[CITE:${type}:${value}]]`
}

/**
 * Replace placeholders in text with resolved citations
 */
export function replacePlaceholders(
  text: string, 
  citeKeyMap: Record<string, string>
): { text: string; unresolvedCount: number } {
  let unresolvedCount = 0
  
  const replacedText = text.replace(CITATION_PLACEHOLDER_PATTERNS.any, (match) => {
    // Extract the reference from the placeholder
    const parsed = parseCitationPlaceholders(match)
    if (parsed.length === 0) {
      unresolvedCount++
      return `[CITATION ERROR: ${match}]`
    }
    
    const placeholder = parsed[0]
    const citeKey = generateCiteKey(placeholder)
    const resolvedCitation = citeKeyMap[citeKey]
    
    if (resolvedCitation) {
      return resolvedCitation
    } else {
      unresolvedCount++
      // Fallback to basic format
      return placeholder.fallbackText || `(${placeholder.value})`
    }
  })
  
  return { text: replacedText, unresolvedCount }
}

/**
 * Generate consistent cite key from placeholder
 */
export function generateCiteKey(placeholder: PlaceholderCitation): string {
  return `${placeholder.type}:${placeholder.value}`
}

/**
 * Validate reference type
 */
function isValidReferenceType(type: string): type is ReferenceType {
  return type in REFERENCE_TYPES
}

/**
 * Extract unique placeholders from text (deduped)
 */
export function extractUniquePlaceholders(text: string): PlaceholderCitation[] {
  const placeholders = parseCitationPlaceholders(text)
  const seen = new Set<string>()
  const unique: PlaceholderCitation[] = []
  
  for (const placeholder of placeholders) {
    const key = generateCiteKey(placeholder)
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(placeholder)
    }
  }
  
  return unique
}

/**
 * Validate that all placeholders in text are properly formatted
 */
export function validatePlaceholders(text: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  
  try {
    const placeholders = parseCitationPlaceholders(text)
    
    for (const placeholder of placeholders) {
      const validation = PlaceholderCitationSchema.safeParse(placeholder)
      if (!validation.success) {
        errors.push(`Invalid placeholder: ${JSON.stringify(placeholder)} - ${validation.error.message}`)
      }
    }
    
    // Check for malformed patterns that weren't parsed
    const allMatches = Array.from(text.matchAll(/\[\[CITE:[^\]]*\]\]/g))
    if (allMatches.length > placeholders.length) {
      errors.push(`Found ${allMatches.length - placeholders.length} malformed citation placeholders`)
    }
    
  } catch (error) {
    errors.push(`Placeholder parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}

// Export for testing
export const __test__ = {
  isValidReferenceType,
  generateCiteKey
}