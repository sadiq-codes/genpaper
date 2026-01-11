/**
 * Paper Type Validator
 * 
 * Validates that generated content matches the declared paper type requirements.
 * This helps ensure that empirical papers have proper methodology/results sections,
 * literature reviews have proper synthesis, etc.
 */

import type { PaperTypeKey } from '@/lib/prompts/types'

export interface ValidationResult {
  valid: boolean
  issues: string[]
  warnings: string[]
  score: number // 0-100
  sectionAnalysis: {
    found: string[]
    missing: string[]
    recommendations: string[]
  }
}

interface SectionRequirement {
  name: string
  patterns: RegExp[]
  required: boolean
  minWords?: number
  description: string
}

const SECTION_REQUIREMENTS: Record<string, SectionRequirement[]> = {
  // Requirements for empirical research papers
  empiricalResearch: [
    {
      name: 'Introduction',
      patterns: [/^#{1,2}\s*introduction/im, /^#{1,2}\s*background/im],
      required: true,
      minWords: 200,
      description: 'Establishes context, research question, and significance'
    },
    {
      name: 'Research Question/Hypothesis',
      patterns: [/research\s+question/i, /hypothesis/i, /aim\s+of\s+(this|the)\s+study/i, /we\s+(hypothesize|propose|investigate)/i],
      required: true,
      description: 'Clearly stated research question or hypothesis'
    },
    {
      name: 'Literature Review',
      patterns: [/^#{1,2}\s*literature\s*review/im, /^#{1,2}\s*related\s*work/im, /^#{1,2}\s*background/im],
      required: true,
      minWords: 300,
      description: 'Review of relevant prior work'
    },
    {
      name: 'Methodology',
      patterns: [/^#{1,2}\s*method(s|ology)?/im, /^#{1,2}\s*materials?\s*(and|&)\s*methods?/im, /^#{1,2}\s*research\s*design/im],
      required: true,
      minWords: 400,
      description: 'Detailed, reproducible methodology'
    },
    {
      name: 'Results',
      patterns: [/^#{1,2}\s*results?/im, /^#{1,2}\s*findings?/im, /^#{1,2}\s*outcomes?/im],
      required: true,
      minWords: 300,
      description: 'Presentation of original findings'
    },
    {
      name: 'Discussion',
      patterns: [/^#{1,2}\s*discussion/im, /^#{1,2}\s*analysis/im],
      required: true,
      minWords: 300,
      description: 'Interpretation and implications of results'
    },
    {
      name: 'Limitations',
      patterns: [/^#{1,2}\s*limitations?/im, /limitations?\s+of\s+(this|the)\s+study/i, /^#{1,3}\s*limitations?/im],
      required: true,
      description: 'Acknowledgment of study limitations'
    },
    {
      name: 'Conclusion',
      patterns: [/^#{1,2}\s*conclusions?/im, /^#{1,2}\s*summary/im],
      required: true,
      minWords: 150,
      description: 'Summary of contributions and future directions'
    }
  ],
  
  // Requirements for literature reviews
  literatureReview: [
    {
      name: 'Introduction',
      patterns: [/^#{1,2}\s*introduction/im],
      required: true,
      minWords: 200,
      description: 'Establishes scope and objectives of the review'
    },
    {
      name: 'Search Methodology',
      patterns: [/search\s+(strategy|methodology)/i, /selection\s+criteria/i, /inclusion\s+criteria/i, /databases?\s+searched/i],
      required: false,
      description: 'Description of literature search process'
    },
    {
      name: 'Thematic Analysis',
      patterns: [/^#{1,2}\s*(thematic|theme|topic)/im, /^#{1,2}\s*analysis/im, /^#{1,2}\s*findings/im],
      required: true,
      minWords: 500,
      description: 'Organized thematic analysis of literature'
    },
    {
      name: 'Synthesis',
      patterns: [/synthesis/i, /comparative\s+analysis/i, /across\s+studies/i],
      required: true,
      description: 'Integration and synthesis of findings across sources'
    },
    {
      name: 'Research Gaps',
      patterns: [/gap(s)?\s+(in|for)\s+(the\s+)?(literature|research)/i, /future\s+research/i, /remains\s+unclear/i],
      required: true,
      description: 'Identification of gaps and future directions'
    },
    {
      name: 'Conclusion',
      patterns: [/^#{1,2}\s*conclusions?/im],
      required: true,
      minWords: 150,
      description: 'Summary of key findings from the literature'
    }
  ]
}

/**
 * Validate paper content against requirements for the specified paper type
 */
export function validatePaperType(
  content: string,
  paperType: PaperTypeKey,
  hasOriginalResearch: boolean = false
): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  const found: string[] = []
  const missing: string[] = []
  const recommendations: string[] = []
  
  // Determine which requirements to use
  let requirements: SectionRequirement[]
  
  if (hasOriginalResearch || paperType === 'researchArticle') {
    requirements = SECTION_REQUIREMENTS.empiricalResearch
  } else if (paperType === 'literatureReview') {
    requirements = SECTION_REQUIREMENTS.literatureReview
  } else {
    // For other paper types (capstone, thesis, dissertation), use empirical requirements
    // as they typically involve original research
    requirements = SECTION_REQUIREMENTS.empiricalResearch
  }
  
  // Check each requirement
  for (const req of requirements) {
    const sectionFound = req.patterns.some(pattern => pattern.test(content))
    
    if (sectionFound) {
      found.push(req.name)
      
      // Check word count if applicable
      if (req.minWords) {
        // Try to extract section content (simplified approach)
        const sectionMatch = content.match(new RegExp(
          `(${req.patterns.map(p => p.source).join('|')})([\\s\\S]*?)(?=^#{1,2}\\s|$)`,
          'im'
        ))
        
        if (sectionMatch) {
          const sectionContent = sectionMatch[2] || ''
          const wordCount = sectionContent.split(/\s+/).filter(w => w.length > 0).length
          
          if (wordCount < req.minWords) {
            warnings.push(
              `${req.name} section may be too brief (${wordCount} words, recommended: ${req.minWords}+)`
            )
          }
        }
      }
    } else if (req.required) {
      missing.push(req.name)
      issues.push(`Missing required section: ${req.name} - ${req.description}`)
      recommendations.push(`Add a ${req.name} section: ${req.description}`)
    } else {
      warnings.push(`Optional section not found: ${req.name}`)
    }
  }
  
  // Additional validation for empirical papers
  if (hasOriginalResearch) {
    // Check for data/metrics in Results section
    const hasMetrics = /\d+(\.\d+)?%|\bp\s*[<>=]\s*\d|\bstatistically\s+significant\b|\bCI\b|\bSD\b|\bmean\b/i.test(content)
    if (!hasMetrics) {
      warnings.push('Results section may lack quantitative metrics or statistical data')
      recommendations.push('Consider adding specific metrics, p-values, confidence intervals, or other quantitative results')
    }
    
    // Check that Results doesn't have excessive citations (original data shouldn't need many)
    const resultsMatch = content.match(/^#{1,2}\s*results?([\s\S]*?)(?=^#{1,2}|$)/im)
    if (resultsMatch) {
      const resultsContent = resultsMatch[1]
      const citationCount = (resultsContent.match(/\([^)]*\d{4}[^)]*\)/g) || []).length
      if (citationCount > 5) {
        warnings.push('Results section has many citations - original findings should primarily present your own data')
      }
    }
  }
  
  // Calculate score
  const requiredCount = requirements.filter(r => r.required).length
  const foundRequiredCount = requirements.filter(r => r.required && found.includes(r.name)).length
  const baseScore = requiredCount > 0 ? (foundRequiredCount / requiredCount) * 100 : 100
  
  // Reduce score for critical missing sections
  let score = baseScore
  if (missing.includes('Methodology') && hasOriginalResearch) {
    score -= 20
  }
  if (missing.includes('Results') && hasOriginalResearch) {
    score -= 20
  }
  if (missing.includes('Limitations') && hasOriginalResearch) {
    score -= 10
  }
  
  score = Math.max(0, Math.round(score))
  
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    score,
    sectionAnalysis: {
      found,
      missing,
      recommendations
    }
  }
}

/**
 * Check if a paper has a proper research question stated
 */
export function hasResearchQuestion(content: string): boolean {
  const patterns = [
    /research\s+question\s*:?\s*.+/i,
    /this\s+(study|paper|research)\s+(aims?|seeks?|investigates?|examines?)\s+/i,
    /we\s+(aim|seek|hypothesize|propose|investigate)\s+/i,
    /the\s+(purpose|objective|aim|goal)\s+of\s+this\s+(study|research)/i,
    /\?\s*$/m, // Question ending a sentence (simplistic but catches explicit questions)
  ]
  
  return patterns.some(pattern => pattern.test(content))
}

/**
 * Check if limitations are adequately discussed
 */
export function hasAdequateLimitations(content: string): boolean {
  // Check for limitations section
  const hasSection = /^#{1,3}\s*limitations?/im.test(content)
  
  // Check for inline limitations discussion
  const hasInlineDiscussion = /limitations?\s+(of|in)\s+(this|the|our)\s+(study|research|work)/i.test(content)
  
  // Check for acknowledgment of specific limitation types
  const limitationTypes = [
    /sample\s+size/i,
    /generalizab(le|ility)/i,
    /bias/i,
    /constraint/i,
    /future\s+(research|work|studies)/i,
    /could\s+not\s+(be\s+)?account/i,
    /beyond\s+the\s+scope/i,
  ]
  
  const limitationTypesFound = limitationTypes.filter(p => p.test(content)).length
  
  return hasSection || (hasInlineDiscussion && limitationTypesFound >= 2)
}

/**
 * Check if methodology is sufficiently detailed
 */
export function hasDetailedMethodology(content: string): boolean {
  // Extract methodology section
  const methodMatch = content.match(/^#{1,2}\s*method(s|ology)?([\s\S]*?)(?=^#{1,2}|$)/im)
  if (!methodMatch) return false
  
  const methodContent = methodMatch[2] || ''
  const wordCount = methodContent.split(/\s+/).filter(w => w.length > 0).length
  
  // Check for methodology components
  const components = [
    /participant|sample|subject/i,
    /data\s+collect/i,
    /procedure|protocol/i,
    /instrument|measure|questionnaire|survey/i,
    /analysis|analyz/i,
  ]
  
  const componentsFound = components.filter(p => p.test(methodContent)).length
  
  // Methodology should have reasonable length and multiple components
  return wordCount >= 200 && componentsFound >= 3
}
