import { NextRequest } from 'next/server'
import { z } from 'zod'
import { 
  getUserLibraryPapers, 
  addPaperToLibrary, 
  removePaperFromLibrary
} from '@/lib/db/library'
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
  paperId: z.string().min(1, 'Paper ID is required'),
  collectionId: z.string().optional(),
})

const DeleteQuerySchema = z.object({
  id: UuidSchema,
})

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

    const { paperId, collectionId } = bodyResult.data
    const libraryPaper = await addPaperToLibrary(user.id, paperId, collectionId)

    return success({ success: true, libraryPaper })

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

    await removePaperFromLibrary(queryResult.data.id)

    return success({ success: true })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return serverError()
  }
}
