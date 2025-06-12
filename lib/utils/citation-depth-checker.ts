/**
 * Citation-Density & Depth Checker
 * 
 * Task 7: After each section draft, run checkCitationDensity(content, minPerPara) and 
 * regex-scan for depth cues ("compare," "critique," etc.). If either fails, emit a 
 * review progress event (and optionally auto-retry with a stronger prompt).
 */

export interface CitationDensityResult {
  paragraphCount: number
  citationCount: number
  citationDensity: number
  citationsParagraphs: { paragraphIndex: number; citations: string[] }[]
  uncitedParagraphs: number[]
  meetsDensityRequirement: boolean
}

export interface DepthCueResult {
  requiredCues: string[]
  foundCues: string[]
  missingCues: string[]
  meetsDepthRequirement: boolean
  cueDetails: { cue: string; found: boolean; occurrences: number }[]
}

export interface QualityCheckResult {
  citationCheck: CitationDensityResult
  depthCheck: DepthCueResult
  overallQuality: 'excellent' | 'good' | 'needs_review' | 'poor'
  requiresReview: boolean
  suggestions: string[]
}

export interface ReviewEventData {
  type: 'review'
  stage: string
  sectionTitle?: string
  qualityCheck: QualityCheckResult
  timestamp: string
}

/**
 * Check citation density in content
 */
export function checkCitationDensity(
  content: string, 
  minPerPara: number = 1
): CitationDensityResult {
  // Split content into paragraphs (filter out empty ones)
  const paragraphs = content
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  // Find all citations using the pattern [CITE:uuid]
  const citationRegex = /\[CITE:\s*[a-f0-9-]{36}\]/gi
  const allCitations = content.match(citationRegex) || []
  
  // Map citations to paragraphs
  const citationsParagraphs: { paragraphIndex: number; citations: string[] }[] = []
  const uncitedParagraphs: number[] = []

  paragraphs.forEach((paragraph, index) => {
    const paragraphCitations = paragraph.match(citationRegex) || []
    
    if (paragraphCitations.length > 0) {
      citationsParagraphs.push({
        paragraphIndex: index,
        citations: paragraphCitations
      })
    } else {
      uncitedParagraphs.push(index)
    }
  })

  const citationDensity = paragraphs.length > 0 ? allCitations.length / paragraphs.length : 0
  const meetsDensityRequirement = paragraphs.length === 0 ? false : citationDensity >= minPerPara

  return {
    paragraphCount: paragraphs.length,
    citationCount: allCitations.length,
    citationDensity,
    citationsParagraphs,
    uncitedParagraphs,
    meetsDensityRequirement
  }
}

/**
 * Check for depth cues in content
 */
export function checkDepthCues(
  content: string,
  requiredCues: string[] = ['compare', 'critique', 'gap', 'statistics']
): DepthCueResult {
  const contentLower = content.toLowerCase()
  const foundCues: string[] = []
  const missingCues: string[] = []
  const cueDetails: { cue: string; found: boolean; occurrences: number }[] = []

  requiredCues.forEach(cue => {
    // Create variations of the cue for better matching
    const cueVariations = generateCueVariations(cue)
    let totalOccurrences = 0
    let found = false

    cueVariations.forEach(variation => {
      const regex = new RegExp(`\\b${variation}\\w*`, 'gi')
      const matches = contentLower.match(regex) || []
      totalOccurrences += matches.length
      
      if (matches.length > 0) {
        found = true
      }
    })

    cueDetails.push({
      cue,
      found,
      occurrences: totalOccurrences
    })

    if (found) {
      foundCues.push(cue)
    } else {
      missingCues.push(cue)
    }
  })

  // Require at least 50% of depth cues to be present
  const meetsDepthRequirement = foundCues.length >= Math.ceil(requiredCues.length * 0.5)

  return {
    requiredCues,
    foundCues,
    missingCues,
    meetsDepthRequirement,
    cueDetails
  }
}

/**
 * Generate variations of depth cues for better matching
 */
function generateCueVariations(cue: string): string[] {
  const variations: string[] = [cue]
  
  const cueVariationMap: Record<string, string[]> = {
    'compare': ['compar', 'contrast', 'differ', 'versus', 'vs'],
    'critique': ['critiqu', 'evaluat', 'assess', 'analyz'],
    'gap': ['gap', 'limitation', 'lack', 'absence', 'missing'],
    'statistics': ['statistic', 'percent', '%', 'significant', 'p <', 'p='],
    'synthesis': ['synthes', 'combin', 'integrat', 'merge'],
    'methodology': ['method', 'approach', 'procedure', 'technique'],
    'theoretical framework': ['theor', 'framework', 'model', 'concept'],
    'future directions': ['future', 'recommendation', 'suggest', 'implication']
  }

  if (cueVariationMap[cue]) {
    variations.push(...cueVariationMap[cue])
  }

  return variations
}

