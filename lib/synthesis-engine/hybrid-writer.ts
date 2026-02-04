/**
 * Hybrid Writer
 * 
 * Generates literature synthesis prose using BOTH:
 * - Structured data (skeleton): Pre-computed patterns, statistics, guidance
 * - RAG chunks (flesh): Rich context, quotes, details
 * 
 * This is the culmination of the hybrid architecture:
 * Brain (analysis) + Brawn (chunks) = Quality Synthesis
 * 
 * @module lib/synthesis-engine/hybrid-writer
 */

import { generateText } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import type { SynthesisPlan, PaperInfo } from './types'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import {
  buildHybridSectionContext,
  formatHybridContextForPrompt,
  type HybridSectionContext
} from './hybrid-context'

// =============================================================================
// Types
// =============================================================================

export interface HybridWriterInput {
  projectId: string
  plan: SynthesisPlan
  analysis: AnalysisResult
  papers: PaperInfo[]
  
  // Callbacks
  onSectionStart?: (sectionTitle: string, index: number, total: number) => void
  onSectionComplete?: (sectionTitle: string, wordCount: number) => void
}

export interface HybridGeneratedSection {
  id: string
  title: string
  content: string
  wordCount: number
  citationsUsed: string[]
  elementsIncluded: {
    patterns: string[]
    contradictions: string[]
    gaps: string[]
  }
  chunksUsed: number
  generationTimeMs: number
}

