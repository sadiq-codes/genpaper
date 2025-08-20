/**
 * CitationService - Unified Citation Management
 * 
 * Centralized service for validation, CSL normalization, and persistence.
 * Replaces scattered citation logic with a single write path.
 */

import 'server-only'
import { getSB } from '@/lib/supabase/server'
import { buildCSLFromPaper, validateCSL, type CSLItem, type PaperWithAuthors } from '@/lib/utils/csl'
import { findBestTitleMatch, type PaperCandidate } from '@/lib/utils/fuzzy-matching'
import { citationLogger } from '@/lib/utils/citation-logger'

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
export { BIBLIOGRAPHY_STYLES } 

/**
 * CitationService - Core Methods
 * Centralized validation, CSL normalization, and persistence
 */

export interface AddCitationParams {
  projectId: string
  sourceRef: {
    doi?: string
    title?: string
    year?: number
    url?: string
    paperId?: string // Direct paper ID if already known
  }
  reason: string
  anchorId?: string
  quote?: string | null
}

export interface AddCitationResult {
  citeKey: string
  projectCitationId: string
  isNew: boolean
  citationNumber?: number // Kept for backward compatibility
  cslJson?: CSLItem // Kept for backward compatibility
}

export class CitationService {
  private constructor() {}
  
  // Realtime channel for citation events (singleton)
  private static realtimeChannel: any = null
  
      static async add(params: AddCitationParams): Promise<AddCitationResult> {
    const requestId = citationLogger.generateRequestId()
    const timer = citationLogger.startTimer()
  const supabase = await getSB()

    // Step 1: Resolve sourceRef to paperId
    let paperId: string | null = null
    
    if (params.sourceRef.paperId) {
      // Direct paperId provided
      paperId = params.sourceRef.paperId
    } else {
      // Resolve DOI/title/URL to paperId
      paperId = await this.resolveSourceRef(params.sourceRef, params.projectId)
    }

    if (!paperId) {
      throw new Error(`Could not resolve source reference: ${JSON.stringify(params.sourceRef)}`)
    }

    // Step 2: Validate and fetch paper with authors
  const { data: paper, error: paperError } = await supabase
    .from('papers')
    .select(`
      id, title, doi, url, venue, volume, issue, pages, publication_date, created_at,
      paper_authors(
        ordinal,
        authors(id, name)
      )
    `)
      .eq('id', paperId)
    .single()

  if (paperError || !paper) {
      throw new Error(`Paper not found: ${paperId}`)
    }

        // Step 3: Build and validate CSL JSON from paper
    const rawCSL = buildCSLFromPaper(paper as unknown as PaperWithAuthors)
    
    // Apply normalization pipeline
    const { validateAndNormalizeCSL } = await import('@/lib/utils/csl')
    const validation = await validateAndNormalizeCSL(rawCSL)
    
    if (!validation.isValid) {
      throw new Error(`CSL validation failed: ${validation.errors?.join(', ')}`)
    }
    
    const cslJson = validation.normalized!

        // Step 3: Persist via unified RPC with idempotency (handles uniqueness constraint and numbering)
        // The UNIQUE(project_id, paper_id) constraint ensures race-safe deduplication
    const { data: rpcResult, error: citationError } = await supabase
    .rpc('add_citation_unified', {
      p_project_id: params.projectId,
        p_paper_id: paperId,
      p_csl_json: cslJson,
      p_reason: params.reason,
      p_quote: params.quote || null
    })
    .single()

    if (citationError) {
      // Check if error is due to constraint violation (concurrent add)
      if (citationError.code === '23505' || citationError.message?.includes('duplicate')) {
        // Race condition detected, fetch existing citation
        const { data: existing, error: fetchError } = await supabase
          .from('project_citations')
          .select('id, csl_json, cite_key')
          .eq('project_id', params.projectId)
          .eq('paper_id', paperId)
          .single()

        if (fetchError || !existing) {
          throw new Error(`Citation constraint violation but unable to fetch existing: ${fetchError?.message}`)
        }

        const citeKey = existing.cite_key || `${params.projectId}-${paperId}`
        const result = {
          citeKey,
          projectCitationId: existing.id,
          isNew: false,
          citationNumber: undefined, // Legacy field removed
          cslJson: existing.csl_json as CSLItem // Backward compatibility
        }
        
        // Emit realtime event even for existing citations (client might need refresh)
        await this.emitCitationChangedEvent(params.projectId, citeKey, false)
        
        return result
      }
      
      throw new Error(`Failed to add citation: ${citationError.message}`)
    }

    if (!rpcResult) {
      throw new Error('Citation RPC returned no result')
    }

    const { is_new, cite_key } = rpcResult as { 
      is_new: boolean;
      cite_key?: string;
    }
    
    // Use returned cite_key or generate fallback
    const citeKey = cite_key || `${params.projectId}-${paperId}`
    
    // Get the project citation ID from the inserted row
    const { data: insertedCitation, error: fetchError } = await supabase
      .from('project_citations')
      .select('id')
      .eq('project_id', params.projectId)
      .eq('paper_id', paperId)
      .single()
    
    if (fetchError || !insertedCitation) {
      throw new Error('Failed to fetch inserted citation ID')
    }
    
    const finalResult = { 
      citeKey,
      projectCitationId: insertedCitation.id,
      isNew: is_new,
      citationNumber: undefined, // Legacy field removed
      cslJson // Backward compatibility
    }
    
    // Log successful citation addition
    const metrics = timer.end()
    citationLogger.logCitationAdded({
      operation: 'citation_added',
      projectId: params.projectId,
      citeKey,
      requestId,
      metrics,
      isNew: finalResult.isNew
    })
    
    // Emit realtime event for citation changes
    await this.emitCitationChangedEvent(params.projectId, citeKey, finalResult.isNew)
    
    return finalResult
  }

