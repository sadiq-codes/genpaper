import { z } from 'zod'

// Simplified citation validation schema - matches the new addCitation tool
export const citationSchema = z.object({
  paper_id: z.string().uuid('Must provide a valid paper ID from the provided context'),
  reason: z.string().min(1, 'Must explain why this source supports your claim'),
  quote: z.string().optional() // Optional: exact quote for verification
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

// Content structure validation
export function extractSections(content: string): string[] {
  const headers = content.match(/#{1,3}\s+(.+)/g) || []
  return headers.map(h => h.replace(/#{1,3}\s+/, '').trim())
}

export function extractAbstract(content: string): string {
  const match = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return match ? match[1].trim() : ''
} 