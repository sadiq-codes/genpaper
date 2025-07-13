/**
 * Immediate Bibliography Service
 * 
 * Replaces the complex hydration system with direct bibliography generation
 * from the unified citations table. No post-processing needed!
 */

import { getSB } from '@/lib/supabase/server'

// Simple CSL-JSON type for bibliography formatting
interface CSLAuthor {
  family?: string
  given?: string
  literal?: string
}

interface CSLDate {
  'date-parts'?: number[][]
}

interface CSLData {
  title?: string
  author?: CSLAuthor[]
  issued?: CSLDate
  'container-title'?: string
  DOI?: string
  URL?: string
}

export interface CitationBibliographyEntry {
  number: number
  paper_id: string
  csl_json: CSLData
  reason: string
  quote?: string
}

export interface BibliographyResult {
  bibliography: string
  citations: CitationBibliographyEntry[]
  count: number
}

// 🎯 BIBLIOGRAPHY STYLES - simplified and direct
const BIBLIOGRAPHY_STYLES = {
  apa: {
    name: 'APA 7th Edition',
    format: (entry: CitationBibliographyEntry) => {
      const csl = entry.csl_json
      const authors = formatAuthorsAPA(csl.author || [])
      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
      const title = csl.title || 'No title'
      const journal = csl['container-title'] || ''
      const doi = csl.DOI ? ` https://doi.org/${csl.DOI}` : ''
      const url = !csl.DOI && csl.URL ? ` Retrieved from ${csl.URL}` : ''
      
      if (journal) {
        return `${authors} (${year}). ${title}. *${journal}*.${doi}${url}`
      }
      return `${authors} (${year}). ${title}.${doi}${url}`
    }
  },
  
  mla: {
    name: 'MLA 9th Edition',
    format: (entry: CitationBibliographyEntry) => {
      const csl = entry.csl_json
      const authors = formatAuthorsMLA(csl.author || [])
      const title = `"${csl.title || 'No title'}"`
      const journal = csl['container-title'] ? `*${csl['container-title']}*` : ''
      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
      const doi = csl.DOI ? `, doi:${csl.DOI}` : ''
      const url = !csl.DOI && csl.URL ? `, ${csl.URL}` : ''
      
      return `${authors}. ${title} ${journal}, ${year}${doi}${url}.`
    }
  },
  
  chicago: {
    name: 'Chicago Author-Date',
    format: (entry: CitationBibliographyEntry) => {
      const csl = entry.csl_json
      const authors = formatAuthorsChicago(csl.author || [])
      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
      const title = `"${csl.title || 'No title'}"`
      const journal = csl['container-title'] ? ` *${csl['container-title']}*` : ''
      const doi = csl.DOI ? ` https://doi.org/${csl.DOI}` : ''
      const url = !csl.DOI && csl.URL ? ` ${csl.URL}` : ''
      
      return `${authors}. ${year}. ${title}.${journal}.${doi}${url}`
    }
  },
  
  ieee: {
    name: 'IEEE',
    format: (entry: CitationBibliographyEntry) => {
      const csl = entry.csl_json
      const authors = formatAuthorsIEEE(csl.author || [])
      const title = `"${csl.title || 'No title'}"`
      const journal = csl['container-title'] ? ` *${csl['container-title']}*` : ''
      const year = csl.issued?.['date-parts']?.[0]?.[0] || 'n.d.'
      const doi = csl.DOI ? `, doi: ${csl.DOI}` : ''
      const url = !csl.DOI && csl.URL ? `, [Online]. Available: ${csl.URL}` : ''
      
      return `[${entry.number}] ${authors}, ${title}${journal}, ${year}${doi}${url}.`
    }
  }
} as const

// Author formatting helpers (simplified versions)
function formatAuthorsAPA(authors: CSLAuthor[]): string {
  if (authors.length === 0) return 'Anonymous'
  
  const names = authors.map(a => {
    const family = a.family || a.literal || 'Unknown'
    const given = a.given || ''
    return given ? `${family}, ${given.charAt(0)}.` : family
  })
  
  if (names.length === 1) return names[0]
  if (names.length <= 20) {
    return names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1]
  }
  return names.slice(0, 19).join(', ') + ', ... ' + names[names.length - 1]
}

