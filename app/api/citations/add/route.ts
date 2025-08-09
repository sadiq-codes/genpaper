import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'
import { isCitationsUnifiedEnabled } from '@/lib/config/feature-flags'
import { CitationService } from '@/lib/citations/immediate-bibliography'
import { citationRateLimiter } from '@/lib/utils/rate-limiter'
import { citationLogger } from '@/lib/utils/citation-logger'

/**
 * POST /api/citations/add - Service-backed citation creation
 * 
 * Single write path for UI & AI citation creation using CitationService
 */

// Schema for the new service-backed add endpoint
const AddCitationSchema = z.object({
  projectId: z.string().uuid(),
  sourceRef: z.object({
    doi: z.string().optional(),
    title: z.string().optional(),
    year: z.number().int().min(1000).max(3000).optional(),
    url: z.string().url().optional(),
    paperId: z.string().uuid().optional()
  }).refine(
    (data) => data.doi || data.title || data.url || data.paperId,
    { message: "At least one of doi, title, url, or paperId must be provided" }
  ),
  reason: z.string().min(1),
  anchorId: z.string().optional(),
  quote: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = AddCitationSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId, sourceRef, reason, anchorId, quote } = validationResult.data

    // Apply rate limiting per project
    const rateLimitResult = citationRateLimiter.checkLimit(projectId, 1)
    if (!rateLimitResult.allowed) {
      citationLogger.logRateLimit({
        operation: 'citation_add',
        projectId,
        limit: 60,
        windowMs: 60000,
        retryAfter: rateLimitResult.retryAfter
      })

      return NextResponse.json({
        error: 'Rate limit exceeded',
        message: 'Too many citation requests. Please slow down.',
        retryAfter: rateLimitResult.retryAfter
      }, { 
        status: 429,
        headers: {
          'Retry-After': rateLimitResult.retryAfter?.toString() || '60',
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString()
        }
      })
    }

    // Verify project ownership
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ 
        error: 'Project not found or access denied' 
      }, { status: 404 })
    }

    try {
      // Use CitationService for unified processing
      const result = await CitationService.add({
        projectId,
        sourceRef,
        reason,
        anchorId,
        quote
      })

      // Success response with structured data
      return NextResponse.json({
        success: true,
        data: {
          citeKey: result.citeKey,
          projectCitationId: result.projectCitationId,
          isNew: result.isNew
        }
      }, { status: result.isNew ? 201 : 200 })

    } catch (citationError) {
      // Check for duplicate/conflict
      if (citationError instanceof Error && citationError.message.includes('Could not resolve source reference')) {
        return NextResponse.json({
          error: 'Source reference could not be resolved',
          message: citationError.message,
          sourceRef
        }, { status: 400 })
      }

      // Check for validation errors
      if (citationError instanceof Error && citationError.message.includes('CSL validation failed')) {
        return NextResponse.json({
          error: 'Invalid citation data',
          message: citationError.message
        }, { status: 400 })
      }

      // Unexpected errors
      console.error('Citation creation failed:', citationError)
      return NextResponse.json({
        error: 'Internal server error',
        message: 'Failed to create citation'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('Citations add API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// Method not allowed for other HTTP methods
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function PUT() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}

export async function DELETE() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}