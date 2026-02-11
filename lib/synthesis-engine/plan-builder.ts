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

import { generateText } from 'ai'
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
  // Link to outline section (required for pipeline integration)
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
    approach: z.string().describe('How to write this section: synthesis, critical analysis, comparison, etc.'),
    tone: z.string().describe('Tone: objective, evaluative, exploratory, etc.'),
    transitionFrom: z.string().nullable().describe('How to connect from previous section'),
    transitionTo: z.string().nullable().describe('How to lead into next section'),
    // NEW: Structured paragraph guidance
    paragraphStrategy: z.enum([
      'pattern_first',       // Lead with main pattern, then supporting evidence
      'chronological',       // Trace development over time
      'compare_contrast',    // Juxtapose different findings/views
      'problem_solution',    // Present issue, then approaches
      'general_to_specific', // Start broad, narrow down
      'specific_to_general'  // Start with examples, build to principles
    ]).nullable().describe('How to structure paragraphs in this section'),
    // NEW: Synthesis vs description balance
    synthesisLevel: z.enum(['high', 'moderate', 'low']).describe(
      'high = heavy integration across sources, moderate = some comparison, low = mostly descriptive (for Methods/Results)'
    )
  }),
  targetWordCount: z.number().describe('Target word count for this section'),
  keyPointsToMake: z.array(z.object({
    point: z.string().describe('The key point to make'),
    supportingPatternIds: z.array(z.string()).describe('Pattern IDs that support this point'),
    requiredCitations: z.array(z.string()).describe('Paper IDs that MUST be cited for this point')
  })).min(2).describe('REQUIRED: At least 2-3 key points per section. Each point should be a specific claim the section will make.'),
  // NEW: Repetition prevention
  mustNotRepeat: z.array(z.string()).describe('Key claims/points already established in previous sections - do not restate')
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

═══════════════════════════════════════════════════════════════════════════════
CRITICAL INSTRUCTIONS
═══════════════════════════════════════════════════════════════════════════════

1. SECTION COUNT (MOST IMPORTANT)
   - You MUST create EXACTLY the same number of sections as specified in the outline
   - Do NOT skip, combine, or add extra sections
   - If outline has 5 sections, your plan MUST have exactly 5 sections

2. SECTION ALIGNMENT
   - Each section MUST specify outlineSectionKey matching the outline EXACTLY
   - Each section MUST specify isLiteratureFocused (copy value from outline)
   - Literature-focused sections: include patterns/contradictions/gaps
   - Non-literature sections (Methods, Results): NO synthesis patterns

3. PAPER TYPE CONSTRAINTS
   - Respect required/forbidden sections for the paper type
   - Match sections to the provided outline structure
   - Allocate content appropriately for the paper type

═══════════════════════════════════════════════════════════════════════════════
WRITING GUIDANCE PER SECTION
═══════════════════════════════════════════════════════════════════════════════

For each section, specify:

SYNTHESIS LEVEL:
- "high": Heavy integration across sources (literature review sections)
- "moderate": Some comparison, but also descriptive (discussion sections)
- "low": Mostly descriptive, minimal synthesis (methods, results sections)

PARAGRAPH STRATEGY (choose most appropriate):
- "pattern_first": Lead with main pattern, then supporting evidence
- "chronological": Trace development over time
- "compare_contrast": Juxtapose different findings/views
- "problem_solution": Present issue, then approaches
- "general_to_specific": Start broad, narrow down
- "specific_to_general": Start with examples, build to principles

═══════════════════════════════════════════════════════════════════════════════
KEY POINTS STRUCTURE (REQUIRED FOR EVERY SECTION)
═══════════════════════════════════════════════════════════════════════════════

EVERY section MUST have at least 2-3 key points. Do NOT leave keyPointsToMake empty.

For each key point, specify:
- point: The specific claim to make (derived from your analysis of the patterns, contradictions, and gaps)
- supportingPatternIds: Which patterns from the analysis support this (can be empty for structural points)
- requiredCitations: Paper IDs that MUST be cited (can be empty for methodological or concluding points)

