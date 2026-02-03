/**
 * Synthesis Plan Builder
 * 
 * Generates a structured plan for writing a literature synthesis.
 * Takes analysis results (patterns, contradictions, gaps) and produces
 * a detailed plan for each section.
 * 
 * Key principles:
 * - No hardcoded structure - LLM decides sections and approach
 * - Data-driven - plan based on actual analysis results
 * - Single LLM call for efficiency
 * 
 * @module lib/synthesis-engine/plan-builder
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import type {
  SynthesisPlan,
  SynthesisPlanInput,
  SynthesisPlanResult,
  SectionPlan,
  PatternPlan,
  ContradictionPlan,
  GapPlan
} from './types'

// =============================================================================
// Zod Schema - Flexible, No Hardcoded Enums
// =============================================================================

const PatternPlanSchema = z.object({
  patternId: z.string().describe('ID of the pattern from analysis'),
  claim: z.string().describe('The pattern claim to discuss'),
  importance: z.string().describe('How important: "central", "supporting", "minor", etc.'),
  presentationApproach: z.string().describe('How to present this pattern'),
  data: z.object({
    supportStatement: z.string().describe('Statement about support, e.g., "6 of 8 studies (75%) found..."'),
    valuesSummary: z.string().nullable().describe('Summary of quantitative values if available'),
    contextNotes: z.string().nullable().describe('Important context to mention')
  }),
  supportingPaperIds: z.array(z.string())
})

const ContradictionPlanSchema = z.object({
  contradictionId: z.string().describe('ID of the contradiction from analysis'),
  description: z.string().describe('What the contradiction is'),
  presentationApproach: z.string().describe('How to present this fairly'),
  resolutionStrategy: z.string().nullable().describe('How to explain or resolve'),
  sides: z.array(z.object({
    position: z.string(),
    paperIds: z.array(z.string())
  }))
})

const GapPlanSchema = z.object({
  gapId: z.string().describe('ID of the gap from analysis'),
  description: z.string().describe('What the gap is'),
  importance: z.string().describe('Why this gap matters'),
  suggestedFutureWork: z.string().nullable().describe('Potential research to address it')
})

const SectionPlanSchema = z.object({
  title: z.string().describe('Section title'),
  purpose: z.string().describe('What this section accomplishes'),
  content: z.object({
    patterns: z.array(PatternPlanSchema).describe('Patterns to discuss in this section'),
    contradictions: z.array(ContradictionPlanSchema).describe('Contradictions to discuss'),
    gaps: z.array(GapPlanSchema).describe('Gaps to discuss'),
    additionalPoints: z.array(z.string()).describe('Other points to make')
  }),
  papers: z.object({
    primary: z.array(z.string()).describe('Must cite these paper IDs'),
    supporting: z.array(z.string()).describe('Can cite these if needed')
  }),
  writingGuidance: z.object({
    approach: z.string().describe('How to write this section'),
    tone: z.string().describe('Tone to use'),
    transitionFrom: z.string().nullable().describe('How to connect from previous section'),
    transitionTo: z.string().nullable().describe('How to lead into next section')
  }),
  targetWordCount: z.number().describe('Target word count for this section'),
  keyPointsToMake: z.array(z.string()).describe('Main takeaways for this section')
})

const SynthesisPlanSchema = z.object({
  overview: z.object({
    title: z.string().describe('Suggested title for the synthesis'),
    abstract: z.string().describe('Brief overview of what the synthesis covers'),
    totalSections: z.number(),
    totalWordCount: z.number(),
    narrativeStrategy: z.string().describe('Overall approach to the synthesis')
  }),
  sections: z.array(SectionPlanSchema),
  globalGuidance: z.object({
    audienceLevel: z.string().describe('Target audience'),
    writingStyle: z.string().describe('Writing style to use'),
    citationApproach: z.string().describe('How to handle citations'),
    keyThemes: z.array(z.string()).describe('Themes running through the synthesis')
  })
})

// =============================================================================
// Prompt
// =============================================================================

const SYSTEM_PROMPT = `You are an expert academic writer planning a literature synthesis. Your task is to create a detailed plan for writing a synthesis based on cross-document analysis results.

CRITICAL INSTRUCTIONS:

1. STRUCTURE DECISIONS
   - Decide the optimal number of sections based on the content
   - Group related patterns logically
   - Ensure smooth narrative flow between sections
   - Don't force a standard structure - let the content drive organization

2. SECTION PLANNING
   For each section, specify:
   - What patterns/contradictions/gaps to cover
   - Which papers are essential to cite
   - How to present the information
   - Transitions to/from adjacent sections
   - Target word count

3. PATTERN PRESENTATION
   - Decide which patterns are central vs supporting
   - Plan how to present quantitative data clearly
   - Include support statements like "X of Y studies (Z%) found..."

4. HANDLING CONTRADICTIONS
   - Present both sides fairly
   - Offer explanations for disagreements
   - Don't dismiss valid conflicting findings

5. GAPS AND FUTURE WORK
   - Integrate gaps naturally, typically near the end
   - Connect gaps to patterns (what's known vs unknown)
   - Suggest concrete future research directions

6. NARRATIVE FLOW
   - Plan transitions between sections
   - Maintain a clear argument throughout
   - End with synthesis, not just summary

Remember: This is a PLAN for writing, not the synthesis itself. Be specific about what to write and how.`

function buildPrompt(input: SynthesisPlanInput): string {
  const { analysis, papers, targetWordCount, focusAreas, audienceLevel } = input
  
  // Format patterns
  const patternsText = analysis.patterns.map(p => {
    let text = `[Pattern ${p.id}]
  Claim: ${p.claim}
  Summary: ${p.summary}
  Support: ${p.support.count}/${p.support.total} papers
  Consistency: ${p.consistency}
  Confidence: ${(p.confidence * 100).toFixed(0)}%`
    
    if (p.values?.summary) {
      text += `\n  Values: ${p.values.summary}`
    }
    if (p.direction) {
      text += `\n  Direction: ${p.direction}`
    }
    if (p.limitations) {
      text += `\n  Limitations: ${p.limitations}`
    }
    
    // List supporting papers
    text += `\n  Papers: ${p.support.papers.map(ps => `${ps.paperTitle} (${ps.paperId})`).join(', ')}`
    
    return text
  }).join('\n\n')
  
  // Format contradictions
  const contradictionsText = analysis.contradictions.length > 0
    ? analysis.contradictions.map(c => {
        let text = `[Contradiction ${c.id}]
  Description: ${c.description}
  Severity: ${c.severity}`
        
        c.sides.forEach((s, i) => {
          text += `\n  Side ${i + 1}: ${s.position}`
          text += `\n    Papers: ${s.papers.map(p => p.paperTitle).join(', ')}`
        })
        
        if (c.possibleExplanation) {
          text += `\n  Possible Explanation: ${c.possibleExplanation}`
        }
        
        return text
      }).join('\n\n')
    : 'No contradictions found.'
  
  // Format gaps
  const gapsText = analysis.gaps.length > 0
    ? analysis.gaps.map(g => `[Gap ${g.id}]
  Description: ${g.description}
  Type: ${g.type}
  Relevance: ${g.relevance}`).join('\n\n')
    : 'No gaps identified.'
  
  // Format papers
  const papersText = papers.map(p => 
    `- ${p.title} (${p.id}) - ${p.authors.join(', ')}${p.year ? ` (${p.year})` : ''} - ${p.domain}`
  ).join('\n')
  
  // Build constraints
  const constraints: string[] = []
  if (targetWordCount) {
    constraints.push(`Target word count: ~${targetWordCount} words`)
  }
  if (focusAreas?.length) {
    constraints.push(`Focus areas: ${focusAreas.join(', ')}`)
  }
  if (audienceLevel) {
    constraints.push(`Audience: ${audienceLevel}`)
  }
  
  const constraintsText = constraints.length > 0
    ? `\nCONSTRAINTS:\n${constraints.join('\n')}\n`
    : ''
  
  return `Create a synthesis plan based on the following analysis:

SUMMARY:
${analysis.summary}

KEY INSIGHTS:
${analysis.keyInsights.map((k, i) => `${i + 1}. ${k}`).join('\n')}

PATTERNS (${analysis.patterns.length}):
${patternsText}

CONTRADICTIONS (${analysis.contradictions.length}):
${contradictionsText}

GAPS (${analysis.gaps.length}):
${gapsText}

PAPERS (${papers.length}):
${papersText}
${constraintsText}
Plan a coherent synthesis that:
1. Covers all important patterns
2. Addresses contradictions fairly
3. Identifies gaps and future directions
4. Flows logically from section to section
5. Provides clear writing guidance for each section`
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Generate a synthesis plan from analysis results
 */
