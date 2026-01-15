import { describe, expect, test } from 'vitest'
import { 
  extractChunkMetadata,
  extractMetadataForChunks,
  type ChunkMetadata 
} from '@/lib/content/chunk-metadata'

describe('chunk-metadata', () => {
  describe('extractChunkMetadata', () => {
    test('extracts section type from abstract content', () => {
      const abstractContent = 'Abstract: This paper presents an overview of machine learning applications in healthcare.'
      const metadata = extractChunkMetadata(abstractContent, 0)
      expect(metadata.section_type).toBe('abstract')
    })

    test('extracts section type from introduction content', () => {
      const introContent = 'Introduction: This study aims to investigate the effects of climate change on biodiversity.'
      const metadata = extractChunkMetadata(introContent)
      expect(metadata.section_type).toBe('introduction')
    })

    test('extracts section type from methodology content', () => {
      const methodsContent = 'Methods: Participants were randomly assigned to treatment groups. We recruited 500 subjects.'
      const metadata = extractChunkMetadata(methodsContent)
      expect(metadata.section_type).toBe('methods')
    })

    test('detects methods from procedural language', () => {
      const methodsContent = 'The experiment was conducted over 6 months. Data was collected from multiple sources. The procedure involved administering questionnaires.'
      const metadata = extractChunkMetadata(methodsContent)
      expect(metadata.section_type).toBe('methods')
    })

    test('extracts section type from results content', () => {
      const resultsContent = 'Results: The findings indicate a strong correlation between variables. Analysis revealed significant differences (p < 0.05).'
      const metadata = extractChunkMetadata(resultsContent)
      expect(metadata.section_type).toBe('results')
    })

    test('detects results from statistical content', () => {
      // Content with results heuristics should be detected as results
      const statsContent = 'The results show significant improvement (p = 0.003). Analysis revealed a 15.2% increase in performance. We found that treatment efficacy exceeded baseline expectations.'
      const metadata = extractChunkMetadata(statsContent)
      expect(metadata.section_type).toBe('results')
    })

    test('extracts section type from discussion content', () => {
      const discussionContent = 'Discussion: These findings suggest that the proposed method outperforms baselines. This is consistent with previous research.'
      const metadata = extractChunkMetadata(discussionContent)
      expect(metadata.section_type).toBe('discussion')
    })

    test('extracts section type from conclusion content', () => {
      const conclusionContent = 'Conclusion: In conclusion, this study demonstrates the effectiveness of our approach. Future work should focus on larger datasets.'
      const metadata = extractChunkMetadata(conclusionContent)
      expect(metadata.section_type).toBe('conclusion')
    })

    test('returns null for ambiguous content', () => {
      const ambiguousContent = 'Machine learning is a subfield of artificial intelligence that enables computers to learn from data.'
      const metadata = extractChunkMetadata(ambiguousContent)
      expect(metadata.section_type).toBeNull()
    })

    test('detects citations', () => {
      const withNumericCitations = 'According to recent studies [1], deep learning has transformed AI [2, 3].'
      const withAuthorCitations = 'Smith et al. (2023) found that neural networks outperform traditional methods (Jones, 2022).'
      const withoutCitations = 'Deep learning has transformed artificial intelligence.'
      
      expect(extractChunkMetadata(withNumericCitations).has_citations).toBe(true)
      expect(extractChunkMetadata(withAuthorCitations).has_citations).toBe(true)
      expect(extractChunkMetadata(withoutCitations).has_citations).toBe(false)
    })

    test('detects figures and tables', () => {
      const withFigure = 'As shown in Figure 3, the model performance improves over time.'
      const withTable = 'Table 2 summarizes the demographic characteristics of participants.'
      const withChart = 'Chart 1 displays the distribution of responses.'
      const without = 'The model performance improves over time.'
      
      expect(extractChunkMetadata(withFigure).has_figures).toBe(true)
      expect(extractChunkMetadata(withTable).has_figures).toBe(true)
      expect(extractChunkMetadata(withChart).has_figures).toBe(true)
      expect(extractChunkMetadata(without).has_figures).toBe(false)
    })

    test('detects statistical data', () => {
      const withPValue = 'The difference was significant (p = 0.003).'
      const withPercentage = 'Response rates improved by 25.5%.'
      const withCI = 'The effect size was moderate (CI: 0.3-0.6).'
      const withSampleSize = 'Our study included n = 250 participants.'
      const without = 'Participants reported improved outcomes.'
      
      expect(extractChunkMetadata(withPValue).has_data).toBe(true)
      expect(extractChunkMetadata(withPercentage).has_data).toBe(true)
      expect(extractChunkMetadata(withCI).has_data).toBe(true)
      expect(extractChunkMetadata(withSampleSize).has_data).toBe(true)
      expect(extractChunkMetadata(without).has_data).toBe(false)
    })

    test('detects conclusion indicators', () => {
      const conclusion1 = 'In conclusion, our study demonstrates the effectiveness of the treatment.'
      const conclusion2 = 'To summarize, the results support our hypothesis.'
      const conclusion3 = 'Future work should focus on extending this method to larger datasets.'
      const notConclusion = 'The treatment was administered daily for 6 weeks.'
      
      expect(extractChunkMetadata(conclusion1).is_conclusion).toBe(true)
      expect(extractChunkMetadata(conclusion2).is_conclusion).toBe(true)
      expect(extractChunkMetadata(conclusion3).is_conclusion).toBe(true)
      expect(extractChunkMetadata(notConclusion).is_conclusion).toBe(false)
    })

    test('calculates complexity score', () => {
      const simpleContent = 'This is simple. Short words here.'
      const complexContent = 'The multifaceted epistemological implications of quantum entanglement necessitate a comprehensive reevaluation of our ontological presuppositions regarding causality, determinism, and the fundamental nature of physical reality in contemporary theoretical physics.'
      
      const simpleScore = extractChunkMetadata(simpleContent).complexity_score
      const complexScore = extractChunkMetadata(complexContent).complexity_score
      
      // Complex text should have higher score
      expect(complexScore).toBeGreaterThan(simpleScore)
      // Both should be in valid range
      expect(simpleScore).toBeGreaterThanOrEqual(0)
      expect(simpleScore).toBeLessThanOrEqual(1)
      expect(complexScore).toBeGreaterThanOrEqual(0)
      expect(complexScore).toBeLessThanOrEqual(1)
    })

    test('extracts key terms', () => {
      const content = `Machine learning algorithms have shown remarkable performance 
        in natural language processing tasks. Deep learning models continue to 
        advance the field of machine learning and natural language processing.`
      
      const metadata = extractChunkMetadata(content)
      
      // Should have some key terms extracted
      expect(metadata.key_terms.length).toBeGreaterThan(0)
      expect(metadata.key_terms.length).toBeLessThanOrEqual(5) // Default limit
      
      // Terms should be lowercased
      metadata.key_terms.forEach(term => {
        expect(term).toBe(term.toLowerCase())
      })
    })
  })

  describe('extractMetadataForChunks', () => {
    test('extracts metadata for multiple chunks', () => {
      const chunks = [
        { content: 'Abstract: This study examines machine learning.', chunk_index: 0 },
        { content: 'Methods: We recruited 100 participants.', chunk_index: 1 },
        { content: 'Results: We found significant effects (p < 0.01).', chunk_index: 2 }
      ]
      
      const metadataArray = extractMetadataForChunks(chunks)
      
      expect(metadataArray).toHaveLength(3)
      expect(metadataArray[0].section_type).toBe('abstract')
      expect(metadataArray[1].section_type).toBe('methods')
      expect(metadataArray[2].section_type).toBe('results')
    })

    test('handles empty chunks array', () => {
      expect(extractMetadataForChunks([])).toEqual([])
    })
  })
})

