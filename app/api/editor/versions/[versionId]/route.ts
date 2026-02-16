import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  parseBody,
  badRequest,
  notFound,
  success,
  handleError,
  UuidSchema,
} from '@/lib/api/helpers'

// ============================================================================
// Validation Schemas
// ============================================================================

const RestoreBodySchema = z.object({
  projectId: UuidSchema,
})

// ============================================================================
// GET - Get full version content
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const user = await requireAuth()
    const { versionId } = await params

    // Validate versionId
    const versionIdResult = UuidSchema.safeParse(versionId)
    if (!versionIdResult.success) {
      return badRequest('Invalid version ID')
    }

    const supabase = await createClient()

    // Fetch version with ownership check via user_id
    const { data: version, error: versionError } = await supabase
      .from('document_versions')
      .select('id, project_id, content, created_at, word_count, trigger_type, label')
      .eq('id', versionId)
      .eq('user_id', user.id)
      .single()

    if (versionError || !version) {
      return notFound('Version not found or access denied')
    }

    return success({ version })
  } catch (error) {
    return handleError(error, 'Failed to fetch version')
  }
}

// ============================================================================
// POST - Restore version (replace current content with this version)
// ============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const user = await requireAuth()
    const { versionId } = await params

    // Validate versionId
    const versionIdResult = UuidSchema.safeParse(versionId)
    if (!versionIdResult.success) {
      return badRequest('Invalid version ID')
    }

    let body: unknown
    try {
      const text = await request.text()
      if (!text || text.trim() === '') {
        return badRequest('Empty request body')
      }
      body = JSON.parse(text)
    } catch {
      return badRequest('Invalid JSON in request body')
    }

    const bodyResult = parseBody(body, RestoreBodySchema)
    if (!bodyResult.success) {
      return badRequest(bodyResult.error)
    }

    const { projectId } = bodyResult.data

    const supabase = await createClient()

    // Fetch the version to restore (with ownership check)
    const { data: version, error: versionError } = await supabase
      .from('document_versions')
      .select('content, project_id')
      .eq('id', versionId)
      .eq('user_id', user.id)
      .single()

    if (versionError || !version) {
      return notFound('Version not found or access denied')
    }

    // Verify the version belongs to the specified project
    if (version.project_id !== projectId) {
      return badRequest('Version does not belong to this project')
    }

    // Fetch current content to create a backup version before restoring
    const { data: currentProject, error: projectError } = await supabase
      .from('research_projects')
      .select('content')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !currentProject) {
      return notFound('Project not found or access denied')
    }

    // Create a backup version of current content (type: 'restore' indicates pre-restore backup)
    if (currentProject.content && currentProject.content.trim().length > 0) {
      const backupWordCount = currentProject.content.split(/\s+/).filter(Boolean).length
      
      await supabase
        .from('document_versions')
        .insert({
          project_id: projectId,
          user_id: user.id,
          content: currentProject.content,
          word_count: backupWordCount,
          trigger_type: 'restore',
          label: 'Auto-backup before restore',
        })
    }

    // Update project content with restored version
    const { error: updateError } = await supabase
      .from('research_projects')
      .update({
        content: version.content,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('Failed to restore version:', updateError)
      throw updateError
    }

    return success({ 
      success: true, 
      restoredContent: version.content,
      message: 'Version restored successfully. A backup of your previous content was created.'
    })
  } catch (error) {
    return handleError(error, 'Failed to restore version')
  }
}

// ============================================================================
// DELETE - Delete a specific version
// ============================================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const user = await requireAuth()
    const { versionId } = await params

    // Validate versionId
    const versionIdResult = UuidSchema.safeParse(versionId)
    if (!versionIdResult.success) {
      return badRequest('Invalid version ID')
    }

    const supabase = await createClient()

    // Delete version (RLS ensures user can only delete their own)
    const { error: deleteError } = await supabase
      .from('document_versions')
      .delete()
      .eq('id', versionId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('Failed to delete version:', deleteError)
      throw deleteError
    }

    return success({ success: true })
  } catch (error) {
    return handleError(error, 'Failed to delete version')
  }
}
