/**
 * Paper Processing API
 * 
 * Triggers background processing of papers (extraction, chunking, embedding).
 * Used when:
 * - User clicks "AI Generate" - process all project papers before generation
 * - User opens editor in "Write Myself" mode - process in background
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  processPaper, 
  processProjectPapers, 
  getPapersProcessingStatus,
  type ProcessingResult 
} from '@/lib/content/background-processor'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max for processing

interface ProcessRequest {
  // Process specific paper IDs
  paperIds?: string[]
  // Or process all papers for a project
  projectId?: string
  // Wait for completion or return immediately
  waitForCompletion?: boolean
}

/**
 * POST /api/papers/process
 * 
 * Trigger processing of papers. Can process:
 * - Specific papers by ID
 * - All papers for a project
 * 
 * Options:
 * - waitForCompletion: true = wait and return results (for "AI Generate")
 * - waitForCompletion: false = start processing and return immediately (for "Write Myself")
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ProcessRequest = await request.json()
    const { paperIds, projectId, waitForCompletion = false } = body

    if (!paperIds?.length && !projectId) {
      return NextResponse.json(
        { error: 'Either paperIds or projectId is required' },
        { status: 400 }
      )
    }

    console.log('[Process API] Request received:', {
      paperIds: paperIds?.length,
      projectId,
      waitForCompletion,
      userId: user.id
    })

    // If projectId provided, verify user owns it
    if (projectId) {
      const { data: project, error: projectError } = await supabase
        .from('research_projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()
      
      if (projectError || !project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
    }

    // If paperIds provided, verify user has access to them
    if (paperIds?.length) {
      // User has access if:
      // 1. Paper is in their library (library_papers)
      // 2. Paper is owned by them (owner_id = user.id)
      // 3. Paper is public (owner_id = null)
      const { data: accessiblePapers, error: accessError } = await supabase
        .from('papers')
        .select('id')
        .in('id', paperIds)
        .or(`owner_id.eq.${user.id},owner_id.is.null`)
      
      if (accessError) {
        console.error('[Process API] Access check error:', accessError)
        return NextResponse.json({ error: 'Failed to verify paper access' }, { status: 500 })
      }

      const accessibleIds = new Set(accessiblePapers?.map(p => p.id) || [])
      const unauthorizedIds = paperIds.filter(id => !accessibleIds.has(id))
      
      if (unauthorizedIds.length > 0) {
        console.warn('[Process API] Unauthorized paper access attempt:', unauthorizedIds)
        return NextResponse.json(
          { error: 'Access denied to some papers', unauthorizedIds },
          { status: 403 }
        )
      }
    }

    // Start processing
    if (waitForCompletion) {
      // Synchronous mode - wait for results
      console.log('[Process API] Starting synchronous processing')
      
      let results: ProcessingResult[]
      if (projectId) {
        results = await processProjectPapers(projectId)
      } else {
        const { processMultiplePapers } = await import('@/lib/content/background-processor')
        results = await processMultiplePapers(paperIds!)
      }

      const successful = results.filter(r => r.status === 'processed')
      const failed = results.filter(r => r.status === 'failed')

      console.log('[Process API] Processing complete:', {
        total: results.length,
        successful: successful.length,
        failed: failed.length
      })

      return NextResponse.json({
        success: true,
        processed: successful.length,
        failed: failed.length,
        results
      })
    } else {
      // Async mode - start processing and return immediately
      console.log('[Process API] Starting async processing')
      
      // Start processing in background (fire and forget)
      if (projectId) {
        processProjectPapers(projectId).catch(err => {
          console.error('[Process API] Background project processing error:', err)
        })
      } else {
        import('@/lib/content/background-processor').then(({ processMultiplePapers }) => {
          processMultiplePapers(paperIds!).catch(err => {
            console.error('[Process API] Background paper processing error:', err)
          })
        })
      }

      return NextResponse.json({
        success: true,
        message: 'Processing started in background',
        paperCount: paperIds?.length || 'all project papers'
      })
    }

  } catch (error) {
    console.error('[Process API] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Processing failed' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/papers/process?paperIds=id1,id2,id3
 * 
 * Check processing status of papers
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const paperIdsParam = url.searchParams.get('paperIds')
    const projectId = url.searchParams.get('projectId')

    if (!paperIdsParam && !projectId) {
      return NextResponse.json(
        { error: 'Either paperIds or projectId query param is required' },
        { status: 400 }
      )
    }

    let paperIds: string[]

    if (projectId) {
      // Get all paper IDs for the project
      const { data: citations, error } = await supabase
        .from('project_citations')
        .select('paper_id')
        .eq('project_id', projectId)
      
      if (error) {
        return NextResponse.json({ error: 'Failed to fetch project papers' }, { status: 500 })
      }
      
      paperIds = citations?.map(c => c.paper_id) || []
    } else {
      paperIds = paperIdsParam!.split(',').filter(Boolean)
    }

    if (paperIds.length === 0) {
      return NextResponse.json({ statuses: {} })
    }

    const statusMap = await getPapersProcessingStatus(paperIds)
    
    // Convert Map to object for JSON response
    const statuses: Record<string, string> = {}
    for (const [id, status] of statusMap) {
      statuses[id] = status
    }

    // Summary stats
    const pending = Object.values(statuses).filter(s => s === 'pending').length
    const processing = Object.values(statuses).filter(s => s === 'processing').length
    const processed = Object.values(statuses).filter(s => s === 'processed').length
    const failed = Object.values(statuses).filter(s => s === 'failed').length

    return NextResponse.json({
      statuses,
      summary: {
        total: paperIds.length,
        pending,
        processing,
        processed,
        failed,
        allProcessed: processed === paperIds.length
      }
    })

  } catch (error) {
    console.error('[Process API] Status check error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Status check failed' },
      { status: 500 }
    )
  }
}
