import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  parseBody,
  badRequest,
  success,
  handleError,
  UuidSchema,
} from '@/lib/api/helpers'

// ============================================================================
// Validation Schema
// ============================================================================

const SaveBodySchema = z.object({
  projectId: UuidSchema,
  content: z.string(),
})

// ============================================================================
// POST - Save document content
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()

    // Robust body parsing: handle client disconnects / empty body gracefully
    // (prevents "Unexpected end of JSON input" noise in dev + on aborted requests)
    let body: unknown
    try {
      const text = await request.text()
      if (!text || text.trim() === '') {
        return badRequest('Empty request body')
      }
      body = JSON.parse(text)
    } catch (err: unknown) {
      if (err instanceof Error) {
        // If the client disconnected mid-request, avoid throwing server error
        if (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('ECONNRESET')) {
          return new Response(null, { status: 499 })
        }
      }
      return badRequest('Invalid JSON in request body')
    }

    const bodyResult = parseBody(body, SaveBodySchema)
    if (!bodyResult.success) {
      return badRequest(bodyResult.error)
    }

    const { projectId, content } = bodyResult.data

    const supabase = await createClient()
    const { error: updateError } = await supabase
      .from('research_projects')
      .update({ 
        content,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Save error:', updateError)
      throw updateError
    }

    return success({ success: true })
  } catch (error) {
    return handleError(error, 'Save error')
  }
}
