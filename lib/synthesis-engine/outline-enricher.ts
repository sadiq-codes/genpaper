/**
 * Outline Enricher
 * 
 * Bridges the gap between structure-driven outline and content-driven synthesis.
 * Enriches outline sections with synthesis patterns, contradictions, and gaps.
 * Only literature-focused sections receive synthesis enrichment.
 * 
 * @module lib/synthesis-engine/outline-enricher
 */

import type { GeneratedOutline, SectionContext } from '@/lib/prompts/types'
import type { PaperProfile } from '@/lib/generation/paper-profile-types'
import type { PaperWithAuthors } from '@/types/simplified'
import type { AnalysisResult } from '@/lib/analysis/cross-document'
import type { 
  SynthesisPlan, 
  PatternPlan, 
  ContradictionPlan, 
  GapPlan,
  PaperInfo,
  OutlineSectionInput
} from './types'
import { buildSynthesisPlan } from './plan-builder'
import { buildConstraintsFromProfile, annotateOutlineSections } from './constraint-builder'
import { GenerationContextService } from '@/lib/rag/generation-context'
import { info, warn } from '@/lib/utils/logger'

// =============================================================================
// Types
// =============================================================================

/**
 * Writing guidance for a section
 */
export interface SectionWritingGuidance {
  approach: string
  tone: string
  keyPointsToMake: string[]
  transitionFrom?: string
  transitionTo?: string
  // NEW: From Phase 4 enhancements
  paragraphStrategy?: string
  synthesisLevel?: string
  mustNotRepeat?: string[]  // Claims from previous sections
}

/**
 * Synthesis content to include in a section
 */
export interface SynthesisContent {
  patterns: PatternPlan[]
  contradictions: ContradictionPlan[]
  gaps: GapPlan[]
}

/**
 * Paper citation priorities
 */
export interface PaperPriority {
  primary: string[]    // Must cite these papers
  supporting: string[] // Can cite these papers
}

/**
 * Extended SectionContext with synthesis enrichment
 * This is the key type that bridges synthesis analysis with the prompt system
 */
export interface EnrichedSectionContext extends SectionContext {
  // All original SectionContext fields are inherited
  
  // NEW: Flag for conditional template rendering
  hasSynthesisEnrichment: boolean
  
  // NEW: Whether this section discusses existing literature (for table requirement)
  isLiteratureFocused: boolean
  
  // NEW: Synthesis content (only for literature-focused sections)
  synthesisContent?: SynthesisContent
  
  // NEW: Section-specific writing guidance
  writingGuidance?: SectionWritingGuidance
  
  // NEW: Paper citation priorities from synthesis plan
  paperPriority?: PaperPriority
}

// =============================================================================
// Main Enrichment Function
// =============================================================================

/**
 * Enrich outline sections with synthesis analysis content
 * 
 * Process:
 * 1. Build structural constraints from profile
 * 2. Annotate outline sections with literature-focus flags
 * 3. Call buildSynthesisPlan with constraints
 * 4. Map plan sections to outline sections
 * 5. Add RAG chunks to all sections
 * 6. Return enriched contexts
 * 
 * @param outline - The generated outline (structure)
 * @param analysisResult - Cross-document analysis (patterns, contradictions, gaps)
 * @param profile - Paper profile with structure guidance
 * @param papers - All papers with full metadata
 * @param topic - The paper topic
 * @returns Enriched section contexts ready for unified generator
 */
