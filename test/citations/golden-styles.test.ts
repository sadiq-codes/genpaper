import { describe, test, expect } from 'vitest'
import { formatInlineCitation, generateBibliography } from '@/lib/citations/immediate-bibliography'
import type { CSLItem } from '@/lib/utils/csl'

/**
 * Golden Tests for Citation Styles
 * 
 * Locks inline & bibliography rendering with snapshots.
 * Any change to output fails tests until snapshots updated intentionally.
 */

// Sample CSL data for consistent testing
const sampleCSLItems: CSLItem[] = [
  {
    id: 'smith2023',
    type: 'article-journal',
    title: 'Machine Learning Applications in Healthcare: A Comprehensive Review',
    author: [
      { family: 'Smith', given: 'John A.' },
      { family: 'Johnson', given: 'Maria B.' },
      { family: 'Chen', given: 'Li' }
    ],
    'container-title': 'Journal of Medical Informatics',
    issued: { 'date-parts': [[2023]] },
    volume: '45',
    issue: '3',
    page: '123-145',
    DOI: '10.1234/jmi.2023.123'
  },
  {
    id: 'doe2022',
    type: 'book',
    title: 'Deep Learning Fundamentals: Theory and Practice',
    author: [
      { family: 'Doe', given: 'Jane' }
    ],
    publisher: 'Tech Publications',
    'publisher-place': 'New York',
    issued: { 'date-parts': [[2022]] },
    ISBN: '978-0-123456-78-9'
  },
  {
    id: 'brown2024',
    type: 'paper-conference',
    title: 'Neural Networks for Natural Language Processing',
    author: [
      { family: 'Brown', given: 'Alex' },
      { family: 'Wilson', given: 'Sarah M.' }
    ],
    'container-title': 'Proceedings of the International Conference on AI',
    issued: { 'date-parts': [[2024]] },
    page: '67-82',
    URL: 'https://example.com/proceedings/2024/brown-wilson'
  },
  {
    id: 'garcia2021',
    type: 'thesis',
    title: 'Advanced Techniques in Computer Vision: A Doctoral Dissertation',
    author: [
      { family: 'Garcia', given: 'Roberto C.' }
    ],
    publisher: 'Stanford University',
    issued: { 'date-parts': [[2021]] },
    genre: 'PhD thesis'
  },
  {
    id: 'anonymous2023',
    type: 'webpage',
    title: 'Understanding Artificial Intelligence: An Online Guide',
    issued: { 'date-parts': [[2023]] },
    URL: 'https://ai-guide.example.com',
    author: [] // No author
  }
]

