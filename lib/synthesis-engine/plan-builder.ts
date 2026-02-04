/**
 * Synthesis Plan Builder
 * 
 * Generates a structured plan for writing a literature synthesis.
 * Takes analysis results (patterns, contradictions, gaps) and produces
 * a detailed plan for each section.
 * 
 * Key principles:
 * - Paper-type aware: Respects structural constraints from PaperProfile
 * - Aligns with outline sections when provided
 * - Data-driven: Plan based on actual analysis results
 * - Single LLM call for efficiency
 * 
 * @module lib/synthesis-engine/plan-builder
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { info, warn } from '@/lib/utils/logger'
import type {
  SynthesisPlan,
  SynthesisPlanInput,
  SynthesisPlanResult,
  SectionPlan
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
  // NEW: Link to outline section (required for pipeline integration)
  outlineSectionKey: z.string().describe('The outline section key this maps to, e.g., "introduction", "literatureReview", "discussion"'),
  isLiteratureFocused: z.boolean().describe('True if this section discusses existing literature (should get synthesis enrichment)'),
  
  title: z.string().describe('Section title'),
  purpose: z.string().describe('What this section accomplishes'),
  content: z.object({
    patterns: z.array(PatternPlanSchema).describe('Patterns to discuss in this section (only for literature-focused sections)'),
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

1. SECTION COUNT (MOST IMPORTANT)
   - You MUST create EXACTLY the same number of sections as specified in the outline
   - Do NOT skip sections, combine sections, or add extra sections
   - If the outline has 5 sections, your plan MUST have exactly 5 sections

2. SECTION ALIGNMENT
   - Each section MUST specify an outlineSectionKey matching the provided outline EXACTLY
   - Each section MUST specify isLiteratureFocused (copy value from outline)
   - Literature-focused sections get synthesis patterns/contradictions/gaps
   - Non-literature sections (Methods, Results) should NOT include synthesis patterns

3. PAPER TYPE CONSTRAINTS
   - Respect the paper type rules (required sections, forbidden sections)
   - Match your sections to the provided outline structure
   - Allocate content appropriately for the paper type

4. PATTERN PRESENTATION
   - Decide which patterns are central vs supporting
   - Plan how to present quantitative data clearly
   - Include support statements like "X of Y studies (Z%) found..."
   - Only assign patterns to literature-focused sections

5. HANDLING CONTRADICTIONS
   - Present both sides fairly
   - Offer explanations for disagreements
   - Don't dismiss valid conflicting findings

6. GAPS AND FUTURE WORK
   - Integrate gaps naturally, typically in Discussion or Conclusion
   - Connect gaps to patterns (what's known vs unknown)
   - Suggest concrete future research directions

7. NARRATIVE FLOW
   - Plan transitions between sections
   - Maintain a clear argument throughout
   - End with synthesis, not just summary

Remember: This is a PLAN for writing, not the synthesis itself. Be specific about what to write and how.`

function buildPrompt(input: SynthesisPlanInput): string {
  const { 
    analysis, 
    papers, 
    targetWordCount, 
    focusAreas, 
    audienceLevel,
    paperType,
    structuralConstraints,
    outlineSections
  } = input
  
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
  
  // NEW: Build paper type constraints text
  let paperTypeText = ''
  if (paperType && structuralConstraints) {
    paperTypeText = `
PAPER TYPE CONSTRAINTS:
Paper Type: ${paperType}
Discipline: ${structuralConstraints.disciplineContext}

Required Sections:
${structuralConstraints.requiredSections.map(s => 
  `- ${s.key}: "${s.name}" ${s.isLiteratureFocused ? '[LITERATURE-FOCUSED - include synthesis patterns]' : '[NOT literature-focused - no synthesis patterns]'}`
).join('\n')}

Forbidden Sections (DO NOT CREATE):
${structuralConstraints.forbiddenSections.length > 0 
  ? structuralConstraints.forbiddenSections.map(s => `- ${s}`).join('\n')
  : '(none)'}

Source Requirements:
- Minimum sources: ${structuralConstraints.minSources}
- Ideal sources: ${structuralConstraints.idealSources}
`
  }
  
  // NEW: Build outline sections text
  let outlineText = ''
  if (outlineSections && outlineSections.length > 0) {
    outlineText = `
OUTLINE SECTIONS (REQUIRED - CREATE EXACTLY ${outlineSections.length} SECTIONS):
You MUST create exactly ${outlineSections.length} sections in your plan, one for EACH outline section below.
Do NOT skip any sections. Do NOT combine sections. Do NOT create extra sections.

${outlineSections.map((s, i) => 
  `${i + 1}. ${s.sectionKey}: "${s.title}" ${s.isLiteratureFocused ? '[LITERATURE-FOCUSED]' : '[NOT literature-focused]'} ${s.expectedWords ? `(~${s.expectedWords} words)` : ''}`
).join('\n')}
`
  }
  
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
${paperTypeText}
${outlineText}
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
1. Creates EXACTLY the same number of sections as the outline (one section per outline section)
2. Each section's outlineSectionKey MUST match an outline section key exactly
3. Marks isLiteratureFocused correctly for each section (copy from outline)
4. Only includes patterns/contradictions/gaps in literature-focused sections
5. Covers all important patterns in appropriate sections
6. Addresses contradictions fairly
7. Places gaps and future directions in Discussion/Conclusion sections
8. Flows logically from section to section with transitions
9. Provides clear writing guidance for each section

CRITICAL: Your sections array MUST have exactly ${outlineSections?.length || 'the same number of'} elements matching the outline.`
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
  
  info({
    patterns: analysis.patterns.length,
    contradictions: analysis.contradictions.length,
    gaps: analysis.gaps.length,
    papers: papers.length,
    targetWordCount,
    paperType: input.paperType,
    outlineSections: input.outlineSections?.length || 0
  }, 'Building synthesis plan')
  
  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: SynthesisPlanSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input),
      temperature: 0.3,
    })
    
    const timeMs = Date.now() - startTime
    
    // Validate section count matches outline if provided
    if (input.outlineSections && input.outlineSections.length > 0) {
      if (object.sections.length !== input.outlineSections.length) {
        warn({
          expected: input.outlineSections.length,
          received: object.sections.length,
          outlineKeys: input.outlineSections.map(s => s.sectionKey),
          planKeys: object.sections.map(s => s.outlineSectionKey)
        }, 'Plan section count mismatch - LLM did not follow outline')
      }
    }
    
    // Transform to final plan with IDs
    const sections: SectionPlan[] = object.sections.map((s, _i) => ({
      id: uuidv4(),
      // NEW: Include outline alignment fields
      outlineSectionKey: s.outlineSectionKey,
      isLiteratureFocused: s.isLiteratureFocused,
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
    
    info({
      title: plan.overview.title,
      sections: plan.sections.length,
      totalWords: plan.overview.totalWordCount,
      timeMs
    }, 'Synthesis plan complete')
    
    return {
      success: true,
      plan,
      timeMs
    }
    
  } catch (error) {
    warn({ error }, 'Plan generation failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timeMs: Date.now() - startTime
    }
  }
}