export async function enrichOutlineSections(
  outline: GeneratedOutline,
  analysisResult: AnalysisResult,
  profile: PaperProfile,
  papers: PaperWithAuthors[],
  topic: string
): Promise<EnrichedSectionContext[]> {
  const startTime = Date.now()
  
  // Step 1: Build structural constraints from profile
  const constraints = buildConstraintsFromProfile(profile)
  
  // Step 2: Annotate outline sections with literature-focus flags
  const annotatedSections = annotateOutlineSections(
    outline.sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      expectedWords: s.expectedWords,
      keyPoints: s.keyPoints
    })),
    constraints.paperType
  )
  
  // Step 3: Build paper info for synthesis plan
  const paperInfos: PaperInfo[] = papers.map(p => ({
    id: p.id,
    title: p.title,
    authors: p.author_names || [],
    year: p.publication_date ? new Date(p.publication_date).getFullYear() : undefined,
    domain: profile.discipline.primary
  }))
  
  // Step 4: Try to build synthesis plan
  let synthesisPlan: SynthesisPlan | undefined
  
  try {
    const planResult = await buildSynthesisPlan({
      projectId: 'enrichment',
      analysis: analysisResult,
      papers: paperInfos,
      paperType: constraints.paperType,
      paperProfile: profile,
      structuralConstraints: constraints,
      outlineSections: annotatedSections as OutlineSectionInput[],
      targetWordCount: outline.totalEstimatedWords || 
        outline.sections.reduce((sum, s) => sum + (s.expectedWords || 300), 0),
      audienceLevel: 'academic'
    })
    
    if (planResult.success && planResult.plan) {
      synthesisPlan = planResult.plan
      info({
        sections: synthesisPlan.sections.length,
        patternsPlanned: synthesisPlan.sections.reduce((sum, s) => sum + s.content.patterns.length, 0),
        contradictionsPlanned: synthesisPlan.sections.reduce((sum, s) => sum + s.content.contradictions.length, 0),
        gapsPlanned: synthesisPlan.sections.reduce((sum, s) => sum + s.content.gaps.length, 0)
      }, 'Synthesis plan built for outline enrichment')
    }
  } catch (planError) {
    warn({ error: planError }, 'Synthesis plan failed, will enrich with raw analysis data')
  }
  
  // Step 5: Build basic section contexts with RAG chunks
  const baseContexts = await GenerationContextService.buildContexts(
    outline,
    topic,
    papers
  )
  
  // Step 6: Enrich each section
  const enrichedContexts: EnrichedSectionContext[] = baseContexts.map((baseContext, index) => {
    const outlineSection = outline.sections[index]
    const annotatedSection = annotatedSections[index]
    const isLitFocused = annotatedSection.isLiteratureFocused
    
    // Find matching plan section (if we have a plan)
    const planSection = synthesisPlan?.sections.find(
      ps => ps.outlineSectionKey === outlineSection.sectionKey ||
            ps.title.toLowerCase() === outlineSection.title.toLowerCase()
    )
    
    // Build enriched context
    // hasSynthesisEnrichment is true when we have ANY plan data (writing guidance, paper priority, or synthesis content)
    const enriched: EnrichedSectionContext = {
      ...baseContext,
      hasSynthesisEnrichment: !!planSection || (isLitFocused && analysisResult.patterns.length > 0),
      isLiteratureFocused: isLitFocused
    }
    
    // Add writing guidance and paper priority for ALL sections (from plan)
    if (planSection) {
      // Convert structured key points to strings for template
      const keyPointStrings = planSection.keyPointsToMake.map(kp => kp.point)
      
      enriched.writingGuidance = {
        approach: planSection.writingGuidance.approach,
        tone: planSection.writingGuidance.tone,
        keyPointsToMake: keyPointStrings,
        transitionFrom: planSection.writingGuidance.transitionFrom || undefined,
        transitionTo: planSection.writingGuidance.transitionTo || undefined,
        paragraphStrategy: planSection.writingGuidance.paragraphStrategy || undefined,
        synthesisLevel: planSection.writingGuidance.synthesisLevel || undefined,
        mustNotRepeat: planSection.mustNotRepeat.length > 0 ? planSection.mustNotRepeat : undefined
      }
      
      enriched.paperPriority = {
        primary: planSection.papers.primary,
        supporting: planSection.papers.supporting
      }
    }
    
    // Only add synthesis content (patterns, contradictions, gaps) for literature-focused sections
    if (isLitFocused) {
      if (planSection) {
        enriched.synthesisContent = {
          patterns: planSection.content.patterns,
          contradictions: planSection.content.contradictions,
          gaps: planSection.content.gaps
        }
      } else {
        // Fallback: distribute raw analysis data to relevant sections
        enriched.synthesisContent = distributeAnalysisToSection(
          outlineSection.sectionKey,
          outlineSection.title,
          analysisResult
        )
      }
    }
    
    // Diagnostic logging for each section
    info({
      stage: 'synthesis-pipeline',
      step: 'section-enrichment',
      sectionIndex: index,
      section: {
        key: outlineSection.sectionKey,
        title: outlineSection.title,
        isLiteratureFocused: isLitFocused
      },
      planMatch: {
        found: !!planSection,
        matchedBy: planSection 
          ? (planSection.outlineSectionKey === outlineSection.sectionKey ? 'key' : 'title')
          : null,
        planSectionTitle: planSection?.title || null
      },
      enrichment: {
        hasWritingGuidance: !!enriched.writingGuidance,
        keyPointsCount: enriched.writingGuidance?.keyPointsToMake?.length || 0,
        mustNotRepeatCount: enriched.writingGuidance?.mustNotRepeat?.length || 0,
        hasSynthesisContent: !!enriched.synthesisContent,
        patternsCount: enriched.synthesisContent?.patterns?.length || 0,
        usedFallback: isLitFocused && !planSection
      }
    }, `Section enrichment: ${outlineSection.title}`)
    
    // Warn if literature-focused section is missing mustNotRepeat (except first section)
    if (isLitFocused && index > 0 && (!enriched.writingGuidance?.mustNotRepeat || enriched.writingGuidance.mustNotRepeat.length === 0)) {
      warn({
        stage: 'synthesis-pipeline',
        issue: 'missing-must-not-repeat',
        section: outlineSection.title,
        sectionIndex: index
      }, `⚠️ Section "${outlineSection.title}" has no mustNotRepeat - repetition prevention disabled`)
    }
    
    return enriched
  })
  
  info({
    totalSections: enrichedContexts.length,
    enrichedSections: enrichedContexts.filter(s => s.hasSynthesisEnrichment).length,
    durationMs: Date.now() - startTime
  }, 'Outline enrichment complete')
  
  return enrichedContexts
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Distribute raw analysis data to a section based on section type
 * Used when synthesis plan building fails
 */