export async function buildSynthesisPlan(input: SynthesisPlanInput): Promise<SynthesisPlanResult> {
  const startTime = Date.now()
  
  const { projectId, analysis, papers, targetWordCount = 3000 } = input
  
  if (analysis.patterns.length === 0) {
    return {
      success: false,
      error: 'No patterns to synthesize. Analysis must contain at least one pattern.',
      timeMs: Date.now() - startTime
    }
  }
  
  console.log(`\n📝 Building synthesis plan...`)
  console.log(`   Patterns: ${analysis.patterns.length}`)
  console.log(`   Contradictions: ${analysis.contradictions.length}`)
  console.log(`   Gaps: ${analysis.gaps.length}`)
  console.log(`   Papers: ${papers.length}`)
  console.log(`   Target words: ${targetWordCount}`)
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: SynthesisPlanSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
      temperature: 0.3,
    })
    
    const timeMs = Date.now() - startTime
    
    // Transform to final plan with IDs
    const sections: SectionPlan[] = object.sections.map((s, i) => ({
      id: uuidv4(),
      title: s.title,
      purpose: s.purpose,
      content: {
        patterns: s.content.patterns.map(p => ({
          ...p,
          data: {
            supportStatement: p.data.supportStatement,
            valuesSummary: p.data.valuesSummary || undefined,
            contextNotes: p.data.contextNotes || undefined
          }
        })),
        contradictions: s.content.contradictions.map(c => ({
          ...c,
          resolutionStrategy: c.resolutionStrategy || undefined
        })),
        gaps: s.content.gaps.map(g => ({
          ...g,
          suggestedFutureWork: g.suggestedFutureWork || undefined
        })),
        additionalPoints: s.content.additionalPoints
      },
      papers: s.papers,
      writingGuidance: {
        approach: s.writingGuidance.approach,
        tone: s.writingGuidance.tone,
        transitionFrom: s.writingGuidance.transitionFrom || undefined,
        transitionTo: s.writingGuidance.transitionTo || undefined
      },
      targetWordCount: s.targetWordCount,
      keyPointsToMake: s.keyPointsToMake
    }))
    
    const plan: SynthesisPlan = {
      id: uuidv4(),
      projectId,
      overview: {
        title: object.overview.title,
        abstract: object.overview.abstract,
        totalSections: object.overview.totalSections,
        totalWordCount: object.overview.totalWordCount,
        narrativeStrategy: object.overview.narrativeStrategy
      },
      sections,
      globalGuidance: {
        audienceLevel: object.globalGuidance.audienceLevel,
        writingStyle: object.globalGuidance.writingStyle,
        citationApproach: object.globalGuidance.citationApproach,
        keyThemes: object.globalGuidance.keyThemes
      },
      generatedAt: new Date(),
      generationTimeMs: timeMs,
      modelUsed: 'gpt-4o',
      inputSummary: {
        totalPapers: papers.length,
        totalFindings: analysis.totalFindings,
        patternsFound: analysis.patterns.length,
        contradictionsFound: analysis.contradictions.length,
        gapsFound: analysis.gaps.length
      }
    }
    
    console.log(`✅ Plan complete in ${timeMs}ms`)
    console.log(`   Title: "${plan.overview.title}"`)
    console.log(`   Sections: ${plan.sections.length}`)
    console.log(`   Total words: ${plan.overview.totalWordCount}`)
    
    return {
      success: true,
      plan,
      timeMs
    }
    
  } catch (error) {
    console.error('❌ Plan generation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timeMs: Date.now() - startTime
    }
  }
}
