import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import z from 'zod'

/**
 * PUT /api/citations/[paperId] - Update CSL JSON for a citation in a project
 * 
 * Updates the project_citations.csl_json for a specific paper in a project.
 * This only affects the citation within the specified project, not the global paper.
 */

// CSL Author schema
const CSLAuthorSchema = z.object({
  family: z.string().min(1, 'Family name is required'),
  given: z.string().default(''),
  literal: z.string().optional(),
})

// CSL Item schema for validation
const CSLItemSchema = z.object({
  id: z.string().optional(),
  type: z.enum([
    'article-journal', 'article', 'book', 'chapter', 
    'paper-conference', 'thesis', 'report', 'webpage', 'manuscript'
  ]).default('article-journal'),
  title: z.string().min(1, 'Title is required'),
  author: z.array(CSLAuthorSchema).min(1, 'At least one author is required'),
  'container-title': z.string().optional(),
  issued: z.object({
    'date-parts': z.array(z.array(z.number()))
  }).optional(),
  DOI: z.string().optional(),
  URL: z.string().optional(),
  abstract: z.string().optional(),
  page: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  publisher: z.string().optional(),
  'publisher-place': z.string().optional(),
})

// Request body schema
const UpdateCitationSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  csl_json: CSLItemSchema,
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const { paperId } = await params
    
    // Validate paperId
    if (!paperId || !z.string().uuid().safeParse(paperId).success) {
      return NextResponse.json({ error: 'Invalid paper ID' }, { status: 400 })
    }

    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse and validate request body
    const body = await request.json()
    const validationResult = UpdateCitationSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: validationResult.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 })
    }

    const { projectId, csl_json } = validationResult.data

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

    // Verify citation exists in project
    const { data: existingCitation, error: citationError } = await supabase
      .from('project_citations')
      .select('id')
      .eq('project_id', projectId)
      .eq('paper_id', paperId)
      .single()

    if (citationError || !existingCitation) {
      return NextResponse.json({ 
        error: 'Citation not found in this project' 
      }, { status: 404 })
    }

    // Ensure CSL JSON has the paper ID
    const cslWithId = {
      ...csl_json,
      id: paperId,
    }

    // Update the CSL JSON in project_citations
    // First try with updated_at, fall back to without if column doesn't exist
    let updateError = null
    
    // Try with updated_at first
    const { error: errorWithTimestamp } = await supabase
      .from('project_citations')
      .update({ 
        csl_json: cslWithId,
        updated_at: new Date().toISOString()
      })
      .eq('project_id', projectId)
      .eq('paper_id', paperId)

    if (errorWithTimestamp?.message?.includes('updated_at')) {
      // Column doesn't exist yet, try without it
      const { error: errorWithoutTimestamp } = await supabase
        .from('project_citations')
        .update({ csl_json: cslWithId })
        .eq('project_id', projectId)
        .eq('paper_id', paperId)
      
      updateError = errorWithoutTimestamp
    } else {
      updateError = errorWithTimestamp
    }

    if (updateError) {
      console.error('Failed to update citation:', updateError)
      return NextResponse.json({ 
        error: 'Failed to update citation',
        message: updateError.message
      }, { status: 500 })
    }

    // Return success with updated data
    return NextResponse.json({
      success: true,
      data: {
        paperId,
        projectId,
        csl_json: cslWithId,
      }
    })

  } catch (error) {
    console.error('Update citation API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}

// GET - Fetch CSL JSON for a citation
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperId: string }> }
) {
  try {
    const { paperId } = await params
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    // Validate params
    if (!paperId || !z.string().uuid().safeParse(paperId).success) {
      return NextResponse.json({ error: 'Invalid paper ID' }, { status: 400 })
    }
    if (!projectId || !z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: 'Invalid or missing project ID' }, { status: 400 })
    }

    // Authentication check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Fetch citation with CSL JSON
    const { data: citation, error: citationError } = await supabase
      .from('project_citations')
      .select('paper_id, csl_json')
      .eq('project_id', projectId)
      .eq('paper_id', paperId)
      .single()

    if (citationError || !citation) {
      return NextResponse.json({ 
        error: 'Citation not found in this project' 
      }, { status: 404 })
    }

    // Get CSL JSON from project_citations, but also fetch paper data for fallback/merge
    let cslJson = citation.csl_json as Record<string, unknown> | null

    // Always fetch paper data to fill in missing fields
    const { data: paper } = await supabase
      .from('papers')
      .select('id, title, authors, publication_date, venue, doi, url, metadata')
      .eq('id', paperId)
      .single()

    if (!cslJson) {
      // No CSL JSON stored, build from paper metadata
      if (paper) {
        const authors = (paper.authors || []).map((name: string) => {
          if (name.includes(',')) {
            const [family, given] = name.split(',').map(s => s.trim())
            return { family, given: given || '' }
          }
          const parts = name.trim().split(/\s+/)
          if (parts.length === 1) {
            return { family: parts[0], given: '' }
          }
          return { 
            family: parts[parts.length - 1], 
            given: parts.slice(0, -1).join(' ') 
          }
        })

        const year = paper.publication_date 
          ? new Date(paper.publication_date).getFullYear() 
          : null

        // Extract additional fields from metadata if available
        const metadata = paper.metadata as Record<string, unknown> | null

        cslJson = {
          id: paperId,
          type: 'article-journal',
          title: paper.title || 'Untitled',
          author: authors.length > 0 ? authors : [{ family: 'Unknown', given: '' }],
          'container-title': paper.venue || undefined,
          issued: year ? { 'date-parts': [[year]] } : undefined,
          DOI: paper.doi || undefined,
          URL: paper.url || undefined,
          volume: metadata?.volume as string || undefined,
          issue: metadata?.issue as string || undefined,
          page: metadata?.pages as string || undefined,
          publisher: metadata?.publisher as string || undefined,
        }
      }
    } else {
      // CSL JSON exists, but merge in missing fields from paper table
      // This ensures DOI and other fields are available even if not in stored CSL
      if (paper) {
        if (!cslJson.DOI && !cslJson.doi && paper.doi) {
          cslJson.DOI = paper.doi
        }
        if (!cslJson.URL && !cslJson.url && paper.url) {
          cslJson.URL = paper.url
        }
        // Also merge metadata fields if missing
        const metadata = paper.metadata as Record<string, unknown> | null
        if (metadata) {
          if (!cslJson.volume && metadata.volume) cslJson.volume = metadata.volume
          if (!cslJson.issue && metadata.issue) cslJson.issue = metadata.issue
          if (!cslJson.page && metadata.pages) cslJson.page = metadata.pages
          if (!cslJson.publisher && metadata.publisher) cslJson.publisher = metadata.publisher
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        paperId,
        projectId,
        csl_json: cslJson,
      }
    })

  } catch (error) {
    console.error('Get citation API error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    }, { status: 500 })
  }
}
