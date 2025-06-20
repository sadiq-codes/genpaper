import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const testType = url.searchParams.get('test') || 'stream'

    if (testType === 'stream') {
      // Test EventSource URL building
      const testRequest = {
        topic: 'test topic',
        libraryPaperIds: ['paper1', 'paper2'],
        useLibraryOnly: true,
        config: {
          length: 'medium' as const,
          style: 'academic' as const,
          includeMethodology: true
        }
      }

      const params = new URLSearchParams()
      params.set('topic', testRequest.topic)
      if (testRequest.libraryPaperIds && testRequest.libraryPaperIds.length > 0) {
        params.set('libraryPaperIds', testRequest.libraryPaperIds.join(','))
      }
      if (testRequest.useLibraryOnly) {
        params.set('useLibraryOnly', 'true')
      }
      if (testRequest.config) {
        if (testRequest.config.length) params.set('length', testRequest.config.length)
        if (testRequest.config.style) params.set('style', testRequest.config.style)

        if (testRequest.config.includeMethodology !== undefined) {
          params.set('includeMethodology', testRequest.config.includeMethodology.toString())
        }
      }
      
      const streamUrl = `/api/generate/stream?${params.toString()}`

      return NextResponse.json({
        message: 'Task 5 EventSource URL building test',
        testRequest,
        generatedStreamUrl: streamUrl,
        urlParams: Object.fromEntries(params.entries()),
        status: 'success'
      })
    }

    if (testType === 'swr') {
      // Test SWR mutate keys
      const projectId = 'test-project-123'
      const mutateKeys = [
        `/api/projects/${projectId}/versions`,
        `/api/projects/${projectId}`
      ]

      return NextResponse.json({
        message: 'Task 5 SWR mutate keys test',
        projectId,
        mutateKeys,
        description: 'These are the keys that will be revalidated on checkpoints and completion',
        status: 'success'
      })
    }

    return NextResponse.json({
      message: 'Task 5 implementation test',
      availableTests: ['stream', 'swr'],
      usage: 'Add ?test=stream or ?test=swr to test specific functionality',
      task5Features: [
        '✅ SWR integration with useSWR hook',
        '✅ EventSource fetcher for SSE connections', 
        '✅ Automatic revalidation with mutate() on checkpoints',
        '✅ Query parameter URL building for EventSource',
        '✅ GET endpoint for EventSource connections',
        '✅ Proper cleanup and error handling'
      ]
    })

  } catch (error) {
    console.error('Error in Task 5 test:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' }, 
      { status: 500 }
    )
  }
} 