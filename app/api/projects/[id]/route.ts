import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getResearchProject, 
  getProjectWithContent,
  getProjectPapersWithCSL
} from '@/lib/db/research'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: projectId } = await params

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const url = new URL(request.url)
    const includeVersions = url.searchParams.get('includeVersions') === 'true'
    const includeCitations = url.searchParams.get('includeCitations') === 'true'
    const includePapers = url.searchParams.get('includePapers') === 'true'
    const _versionLimit = url.searchParams.get('versionLimit')

    // Get project details
    const project = await getResearchProject(projectId, user.id)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get project with content
    const projectWithContent = await getProjectWithContent(projectId)

    let versions = undefined
    let citations = undefined
    let papers = undefined

    // Create version object if requested (simplified - just one version)
    if (includeVersions && projectWithContent) {
      versions = [{
        id: projectWithContent.id,
        project_id: projectWithContent.id,
        version: 1,
        content: projectWithContent.content,
        created_at: projectWithContent.created_at
      }]
    }

    // Get citations if requested
    if (includeCitations) {
      const { data: addCitationData, error: addCitationError } = await supabase
        .from('citations')
        .select('id, key, csl_json')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (addCitationError) {
        console.error('Error loading citations:', addCitationError)
      }

      const map: Record<string, unknown> = {}
      ;(addCitationData || []).forEach(rec => {
        map[rec.key] = rec.csl_json
      })
      citations = map
    }

    // Get papers with CSL data if requested
    if (includePapers) {
      papers = await getProjectPapersWithCSL(projectId, 1) // Use version 1 as default
    }

    return NextResponse.json({
      ...project,
      latest_version: projectWithContent ? {
        id: projectWithContent.id,
        project_id: projectWithContent.id,
        version: 1,
        content: projectWithContent.content,
        created_at: projectWithContent.created_at
      } : null,
      versions,
      citations,
      papers
    })

  } catch (error) {
    console.error('Error in projects/[id] GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 