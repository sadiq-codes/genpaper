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

// Content structure validation
export function extractSections(content: string): string[] {
  const headers = content.match(/#{1,3}\s+(.+)/g) || []
  return headers.map(h => h.replace(/#{1,3}\s+/, '').trim())
}

export function extractAbstract(content: string): string {
  const match = content.match(/## Abstract\s*\n\n(.*?)\n\n##/)
  return match ? match[1].trim() : ''
} 