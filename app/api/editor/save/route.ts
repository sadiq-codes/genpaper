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
// Constants
// ============================================================================

// Minimum character difference to create a new version (avoid duplicate snapshots)
const MIN_CONTENT_DIFF = 50

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
    
    // ========================================================================
    // Version History: Create snapshot if content changed significantly
    // ========================================================================
    let versionCreated = false
    
    try {
      // Get the last version to check for significant changes
      const { data: lastVersion } = await supabase
        .from('document_versions')
        .select('content')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      
      // Determine if we should create a new version:
      // - No previous version exists, OR
      // - Content length changed by more than MIN_CONTENT_DIFF, OR
      // - Content is completely different (for same-length edits)
      const shouldCreateVersion = !lastVersion || 
        Math.abs(content.length - (lastVersion.content?.length || 0)) > MIN_CONTENT_DIFF ||
        content !== lastVersion.content
      
      if (shouldCreateVersion && content.trim().length > 0) {
        // Calculate word count for the version
        const wordCount = content.split(/\s+/).filter(Boolean).length
        
        // Create version snapshot (cleanup trigger handles retention limit)
        const { error: versionError } = await supabase
          .from('document_versions')
          .insert({
            project_id: projectId,
            user_id: user.id,
            content,
            word_count: wordCount,
            trigger_type: 'auto'
          })
        
        if (versionError) {
          // Log but don't fail the save - version history is non-critical
          console.warn('Failed to create version snapshot:', versionError.message)
        } else {
          versionCreated = true
        }
      }
    } catch (versionErr) {
      // Version creation is non-critical - log and continue
      console.warn('Version history error:', versionErr)
    }
    
    // ========================================================================
    // Save current content to research_projects
    // ========================================================================
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

    return success({ success: true, versionCreated })
  } catch (error) {
    return handleError(error, 'Save error')
  }
}
