import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects, deleteResearchProject, createResearchProject } from '@/lib/db/research'
import {
  requireAuth,
  parseQuery,
  parseBody,
  badRequest,
  notFound,
  success,
  handleError,
  PaginationSchema,
  UuidSchema,
} from '@/lib/api/helpers'

// ============================================================================
// Validation Schemas
// ============================================================================

const GetQuerySchema = PaginationSchema

const PostBodySchema = z.object({
  topic: z.string().min(1, 'Topic is required').min(10, 'Topic must be at least 10 characters'),
  paperType: z.enum(['researchArticle', 'literatureReview', 'capstoneProject', 'mastersThesis', 'phdDissertation']).default('literatureReview'),
  selectedPapers: z.array(z.string()).optional(),
  hasOriginalResearch: z.boolean().optional().default(false),
  keyFindings: z.string().optional(),
  generationMode: z.enum(['generate', 'write']).optional().default('generate'),
}).refine(
  (data) => !data.hasOriginalResearch || (data.keyFindings && data.keyFindings.trim().length >= 10),
  { message: 'Key findings are required (at least 10 characters) when original research is enabled', path: ['keyFindings'] }
)

const DeleteQuerySchema = z.object({
  projectId: UuidSchema,
})

// ============================================================================
// GET - Retrieve user's research projects
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()

    const queryResult = parseQuery(request, GetQuerySchema)
    if (!queryResult.success) {
      return badRequest(queryResult.error)
    }

    const { limit, offset } = queryResult.data
    const projects = await getUserResearchProjects(user.id, limit, offset)

    return success({
      projects,
      total: projects.length,
      limit,
      offset,
    })
  } catch (error) {
    return handleError(error, 'Error in projects GET API')
  }
}

// ============================================================================
// POST - Create a new research project
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth()

    const body = await request.json()
    const bodyResult = parseBody(body, PostBodySchema)
    if (!bodyResult.success) {
      return badRequest(bodyResult.error)
    }

    const { topic, paperType, selectedPapers, hasOriginalResearch, keyFindings, generationMode } = bodyResult.data

    // Build generation config
    const generationConfig: Record<string, unknown> = {
      paper_settings: { paperType },
      generation_mode: generationMode,
    }

    // Add original research data if provided
    if (hasOriginalResearch) {
      generationConfig.original_research = {
        has_original_research: true,
        research_question: topic.trim(),
        key_findings: keyFindings?.trim(),
      }
    }

    // Add selected papers if provided
    if (selectedPapers && selectedPapers.length > 0) {
      generationConfig.library_papers_used = selectedPapers
    }

    const project = await createResearchProject(user.id, topic.trim(), generationConfig)

    return success({
      project,
      message: 'Project created successfully',
    })
  } catch (error) {
    return handleError(error, 'Error in projects POST API')
  }
}

// ============================================================================
// DELETE - Delete a research project
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth()

    const queryResult = parseQuery(request, DeleteQuerySchema)
    if (!queryResult.success) {
      return badRequest(queryResult.error)
    }

    const { projectId } = queryResult.data

    // Verify ownership
    const supabase = await createClient()
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return notFound('Project not found')
    }

    await deleteResearchProject(projectId)

    return success({ success: true })
  } catch (error) {
    return handleError(error, 'Error in projects DELETE API')
  }
}
