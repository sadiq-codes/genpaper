import { describe, expect, test } from 'vitest'
import {
  deduplicatePapers,
  simpleDeduplicatePapers,
  normalizeTitle,
  normalizeDoi,
  type DeduplicatablePaper,
  type DeduplicatedPaper
} from '@/lib/search/deduplication'

describe('deduplication', () => {
  describe('normalizeTitle', () => {
    test('lowercases and strips punctuation', () => {
      expect(normalizeTitle('Machine Learning: A Survey!')).toBe('machine learning a survey')
      expect(normalizeTitle('Deep   Learning   Applications')).toBe('deep learning applications')
    })

    test('handles edge cases', () => {
      expect(normalizeTitle('')).toBe('')
      expect(normalizeTitle('   ')).toBe('')
      expect(normalizeTitle('A')).toBe('a')
    })
  })

  describe('normalizeDoi', () => {
    test('strips common prefixes', () => {
      expect(normalizeDoi('https://doi.org/10.1234/test')).toBe('10.1234/test')
      expect(normalizeDoi('http://dx.doi.org/10.1234/test')).toBe('10.1234/test')
      expect(normalizeDoi('10.1234/TEST')).toBe('10.1234/test')
    })

    test('handles null/undefined', () => {
      expect(normalizeDoi(null)).toBe(null)
      expect(normalizeDoi(undefined)).toBe(null)
      expect(normalizeDoi('')).toBe(null)
    })
  })

  describe('deduplicatePapers', () => {
    test('removes DOI duplicates', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Paper A', doi: '10.1234/a', canonical_id: '1' },
        { title: 'Different Title', doi: '10.1234/a', canonical_id: '2' }, // same DOI
        { title: 'Paper B', doi: '10.1234/b', canonical_id: '3' },
      ]

      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(2)
      expect(result.map(p => p.canonical_id)).toEqual(['1', '3'])
    })

    test('removes title duplicates from different sources', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Machine Learning Applications', doi: '10.1/a', canonical_id: '1', source: 'openalex' },
        { title: 'Machine Learning Applications', doi: '10.2/b', canonical_id: '2', source: 'crossref' },
        { title: 'Different Paper', doi: '10.3/c', canonical_id: '3', source: 'semantic_scholar' },
      ]

      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(2)
    })

    test('prefers higher citation count when deduplicating', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Same Paper', canonical_id: '1', citationCount: 10 },
        { title: 'Same Paper', canonical_id: '2', citationCount: 100 }, // higher citations
        { title: 'Same Paper', canonical_id: '3', citationCount: 50 },
      ]

      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(1)
      expect(result[0].canonical_id).toBe('2') // highest citations
    })

    test('handles papers with citation_count field instead of citationCount', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Same Paper', canonical_id: '1', citation_count: 10 },
        { title: 'Same Paper', canonical_id: '2', citation_count: 100 },
      ]

      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(1)
      expect(result[0].canonical_id).toBe('2')
    })

    test('links arXiv preprints to journal versions', () => {
      const papers: DeduplicatablePaper[] = [
        { 
          title: 'Attention Is All You Need', 
          canonical_id: 'arxiv-1',
          source: 'arxiv',
          url: 'https://arxiv.org/abs/1706.03762',
          citationCount: 50000
        },
        { 
          title: 'Attention Is All You Need', 
          canonical_id: 'journal-1',
          source: 'semantic_scholar',
          doi: '10.5555/3295222.3295349',
          citationCount: 60000
        },
      ]

      const result = deduplicatePapers(papers) as DeduplicatedPaper<DeduplicatablePaper>[]
      expect(result).toHaveLength(1)
      // Should keep journal version with preprint link
      expect(result[0].doi).toBe('10.5555/3295222.3295349')
      expect(result[0].preprint_id).toBe('https://arxiv.org/abs/1706.03762')
      expect(result[0].siblings).toContain('arxiv-1')
    })

    test('prefers journal over preprint by default', () => {
      const papers: DeduplicatablePaper[] = [
        { 
          title: 'Same Paper', 
          canonical_id: 'journal-1',
          source: 'crossref',
          doi: '10.1234/test',
          citationCount: 50
        },
        { 
          title: 'Same Paper', 
          canonical_id: 'arxiv-1',
          source: 'arxiv',
          url: 'https://arxiv.org/abs/1234.5678',
          citationCount: 100 // arXiv has higher citations but journal preferred
        },
      ]

      const result = deduplicatePapers(papers) as DeduplicatedPaper<DeduplicatablePaper>[]
      expect(result).toHaveLength(1)
      expect(result[0].source).toBe('crossref')
      expect(result[0].preprint_id).toBe('https://arxiv.org/abs/1234.5678')
    })

    test('can disable preprint linking', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Paper', canonical_id: '1', source: 'arxiv', url: 'http://arxiv.org/1' },
        { title: 'Paper', canonical_id: '2', source: 'crossref', doi: '10.1/a' },
      ]

      const result = deduplicatePapers(papers, { linkPreprints: false }) as DeduplicatedPaper<DeduplicatablePaper>[]
      expect(result).toHaveLength(1)
      expect(result[0].preprint_id).toBeUndefined()
    })

    test('handles empty array', () => {
      expect(deduplicatePapers([])).toEqual([])
    })

    test('handles single paper', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Only Paper', canonical_id: '1' }
      ]
      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Only Paper')
    })

    test('normalizes titles for comparison (punctuation, case, whitespace)', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Machine Learning: A Survey', canonical_id: '1' },
        { title: 'machine learning   a survey', canonical_id: '2' },
        { title: 'MACHINE LEARNING - A SURVEY!', canonical_id: '3' },
      ]

      const result = deduplicatePapers(papers)
      expect(result).toHaveLength(1)
    })
  })

  describe('simpleDeduplicatePapers', () => {
    test('deduplicates without citation sorting or preprint handling', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Paper A', canonical_id: '1', citationCount: 10 },
        { title: 'Paper A', canonical_id: '2', citationCount: 100 },
        { title: 'Paper B', canonical_id: '3' },
      ]

      const result = simpleDeduplicatePapers(papers)
      expect(result).toHaveLength(2)
      // Keeps first occurrence (no citation sorting)
      expect(result[0].canonical_id).toBe('1')
    })

    test('does not link preprints', () => {
      const papers: DeduplicatablePaper[] = [
        { title: 'Paper', canonical_id: '1', source: 'arxiv', url: 'http://arxiv.org/1' },
        { title: 'Paper', canonical_id: '2', source: 'crossref', doi: '10.1/a' },
      ]

      const result = simpleDeduplicatePapers(papers) as DeduplicatedPaper<DeduplicatablePaper>[]
      expect(result).toHaveLength(1)
      expect(result[0].preprint_id).toBeUndefined()
    })
  })
})
