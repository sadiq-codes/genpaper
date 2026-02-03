/**
 * Theme Analysis Adapter
 * 
 * Converts AnalysisResult (from our cross-document analysis) to ThemeAnalysis
 * (used by the existing pipeline). This enables backward compatibility while
 * providing much richer, data-driven theme extraction.
 * 
 * The adapter maps:
 * - Patterns → EmergentThemes (with actual paper counts)
 * - Contradictions → ScholarlyDebates (with both sides)
 * - Gaps → LiteratureGaps (with significance)
 * 
 * @module lib/synthesis-engine/theme-adapter
 */

import type { AnalysisResult, Pattern, Contradiction, Gap } from '@/lib/analysis/cross-document'
import type { 
  ThemeAnalysis, 
  EmergentTheme, 
  ScholarlyDebate, 
  LiteratureGap,
  PivotalPaper,
  MethodologicalApproach,
  OrganizationSuggestion
} from '@/lib/generation/paper-profile-types'
import type { PaperInfo } from './types'

// =============================================================================
// Main Adapter Function
// =============================================================================

/**
 * Convert AnalysisResult to ThemeAnalysis
 * 
 * This is the main function used to integrate our new analysis engine
 * with the existing pipeline that expects ThemeAnalysis format.
 */
export function analysisResultToThemeAnalysis(
  analysis: AnalysisResult,
  papers: PaperInfo[]
): ThemeAnalysis {
  
  // Convert patterns to emergent themes
  const emergentThemes: EmergentTheme[] = analysis.patterns.map(pattern => 
    patternToEmergentTheme(pattern, papers)
  )
  
  // Convert contradictions to scholarly debates
  const debates: ScholarlyDebate[] = analysis.contradictions.map(contradiction =>
    contradictionToScholarlyDebate(contradiction, papers)
  )
  
  // Convert gaps to literature gaps
  const gaps: LiteratureGap[] = analysis.gaps.map(gap =>
    gapToLiteratureGap(gap)
  )
  
  // Identify pivotal papers (most frequently cited in patterns)
  const pivotalPapers = identifyPivotalPapers(analysis.patterns, papers)
  
  // Determine methodological approaches from patterns
  const methodologicalApproaches = extractMethodologicalApproaches(analysis.patterns, papers)
  
  // Generate organization suggestion based on analysis
  const organizationSuggestion = generateOrganizationSuggestion(analysis, papers)
  
  // Calculate temporal span from papers
  const temporalSpan = calculateTemporalSpan(papers)
  
  // Calculate confidence based on analysis quality
  const confidence = calculateConfidence(analysis)
  
  return {
    analyzedAt: new Date().toISOString(),
    papersAnalyzed: analysis.analyzedPapers,
    papersWithFullText: papers.length, // Assume all have some content
    emergentThemes,
    debates,
    gaps,
    pivotalPapers,
    methodologicalApproaches,
    organizationSuggestion,
    temporalSpan,
    confidence,
    limitations: generateLimitations(analysis)
  }
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert a Pattern to an EmergentTheme
 */
function patternToEmergentTheme(pattern: Pattern, papers: PaperInfo[]): EmergentTheme {
  // Get paper IDs that support this pattern
  const paperIds = pattern.support.papers.map(p => p.paperId)
  
  // Build description with actual statistics (guard against division by zero)
  const percentage = pattern.support.total > 0
    ? Math.round(pattern.support.count / pattern.support.total * 100)
    : 0
  const description = `${pattern.summary}. This pattern is supported by ${pattern.support.count} of ${pattern.support.total} papers (${percentage}%).`
  
  // Determine strength based on consistency and confidence
  let strength: 'dominant' | 'moderate' | 'emerging'
  if (pattern.confidence > 0.7 && pattern.consistency === 'consistent') {
    strength = 'dominant'
  } else if (pattern.confidence > 0.4) {
    strength = 'moderate'
  } else {
    strength = 'emerging'
  }
  
  return {
    name: pattern.claim,
    description,
    supportingPaperIds: paperIds,
    strength,
    keyTerms: extractKeyTerms(pattern.claim)
  }
}

/**
 * Convert a Contradiction to a ScholarlyDebate
 */
function contradictionToScholarlyDebate(contradiction: Contradiction, papers: PaperInfo[]): ScholarlyDebate {
  // Map sides to debate positions
  const positions = contradiction.sides.map(side => ({
    stance: side.position,
    supportingPaperIds: side.papers.map(p => p.paperId)
  }))
  
  // Build significance from explanation
  const significance = contradiction.possibleExplanation || 
    `This debate involves ${contradiction.sides.length} different perspectives in the literature.`
  
  return {
    topic: contradiction.description,
    positions,
    significance
  }
}

/**
 * Convert a Gap to a LiteratureGap
 */
function gapToLiteratureGap(gap: Gap): LiteratureGap {
  // Determine significance based on relevance
  let significance: 'critical' | 'notable' | 'minor'
  if (gap.relevance.toLowerCase().includes('significant') || 
      gap.relevance.toLowerCase().includes('critical') ||
      gap.relevance.toLowerCase().includes('major')) {
    significance = 'critical'
  } else if (gap.relevance.toLowerCase().includes('minor')) {
    significance = 'minor'
  } else {
    significance = 'notable'
  }
  
  return {
    description: gap.description,
    relatedThemes: [gap.type], // Gap type as related theme
    significance,
    potentialDirections: gap.relevance ? [gap.relevance] : undefined
  }
}

// =============================================================================
// Supporting Functions
// =============================================================================

/**
 * Identify pivotal papers based on pattern support frequency
 */
function identifyPivotalPapers(patterns: Pattern[], papers: PaperInfo[]): PivotalPaper[] {
  // Count how many patterns each paper supports
  const paperPatternCount = new Map<string, number>()
  
  for (const pattern of patterns) {
    for (const support of pattern.support.papers) {
      const count = paperPatternCount.get(support.paperId) || 0
      paperPatternCount.set(support.paperId, count + 1)
    }
  }
  
  // Sort by count and take top papers
  const sorted = [...paperPatternCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  
  return sorted.map(([paperId, count]) => {
    const paper = papers.find(p => p.id === paperId)
    return {
      paperId,
      title: paper?.title || 'Unknown',
      reason: `Supports ${count} pattern(s) in the analysis`,
      evidenceType: 'frequently_referenced' as const
    }
  })
}

/**
 * Extract methodological approaches from patterns
 */
function extractMethodologicalApproaches(patterns: Pattern[], papers: PaperInfo[]): MethodologicalApproach[] {
  // Group papers by domain (rough proxy for methodology)
  const domainPapers = new Map<string, string[]>()
  
  for (const paper of papers) {
    const domain = paper.domain || 'general'
    const existing = domainPapers.get(domain) || []
    existing.push(paper.id)
    domainPapers.set(domain, existing)
  }
  
  return [...domainPapers.entries()].map(([domain, paperIds]) => {
    let prevalence: 'common' | 'moderate' | 'rare'
    const ratio = paperIds.length / papers.length
    if (ratio > 0.5) prevalence = 'common'
    else if (ratio > 0.2) prevalence = 'moderate'
    else prevalence = 'rare'
    
    return {
      name: domain,
      paperIds,
      prevalence
    }
  })
}

/**
 * Generate organization suggestion based on analysis
 */
function generateOrganizationSuggestion(analysis: AnalysisResult, papers: PaperInfo[]): OrganizationSuggestion {
  // Determine best approach based on what we found
  let approach: 'thematic' | 'chronological' | 'methodological' | 'theoretical' | 'hybrid'
  let rationale: string
  
  if (analysis.patterns.length >= 3) {
    approach = 'thematic'
    rationale = `Analysis identified ${analysis.patterns.length} distinct patterns that can serve as organizing themes.`
  } else if (analysis.contradictions.length >= 2) {
    approach = 'hybrid'
    rationale = `With ${analysis.contradictions.length} scholarly debates, a hybrid thematic-argumentative structure is recommended.`
  } else {
    approach = 'thematic'
    rationale = 'Thematic organization allows for clear synthesis of findings across papers.'
  }
  
  // Generate suggested sections from patterns
  const suggestedSections = analysis.patterns.slice(0, 5).map(p => ({
    title: p.claim.slice(0, 50) + (p.claim.length > 50 ? '...' : ''),
    description: p.summary,
    relatedThemes: [p.claim]
  }))
  
  // Add gaps section if significant gaps exist
  if (analysis.gaps.length > 0) {
    suggestedSections.push({
      title: 'Gaps and Future Directions',
      description: `Discussion of ${analysis.gaps.length} identified gap(s) in the literature`,
      relatedThemes: analysis.gaps.map(g => g.description)
    })
  }
  
  return {
    approach,
    rationale,
    suggestedSections
  }
}

/**
 * Calculate temporal span from papers
 */
function calculateTemporalSpan(papers: PaperInfo[]): ThemeAnalysis['temporalSpan'] {
  const years = papers.map(p => p.year).filter((y): y is number => y !== undefined)
  
  if (years.length === 0) return undefined
  
  const earliest = Math.min(...years)
  const latest = Math.max(...years)
  
  // Find concentration period (where most papers are)
  const yearCounts = new Map<number, number>()
  for (const year of years) {
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1)
  }
  
  // Find the 3-year period with most papers
  let maxCount = 0
  let concentrationStart = latest - 2
  
  for (let start = earliest; start <= latest - 2; start++) {
    const count = (yearCounts.get(start) || 0) + 
                  (yearCounts.get(start + 1) || 0) + 
                  (yearCounts.get(start + 2) || 0)
    if (count > maxCount) {
      maxCount = count
      concentrationStart = start
    }
  }
  
  return {
    earliest,
    latest,
    concentrationPeriod: `${concentrationStart}-${concentrationStart + 2}`
  }
}

/**
 * Calculate confidence based on analysis quality
 */
function calculateConfidence(analysis: AnalysisResult): number {
  let confidence = 0.5 // Base confidence
  
  // More patterns = more confident
  if (analysis.patterns.length >= 3) confidence += 0.2
  else if (analysis.patterns.length >= 1) confidence += 0.1
  
  // High individual pattern confidence boosts overall
  const avgPatternConfidence = analysis.patterns.length > 0
    ? analysis.patterns.reduce((sum, p) => sum + p.confidence, 0) / analysis.patterns.length
    : 0.5
  confidence += (avgPatternConfidence - 0.5) * 0.3
  
  // More papers analyzed = more confident
  if (analysis.analyzedPapers >= 10) confidence += 0.1
  else if (analysis.analyzedPapers >= 5) confidence += 0.05
  
  return Math.min(1, Math.max(0, confidence))
}

/**
 * Generate limitations based on analysis
 */
function generateLimitations(analysis: AnalysisResult): string[] {
  const limitations: string[] = []
  
  if (analysis.analyzedPapers < 5) {
    limitations.push(`Limited sample size: only ${analysis.analyzedPapers} papers analyzed`)
  }
  
  if (analysis.patterns.length === 0) {
    limitations.push('No clear patterns emerged from the analysis')
  }
  
  if (analysis.contradictions.length === 0 && analysis.patterns.length > 2) {
    limitations.push('No contradictions found - literature may be one-sided')
  }
  
  return limitations
}

/**
 * Extract key terms from a claim
 */
function extractKeyTerms(claim: string): string[] {
  // Simple extraction - take significant words
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 
                            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
                            'should', 'may', 'might', 'must', 'shall', 'can', 'of', 'in', 'to',
                            'for', 'with', 'on', 'at', 'by', 'from', 'and', 'or', 'but', 'that',
                            'this', 'these', 'those', 'it', 'its'])
  
  return claim
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word))
    .slice(0, 5)
}
