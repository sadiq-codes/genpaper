/**
 * Hybrid Context Builder
 * 
 * Combines structured analysis data (the skeleton) with RAG chunks (the flesh)
 * to create rich, data-driven context for writing.
 * 
 * The key insight: Structured data tells us WHAT to write and provides
 * accurate statistics. Chunks tell us HOW to write it richly.
 * 
 * @module lib/synthesis-engine/hybrid-context
 */

import type { SectionPlan, PaperInfo } from './types'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import { 
  formatSectionForPrompt, 
  type FormattedPattern,
  type FormattedContradiction,
  type FormattedGap,
  type SynthesisPromptData
} from './formatters'
import {
  retrieveChunksForSection,
  type TargetedChunk
} from './hybrid-retrieval'

// =============================================================================
// Types
// =============================================================================

/**
 * Combined context with both structured data and rich chunks
 */
export interface HybridSectionContext {
  // Section metadata
  sectionId: string
  sectionTitle: string
  sectionPurpose: string
  targetWordCount: number
  
  // Structured data (the skeleton) - pre-computed, accurate
  structuredData: {
    patterns: FormattedPattern[]
    contradictions: FormattedContradiction[]
    gaps: FormattedGap[]
    writingGuidance: SynthesisPromptData['sectionWritingGuidance']
    summary: SynthesisPromptData['synthesisSummary']
  }
  
  // Rich chunks (the flesh) - contextual, quotable
  chunks: {
    // Chunks organized by what they support
    byPattern: Map<string, TargetedChunk[]>
    byContradiction: Map<string, { side1: TargetedChunk[]; side2: TargetedChunk[] }>
    // All chunks flattened for the prompt
    all: TargetedChunk[]
  }
  
  // Papers available for citation
  papers: PaperInfo[]
  
  // Token budgets used
  tokenBudget: {
    structuredDataTokens: number
    chunkTokens: number
    totalTokens: number
  }
  
  // Timing
  buildTimeMs: number
}

export interface HybridContextConfig {
  maxTotalTokens: number
  structuredDataBudget: number  // Fixed budget for structured data
  minChunkTokens: number        // Minimum tokens reserved for chunks
}

