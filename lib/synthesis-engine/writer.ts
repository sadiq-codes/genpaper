/**
 * Synthesis Writer
 * 
 * Generates literature synthesis prose from a SynthesisPlan and AnalysisResult.
 * Uses pre-analyzed synthesis data for data-driven writing.
 * 
 * Key features:
 * - Data-driven writing (uses pre-computed patterns, contradictions, gaps)
 * - No hardcoded enums - all guidance is string-based
 * - Supports streaming section-by-section
 * - Standalone (no server-only dependencies for testing)
 * 
 * @module lib/synthesis-engine/writer
 */

import { generateText } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import type { SynthesisPlan, SectionPlan, PaperInfo } from './types'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import { 
  formatSectionForPrompt, 
  type SynthesisPromptData 
} from './formatters'

// =============================================================================
// Types
// =============================================================================

/**
 * Input for the synthesis writer
 */
export interface WriterInput {
  projectId: string
  plan: SynthesisPlan
  analysis: AnalysisResult
  papers: PaperInfo[]
  
  // Optional customization
  citationStyle?: string      // e.g., "APA", "numbered"
  voiceGuidance?: string      // e.g., "formal academic"
  
  // Callbacks
  onSectionStart?: (sectionTitle: string, index: number, total: number) => void
  onSectionComplete?: (sectionTitle: string, wordCount: number) => void
}

/**
 * A generated section
 */
export interface GeneratedSection {
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
  generationTimeMs: number
}

/**
 * Output from the synthesis writer
 */
export interface WriterOutput {
  success: boolean
  sections: GeneratedSection[]
  fullContent: string
  metadata: {
    totalWords: number
    sectionsGenerated: number
    patternsDiscussed: number
    contradictionsAddressed: number
    gapsIdentified: number
    totalGenerationTimeMs: number
  }
  error?: string
}

// =============================================================================
// Main Writer Function
// =============================================================================

/**
 * Generate a complete literature synthesis from plan and analysis
 */
