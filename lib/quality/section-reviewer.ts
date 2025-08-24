import 'server-only'
import type { SectionKey } from '@/lib/prompts/types'

export interface ReviewResult {
  section: string
  passed: boolean
  score: number // 0-100
  issues: string[]
  recommendations: string[]
  quality: {
    clarity: number
    scope_adherence: number
    evidence_coverage: number
    duplication_check: number
  }
}

export interface PaperLevelReview {
  overall_score: number
  argument_coherence: number
  section_distinctness: number
  citation_coverage: number
  issues: string[]
  recommendations: string[]
  ready_for_submission: boolean
}

/**
 * Section Quality Reviewer
 * 
 * Provides automated quality checks for generated sections to approach reviewer-grade outputs
 */
export class SectionReviewer {
  
  /**
   * Review a single section for quality issues
   */
  static async reviewSection(
    sectionKey: SectionKey,
    content: string,
    citations: Array<{ paperId: string; citationText: string }>,
    contextChunks: Array<{ paper_id: string; content: string }>,
    targetWords: number
  ): Promise<ReviewResult> {
    const issues: string[] = []
    const recommendations: string[] = []
    
    // Basic content analysis
    const wordCount = content.split(/\s+/).length
    const citationCount = citations.length
    const distinctSources = new Set(citations.map(c => c.paperId)).size
    
    // Quality checks
    const clarity = await this.checkClarity(content)
    const scopeAdherence = await this.checkScopeAdherence(sectionKey, content)
    const evidenceCoverage = this.checkEvidenceCoverage(content, citations, contextChunks)
    const duplicationCheck = await this.checkDuplication(content)
    
    // Length checks
    if (wordCount < targetWords * 0.7) {
      issues.push(`Section too short: ${wordCount} words (target: ${targetWords})`)
      recommendations.push('Expand with more detailed analysis and evidence')
    } else if (wordCount > targetWords * 1.3) {
      issues.push(`Section too long: ${wordCount} words (target: ${targetWords})`)
      recommendations.push('Focus content and remove redundant information')
    }
    
    // Citation checks
    if (citationCount < 3) {
      issues.push(`Insufficient citations: ${citationCount} (minimum: 3)`)
      recommendations.push('Add more supporting evidence from provided sources')
    }
    
    if (distinctSources < Math.min(3, contextChunks.length)) {
      issues.push(`Limited source diversity: ${distinctSources} distinct sources`)
      recommendations.push('Draw evidence from more diverse sources')
    }
    
    // Section-specific checks
    await this.addSectionSpecificChecks(sectionKey, content, issues, recommendations)
    
    const averageQuality = (clarity + scopeAdherence + evidenceCoverage + duplicationCheck) / 4
    const passed = issues.length === 0 && averageQuality >= 70
    
    return {
      section: sectionKey,
      passed,
      score: Math.round(averageQuality),
      issues,
      recommendations,
      quality: {
        clarity,
        scope_adherence: scopeAdherence,
        evidence_coverage: evidenceCoverage,
        duplication_check: duplicationCheck
      }
    }
  }
  
  /**
   * Review paper-level coherence and argument flow
   */
  static async reviewPaperLevel(
    sections: Array<{ key: SectionKey; content: string; citations: Array<{ paperId: string }> }>,
    allCitations: Array<{ paperId: string; citationText: string }>
  ): Promise<PaperLevelReview> {
    const issues: string[] = []
    const recommendations: string[] = []
    
    // Check argument coherence across sections
    const argumentCoherence = await this.checkArgumentCoherence(sections)
    
    // Check section distinctness (overlap detection)
    const sectionDistinctness = await this.checkSectionDistinctness(sections)
    
    // Check citation coverage vs distinct sources
    const citationCoverage = this.checkCitationCoverage(allCitations)
    
    // Paper-level issues
    if (argumentCoherence < 70) {
      issues.push('Weak argument flow between sections')
      recommendations.push('Strengthen logical connections and transitions between sections')
    }
    
    if (sectionDistinctness < 70) {
      issues.push('High content overlap between sections')
      recommendations.push('Ensure each section covers distinct aspects without repetition')
    }
    
    if (citationCoverage < 70) {
      issues.push('Uneven citation distribution across sections')
      recommendations.push('Balance evidence usage across all sections')
    }
    
    const overallScore = (argumentCoherence + sectionDistinctness + citationCoverage) / 3
    const readyForSubmission = issues.length === 0 && overallScore >= 75
    
    return {
      overall_score: Math.round(overallScore),
      argument_coherence: argumentCoherence,
      section_distinctness: sectionDistinctness,
      citation_coverage: citationCoverage,
      issues,
      recommendations,
      ready_for_submission: readyForSubmission
    }
  }
  
  private static async checkClarity(content: string): Promise<number> {
    // Simple heuristics for clarity
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10)
    const avgWordsPerSentence = content.split(/\s+/).length / sentences.length
    const hasGoodStructure = content.includes('##') || content.includes('###')
    
    let score = 100
    
    // Penalize overly long sentences
    if (avgWordsPerSentence > 25) score -= 20
    
    // Reward good structure
    if (hasGoodStructure) score += 10
    
    // Check for clarity indicators
    const clarityWords = ['therefore', 'however', 'furthermore', 'in contrast', 'specifically']
    const clarityCount = clarityWords.filter(word => content.toLowerCase().includes(word)).length
    score += Math.min(20, clarityCount * 5)
    
