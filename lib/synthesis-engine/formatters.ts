/**
 * Synthesis Data Formatters
 * 
 * Converts SynthesisPlan and AnalysisResult into prompt-compatible data
 * for the unified template system.
 * 
 * Key principle: All values are strings decided by LLM, no hardcoded enums.
 * 
 * @module lib/synthesis-engine/formatters
 */

import type { PromptData } from '@/lib/core/prompt-builder'
import type { SynthesisPlan, SectionPlan, PatternPlan, ContradictionPlan, GapPlan, PaperInfo } from './types'
import type { AnalysisResult, Pattern, Contradiction, Gap } from '@/lib/analysis/cross-document'

// =============================================================================
// Types for formatted synthesis data (matches PromptData additions)
// =============================================================================

export interface FormattedPattern {
  claim: string
  supportStatement: string
  valuesSummary?: string
  presentationApproach: string
  importance: string
  supportingPapers: string[]
}

export interface FormattedContradiction {
  description: string
  presentationApproach: string
  resolutionStrategy?: string
  sides: Array<{
    position: string
    papers: string[]
  }>
}

export interface FormattedGap {
  description: string
  importance: string
  suggestedFutureWork?: string
}

export interface FormattedWritingGuidance {
  approach: string
  tone: string
  keyPointsToMake: string[]
  transitionFrom?: string
  transitionTo?: string
}

export interface FormattedSynthesisSummary {
  totalPapersAnalyzed: number
  patternsIdentified: number
  contradictionsFound: number
  gapsIdentified: number
  overallNarrative: string
}

export interface SynthesisPromptData {
  synthesisPatterns?: FormattedPattern[]
  synthesisContradictions?: FormattedContradiction[]
  synthesisGaps?: FormattedGap[]
  sectionWritingGuidance?: FormattedWritingGuidance
  synthesisSummary?: FormattedSynthesisSummary
}

// =============================================================================
// Main Formatting Functions
// =============================================================================

/**
 * Format a section plan into synthesis prompt data
 * This is the main function used by the writer
 */
export function formatSectionForPrompt(
  sectionPlan: SectionPlan,
  analysis: AnalysisResult,
  papers: PaperInfo[]
): SynthesisPromptData {
  // Build paper lookup map
  const paperMap = new Map(papers.map(p => [p.id, p]))
  
  // Format patterns for this section
  const synthesisPatterns = sectionPlan.content.patterns.map(pp => 
    formatPatternPlan(pp, analysis, paperMap)
  )
  
  // Format contradictions for this section
  const synthesisContradictions = sectionPlan.content.contradictions.map(cp =>
    formatContradictionPlan(cp, paperMap)
  )
  
  // Format gaps for this section
  const synthesisGaps = sectionPlan.content.gaps.map(gp =>
    formatGapPlan(gp)
  )
  
  // Format writing guidance
  const sectionWritingGuidance: FormattedWritingGuidance = {
    approach: sectionPlan.writingGuidance.approach,
    tone: sectionPlan.writingGuidance.tone,
    keyPointsToMake: sectionPlan.keyPointsToMake,
    transitionFrom: sectionPlan.writingGuidance.transitionFrom,
    transitionTo: sectionPlan.writingGuidance.transitionTo
  }
  
  // Format summary
  const synthesisSummary: FormattedSynthesisSummary = {
    totalPapersAnalyzed: analysis.analyzedPapers,
    patternsIdentified: analysis.patterns.length,
    contradictionsFound: analysis.contradictions.length,
    gapsIdentified: analysis.gaps.length,
    overallNarrative: analysis.summary
  }
  
  return {
    synthesisPatterns: synthesisPatterns.length > 0 ? synthesisPatterns : undefined,
    synthesisContradictions: synthesisContradictions.length > 0 ? synthesisContradictions : undefined,
    synthesisGaps: synthesisGaps.length > 0 ? synthesisGaps : undefined,
    sectionWritingGuidance,
    synthesisSummary
  }
}

/**
 * Format the full synthesis plan into prompt data for overview/introduction sections
 */
export function formatPlanOverviewForPrompt(
  plan: SynthesisPlan,
  analysis: AnalysisResult
): SynthesisPromptData {
  return {
    synthesisSummary: {
      totalPapersAnalyzed: plan.inputSummary.totalPapers,
      patternsIdentified: plan.inputSummary.patternsFound,
      contradictionsFound: plan.inputSummary.contradictionsFound,
      gapsIdentified: plan.inputSummary.gapsFound,
      overallNarrative: analysis.summary
    },
    sectionWritingGuidance: {
      approach: plan.overview.narrativeStrategy,
      tone: plan.globalGuidance.writingStyle,
      keyPointsToMake: analysis.keyInsights
    }
  }
}

// =============================================================================
// Helper Formatting Functions
// =============================================================================

/**
 * Format a pattern plan for the prompt
 */
