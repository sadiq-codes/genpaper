import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCitationsWithLinks, addCitationToProject } from '@/app/(dashboard)/projects/[projectId]/actions'

// Define the database citation structure based on the schema
export interface DatabaseCitation {
  id: string
  project_id: string
  citation_key: string
  doi?: string | null
  title: string
  authors: Array<{ family: string; given: string }>
  year?: number | null
  journal?: string | null
  metadata?: Record<string, unknown> | null
  enriched_at?: string | null
  created_at: string
  updated_at: string
  links?: Array<{
    id: string
    section: string
    start: number
    end: number
    text_segment?: string
    reason?: string
  }> | null
}

export interface CitationsResponse {
  success: boolean
  citations?: DatabaseCitation[]
  error?: string
}

// Citation styles enum
export type CitationStyle = 'apa' | 'mla' | 'chicago'

// Query Keys
export const citationKeys = {
  all: ['citations'] as const,
  byProject: (projectId: string) => ['citations', projectId] as const,
}

// Query: Get all citations for a project
export function useCitations(projectId: string) {
  return useQuery({
    queryKey: citationKeys.byProject(projectId),
    queryFn: async (): Promise<CitationsResponse> => {
      return await getCitationsWithLinks(projectId)
    },
    enabled: !!projectId,
  })
}

// Helper function to format authors (simple format)
export function formatAuthors(authors: Array<{ family: string; given: string }>): string {
  if (!authors || authors.length === 0) return 'Unknown Author'
  
  return authors.map(author => {
    if (author.family && author.given) {
      return `${author.family}, ${author.given}`
    } else if (author.family) {
      return author.family
    } else if (author.given) {
      return author.given
    } else {
      return 'Unknown'
    }
  }).join('; ')
}

// Enhanced citation formatting with multiple styles
export function formatCitationForBibliography(citation: DatabaseCitation, style: CitationStyle = 'apa'): string {
  const authors = citation.authors || []
  const title = citation.title || 'Untitled'
  const year = citation.year
  const journal = citation.journal
  const doi = citation.doi

  switch (style) {
    case 'apa':
      return formatAPACitation(authors, year, title, journal, doi)
    case 'mla':
      return formatMLACitation(authors, year, title, journal, doi)
    case 'chicago':
      return formatChicagoCitation(authors, year, title, journal, doi)
    default:
      return formatAPACitation(authors, year, title, journal, doi)
  }
}

// APA Style formatting
function formatAPACitation(
  authors: Array<{ family: string; given: string }>,
  year?: number | null,
  title?: string,
  journal?: string | null,
  doi?: string | null
): string {
  // Format authors for APA (Last, F. M.)
  const formattedAuthors = authors.length > 0 
    ? authors.map(author => {
        const family = author.family || 'Unknown'
        const given = author.given || ''
        const initials = given.split(' ').map(name => name.charAt(0).toUpperCase()).join('. ')
        return initials ? `${family}, ${initials}.` : family
      }).join(', ')
    : 'Unknown Author'

  const yearStr = year ? `(${year})` : '(n.d.)'
  const titleStr = title ? `${title}.` : 'Untitled.'
  const journalStr = journal ? ` *${journal}*` : ''
  const doiStr = doi ? ` https://doi.org/${doi}` : ''

  return `${formattedAuthors} ${yearStr}. ${titleStr}${journalStr}.${doiStr}`.trim()
}

// MLA Style formatting
function formatMLACitation(
  authors: Array<{ family: string; given: string }>,
  year?: number | null,
  title?: string,
  journal?: string | null,
  doi?: string | null
): string {
  // Format authors for MLA (Last, First)
  const formattedAuthors = authors.length > 0
    ? authors.map((author, index) => {
        const family = author.family || 'Unknown'
        const given = author.given || ''
        if (index === 0) {
          return given ? `${family}, ${given}` : family
        } else {
          return given ? `${given} ${family}` : family
        }
      }).join(', ')
    : 'Unknown Author'

  const titleStr = title ? `"${title}."` : '"Untitled."'
  const journalStr = journal ? ` *${journal}*` : ''
  const yearStr = year ? `, ${year}` : ''
  const doiStr = doi ? `, doi:${doi}` : ''

  return `${formattedAuthors}. ${titleStr}${journalStr}${yearStr}${doiStr}.`.trim()
}

// Chicago Style formatting (Author-Date)
function formatChicagoCitation(
  authors: Array<{ family: string; given: string }>,
  year?: number | null,
  title?: string,
  journal?: string | null,
  doi?: string | null
): string {
  // Format authors for Chicago (Last, First)
  const formattedAuthors = authors.length > 0
    ? authors.map(author => {
        const family = author.family || 'Unknown'
        const given = author.given || ''
        return given ? `${family}, ${given}` : family
      }).join(', ')
    : 'Unknown Author'

  const yearStr = year ? ` ${year}` : ''
  const titleStr = title ? `"${title}."` : '"Untitled."'
  const journalStr = journal ? ` *${journal}*` : ''
  const doiStr = doi ? ` https://doi.org/${doi}` : ''

  return `${formattedAuthors}.${yearStr}. ${titleStr}${journalStr}.${doiStr}`.trim()
}

// Generate full bibliography from citations array
export function generateBibliography(citations: DatabaseCitation[], style: CitationStyle = 'apa'): string {
  if (!citations || citations.length === 0) {
    return 'No citations available.'
  }

  // Sort citations alphabetically by first author's family name
  const sortedCitations = [...citations].sort((a, b) => {
    const aFirstAuthor = a.authors?.[0]?.family || 'Unknown'
    const bFirstAuthor = b.authors?.[0]?.family || 'Unknown'
    return aFirstAuthor.localeCompare(bFirstAuthor)
  })

  return sortedCitations
    .map(citation => formatCitationForBibliography(citation, style))
    .join('\n\n')
}

// Mutation: Add new citation
export function useAddCitation() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async ({
      projectId,
      citationData,
    }: {
      projectId: string
      citationData: {
        title: string
        authors: Array<{ family: string; given: string }>
        year?: number
        journal?: string
        doi?: string
        citation_key?: string
      }
    }) => {
      return await addCitationToProject(projectId, citationData)
    },
    onSuccess: (data, variables) => {
      if (data.success) {
        // Invalidate citations query to refetch
        queryClient.invalidateQueries({ queryKey: citationKeys.byProject(variables.projectId) })
      }
    },
  })
} 