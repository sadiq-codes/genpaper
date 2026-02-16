import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  requireAuth,
  parseQuery,
  parseBody,
  badRequest,
  success,
  handleError,
  UuidSchema,
} from '@/lib/api/helpers'

// ============================================================================
// Validation Schemas
// ============================================================================

const GetVersionsSchema = z.object({
  projectId: UuidSchema,
})

const CreateVersionSchema = z.object({
  projectId: UuidSchema,
  label: z.string().max(100).optional(),
})

// ============================================================================
// GET - List versions for a project
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()

    const paramsResult = parseQuery(request, GetVersionsSchema)
    if (!paramsResult.success) {
      return badRequest(paramsResult.error)
    }

    const { projectId } = paramsResult.data

    const supabase = await createClient()

    // Verify user owns this project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return badRequest('Project not found or access denied')
    }

    // Fetch versions (without full content for list view)
    const { data: versions, error: versionsError } = await supabase
      .from('document_versions')
      .select('id, created_at, word_count, trigger_type, label')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (versionsError) {
      console.error('Failed to fetch versions:', versionsError)
      throw versionsError
    }

    return success({ versions: versions || [] })
  } catch (error) {
    return handleError(error, 'Failed to fetch versions')
  }
}

// ============================================================================
// POST - Create a manual save point (labeled version)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()

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

    const bodyResult = parseBody(body, CreateVersionSchema)
    if (!bodyResult.success) {
      return badRequest(bodyResult.error)
    }

    const { projectId, label } = bodyResult.data

    const supabase = await createClient()

    // Fetch current content from the project
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('content')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return badRequest('Project not found or access denied')
    }

    if (!project.content || project.content.trim().length === 0) {
      return badRequest('Cannot create save point for empty document')
    }

    // Calculate word count
    const wordCount = project.content.split(/\s+/).filter(Boolean).length

    // Create manual version
    const { data: version, error: versionError } = await supabase
      .from('document_versions')
      .insert({
        project_id: projectId,
        user_id: user.id,
        content: project.content,
        word_count: wordCount,
        trigger_type: 'manual',
        label: label || null,
      })
      .select('id, created_at, word_count, trigger_type, label')
      .single()

    if (versionError) {
      console.error('Failed to create save point:', versionError)
      throw versionError
    }

    return success({ version })
  } catch (error) {
    return handleError(error, 'Failed to create save point')
  }
}