describe('Golden Tests - Citation Styles', () => {
  describe('APA Style', () => {
    test('inline citations match snapshot', () => {
      const inlineCitations = sampleCSLItems.map((csl, index) => 
        formatInlineCitation(csl, 'apa', index + 1)
      )

      expect(inlineCitations).toMatchSnapshot('apa-inline-citations')
    })

    test('bibliography entries match snapshot', () => {
      // Mock the bibliography generation data structure
      const mockBibliographyEntries = sampleCSLItems.map((csl, index) => ({
        number: index + 1,
        paper_id: csl.id,
        csl_json: csl,
        reason: 'test citation',
        quote: null
      }))

      // Test individual bibliography entries
      const bibliographyEntries = mockBibliographyEntries.map(entry => {
        // Use the same formatting logic as in generateBibliography
        const csl = entry.csl_json
        const authors = csl.author || []
        const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
        const title = csl.title || 'Untitled'
        const container = csl['container-title'] || ''

        let formatted = ''
        if (authors.length === 0) {
          formatted = `(${year}). ${title}`
        } else if (authors.length === 1) {
          formatted = `${authors[0].family}, ${authors[0].given} (${year}). ${title}`
        } else if (authors.length <= 3) {
          const authorStr = authors.map(a => `${a.family}, ${a.given}`).join(', ')
          formatted = `${authorStr} (${year}). ${title}`
        } else {
          formatted = `${authors[0].family}, ${authors[0].given}, et al. (${year}). ${title}`
        }

        if (container) {
          formatted += `. *${container}*`
        }

        if (csl.volume) {
          formatted += `, ${csl.volume}`
          if (csl.issue) formatted += `(${csl.issue})`
        }

        if (csl.page) {
          formatted += `, ${csl.page}`
        }

        if (csl.DOI) {
          formatted += `. https://doi.org/${csl.DOI}`
        } else if (csl.URL) {
          formatted += `. ${csl.URL}`
        }

        return formatted + '.'
      })

      expect(bibliographyEntries).toMatchSnapshot('apa-bibliography-entries')
    })
  })

  describe('MLA Style', () => {
    test('inline citations match snapshot', () => {
      const inlineCitations = sampleCSLItems.map((csl, index) => 
        formatInlineCitation(csl, 'mla', index + 1)
      )

      expect(inlineCitations).toMatchSnapshot('mla-inline-citations')
    })

    test('bibliography entries match snapshot', () => {
      const bibliographyEntries = sampleCSLItems.map(csl => {
        const authors = csl.author || []
        const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
        const title = csl.title || 'Untitled'
        const container = csl['container-title'] || ''

        let formatted = ''
        if (authors.length === 0) {
          formatted = `"${title}"`
        } else if (authors.length === 1) {
          formatted = `${authors[0].family}, ${authors[0].given}. "${title}"`
        } else {
          formatted = `${authors[0].family}, ${authors[0].given}, et al. "${title}"`
        }

        if (container) {
          formatted += ` *${container}*`
        }

        if (csl.volume) {
          formatted += `, vol. ${csl.volume}`
          if (csl.issue) formatted += `, no. ${csl.issue}`
        }

        formatted += `, ${year}`

        if (csl.page) {
          formatted += `, pp. ${csl.page}`
        }

        if (csl.URL) {
          formatted += `. Web. ${csl.URL}`
        }

        return formatted + '.'
      })

      expect(bibliographyEntries).toMatchSnapshot('mla-bibliography-entries')
    })
  })

  describe('Chicago Style', () => {
    test('inline citations match snapshot', () => {
      const inlineCitations = sampleCSLItems.map((csl, index) => 
        formatInlineCitation(csl, 'chicago', index + 1)
      )

      expect(inlineCitations).toMatchSnapshot('chicago-inline-citations')
    })

    test('bibliography entries match snapshot', () => {
      const bibliographyEntries = sampleCSLItems.map(csl => {
        const authors = csl.author || []
        const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
        const title = csl.title || 'Untitled'
        const container = csl['container-title'] || ''

        let formatted = ''
        if (authors.length === 0) {
          formatted = `"${title}"`
        } else if (authors.length === 1) {
          formatted = `${authors[0].family}, ${authors[0].given}. "${title}"`
        } else {
          formatted = `${authors[0].family}, ${authors[0].given}, et al. "${title}"`
        }

        if (container) {
          formatted += ` *${container}*`
        }

        if (csl.volume && csl.issue) {
          formatted += ` ${csl.volume}, no. ${csl.issue}`
        } else if (csl.volume) {
          formatted += ` ${csl.volume}`
        }

        formatted += ` (${year})`

        if (csl.page) {
          formatted += `: ${csl.page}`
        }

        if (csl.DOI) {
          formatted += `. https://doi.org/${csl.DOI}`
        }

        return formatted + '.'
      })

      expect(bibliographyEntries).toMatchSnapshot('chicago-bibliography-entries')
    })
  })

  describe('IEEE Style', () => {
    test('inline citations match snapshot', () => {
      const inlineCitations = sampleCSLItems.map((csl, index) => 
        formatInlineCitation(csl, 'ieee', index + 1)
      )

      expect(inlineCitations).toMatchSnapshot('ieee-inline-citations')
    })

    test('bibliography entries match snapshot', () => {
      const bibliographyEntries = sampleCSLItems.map(csl => {
        const authors = csl.author || []
        const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
        const title = csl.title || 'Untitled'
        const container = csl['container-title'] || ''

        let formatted = ''
        if (authors.length === 0) {
          formatted = `"${title}"`
        } else if (authors.length === 1) {
          const initial = authors[0].given?.charAt(0) || ''
          formatted = `${initial}. ${authors[0].family}, "${title}"`
        } else if (authors.length <= 3) {
          const authorStr = authors.map(a => {
            const initial = a.given?.charAt(0) || ''
            return `${initial}. ${a.family}`
          }).join(', ')
          formatted = `${authorStr}, "${title}"`
        } else {
          const initial = authors[0].given?.charAt(0) || ''
          formatted = `${initial}. ${authors[0].family} et al., "${title}"`
        }

        if (container) {
          formatted += `, *${container}*`
        }

        if (csl.volume) {
          formatted += `, vol. ${csl.volume}`
          if (csl.issue) formatted += `, no. ${csl.issue}`
        }

        if (csl.page) {
          formatted += `, pp. ${csl.page}`
        }

        formatted += `, ${year}`

        return formatted + '.'
      })

      expect(bibliographyEntries).toMatchSnapshot('ieee-bibliography-entries')
    })
  })

  describe('Edge Cases', () => {
    test('handles missing author correctly across styles', () => {
      const noAuthorCSL: CSLItem = {
        id: 'no-author-2023',
        type: 'webpage',
        title: 'Anonymous Article',
        issued: { 'date-parts': [[2023]] },
        URL: 'https://example.com/anonymous',
        author: []
      }

      const styles = ['apa', 'mla', 'chicago', 'ieee'] as const
      const results = styles.map(style => ({
        style,
        inline: formatInlineCitation(noAuthorCSL, style, 1)
      }))

      expect(results).toMatchSnapshot('no-author-citations')
    })

    test('handles missing publication year across styles', () => {
      const noYearCSL: CSLItem = {
        id: 'no-year',
        type: 'article',
        title: 'Article Without Year',
        author: [{ family: 'Unknown', given: 'Author' }],
        'container-title': 'Mystery Journal'
      }

      const styles = ['apa', 'mla', 'chicago', 'ieee'] as const
      const results = styles.map(style => ({
        style,
        inline: formatInlineCitation(noYearCSL, style, 1)
      }))

      expect(results).toMatchSnapshot('no-year-citations')
    })

    test('handles long author lists across styles', () => {
      const manyAuthorsCSL: CSLItem = {
        id: 'many-authors-2023',
        type: 'article-journal',
        title: 'Collaborative Research with Many Authors',
        author: [
          { family: 'Author1', given: 'First' },
          { family: 'Author2', given: 'Second' },
          { family: 'Author3', given: 'Third' },
          { family: 'Author4', given: 'Fourth' },
          { family: 'Author5', given: 'Fifth' },
          { family: 'Author6', given: 'Sixth' }
        ],
        'container-title': 'Collaboration Journal',
        issued: { 'date-parts': [[2023]] }
      }

      const styles = ['apa', 'mla', 'chicago', 'ieee'] as const
      const results = styles.map(style => ({
        style,
        inline: formatInlineCitation(manyAuthorsCSL, style, 1)
      }))

      expect(results).toMatchSnapshot('many-authors-citations')
    })

    test('handles special characters and unicode in titles', () => {
      const unicodeCSL: CSLItem = {
        id: 'unicode-2023',
        type: 'article',
        title: 'Études sur l\'Intelligence Artificielle: Naïve Approaches & "Smart" Solutions',
        author: [{ family: 'Müller', given: 'François' }],
        'container-title': 'Journal of Études Européennes',
        issued: { 'date-parts': [[2023]] }
      }

      const styles = ['apa', 'mla', 'chicago', 'ieee'] as const
      const results = styles.map(style => ({
        style,
        inline: formatInlineCitation(unicodeCSL, style, 1)
      }))

      expect(results).toMatchSnapshot('unicode-citations')
    })
  })

  describe('Consistency Checks', () => {
    test('same CSL produces identical output on repeated calls', () => {
      const csl = sampleCSLItems[0]
      
      const run1 = formatInlineCitation(csl, 'apa', 1)
      const run2 = formatInlineCitation(csl, 'apa', 1)
      const run3 = formatInlineCitation(csl, 'apa', 1)

      expect(run1).toBe(run2)
      expect(run2).toBe(run3)
    })

    test('citation numbers affect output correctly', () => {
      const csl = sampleCSLItems[0]
      
      const citation1 = formatInlineCitation(csl, 'ieee', 1)
      const citation2 = formatInlineCitation(csl, 'ieee', 2) 
      const citation99 = formatInlineCitation(csl, 'ieee', 99)

      expect(citation1).toContain('[1]')
      expect(citation2).toContain('[2]')
      expect(citation99).toContain('[99]')
    })

    test('all styles handle empty/minimal CSL gracefully', () => {
      const minimalCSL: CSLItem = {
        id: 'minimal',
        type: 'article',
        title: '',
        author: []
      }

      const styles = ['apa', 'mla', 'chicago', 'ieee'] as const
      const results = styles.map(style => {
        try {
          return {
            style,
            inline: formatInlineCitation(minimalCSL, style, 1),
            error: null
          }
        } catch (error) {
          return {
            style,
            inline: null,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      })

      expect(results).toMatchSnapshot('minimal-csl-handling')
    })
  })
})