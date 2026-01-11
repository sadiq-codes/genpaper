import { describe, expect, test } from 'vitest'
import { 
  normalizeTitle, 
  levenshteinDistance, 
  isTitleMatch, 
  findBestTitleMatch,
  type PaperCandidate 
} from '@/lib/utils/fuzzy-matching'

describe('fuzzy-matching', () => {
  describe('normalizeTitle', () => {
    test('strips punctuation and normalizes whitespace', () => {
      expect(normalizeTitle('The Quick-Brown Fox!')).toBe('the quick brown fox')
      expect(normalizeTitle('A  Study:  Of   Things')).toBe('a study of things')
      expect(normalizeTitle('Machine Learning (ML) Applications')).toBe('machine learning ml applications')
    })

    test('handles empty and short strings', () => {
      expect(normalizeTitle('')).toBe('')
      expect(normalizeTitle('A')).toBe('a')
      expect(normalizeTitle('  ')).toBe('')
    })
  })

  describe('levenshteinDistance', () => {
    test('calculates edit distance correctly', () => {
      expect(levenshteinDistance('cat', 'bat')).toBe(1)
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3)
      expect(levenshteinDistance('identical', 'identical')).toBe(0)
      expect(levenshteinDistance('', 'abc')).toBe(3)
      expect(levenshteinDistance('abc', '')).toBe(3)
    })
  })

  describe('isTitleMatch', () => {
    test('matches near-duplicates', () => {
      // Test fixtures: near-duplicates should collapse
      expect(isTitleMatch(
        'Machine Learning Applications in Healthcare',
        'Machine Learning Applications in Health Care'
      )).toBe(true)

      expect(isTitleMatch(
        'Deep Neural Networks for Classification',
        'Deep Neural Networks for Clasification' // typo
      )).toBe(true)

      expect(isTitleMatch(
        'A Study of Natural Language Processing',
        'Study of Natural Language Processing' // missing article
      )).toBe(true)
    })

    test('rejects different works', () => {
      // Test fixtures: different works should not match
      expect(isTitleMatch(
        'Machine Learning Applications in Healthcare',
        'Computer Vision in Medical Imaging'
      )).toBe(false)

      expect(isTitleMatch(
        'Quantum Computing Algorithms',
        'Classical Computing Methods'
      )).toBe(false)

      expect(isTitleMatch(
        'Short Title',
        'Completely Different and Much Longer Title'
      )).toBe(false)
    })

    test('handles exact matches', () => {
      const title = 'Deep Learning for Natural Language Processing'
      expect(isTitleMatch(title, title)).toBe(true)
    })

    test('respects custom thresholds', () => {
      expect(isTitleMatch(
        'abc', 'xyz', 
        { threshold: 0 }
      )).toBe(false)

      expect(isTitleMatch(
        'abc', 'abx', 
        { threshold: 1 }
      )).toBe(true)
    })
  })

  describe('findBestTitleMatch', () => {
    const candidates: PaperCandidate[] = [
      { id: '1', title: 'Machine Learning Applications in Healthcare', year: 2023 },
      { id: '2', title: 'Machine Learning Applications in Health Care', year: 2023 }, // near-duplicate
      { id: '3', title: 'Computer Vision in Medical Imaging', year: 2022 },
      { id: '4', title: 'Deep Learning for Natural Language Processing', year: 2021 },
      { id: '5', title: 'Quantum Computing Algorithms', year: 2023 }
    ]

    test('finds best match with year preference', () => {
      const result = findBestTitleMatch(
        'Machine Learning Applications in Healthcare',
        2023,
        candidates
      )

      expect(result).toBeTruthy()
      expect(result!.paper.id).toBe('1') // Exact match
      expect(result!.yearMatch).toBe(true)
      expect(result!.distance).toBe(0)
    })

    test('prefers library papers on tie', () => {
      // Create a true tie scenario - two papers with same distance
      const tieCandidates: PaperCandidate[] = [
        { id: '1', title: 'Machine Learning Applications in Healthcare', year: 2023 },
        { id: '2', title: 'Machine Learning Applications in Health Care', year: 2023 }, // near-duplicate, same distance
        { id: '3', title: 'Computer Vision in Medical Imaging', year: 2022 }
      ]
      
      const preferredIds = new Set(['2']) // Prefer the library paper
      
      const result = findBestTitleMatch(
        'Machine Learning Applications in Health Care', // Match the preferred one exactly
        2023,
        tieCandidates,
        { preferredIds }
      )

      expect(result).toBeTruthy()
      expect(result!.paper.id).toBe('2') // Should pick preferred paper
    })

    test('library preference only applies on actual ties', () => {
      const preferredIds = new Set(['3']) // Prefer non-matching paper
      
      const result = findBestTitleMatch(
        'Machine Learning Applications in Healthcare',
        2023,
        candidates,
        { preferredIds }
      )

      expect(result).toBeTruthy()
      expect(result!.paper.id).toBe('1') // Should still pick best match
    })

    test('applies year bonus correctly', () => {
      const result = findBestTitleMatch(
        'Machine Learning Applications in Health Care', // slight difference
        2023,
        candidates,
        { threshold: 1, yearBonus: 2 }
      )

      expect(result).toBeTruthy()
      expect(result!.paper.id).toBe('2')
      expect(result!.yearMatch).toBe(true)
    })

    test('returns null for no matches', () => {
      const result = findBestTitleMatch(
        'Completely Unrelated Topic',
        2023,
        candidates
      )

      expect(result).toBeNull()
    })
  })

})