    return Math.max(0, Math.min(100, score))
  }
  
  private static async checkScopeAdherence(sectionKey: SectionKey, content: string): Promise<number> {
    const contentLower = content.toLowerCase()
    let score = 100
    
    // Section-specific scope violations
    if (sectionKey === 'methodology') {
      if (contentLower.includes('result') || contentLower.includes('finding')) {
        score -= 30 // Methods shouldn't discuss results
      }
      if (contentLower.includes('background') || contentLower.includes('motivation')) {
        score -= 20 // Methods shouldn't repeat background
      }
    } else if (sectionKey === 'results') {
      if (contentLower.includes('interpretation') || contentLower.includes('implication')) {
        score -= 25 // Results shouldn't interpret findings
      }
    } else if (sectionKey === 'discussion') {
      if (contentLower.includes('methodology') || contentLower.includes('procedure')) {
        score -= 20 // Discussion shouldn't restate methods
      }
    }
    
    return Math.max(0, Math.min(100, score))
  }
  
  private static checkEvidenceCoverage(
    content: string,
    citations: Array<{ paperId: string; citationText: string }>,
    contextChunks: Array<{ paper_id: string; content: string }>
  ): number {
    const factualClaims = this.extractFactualClaims(content)
    const citationDensity = citations.length / Math.max(1, factualClaims)
    const sourceUtilization = citations.length / Math.max(1, contextChunks.length)
    
    // Good evidence coverage: 1 citation per 2-3 factual claims, use 30%+ of available sources
    let score = 0
    
    if (citationDensity >= 0.33) score += 50
    else if (citationDensity >= 0.2) score += 30
    else score += 10
    
    if (sourceUtilization >= 0.3) score += 50
    else if (sourceUtilization >= 0.15) score += 30
    else score += 10
    
    return Math.min(100, score)
  }
  
  private static async checkDuplication(content: string): Promise<number> {
    // Simple n-gram overlap detection
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20)
    const nGramSize = 4
    const nGrams = new Set<string>()
    let duplicateCount = 0
    
    for (const sentence of sentences) {
      const words = sentence.toLowerCase().split(/\s+/)
      for (let i = 0; i <= words.length - nGramSize; i++) {
        const nGram = words.slice(i, i + nGramSize).join(' ')
        if (nGrams.has(nGram)) {
          duplicateCount++
        } else {
          nGrams.add(nGram)
        }
      }
    }
    
    const duplicationRate = duplicateCount / Math.max(1, nGrams.size)
    const score = Math.max(0, 100 - (duplicationRate * 200))
    
    return Math.round(score)
  }
  
  private static async addSectionSpecificChecks(
    sectionKey: SectionKey,
    content: string,
    issues: string[],
    recommendations: string[]
  ): Promise<void> {
    const contentLower = content.toLowerCase()
    
    switch (sectionKey) {
      case 'introduction':
        if (!contentLower.includes('research question') && !contentLower.includes('objective')) {
          issues.push('Introduction lacks clear research questions or objectives')
          recommendations.push('Add explicit research questions and study objectives')
        }
        break
        
      case 'methodology':
        if (!contentLower.includes('procedure') && !contentLower.includes('method')) {
          issues.push('Methodology section lacks procedural details')
          recommendations.push('Include detailed methodological procedures and approaches')
        }
        break
        
      case 'results':
        if (!contentLower.includes('finding') && !contentLower.includes('result')) {
          issues.push('Results section lacks clear findings')
          recommendations.push('Present specific findings and outcomes clearly')
        }
        break
        
      case 'discussion':
        if (!contentLower.includes('limitation') && !contentLower.includes('future')) {
          issues.push('Discussion lacks limitations or future work')
          recommendations.push('Address study limitations and suggest future research directions')
        }
        break
    }
  }
  
  private static async checkArgumentCoherence(
    sections: Array<{ key: SectionKey; content: string }>
  ): Promise<number> {
    // Simple coherence check based on transition words and concept continuity
    let coherenceScore = 100
    
    for (let i = 1; i < sections.length; i++) {
      const currentContent = sections[i].content.toLowerCase()
      
      // Look for transition indicators
      const transitionWords = ['building on', 'following', 'based on', 'as shown', 'given these']
      const hasTransition = transitionWords.some(word => currentContent.includes(word))
      
      if (!hasTransition) coherenceScore -= 15
    }
    
    return Math.max(0, Math.min(100, coherenceScore))
  }
  
  private static async checkSectionDistinctness(
    sections: Array<{ key: SectionKey; content: string }>
  ): Promise<number> {
    const overlapThreshold = 0.15 // 15% overlap is concerning
    let maxOverlap = 0
    
    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const overlap = this.calculateTextOverlap(sections[i].content, sections[j].content)
        maxOverlap = Math.max(maxOverlap, overlap)
      }
    }
    
    if (maxOverlap > overlapThreshold) {
      const score = Math.max(0, 100 - (maxOverlap * 500)) // Heavy penalty for overlap
      return Math.round(score)
    }
    
    return 100
  }
  
  private static checkCitationCoverage(citations: Array<{ paperId: string }>): number {
    const citationsPerSection = citations.length / 5 // Assume ~5 sections
    return Math.min(100, citationsPerSection * 20) // 5 citations per section = 100%
  }
  
  private static extractFactualClaims(content: string): number {
    // Simple heuristic: sentences with numbers, specific terms, or research findings
    const sentences = content.split(/[.!?]+/)
    const factualSentences = sentences.filter(s => 
      /\b\d+%?\b/.test(s) || // Contains numbers
      /\b(found|showed|demonstrated|indicated|revealed)\b/i.test(s) || // Research verbs
      /\b(significant|correlation|effect|impact)\b/i.test(s) // Research terms
    )
    return factualSentences.length
  }
  
  private static calculateTextOverlap(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    
    return union.size > 0 ? intersection.size / union.size : 0
  }
}
