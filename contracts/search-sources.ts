export interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  fastMode?: boolean
  includeOtherTypes?: boolean
}

export interface AcademicPaper {
  canonical_id: string
  title: string
  abstract: string
  year: number
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  citationCount: number
  authors?: string[]
  source: string // paper source id
}

export interface SourceAdapter {
  /** ID that matches PaperSource union e.g. 'openalex', 'crossref' */
  id: string
  /** Execute search against underlying API */
  search: (q: string, opts: SearchOptions) => Promise<AcademicPaper[]>
  /** Used for ordering / early-exit */
  reliability: 'high' | 'medium' | 'low'
  /** Max requests per second this source safely supports */
  rateLimitRps: number
} 