function formatPatternPlan(
  patternPlan: PatternPlan,
  analysis: AnalysisResult,
  paperMap: Map<string, PaperInfo>
): FormattedPattern {
  // Get paper titles for citation
  const supportingPapers = patternPlan.supportingPaperIds
    .map(id => {
      const paper = paperMap.get(id)
      if (paper) {
        return paper.year 
          ? `${paper.title} (${paper.authors[0]?.split(' ').pop() || 'Unknown'}, ${paper.year})`
          : paper.title
      }
      return id // Fallback to ID if paper not found
    })
  
  return {
    claim: patternPlan.claim,
    supportStatement: patternPlan.data.supportStatement,
    valuesSummary: patternPlan.data.valuesSummary,
    presentationApproach: patternPlan.presentationApproach,
    importance: patternPlan.importance,
    supportingPapers
  }
}

/**
 * Format a contradiction plan for the prompt
 */
function formatContradictionPlan(
  contradictionPlan: ContradictionPlan,
  paperMap: Map<string, PaperInfo>
): FormattedContradiction {
  const sides = contradictionPlan.sides.map(side => ({
    position: side.position,
    papers: side.paperIds.map(id => {
      const paper = paperMap.get(id)
      if (paper) {
        return paper.year
          ? `${paper.title} (${paper.authors[0]?.split(' ').pop() || 'Unknown'}, ${paper.year})`
          : paper.title
      }
      return id
    })
  }))
  
  return {
    description: contradictionPlan.description,
    presentationApproach: contradictionPlan.presentationApproach,
    resolutionStrategy: contradictionPlan.resolutionStrategy,
    sides
  }
}

/**
 * Format a gap plan for the prompt
 */
function formatGapPlan(gapPlan: GapPlan): FormattedGap {
  return {
    description: gapPlan.description,
    importance: gapPlan.importance,
    suggestedFutureWork: gapPlan.suggestedFutureWork
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Merge synthesis data into existing PromptData
 */
export function mergeSynthesisIntoPromptData(
  basePromptData: Partial<PromptData>,
  synthesisData: SynthesisPromptData
): Partial<PromptData> {
  return {
    ...basePromptData,
    synthesisPatterns: synthesisData.synthesisPatterns,
    synthesisContradictions: synthesisData.synthesisContradictions,
    synthesisGaps: synthesisData.synthesisGaps,
    sectionWritingGuidance: synthesisData.sectionWritingGuidance,
    synthesisSummary: synthesisData.synthesisSummary
  }
}

/**
 * Format all patterns from analysis (for sections that need all patterns)
 */
export function formatAllPatterns(
  analysis: AnalysisResult,
  papers: PaperInfo[]
): FormattedPattern[] {
  const paperMap = new Map(papers.map(p => [p.id, p]))
  
  return analysis.patterns.map(pattern => {
    // Get paper titles from pattern support
    const supportingPapers = pattern.support.papers.map(ps => {
      const paper = paperMap.get(ps.paperId)
      if (paper) {
        return paper.year
          ? `${paper.title} (${paper.authors[0]?.split(' ').pop() || 'Unknown'}, ${paper.year})`
          : paper.title
      }
      return ps.paperTitle || ps.paperId
    })
    
    return {
      claim: pattern.claim,
      supportStatement: `${pattern.support.count} of ${pattern.support.total} papers (${Math.round(pattern.support.count / pattern.support.total * 100)}%)`,
      valuesSummary: pattern.values?.summary,
      presentationApproach: `Present as ${pattern.consistency} finding with ${pattern.confidence > 0.8 ? 'high' : pattern.confidence > 0.5 ? 'moderate' : 'limited'} confidence`,
      importance: pattern.support.count >= pattern.support.total / 2 ? 'central' : 'supporting',
      supportingPapers
    }
  })
}

/**
 * Format all contradictions from analysis
 */
export function formatAllContradictions(
  analysis: AnalysisResult,
  papers: PaperInfo[]
): FormattedContradiction[] {
  const paperMap = new Map(papers.map(p => [p.id, p]))
  
  return analysis.contradictions.map(contradiction => ({
    description: contradiction.description,
    presentationApproach: `Present both sides fairly, severity: ${contradiction.severity}`,
    resolutionStrategy: contradiction.possibleExplanation,
    sides: contradiction.sides.map(side => ({
      position: side.position,
      papers: side.papers.map(p => {
        const paper = paperMap.get(p.paperId)
        return paper?.title || p.paperTitle || p.paperId
      })
    }))
  }))
}

/**
 * Format all gaps from analysis
 */
export function formatAllGaps(analysis: AnalysisResult): FormattedGap[] {
  return analysis.gaps.map(gap => ({
    description: gap.description,
    importance: gap.relevance,
    suggestedFutureWork: `Research addressing ${gap.type} gaps in this area`
  }))
}
