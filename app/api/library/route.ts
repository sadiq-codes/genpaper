import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { z } from 'zod'
import { 
  getUserLibraryPapers, 
  addPaperToLibrary, 
  getLibraryPaper,
  removePaperFromLibrary
} from '@/lib/db/library'
import { ensurePaperMetadata } from '@/lib/services/paper-content-service'
import type { RankedPaper } from '@/lib/services/paper-aggregation'
import { schedulePaperContentPreparationById } from '@/lib/services/paper-content-service'
import {
  getAuthenticatedUser,
  unauthorized,
  badRequest,
  serverError,
  success,
  parseQuery,
  parseBody,
  UuidSchema,
  SortOrderSchema,
} from '@/lib/api/helpers'

// ============================================================================
// Validation Schemas
// ============================================================================

const GetQuerySchema = z.object({
  search: z.string().optional(),
  collection: z.string().optional(),
  source: z.string().optional(),
  sortBy: z.enum(['added_at', 'title', 'publication_date', 'citation_count']).default('added_at'),
  sortOrder: SortOrderSchema,
  paperId: z.string().optional(),
  id: z.string().optional(),
})

const PostBodySchema = z.object({
  paperId: z.string().min(1, 'Paper ID is required').optional(),
  collectionId: z.string().optional(),
  searchQuery: z.string().max(500).optional(),
  searchResult: z.object({
    canonical_id: z.string().min(1),
    title: z.string().min(1),
    abstract: z.string().optional(),
    authors: z.array(z.string()).optional(),
    year: z.number().int().nullable().optional(),
    venue: z.string().optional(),
    doi: z.string().optional(),
    url: z.string().optional(),
    pdfUrl: z.string().optional(),
    citationCount: z.number().int().min(0).optional(),
    relevanceScore: z.number().optional(),
    source: z.string().min(1),
  }).optional(),
}).refine((value) => value.paperId || value.searchResult, {
  message: 'Paper ID or search result is required',
  path: ['paperId'],
})

const DeleteQuerySchema = z.object({
  id: UuidSchema.optional(),
  paperId: UuidSchema.optional(),
}).refine((value) => value.id || value.paperId, {
  message: 'Library entry id or paper id is required',
  path: ['id'],
})

function toRankedPaper(searchResult: z.infer<typeof PostBodySchema>['searchResult']): RankedPaper {
  const currentYear = new Date().getFullYear()
  const year = searchResult?.year && Number.isFinite(searchResult.year) ? searchResult.year : currentYear

  return {
    canonical_id: searchResult?.canonical_id || '',
    title: searchResult?.title || 'Untitled',
    abstract: searchResult?.abstract || '',
    year,
    venue: searchResult?.venue,
    doi: searchResult?.doi,
    url: searchResult?.url,
    pdf_url: searchResult?.pdfUrl,
    citationCount: searchResult?.citationCount || 0,
    authors: searchResult?.authors || [],
    source: (searchResult?.source || 'openalex') as RankedPaper['source'],
    relevanceScore: searchResult?.relevanceScore || 0,
    combinedScore: searchResult?.relevanceScore || 0,
    bm25Score: searchResult?.relevanceScore,
    authorityScore: undefined,
    recencyScore: undefined,
  }
}

// ============================================================================
// GET - Retrieve user's library papers
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return unauthorized()

    const queryResult = parseQuery(request, GetQuerySchema)
    if (!queryResult.success) {
      return badRequest(queryResult.error)
    }

    const { search, collection, source, sortBy, sortOrder, paperId, id } = queryResult.data

    // If querying specific paper
    if (paperId || id) {
      const targetId = paperId || id
      const papers = await getUserLibraryPapers(user.id, {
        search: targetId,
        sortBy,
        sortOrder,
      })
      
      const paper = papers.find(p => p.paper_id === targetId || p.id === targetId)
      return success({ paper })
    }

    const papers = await getUserLibraryPapers(user.id, {
      search: search || undefined,
      collectionId: collection || undefined,
      source: source || undefined,
      sortBy,
      sortOrder,
    })

    return success({ papers })

  } catch (error) {
    console.error('Error in library GET API:', error)
    return serverError()
  }
}

// ============================================================================
// POST - Add paper to library
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return unauthorized()

    const body = await request.json()
    const bodyResult = parseBody(body, PostBodySchema)
    if (!bodyResult.success) {
      return badRequest(bodyResult.error)
    }

    const { paperId, collectionId, searchQuery, searchResult } = bodyResult.data
    const resolvedPaperId = searchResult
      ? (await ensurePaperMetadata(toRankedPaper(searchResult), searchQuery || searchResult.title)).paperId
      : paperId!

    const libraryPaper = await addPaperToLibrary(user.id, resolvedPaperId, collectionId)

    after(() => {
      schedulePaperContentPreparationById(resolvedPaperId, {
        searchQuery: searchQuery || 'library_save',
        waitForStructuredExtraction: false,
        reason: searchResult ? 'library_save_search_result' : 'library_save_existing',
        userId: user.id,
      })
    })

    return success({ success: true, paperId: resolvedPaperId, libraryPaper })

  } catch (error) {
    console.error('Error in library POST API:', error)
    return serverError()
  }
}

// ============================================================================
// DELETE - Remove paper from library
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return unauthorized()

    const queryResult = parseQuery(request, DeleteQuerySchema)
    if (!queryResult.success) {
      return badRequest(queryResult.error)
    }

    const targetLibraryId = queryResult.data.id
      ?? (await getLibraryPaper(user.id, queryResult.data.paperId!))?.id

    if (!targetLibraryId) {
      return badRequest('Paper is not in your library')
    }

    await removePaperFromLibrary(targetLibraryId)

    return success({ success: true })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return serverError()
  }
}
