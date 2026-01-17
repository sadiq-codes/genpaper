/**
 * @deprecated This tool-based citation approach has been replaced by the two-pass
 * citation system in lib/citations/post-processor.ts
 * 
 * The new approach uses [CITE: paper_id] markers in AI output, which are then
 * post-processed into formatted citations. This is more reliable because:
 * 1. AI doesn't need to invoke tools mid-generation
 * 2. Citation formatting is deterministic
 * 3. No race conditions with streaming
 * 
 * This file is kept for reference and potential future use cases where
 * real-time tool calling might be beneficial.
 */

import z from 'zod'
import { tool } from 'ai'
import { AsyncLocalStorage } from 'async_hooks'
import { CSLItem } from '@/lib/utils/csl'
import { CitationService, formatInlineCitation } from '@/lib/citations/immediate-bibliography'


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
  baseUrl?: string
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

    // Call service directly to avoid API validation/auth issues in tool runtime
    let citationNumber: number
    let cslJson: CSLItem
    let isNew: boolean

    try {
      const result = await CitationService.add({
        projectId,
        sourceRef: { paperId: payload.paper_id },
        reason: payload.reason,
        quote: payload.quote || null
      })

      // citationNumber is deprecated - use 1 as default for formatting
      // The actual ordering is handled by first_seen_order in the database
      citationNumber = result.citationNumber ?? 1
      cslJson = result.cslJson as unknown as CSLItem
      isNew = result.isNew
      
      if (!cslJson) {
        throw new Error('Citation service response missing CSL JSON')
      }
      
    } catch (error) {
      console.error('AI tool citation service call failed:', error)
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
  inputSchema: citationSchema,
  execute: executeAddCitation
})

// Export types for use in other files
export type CitationPayload = z.infer<typeof citationSchema>
export type { CitationContext } 