const DEFAULT_CONFIG: HybridContextConfig = {
  maxTotalTokens: 25000,
  structuredDataBudget: 3000,
  minChunkTokens: 10000
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Build hybrid context for a section
 * 
 * This is the core function that creates the "brain + brawn" context:
 * 1. Gets structured data from the plan (patterns, stats, guidance)
 * 2. Retrieves targeted chunks for each pattern
 * 3. Combines them with proper token budgeting
 */
export async function buildHybridSectionContext(
  sectionPlan: SectionPlan,
  analysis: AnalysisResult,
  papers: PaperInfo[],
  config: Partial<HybridContextConfig> = {}
): Promise<HybridSectionContext> {
  const startTime = Date.now()
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  console.log(`\n🧠 Building hybrid context for: ${sectionPlan.title}`)
  
  // Step 1: Get structured data from formatters
  const synthesisData = formatSectionForPrompt(sectionPlan, analysis, papers)
  
  // Calculate tokens used by structured data
  const structuredDataTokens = estimateStructuredDataTokens(synthesisData)
  console.log(`   📊 Structured data: ~${structuredDataTokens} tokens`)
  
  // Step 2: Retrieve targeted chunks for patterns and contradictions
  const chunkBudget = Math.max(
    cfg.minChunkTokens,
    cfg.maxTotalTokens - structuredDataTokens
  )
  
  const { patternChunks, contradictionChunks, totalChunks, totalTimeMs } = 
    await retrieveChunksForSection(
      synthesisData.synthesisPatterns || [],
      synthesisData.synthesisContradictions || [],
      papers,
      { maxTokensPerPattern: Math.floor(chunkBudget / Math.max(1, (synthesisData.synthesisPatterns?.length || 1))) }
    )
  
  console.log(`   📚 Retrieved ${totalChunks} targeted chunks in ${totalTimeMs}ms`)
  
  // Step 3: Flatten chunks for the "all" list
  const allChunks: TargetedChunk[] = []
  const seenChunkIds = new Set<string>()
  
  // Add pattern chunks
  for (const chunks of patternChunks.values()) {
    for (const chunk of chunks) {
      if (!seenChunkIds.has(chunk.id)) {
        seenChunkIds.add(chunk.id)
        allChunks.push(chunk)
      }
    }
  }
  
  // Add contradiction chunks
  for (const { side1, side2 } of contradictionChunks.values()) {
    for (const chunk of [...side1, ...side2]) {
      if (!seenChunkIds.has(chunk.id)) {
        seenChunkIds.add(chunk.id)
        allChunks.push(chunk)
      }
    }
  }
  
  // Sort by score
  allChunks.sort((a, b) => b.score - a.score)
  
  // Calculate chunk tokens
  const chunkTokens = allChunks.reduce(
    (sum, chunk) => sum + Math.ceil(chunk.content.length / 4),
    0
  )
  
  const buildTimeMs = Date.now() - startTime
  console.log(`   ✅ Hybrid context built in ${buildTimeMs}ms (${structuredDataTokens + chunkTokens} total tokens)`)
  
  return {
    sectionId: sectionPlan.id,
    sectionTitle: sectionPlan.title,
    sectionPurpose: sectionPlan.purpose,
    targetWordCount: sectionPlan.targetWordCount,
    
    structuredData: {
      patterns: synthesisData.synthesisPatterns || [],
      contradictions: synthesisData.synthesisContradictions || [],
      gaps: synthesisData.synthesisGaps || [],
      writingGuidance: synthesisData.sectionWritingGuidance,
      summary: synthesisData.synthesisSummary
    },
    
    chunks: {
      byPattern: patternChunks,
      byContradiction: contradictionChunks,
      all: allChunks
    },
    
    papers,
    
    tokenBudget: {
      structuredDataTokens,
      chunkTokens,
      totalTokens: structuredDataTokens + chunkTokens
    },
    
    buildTimeMs
  }
}

/**
 * Build hybrid contexts for all sections in a plan
 */
export async function buildAllHybridContexts(
  sectionPlans: SectionPlan[],
  analysis: AnalysisResult,
  papers: PaperInfo[],
  config: Partial<HybridContextConfig> = {}
): Promise<HybridSectionContext[]> {
  const contexts: HybridSectionContext[] = []
  
  for (const plan of sectionPlans) {
    const context = await buildHybridSectionContext(plan, analysis, papers, config)
    contexts.push(context)
  }
  
  return contexts
}

// =============================================================================
// Prompt Formatting
// =============================================================================

/**
 * Format hybrid context into prompt sections
 * 
 * Creates two clearly delineated sections:
 * 1. STRUCTURED DATA - Statistics, patterns (use EXACTLY)
 * 2. EVIDENCE CHUNKS - Rich context for quotes and details
 */
export function formatHybridContextForPrompt(
  context: HybridSectionContext
): { structuredSection: string; chunksSection: string } {
  
  // Format structured data section
  const structuredParts: string[] = []
  
  structuredParts.push('## PRE-ANALYZED DATA (use these statistics EXACTLY)')
  structuredParts.push('')
  
  // Patterns
  if (context.structuredData.patterns.length > 0) {
    structuredParts.push('### PATTERNS:')
    context.structuredData.patterns.forEach((p, i) => {
      structuredParts.push(``)
      structuredParts.push(`**Pattern ${i + 1}: ${p.claim}**`)
      structuredParts.push(`- Support: ${p.supportStatement}`)
      if (p.valuesSummary) structuredParts.push(`- Values: ${p.valuesSummary}`)
      structuredParts.push(`- Importance: ${p.importance}`)
      structuredParts.push(`- How to present: ${p.presentationApproach}`)
      structuredParts.push(`- Papers: ${p.supportingPapers.join('; ')}`)
    })
    structuredParts.push('')
  }
  
  // Contradictions
  if (context.structuredData.contradictions.length > 0) {
    structuredParts.push('### CONTRADICTIONS:')
    context.structuredData.contradictions.forEach((c, i) => {
      structuredParts.push(``)
      structuredParts.push(`**Contradiction ${i + 1}: ${c.description}**`)
      structuredParts.push(`- How to present: ${c.presentationApproach}`)
      if (c.resolutionStrategy) structuredParts.push(`- Resolution: ${c.resolutionStrategy}`)
      c.sides.forEach((s, j) => {
        structuredParts.push(`- Side ${j + 1}: ${s.position}`)
        structuredParts.push(`  Papers: ${s.papers.join('; ')}`)
      })
    })
    structuredParts.push('')
  }
  
  // Gaps
  if (context.structuredData.gaps.length > 0) {
    structuredParts.push('### GAPS:')
    context.structuredData.gaps.forEach((g, i) => {
      structuredParts.push(``)
      structuredParts.push(`**Gap ${i + 1}: ${g.description}**`)
      structuredParts.push(`- Why it matters: ${g.importance}`)
      if (g.suggestedFutureWork) structuredParts.push(`- Future work: ${g.suggestedFutureWork}`)
    })
    structuredParts.push('')
  }
  
  // Writing guidance
  if (context.structuredData.writingGuidance) {
    const wg = context.structuredData.writingGuidance
    structuredParts.push('### WRITING GUIDANCE:')
    structuredParts.push(`- Approach: ${wg.approach}`)
    structuredParts.push(`- Tone: ${wg.tone}`)
    if (wg.transitionFrom) structuredParts.push(`- Transition from previous: ${wg.transitionFrom}`)
    if (wg.transitionTo) structuredParts.push(`- Lead into next: ${wg.transitionTo}`)
    structuredParts.push(`- Key points:`)
    wg.keyPointsToMake.forEach((p, i) => structuredParts.push(`  ${i + 1}. ${p}`))
    structuredParts.push('')
  }
  
  // Format chunks section
  const chunkParts: string[] = []
  
  chunkParts.push('## EVIDENCE CHUNKS (use for context, quotes, and details)')
  chunkParts.push('')
  chunkParts.push('These chunks provide the rich details to flesh out the patterns above.')
  chunkParts.push('Use them for: specific mechanisms, methodological details, quotable sentences.')
  chunkParts.push('')
  
  // Group chunks by paper for readability
  const chunksByPaper = new Map<string, TargetedChunk[]>()
  for (const chunk of context.chunks.all) {
    const existing = chunksByPaper.get(chunk.paperId) || []
    existing.push(chunk)
    chunksByPaper.set(chunk.paperId, existing)
  }
  
  for (const [paperId, chunks] of chunksByPaper) {
    const paperTitle = chunks[0]?.paperTitle || 'Unknown'
    chunkParts.push(`### [${paperTitle}] (paper_id: ${paperId})`)
    chunkParts.push('')
    
    for (const chunk of chunks) {
      chunkParts.push(`> ${chunk.content}`)
      chunkParts.push('')
    }
  }
  
  return {
    structuredSection: structuredParts.join('\n'),
    chunksSection: chunkParts.join('\n')
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Estimate tokens used by structured data
 */
function estimateStructuredDataTokens(data: SynthesisPromptData): number {
  let text = ''
  
  // Patterns
  for (const p of data.synthesisPatterns || []) {
    text += p.claim + p.supportStatement + (p.valuesSummary || '') + 
            p.presentationApproach + p.importance + p.supportingPapers.join(' ')
  }
  
  // Contradictions
  for (const c of data.synthesisContradictions || []) {
    text += c.description + c.presentationApproach + (c.resolutionStrategy || '')
    for (const s of c.sides) {
      text += s.position + s.papers.join(' ')
    }
  }
  
  // Gaps
  for (const g of data.synthesisGaps || []) {
    text += g.description + g.importance + (g.suggestedFutureWork || '')
  }
  
  // Writing guidance
  if (data.sectionWritingGuidance) {
    const wg = data.sectionWritingGuidance
    text += wg.approach + wg.tone + (wg.transitionFrom || '') + 
            (wg.transitionTo || '') + wg.keyPointsToMake.join(' ')
  }
  
  // Summary
  if (data.synthesisSummary) {
    text += data.synthesisSummary.overallNarrative
  }
  
  // Rough estimate: 4 chars per token, plus overhead for formatting
  return Math.ceil(text.length / 4) + 500
}
