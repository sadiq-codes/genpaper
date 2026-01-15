import 'server-only'
import type { SectionKey } from '@/lib/prompts/types'

export interface ReviewResult {
  section: string
  passed: boolean
  score: number // 0-100
  issues: string[]
  recommendations: string[]
  quality: {
    evidence_coverage: number
    duplication_check: number
    citation_diversity: number
  }
}



/**
 * Section Quality Reviewer (Simplified)
 * 
 * Focuses on verifiable quality metrics only:
 * - Citation count and diversity
 * - Internal duplication detection
 * - Length requirements
 * 
 * Removed: Heuristic-based checks that produce false positives
 * - Clarity keyword counting (having "therefore" doesn't mean clear writing)
 * - Scope adherence via keyword blocklists (too many false positives)
 * - Section-specific keyword requirements (cargo cult checking)
 */
export class SectionReviewer {
  
  /**
   * Review a single section for quality issues
   */
  static reviewSection(
    sectionKey: SectionKey,
    content: string,
    citations: Array<{ paperId: string; citationText: string }>,
    contextChunks: Array<{ paper_id: string; content: string }>,
    targetWords: number
  ): ReviewResult {
    const issues: string[] = []
    const recommendations: string[] = []
    
    // Basic content analysis
    const wordCount = content.split(/\s+/).length
    const citationCount = citations.length
    const distinctSources = new Set(citations.map(c => c.paperId)).size
    
    // Quality checks - only verifiable metrics
    const evidenceCoverage = this.checkEvidenceCoverage(citationCount, contextChunks.length)
    const duplicationCheck = this.checkDuplication(content)
    const citationDiversity = this.checkCitationDiversity(citations, contextChunks)
    
    // Length checks (verifiable, actionable)
    if (wordCount < targetWords * 0.6) {
      issues.push(`Section too short: ${wordCount} words (target: ${targetWords})`)
      recommendations.push('Expand with more detailed analysis and evidence')
    } else if (wordCount > targetWords * 1.5) {
      issues.push(`Section too long: ${wordCount} words (target: ${targetWords})`)
      recommendations.push('Focus content and remove redundant information')
    }
    
    // Citation checks (verifiable, actionable)
    if (citationCount < 2) {
      issues.push(`Insufficient citations: ${citationCount} (minimum: 2)`)
      recommendations.push('Add more supporting evidence from provided sources')
    }
    
    if (distinctSources < Math.min(2, contextChunks.length) && contextChunks.length >= 2) {
      issues.push(`Limited source diversity: ${distinctSources} distinct sources`)
      recommendations.push('Draw evidence from more diverse sources')
    }
    
    // Duplication check (verifiable)
    if (duplicationCheck < 60) {
      issues.push('High internal repetition detected')
      recommendations.push('Reduce redundant phrasing within the section')
    }
    
    const averageQuality = (evidenceCoverage + duplicationCheck + citationDiversity) / 3
    const passed = issues.length === 0 && averageQuality >= 60
    
    return {
      section: sectionKey,
      passed,
      score: Math.round(averageQuality),
      issues,
      recommendations,
      quality: {
        evidence_coverage: evidenceCoverage,
        duplication_check: duplicationCheck,
        citation_diversity: citationDiversity
      }
    }
  }
  
  
  /**
   * Check evidence coverage based on citation density
   */
  private static checkEvidenceCoverage(
    citationCount: number,
    availableChunks: number
  ): number {
    if (availableChunks === 0) return 50 // No chunks available, neutral score
    
    // Score based on how many available sources are being used
    const utilizationRate = citationCount / Math.max(1, availableChunks)
    
    // Good: using 30%+ of available sources
    // Okay: using 15-30%
    // Poor: using <15%
    if (utilizationRate >= 0.3) return 100
    if (utilizationRate >= 0.15) return 70
    if (utilizationRate >= 0.05) return 50
    return 30
  }
  
  /**
   * Check citation diversity - are we citing different sources or repeating the same one?
   */
  private static checkCitationDiversity(
    citations: Array<{ paperId: string }>,
    contextChunks: Array<{ paper_id: string }>
  ): number {
    if (citations.length === 0) return 30
    
    const uniqueCited = new Set(citations.map(c => c.paperId)).size
    const availableSources = new Set(contextChunks.map(c => c.paper_id)).size
    
    // Diversity = unique citations / total citations
    const diversityRatio = uniqueCited / citations.length
    
    // Coverage = unique cited / available sources
    const coverageRatio = availableSources > 0 ? uniqueCited / availableSources : 0
    
    // Weight: 60% diversity (don't repeat same source), 40% coverage (use different sources)
    return Math.round(diversityRatio * 60 + coverageRatio * 40)
  }
  
  /**
   * Check for internal duplication using n-gram overlap
   */
  private static checkDuplication(content: string): number {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20)
    if (sentences.length < 3) return 100 // Not enough content to check
    
    const nGramSize = 5
    const nGrams = new Set<string>()
    let duplicateCount = 0
    
    for (const sentence of sentences) {
      const words = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      for (let i = 0; i <= words.length - nGramSize; i++) {
        const nGram = words.slice(i, i + nGramSize).join(' ')
        if (nGrams.has(nGram)) {
          duplicateCount++
        } else {
          nGrams.add(nGram)
        }
      }
    }
    
    if (nGrams.size === 0) return 100
    
    const duplicationRate = duplicateCount / nGrams.size
    // 0% duplication = 100 score, 10% duplication = 0 score
    return Math.round(Math.max(0, 100 - (duplicationRate * 1000)))
  }
  
  /**
   * Check section distinctness - do sections repeat each other?
   */
  private static checkSectionDistinctness(
    sections: Array<{ key: SectionKey; content: string }>
  ): number {
    if (sections.length < 2) return 100
    
    let maxOverlap = 0
    
    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const overlap = this.calculateNgramOverlap(sections[i].content, sections[j].content)
        maxOverlap = Math.max(maxOverlap, overlap)
      }
    }
    
    // 0% overlap = 100 score, 20% overlap = 0 score
    return Math.round(Math.max(0, 100 - (maxOverlap * 500)))
  }
  
  /**
   * Check citation coverage across the paper
   */
  private static checkCitationCoverage(citations: Array<{ paperId: string }>): number {
    if (citations.length === 0) return 0
    
    const uniqueCitations = new Set(citations.map(c => c.paperId)).size
    
    // Score based on both diversity and breadth
    const diversityRatio = uniqueCitations / citations.length
    const breadthScore = Math.min(100, uniqueCitations * 5) // 20 unique = 100
    
    return Math.round(breadthScore * 0.6 + diversityRatio * 100 * 0.4)
  }
  
  /**
   * Calculate n-gram based overlap between two texts
   * More accurate than word-set overlap for detecting actual repetition
   */
  private static calculateNgramOverlap(text1: string, text2: string): number {
    const nGramSize = 4
    
    const getNgrams = (text: string): Set<string> => {
      const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      const ngrams = new Set<string>()
      for (let i = 0; i <= words.length - nGramSize; i++) {
        ngrams.add(words.slice(i, i + nGramSize).join(' '))
      }
      return ngrams
    }
    
    const ngrams1 = getNgrams(text1)
    const ngrams2 = getNgrams(text2)
    
    if (ngrams1.size === 0 || ngrams2.size === 0) return 0
    
    const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)))
    const smallerSet = Math.min(ngrams1.size, ngrams2.size)
    
    return intersection.size / smallerSet
  }
}
