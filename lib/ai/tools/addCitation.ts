import { z } from 'zod'
import { tool } from 'ai'
import { AsyncLocalStorage } from 'async_hooks'
import { getSB } from '@/lib/supabase/server'
import { buildCSLFromPaper, CSLItem, PaperWithAuthors } from '@/lib/utils/csl'

// Simplified citation schema - only require paper_id and reason
const citationSchema = z.object({
  paper_id: z.string().uuid('Must provide a valid paper ID from the provided context'),
  reason: z.string().min(1, 'Must explain why this source supports your claim'),
  quote: z.string().optional() // Optional: exact quote for verification
})

// Citation context for project isolation
interface CitationContext {
  projectId: string
  userId: string
  citationStyle: string // Store citation style in context
  // per-request cache to avoid duplicate database calls for same paper
  draftStore: Map<string, { number: number; formatted: string }>   // paper_id -> {number, formatted}
}

const citationContextStore = new AsyncLocalStorage<CitationContext>()

export function getCitationContext() {
  const context = citationContextStore.getStore()
  if (!context) {
    throw new Error('Citation context not set. This tool can only be used within a generation context.')
  }
  return context
}

export function runWithCitationContext<T>(
  context: Omit<CitationContext, 'draftStore'>, 
  fn: () => T
): T {
  const fullContext: CitationContext = {
    ...context,
    citationStyle: context.citationStyle || 'apa', // Default to APA
    draftStore: new Map()
  }
  return citationContextStore.run(fullContext, fn)
}

// 🎯 UNIFIED CITATION FORMATTING - no more placeholders!
function formatCitation(cslJson: CSLItem, style: string = 'apa', number: number): string {
  const authors = cslJson.author || []
  const year = cslJson.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
  
  switch (style.toLowerCase()) {
    case 'apa':
      if (authors.length === 0) return `(Anonymous, ${year})`
      if (authors.length === 1) {
        const lastName = authors[0].family || authors[0].literal || 'Unknown'
        return `(${lastName}, ${year})`
      }
      if (authors.length === 2) {
        const first = authors[0].family || authors[0].literal || 'Unknown'
        const second = authors[1].family || authors[1].literal || 'Unknown'
        return `(${first} & ${second}, ${year})`
      }
      const firstAuthor = authors[0].family || authors[0].literal || 'Unknown'
      return `(${firstAuthor} et al., ${year})`
      
    case 'mla':
      if (authors.length === 0) return '(Anonymous)'
      const lastName = authors[0].family || authors[0].literal || 'Unknown'
      return authors.length === 1 ? `(${lastName})` : `(${lastName} et al.)`
      
    case 'chicago':
      if (authors.length === 0) return `(Anonymous ${year})`
      const chicagoName = authors[0].family || authors[0].literal || 'Unknown'
      return authors.length === 1 ? `(${chicagoName} ${year})` : `(${chicagoName} et al. ${year})`
      
    case 'ieee':
      return `[${number}]`
      
    default:
      return `(${authors[0]?.family || 'Unknown'}, ${year})` // Fallback to APA-style
  }
}

// 🎯 The core logic for the addCitation tool
export async function executeAddCitation(payload: CitationPayload) {
  const citationContext = getCitationContext()
  const { projectId, citationStyle, draftStore } = citationContext
  const supabase = await getSB()

  try {
    // Check if we already have a citation for this paper in this request
    const cached = draftStore.get(payload.paper_id)
    if (cached) {
      return {
        success: true,
        paper_id: payload.paper_id,
        citation_number: cached.number,
        formatted_citation: cached.formatted,
        message: `Reusing existing citation for paper`
      }
    }

    // Validate that the paper_id exists and fetch paper data including authors
    const { data: paper, error: paperError } = await supabase
      .from('papers')
      .select(`
        id, title, doi, url, venue, volume, issue, pages, publication_date, created_at,
        paper_authors(
          ordinal,
          authors(id, name)
        )
      `)
      .eq('id', payload.paper_id)
      .single()

    if (paperError || !paper) {
      console.error(`Invalid paper_id: ${payload.paper_id}`, paperError)
      return {
        success: false,
        error: `Paper ID ${payload.paper_id} not found in database`,
        formatted_citation: '[ERROR]'
      }
    }

    // Build CSL JSON from paper data - store immediately!
    const cslJson = buildCSLFromPaper(paper as unknown as PaperWithAuthors)

    // 🚀 UNIFIED CITATION SERVICE - immediate CSL storage + numbering
    const { data: result, error: citationError } = await supabase
      .rpc('add_citation_unified', {
        p_project_id: projectId,
        p_paper_id: payload.paper_id,
        p_csl_json: cslJson,
        p_reason: payload.reason,
        p_quote: payload.quote || null
      })
      .single()

    if (citationError || !result) {
      console.error('Error adding citation:', citationError)
      return {
        success: false,
        error: 'Failed to add citation',
        formatted_citation: '[ERROR]'
      }
    }

    // Type the result from the database function
    const citationResult = result as { citation_number: number; is_new: boolean }
    const citationNumber = citationResult.citation_number
    
    // 🎯 FORMAT FINAL CITATION - no placeholders!
    const formattedCitation = formatCitation(cslJson, citationStyle, citationNumber)
    
    // Cache the citation for this request
    draftStore.set(payload.paper_id, {
      number: citationNumber,
      formatted: formattedCitation
    })
    
    return {
      success: true,
      paper_id: payload.paper_id,
      citation_number: citationNumber,
      formatted_citation: formattedCitation, // 🎯 FINAL FORMAT - no hydration needed!
      is_new: citationResult.is_new,
      message: `Citation ${citationResult.is_new ? 'added' : 'reused'} for "${paper.title}" (${citationNumber})`
    }

  } catch (error) {
    console.error('Error in addCitation tool:', error)
    
    // Return error that won't break generation
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown citation error',
      formatted_citation: '[ERROR]'
    }
  }
}

export const addCitation = tool({
  description: 'Call this tool IMMEDIATELY after a sentence or claim that uses information from a provided source. You must provide the exact paper_id from the context chunks you used. Do not cite your own general knowledge.',
  parameters: citationSchema,
  execute: executeAddCitation
})

// Export types for use in other files
export type CitationPayload = z.infer<typeof citationSchema>
export type { CitationContext } 