function formatAuthorsMLA(authors: CSLAuthor[]): string {
  if (authors.length === 0) return 'Anonymous'
  
  const first = authors[0]
  const family = first.family || first.literal || 'Unknown'
  const given = first.given || ''
  const firstFormatted = given ? `${family}, ${given}` : family
  
  if (authors.length === 1) return firstFormatted
  if (authors.length === 2) {
    const second = authors[1]
    const secondName = second.given ? `${second.given} ${second.family || second.literal}` : (second.family || second.literal || 'Unknown')
    return `${firstFormatted}, and ${secondName}`
  }
  return `${firstFormatted}, et al.`
}

function formatAuthorsChicago(authors: CSLAuthor[]): string {
  if (authors.length === 0) return 'Anonymous'
  
  const first = authors[0]
  const family = first.family || first.literal || 'Unknown'
  const given = first.given || ''
  return given ? `${family}, ${given}` : family
}

function formatAuthorsIEEE(authors: CSLAuthor[]): string {
  if (authors.length === 0) return 'Anonymous'
  
  const names = authors.map(a => {
    const family = a.family || a.literal || 'Unknown'
    const given = a.given || ''
    return given ? `${given.split(' ').map((n: string) => n.charAt(0)).join('. ')}. ${family}` : family
  })
  
  if (names.length <= 3) return names.join(', ')
  return `${names[0]} et al.`
}

/**
 * 🚀 IMMEDIATE BIBLIOGRAPHY GENERATION
 * No hydration needed - generates directly from citations table
 */
export async function generateBibliography(
  projectId: string,
  style: keyof typeof BIBLIOGRAPHY_STYLES = 'apa'
): Promise<BibliographyResult> {
  const supabase = await getSB()
  
  // Get all citations for project from unified table
  const { data: citations, error } = await supabase
    .rpc('get_project_citations_unified', { p_project_id: projectId })
  
  if (error) {
    console.error('Failed to fetch citations:', error)
    return {
      bibliography: '',
      citations: [],
      count: 0
    }
  }
  
  if (!citations || citations.length === 0) {
    return {
      bibliography: '',
      citations: [],
      count: 0
    }
  }
  
  // Type the database result
  const typedCitations = citations as Array<{
    number: number
    paper_id: string
    csl_json: CSLData
    reason: string
    quote?: string
  }>
  
  // Format each citation according to style
  const styleFormatter = BIBLIOGRAPHY_STYLES[style] || BIBLIOGRAPHY_STYLES.apa
  const formattedEntries = typedCitations.map((citation) => {
    const entry: CitationBibliographyEntry = {
      number: citation.number,
      paper_id: citation.paper_id,
      csl_json: citation.csl_json,
      reason: citation.reason,
      quote: citation.quote
    }
    
    return styleFormatter.format(entry)
  })
  
  // Build bibliography sections
  const bibliography = [
    '## References',
    '',
    ...formattedEntries.map((entry: string) => entry.replace(/\s+/g, ' ').trim()),
    ''
  ].join('\n')
  
  return {
    bibliography,
    citations: typedCitations.map((c) => ({
      number: c.number,
      paper_id: c.paper_id,
      csl_json: c.csl_json,
      reason: c.reason,
      quote: c.quote
    })),
    count: citations.length
  }
}

/**
 * 🔄 STREAM BIBLIOGRAPHY AS FINAL BLOCK
 * Can be called immediately after last addCitation call
 */
export async function streamBibliographyBlock(
  projectId: string,
  style: keyof typeof BIBLIOGRAPHY_STYLES = 'apa',
  onBlock?: (content: string) => void
): Promise<string> {
  const result = await generateBibliography(projectId, style)
  
  if (result.count === 0) {
    return '' // No citations, no bibliography
  }
  
  // Stream the bibliography block if callback provided
  if (onBlock) {
    onBlock(result.bibliography)
  }
  
  return result.bibliography
}

// Export types
export type BibliographyStyle = keyof typeof BIBLIOGRAPHY_STYLES 