Section-type guidance:
- Introduction: State the research problem and its significance
- Literature Review/Thematic Analysis: Present synthesized findings with specific evidence from patterns
- Discussion: Interpret findings, explain contradictions, connect to broader implications
- Conclusion: Summarize key contributions and propose future directions

Derive all key points from the actual patterns, contradictions, and gaps provided in the analysis above.

═══════════════════════════════════════════════════════════════════════════════
CONTENT ALLOCATION
═══════════════════════════════════════════════════════════════════════════════

PATTERN PRESENTATION:
- Decide which patterns are central vs supporting
- Include support statements: "X of Y studies (Z%) found..."
- Only assign patterns to literature-focused sections
- Use EXACT statistics from analysis

CONTRADICTIONS:
- Present both sides fairly
- Offer explanations for disagreements
- Don't dismiss valid conflicting findings

GAPS:
- Integrate naturally (typically in Discussion or Conclusion)
- Connect to patterns (what's known vs unknown)
- Suggest concrete future research directions

═══════════════════════════════════════════════════════════════════════════════
PAPER DISTRIBUTION (CRITICAL FOR CITATION DIVERSITY)
═══════════════════════════════════════════════════════════════════════════════

You MUST distribute papers across sections to maximize citation diversity:
- Each paper should appear as "primary" in at least ONE section
- Do NOT assign the same 5-10 papers as primary for every section
- Different sections discuss different aspects → different papers are relevant
- Aim for every available paper to be assigned (primary or supporting) to at least one section
- Literature-focused sections should have the most primary papers (8-15 each)
- Non-literature sections can have fewer (3-5 each)

BAD: Same 8 papers in every section's primary list
GOOD: Introduction cites foundational papers, Lit Review cites empirical studies, Discussion cites recent/contrasting papers

═══════════════════════════════════════════════════════════════════════════════
NARRATIVE FLOW
═══════════════════════════════════════════════════════════════════════════════

- Plan transitions between sections (transitionFrom, transitionTo)
- Maintain a clear argument throughout
- End with synthesis, not just summary
- Avoid repetition: don't restate claims from earlier sections

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
1. Creates EXACTLY ${outlineSections?.length || 'the same number of'} sections - one for EACH outline section, including non-literature sections like Methodology, Results, Discussion, Conclusion
2. Each section's outlineSectionKey MUST match an outline section key exactly
3. Marks isLiteratureFocused correctly for each section (copy from outline)
4. For non-literature sections: leave patterns/contradictions/gaps as EMPTY ARRAYS [], but still provide keyPointsToMake, writingGuidance, and papers
5. Covers all important patterns in literature-focused sections
6. Addresses contradictions fairly
7. Places gaps and future directions in Discussion/Conclusion sections
8. Flows logically from section to section with transitions
9. Provides clear writing guidance for EVERY section

CRITICAL: Your sections array MUST have exactly ${outlineSections?.length || 'the same number of'} elements. Do NOT skip non-literature sections - they still need plans with key points and writing guidance.`
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
    const { text } = await generateText({
      model: getLanguageModel(),
      system: SYSTEM_PROMPT + '\n\nIMPORTANT: Respond with ONLY a valid JSON object. No markdown fences, no explanation, just the JSON.',
      prompt: buildPrompt(input),
      temperature: 0.3,
      maxOutputTokens: 16000,
    })
    
    // Parse JSON from LLM response (strip markdown fences if present)
    let jsonStr = text.trim()
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim()
    }
    
    let rawParsed: unknown
    try {
      rawParsed = JSON.parse(jsonStr)
    } catch {
      // Try to find JSON object in the response
      const jsonStart = jsonStr.indexOf('{')
      const jsonEnd = jsonStr.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        rawParsed = JSON.parse(jsonStr.slice(jsonStart, jsonEnd + 1))
      } else {
        throw new Error('No valid JSON found in plan-builder response')
      }
    }
    
    // Validate with Zod (lenient: strip unknown fields)
    const object = SynthesisPlanSchema.parse(rawParsed)
    
    const timeMs = Date.now() - startTime
    
    // Log if section count doesn't match outline (should be rare with generateText)
    if (input.outlineSections && input.outlineSections.length > 0) {
      const existingKeys = new Set(object.sections.map(s => s.outlineSectionKey))
      const missingSections = input.outlineSections.filter(s => !existingKeys.has(s.sectionKey))
      
      if (missingSections.length > 0) {
        warn({
          expected: input.outlineSections.length,
          received: object.sections.length,
          outlineKeys: input.outlineSections.map(s => s.sectionKey),
          planKeys: object.sections.map(s => s.outlineSectionKey),
          missing: missingSections.map(s => s.sectionKey)
        }, 'Plan section count mismatch — LLM missed sections (no backfill)')
      }
    }
    
    // Track claims across sections to prevent repetition
    const claimsEstablished: string[] = []
    
    // Transform to final plan with IDs
    const sections: SectionPlan[] = object.sections.map((s, i) => {
      // Collect key points as claims that shouldn't be repeated in later sections
      const sectionClaims = s.keyPointsToMake.map(kp => kp.point)
      
      const sectionPlan: SectionPlan = {
        id: uuidv4(),
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
          transitionTo: s.writingGuidance.transitionTo || undefined,
          paragraphStrategy: s.writingGuidance.paragraphStrategy || undefined,
          synthesisLevel: s.writingGuidance.synthesisLevel || 'moderate'
        },
        targetWordCount: s.targetWordCount,
        keyPointsToMake: s.keyPointsToMake,
        mustNotRepeat: i > 0 ? [...claimsEstablished] : []  // Previous sections' claims
      }
      
      // Add this section's claims for future sections
      claimsEstablished.push(...sectionClaims)
      
      return sectionPlan
    })
    
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

    // Root enforcement: ensure synthesis items are actually distributed across literature-focused sections.
    // When the LLM under-assigns patterns/contradictions/gaps, the downstream generator becomes evidence-blind,
    // causing low citation diversity and shallow content.
    const litSections = plan.sections.filter(s => s.isLiteratureFocused)
    if (litSections.length > 0) {
      const plannedPatternIds = new Set(plan.sections.flatMap(s => s.content.patterns.map(p => p.patternId)))
      const plannedContradictionIds = new Set(plan.sections.flatMap(s => s.content.contradictions.map(c => c.contradictionId)))
      const plannedGapIds = new Set(plan.sections.flatMap(s => s.content.gaps.map(g => g.gapId)))

      const needsPatternDistribution =
        plannedPatternIds.size < Math.min(input.analysis.patterns.length, litSections.length)
      const needsContradictionDistribution =
        plannedContradictionIds.size < Math.min(input.analysis.contradictions.length, Math.max(1, Math.floor(litSections.length / 2)))
      const needsGapDistribution =
        plannedGapIds.size < Math.min(input.analysis.gaps.length, Math.max(1, Math.floor(litSections.length / 2)))

      if (needsPatternDistribution || needsContradictionDistribution || needsGapDistribution) {
        warn(
          {
            planned: {
              patterns: plannedPatternIds.size,
              contradictions: plannedContradictionIds.size,
              gaps: plannedGapIds.size
            },
            available: {
              patterns: input.analysis.patterns.length,
              contradictions: input.analysis.contradictions.length,
              gaps: input.analysis.gaps.length
            },
            litSections: litSections.map(s => s.outlineSectionKey)
          },
          'Plan under-assigned synthesis items; distributing deterministically'
        )

        const sectionOrder = [...litSections].sort((a, b) => {
          const score = (k: string) =>
            k.toLowerCase().includes('literature') || k.toLowerCase().includes('review') ? 0
              : k.toLowerCase().includes('discussion') ? 1
              : k.toLowerCase().includes('introduction') ? 2
              : k.toLowerCase().includes('conclusion') ? 3
              : 4
          return score(a.outlineSectionKey) - score(b.outlineSectionKey)
        })

        const formatSupportStatement = (count: number, total: number) => {
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return `${count} of ${total} papers (${pct}%) supported this pattern`
        }

        // Distribute missing patterns
        const missingPatterns = input.analysis.patterns.filter(p => !plannedPatternIds.has(p.id))
        for (let i = 0; i < missingPatterns.length; i++) {
          const p = missingPatterns[i]
          const target = sectionOrder[i % sectionOrder.length]
          target.content.patterns.push({
            patternId: p.id,
            claim: p.claim,
            importance: i < 3 ? 'central' : 'supporting',
            presentationApproach: 'Present as a cross-study pattern, then support with representative citations and note any limitations.',
            data: {
              supportStatement: formatSupportStatement(p.support.count, p.support.total),
              valuesSummary: p.values?.summary || undefined,
              contextNotes: p.summary || undefined
            },
            supportingPaperIds: (p.support.papers || []).map(sp => sp.paperId).filter(Boolean)
          })
        }

        // Distribute missing contradictions (prefer Discussion, then Literature Review)
        const discussionSection =
          sectionOrder.find(s => s.outlineSectionKey.toLowerCase().includes('discussion')) || sectionOrder[0]
        const missingContradictions = input.analysis.contradictions.filter(c => !plannedContradictionIds.has(c.id))
        for (const c of missingContradictions) {
          discussionSection.content.contradictions.push({
            contradictionId: c.id,
            description: c.description,
            presentationApproach: 'Present both sides fairly, then explain plausible reasons for disagreement (data, method, context).',
            resolutionStrategy: undefined,
            sides: (c.sides || []).map(s => ({
              position: s.position,
              paperIds: (s.papers || []).map(p => p.paperId).filter(Boolean)
            }))
          })
        }

        // Distribute missing gaps (prefer Conclusion, then Discussion)
        const conclusionSection =
          sectionOrder.find(s => s.outlineSectionKey.toLowerCase().includes('conclusion')) || discussionSection
        const missingGaps = input.analysis.gaps.filter(g => !plannedGapIds.has(g.id))
        for (let i = 0; i < missingGaps.length; i++) {
          const g = missingGaps[i]
          const target = i % 2 === 0 ? discussionSection : conclusionSection
          target.content.gaps.push({
            gapId: g.id,
            description: g.description,
            importance: g.relevance || g.priority || 'notable',
            suggestedFutureWork: g.suggestedResearchQuestion || undefined
          })
        }
      }
    }
    
    // Diagnostic logging for synthesis pipeline debugging
    const emptyKeyPointsSections = plan.sections
      .filter(s => s.keyPointsToMake.length === 0)
      .map(s => s.title)
    
    const sectionsWithNoMustNotRepeat = plan.sections
      .filter((s, i) => i > 0 && s.mustNotRepeat.length === 0)
      .map(s => s.title)
    
    info({
      stage: 'synthesis-pipeline',
      step: 'plan-builder-complete',
      title: plan.overview.title,
      sections: plan.sections.length,
      totalWords: plan.overview.totalWordCount,
      timeMs,
      sectionDetails: plan.sections.map(s => ({
        title: s.title,
        outlineKey: s.outlineSectionKey,
        isLitFocused: s.isLiteratureFocused,
        keyPointsCount: s.keyPointsToMake.length,
        mustNotRepeatCount: s.mustNotRepeat.length,
        patternsCount: s.content.patterns.length,
        contradictionsCount: s.content.contradictions.length,
        gapsCount: s.content.gaps.length,
        synthesisLevel: s.writingGuidance.synthesisLevel,
        paragraphStrategy: s.writingGuidance.paragraphStrategy || 'none'
      })),
      warnings: {
        emptyKeyPointsSections: emptyKeyPointsSections.length > 0 ? emptyKeyPointsSections : null,
        sectionsWithNoMustNotRepeat: sectionsWithNoMustNotRepeat.length > 0 ? sectionsWithNoMustNotRepeat : null
      }
    }, 'Synthesis plan complete')
    
    // Log warnings explicitly for visibility
    if (emptyKeyPointsSections.length > 0) {
      warn({
        stage: 'synthesis-pipeline',
        issue: 'empty-key-points',
        sections: emptyKeyPointsSections
      }, `⚠️ ${emptyKeyPointsSections.length} sections have 0 key points - mustNotRepeat will be incomplete`)
    }
    
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