  // Legacy method for backward compatibility
  static async renderInline(cslJson: CSLItem, style: string, number: number): Promise<string> {
    return formatInlineCitation(cslJson, style, number)
  }

  // New method matching the task requirements
  static async renderInlineMultiple(params: {
    projectId: string
    citeKeys: string[]
    style: 'apa' | 'mla' | 'chicago' | 'ieee'
  }): Promise<string[]> {
    const supabase = await getSB()
    
    if (params.citeKeys.length === 0) {
      return []
    }
    
    // Fetch citations for the given citeKeys in this project
    const { data: citations, error } = await supabase
      .from('project_citations')
      .select('cite_key, csl_json, first_seen_order')
      .eq('project_id', params.projectId)
      .in('cite_key', params.citeKeys)
      .order('first_seen_order')
    
    if (error) {
      throw new Error(`Failed to fetch citations: ${error.message}`)
    }
    
    if (!citations || citations.length === 0) {
      // Return empty strings for missing citations
      return params.citeKeys.map(() => '')
    }
    
    // Create a map for quick lookup
    const citationMap = new Map(citations.map((c: any) => [c.cite_key, c]))
    
    // Render each citation in the requested order
    const rendered: string[] = []
    for (const citeKey of params.citeKeys) {
      const citation = citationMap.get(citeKey)
      if (!citation) {
        rendered.push('') // Missing citation
        continue
      }
      
      try {
        const formatted = formatInlineCitation(
          (citation as any).csl_json as CSLItem,
          params.style,
          (citation as any).first_seen_order
        )
        rendered.push(formatted)
      } catch (error) {
        console.error(`Failed to format citation ${citeKey}:`, error)
        rendered.push(`[Error: ${citeKey}]`)
      }
    }
    
    return rendered
  }

  static async renderBibliography(projectId: string, style: keyof typeof BIBLIOGRAPHY_STYLES = 'apa'): Promise<BibliographyResult> {
    return generateBibliography(projectId, style)
  }

  static async suggest(projectId: string, context: string): Promise<string[]> {
    // TODO: Implement citation suggestions based on context
    return []
  }

  /**
   * Emit realtime event for citation changes
   * Purpose: Notify clients to refresh bibliography/inline disambiguation
   */
  private static async emitCitationChangedEvent(
    projectId: string, 
    citeKey: string, 
    isNew: boolean
  ): Promise<void> {
    try {
      const supabase = await getSB()
      
      // Initialize channel on first use to prevent socket leaks
      if (!this.realtimeChannel) {
        this.realtimeChannel = supabase.channel('citations-changes')
      }
      
      // Publish realtime payload {projectId, citeKey}
      const payload = {
        projectId,
        citeKey,
        isNew,
        timestamp: new Date().toISOString()
      }
      
      if (this.realtimeChannel && typeof this.realtimeChannel === 'object') {
        const channel = this.realtimeChannel as { send: (data: unknown) => Promise<unknown> }
        await channel.send({
          type: 'broadcast',
          event: 'citation-changed',
          payload
        })
      }
      
    } catch (error) {
      // Don't throw on realtime errors - citation success is more important
      console.warn('Failed to emit citation changed event:', error)
    }
  }

