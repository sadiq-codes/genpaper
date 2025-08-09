import z from 'zod'
import { tool } from 'ai'
import { AsyncLocalStorage } from 'async_hooks'
import { CSLItem } from '@/lib/utils/csl'
import { formatInlineCitation } from '@/lib/citations/immediate-bibliography'
import { isUnifiedCitationsEnabled } from '@/lib/config/feature-flags'

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

// 🎯 UNIFIED CITATION FORMATTING moved to shared service

// 🎯 The core logic for the addCitation tool
export async function executeAddCitation(payload: CitationPayload) {
  const citationContext = getCitationContext()
  const { projectId, citationStyle, draftStore } = citationContext

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

    // Always call the API to ensure single write path (no direct DB access)
    let citationNumber: number
    let cslJson: CSLItem
    let isNew: boolean

    try {
      const res = await fetch('/api/citations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          key: `cite-${payload.paper_id}`, // Generate consistent key
          paperId: payload.paper_id,
          citation_text: payload.reason,
          context: payload.quote || null
        }),
        // Server runtime should handle authentication via cookies
      })
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(`API error ${res.status}: ${errorData.error || 'Unknown error'}`)
      }
      
      const data = await res.json()
      citationNumber = data?.citation?.citation_number || 0
      cslJson = data?.citation?.csl_json
      isNew = data?.citation?.is_new ?? true
      
      if (!citationNumber || !cslJson) {
        throw new Error('API response missing required fields (citation_number, csl_json)')
      }
      
    } catch (error) {
      console.error('AI tool citation API call failed:', error)
      throw new Error(`Citation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    
    // 🎯 FORMAT FINAL CITATION - no placeholders!
    const formattedCitation = formatInlineCitation(cslJson as CSLItem, citationStyle, citationNumber)
    
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
      is_new: isNew,
      message: `Citation ${isNew ? 'added' : 'reused'} (${citationNumber})`
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