import { z } from 'zod'
import { tool } from 'ai'
import { AsyncLocalStorage } from 'async_hooks'
import { getSB } from '@/lib/supabase/server'
import { normalizeDoi, authorsToCsl, generateCitationKey } from '@/lib/utils/citation'

// Type for Crossref API response
interface CrossrefAuthor {
  given?: string
  family?: string
}

interface CrossrefWork {
  title?: string[]
  author?: CrossrefAuthor[]
  published?: { 'date-parts': number[][] }
  created?: { 'date-parts': number[][] }
  'container-title'?: string[]
  volume?: string
  issue?: string
  page?: string
  URL?: string
  abstract?: string
}

// Improved Zod schema - only require DOI OR title, expanded year range
const citationSchema = z.object({
  doi: z.string().optional(),
  title: z.string().min(1).optional(),
  authors: z.array(z.string()).default([]),
  year: z.number().int().min(1800).max(2100).optional(),
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
}).refine(
  (data) => data.doi || data.title, 
  { message: 'Either DOI or title is required' }
)

// Simple in-memory cache for Crossref lookups
const crossrefCache = new Map<string, Partial<z.infer<typeof citationSchema>>>()

// Crossref API lookup for DOI metadata
async function fetchCrossrefMetadata(doi: string): Promise<Partial<z.infer<typeof citationSchema>>> {
  const normalizedDoi = normalizeDoi(doi)
  
  // Check cache first
  if (crossrefCache.has(normalizedDoi)) {
    return crossrefCache.get(normalizedDoi)!
  }

  try {
    const response = await fetch(`https://api.crossref.org/works/${normalizedDoi}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GenPaper/1.0 (mailto:support@genpaper.ai)'
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      throw new Error(`Crossref API error: ${response.status}`)
    }

    const data = await response.json()
    const work = data.message as CrossrefWork

    // Extract metadata in our schema format
    const metadata = {
      title: work.title?.[0] || '',
      authors: work.author?.map((author: CrossrefAuthor) => 
        `${author.given || ''} ${author.family || ''}`.trim()
      ) || [],
      year: work.published?.['date-parts']?.[0]?.[0] || work.created?.['date-parts']?.[0]?.[0],
      journal: work['container-title']?.[0] || '',
      volume: work.volume || '',
      issue: work.issue || '',
      pages: work.page || '',
      url: work.URL || `https://doi.org/${normalizedDoi}`,
      abstract: work.abstract || ''
    }

    // Cache the result
    crossrefCache.set(normalizedDoi, metadata)
    return metadata

  } catch (error) {
    console.warn(`Failed to fetch Crossref metadata for DOI ${normalizedDoi}:`, error)
    // Return empty metadata rather than failing the entire citation
    return {}
  }
}