export interface HybridWriterOutput {
  success: boolean
  sections: HybridGeneratedSection[]
  fullContent: string
  metadata: {
    totalWords: number
    sectionsGenerated: number
    patternsDiscussed: number
    contradictionsAddressed: number
    gapsIdentified: number
    totalChunksUsed: number
    totalGenerationTimeMs: number
  }
  error?: string
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Generate a complete literature synthesis using hybrid approach
 */
export async function writeHybridSynthesis(input: HybridWriterInput): Promise<HybridWriterOutput> {
  const startTime = Date.now()
  const { plan, analysis, papers, onSectionStart, onSectionComplete } = input
  
  console.log(`\n✍️  Starting HYBRID synthesis writing...`)
  console.log(`   Sections: ${plan.sections.length}`)
  console.log(`   Target words: ${plan.overview.totalWordCount}`)
  console.log(`   Papers with chunks: ${papers.length}`)
  
  const sections: HybridGeneratedSection[] = []
  let previousSectionContent = ''
  let totalChunksUsed = 0
  
  try {
    for (let i = 0; i < plan.sections.length; i++) {
      const sectionPlan = plan.sections[i]
      
      onSectionStart?.(sectionPlan.title, i, plan.sections.length)
      console.log(`\n📝 Writing section ${i + 1}/${plan.sections.length}: ${sectionPlan.title}`)
      
      // Build hybrid context (structured data + targeted chunks)
      const hybridContext = await buildHybridSectionContext(
        sectionPlan,
        analysis,
        papers
      )
      
      // Generate section using hybrid prompt
      const generatedSection = await writeHybridSection(
        hybridContext,
        plan.globalGuidance,
        plan.overview.title,
        previousSectionContent
      )
      
      sections.push(generatedSection)
      previousSectionContent = generatedSection.content
      totalChunksUsed += generatedSection.chunksUsed
      
      onSectionComplete?.(sectionPlan.title, generatedSection.wordCount)
      console.log(`   ✅ ${generatedSection.wordCount} words, ${generatedSection.chunksUsed} chunks used`)
    }
    
    // Assemble full content
    const fullContent = sections.map(s => s.content).join('\n\n')
    const totalWords = sections.reduce((sum, s) => sum + s.wordCount, 0)
    const totalTimeMs = Date.now() - startTime
    
    // Count elements discussed
    const patternsDiscussed = new Set(sections.flatMap(s => s.elementsIncluded.patterns)).size
    const contradictionsAddressed = new Set(sections.flatMap(s => s.elementsIncluded.contradictions)).size
    const gapsIdentified = new Set(sections.flatMap(s => s.elementsIncluded.gaps)).size
    
    console.log(`\n✅ HYBRID synthesis complete!`)
    console.log(`   Total words: ${totalWords}`)
    console.log(`   Total chunks used: ${totalChunksUsed}`)
    console.log(`   Total time: ${totalTimeMs}ms`)
    
    return {
      success: true,
      sections,
      fullContent,
      metadata: {
        totalWords,
        sectionsGenerated: sections.length,
        patternsDiscussed,
        contradictionsAddressed,
        gapsIdentified,
        totalChunksUsed,
        totalGenerationTimeMs: totalTimeMs
      }
    }
    
  } catch (error) {
    console.error('❌ Hybrid synthesis failed:', error)
    return {
      success: false,
      sections,
      fullContent: sections.map(s => s.content).join('\n\n'),
      metadata: {
        totalWords: sections.reduce((sum, s) => sum + s.wordCount, 0),
        sectionsGenerated: sections.length,
        patternsDiscussed: 0,
        contradictionsAddressed: 0,
        gapsIdentified: 0,
        totalChunksUsed,
        totalGenerationTimeMs: Date.now() - startTime
      },
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// =============================================================================
// Section Writer
// =============================================================================

/**
 * Write a single section using hybrid context
 */
async function writeHybridSection(
  context: HybridSectionContext,
  globalGuidance: SynthesisPlan['globalGuidance'],
  paperTitle: string,
  previousSectionContent: string
): Promise<HybridGeneratedSection> {
  const startTime = Date.now()
  
  // Format context into prompt sections
  const { structuredSection, chunksSection } = formatHybridContextForPrompt(context)
  
  // Build prompts
  const systemPrompt = buildHybridSystemPrompt(globalGuidance)
  const userPrompt = buildHybridUserPrompt(
    context,
    structuredSection,
    chunksSection,
    paperTitle,
    previousSectionContent
  )
  
  // Generate content
  const { text } = await generateText({
    model: getLanguageModel(),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.4,
  })
  
  // Process result
  const contentWithoutCitations = text.replace(/<!--\s*CITATIONS[\s\S]*?-->/g, '').trim()
  const wordCount = contentWithoutCitations.split(/\s+/).length
  const citationsUsed = extractCitationsFromContent(text)
  
  return {
    id: uuidv4(),
    title: context.sectionTitle,
    content: text,
    wordCount,
    citationsUsed,
    elementsIncluded: {
      patterns: context.structuredData.patterns.map(p => p.claim),
      contradictions: context.structuredData.contradictions.map(c => c.description),
      gaps: context.structuredData.gaps.map(g => g.description)
    },
    chunksUsed: context.chunks.all.length,
    generationTimeMs: Date.now() - startTime
  }
}

// =============================================================================
// Prompt Builders
// =============================================================================

/**
 * Build system prompt for hybrid writing
 */
function buildHybridSystemPrompt(globalGuidance: SynthesisPlan['globalGuidance']): string {
  return `You are an expert academic writer creating a literature synthesis.

WRITING CONTEXT:
- Audience: ${globalGuidance.audienceLevel}
- Style: ${globalGuidance.writingStyle}
- Citation approach: ${globalGuidance.citationApproach}
- Key themes: ${globalGuidance.keyThemes.join(', ')}

YOU WILL RECEIVE TWO TYPES OF DATA:

1. **PRE-ANALYZED DATA (SKELETON)** - Statistics and patterns that are PRE-COMPUTED and VERIFIED
   - Use these EXACTLY as provided
   - "6 of 8 studies found..." means EXACTLY 6 of 8, not "most" or "many"
   - These statistics are the backbone of your synthesis

2. **EVIDENCE CHUNKS (FLESH)** - Rich contextual details from the papers
   - Use these to explain HOW and WHY
   - Use for specific mechanisms, methodological details
   - Extract quotable sentences for citations

WRITING PRINCIPLES:

1. **ACCURACY**: Use pre-analyzed statistics EXACTLY as given
   - Never round "6 of 8" to "most studies"
   - Never change percentages or counts

2. **RICHNESS**: Use chunks to add depth and context
   - Explain mechanisms, not just state findings
   - Include methodological details when relevant
   - Quote specific evidence

3. **SYNTHESIS**: Integrate across sources
   - Don't just list: "Study A found X. Study B found Y."
   - Do synthesize: "A consistent pattern emerges across studies [1,2,3], with X being linked to Y through Z."

4. **BALANCE**: Address contradictions fairly
   - Present both sides with equal scholarly respect
   - Offer possible explanations for disagreements

CITATION FORMAT:
Use numbered markers [1], [2], etc. At the end, provide:
<!-- CITATIONS
[1] paper_id: xxx | quote: "exact quote from evidence"
[2] paper_id: yyy | quote: "exact quote from evidence"
-->

CRITICAL: Every citation must reference a real paper_id from the evidence chunks provided.`
}

/**
 * Build user prompt with hybrid data
 */
function buildHybridUserPrompt(
  context: HybridSectionContext,
  structuredSection: string,
  chunksSection: string,
  paperTitle: string,
  previousSectionContent: string
): string {
  const parts: string[] = []
  
  // Header
  parts.push(`# Writing Task: ${context.sectionTitle}`)
  parts.push('')
  parts.push(`**Paper:** ${paperTitle}`)
  parts.push(`**Section Purpose:** ${context.sectionPurpose}`)
  parts.push(`**Target Words:** ${context.targetWordCount}`)
  parts.push('')
  
  // Previous section context
  if (previousSectionContent) {
    parts.push(`## Previous Section Ending:`)
    parts.push(`"${previousSectionContent.slice(-400)}..."`)
    parts.push('')
  }
  
  // Literature summary
  if (context.structuredData.summary) {
    const s = context.structuredData.summary
    parts.push(`## Literature Overview:`)
    parts.push(`You are synthesizing ${s.totalPapersAnalyzed} papers with ${s.patternsIdentified} patterns, ${s.contradictionsFound} contradictions, and ${s.gapsIdentified} gaps.`)
    parts.push('')
  }
  
  // Structured data section
  parts.push(structuredSection)
  parts.push('')
  
  // Chunks section
  parts.push(chunksSection)
  parts.push('')
  
  // Papers for citation
  parts.push('## Papers Available:')
  context.papers.slice(0, 20).forEach((p, i) => {
    const author = p.authors[0]?.split(' ').pop() || 'Unknown'
    parts.push(`[${i + 1}] ${p.title} (${author}${p.year ? ', ' + p.year : ''}) - paper_id: ${p.id}`)
  })
  parts.push('')
  
  // Instructions
  parts.push('## Instructions:')
  parts.push(`1. Write a coherent "${context.sectionTitle}" section (~${context.targetWordCount} words)`)
  parts.push('2. Use the PRE-ANALYZED statistics EXACTLY as provided')
  parts.push('3. Use the EVIDENCE CHUNKS to add rich context and quotes')
  parts.push('4. Start with: ## ' + context.sectionTitle)
  parts.push('5. End with a <!-- CITATIONS --> block')
  parts.push('')
  parts.push('Write the section now:')
  
  return parts.join('\n')
}

/**
 * Extract citations from generated content
 */
function extractCitationsFromContent(content: string): string[] {
  const citationsBlock = content.match(/<!--\s*CITATIONS([\s\S]*?)-->/)?.[1] || ''
  const paperIdMatches = citationsBlock.matchAll(/paper_id:\s*([a-zA-Z0-9-]+)/g)
  return [...new Set([...paperIdMatches].map(m => m[1]))]
}
