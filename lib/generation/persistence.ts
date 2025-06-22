import { 
  addProjectVersion, 
  updateResearchProjectStatus 
} from '@/lib/db/research'
import type { CSLItem } from '@/lib/utils/csl'
import type { PaperWithAuthors } from '@/types/simplified'
import type { CapturedToolCall, ToolCallAnalytics } from './types'
import { debug } from '@/lib/utils/logger'
import { getSB } from '@/lib/supabase/server'

export async function persistGenerationResults(
  projectId: string,
  content: string,
  papers: PaperWithAuthors[],
  capturedToolCalls: CapturedToolCall[],
  addedEvidenceCitations: number
): Promise<{
  citationsMap: Map<string, CSLItem>
  citations: Array<{
    paperId: string
    citationText: string
    positionStart?: number
    positionEnd?: number
    pageRange?: string
  }>
  successfulCitations: string[]
  toolCallAnalytics: ToolCallAnalytics
}> {
  
  console.log(`💾 Saving generation results to database...`)
  
  // Step 1: Persist content version to database
  const version = await addProjectVersion(projectId, content, 1)
  console.log(`✅ Project version saved: ${version.version}`)
  
  // Step 2: Fetch all CSL-JSON citations that were written by addCitation tool
  const supabase = await getSB()
  const { data: citationRows, error: citationFetchError } = await supabase
    .from('citations')
    .select('key, csl_json')
    .eq('project_id', projectId)
    .limit(1000)

  if (citationFetchError) {
    console.error('❌ Failed to fetch citations for project', citationFetchError)
  }

  const citationsMap = new Map<string, CSLItem>()
  ;(citationRows || []).forEach(row => {
    citationsMap.set(row.key, row.csl_json as CSLItem)
  })

  console.log(`📊 Total CSL-JSON citations fetched: ${citationsMap.size}`)

  // Step 3: Update project status to complete
  await updateResearchProjectStatus(projectId, 'complete')
  console.log(`✅ Project status updated to complete`)

  // Step 4: Build analytics from captured tool calls
  const toolCallAnalytics = buildToolCallAnalytics(capturedToolCalls, addedEvidenceCitations)
  debug.info('Generation tool analytics', toolCallAnalytics as unknown as Record<string, unknown>)

  // Build simple citations array for API consumers (kept for compatibility)
  const citationsArray = (citationRows || []).map(r => ({
    key: r.key as string,
    cslJson: r.csl_json as CSLItem
  }))

  console.log(`📊 Evidence-based citations added in enrichment: ${addedEvidenceCitations}`)

  return {
    citationsMap,
    citations: citationsArray as any, // legacy field – will be phased out
    successfulCitations: [],
    toolCallAnalytics
  }
}

function buildToolCallAnalytics(
  capturedToolCalls: CapturedToolCall[], 
  addedEvidenceCitations: number
): ToolCallAnalytics {
  const validatedCalls = capturedToolCalls.filter(tc => tc.validated)
  const successfulCalls = capturedToolCalls.filter(tc => tc.validated && tc.result && tc.result.success)
  const failedCalls = capturedToolCalls.filter(tc => tc.validated && tc.result && !tc.result.success)
  const invalidCalls = capturedToolCalls.filter(tc => !tc.validated)
  const addCitationCalls = capturedToolCalls.filter(tc => tc.toolName === 'addCitation')
  
  return {
    totalToolCalls: capturedToolCalls.length,
    validatedToolCalls: validatedCalls.length,
    successfulToolCalls: successfulCalls.length,
    failedToolCalls: failedCalls.length,
    invalidToolCalls: invalidCalls.length,
    addCitationCalls: addCitationCalls.length,
    successfulCitations: addedEvidenceCitations, // Evidence-based citations added post-generation
    toolCallTimestamps: capturedToolCalls.map(tc => tc.timestamp),
    errors: [
      ...invalidCalls.map(tc => ({
        type: 'validation_error' as const,
        toolCallId: tc.toolCallId,
        error: tc.error ?? 'Unknown error'
      })),
      ...failedCalls.map(tc => ({
        type: 'execution_error' as const,
        toolCallId: tc.toolCallId,
        error: String(tc.result?.error || 'Unknown error')
      }))
    ]
  }
} 