export async function writeSynthesis(input: WriterInput): Promise<WriterOutput> {
  const startTime = Date.now()
  const { plan, analysis, papers, onSectionStart, onSectionComplete } = input
  
  console.log(`\n✍️  Starting synthesis writing...`)
  console.log(`   Sections: ${plan.sections.length}`)
  console.log(`   Target words: ${plan.overview.totalWordCount}`)
  
  const sections: GeneratedSection[] = []
  let previousSectionContent = ''
  
  try {
    for (let i = 0; i < plan.sections.length; i++) {
      const sectionPlan = plan.sections[i]
      
      onSectionStart?.(sectionPlan.title, i, plan.sections.length)
      console.log(`\n📝 Writing section ${i + 1}/${plan.sections.length}: ${sectionPlan.title}`)
      
      const sectionStartTime = Date.now()
      
      // Generate section content
      const generatedSection = await writeSectionFromPlan(
        sectionPlan,
        analysis,
        papers,
        plan.globalGuidance,
        previousSectionContent,
        plan.overview.title
      )
      
      sections.push(generatedSection)
      previousSectionContent = generatedSection.content
      
      onSectionComplete?.(sectionPlan.title, generatedSection.wordCount)
      console.log(`   ✅ ${generatedSection.wordCount} words in ${generatedSection.generationTimeMs}ms`)
    }
    
    // Assemble full content
    const fullContent = sections.map(s => s.content).join('\n\n')
    const totalWords = sections.reduce((sum, s) => sum + s.wordCount, 0)
    const totalTimeMs = Date.now() - startTime
    
    // Count elements discussed
    const patternsDiscussed = new Set(sections.flatMap(s => s.elementsIncluded.patterns)).size
    const contradictionsAddressed = new Set(sections.flatMap(s => s.elementsIncluded.contradictions)).size
    const gapsIdentified = new Set(sections.flatMap(s => s.elementsIncluded.gaps)).size
    
    console.log(`\n✅ Synthesis complete!`)
    console.log(`   Total words: ${totalWords}`)
    console.log(`   Total time: ${totalTimeMs}ms`)
    console.log(`   Patterns discussed: ${patternsDiscussed}`)
    console.log(`   Contradictions addressed: ${contradictionsAddressed}`)
    console.log(`   Gaps identified: ${gapsIdentified}`)
    
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
        totalGenerationTimeMs: totalTimeMs
      }
    }
    
  } catch (error) {
    console.error('❌ Synthesis writing failed:', error)
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
 * Write a single section from its plan
 */
async function writeSectionFromPlan(
  sectionPlan: SectionPlan,
  analysis: AnalysisResult,
  papers: PaperInfo[],
  globalGuidance: SynthesisPlan['globalGuidance'],
  previousSectionContent: string,
  paperTitle: string
): Promise<GeneratedSection> {
  const startTime = Date.now()
  
  // Format synthesis data for prompt
  const synthesisData = formatSectionForPrompt(sectionPlan, analysis, papers)
  
  // Build prompts directly (no server-only dependencies)
  const { systemPrompt, userPrompt } = buildSectionPrompts(
    sectionPlan,
    synthesisData,
    globalGuidance,
    previousSectionContent,
    paperTitle,
    papers
  )
  
  // Generate content
  const { text } = await generateText({
    model: getLanguageModel(),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.4,
  })
  
  // Extract content (remove citations block for word count)
  const contentWithoutCitations = text.replace(/<!--\s*CITATIONS[\s\S]*?-->/g, '').trim()
  const wordCount = contentWithoutCitations.split(/\s+/).length
  
  // Extract citations used
  const citationsUsed = extractCitationsFromContent(text)
  
  const generationTimeMs = Date.now() - startTime
  
  return {
    id: uuidv4(),
    title: sectionPlan.title,
    content: text,
    wordCount,
    citationsUsed,
    elementsIncluded: {
      patterns: sectionPlan.content.patterns.map(p => p.patternId),
      contradictions: sectionPlan.content.contradictions.map(c => c.contradictionId),
      gaps: sectionPlan.content.gaps.map(g => g.gapId)
    },
    generationTimeMs
  }
}

/**
 * Build prompts for a section (standalone, no server-only deps)
 */
function buildSectionPrompts(
  sectionPlan: SectionPlan,
  synthesisData: SynthesisPromptData,
  globalGuidance: SynthesisPlan['globalGuidance'],
  previousSectionContent: string,
  paperTitle: string,
  papers: PaperInfo[]
): { systemPrompt: string; userPrompt: string } {
  
  // Build system prompt with synthesis-focused instructions
  const systemPrompt = buildSystemPrompt(globalGuidance)
  
  // Build user prompt with all the data
  const userPrompt = buildUserPrompt(
    sectionPlan,
    synthesisData,
    globalGuidance,
    previousSectionContent,
    paperTitle,
    papers
  )
  
  return { systemPrompt, userPrompt }
}

/**
 * Build system prompt for synthesis writing
 */
function buildSystemPrompt(globalGuidance: SynthesisPlan['globalGuidance']): string {
  return `You are an expert academic writer creating a literature synthesis.

WRITING STYLE:
- Audience: ${globalGuidance.audienceLevel}
- Style: ${globalGuidance.writingStyle}
- Citation approach: ${globalGuidance.citationApproach}

KEY PRINCIPLES:
1. SYNTHESIS over description - integrate findings, don't just list them
2. Use PRE-COMPUTED statistics exactly as provided (e.g., "6 of 8 studies found...")
3. Address contradictions fairly, offering explanations
4. Identify gaps and suggest future research
5. Cite papers using [1], [2], [3] format with a CITATIONS block at the end

CITATION FORMAT:
Use numbered markers [1], [2], etc. At the end, provide:
<!-- CITATIONS
[1] paper_id: xxx | quote: "relevant quote"
[2] paper_id: yyy | quote: "relevant quote"
-->

CRITICAL RULES:
- Use the EXACT support statements provided (do NOT modify the statistics)
- Synthesize across studies, don't describe each one separately
- Every claim must be supported by the data provided
- Write in academic prose, not bullet points`
}

/**
 * Build user prompt with synthesis data
 */
function buildUserPrompt(
  sectionPlan: SectionPlan,
  synthesisData: SynthesisPromptData,
  globalGuidance: SynthesisPlan['globalGuidance'],
  previousSectionContent: string,
  paperTitle: string,
  papers: PaperInfo[]
): string {
  const parts: string[] = []
  
  // Paper context
  parts.push(`## Paper: ${paperTitle}`)
  parts.push(`## Section: ${sectionPlan.title}`)
  parts.push(`## Purpose: ${sectionPlan.purpose}`)
  parts.push(`## Target Words: ${sectionPlan.targetWordCount}`)
  parts.push('')
  
  // Previous section context
  if (previousSectionContent) {
    parts.push(`## Previous Section Ending:`)
    parts.push(`"${previousSectionContent.slice(-300)}..."`)
    parts.push('')
  }
  
  // Writing guidance
  if (synthesisData.sectionWritingGuidance) {
    const g = synthesisData.sectionWritingGuidance
    parts.push(`## Writing Guidance:`)
    parts.push(`- Approach: ${g.approach}`)
    parts.push(`- Tone: ${g.tone}`)
    if (g.transitionFrom) parts.push(`- Transition from previous: ${g.transitionFrom}`)
    if (g.transitionTo) parts.push(`- Lead into next: ${g.transitionTo}`)
    parts.push('')
    parts.push(`Key points to make:`)
    g.keyPointsToMake.forEach((p, i) => parts.push(`${i + 1}. ${p}`))
    parts.push('')
  }
  
  // Patterns to discuss (the main data!)
  if (synthesisData.synthesisPatterns && synthesisData.synthesisPatterns.length > 0) {
    parts.push(`## PATTERNS TO DISCUSS (use these statistics EXACTLY):`)
    parts.push('')
    synthesisData.synthesisPatterns.forEach((p, i) => {
      parts.push(`### Pattern ${i + 1}: ${p.claim}`)
      parts.push(`- **Support:** ${p.supportStatement}`)
      if (p.valuesSummary) parts.push(`- **Values:** ${p.valuesSummary}`)
      parts.push(`- **Importance:** ${p.importance}`)
      parts.push(`- **How to present:** ${p.presentationApproach}`)
      parts.push(`- **Papers:** ${p.supportingPapers.join('; ')}`)
      parts.push('')
    })
  }
  
  // Contradictions to address
  if (synthesisData.synthesisContradictions && synthesisData.synthesisContradictions.length > 0) {
    parts.push(`## CONTRADICTIONS TO ADDRESS:`)
    parts.push('')
    synthesisData.synthesisContradictions.forEach((c, i) => {
      parts.push(`### Contradiction ${i + 1}: ${c.description}`)
      parts.push(`- **How to present:** ${c.presentationApproach}`)
      if (c.resolutionStrategy) parts.push(`- **Resolution:** ${c.resolutionStrategy}`)
      parts.push(`- **Sides:**`)
      c.sides.forEach(s => {
        parts.push(`  - ${s.position}: ${s.papers.join('; ')}`)
      })
      parts.push('')
    })
  }
  
  // Gaps to discuss
  if (synthesisData.synthesisGaps && synthesisData.synthesisGaps.length > 0) {
    parts.push(`## GAPS TO DISCUSS:`)
    parts.push('')
    synthesisData.synthesisGaps.forEach((g, i) => {
      parts.push(`### Gap ${i + 1}: ${g.description}`)
      parts.push(`- **Why it matters:** ${g.importance}`)
      if (g.suggestedFutureWork) parts.push(`- **Future work:** ${g.suggestedFutureWork}`)
      parts.push('')
    })
  }
  
  // Summary context
  if (synthesisData.synthesisSummary) {
    const s = synthesisData.synthesisSummary
    parts.push(`## LITERATURE SUMMARY:`)
    parts.push(`Analysis of ${s.totalPapersAnalyzed} papers identified ${s.patternsIdentified} patterns, ${s.contradictionsFound} contradictions, and ${s.gapsIdentified} gaps.`)
    parts.push('')
    parts.push(`Overall narrative: ${s.overallNarrative}`)
    parts.push('')
  }
  
  // Papers available for citation
  parts.push(`## PAPERS AVAILABLE FOR CITATION:`)
  papers.slice(0, 15).forEach((p, i) => {
    const authorShort = p.authors[0]?.split(' ').pop() || 'Unknown'
    parts.push(`[${i + 1}] ${p.title} (${authorShort}${p.year ? ', ' + p.year : ''}) - paper_id: ${p.id}`)
  })
  parts.push('')
  
  // Instructions
  parts.push(`## INSTRUCTIONS:`)
  parts.push(`1. Write a coherent ${sectionPlan.title} section (~${sectionPlan.targetWordCount} words)`)
  parts.push(`2. Start with: ## ${sectionPlan.title}`)
  parts.push(`3. Use the EXACT statistics from the patterns above`)
  parts.push(`4. Synthesize findings across papers - don't just list them`)
  parts.push(`5. End with a <!-- CITATIONS --> block mapping [1], [2] to paper_ids`)
  parts.push('')
  parts.push(`Write the section now:`)
  
  return parts.join('\n')
}

/**
 * Extract paper IDs from citations in content
 */
function extractCitationsFromContent(content: string): string[] {
  const citationsBlock = content.match(/<!--\s*CITATIONS([\s\S]*?)-->/)?.[1] || ''
  const paperIdMatches = citationsBlock.matchAll(/paper_id:\s*([a-zA-Z0-9-]+)/g)
  return [...new Set([...paperIdMatches].map(m => m[1]))]
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Write a single section (standalone, for testing)
 */
export async function writeSingleSection(
  sectionPlan: SectionPlan,
  analysis: AnalysisResult,
  papers: PaperInfo[],
  globalGuidance: SynthesisPlan['globalGuidance'],
  paperTitle: string
): Promise<GeneratedSection> {
  return writeSectionFromPlan(
    sectionPlan,
    analysis,
    papers,
    globalGuidance,
    '',
    paperTitle
  )
}