function distributeAnalysisToSection(
  sectionKey: string,
  sectionTitle: string,
  analysis: AnalysisResult
): SynthesisContent {
  const normalizedKey = sectionKey.toString().toLowerCase()
  const normalizedTitle = sectionTitle.toLowerCase()
  
  // Introduction: Brief overview, maybe 1-2 key patterns
  if (normalizedKey === 'introduction' || normalizedTitle.includes('introduction')) {
    return {
      patterns: analysis.patterns.slice(0, 2).map(patternToPatternPlan),
      contradictions: [],
      gaps: []
    }
  }
  
  // Literature Review: Main patterns and contradictions
  if (
    normalizedKey.includes('literature') || 
    normalizedKey.includes('review') ||
    normalizedTitle.includes('literature') ||
    normalizedTitle.includes('review')
  ) {
    return {
      patterns: analysis.patterns.map(patternToPatternPlan),
      contradictions: analysis.contradictions.map(contradictionToContradictionPlan),
      gaps: [] // Save gaps for discussion
    }
  }
  
  // Discussion: Contradictions, gaps, and key insights
  if (normalizedKey === 'discussion' || normalizedTitle.includes('discussion')) {
    return {
      patterns: analysis.patterns.filter(p => p.confidence > 0.7).slice(0, 3).map(patternToPatternPlan),
      contradictions: analysis.contradictions.map(contradictionToContradictionPlan),
      gaps: analysis.gaps.map(gapToGapPlan)
    }
  }
  
  // Conclusion: High-level summary, gaps as future work
  if (
    normalizedKey === 'conclusion' || 
    normalizedKey === 'conclusions' ||
    normalizedTitle.includes('conclusion')
  ) {
    return {
      patterns: [], // Don't repeat patterns
      contradictions: [],
      gaps: analysis.gaps.slice(0, 3).map(gapToGapPlan)
    }
  }
  
  // Thematic sections: Distribute patterns based on topic overlap
  // For now, just include top patterns
  return {
    patterns: analysis.patterns.slice(0, 3).map(patternToPatternPlan),
    contradictions: analysis.contradictions.slice(0, 1).map(contradictionToContradictionPlan),
    gaps: []
  }
}

/**
 * Convert Pattern to PatternPlan
 */
function patternToPatternPlan(pattern: AnalysisResult['patterns'][0]): PatternPlan {
  return {
    patternId: pattern.id,
    claim: pattern.claim,
    importance: pattern.confidence > 0.8 ? 'central' : pattern.confidence > 0.6 ? 'supporting' : 'minor',
    presentationApproach: `Present with ${pattern.support.count} of ${pattern.support.total} studies supporting`,
    data: {
      supportStatement: `${pattern.support.count} of ${pattern.support.total} studies (${Math.round(pattern.support.count / pattern.support.total * 100)}%) found ${pattern.claim.toLowerCase()}`,
      valuesSummary: pattern.values?.summary || undefined,
      contextNotes: pattern.limitations || undefined
    },
    supportingPaperIds: pattern.support.papers.map(p => p.paperId)
  }
}

/**
 * Convert Contradiction to ContradictionPlan
 */
function contradictionToContradictionPlan(contradiction: AnalysisResult['contradictions'][0]): ContradictionPlan {
  return {
    contradictionId: contradiction.id,
    description: contradiction.description,
    presentationApproach: 'Present both sides fairly before discussing possible explanations',
    resolutionStrategy: contradiction.possibleExplanation || undefined,
    sides: contradiction.sides.map(side => ({
      position: side.position,
      paperIds: side.papers.map(p => p.paperId)
    }))
  }
}

/**
 * Convert Gap to GapPlan
 */
function gapToGapPlan(gap: AnalysisResult['gaps'][0]): GapPlan {
  return {
    gapId: gap.id,
    description: gap.description,
    importance: gap.relevance,
    suggestedFutureWork: `Research could address this ${gap.type} gap`
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  isLiteratureFocusedSection,
  buildConstraintsFromProfile,
  annotateOutlineSections
} from './constraint-builder'