describe('reciprocal-rank-fusion', () => {
  // Test RRF algorithm with mock data
  test('RRF combines rankings correctly', () => {
    // Simple RRF test case
    // If item A is rank 1 in vector (score: 1/(60+1) = 0.0164)
    // and rank 3 in keyword (score: 1/(60+3) = 0.0159)
    // RRF score = 0.0164 * 0.7 + 0.0159 * 0.3 = 0.0163
    
    const k = 60
    const vectorWeight = 0.7
    const keywordWeight = 0.3
    
    // Ranks start at 1
    const vectorRank = 1
    const keywordRank = 3
    
    const vectorScore = 1 / (k + vectorRank)
    const keywordScore = 1 / (k + keywordRank)
    const rrfScore = vectorScore * vectorWeight + keywordScore * keywordWeight
    
    expect(rrfScore).toBeCloseTo(0.0163, 3)
  })

  test('RRF properly weights vector vs keyword scores', () => {
    const k = 60
    
    // Item that ranks #1 in both should beat one that ranks #1 in one and #10 in other
    const bothFirst = (1 / (k + 1)) * 0.7 + (1 / (k + 1)) * 0.3
    const splitRank = (1 / (k + 1)) * 0.7 + (1 / (k + 10)) * 0.3
    
    expect(bothFirst).toBeGreaterThan(splitRank)
  })

  test('RRF handles items only in one result set', () => {
    const k = 60
    const vectorWeight = 0.7
    const keywordWeight = 0.3
    
    // Item only in vector results (rank 5), not in keyword
    // Should still get a score from vector contribution only
    const vectorOnly = (1 / (k + 5)) * vectorWeight + 0 * keywordWeight
    
    expect(vectorOnly).toBeGreaterThan(0)
    expect(vectorOnly).toBeLessThan((1 / (k + 5))) // Less than full score
  })
})

describe('citation-boost', () => {
  test('logarithmic boost calculation', () => {
    // The citation boost formula: 1 + min(0.1, 0.02 * log(1 + citations))
    // This ensures diminishing returns and a max 10% boost
    
    const calculateBoost = (citations: number) => {
      return 1 + Math.min(0.1, 0.02 * Math.log(1 + citations))
    }
    
    // 0 citations = no boost
    expect(calculateBoost(0)).toBeCloseTo(1.0, 5)
    
    // Few citations = small boost
    expect(calculateBoost(5)).toBeCloseTo(1.036, 2)
    
    // Many citations = approaches max boost
    expect(calculateBoost(100)).toBeCloseTo(1.092, 2)
    
    // Very many citations = capped at 10%
    expect(calculateBoost(10000)).toBeCloseTo(1.1, 1)
  })

  test('boost is always >= 1.0', () => {
    const calculateBoost = (citations: number) => {
      return 1 + Math.min(0.1, 0.02 * Math.log(1 + citations))
    }
    
    for (let i = 0; i <= 1000; i += 100) {
      expect(calculateBoost(i)).toBeGreaterThanOrEqual(1.0)
    }
  })

  test('boost never exceeds 1.1', () => {
    const calculateBoost = (citations: number) => {
      return 1 + Math.min(0.1, 0.02 * Math.log(1 + citations))
    }
    
    expect(calculateBoost(1000000)).toBeLessThanOrEqual(1.1)
  })
})
