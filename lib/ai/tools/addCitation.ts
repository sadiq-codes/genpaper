import { z } from 'zod'
import { tool } from 'ai'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

// Zod schema for citation data
const citationSchema = z.object({
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
  start_pos: z.number().int().min(0),
  end_pos: z.number().int().min(0),
  context: z.string().optional()
})

// Hash function for generating citation keys
function generateCitationKey(title: string, year?: number, doi?: string): string {
  if (doi) {
    return doi.toLowerCase()
  }
  
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '')
  const yearStr = year ? year.toString() : 'unknown'
  const hashInput = `${normalizedTitle}_${yearStr}`
  
  return crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 12)
}

// Convert input to CSL JSON format
function toCslJson(citation: z.infer<typeof citationSchema>) {
  return {
    type: 'article-journal',
    title: citation.title,
    author: citation.authors.map(author => {
      // Handle "Last, First" format
      if (author.includes(',')) {
        const [family, given] = author.split(',').map(s => s.trim())
        return { family, given }
      }
      
      // Handle "First Last" format (assume last word is family name)
      const parts = author.trim().split(' ')
      if (parts.length === 1) {
        return { family: parts[0] }
      }
      
      const family = parts.pop() || ''
      const given = parts.join(' ')
      return { family, given }
    }),
    issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
    'container-title': citation.journal,
    page: citation.pages,
    volume: citation.volume,
    issue: citation.issue,
    DOI: citation.doi,
    URL: citation.url,
    abstract: citation.abstract
  }
}

// Global context to be set by the calling code
interface CitationContext {
  projectId: string
  userId: string
}

let citationContext: CitationContext | null = null

export function setCitationContext(context: CitationContext) {
  citationContext = context
}

export function clearCitationContext() {
  citationContext = null
}

export const addCitation = tool({
  name: 'addCitation',
  description: 'Add a citation to the research paper with positional information. Call this whenever you reference a source, study, or external work that needs to be cited.',
  parameters: citationSchema,
  execute: async (payload) => {
    if (!citationContext) {
      throw new Error('Citation context not set. This tool can only be used within a generation context.')
    }

    const { projectId, userId } = citationContext
    const supabase = await createClient()

    try {
      // Generate a unique key for this citation
      const citationKey = generateCitationKey(payload.title, payload.year, payload.doi)
      
      // Convert to CSL JSON format
      const cslData = toCslJson(payload)
      
      // Upsert the citation using our database function
      const { data: citationRecord, error: citationError } = await supabase
        .rpc('upsert_citation', {
          p_project_id: projectId,
          p_key: citationKey,
          p_data: cslData
        })
        .single()

      if (citationError) {
        console.error('Error upserting citation:', citationError)
        throw new Error(`Failed to save citation: ${citationError.message}`)
      }

      // Create the citation link
      const { error: linkError } = await supabase
        .from('citation_links')
        .insert({
          project_id: projectId,
          citation_id: citationRecord.id,
          section: payload.section,
          start_pos: payload.start_pos,
          end_pos: payload.end_pos,
          reason: payload.reason,
          context: payload.context
        })

      if (linkError) {
        console.error('Error creating citation link:', linkError)
        throw new Error(`Failed to create citation link: ${linkError.message}`)
      }

      // Return success message
      return {
        success: true,
        citationId: citationRecord.id,
        citationKey,
        message: `Citation added: "${payload.title}" (${payload.authors.join(', ')}, ${payload.year || 'n.d.'})`
      }

    } catch (error) {
      console.error('Error in addCitation tool:', error)
      throw new Error(error instanceof Error ? error.message : 'Unknown error in citation processing')
    }
  }
})

// Export types for use in other files
export type CitationPayload = z.infer<typeof citationSchema>
export type { CitationContext } 