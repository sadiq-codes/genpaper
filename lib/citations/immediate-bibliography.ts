/**
 * CitationService - Unified Citation Management
 * 
 * Centralized service for validation, CSL normalization, and persistence.
 * Replaces scattered citation logic with a single write path.
 */

import 'server-only'
import { getSB } from '@/lib/supabase/server'
import { buildCSLFromPaper, type CSLItem, type PaperWithAuthors } from '@/lib/utils/csl'
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
  
  static async add(params: AddCitationParams): Promise<AddCitationResult> {
    const requestId = citationLogger.generateRequestId()
    const timer = citationLogger.startTimer()
    
    const isDev = process.env.NODE_ENV !== 'production'
    if (isDev) {
      console.log(`[Citation ${requestId}] Add started:`, { 
        projectId: params.projectId,
        sourceRef: params.sourceRef,
        reason: params.reason?.slice(0, 50)
      })
    }
    
  const supabase = await getSB()

    // Step 1: Resolve sourceRef to paperId
    let paperId: string | null = null
    
    if (params.sourceRef.paperId) {
      // Direct paperId provided
      paperId = params.sourceRef.paperId
      if (isDev) console.log(`[Citation ${requestId}] Using direct paperId:`, paperId)
    } else {
      // Resolve DOI/title/URL to paperId
      paperId = await this.resolveSourceRef(params.sourceRef, params.projectId)
      if (isDev) console.log(`[Citation ${requestId}] Resolved sourceRef:`, { paperId, sourceRef: params.sourceRef })
    }

    if (!paperId) {
      console.error(`[Citation ${requestId}] Could not resolve source reference:`, params.sourceRef)
      throw new Error(`Could not resolve source reference: ${JSON.stringify(params.sourceRef)}`)
    }

    // Step 2: Validate and fetch paper - try simple query first (paper_authors may not exist)
    let paper: any = null
    let paperError: any = null
    
    // First try with paper_authors join
    // Include all fields needed for complete CSL JSON (doi, url, metadata with volume/issue/pages/publisher)
    const { data: paperWithAuthors, error: joinError } = await supabase
    .from('papers')
    .select(`
      id, title, doi, url, pdf_url, venue, publication_date, created_at, authors, abstract, metadata,
      paper_authors(
        ordinal,
        authors(id, name)
      )
    `)
      .eq('id', paperId)
    .single()
    
    if (joinError) {
      // Fallback to simple query without paper_authors (table might not exist)
      if (isDev) {
        console.log(`[Citation ${requestId}] paper_authors join failed, trying simple query:`, joinError.message)
      }
      
      const { data: simplePaper, error: simpleError } = await supabase
        .from('papers')
        .select('id, title, doi, url, pdf_url, venue, publication_date, created_at, authors, abstract')
        .eq('id', paperId)
        .single()
      
      paper = simplePaper
      paperError = simpleError
    } else {
      paper = paperWithAuthors
    }

  if (paperError || !paper) {
      console.error(`[Citation ${requestId}] Paper not found:`, { paperId, error: paperError?.message })
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

        // Step 4: Persist via unified RPC with idempotency (handles uniqueness constraint and numbering)
        // The UNIQUE(project_id, paper_id) constraint ensures race-safe deduplication
    if (isDev) {
      console.log(`[Citation ${requestId}] Calling add_citation_unified RPC:`, {
        p_project_id: params.projectId,
        p_paper_id: paperId,
        p_reason: params.reason?.slice(0, 30),
        csl_title: cslJson?.title?.slice(0, 50)
      })
    }
    
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
      console.error(`[Citation ${requestId}] RPC error:`, {
        code: citationError.code,
        message: citationError.message,
        details: citationError.details,
        hint: citationError.hint
      })
      
      // Check if error is due to constraint violation (concurrent add)
      if (citationError.code === '23505' || citationError.message?.includes('duplicate')) {
        // Race condition detected, fetch existing citation
        if (isDev) console.log(`[Citation ${requestId}] Duplicate detected, fetching existing`)
        
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
        
        return result
      }
      
      // Check for function signature mismatch error
      if (citationError.message?.includes('function') || citationError.code === '42883') {
        console.error(`[Citation ${requestId}] RPC function signature mismatch - please run migration 20260109000000_fix_citation_system.sql`)
      }
      
      throw new Error(`Failed to add citation: ${citationError.message}`)
    }

    if (!rpcResult) {
      console.error(`[Citation ${requestId}] RPC returned no result`)
      throw new Error('Citation RPC returned no result')
    }
    
    if (isDev) {
      console.log(`[Citation ${requestId}] RPC success:`, rpcResult)
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
    
    return finalResult
  }

  // Legacy method for backward compatibility
  static async renderInline(cslJson: CSLItem, style: string, number: number): Promise<string> {
    return formatInlineCitation(cslJson, style, number)
  }

  // New method matching the task requirements
  // style accepts any CSL style ID string
  static async renderInlineMultiple(params: {
    projectId: string
    citeKeys: string[]
    style: string
  }): Promise<string[]> {
    const supabase = await getSB()
    
    if (params.citeKeys.length === 0) {
      return []
    }
    
    // The editor passes paper IDs as citeKeys.
    // First try to get CSL JSON from project_citations (where it's properly stored)
    // Fall back to building from papers table metadata if not found
    
    // Query project_citations for CSL JSON (added via add_citation_unified RPC)
    const { data: projectCitations, error: citationError } = await supabase
      .from('project_citations')
      .select('paper_id, csl_json, first_seen_order')
      .eq('project_id', params.projectId)
      .in('paper_id', params.citeKeys)
    
    if (citationError) {
      console.warn(`Failed to fetch project citations: ${citationError.message}`)
    }
    
    // Build map of paper_id -> csl_json from project_citations
    const citationCslMap = new Map<string, { csl_json: CSLItem | null; order: number }>()
    for (const citation of projectCitations || []) {
      if (citation.paper_id) {
        citationCslMap.set(citation.paper_id, {
          csl_json: citation.csl_json as CSLItem | null,
          order: citation.first_seen_order || 0
        })
      }
    }
    
    // For papers not in project_citations (or missing csl_json), fetch from papers table
    const missingPaperIds = params.citeKeys.filter(id => {
      const citation = citationCslMap.get(id)
      return !citation || !citation.csl_json
    })
    
    // Fetch paper metadata for fallback CSL generation
    const paperMetadataMap = new Map<string, {
      title: string
      authors: string[]
      year: number | null
    }>()
    
    if (missingPaperIds.length > 0) {
      // Note: papers table uses publication_date, not year
      const { data: papers, error: papersError } = await supabase
        .from('papers')
        .select('id, title, authors, publication_date')
        .in('id', missingPaperIds)
      
      if (papersError) {
        console.warn(`Failed to fetch papers: ${papersError.message}`)
      }
      
      for (const paper of papers || []) {
        const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : null
        paperMetadataMap.set(paper.id, {
          title: paper.title || 'Untitled',
          authors: paper.authors || [],
          year
        })
      }
    }
    
    // Render each citation in the requested order
    const rendered: string[] = []
    for (let i = 0; i < params.citeKeys.length; i++) {
      const paperId = params.citeKeys[i]
      
      try {
        // First try CSL JSON from project_citations
        const citation = citationCslMap.get(paperId)
        let cslJson = citation?.csl_json
        
        if (!cslJson) {
          // Fall back to building CSL from paper metadata
          const paperMeta = paperMetadataMap.get(paperId)
          if (paperMeta) {
            cslJson = {
              type: 'article',
              title: paperMeta.title,
              author: paperMeta.authors.map(name => {
                // Parse "Last, First" or "First Last" format
                if (name.includes(',')) {
                  const [family, given] = name.split(',').map(s => s.trim())
                  return { family, given }
                }
                const parts = name.trim().split(/\s+/)
                if (parts.length === 1) {
                  return { family: parts[0] }
                }
                return { 
                  family: parts[parts.length - 1], 
                  given: parts.slice(0, -1).join(' ') 
                }
              }),
              issued: paperMeta.year ? { 'date-parts': [[paperMeta.year]] } : undefined
            } as CSLItem
          }
        }
        
        if (!cslJson) {
          rendered.push('') // No data available
          continue
        }
        
        const citationOrder = citation?.order || (i + 1)
        const formatted = formatInlineCitation(cslJson, params.style, citationOrder)
        rendered.push(formatted)
      } catch (err) {
        console.error(`Failed to format citation ${paperId}:`, err)
        rendered.push(`[Error: ${paperId.slice(0, 8)}]`)
      }
    }
    
    return rendered
  }

  /**
   * Render inline citations with paper info - optimized for editor loading
   * Returns both rendered citation text AND paper metadata in a single call
   */
  static async renderInlineWithPaperInfo(params: {
    projectId: string
    citeKeys: string[]
    style: string
  }): Promise<Array<{
    citeKey: string
    rendered: string
    paper: {
      id: string
      title: string
      authors: string[]
      year: number | null
      journal?: string
      doi?: string
    } | null
  }>> {
    const supabase = await getSB()
    
    if (params.citeKeys.length === 0) {
      return []
    }
    
    // Query project_citations for CSL JSON
    const { data: projectCitations } = await supabase
      .from('project_citations')
      .select('paper_id, csl_json, first_seen_order')
      .eq('project_id', params.projectId)
      .in('paper_id', params.citeKeys)
    
    const citationCslMap = new Map<string, { csl_json: CSLItem | null; order: number }>()
    for (const citation of projectCitations || []) {
      if (citation.paper_id) {
        citationCslMap.set(citation.paper_id, {
          csl_json: citation.csl_json as CSLItem | null,
          order: citation.first_seen_order || 0
        })
      }
    }
    
    // Fetch paper metadata for all papers (needed for both CSL fallback and paper info)
    // Note: papers table uses publication_date, not year
    // Include all fields needed for complete citation display
    const { data: papers, error: papersError } = await supabase
      .from('papers')
      .select('id, title, authors, publication_date, venue, doi, url')
      .in('id', params.citeKeys)
    
    if (papersError) {
      console.error('[CitationService] Failed to fetch papers:', papersError.message)
    }
    
    const paperMap = new Map<string, {
      id: string
      title: string
      authors: string[]
      year: number | null
      journal?: string
      doi?: string
      url?: string
    }>()
    
    for (const paper of papers || []) {
      const year = paper.publication_date ? new Date(paper.publication_date).getFullYear() : null
      paperMap.set(paper.id, {
        id: paper.id,
        title: paper.title || 'Untitled',
        authors: paper.authors || [],
        year,
        journal: paper.venue,
        doi: paper.doi,
        url: paper.url,
      })
    }
    
    // Render each citation and include paper info
    const results: Array<{
      citeKey: string
      rendered: string
      paper: {
        id: string
        title: string
        authors: string[]
        year: number | null
        journal?: string
        doi?: string
      } | null
    }> = []
    
    for (let i = 0; i < params.citeKeys.length; i++) {
      const paperId = params.citeKeys[i]
      const paperInfo = paperMap.get(paperId) || null
      
      try {
        // First try CSL JSON from project_citations
        const citation = citationCslMap.get(paperId)
        let cslJson = citation?.csl_json
        
        if (!cslJson && paperInfo) {
          // Fall back to building CSL from paper metadata
          cslJson = {
            type: 'article',
            title: paperInfo.title,
            author: paperInfo.authors.map(name => {
              if (name.includes(',')) {
                const [family, given] = name.split(',').map(s => s.trim())
                return { family, given }
              }
              const parts = name.trim().split(/\s+/)
              if (parts.length === 1) {
                return { family: parts[0] }
              }
              return { 
                family: parts[parts.length - 1], 
                given: parts.slice(0, -1).join(' ') 
              }
            }),
            issued: paperInfo.year ? { 'date-parts': [[paperInfo.year]] } : undefined
          } as CSLItem
        }
        
        const citationOrder = citation?.order || (i + 1)
        const formatted = cslJson ? formatInlineCitation(cslJson, params.style, citationOrder) : ''
        
        results.push({
          citeKey: paperId,
          rendered: formatted,
          paper: paperInfo
        })
      } catch (err) {
        console.error(`Failed to format citation ${paperId}:`, err)
        results.push({
          citeKey: paperId,
          rendered: `[Error: ${paperId.slice(0, 8)}]`,
          paper: paperInfo
        })
      }
    }
    
    return results
  }

  static async renderBibliography(projectId: string, style: keyof typeof BIBLIOGRAPHY_STYLES = 'apa'): Promise<BibliographyResult> {
    return generateBibliography(projectId, style)
  }

  /**
   * Extract citation markers from project content and create citation records.
   * This is useful for projects where content has [CITE: uuid] markers but
   * no corresponding records in project_citations table.
   */
  static async extractAndCreateCitationsFromContent(projectId: string): Promise<{
    processed: number
    errors: string[]
    extracted: number
  }> {
    const supabase = await getSB()
    const errors: string[] = []
    let processed = 0
    
    // Get project content
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('content')
      .eq('id', projectId)
      .single()
    
    if (projectError || !project?.content) {
      return { processed: 0, errors: ['Project not found or has no content'], extracted: 0 }
    }
    
    // Extract all citation markers from content
    // Supports both [@uuid] (Pandoc) and [CITE: uuid] (legacy) formats
    const pandocPattern = /\[@([a-f0-9-]{36})\]/gi
    const legacyPattern = /\[CITE:\s*([a-f0-9-]{36})\]/gi
    
    const paperIds = new Set<string>()
    
    for (const match of project.content.matchAll(pandocPattern)) {
      paperIds.add(match[1])
    }
    for (const match of project.content.matchAll(legacyPattern)) {
      paperIds.add(match[1])
    }
    
    const extracted = paperIds.size
    console.log(`[CitationService] Found ${extracted} unique paper IDs in content for project ${projectId}`)
    
    if (extracted === 0) {
      return { processed: 0, errors: [], extracted: 0 }
    }
    
    // Create citation records for each paper
    for (const paperId of paperIds) {
      try {
        await this.add({
          projectId,
          sourceRef: { paperId },
          reason: 'Extracted from existing content'
        })
        processed++
        console.log(`[CitationService] Created citation for paper ${paperId}`)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        errors.push(`Paper ${paperId}: ${errMsg}`)
        console.warn(`[CitationService] Failed to create citation for paper ${paperId}: ${errMsg}`)
      }
    }
    
    return { processed, errors, extracted }
  }

  /**
   * Backfill CSL JSON for papers in a project that are missing it.
   * This is useful for existing projects where papers were added before
   * the CSL JSON generation was integrated.
   */
  static async backfillProjectCitations(projectId: string): Promise<{
    processed: number
    errors: string[]
  }> {
    const supabase = await getSB()
    const errors: string[] = []
    let processed = 0
    
    // Get all citations in the project - papers are linked via project_citations table
    const { data: existingCitations, error: citError } = await supabase
      .from('project_citations')
      .select('paper_id, csl_json')
      .eq('project_id', projectId)
    
    if (citError) {
      throw new Error(`Failed to fetch project citations: ${citError.message}`)
    }
    
    // Filter to papers with null csl_json
    const papersToProcess = (existingCitations || [])
      .filter(c => c.paper_id && !c.csl_json)
      .map(c => c.paper_id)
    
    if (papersToProcess.length === 0) {
      return { processed: 0, errors: [] }
    }
    
    // Process each paper that needs CSL JSON
    for (const paperId of papersToProcess) {
      if (!paperId) continue
      
      try {
        // Use CitationService.add which generates and stores CSL JSON
        // This will update existing citation via ON CONFLICT
        await this.add({
          projectId,
          sourceRef: { paperId },
          reason: 'Backfill: CSL JSON migration'
        })
        processed++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        errors.push(`Paper ${paperId}: ${errMsg}`)
      }
    }
    
    return { processed, errors }
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

export function formatInlineCitation(cslJson: CSLItem | null | undefined, style: string, number: number): string {
  // Handle null/undefined cslJson
  if (!cslJson) {
    return `[${number}]` // Fallback to numbered citation
  }
  
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