import { z } from 'zod'
import { tool } from 'ai'
import { getSB } from '@/lib/supabase/server'
import { collisionResistantHash } from '@/lib/utils/hash'

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
  start_pos: z.number().int().min(0).optional(),
  end_pos: z.number().int().min(0).optional(),
  context: z.string().optional(),
  source_paper_id: z.string().uuid().optional()
})

// Hash function for generating citation keys with collision-resistant hashing
async function generateCitationKey(title: string, year?: number, doi?: string): Promise<string> {
  if (doi) {
    return doi.toLowerCase()
  }
  
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '')
  const yearStr = year ? year.toString() : 'unknown'
  const hashInput = `${normalizedTitle}_${yearStr}`
  
  // Use collision-resistant hash (UUID v5 with SHA-1) - 128-bit, deterministic
  try {
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      // Web Crypto API available - use SHA-256 for maximum security
      try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput))
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16)
      } catch {
        // Fallback to collision-resistant hash if Web Crypto fails
        return collisionResistantHash(hashInput).substring(0, 16)
      }
    }
  } catch (error) {
    console.warn('Web Crypto API not available, using collision-resistant hash:', error)
  }
  
  // Use collision-resistant hash as fallback (UUID v5, much stronger than 32-bit hash)
  return collisionResistantHash(hashInput).substring(0, 16)
}

// Convert input to CSL JSON format
function toCslJson(citation: z.infer<typeof citationSchema>) {
  // Generate a unique ID for this citation item
  const citationId = citation.doi || 
    `${citation.authors[0]?.toLowerCase().replace(/[^a-z]/g, '') || 'unknown'}_${citation.year || 'nd'}`
  
  return {
    id: citationId,
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

interface CitationRecord {
  id: string
  project_id: string
  key: string
  csl_json: unknown
  created_at: string
  updated_at: string
}

let citationContext: CitationContext | null = null

export function setCitationContext(context: CitationContext) {
  citationContext = context
}

export function clearCitationContext() {
  citationContext = null
}

export const addCitation = tool({
  description: 'Add a citation to the research paper with positional information. Call this whenever you reference a source, study, or external work that needs to be cited.',
  parameters: citationSchema,
  execute: async (payload) => {
    if (!citationContext) {
      throw new Error('Citation context not set. This tool can only be used within a generation context.')
    }

    const { projectId } = citationContext
    const supabase = await getSB()

    try {
      // Generate a unique key for this citation
      const citationKey = await generateCitationKey(payload.title, payload.year, payload.doi)
      
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

      const record = citationRecord as CitationRecord

      // Create the citation link
      const { error: linkError } = await supabase
        .from('citation_links')
        .insert({
          project_id: projectId,
          citation_id: record.id,
          section: payload.section,
          // Only include positional data if the model provided it
          ...(typeof payload.start_pos === 'number' ? { start_pos: payload.start_pos } : {}),
          ...(typeof payload.end_pos === 'number' ? { end_pos: payload.end_pos } : {}),
          reason: payload.reason,
          context: payload.context,
          source_paper_id: payload.source_paper_id || null
        })

      if (linkError) {
        console.error('Error creating citation link:', linkError)
        throw new Error(`Failed to create citation link: ${linkError.message}`)
      }

      // Return only the neutral citation token - renderer will handle formatting
      const citationToken = `[CITE:${citationKey}]`

      return {
        success: true,
        citationId: record.id,
        citationKey,
        replacement: citationToken,
        message: `Citation added successfully for "${payload.title}"`
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