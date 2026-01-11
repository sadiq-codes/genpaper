import { describe, it, expect } from 'vitest'
import { 
  extractCitationMarkers, 
  hasCitationMarkers,
  cleanNonCitationArtifacts,
  cleanRemainingArtifacts
} from '@/lib/citations/post-processor'

describe('Citation Post-Processor', () => {
  describe('extractCitationMarkers', () => {
    it('should extract single citation marker', () => {
      const content = 'This is a test [CITE: abc123-def456-7890].'
      const markers = extractCitationMarkers(content)
      
      expect(markers).toHaveLength(1)
      expect(markers[0].paperId).toBe('abc123-def456-7890')
      expect(markers[0].marker).toBe('[CITE: abc123-def456-7890]')
    })

    it('should extract multiple citation markers', () => {
      const content = 'First claim [CITE: abc123-def1]. Second claim [CITE: abc123-def2] [CITE: abc123-def3].'
      const markers = extractCitationMarkers(content)
      
      expect(markers).toHaveLength(3)
      expect(markers.map(m => m.paperId)).toEqual(['abc123-def1', 'abc123-def2', 'abc123-def3'])
    })

    it('should handle content with no markers', () => {
      const content = 'This is plain text with no citations.'
      const markers = extractCitationMarkers(content)
      
      expect(markers).toHaveLength(0)
    })

    it('should be case-insensitive', () => {
      const content = 'Test [cite: abc123] and [CITE: def456].'
      const markers = extractCitationMarkers(content)
      
      expect(markers).toHaveLength(2)
    })
  })

  describe('hasCitationMarkers', () => {
    it('should return true when markers exist', () => {
      expect(hasCitationMarkers('Test [CITE: abc123].')).toBe(true)
    })

    it('should return false when no markers exist', () => {
      expect(hasCitationMarkers('Plain text.')).toBe(false)
    })
  })

  describe('cleanNonCitationArtifacts', () => {
    it('should remove CONTEXT FROM markers', () => {
      const content = 'Text [CONTEXT FROM: abc123] more text.'
      const cleaned = cleanNonCitationArtifacts(content)
      
      expect(cleaned).toBe('Text  more text.')
      expect(cleaned).not.toContain('CONTEXT FROM')
    })

    it('should remove addCitation function calls', () => {
      const content = 'Text addCitation(paper_id="abc", reason="test") more.'
      const cleaned = cleanNonCitationArtifacts(content)
      
      expect(cleaned).toBe('Text  more.')
      expect(cleaned).not.toContain('addCitation')
    })

    it('should remove CITATION_N placeholders', () => {
      const content = 'Text CITATION_0 and CITATION_1 more.'
      const cleaned = cleanNonCitationArtifacts(content)
      
      expect(cleaned).toBe('Text  and  more.')
      expect(cleaned).not.toContain('CITATION_')
    })

    it('should preserve [CITE:] markers', () => {
      const content = 'Text [CITE: abc123] more.'
      const cleaned = cleanNonCitationArtifacts(content)
      
      expect(cleaned).toContain('[CITE: abc123]')
    })
  })

  describe('cleanRemainingArtifacts', () => {
    it('should remove remaining [CITE:] markers', () => {
      const content = 'Text [CITE: abc123] more.'
      const cleaned = cleanRemainingArtifacts(content)
      
      expect(cleaned).not.toContain('[CITE:')
    })

    it('should clean up extra whitespace', () => {
      const content = 'Text   with   extra   spaces.'
      const cleaned = cleanRemainingArtifacts(content)
      
      expect(cleaned).toBe('Text with extra spaces.')
    })

    it('should fix punctuation spacing', () => {
      const content = 'Text  . More  , text.'
      const cleaned = cleanRemainingArtifacts(content)
      
      expect(cleaned).toBe('Text. More, text.')
    })
  })
})