  static async resolveSourceRef(sourceRef: { doi?: string; title?: string; year?: number }, projectId?: string): Promise<string | null> {
    const timer = citationLogger.startTimer()
    const supabase = await getSB()
    
    // Get user ID from project for library preference
    let userId: string | null = null
    if (projectId) {
      const { data: project } = await supabase
        .from('research_projects')
        .select('user_id')
        .eq('id', projectId)
        .single()
      userId = project?.user_id || null
    }
    
    // Normalize DOI if provided
    if (sourceRef.doi) {
      const normalizedDoi = sourceRef.doi.toLowerCase()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
        .replace(/^doi:/, '')
        .trim()
      
      // Try exact DOI match first
      const { data: doiPaper } = await supabase
        .from('papers')
        .select('id')
        .eq('doi', normalizedDoi)
        .single()
      
      if (doiPaper) return doiPaper.id
      
      // Try variations
      for (const variant of [`10.${normalizedDoi}`, `doi:${normalizedDoi}`, `https://doi.org/${normalizedDoi}`]) {
        const { data: variantPaper } = await supabase
          .from('papers')
          .select('id')
          .eq('doi', variant)
          .single()
        
        if (variantPaper) return variantPaper.id
      }
    }
    
    // Fallback to title + year fuzzy match using reusable library
    if (sourceRef.title) {
      const { data: papers } = await supabase
        .from('papers')
        .select('id, title, publication_date')
        .ilike('title', `%${sourceRef.title}%`)
        .limit(20) // Increased limit for better matching
      
      if (papers && papers.length > 0) {
        // Convert to candidates format
        const candidates: PaperCandidate[] = papers.map((paper: any) => ({
          id: paper.id,
          title: paper.title || '',
          year: paper.publication_date ? new Date(paper.publication_date).getFullYear() : undefined
        }))

        // Get preferred paper IDs (user library + already cited papers)
        let preferredIds = new Set<string>()
        
        // Add papers from user's library (primary preference)
        if (userId) {
          const { data: libraryPapers } = await supabase
            .from('library_papers')
            .select('paper_id')
            .eq('user_id', userId)
          
          if (libraryPapers) {
            libraryPapers.forEach((lp: any) => preferredIds.add(lp.paper_id))
          }
        }
        
        // Add papers already cited in this project (secondary preference)
        if (projectId) {
          const { data: citedRows } = await supabase
            .from('project_citations')
            .select('paper_id')
            .eq('project_id', projectId)
          
          if (citedRows) {
            citedRows.forEach((r: any) => preferredIds.add(r.paper_id))
          }
        }

        // Use fuzzy matching library
        const match = findBestTitleMatch(
          sourceRef.title,
          sourceRef.year,
          candidates,
          {
            threshold: 2,
            minSimilarity: 0.8,
            yearBonus: 1,
            preferredIds
          }
        )

        if (match) {
          const metrics = timer.end()
          citationLogger.logResolverPerformance({
            operation: 'resolver',
            projectId,
            userId: userId || undefined,
            metrics,
            sourceRef,
            resolved: true,
            resolvedPaperId: match.paper.id
          })
          return match.paper.id
        }
      }
    }
    
    // Log failed resolution
    const metrics = timer.end()
    citationLogger.logResolverPerformance({
      operation: 'resolver',
      projectId,
      userId: userId || undefined,
      metrics,
      sourceRef,
      resolved: false
    })
    
    return null
  }


}

// Citations fully unified - no legacy compatibility needed

export function formatInlineCitation(cslJson: CSLItem, style: string, number: number): string {
  const authors = cslJson.author || []
  const year = cslJson.issued?.['date-parts']?.[0]?.[0] || 'n.d.'

  switch ((style || 'apa').toLowerCase()) {
    case 'apa':
      if (authors.length === 0) return `(Anonymous, ${year})`
      if (authors.length === 1) {
        const lastName = authors[0].family || authors[0].literal || 'Unknown'
        return `(${lastName}, ${year})`
      }
      if (authors.length === 2) {
        const first = authors[0].family || authors[0].literal || 'Unknown'
        const second = authors[1].family || authors[1].literal || 'Unknown'
        return `(${first} & ${second}, ${year})`
      }
      return `(${authors[0]?.family || 'Unknown'} et al., ${year})`
    case 'mla':
      if (authors.length === 0) return '(Anonymous)'
      return authors.length === 1
        ? `(${authors[0]?.family || authors[0]?.literal || 'Unknown'})`
        : `(${authors[0]?.family || authors[0]?.literal || 'Unknown'} et al.)`
    case 'chicago':
      if (authors.length === 0) return `(Anonymous ${year})`
      return authors.length === 1
        ? `(${authors[0]?.family || authors[0]?.literal || 'Unknown'} ${year})`
        : `(${authors[0]?.family || authors[0]?.literal || 'Unknown'} et al. ${year})`
    case 'ieee':
      return `[${number}]`
    default:
      return `(${authors[0]?.family || 'Unknown'}, ${year})`
  }
}