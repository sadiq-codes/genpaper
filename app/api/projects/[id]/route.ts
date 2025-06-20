import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getResearchProject, 
  getLatestProjectVersion, 
  getProjectVersions,
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
    const versionLimit = url.searchParams.get('versionLimit')

    // Get project details
    const project = await getResearchProject(projectId, user.id)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get latest version
    const latestVersion = await getLatestProjectVersion(projectId)

    let versions = undefined
    let citations = undefined
    let papers = undefined

    // Get versions if requested
    if (includeVersions) {
      const limit = versionLimit ? parseInt(versionLimit) : 10
      versions = await getProjectVersions(projectId, limit)
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
      papers = await getProjectPapersWithCSL(projectId, latestVersion?.version)
    }

    return NextResponse.json({
      ...project,
      latest_version: latestVersion,
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