// Convert input to CSL JSON format
function toCslJson(citation: z.infer<typeof citationSchema>) {
  // Generate a unique ID for this citation item
  const citationId = citation.doi ? normalizeDoi(citation.doi) :
    `${citation.authors[0]?.toLowerCase().replace(/[^a-z]/g, '') || 'unknown'}_${citation.year || 'nd'}`
  
  return {
    id: citationId,
    type: 'article-journal',
    title: citation.title,
    author: authorsToCsl(citation.authors),
    issued: citation.year ? { 'date-parts': [[citation.year]] } : undefined,
    'container-title': citation.journal,
    page: citation.pages,
    volume: citation.volume,
    issue: citation.issue,
    DOI: citation.doi ? normalizeDoi(citation.doi) : undefined,
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

const citationContextStore = new AsyncLocalStorage<CitationContext>()

export function getCitationContext() {
  const context = citationContextStore.getStore()
  if (!context) {
    throw new Error('Citation context not set. This tool can only be used within a generation context.')
  }
  return context
}

export function runWithCitationContext<T>(context: CitationContext, fn: () => T): T {
  return citationContextStore.run(context, fn)
}

export const addCitation = tool({
  description: 'Add a citation to the research paper with positional information. Call this whenever you reference a source, study, or external work that needs to be cited. You can provide just a DOI for automatic metadata lookup, or full citation details.',
  parameters: citationSchema,
  execute: async (payload) => {
    const citationContext = getCitationContext()

    const { projectId } = citationContext
    const supabase = await getSB()

    try {
      // Auto-fill metadata from Crossref if only DOI provided or if missing key fields
      if (payload.doi && (!payload.title || payload.authors.length === 0)) {
        console.log(`Fetching metadata for DOI: ${payload.doi}`)
        const crossrefData = await fetchCrossrefMetadata(payload.doi)
        
        // Merge Crossref data, preferring existing payload values
        payload = {
          ...crossrefData,
          ...payload, // payload values take precedence
          // Ensure we have authors array
          authors: payload.authors.length > 0 ? payload.authors : (crossrefData.authors || [])
        }
      }

      // Generate a unique key for this citation
      const citationKey = await generateCitationKey(payload.title, payload.year, payload.doi)
      
      // Convert to CSL JSON format
      const cslData = toCslJson(payload)
      
      // Use a transaction for atomic citation + link creation
      const { data: result, error: transactionError } = await supabase.rpc('create_citation_with_link', {
        p_project_id: projectId,
        p_citation_key: citationKey,
        p_csl_data: cslData,
        p_section: payload.section,
        p_start_pos: payload.start_pos || null,
        p_end_pos: payload.end_pos || null,
        p_reason: payload.reason,
        p_context: payload.context || null,
        p_source_paper_id: payload.source_paper_id || null
      })

      if (transactionError) {
        console.error('Error in atomic citation creation:', transactionError)
        
        // Fallback to original two-step process if the RPC doesn't exist yet
        console.log('Falling back to two-step citation creation')
      
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

      // Validate source_paper_id exists if provided
      let validatedSourcePaperId = null
      if (payload.source_paper_id) {
        const { data: paperExists, error: paperCheckError } = await supabase
          .from('papers')
          .select('id')
          .eq('id', payload.source_paper_id)
          .single()

        if (paperCheckError || !paperExists) {
          console.warn(`Source paper ${payload.source_paper_id} not found in papers table, proceeding without source link`)
        } else {
          validatedSourcePaperId = payload.source_paper_id
        }
      }

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
          source_paper_id: validatedSourcePaperId
        })

      if (linkError) {
        console.error('Error creating citation link:', linkError)
        throw new Error(`Failed to create citation link: ${linkError.message}`)
      }

        // Return success with fallback data
        const citationToken = `[CITE:${citationKey}]`
        return {
          success: true,
          citationId: record.id,
          citationKey,
          replacement: citationToken,
          message: `Citation added successfully for "${payload.title || 'DOI: ' + payload.doi}"${validatedSourcePaperId ? ' with source link' : ''}`
        }
      }

      // Success with atomic transaction
      const citationToken = `[CITE:${citationKey}]`
      return {
        success: true,
        citationId: result.citation_id,
        citationKey,
        replacement: citationToken,
        message: `Citation added successfully for "${payload.title || 'DOI: ' + payload.doi}"`
      }

    } catch (error) {
      console.error('Error in addCitation tool:', error)
      
      // Fail softly - return a placeholder instead of crashing the entire section
      const errorMessage = error instanceof Error ? error.message : 'Unknown error in citation processing'
      console.warn(`⚠️ Citation tool failed, returning placeholder: ${errorMessage}`)
      
      // Return a basic placeholder so the model can continue
      const fallbackKey = payload.title?.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '') || 'unknown'
      return {
        success: false,
        citationId: 'error-placeholder',
        citationKey: fallbackKey,
        replacement: `[CITE:${fallbackKey}]`,
        message: `Citation failed: ${errorMessage}`,
        error: errorMessage
      }
    }
  }
})

// Export types for use in other files
export type CitationPayload = z.infer<typeof citationSchema>
export type { CitationContext } 