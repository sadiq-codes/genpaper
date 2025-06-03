import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import { generatePaperPipeline } from '@/lib/services/generate'
import type { 
  GenerateRequest, 
  GenerateResponse, 
  GenerationConfig
} from '@/types/simplified'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: GenerateRequest = await request.json()
    const { topic, libraryPaperIds, useLibraryOnly, config } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Create generation config
    const generationConfig: GenerationConfig = {
      temperature: 0.7,
      max_tokens: 16000,
      stream: false,
      search_parameters: {
        sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        fromYear: 1990,
        includePreprints: false,
        useSemanticSearch: true,
        fallbackToAcademic: true
      },
      paper_settings: {
        length: config?.length || 'medium',
        style: config?.style || 'academic',
        citationStyle: config?.citationStyle || 'apa',
        includeMethodology: config?.includeMethodology ?? true
      },
      library_papers_used: libraryPaperIds || []
    }

    // Create research project
    const project = await createResearchProject(user.id, topic, generationConfig)

    // Start paper generation in the background with proper error handling
    void generatePaperPipeline({
      projectId: project.id,
      userId: user.id,
      topic,
      libraryPaperIds,
      useLibraryOnly,
      generationConfig
    }).catch(error => {
      console.error('Background generation failed:', error)
    })

    const response: GenerateResponse = {
      projectId: project.id,
      status: 'generating',
      message: 'Paper generation started. You can check the status or view progress.'
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in generate API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET endpoint for checking generation status
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    // Get project status
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id, topic, status, created_at, completed_at')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      projectId: project.id,
      topic: project.topic,
      status: project.status,
      createdAt: project.created_at,
      completedAt: project.completed_at
    })

  } catch (error) {
    console.error('Error checking generation status:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 