/**
 * Perform comprehensive quality check on section content
 */
export function performQualityCheck(
  content: string,
  requiredDepthCues: string[] = ['compare', 'critique', 'gap', 'statistics'],
  minCitationPerPara: number = 1
): QualityCheckResult {
  const citationCheck = checkCitationDensity(content, minCitationPerPara)
  const depthCheck = checkDepthCues(content, requiredDepthCues)
  
  // Determine overall quality
  let overallQuality: QualityCheckResult['overallQuality'] = 'excellent'
  const suggestions: string[] = []
  
  // Citation quality assessment
  if (!citationCheck.meetsDensityRequirement) {
    if (citationCheck.citationDensity < 0.5) {
      overallQuality = 'poor'
      suggestions.push(`Critical: Only ${citationCheck.citationCount} citations for ${citationCheck.paragraphCount} paragraphs (${(citationCheck.citationDensity * 100).toFixed(1)}% density). Add citations to paragraphs: ${citationCheck.uncitedParagraphs.map(i => i + 1).join(', ')}.`)
    } else {
      overallQuality = overallQuality === 'excellent' ? 'needs_review' : overallQuality
      suggestions.push(`Low citation density: ${(citationCheck.citationDensity * 100).toFixed(1)}%. Consider adding more citations to strengthen academic rigor.`)
    }
  }

  // Depth quality assessment
  if (!depthCheck.meetsDepthRequirement) {
    if (depthCheck.foundCues.length === 0) {
      overallQuality = 'poor'
      suggestions.push(`Critical: No depth cues found. Add critical analysis using words like: ${depthCheck.missingCues.join(', ')}.`)
    } else {
      overallQuality = overallQuality === 'excellent' ? 'needs_review' : overallQuality
      suggestions.push(`Missing depth cues: ${depthCheck.missingCues.join(', ')}. Add more critical analysis and comparison.`)
    }
  }

  // Positive feedback for good quality
  if (citationCheck.meetsDensityRequirement && depthCheck.meetsDepthRequirement) {
    if (citationCheck.citationDensity >= 1.0 && depthCheck.foundCues.length >= requiredDepthCues.length * 0.75) {
      overallQuality = 'excellent'
      suggestions.push('Excellent citation density and critical depth!')
    } else {
      overallQuality = 'good'
    }
  }

  const requiresReview = overallQuality === 'needs_review' || overallQuality === 'poor'

  return {
    citationCheck,
    depthCheck,
    overallQuality,
    requiresReview,
    suggestions
  }
}

/**
 * Create a review event that can be emitted to the progress stream
 */
export function createReviewEvent(
  stage: string,
  qualityCheck: QualityCheckResult,
  sectionTitle?: string
): ReviewEventData {
  return {
    type: 'review',
    stage,
    sectionTitle,
    qualityCheck,
    timestamp: new Date().toISOString()
  }
}

/**
 * Generate a stronger prompt based on quality check results
 */
export function generateStrongerPrompt(
  originalPrompt: string,
  qualityCheck: QualityCheckResult
): string {
  let strengthenedPrompt = originalPrompt

  // Add citation enforcement
  if (!qualityCheck.citationCheck.meetsDensityRequirement) {
    strengthenedPrompt += `\n\nIMPORTANT: Ensure EVERY paragraph contains at least one citation using [CITE:paperID] format. Currently missing citations in ${qualityCheck.citationCheck.uncitedParagraphs.length} paragraphs.`
  }

  // Add depth cue enforcement
  if (!qualityCheck.depthCheck.meetsDepthRequirement) {
    strengthenedPrompt += `\n\nCRITICAL ANALYSIS REQUIRED: Include these missing analytical elements: ${qualityCheck.depthCheck.missingCues.join(', ')}. Use words like "compare", "critique", "evaluate", and "analyze" to demonstrate critical thinking.`
  }

  // Add specific suggestions
  if (qualityCheck.suggestions.length > 0) {
    strengthenedPrompt += `\n\nQUALITY REQUIREMENTS:\n${qualityCheck.suggestions.map(s => `- ${s}`).join('\n')}`
  }

  return strengthenedPrompt
}

/**
 * Configuration for quality checking
 */
export interface QualityCheckConfig {
  minCitationPerPara: number
  requiredDepthCues: string[]
  autoRetry: boolean
  maxRetries: number
}

export const DEFAULT_QUALITY_CONFIG: QualityCheckConfig = {
  minCitationPerPara: 1,
  requiredDepthCues: ['compare', 'critique', 'gap', 'statistics'],
  autoRetry: true,
  maxRetries: 2
} 